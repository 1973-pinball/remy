import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const owner = '10000000-0000-4000-8000-000000000001', otherOwner = '10000000-0000-4000-8000-000000000002';
const client = '20000000-0000-4000-8000-000000000001', otherClient = '20000000-0000-4000-8000-000000000002';
const resource = 'https://remy.example.com/api/mcp', redirect = 'https://chatgpt.com/connector/oauth/synthetic';
const scopes = ['diet:read', 'diet:write'];
const challenge = createHash('sha256').update('synthetic-verifier'.repeat(4)).digest('base64url');
const hash = () => createHash('sha256').update(randomUUID()).digest('hex');
type TokenResult = { error?: string; scope?: string; expires_in?: number };
type Identity = { owner: string; client_id: string; scopes: string[]; guard: Record<string, unknown> };

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema storage;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql as 'select nullif(current_setting(''request.jwt.claim.sub'',true),'''')::uuid';
    create function auth.role() returns text language sql as 'select current_setting(''request.jwt.claim.role'',true)';
    grant usage on schema auth,storage to authenticated,anon,service_role;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid,name text,bucket_id text);
    alter table storage.objects enable row level security;
    create function storage.foldername(text) returns text[] language sql as 'select string_to_array($1,''/'')';
  `);
  for (const file of ['202610070001_remy.sql', '202611070001_mcp_auth.sql', '202611070002_mcp_food_snapshot.sql'])
    await db.exec(await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8'));
  await db.query('insert into auth.users values($1),($2)', [owner, otherOwner]);
  await db.query('insert into remy_mcp_clients(client_id,owner,name,resource,redirect_uris,enabled) values($1,$2,$3,$4,$5,true),($6,$7,$3,$4,$5,true)',
    [client, owner, 'Synthetic test client', resource, [redirect], otherClient, otherOwner]);
  await db.query("select set_config('request.jwt.claim.role','service_role',false)");
  await db.exec('set role service_role');
  const rpc = async <T = unknown>(name: string, args: unknown[]) => (await db.query<{ result: T }>(
    `select ${name}(${args.map((_, index) => `$${index + 1}`).join(',')}) as result`, args)).rows[0].result;
  const begin = async (overrides: Record<string, unknown> = {}) => {
    const request = { id: randomUUID(), client, redirect, resource, scopes, state: 'opaque state & + unicode ✓', challenge, ...overrides };
    await rpc('remy_mcp_begin_authorization', [request.id, request.client, request.redirect, request.resource, request.scopes, request.state, request.challenge]);
    return request;
  };
  const decide = (id: string, codeHash: string | null = hash(), approve: boolean | null = true, user = owner) =>
    rpc<{ redirect_uri: string; state: string; approved: boolean }>('remy_mcp_decide_authorization', [user, id, approve, codeHash]);
  const issueCode = async () => { const request = await begin(); const codeHash = hash(); await decide(request.id, codeHash); return { request, codeHash }; };
  const exchange = (codeHash: string, overrides: Record<string, unknown> = {}) => {
    const input = { client, codeHash, redirect, resource, challenge, access: hash(), refresh: hash(), family: randomUUID(), ...overrides };
    return rpc<TokenResult>('remy_mcp_exchange_code', [input.client, input.codeHash, input.redirect, input.resource, input.challenge, input.access, input.refresh, input.family]);
  };
  const issue = async () => {
    const { codeHash } = await issueCode(); const access = hash(), refresh = hash(), family = randomUUID();
    assert.deepEqual(await exchange(codeHash, { access, refresh, family }), { scope: scopes.join(' '), expires_in: 600 });
    return { access, refresh, family, codeHash };
  };
  const active = (access: string, target: string | null = resource) => rpc<Identity | null>('remy_mcp_authorize_token', [access, target]);
  const refresh = (token: string, overrides: Record<string, unknown> = {}) => {
    const input = { client, resource, access: hash(), nextRefresh: hash(), ...overrides };
    return rpc<TokenResult>('remy_mcp_refresh_token', [input.client, token, input.resource, input.access, input.nextRefresh]);
  };
  const save = (guard: Record<string, unknown>) => rpc('remy_mcp_save_entries', [owner, JSON.stringify([
    { id: `mcp-food-proposal:${randomUUID()}`, kind: 'proposal', source: 'remy-chatgpt', data: { mode: 'mcp-food', status: 'pending' }, guard },
  ]), null]);
  return { db, rpc, begin, decide, issueCode, exchange, issue, active, refresh, save };
}

test('OAuth requests require exact registered destinations, scopes, owner consent and single-use unexpired approval', async () => {
  const f = await fixture();
  try {
    for (const overrides of [
      { client: randomUUID() }, { redirect: `${redirect}/other` }, { redirect: `${redirect}?next=attacker` },
      { resource: 'https://attacker.invalid/api/mcp' }, { scopes: ['diet:read'] }, { scopes: [...scopes, 'admin'] },
      { scopes: null }, { state: '' }, { state: 'x'.repeat(513) }, { challenge: 'plain-verifier' },
      { state: null }, { challenge: null }, { resource: null }, { redirect: null },
    ]) await assert.rejects(f.begin(overrides), Error, JSON.stringify(overrides));
    const request = await f.begin(); const codeHash = hash();
    await assert.rejects(f.decide(request.id, codeHash, true, otherOwner), /REMY_OAUTH_CLIENT_DENIED/);
    assert.deepEqual(await f.decide(request.id, codeHash), { approved: true, redirect_uri: redirect, state: request.state });
    await assert.rejects(f.decide(request.id), /REMY_OAUTH_EXPIRED/);
    const denied = await f.begin(); const deniedHash = hash();
    assert.equal((await f.decide(denied.id, deniedHash, false)).approved, false);
    assert.equal((await f.exchange(deniedHash)).error, 'invalid_grant');
    const expired = await f.begin();
    await f.db.query("update remy_mcp_authorizations set expires_at=now()-interval '1 second' where id=$1", [expired.id]);
    await assert.rejects(f.decide(expired.id), /REMY_OAUTH_EXPIRED/);
    const disabled = await f.begin();
    await f.db.query('update remy_mcp_clients set enabled=false where client_id=$1', [client]);
    await assert.rejects(f.decide(disabled.id), /REMY_OAUTH_CLIENT_DENIED/);
  } finally { await f.db.close(); }
});

test('Code exchange binds client, resource, redirect and S256 challenge; replay revocation persists after error response', async () => {
  const f = await fixture();
  try {
    const { codeHash } = await f.issueCode();
    for (const overrides of [
      { client: otherClient }, { client: null }, { redirect: `${redirect}/other` }, { redirect: null },
      { resource: 'https://attacker.invalid/api/mcp' }, { resource: null }, { challenge: 'x'.repeat(43) }, { challenge: null },
    ]) assert.equal((await f.exchange(codeHash, overrides)).error, 'invalid_grant', JSON.stringify(overrides));
    const access = hash(), refresh = hash(), family = randomUUID();
    assert.equal((await f.exchange(codeHash, { access, refresh, family })).expires_in, 600, 'Invalid attempts must not consume the code');
    const identity = await f.active(access);
    assert.equal(identity?.owner, owner); assert.equal(identity?.client_id, client); assert.deepEqual(identity?.scopes, scopes);
    assert.equal(identity?.guard.provider, 'remy-mcp'); assert.equal(identity?.guard.disabled, false);
    assert.equal(await f.active(refresh), null, 'Refresh tokens cannot authorize data calls');
    assert.equal(await f.active(access, 'https://attacker.invalid/api/mcp'), null);
    assert.equal(await f.active(access, null), null); assert.equal(await f.active(hash()), null);
    await f.save(identity!.guard);
    assert.equal((await f.exchange(codeHash)).error, 'invalid_grant');
    assert.equal(await f.active(access), null, 'Code replay revokes previously issued family');
    assert.equal((await f.refresh(refresh)).error, 'invalid_grant');
    await assert.rejects(f.save(identity!.guard), /REMY_STALE_OPERATION/);
    const expired = await f.issueCode();
    await f.db.query("update remy_mcp_codes set expires_at=now()-interval '1 second' where hash=$1", [expired.codeHash]);
    assert.equal((await f.exchange(expired.codeHash)).error, 'invalid_grant');
  } finally { await f.db.close(); }
});

test('Refresh tokens rotate once, enforce client/resource, and replay revokes all descendants and captured write guards', async () => {
  const f = await fixture();
  try {
    const tokens = await f.issue(); const captured = (await f.active(tokens.access))!.guard;
    for (const overrides of [{ client: otherClient }, { client: null }, { resource: 'https://attacker.invalid/api/mcp' }, { resource: null }])
      assert.equal((await f.refresh(tokens.refresh, overrides)).error, 'invalid_grant', JSON.stringify(overrides));
    assert.equal((await f.refresh(tokens.access)).error, 'invalid_grant', 'Access tokens cannot refresh');
    const nextAccess = hash(), nextRefresh = hash();
    assert.equal((await f.refresh(tokens.refresh, { access: nextAccess, nextRefresh })).expires_in, 600);
    assert.equal((await f.active(nextAccess))?.owner, owner);
    assert.equal((await f.refresh(tokens.refresh)).error, 'invalid_grant');
    assert.equal(await f.active(tokens.access), null); assert.equal(await f.active(nextAccess), null);
    assert.equal((await f.refresh(nextRefresh)).error, 'invalid_grant', 'Replay revocation persists after RPC error result');
    await assert.rejects(f.save(captured), /REMY_STALE_OPERATION/);
    assert.ok((await f.db.query<{ revoked_at: string | null }>('select revoked_at from remy_mcp_families where id=$1', [tokens.family])).rows[0].revoked_at);
  } finally { await f.db.close(); }
});

test('Expiry, disabled clients and revoked grants fail closed; reconnect never revives old tokens or unexchanged codes', async () => {
  const f = await fixture();
  try {
    const expired = await f.issue();
    await f.db.query("update remy_mcp_tokens set expires_at=now()-interval '1 second' where hash=$1", [expired.access]);
    assert.equal(await f.active(expired.access), null);
    await f.db.query("update remy_mcp_families set expires_at=now()-interval '1 second' where id=$1", [expired.family]);
    assert.equal((await f.refresh(expired.refresh)).error, 'invalid_grant');
    const disabled = await f.issue();
    await f.db.query('update remy_mcp_clients set enabled=false where client_id=$1', [client]);
    assert.equal(await f.active(disabled.access), null); assert.equal((await f.refresh(disabled.refresh)).error, 'invalid_grant');
    await f.db.query('update remy_mcp_clients set enabled=true where client_id=$1', [client]);
    const tokens = await f.issue(); const captured = (await f.active(tokens.access))!.guard;
    await f.rpc('remy_mcp_revoke_grant', [owner, client]);
    assert.equal(await f.active(tokens.access), null, 'Revoke before authorization blocks a fresh request');
    assert.equal((await f.refresh(tokens.refresh)).error, 'invalid_grant');
    await assert.rejects(f.save(captured), /REMY_STALE_OPERATION/, 'Revoke after authorization invalidates captured guard');
    const reconnected = await f.issue(); assert.ok(await f.active(reconnected.access));
    assert.equal(await f.active(tokens.access), null); assert.equal((await f.refresh(tokens.refresh)).error, 'invalid_grant');
    await assert.rejects(f.save(captured), /REMY_STALE_OPERATION/);
    const pendingCode = await f.issueCode(); await f.rpc('remy_mcp_revoke_grant', [owner, client]);
    assert.equal((await f.exchange(pendingCode.codeHash)).error, 'invalid_grant');
  } finally { await f.db.close(); }
});

test('Token revocation is client-bound; Delete All invalidates tokens, codes, refreshes and in-flight food writes', async () => {
  const f = await fixture();
  try {
    const tokens = await f.issue(); const captured = (await f.active(tokens.access))!.guard;
    await f.rpc('remy_mcp_revoke_token', [otherClient, tokens.refresh]); assert.ok(await f.active(tokens.access));
    await f.rpc('remy_mcp_revoke_token', [client, tokens.refresh]); assert.equal(await f.active(tokens.access), null);
    await assert.rejects(f.save(captured), /REMY_STALE_OPERATION/);
    const latest = await f.issue(); const beforeDelete = (await f.active(latest.access))!.guard;
    const pendingCode = await f.issueCode();
    await f.rpc('remy_begin_delete', [owner]); await f.rpc('remy_finish_delete', [owner]);
    assert.equal(await f.active(latest.access), null); assert.equal((await f.refresh(latest.refresh)).error, 'invalid_grant');
    assert.equal((await f.exchange(pendingCode.codeHash)).error, 'invalid_grant');
    await assert.rejects(f.save(beforeDelete), /REMY_MCP_DISABLED|REMY_STALE_OPERATION/);
    assert.equal((await f.rpc<{ disabled: boolean }>('remy_operation_state', [owner, 'remy-mcp'])).disabled, true);
    const explicitReconnect = await f.issue(); assert.ok(await f.active(explicitReconnect.access));
    assert.equal(await f.active(latest.access), null);
  } finally { await f.db.close(); }
});

test('Broker tables and all RPCs are inaccessible to anon and authenticated app sessions', async () => {
  const f = await fixture();
  try {
    const tokens = await f.issue();
    const functions = [
      ['remy_mcp_begin_authorization', [randomUUID(), client, redirect, resource, scopes, 'state', challenge]],
      ['remy_mcp_decide_authorization', [owner, randomUUID(), true, hash()]],
      ['remy_mcp_exchange_code', [client, hash(), redirect, resource, challenge, hash(), hash(), randomUUID()]],
      ['remy_mcp_refresh_token', [client, tokens.refresh, resource, hash(), hash()]],
      ['remy_mcp_authorize_token', [tokens.access, resource]], ['remy_mcp_revoke_token', [client, tokens.refresh]],
      ['remy_mcp_revoke_grant', [owner, client]], ['remy_mcp_bump_guard', [owner, true]],
    ] as const;
    await f.db.exec('reset role');
    await f.db.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]);
    for (const role of ['anon', 'authenticated']) {
      await f.db.query("select set_config('request.jwt.claim.role',$1,false)", [role]); await f.db.exec(`set role ${role}`);
      for (const table of ['clients', 'grants', 'authorizations', 'codes', 'families', 'tokens'])
        await assert.rejects(f.db.query(`select * from remy_mcp_${table}`), /permission denied/);
      for (const [name, args] of functions) await assert.rejects(f.rpc(name, [...args]), /permission denied/, name);
      await f.db.exec('reset role');
    }
  } finally { await f.db.close(); }
});
