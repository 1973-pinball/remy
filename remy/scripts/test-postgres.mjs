// Isolated PostgreSQL validation. Uses no hosted database or credentials.
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';

const db=new PGlite();
try {
  // Minimal Supabase-owned schemas; the application migration is applied intact.
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema storage;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql as
      'select nullif(current_setting(''request.jwt.claim.sub'',true),'''')::uuid';
    create function auth.role() returns text language sql as
      'select current_setting(''request.jwt.claim.role'',true)';
    grant usage on schema auth to authenticated,anon,service_role;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid,name text,bucket_id text);
    alter table storage.objects enable row level security;
    create function storage.foldername(text) returns text[] language sql as 'select string_to_array($1,''/'')';
  `);
  await db.exec(await readFile(new URL('../supabase/migrations/202610070001_remy.sql',import.meta.url),'utf8'));
  const owner='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002';
  await db.query('insert into auth.users(id) values($1),($2)',[owner,other]);
  await db.query("select set_config('request.jwt.claim.role','service_role',false)");
  async function save(user,id,calories,revision=null,guard=null){
    const result=await db.query('select public.remy_save_entry($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) as saved',
      [user,id,'meal','2026-10-07','manual',id,JSON.stringify({calories}),revision,false,guard]);
    return result.rows[0].saved;
  }
  assert.equal((await save(owner,'lunch',450)).entry.revision,1);
  const replay=await save(owner,'lunch',450);
  assert.equal(replay.duplicate,true);assert.equal(replay.entry.revision,1);
  assert.equal((await save(owner,'lunch',550,1)).entry.revision,2);
  await assert.rejects(()=>save(owner,'lunch',600,1),/REMY_CONFLICT/);
  assert.equal((await db.query('select count(*)::int as n from remy_revisions')).rows[0].n,1);
  const undone=(await db.query('select public.remy_undo_entry($1,$2,$3) as saved',[owner,'lunch',2])).rows[0].saved;
  assert.equal(undone.entry.data.calories,450);assert.equal(undone.entry.revision,3);
  const batch=[{id:'dinner',kind:'meal',localDate:'2026-10-07',source:'manual',sourceId:'dinner',data:{calories:700}},
    {id:'lunch',kind:'meal',localDate:'2026-10-07',data:{calories:800},expectedRevision:1}];
  await assert.rejects(()=>db.query('select remy_save_entries($1,$2)',[owner,JSON.stringify(batch)]),/REMY_CONFLICT/);
  assert.equal((await db.query("select count(*)::int as n from remy_records where id='dinner'")).rows[0].n,0,'Batch failure must roll back earlier writes');
  batch[1].expectedRevision=3;
  await db.query('select remy_save_entries($1,$2)',[owner,JSON.stringify(batch)]);
  assert.equal((await db.query("select data from remy_records where id='dinner'")).rows[0].data.calories,700);
  await save(other,'lunch',999);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);
  await db.query("select set_config('request.jwt.claim.role','authenticated',false)");
  await db.exec('set role authenticated');
  const visible=(await db.query('select owner from remy_records')).rows;
  assert.equal(visible.length,2);assert.ok(visible.every(row=>row.owner===owner));
  await assert.rejects(()=>db.query('select * from remy_secrets'),/permission denied/);
  await assert.rejects(()=>save(other,'attack',1),/permission denied/);
  await assert.rejects(()=>db.query('select remy_operation_state($1,$2)',[owner,'whoop']),/permission denied/);
  await assert.rejects(()=>db.query('select remy_disconnect_source($1,$2)',[owner,'whoop']),/permission denied/);
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.role','service_role',false)");
  const lock1='20000000-0000-4000-8000-000000000001',lock2='20000000-0000-4000-8000-000000000002';
  assert.equal((await db.query('select remy_acquire_lock($1,$2,$3,$4) as ok',[owner,'whoop',lock1,120])).rows[0].ok,true);
  assert.equal((await db.query('select remy_acquire_lock($1,$2,$3,$4) as ok',[owner,'whoop',lock2,120])).rows[0].ok,false);
  await db.query('select remy_release_lock($1,$2,$3)',[owner,'whoop',lock2]);
  assert.equal((await db.query('select count(*)::int as n from remy_locks')).rows[0].n,1);
  await db.exec("update remy_locks set expires_at=now()-interval '1 second'");
  assert.equal((await db.query('select remy_acquire_lock($1,$2,$3,$4) as ok',[owner,'whoop',lock2,120])).rows[0].ok,true);
  await db.query('select remy_release_lock($1,$2,$3)',[owner,'whoop',lock1]);
  assert.equal((await db.query('select token from remy_locks')).rows[0].token,lock2,'Expired owner cannot release a new lease');
  async function state(provider=null){return (await db.query('select remy_operation_state($1,$2) as guard',[owner,provider])).rows[0].guard;}
  const beforeDisconnect=await state('whoop');
  await db.query('select remy_write_secret($1,$2,$3,$4)',[owner,'whoop','encrypted-test-only',beforeDisconnect]);
  await db.query('select remy_disconnect_source($1,$2,$3)',[owner,'whoop',beforeDisconnect]);
  const disconnected=await state('whoop');
  assert.equal(disconnected.version,beforeDisconnect.version+1);assert.equal(disconnected.disabled,true);
  assert.equal((await db.query('select count(*)::int as n from remy_secrets where owner=$1',[owner])).rows[0].n,0);
  assert.equal((await db.query("select data from remy_records where owner=$1 and id='connection:whoop'",[owner])).rows[0].data.disconnected,true);
  await assert.rejects(()=>save(owner,'stale-sync',10,null,beforeDisconnect),/REMY_STALE_OPERATION/);
  await assert.rejects(()=>db.query('select remy_write_secret($1,$2,$3,$4)',[owner,'whoop','stale-refresh',beforeDisconnect]),/REMY_STALE_OPERATION/);
  await assert.rejects(()=>db.query('select remy_enable_source($1,$2,$3)',[owner,'whoop',beforeDisconnect]),/REMY_STALE_OPERATION/);
  // A deliberate reconnect must not make any old request valid again.
  await db.query('select remy_enable_source($1,$2,$3)',[owner,'whoop',disconnected]);
  assert.equal((await state('whoop')).disabled,false);
  await assert.rejects(()=>save(owner,'stale-after-reconnect',10,null,beforeDisconnect),/REMY_STALE_OPERATION/);
  await db.query('select remy_write_secret($1,$2,$3,$4)',[owner,'whoop','new-connection',disconnected]);
  const beforeDelete=await state();
  await db.query('select remy_begin_delete($1)',[owner]);
  await assert.rejects(()=>save(owner,'new',1),/REMY_DELETING/);
  await db.query('select remy_finish_delete($1)',[owner]);
  assert.equal((await db.query('select count(*)::int as n from remy_records where owner=$1',[owner])).rows[0].n,0);
  assert.equal((await db.query('select count(*)::int as n from remy_revisions where owner=$1',[owner])).rows[0].n,0);
  assert.equal((await db.query('select count(*)::int as n from remy_records where owner=$1',[other])).rows[0].n,1);
  // Simulate a provider response arriving only after deletion has finished.
  await assert.rejects(()=>save(owner,'late-manual',1,null,beforeDelete),/REMY_STALE_OPERATION/);
  await assert.rejects(()=>save(owner,'late-sync',1,null,disconnected),/REMY_STALE_OPERATION/);
  await assert.rejects(()=>db.query('select remy_write_secret($1,$2,$3,$4)',[owner,'whoop','late-refresh',disconnected]),/REMY_STALE_OPERATION/);
  await assert.rejects(()=>db.query('select remy_enable_source($1,$2,$3)',[owner,'whoop',disconnected]),/REMY_STALE_OPERATION/);
  const afterDelete=await state('whoop');assert.equal(afterDelete.generation,beforeDelete.generation+1);
  assert.equal(afterDelete.disabled,true,'Delete keeps environment-backed sources disabled until explicit enable');
  await assert.rejects(()=>db.query('select remy_save_entries($1,$2)',[owner,JSON.stringify([
    {id:'new-batch',kind:'recovery',localDate:'2026-10-07',data:{strain:10},guard:afterDelete},
    {id:'stale-batch',kind:'recovery',localDate:'2026-10-07',data:{strain:11},guard:disconnected}
  ])]),/REMY_STALE_OPERATION/);
  assert.equal((await db.query('select count(*)::int as n from remy_records where owner=$1',[owner])).rows[0].n,0,'Late batch rolls back without resurrecting journal rows');
  assert.equal((await db.query('select count(*)::int as n from remy_secrets where owner=$1',[owner])).rows[0].n,0);
  await save(owner,'intentional-new-meal',200,null,await state());
  assert.equal((await db.query("select public from storage.buckets where id='remy-files'")).rows[0].public,false);
  console.log('PostgreSQL migration verified: revisions, replay, batch rollback, undo, owner RLS, secret isolation, token-safe leases, stale deletion/disconnect/reconnect guards, private bucket.');
} finally { await db.close(); }
