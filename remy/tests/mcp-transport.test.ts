import test from 'node:test';
import assert from 'node:assert/strict';
import { createRemyMcpTransport } from '../lib/mcp-transport';

function fixture() {
  let authorizations = 0, calls = 0;
  const handle = createRemyMcpTransport({
    origin: 'https://remy.test', instructions: 'Private food journal.', scopes: ['openid'],
    tools: [{ name: 'get_food_log', description: 'Read a food date.', inputSchema: { type: 'object' } }],
    authorize: async request => { authorizations++; if (request.headers.get('authorization') !== 'Bearer valid') throw new Error(); return { userId: 'owner' }; },
    authFailure: () => Response.json({ error: 'Connect Remy.' }, { status: 401, headers: { 'WWW-Authenticate': 'Bearer resource_metadata="https://remy.test/.well-known/oauth-protected-resource"' } }),
    call: async (_name, _args, identity) => { calls++; assert.deepEqual(identity, { userId: 'owner' }); return { meals: [] }; },
  });
  return { handle, counts: () => ({ authorizations, calls }) };
}
function request(method: string, params: unknown = {}, token?: string, extra: Record<string, string> = {}) {
  return new Request('https://remy.test/api/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...(token ? { Authorization: token } : {}), ...extra }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
}
async function rpc(response: Response) {
  const text = await response.text();
  if (response.headers.get('content-type')?.includes('text/event-stream')) return JSON.parse(text.split('\n').find(line => line.startsWith('data: '))!.slice(6));
  return JSON.parse(text);
}
test('public tool discovery reveals schemas, never diet data; data calls require OAuth', async () => {
  const f = fixture();
  const response = await f.handle(request('tools/list'));
  assert.equal(response.status, 200);
  const data = await rpc(response);
  assert.equal(data.result.tools[0].name, 'get_food_log');
  assert.deepEqual(f.counts(), { authorizations: 0, calls: 0 });
  const denied = await f.handle(request('tools/call', { name: 'get_food_log' }));
  assert.equal(denied.status, 401);
  assert.match(denied.headers.get('www-authenticate')!, /resource_metadata/);
  assert.equal(f.counts().calls, 0);
});
test('authenticated calls work across independent serverless requests', async () => {
  const f = fixture();
  for (let i = 0; i < 2; i++) {
    const response = await f.handle(request('tools/call', { name: 'get_food_log', arguments: {} }, 'Bearer valid'));
    assert.equal(response.status, 200);
    const data = await rpc(response);
    assert.deepEqual(data.result.structuredContent, { meals: [] });
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
  }
  assert.deepEqual(f.counts(), { authorizations: 2, calls: 2 });
});
test('cross-site requests and oversized/chunked bodies cannot reach data tools', async () => {
  const f = fixture();
  assert.equal((await f.handle(request('tools/call', {}, 'Bearer valid', { origin: 'https://attacker.test' }))).status, 403);
  const tooLarge = request('tools/call', { description: 'x'.repeat(128_001) }, 'Bearer valid');
  assert.equal((await f.handle(tooLarge)).status, 413);
  assert.deepEqual(f.counts(), { authorizations: 0, calls: 0 });
});
test('unknown tools do not dispatch to the journal', async () => {
  const f = fixture();
  const data = await rpc(await f.handle(request('tools/call', { name: 'delete_journal' }, 'Bearer valid')));
  assert.equal(data.result.isError, true);
  assert.equal(f.counts().calls, 0);
});
