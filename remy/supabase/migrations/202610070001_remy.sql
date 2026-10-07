-- Run once against a new Supabase project. All application rows are owner scoped.
create table public.remy_records (
  owner uuid not null references auth.users(id) on delete cascade,
  id text not null, kind text not null check (kind in ('profile','meal','workout','plan','recovery','day','connection','import','message','proposal','savedMeal')),
  local_date date, source text not null, source_id text not null,
  revision integer not null default 1 check (revision>0), updated_at timestamptz not null default now(),
  data jsonb not null, deleted boolean not null default false,
  primary key(owner,id), unique(owner,kind,source,source_id)
);
create index remy_records_owner_date on public.remy_records(owner,local_date desc);
create table public.remy_revisions(owner uuid not null,record_id text not null,revision integer not null,snapshot jsonb not null,created_at timestamptz not null default now(),primary key(owner,record_id,revision),foreign key(owner,record_id) references public.remy_records(owner,id) on delete cascade);
create table public.remy_secrets(owner uuid not null references auth.users(id) on delete cascade,provider text not null,ciphertext text not null,updated_at timestamptz not null default now(),primary key(owner,provider));
create table public.remy_locks(owner uuid not null references auth.users(id) on delete cascade,provider text not null,token uuid not null,expires_at timestamptz not null,primary key(owner,provider));
create table public.remy_journals(owner uuid primary key references auth.users(id) on delete cascade,generation bigint not null default 1,deleting boolean not null default false,source_versions jsonb not null default '{}',disabled_sources jsonb not null default '{}');
alter table public.remy_records enable row level security;
alter table public.remy_revisions enable row level security;
alter table public.remy_secrets enable row level security;
alter table public.remy_locks enable row level security;
alter table public.remy_journals enable row level security;
create policy remy_records_read_own on public.remy_records for select to authenticated using (owner=(select auth.uid()));
create policy remy_revisions_read_own on public.remy_revisions for select to authenticated using (owner=(select auth.uid()));
revoke all on public.remy_records,public.remy_revisions,public.remy_secrets,public.remy_locks,public.remy_journals from anon,authenticated;
grant select on public.remy_records,public.remy_revisions to authenticated;
grant all on public.remy_records,public.remy_revisions,public.remy_secrets,public.remy_locks,public.remy_journals to service_role;

create function public.remy_assert_owner(p_owner uuid) returns void language plpgsql security invoker set search_path='' as $$
begin
 if p_owner is null or (coalesce(auth.role(),'')<>'service_role' and auth.uid() is distinct from p_owner) then raise exception 'REMY_FORBIDDEN'; end if;
end $$;

-- An operation captures this state before any external I/O. Mutations compare it
-- while holding the same owner lock used by deletion and source invalidation.
create function public.remy_operation_state(p_owner uuid,p_provider text default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare state public.remy_journals;
begin
 perform public.remy_assert_owner(p_owner);
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_owner::text,0));
 insert into public.remy_journals(owner) values(p_owner) on conflict do nothing;
 select * into state from public.remy_journals where owner=p_owner;
 if state.deleting then raise exception 'REMY_DELETING'; end if;
 return jsonb_build_object('generation',state.generation,'provider',p_provider,'version',case when p_provider is null then null else coalesce((state.source_versions->>p_provider)::bigint,0) end,'versions',state.source_versions,'disabled',coalesce((state.disabled_sources->>p_provider)::boolean,false));
end $$;
create function public.remy_assert_writable(p_owner uuid,p_guard jsonb) returns void language plpgsql security definer set search_path='' as $$
declare state public.remy_journals;
begin
 perform public.remy_assert_owner(p_owner);
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_owner::text,0));
 select * into state from public.remy_journals where owner=p_owner;
 if state.deleting then raise exception 'REMY_DELETING'; end if;
 if p_guard is not null then
  if (p_guard->>'generation')::bigint is distinct from coalesce(state.generation,1) then raise exception 'REMY_STALE_OPERATION'; end if;
  if p_guard->>'provider' is not null and (p_guard->>'version')::bigint is distinct from coalesce((state.source_versions->>(p_guard->>'provider'))::bigint,0) then raise exception 'REMY_STALE_OPERATION'; end if;
 end if;
end $$;

create function public.remy_save_entry(p_owner uuid,p_id text,p_kind text,p_local_date date,p_source text,p_source_id text,p_data jsonb,p_expected_revision integer,p_deleted boolean,p_guard jsonb default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare prior public.remy_records; saved public.remy_records; chosen_source text; chosen_source_id text;
begin
 perform public.remy_assert_writable(p_owner,p_guard);
 select * into prior from public.remy_records where owner=p_owner and id=p_id for update;
 if found and prior.kind<>p_kind then raise exception 'REMY_KIND_MISMATCH'; end if;
 chosen_source:=coalesce(p_source,prior.source,'manual'); chosen_source_id:=coalesce(p_source_id,prior.source_id,p_id);
 if prior.id is null then select * into prior from public.remy_records where owner=p_owner and kind=p_kind and source=chosen_source and source_id=chosen_source_id for update; end if;
 if prior.id is not null then
  if p_expected_revision is not null and prior.revision<>p_expected_revision then raise exception 'REMY_CONFLICT'; end if;
  if prior.data=p_data and prior.local_date is not distinct from p_local_date and prior.deleted=p_deleted then return jsonb_build_object('entry',to_jsonb(prior),'duplicate',true); end if;
  insert into public.remy_revisions(owner,record_id,revision,snapshot) values(p_owner,prior.id,prior.revision,to_jsonb(prior));
  update public.remy_records set local_date=p_local_date,data=p_data,revision=revision+1,updated_at=clock_timestamp(),deleted=p_deleted where owner=p_owner and id=prior.id returning * into saved;
 else
  if p_expected_revision is not null then raise exception 'REMY_CONFLICT'; end if;
  insert into public.remy_records(owner,id,kind,local_date,source,source_id,data,deleted) values(p_owner,p_id,p_kind,p_local_date,chosen_source,chosen_source_id,p_data,p_deleted) returning * into saved;
 end if;
 return jsonb_build_object('entry',to_jsonb(saved),'duplicate',false);
end $$;

create function public.remy_undo_entry(p_owner uuid,p_id text,p_expected_revision integer,p_guard jsonb default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare current_row public.remy_records; prior jsonb;
begin
 perform public.remy_assert_writable(p_owner,p_guard);
 select * into current_row from public.remy_records where owner=p_owner and id=p_id for update;
 if not found or current_row.revision<>p_expected_revision then raise exception 'REMY_CONFLICT'; end if;
 select snapshot into prior from public.remy_revisions where owner=p_owner and record_id=p_id order by revision desc limit 1;
 if prior is null then return public.remy_save_entry(p_owner,p_id,current_row.kind,current_row.local_date,current_row.source,current_row.source_id,current_row.data,p_expected_revision,true); end if;
 return public.remy_save_entry(p_owner,p_id,current_row.kind,(prior->>'local_date')::date,current_row.source,current_row.source_id,prior->'data',p_expected_revision,(prior->>'deleted')::boolean);
end $$;

create function public.remy_save_entries(p_owner uuid,p_entries jsonb) returns void language plpgsql security definer set search_path='' as $$
declare item jsonb;
begin
 perform public.remy_assert_owner(p_owner);
 if jsonb_typeof(p_entries)<>'array' or jsonb_array_length(p_entries)>200 then raise exception 'REMY_INVALID_BATCH'; end if;
 for item in select * from jsonb_array_elements(p_entries) loop
  perform public.remy_save_entry(p_owner,item->>'id',item->>'kind',(item->>'localDate')::date,item->>'source',item->>'sourceId',item->'data',(item->>'expectedRevision')::integer,coalesce((item->>'deleted')::boolean,false),item->'guard');
 end loop;
end $$;
revoke execute on function public.remy_save_entries(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.remy_save_entries(uuid,jsonb) to service_role;

create function public.remy_journal_state(p_owner uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare state public.remy_journals;
begin perform public.remy_assert_owner(p_owner); insert into public.remy_journals(owner) values(p_owner) on conflict do nothing; select * into state from public.remy_journals where owner=p_owner; return to_jsonb(state); end $$;
create function public.remy_begin_delete(p_owner uuid) returns void language plpgsql security definer set search_path='' as $$
begin perform public.remy_assert_owner(p_owner); perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_owner::text,0)); insert into public.remy_journals(owner,deleting,generation,disabled_sources) values(p_owner,true,2,'{"whoop":true,"strava":true,"tredict":true,"runna":true}') on conflict(owner) do update set deleting=true,generation=public.remy_journals.generation+1,disabled_sources=public.remy_journals.disabled_sources||'{"whoop":true,"strava":true,"tredict":true,"runna":true}'::jsonb; end $$;
create function public.remy_finish_delete(p_owner uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 perform public.remy_assert_owner(p_owner); perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_owner::text,0));
 if not exists(select 1 from public.remy_journals where owner=p_owner and deleting) then raise exception 'REMY_DELETE_NOT_STARTED'; end if;
 delete from public.remy_records where owner=p_owner; delete from public.remy_secrets where owner=p_owner; delete from public.remy_locks where owner=p_owner;
 update public.remy_journals set deleting=false where owner=p_owner;
end $$;
create function public.remy_write_secret(p_owner uuid,p_provider text,p_ciphertext text,p_guard jsonb default null) returns void language plpgsql security definer set search_path='' as $$
begin
 perform public.remy_assert_writable(p_owner,p_guard);
 insert into public.remy_secrets(owner,provider,ciphertext) values(p_owner,p_provider,p_ciphertext) on conflict(owner,provider) do update set ciphertext=excluded.ciphertext,updated_at=clock_timestamp();
end $$;
create function public.remy_disconnect_source(p_owner uuid,p_provider text,p_guard jsonb default null) returns void language plpgsql security definer set search_path='' as $$
declare prior public.remy_records;
begin
 perform public.remy_assert_writable(p_owner,p_guard);
 insert into public.remy_journals(owner) values(p_owner) on conflict do nothing;
 update public.remy_journals set source_versions=jsonb_set(source_versions,array[p_provider],to_jsonb(coalesce((source_versions->>p_provider)::bigint,0)+1)),disabled_sources=jsonb_set(disabled_sources,array[p_provider],'true') where owner=p_owner;
 delete from public.remy_secrets where owner=p_owner and provider in(p_provider,p_provider||'-state');
 select * into prior from public.remy_records where owner=p_owner and id='connection:'||p_provider;
 perform public.remy_save_entry(p_owner,'connection:'||p_provider,'connection',null,null,null,coalesce(prior.data,'{}'::jsonb)||jsonb_build_object('provider',p_provider,'disconnected',true,'authorized',false,'error',null),null,false);
end $$;
create function public.remy_enable_source(p_owner uuid,p_provider text,p_guard jsonb) returns void language plpgsql security definer set search_path='' as $$
begin
 perform public.remy_assert_writable(p_owner,p_guard);
 insert into public.remy_journals(owner) values(p_owner) on conflict do nothing;
 update public.remy_journals set disabled_sources=jsonb_set(disabled_sources,array[p_provider],'false') where owner=p_owner;
end $$;
create function public.remy_delete_secret(p_owner uuid,p_provider text,p_guard jsonb default null) returns void language plpgsql security definer set search_path='' as $$
begin perform public.remy_assert_writable(p_owner,p_guard); delete from public.remy_secrets where owner=p_owner and provider=p_provider; end $$;
create function public.remy_acquire_lock(p_owner uuid,p_provider text,p_token uuid,p_seconds integer) returns boolean language plpgsql security definer set search_path='' as $$
declare acquired integer;
begin
 perform public.remy_assert_owner(p_owner);
 insert into public.remy_locks(owner,provider,token,expires_at) values(p_owner,p_provider,p_token,now()+make_interval(secs=>least(greatest(p_seconds,1),300))) on conflict(owner,provider) do update set token=excluded.token,expires_at=excluded.expires_at where public.remy_locks.expires_at<now();
 get diagnostics acquired=row_count; return acquired=1;
end $$;
create function public.remy_release_lock(p_owner uuid,p_provider text,p_token uuid) returns void language plpgsql security definer set search_path='' as $$
begin perform public.remy_assert_owner(p_owner); delete from public.remy_locks where owner=p_owner and provider=p_provider and token=p_token; end $$;

-- No public RPC may mutate the journal. The app verifies a Supabase user first.
revoke execute on function public.remy_enable_source(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.remy_enable_source(uuid,text,jsonb) to service_role;
revoke execute on function public.remy_assert_owner(uuid),public.remy_assert_writable(uuid,jsonb),public.remy_operation_state(uuid,text),public.remy_save_entry(uuid,text,text,date,text,text,jsonb,integer,boolean,jsonb),public.remy_undo_entry(uuid,text,integer,jsonb),public.remy_journal_state(uuid),public.remy_begin_delete(uuid),public.remy_finish_delete(uuid),public.remy_write_secret(uuid,text,text,jsonb),public.remy_delete_secret(uuid,text,jsonb),public.remy_disconnect_source(uuid,text,jsonb),public.remy_acquire_lock(uuid,text,uuid,integer),public.remy_release_lock(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.remy_assert_owner(uuid),public.remy_assert_writable(uuid,jsonb),public.remy_operation_state(uuid,text),public.remy_save_entry(uuid,text,text,date,text,text,jsonb,integer,boolean,jsonb),public.remy_undo_entry(uuid,text,integer,jsonb),public.remy_journal_state(uuid),public.remy_begin_delete(uuid),public.remy_finish_delete(uuid),public.remy_write_secret(uuid,text,text,jsonb),public.remy_delete_secret(uuid,text,jsonb),public.remy_disconnect_source(uuid,text,jsonb),public.remy_acquire_lock(uuid,text,uuid,integer),public.remy_release_lock(uuid,text,uuid) to service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('remy-files','remy-files',false,10485760,array['text/plain','application/json','application/octet-stream','image/jpeg','image/png','image/webp']) on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
create policy remy_files_read_own on storage.objects for select to authenticated using(bucket_id='remy-files' and (storage.foldername(name))[1]=(select auth.uid())::text);
-- Upload/remove are server-only so journal deletion can also clear private files.
