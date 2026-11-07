-- Remy-only opaque OAuth credentials. These are never Supabase Auth tokens.
create table public.remy_mcp_clients (
  client_id uuid primary key,
  owner uuid not null references auth.users(id) on delete cascade,
  name text not null,
  resource text not null check (resource ~ '^https://[^/]+/api/mcp$'),
  redirect_uris text[] not null check (cardinality(redirect_uris)>0),
  enabled boolean not null default false
);
create table public.remy_mcp_grants (
  owner uuid not null references auth.users(id) on delete cascade,
  client_id uuid not null references public.remy_mcp_clients(client_id) on delete cascade,
  version bigint not null default 1,
  scopes text[] not null,
  approved_at timestamptz not null default now(),
  revoked_at timestamptz,
  primary key(owner,client_id)
);
create table public.remy_mcp_authorizations (
  id uuid primary key,
  client_id uuid not null references public.remy_mcp_clients(client_id) on delete cascade,
  redirect_uri text not null,
  resource text not null,
  scopes text[] not null,
  state text not null,
  challenge text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now()+interval '10 minutes',
  used_at timestamptz
);
create table public.remy_mcp_codes (
  hash text primary key check(hash ~ '^[a-f0-9]{64}$'),
  owner uuid not null references auth.users(id) on delete cascade,
  client_id uuid not null references public.remy_mcp_clients(client_id) on delete cascade,
  grant_version bigint not null,
  redirect_uri text not null,
  resource text not null,
  scopes text[] not null,
  challenge text not null,
  expires_at timestamptz not null default now()+interval '5 minutes',
  used_at timestamptz,
  family uuid
);
create table public.remy_mcp_families (
  id uuid primary key,
  owner uuid not null references auth.users(id) on delete cascade,
  client_id uuid not null references public.remy_mcp_clients(client_id) on delete cascade,
  grant_version bigint not null,
  expires_at timestamptz not null default now()+interval '30 days',
  revoked_at timestamptz
);
create table public.remy_mcp_tokens (
  hash text primary key check(hash ~ '^[a-f0-9]{64}$'),
  family uuid not null references public.remy_mcp_families(id) on delete cascade,
  kind text not null check(kind in('access','refresh')),
  scopes text[] not null,
  resource text not null,
  expires_at timestamptz not null,
  used_at timestamptz
);
create index remy_mcp_authorizations_client_time on public.remy_mcp_authorizations(client_id,created_at);
create index remy_mcp_tokens_family on public.remy_mcp_tokens(family);
alter table public.remy_mcp_clients enable row level security;
alter table public.remy_mcp_grants enable row level security;
alter table public.remy_mcp_authorizations enable row level security;
alter table public.remy_mcp_codes enable row level security;
alter table public.remy_mcp_families enable row level security;
alter table public.remy_mcp_tokens enable row level security;
revoke all on public.remy_mcp_clients,public.remy_mcp_grants,public.remy_mcp_authorizations,public.remy_mcp_codes,public.remy_mcp_families,public.remy_mcp_tokens from public,anon,authenticated;
grant all on public.remy_mcp_clients,public.remy_mcp_grants,public.remy_mcp_authorizations,public.remy_mcp_codes,public.remy_mcp_families,public.remy_mcp_tokens to service_role;

-- All credential mutations share the journal's owner lock. Bumping the source
-- version invalidates any write authorized before a revoke/reconnect/replay.
create function public.remy_mcp_bump_guard(p_owner uuid,p_enable boolean default false)
returns void language plpgsql security definer set search_path='' as $$
begin
 perform public.remy_assert_writable(p_owner,null);
 insert into public.remy_journals(owner) values(p_owner) on conflict do nothing;
 update public.remy_journals set source_versions=jsonb_set(source_versions,'{remy-mcp}',to_jsonb(coalesce((source_versions->>'remy-mcp')::bigint,0)+1)),disabled_sources=case when p_enable then jsonb_set(disabled_sources,'{remy-mcp}','false') else disabled_sources end where owner=p_owner;
end $$;
-- Public endpoint input is validated again here before creating a pending request.
create function public.remy_mcp_begin_authorization(
  p_id uuid,p_client uuid,p_redirect text,p_resource text,
  p_scopes text[],p_state text,p_challenge text
) returns void language plpgsql security definer set search_path='' as $$
declare c public.remy_mcp_clients;
begin
 select * into c from public.remy_mcp_clients where client_id=p_client and enabled;
 if not found or c.resource is distinct from p_resource or p_redirect is null or not(p_redirect=any(c.redirect_uris)) or p_scopes is null or not(p_scopes @> array['diet:read','diet:write']) or not(p_scopes <@ array['diet:read','diet:write']) or p_state is null or length(p_state) not between 1 and 512 or p_challenge is null or p_challenge !~ '^[A-Za-z0-9_-]{43}$' then raise exception 'REMY_OAUTH_INVALID_REQUEST'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mcp-authorize:'||p_client::text,0));
 if (select count(*) from public.remy_mcp_authorizations where client_id=p_client and created_at>now()-interval '5 minutes')>=30 then raise exception 'REMY_OAUTH_RATE_LIMIT'; end if;
 insert into public.remy_mcp_authorizations(id,client_id,redirect_uri,resource,scopes,state,challenge) values(p_id,p_client,p_redirect,p_resource,p_scopes,p_state,p_challenge);
end $$;
-- The signed-in owner sees an explicit consent page before this atomic decision.
create function public.remy_mcp_decide_authorization(
  p_owner uuid,p_id uuid,p_approve boolean,p_code_hash text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.remy_mcp_authorizations;c public.remy_mcp_clients;v bigint;
begin
 perform public.remy_assert_writable(p_owner,null);
 select * into a from public.remy_mcp_authorizations where id=p_id for update;
 if not found or a.used_at is not null or a.expires_at<=now() then raise exception 'REMY_OAUTH_EXPIRED'; end if;
 select * into c from public.remy_mcp_clients where client_id=a.client_id and owner=p_owner and enabled;
 if not found or c.resource<>a.resource or not(a.redirect_uri=any(c.redirect_uris)) then raise exception 'REMY_OAUTH_CLIENT_DENIED'; end if;
 if p_approve then
   insert into public.remy_mcp_grants(owner,client_id,scopes) values(p_owner,c.client_id,a.scopes) on conflict(owner,client_id) do update set scopes=excluded.scopes,version=remy_mcp_grants.version+1,approved_at=now(),revoked_at=null returning version into v;
   perform public.remy_mcp_bump_guard(p_owner,true);
   insert into public.remy_mcp_codes(hash,owner,client_id,grant_version,redirect_uri,resource,scopes,challenge) values(p_code_hash,p_owner,c.client_id,v,a.redirect_uri,a.resource,a.scopes,a.challenge);
 end if;
 update public.remy_mcp_authorizations set used_at=now() where id=p_id;
 return jsonb_build_object('redirect_uri',a.redirect_uri,'state',a.state,'approved',p_approve);
end $$;
-- PKCE-bound code redemption. Replays return an error value (not an exception)
-- so revocation persists instead of being rolled back with the transaction.
create function public.remy_mcp_exchange_code(
  p_client uuid,p_code_hash text,p_redirect text,p_resource text,p_challenge text,
  p_access_hash text,p_refresh_hash text,p_family uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.remy_mcp_codes;g public.remy_mcp_grants;
begin
 select * into c from public.remy_mcp_codes where hash=p_code_hash;
 if not found then return '{"error":"invalid_grant"}'; end if;
 perform public.remy_assert_writable(c.owner,null);
 select * into c from public.remy_mcp_codes where hash=p_code_hash for update;
 if c.client_id is distinct from p_client or c.redirect_uri is distinct from p_redirect or c.resource is distinct from p_resource or c.challenge is distinct from p_challenge or c.expires_at<=now() then return '{"error":"invalid_grant"}'; end if;
 if c.used_at is not null then
   update public.remy_mcp_families set revoked_at=now() where id=c.family;
   perform public.remy_mcp_bump_guard(c.owner);
   return '{"error":"invalid_grant"}';
 end if;
 select * into g from public.remy_mcp_grants where owner=c.owner and client_id=c.client_id and version=c.grant_version and revoked_at is null;
 if not found or not exists(select 1 from public.remy_mcp_clients where client_id=c.client_id and owner=c.owner and enabled and resource=p_resource and p_redirect=any(redirect_uris)) then return '{"error":"invalid_grant"}'; end if;
 insert into public.remy_mcp_families(id,owner,client_id,grant_version) values(p_family,c.owner,c.client_id,c.grant_version);
 insert into public.remy_mcp_tokens(hash,family,kind,scopes,resource,expires_at) values(p_access_hash,p_family,'access',c.scopes,c.resource,now()+interval '10 minutes'),(p_refresh_hash,p_family,'refresh',c.scopes,c.resource,now()+interval '30 days');
 update public.remy_mcp_codes set used_at=now(),family=p_family where hash=p_code_hash;
 return jsonb_build_object('scope',array_to_string(c.scopes,' '),'expires_in',600);
end $$;
-- Refresh tokens rotate once. Reuse revokes all descendants of that family.
create function public.remy_mcp_refresh_token(
  p_client uuid,p_refresh_hash text,p_resource text,p_access_hash text,p_next_refresh_hash text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare t public.remy_mcp_tokens;f public.remy_mcp_families;
begin
 select * into t from public.remy_mcp_tokens where hash=p_refresh_hash and kind='refresh';
 if not found then return '{"error":"invalid_grant"}'; end if;
 select * into f from public.remy_mcp_families where id=t.family;
 perform public.remy_assert_writable(f.owner,null);
 select * into t from public.remy_mcp_tokens where hash=p_refresh_hash for update;
 select * into f from public.remy_mcp_families where id=t.family for update;
 if f.client_id is distinct from p_client or t.resource is distinct from p_resource or f.revoked_at is not null or f.expires_at<=now() or t.expires_at<=now() then return '{"error":"invalid_grant"}'; end if;
 if t.used_at is not null then
   update public.remy_mcp_families set revoked_at=now() where id=f.id;
   perform public.remy_mcp_bump_guard(f.owner);
   return '{"error":"invalid_grant"}';
 end if;
 if not exists(select 1 from public.remy_mcp_grants where owner=f.owner and client_id=f.client_id and version=f.grant_version and revoked_at is null) or not exists(select 1 from public.remy_mcp_clients where client_id=f.client_id and enabled and resource=p_resource) then return '{"error":"invalid_grant"}'; end if;
 update public.remy_mcp_tokens set used_at=now() where hash=p_refresh_hash;
 insert into public.remy_mcp_tokens(hash,family,kind,scopes,resource,expires_at) values(p_access_hash,f.id,'access',t.scopes,t.resource,least(f.expires_at,now()+interval '10 minutes')),(p_next_refresh_hash,f.id,'refresh',t.scopes,t.resource,f.expires_at);
 return jsonb_build_object('scope',array_to_string(t.scopes,' '),'expires_in',least(600,greatest(0,floor(extract(epoch from(f.expires_at-now()))))));
end $$;
-- Validate current access and capture the write guard under the SAME owner lock.
-- Callers must use this returned guard, never capture a newer guard afterwards.
create function public.remy_mcp_authorize_token(p_hash text,p_resource text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare t public.remy_mcp_tokens;f public.remy_mcp_families;captured_guard jsonb;
begin
 select * into t from public.remy_mcp_tokens where hash=p_hash and kind='access';
 if not found then return null; end if;
 select * into f from public.remy_mcp_families where id=t.family;
 perform public.remy_assert_owner(f.owner);
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(f.owner::text,0));
 select * into t from public.remy_mcp_tokens where hash=p_hash;
 select * into f from public.remy_mcp_families where id=t.family;
 if t.expires_at<=now() or t.resource<>p_resource or f.revoked_at is not null or f.expires_at<=now() then return null; end if;
 if not exists(select 1 from public.remy_mcp_grants where owner=f.owner and client_id=f.client_id and version=f.grant_version and revoked_at is null) or not exists(select 1 from public.remy_mcp_clients where client_id=f.client_id and owner=f.owner and enabled and resource=p_resource) then return null; end if;
 captured_guard:=public.remy_operation_state(f.owner,'remy-mcp');
 if coalesce((captured_guard->>'disabled')::boolean,true) then return null; end if;
 return jsonb_build_object('owner',f.owner,'client_id',f.client_id,'scopes',t.scopes,'guard',captured_guard);
end $$;
create function public.remy_mcp_revoke_token(p_client uuid,p_hash text)
returns void language plpgsql security definer set search_path='' as $$
declare f public.remy_mcp_families;
begin
 select f0.* into f from public.remy_mcp_families f0 join public.remy_mcp_tokens t on t.family=f0.id where t.hash=p_hash and f0.client_id=p_client;
 if not found then return; end if;
 perform public.remy_mcp_bump_guard(f.owner);
 update public.remy_mcp_families set revoked_at=now() where id=f.id;
end $$;
create function public.remy_mcp_revoke_grant(p_owner uuid,p_client uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
 perform public.remy_mcp_bump_guard(p_owner);
 update public.remy_mcp_grants set revoked_at=now(),version=version+1 where owner=p_owner and client_id=p_client;
 update public.remy_mcp_families set revoked_at=now() where owner=p_owner and client_id=p_client;
end $$;
revoke all on function public.remy_mcp_bump_guard(uuid,boolean),public.remy_mcp_begin_authorization(uuid,uuid,text,text,text[],text,text),public.remy_mcp_decide_authorization(uuid,uuid,boolean,text),public.remy_mcp_exchange_code(uuid,text,text,text,text,text,text,uuid),public.remy_mcp_refresh_token(uuid,text,text,text,text),public.remy_mcp_authorize_token(text,text),public.remy_mcp_revoke_token(uuid,text),public.remy_mcp_revoke_grant(uuid,uuid) from public,anon,authenticated;
grant execute on function public.remy_mcp_begin_authorization(uuid,uuid,text,text,text[],text,text),public.remy_mcp_decide_authorization(uuid,uuid,boolean,text),public.remy_mcp_exchange_code(uuid,text,text,text,text,text,text,uuid),public.remy_mcp_refresh_token(uuid,text,text,text,text),public.remy_mcp_authorize_token(text,text),public.remy_mcp_revoke_token(uuid,text),public.remy_mcp_revoke_grant(uuid,uuid) to service_role;
-- Deletion also revokes plugin credentials; fresh requests cannot repopulate data.
create or replace function public.remy_begin_delete(p_owner uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
 perform public.remy_assert_owner(p_owner); perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_owner::text,0));
 insert into public.remy_journals(owner,deleting,generation,disabled_sources) values(p_owner,true,2,'{"whoop":true,"strava":true,"tredict":true,"runna":true,"remy-mcp":true}') on conflict(owner) do update set deleting=true,generation=public.remy_journals.generation+1,disabled_sources=public.remy_journals.disabled_sources||'{"whoop":true,"strava":true,"tredict":true,"runna":true,"remy-mcp":true}'::jsonb;
 update public.remy_mcp_grants set revoked_at=now(),version=version+1 where owner=p_owner;
 update public.remy_mcp_families set revoked_at=now() where owner=p_owner;
end $$;
