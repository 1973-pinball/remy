-- Access requests never grant journal permissions. Only the server can read or mutate them.
create table public.remy_access_requests (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null check (length(email) between 3 and 254),
  display_name text check (length(display_name) <= 120),
  requested_at timestamptz not null default now(),
  notification_status text not null default 'queued' check (notification_status in ('queued','sending','sent','review')),
  notification_reason text default 'unconfigured' check (notification_reason in ('unconfigured','rate_limited','delivery_failed','delivery_unknown','retry_limit','idempotency_expired','configuration_changed')),
  notified_at timestamptz,
  provider_message_id text,
  attempts integer not null default 0 check (attempts between 0 and 3),
  first_attempt_at timestamptz,
  last_attempt_at timestamptz,
  next_attempt_at timestamptz,
  lease_token uuid,
  lease_expires_at timestamptz,
  notification_payload jsonb
);
create index remy_access_requests_requested_at on public.remy_access_requests(requested_at desc);
alter table public.remy_access_requests enable row level security;
revoke all on public.remy_access_requests from public,anon,authenticated;
grant all on public.remy_access_requests to service_role;

create function public.remy_queue_access_request(p_user uuid,p_email text,p_name text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare saved public.remy_access_requests;
begin
  if coalesce(auth.role(),'') <> 'service_role' then raise exception 'REMY_FORBIDDEN'; end if;
  if p_email is null or length(p_email)>254 or p_email <> lower(trim(p_email))
    or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or (p_name is not null and length(p_name)>120)
    or not exists(select 1 from auth.users u where u.id=p_user and lower(u.email)=p_email and u.email_confirmed_at is not null)
    or not exists(select 1 from auth.identities i where i.user_id=p_user and i.provider='google')
  then raise exception 'REMY_ACCESS_IDENTITY_REQUIRED'; end if;
  insert into public.remy_access_requests(user_id,email,display_name) values(p_user,p_email,p_name) on conflict(user_id) do nothing;
  select * into saved from public.remy_access_requests where user_id=p_user;
  return to_jsonb(saved);
end $$;

create function public.remy_claim_access_notification(p_user uuid,p_token uuid,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare saved public.remy_access_requests;
begin
  if coalesce(auth.role(),'') <> 'service_role' then raise exception 'REMY_FORBIDDEN'; end if;
  if p_token is null or p_payload is null or jsonb_typeof(p_payload)<>'object' or length(p_payload::text)>4000 then raise exception 'REMY_INVALID_NOTIFICATION'; end if;
  -- One lock protects both the per-request lease and the modest global mail budget.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('remy-access-notifications',0));
  select * into saved from public.remy_access_requests where user_id=p_user for update;
  if not found then raise exception 'REMY_ACCESS_REQUEST_MISSING'; end if;
  if saved.notification_status in ('sent','review') or saved.lease_expires_at>now() then
    return jsonb_build_object('claimed',false,'request',to_jsonb(saved));
  end if;
  -- Resend keeps keys for 24h. Stop early after an ambiguous attempt, never resend
  -- outside that window, and keep the exact same payload across safe retries.
  if saved.first_attempt_at <= now()-interval '23 hours' then
    update public.remy_access_requests set notification_status='review',notification_reason='idempotency_expired',lease_token=null,lease_expires_at=null where user_id=p_user returning * into saved;
  elsif saved.notification_payload is not null and saved.notification_payload<>p_payload then
    update public.remy_access_requests set notification_status='review',notification_reason='configuration_changed',lease_token=null,lease_expires_at=null where user_id=p_user returning * into saved;
  elsif saved.attempts>=3 then
    update public.remy_access_requests set notification_status='review',notification_reason='retry_limit',lease_token=null,lease_expires_at=null where user_id=p_user returning * into saved;
  elsif saved.next_attempt_at>now() then
    return jsonb_build_object('claimed',false,'request',to_jsonb(saved));
  elsif (select count(*) from public.remy_access_requests where last_attempt_at>now()-interval '1 minute')>=3
    or (saved.first_attempt_at is null and (select count(*) from public.remy_access_requests where first_attempt_at>now()-interval '24 hours')>=20) then
    update public.remy_access_requests set notification_status='queued',notification_reason='rate_limited',next_attempt_at=now()+interval '5 minutes',lease_token=null,lease_expires_at=null where user_id=p_user returning * into saved;
  else
    update public.remy_access_requests set notification_status='sending',notification_reason=null,
      lease_token=p_token,lease_expires_at=now()+interval '2 minutes',
      first_attempt_at=coalesce(first_attempt_at,now()),last_attempt_at=now(),next_attempt_at=now()+interval '5 minutes',
      attempts=attempts+1,notification_payload=coalesce(notification_payload,p_payload)
    where user_id=p_user returning * into saved;
    return jsonb_build_object('claimed',true,'request',to_jsonb(saved));
  end if;
  return jsonb_build_object('claimed',false,'request',to_jsonb(saved));
end $$;

create function public.remy_finish_access_notification(p_user uuid,p_token uuid,p_message_id text,p_reason text)
returns void language plpgsql security definer set search_path='' as $$
begin
  if coalesce(auth.role(),'') <> 'service_role' then raise exception 'REMY_FORBIDDEN'; end if;
  if (p_message_id is not null and (length(p_message_id)>128 or p_message_id=''))
    or (p_message_id is null and (p_reason is null or p_reason not in ('delivery_failed','delivery_unknown')))
  then raise exception 'REMY_INVALID_NOTIFICATION'; end if;
  update public.remy_access_requests set
    notification_status=case when p_message_id is not null then 'sent' when attempts>=3 then 'review' else 'queued' end,
    notification_reason=case when p_message_id is not null then null when attempts>=3 then 'retry_limit' else p_reason end,
    notified_at=case when p_message_id is not null then now() else null end,
    provider_message_id=p_message_id,lease_token=null,lease_expires_at=null
  where user_id=p_user and lease_token=p_token;
end $$;

revoke all on function public.remy_queue_access_request(uuid,text,text),public.remy_claim_access_notification(uuid,uuid,jsonb),public.remy_finish_access_notification(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.remy_queue_access_request(uuid,text,text),public.remy_claim_access_notification(uuid,uuid,jsonb),public.remy_finish_access_notification(uuid,uuid,text,text) to service_role;
