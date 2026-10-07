import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as validation from '../lib/validation';
import * as domain from '../lib/domain';
import * as journalDate from '../lib/journal-date';

// Exercise the actual handler with isolated Auth/storage boundaries. This lets
// deletion complete between guard capture and a slow body without cloud access.
const compiledRoute = ts.transpileModule(readFileSync(new URL('../app/api/journal/route.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

const meal = { title: 'Test meal', mealType: 'Lunch', mealTime: '2026-10-06T16:00:00Z', messageTime: null, notes: '', confidence: 'label', workoutId: null, calories: 500, carbs: 75, protein: 20, fat: 10, fiber: 12 };
const mealBody = { kind: 'meal', localDate: '2026-10-06', data: meal };

function harness(input: unknown, options: { slow?: boolean; deleting?: boolean; existing?: domain.Entry[] } = {}) {
  let generation = 1;
  let deleting = options.deleting ?? false;
  const captured: object[] = [];
  const writes: { kind: string; guard: object; revision?: number }[] = [];
  let deletions = 0;
  const bodyStarted = deferred<void>();
  const bodyReady = deferred<unknown>();
  const stale = () => Object.assign(new Error('The journal changed during this operation. Please retry.'), { status: 409 });
  const verify = (guard: { generation: number } | undefined) => {
    if (!guard || deleting || guard.generation !== generation) throw stale();
  };
  const store = {
    async operationGuard() {
      if (deleting) throw stale();
      const guard = { generation }; captured.push(guard); return guard;
    },
    async getEntry(_owner: string, id: string) {
      return options.existing?.find(entry => entry.id === id) ?? null;
    },
    async listEntries() { return options.existing ?? []; },
    async saveEntry(_owner: string, record: { guard?: { generation: number }; expectedRevision?: number }) {
      verify(record.guard);
      writes.push({ kind: 'save', guard: record.guard!, revision: record.expectedRevision });
      return { entry: record, duplicate: false };
    },
    async undo(_owner: string, _id: string, revision: number, guard?: { generation: number }) {
      verify(guard);
      writes.push({ kind: 'undo', guard: guard!, revision });
      return { undone: true };
    },
    async deleteJournal() { deletions++; generation++; deleting = false; return { deleted: true }; },
  };
  const dependencies: Record<string, unknown> = {
    '@/lib/store': store,
    '@/lib/domain': domain,
    '@/lib/validation': validation,
    '@/lib/journal-date': journalDate,
    '@/lib/http': {
      async authorize() { return { userId: 'owner', email: 'owner@example.com', fullName: null }; },
      async body() { bodyStarted.resolve(); return options.slow ? bodyReady.promise : input; },
      json: (value: unknown, status = 200) => Response.json(value, { status }),
      failure: (error: { message?: string; status?: number }) => Response.json({ error: error.message }, { status: error.status ?? 400 }),
    },
  };
  const exported: { POST?: (request: Request) => Promise<Response> } = {};
  runInNewContext(compiledRoute, {
    exports: exported,
    require: (name: string) => { if (!(name in dependencies)) throw new Error(`Unexpected dependency: ${name}`); return dependencies[name]; },
    Response, Request, URL,
  });
  return {
    start: () => exported.POST!(new Request('https://remy.example.com/api/journal', { method: 'POST' })),
    bodyStarted: bodyStarted.promise,
    releaseBody: () => bodyReady.resolve(input),
    finishDeletion: () => { generation++; deleting = false; },
    captured, writes,
    get deletions() { return deletions; },
  };
}

test('a manual request captured before deletion cannot recreate data after its slow body arrives', async () => {
  const app = harness(mealBody, { slow: true });
  const pending = app.start();
  await app.bodyStarted;
  assert.equal(app.captured.length, 1);
  app.finishDeletion();
  app.releaseBody();
  const response = await pending;
  assert.equal(response.status, 409);
  assert.equal(app.writes.length, 0);
});

test('undo retains its original operation guard if deletion finishes while its body is pending', async () => {
  const app = harness({ action: 'undo', id: 'meal-1', revision: 7 }, { slow: true });
  const pending = app.start();
  await app.bodyStarted;
  app.finishDeletion(); app.releaseBody();
  assert.equal((await pending).status, 409);
  assert.equal(app.writes.length, 0);
});

test('an interrupted deletion can be retried while ordinary writes remain blocked', async () => {
  const deletion = harness({ action: 'deleteAll', confirmation: 'DELETE MY JOURNAL' }, { deleting: true });
  assert.equal((await deletion.start()).status, 200);
  assert.equal(deletion.deletions, 1);
  for (const input of [mealBody, { action: 'undo', id: 'meal-1', revision: 7 }]) {
    const write = harness(input, { deleting: true });
    assert.equal((await write.start()).status, 409);
    assert.equal(write.writes.length, 0);
  }
});

test('ordinary writes and undo forward the captured guard and optimistic revision', async () => {
  const existing: domain.Entry = { id: 'meal-1', kind: 'meal', localDate: '2026-10-06', source: 'manual', sourceId: 'meal-1', revision: 7, updatedAt: '2026-10-06T18:00:00Z', data: meal };
  for (const input of [{ ...mealBody, id: existing.id, revision: 7, data: { ...meal, calories: 550 } }, { action: 'undo', id: existing.id, revision: 7 }]) {
    const app = harness(input, { existing: [existing] });
    assert.equal((await app.start()).status, 200);
    assert.equal(app.writes.length, 1);
    assert.equal(app.writes[0].guard, app.captured[0]);
    assert.equal(app.writes[0].revision, 7);
  }
});

test('guarded manual writes still reject a meal date inconsistent with the persisted profile timezone', async () => {
  const profile: domain.Entry = { id: 'profile', kind: 'profile', localDate: null, source: 'manual', sourceId: 'profile', revision: 1, updatedAt: '2026-10-06T18:00:00Z', data: { ...domain.DEFAULT_PROFILE, timezone: 'America/Los_Angeles' } };
  const app = harness({ ...mealBody, localDate: '2026-10-07', data: { ...meal, mealTime: '2026-10-07T02:00:00Z' } }, { existing: [profile] });
  const response = await app.start();
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /falls on 2026-10-06/);
  assert.equal(app.writes.length, 0);
});
