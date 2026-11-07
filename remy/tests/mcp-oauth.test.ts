import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import * as crypto from 'node:crypto';
import ts from 'typescript';

const origin = 'https://remy.example.com', client = '20000000-0000-4000-8000-000000000001', owner = '10000000-0000-4000-8000-000000000001', authorizationId = '30000000-0000-4000-8000-000000000001';
const callback = 'https://chatgpt.com/connector_platform_oauth_redirect', verifier = 'v'.repeat(43), challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
const hash = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
function load(file: string, dependencies: Record<string, unknown>) {
  const source = ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports: Record<string, any> = {};
  runInNewContext(source, { exports, URL, URLSearchParams, Response, Request, Date, TextDecoder, require(name: string) { assert.ok(name in dependencies, name); return dependencies[name]; } });
  return exports;
}
const auth = { assertMcpEnabled() {}, MCP_AUTH_SCOPES: ['diet:read', 'diet:write'], mcpIssuer: () => origin, mcpResource: () => `${origin}/api/mcp`, mcpTokenHash: hash, UUID: /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i };
function fixture(error = false) {
  const calls: { name: string; input: Record<string, unknown> }[] = [];
  const module = load('../lib/mcp-oauth.ts', { 'server-only': {}, 'node:crypto': crypto, './supabase/config': { appOrigin: () => origin }, './mcp-auth': auth, './supabase/admin': { createAdminClient() { return { async rpc(name: string, input: Record<string, unknown>) { calls.push({ name, input }); return { data: error ? { error: 'invalid_grant' } : { scope: 'diet:read diet:write', expires_in: 600 }, error: null }; } }; } } });
  return { module, calls };
}
function authorization(extra: Record<string, string> = {}) {
  return new Request(`${origin}/oauth/authorize?${new URLSearchParams({ client_id: client, redirect_uri: callback, resource: `${origin}/api/mcp`, response_type: 'code', scope: 'diet:read diet:write', state: 'client-csrf-state', code_challenge: challenge, code_challenge_method: 'S256', ...extra })}`);
}
function form(extra: Record<string, string> = {}, headers: Record<string, string> = {}) {
  return new Request(`${origin}/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers }, body: new URLSearchParams({ client_id: client, resource: `${origin}/api/mcp`, grant_type: 'authorization_code', code: `remy_ac_${'c'.repeat(43)}`, redirect_uri: callback, code_verifier: verifier, ...extra }) });
}
test('discovery advertises public PKCE and Remy-specific scopes; authorization captures client state and resource', async () => {
  const f = fixture(), metadata = f.module.oauthMetadata();
  assert.equal(metadata.issuer, origin); assert.deepEqual(Array.from(metadata.token_endpoint_auth_methods_supported), ['none']);
  assert.equal(metadata.registration_endpoint, undefined); assert.equal(metadata.authorization_response_iss_parameter_supported, true);
  assert.equal((await f.module.beginOAuth(authorization())).status, 303);
  assert.equal(f.calls[0].name, 'remy_mcp_begin_authorization');
  assert.equal(f.calls[0].input.p_challenge, challenge); assert.equal(f.calls[0].input.p_state, 'client-csrf-state');
  assert.equal(f.calls[0].input.p_redirect, callback); assert.equal(f.calls[0].input.p_resource, `${origin}/api/mcp`);
});
test('authorization rejects missing state, plain PKCE, wrong resource, unwanted scopes and duplicate parameters', async () => {
  const cases: Record<string,string>[] = [{ state: '' }, { code_challenge_method: 'plain' }, { code_challenge: 'short' }, { resource: 'https://other.example/api/mcp' }, { scope: 'diet:read admin' }, { redirect_uri: 'http://example.com/callback' }, { client_secret: 'must-not-use-secret' }];
  for (const extra of cases) {
    const f = fixture(); await assert.rejects(f.module.beginOAuth(authorization(extra))); assert.equal(f.calls.length, 0);
  }
  const f = fixture(); const request = authorization(); await assert.rejects(f.module.beginOAuth(new Request(`${request.url}&client_id=${client}`))); assert.equal(f.calls.length, 0);
});
test('code exchange sends only credential hashes to database and returns short-lived opaque tokens', async () => {
  const f = fixture(), response = await f.module.exchangeOAuth(form()), body = await response.json();
  assert.match(body.access_token, /^remy_at_[A-Za-z0-9_-]{43}$/); assert.match(body.refresh_token, /^remy_rt_[A-Za-z0-9_-]{43}$/);
  assert.equal(body.expires_in, 600); assert.equal(body.token_type, 'Bearer'); assert.equal(response.headers.get('cache-control'), 'no-store');
  const stored = f.calls[0].input; assert.equal(stored.p_access_hash, hash(body.access_token)); assert.equal(stored.p_refresh_hash, hash(body.refresh_token)); assert.equal(stored.p_challenge, challenge);
  assert.ok(!JSON.stringify(stored).includes('remy_at_')); assert.ok(!JSON.stringify(stored).includes(verifier));
  await assert.rejects(fixture(true).module.exchangeOAuth(form()));
});
test('token exchange rejects missing PKCE, credential confusion, scope widening and wrong resource before issuing tokens', async () => {
  const cases: Record<string,string>[] = [{ code_verifier: '' }, { code_verifier: 'short' }, { resource: 'https://other.example/api/mcp' }, { code: 'eyJ.header.signature' }, { client_secret: 'secret' }, { grant_type: 'client_credentials' }];
  for (const extra of cases) { const f = fixture(); await assert.rejects(f.module.exchangeOAuth(form(extra))); assert.equal(f.calls.length, 0); }
  const f = fixture(); await assert.rejects(f.module.exchangeOAuth(form({}, { authorization: 'Basic synthetic' }))); assert.equal(f.calls.length, 0);
  const refresh = fixture(); await refresh.module.exchangeOAuth(form({ grant_type: 'refresh_token', refresh_token: `remy_rt_${'r'.repeat(43)}` })); assert.equal(refresh.calls[0].name, 'remy_mcp_refresh_token');
  const widened = fixture(); await assert.rejects(widened.module.exchangeOAuth(form({ grant_type: 'refresh_token', refresh_token: `remy_rt_${'r'.repeat(43)}`, scope: 'diet:read diet:write admin' }))); assert.equal(widened.calls.length, 0);
});
test('OAuth form parsing caps actual streamed bytes even without content-length', async () => {
  const f = fixture();
  const request = new Request(`${origin}/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'x='.padEnd(8193, 'a') });
  await assert.rejects(f.module.oauthForm(request));
  assert.equal(f.calls.length, 0);
});
test('consent requires owner and same-origin POST; approval binds response state/issuer while denial creates no code', async () => {
  for (const decision of ['approve', 'deny']) {
    const calls: any[] = [];
    const route = load('../app/oauth/decision/route.ts', {
      '@/lib/http': { async authorize(request: Request, write: boolean) { assert.equal(write, true); if (request.headers.get('origin') !== origin) throw Object.assign(new Error('Forbidden'), { status: 403 }); return { userId: owner }; }, failure(error: any) { return Response.json({ error: error.message }, { status: error.status ?? 400 }); } },
      '@/lib/supabase/config': { appOrigin: () => origin }, '@/lib/mcp-auth': auth,
      '@/lib/mcp-consent': { authorizationId: (id: string) => id, async pendingAuthorization(id: string) { assert.equal(id, owner); return { details: { redirect_uri: callback, state: 'exact-state' } }; } },
      '@/lib/mcp-oauth': { opaqueToken: () => `remy_ac_${'c'.repeat(43)}`, oauthForm: (request: Request) => fixture().module.oauthForm(request) },
      '@/lib/supabase/admin': { createAdminClient() { return { async rpc(name: string, input: any) { calls.push({ name, input }); return { data: { redirect_uri: callback, state: 'exact-state' }, error: null }; } }; } },
    });
    const body = new URLSearchParams({ authorization_id: authorizationId, decision });
    const denied = await route.POST(new Request(`${origin}/oauth/decision`, { method: 'POST', body })); assert.equal(denied.status, 403); assert.equal(calls.length, 0);
    const response = await route.POST(new Request(`${origin}/oauth/decision`, { method: 'POST', body, headers: { origin } })); assert.equal(response.status, 303);
    const target = new URL(response.headers.get('location')!); assert.equal(target.origin, 'https://chatgpt.com'); assert.equal(target.searchParams.get('state'), 'exact-state'); assert.equal(target.searchParams.get('iss'), origin);
    assert.equal(calls[0].input.p_approve, decision === 'approve'); assert.equal(target.searchParams.has('code'), decision === 'approve');
    if (decision === 'deny') assert.equal(target.searchParams.get('error'), 'access_denied');
  }
});
