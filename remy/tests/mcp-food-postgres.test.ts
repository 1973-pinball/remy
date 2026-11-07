import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('MCP food transactions compare complete food snapshots, reject stale/deleted writes and enforce role/guard boundaries', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create schema storage;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql as 'select nullif(current_setting(''request.jwt.claim.sub'',true),'''')::uuid';
      create function auth.role() returns text language sql as 'select current_setting(''request.jwt.claim.role'',true)';
      grant usage on schema auth to authenticated,anon,service_role;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid,name text,bucket_id text);
      alter table storage.objects enable row level security;
      create function storage.foldername(text) returns text[] language sql as 'select string_to_array($1,''/'')';
    `);
    for (const migration of ['202610070001_remy.sql', '202610200001_daily_summaries.sql', '202611070002_mcp_food_snapshot.sql'])
      await db.exec(await readFile(new URL(`../supabase/migrations/${migration}`, import.meta.url), 'utf8'));
    const owner = '10000000-0000-4000-8000-000000000001', other = '20000000-0000-4000-8000-000000000001';
    const requestId = '10000000-0000-4000-8000-000000000002';
    const proposalId = `mcp-food-proposal:${requestId}`, mealId = `mcp-food-meal:${requestId}`;
    await db.query('insert into auth.users(id) values($1),($2)', [owner, other]);
    await db.query("select set_config('request.jwt.claim.role','service_role',false)");
    await db.exec('set role service_role');
    const guard = (await db.query<{ guard: Record<string, unknown> }>('select remy_operation_state($1,$2) as guard', [owner, 'remy-mcp'])).rows[0].guard;
    const write = (id: string, kind: string, data: object, extra: object = {}) => ({ id, kind, data, guard,
      localDate: '2026-11-06', source: 'remy-chatgpt', sourceId: id, ...extra });
    const batch = (inputs: unknown[], snapshot: unknown = null, user = owner) =>
      db.query('select remy_mcp_save_entries($1,$2,$3)', [user, JSON.stringify(inputs), snapshot === null ? null : JSON.stringify(snapshot)]);
    const appSave = (id: string, kind: string, data: object, deleted = false, user = owner) =>
      db.query('select remy_save_entry($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
        [user, id, kind, '2026-11-06', 'manual', id, JSON.stringify(data), null, deleted, null]);
    const snapshot = async () => (await db.query<{ snapshot: Record<string, number> }>(
      "select coalesce(jsonb_object_agg(id,revision),'{}'::jsonb) as snapshot from remy_records where owner=$1 and kind in('meal','dailySummary')", [owner])).rows[0].snapshot;
    const pending = write(proposalId, 'proposal', { mode: 'mcp-food', status: 'pending' });
    await batch([pending]);
    const initial = await snapshot();
    const saving = [write(mealId, 'meal', { calories: 500 }), write(proposalId, 'proposal', { mode: 'mcp-food', status: 'saved' }, { expectedRevision: 1 })];

    // A different source writes after the service read; the plugin cannot commit
    // its previously reviewed snapshot even when it has a distinct source ID.
    await appSave('concurrent-app-meal', 'meal', { calories: 500 });
    await assert.rejects(batch(saving, initial), /REMY_FOOD_SNAPSHOT_CONFLICT/);
    assert.equal((await db.query<{ n: number }>('select count(*)::int as n from remy_records where id=$1', [mealId])).rows[0].n, 0);
    assert.equal((await db.query<{ data: { status: string } }>('select data from remy_records where id=$1', [proposalId])).rows[0].data.status, 'pending');
    await assert.rejects(batch(saving), /REMY_FOOD_SNAPSHOT_CONFLICT/);

    // Historical summaries and tombstones are part of the comparison too.
    const beforeHistory = await snapshot();
    await appSave('historical-day', 'dailySummary', { calories: 2000 });
    await assert.rejects(batch(saving, beforeHistory), /REMY_FOOD_SNAPSHOT_CONFLICT/);
    const beforeDelete = await snapshot();
    await appSave('concurrent-app-meal', 'meal', { calories: 500 }, true);
    await assert.rejects(batch(saving, beforeDelete), /REMY_FOOD_SNAPSHOT_CONFLICT/);
    const complete = await snapshot();
    assert.equal(complete['concurrent-app-meal'], 2);
    assert.equal(complete['historical-day'], 1);
    // Another user's food and same-owner non-food context do not invalidate it.
    await appSave('other-meal', 'meal', { calories: 999 }, false, other);
    await appSave('whoop-context', 'recovery', { strain: 10 });
    await batch(saving, complete);
    assert.equal((await db.query<{ data: { status: string } }>('select data from remy_records where id=$1', [proposalId])).rows[0].data.status, 'saved');

    // A bad final proposal revision rolls back the preceding meal correction.
    const beforeCorrection = await snapshot();
    await assert.rejects(batch([write(mealId, 'meal', { calories: 600 }, { expectedRevision: 1 }),
      write(proposalId, 'proposal', { mode: 'mcp-food', status: 'saved', test: true }, { expectedRevision: 1 })], beforeCorrection), /REMY_CONFLICT/);
    assert.equal((await db.query<{ data: { calories: number } }>('select data from remy_records where id=$1', [mealId])).rows[0].data.calories, 500);
    await assert.rejects(batch([write(mealId, 'meal', { calories: 600 })], beforeCorrection), /REMY_CONFLICT/);
    await assert.rejects(batch([write('concurrent-app-meal', 'meal', { calories: 600 }, { expectedRevision: 2 })], beforeCorrection), /REMY_MCP_DELETED/);
    await assert.rejects(batch([write('unsafe', 'profile', {})]), /REMY_INVALID_MCP_BATCH/);
    await assert.rejects(batch([{ ...pending, guard: { ...guard, provider: 'strava' } }]), /REMY_INVALID_MCP_BATCH/);
    await assert.rejects(batch([{ ...pending, guard: null }]), /REMY_INVALID_MCP_BATCH/);

    await db.query('select remy_disconnect_source($1,$2,$3)', [owner, 'remy-mcp', guard]);
    await assert.rejects(batch([pending]), /REMY_MCP_DISABLED/);
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.role','authenticated',false)");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]);
    await db.exec('set role authenticated');
    await assert.rejects(batch([pending]), /permission denied/);
    await db.exec('reset role; set role anon');
    await assert.rejects(batch([pending]), /permission denied/);
  } finally { await db.close(); }
});
