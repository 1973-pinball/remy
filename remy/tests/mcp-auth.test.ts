import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import * as crypto from 'node:crypto';
import ts from 'typescript';

const owner = '10000000-0000-4000-8000-000000000001', client = '20000000-0000-4000-8000-000000000001';
const origin = 'https://remy.example.com', access = `remy_at_${'a'.repeat(43)}`;
function load(file: string, dependencies: Record<string, unknown>, globals: Record<string, unknown> = {}) {
  const code = ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports: Record<string, any> = {};
  runInNewContext(code, { exports, URL, Response, Request, Date, ...globals, require: (name: string) => { assert.ok(name in dependencies, `Unexpected dependency ${name}`); return dependencies[name]; } });
  return exports;
}
class SetupError extends Error {}
const config = { appOrigin: () => origin, isAllowedEmail: (email: string) => email === 'owner@example.com', SetupError };
function fixture(options: { active?: boolean; confirmed?: boolean; email?: string; enabled?: boolean; bannedUntil?: string; deletedAt?: string; scopes?: string[] } = {}) {
  const calls: string[] = [], guard = { generation: 2, provider: 'remy-mcp', version: 5, disabled: false };
  const module = load('../lib/mcp-auth.ts', {
    'server-only': {}, 'node:crypto': crypto, './supabase/config': config,
    './supabase/admin': { createAdminClient() { return {
      auth: { admin: { async getUserById(id: string) { calls.push('user'); assert.equal(id, owner); return { data: { user: { id: owner, email: options.email ?? 'owner@example.com', email_confirmed_at: options.confirmed === false ? null : '2026-01-01', user_metadata: { full_name: 'Owner' }, banned_until: options.bannedUntil, deleted_at: options.deletedAt } }, error: null }; } } },
      async rpc(name: string, input: Record<string, unknown>) { calls.push('grant'); assert.equal(name, 'remy_mcp_authorize_token'); assert.equal(input.p_hash, crypto.createHash('sha256').update(access).digest('hex')); assert.equal(input.p_resource, `${origin}/api/mcp`); return { data: options.active === false ? null : { owner, client_id: client, scopes: options.scopes ?? ['diet:read', 'diet:write'], guard }, error: null }; },
    }; } },
  }, { process: { env: { REMY_MCP_ENABLED: options.enabled === false ? 'false' : 'true' } } });
  return { module, calls, guard, run: (authorization = `Bearer ${access}`) => module.authorizeMcp(new Request(`${origin}/api/mcp`, { headers: { authorization } })) };
}

test('MCP hashes Remy token and checks current confirmed owner and atomic grant guard', async () => {
  const f = fixture(); const identity = await f.run();
  assert.equal(identity.userId, owner); assert.equal(identity.clientId, client); assert.equal(identity.guard, f.guard);
  assert.deepEqual(f.calls, ['grant', 'user']);
  assert.equal(f.module.mcpMetadata().resource, `${origin}/api/mcp`);
  assert.equal(f.module.mcpMetadata().authorization_servers[0], origin);
  assert.match(f.module.mcpChallenge(), /oauth-protected-resource\/api\/mcp/);
});
test('MCP rejects JWTs, service keys, refresh tokens, expired/revoked grants and banned owners', async () => {
  for (const authorization of ['', 'Bearer sb_secret_value', 'Bearer abc.def.ghi', `Basic ${access}`, `Bearer remy_rt_${'a'.repeat(43)}`, `Bearer ${access} extra`]) {
    const f = fixture(); await assert.rejects(f.run(authorization)); assert.deepEqual(f.calls, []);
  }
  for (const options of [{ active: false }, { confirmed: false }, { email: 'other@example.com' }, { bannedUntil: '2099-01-01' }, { deletedAt: '2026-01-01' }, { scopes: ['diet:read'] }]) await assert.rejects(fixture(options).run());
  const disabled = fixture({ enabled: false }); await assert.rejects(disabled.run()); assert.deepEqual(disabled.calls, []);
});
test('OAuth tokens cannot enter unrestricted journal APIs through browser cookies', async () => {
  for (const oauth of [false, true]) {
    const http = load('../lib/http.ts', {
      '@/lib/supabase/config': { ...config, allowedEmail() {}, assertSameOrigin() {} },
      '@/lib/supabase/server': { async createClient() { return { auth: { async getUser() { return { data: { user: { id: owner, email: 'owner@example.com', email_confirmed_at: '2026-01-01', user_metadata: {} } }, error: null }; }, async getClaims() { return { data: { claims: { sub: owner, ...(oauth ? { client_id: client } : {}) } }, error: null }; } } }; } },
    });
    if (oauth) await assert.rejects(http.authorize(new Request(`${origin}/api/journal`)), (error: any) => error.status === 403);
    else assert.equal((await http.authorize(new Request(`${origin}/api/journal`))).userId, owner);
  }
});
