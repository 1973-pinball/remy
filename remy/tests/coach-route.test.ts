import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { buildCoachContext, coachRequestSchema, type CoachRequest } from '../lib/coach-model';
import { coachDecisionSchema, type CoachDecision } from '../lib/coach-service';
import type { OperationGuard } from '../lib/store';

const origin = 'https://remy.example.invalid';
const owner = '10000000-0000-4000-8000-000000000000';
const requestId = '10000000-0000-4000-8000-000000000001';
const date = '2026-04-04';
const input = { id: requestId, date, message: 'Review this synthetic meal.', consent: true };
const decision = { id: `coach-proposal:${requestId}:0`, revision: 2, decision: 'save' };
const compiled = Object.fromEntries([
  ['coach', '../app/api/coach/route.ts'],
  ['proposals', '../app/api/coach/proposals/route.ts'],
].map(([name, file]) => [name, ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText]));

type RouteName = 'coach' | 'proposals';
type Generator = (request: CoachRequest, context: ReturnType<typeof buildCoachContext>) => Promise<unknown>;
type Options = {
  key?: string | null;
  authFailure?: boolean;
  guardFailure?: boolean;
  deleteDuringBody?: boolean;
};

/** Real route code and schemas; isolated env, Auth/storage boundaries and model stub. */
function harness(route: RouteName, value: unknown = input, options: Options = {}) {
  const events: string[] = [];
  let generation = 7;
  let suppliedGuard: OperationGuard | undefined;
  let delegatedInput: CoachRequest | CoachDecision | undefined;
  let generatedWith: { apiKey: string; model?: string } | undefined;
  const env = {
    OPENAI_API_KEY: options.key === null ? undefined : options.key ?? 'synthetic-server-key',
    OPENAI_MODEL: 'synthetic-model',
    SUPABASE_SECRET_KEY: 'synthetic-private-storage-key',
  };
  const fail = (message: string, status: number) => Object.assign(new Error(message), { status });
  const store = {
    async operationGuard(actualOwner: string) {
      events.push('guard');
      assert.equal(actualOwner, owner);
      if (options.guardFailure) throw fail('Journal deletion is in progress.', 409);
      return { generation };
    },
  };
  function verifyDelegation(actualOwner: string, guard: OperationGuard, suppliedStore: typeof store) {
    assert.equal(actualOwner, owner);
    assert.equal(suppliedStore.operationGuard, store.operationGuard);
    suppliedGuard = guard;
    if (guard.generation !== generation) throw fail('Journal generation changed.', 409);
  }
  const dependencies: Record<string, unknown> = {
    '@/lib/http': {
      async authorize(request: Request, write = false) {
        events.push(write ? 'authorize:write' : 'authorize:read');
        if (options.authFailure) throw fail('Sign in to use your private journal.', 401);
        if (write && request.headers.get('origin') !== origin) throw fail('Wrong request origin.', 403);
        return { userId: owner };
      },
      async body() {
        events.push('body');
        if (options.deleteDuringBody) generation++;
        return value;
      },
      json: (result: unknown, status = 200) => Response.json(result, { status }),
      failure: (error: { message: string; status?: number }) => Response.json({ error: error.message }, { status: error.status ?? 400 }),
    },
    '@/lib/store': store,
    '@/lib/coach-model': {
      coachRequestSchema,
      async generateCoach(_request: CoachRequest, _context: unknown, settings: { apiKey: string; model?: string }) {
        events.push('generate');
        generatedWith = settings;
        return { output: { text: 'Synthetic review.', drafts: [] }, model: 'synthetic-model' };
      },
    },
    '@/lib/coach-service': {
      coachDecisionSchema,
      async sendCoach(actualOwner: string, request: CoachRequest, guard: OperationGuard, suppliedStore: typeof store, generate: Generator) {
        events.push('send');
        verifyDelegation(actualOwner, guard, suppliedStore);
        delegatedInput = request;
        await generate(request, buildCoachContext([], date, `${date}T16:00:00Z`));
        return { message: { data: { text: 'Synthetic review.' } }, proposals: [] };
      },
      async decideCoach(actualOwner: string, request: CoachDecision, guard: OperationGuard, suppliedStore: typeof store) {
        events.push('decide');
        verifyDelegation(actualOwner, guard, suppliedStore);
        delegatedInput = request;
        return { status: request.decision === 'save' ? 'saved' : 'dismissed' };
      },
    },
  };
  const exported: Record<string, (request: Request) => Promise<Response>> = {};
  runInNewContext(compiled[route], {
    exports: exported,
    process: { env },
    require: (name: string) => {
      if (!(name in dependencies)) throw new Error(`Unexpected route dependency: ${name}`);
      return dependencies[name];
    },
  });
  return {
    events,
    get suppliedGuard() { return suppliedGuard; },
    get delegatedInput() { return delegatedInput; },
    get generatedWith() { return generatedWith; },
    call(method: 'GET' | 'POST' = 'POST', requestOrigin = origin) {
      return exported[method](new Request(`${origin}/api/coach${route === 'proposals' ? '/proposals' : ''}`, {
        method, headers: { Origin: requestOrigin },
      }));
    },
  };
}

test('coach availability authenticates first and returns only a boolean, never keys or model settings', async () => {
  for (const [key, expected] of [['synthetic-server-key', true], ['   ', false], [null, false]] as const) {
    const h = harness('coach', input, { key });
    const response = await h.call('GET');
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { available: expected });
    assert.deepEqual(h.events, ['authorize:read']);
  }
  const denied = harness('coach', input, { authFailure: true });
  assert.equal((await denied.call('GET')).status, 401);
  assert.deepEqual(denied.events, ['authorize:read']);
});

test('both coach write routes reject missing authorization before reading the body or storage', async () => {
  for (const route of ['coach', 'proposals'] as const) {
    const h = harness(route, route === 'coach' ? input : decision, { authFailure: true });
    assert.equal((await h.call()).status, 401);
    assert.deepEqual(h.events, ['authorize:write']);
  }
});

test('both coach write routes request same-origin enforcement before any further work', async () => {
  for (const route of ['coach', 'proposals'] as const) {
    const h = harness(route, route === 'coach' ? input : decision);
    assert.equal((await h.call('POST', 'https://other.example.invalid')).status, 403);
    assert.deepEqual(h.events, ['authorize:write']);
  }
});

test('missing or whitespace-only API configuration cannot invoke the coach service or model', async () => {
  for (const key of [null, '   ']) {
    const h = harness('coach', input, { key });
    const response = await h.call();
    assert.equal(response.status, 503);
    assert.match((await response.json()).error, /secure server key/);
    assert.deepEqual(h.events, ['authorize:write', 'guard', 'body']);
    assert.equal(h.generatedWith, undefined);
  }
});

test('invalid coach request and photo shapes fail before service or model execution', async () => {
  const invalid = [
    { ...input, consent: false },
    { ...input, id: 'not-a-request-id' },
    { ...input, date: '2026-02-30' },
    { ...input, message: '   ' },
    { ...input, image: { url: 'https://example.invalid/photo.png' } },
    { ...input, image: { mimeType: 'image/svg+xml', base64: 'AAAA' } },
    { ...input, image: { mimeType: 'image/png', base64: 'A'.repeat(1_200_001) } },
    { ...input, apiKey: 'synthetic-client-key' },
  ];
  for (const value of invalid) {
    const h = harness('coach', value);
    assert.equal((await h.call()).status, 400);
    assert.deepEqual(h.events, ['authorize:write', 'guard', 'body']);
  }
});

test('coach POST delegates normalized input, captured generation and server-only model configuration', async () => {
  const h = harness('coach', { ...input, message: '  Synthetic question  ' }, { key: '  synthetic-server-key  ' });
  const response = await h.call();
  assert.equal(response.status, 200);
  assert.deepEqual(h.events, ['authorize:write', 'guard', 'body', 'send', 'generate']);
  assert.equal(h.suppliedGuard?.generation, 7);
  assert.equal((h.delegatedInput as CoachRequest).message, 'Synthetic question');
  assert.equal((h.delegatedInput as CoachRequest).style, 'medium');
  assert.equal(h.generatedWith?.apiKey, 'synthetic-server-key');
  assert.equal(h.generatedWith?.model, 'synthetic-model');
  const serialized = JSON.stringify(await response.json());
  assert.doesNotMatch(serialized, /synthetic-server-key|synthetic-private-storage-key/);
});

test('proposal decisions require a coach identity, positive revision and valid reviewed edits', async () => {
  for (const value of [
    { ...decision, id: 'manual-meal:1' },
    { ...decision, id: `coach-proposal:${requestId}:6` },
    { ...decision, revision: 0 },
    { ...decision, revision: 1.5 },
    { ...decision, decision: 'deleteAll' },
    { ...decision, date: '2026-02-30' },
    { ...decision, meal: { title: 'Incomplete meal' } },
    { ...decision, targetId: 'foreign-meal' },
  ]) {
    const h = harness('proposals', value);
    assert.equal((await h.call()).status, 400);
    assert.deepEqual(h.events, ['authorize:write', 'guard', 'body']);
  }
});

test('confirm and dismiss delegate the captured revision without requiring an API key or model call', async () => {
  for (const action of ['save', 'dismiss'] as const) {
    const h = harness('proposals', { ...decision, decision: action }, { key: null });
    const response = await h.call();
    assert.equal(response.status, 200);
    assert.deepEqual(h.events, ['authorize:write', 'guard', 'body', 'decide']);
    assert.equal((h.delegatedInput as CoachDecision).revision, 2);
    assert.equal((h.delegatedInput as CoachDecision).decision, action);
    assert.equal(h.suppliedGuard?.generation, 7);
    assert.equal(h.generatedWith, undefined);
  }
});

test('both write routes preserve the pre-body generation and fail before work when guard acquisition fails', async () => {
  for (const route of ['coach', 'proposals'] as const) {
    const value = route === 'coach' ? input : decision;
    const changed = harness(route, value, { deleteDuringBody: true });
    assert.equal((await changed.call()).status, 409);
    assert.equal(changed.suppliedGuard?.generation, 7);
    assert.deepEqual(changed.events, ['authorize:write', 'guard', 'body', route === 'coach' ? 'send' : 'decide']);
    assert.equal(changed.generatedWith, undefined);
    const blocked = harness(route, value, { guardFailure: true });
    assert.equal((await blocked.call()).status, 409);
    assert.deepEqual(blocked.events, ['authorize:write', 'guard']);
  }
});
