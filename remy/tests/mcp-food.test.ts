import test from 'node:test';
import assert from 'node:assert/strict';
import { callFoodTool, confirmFoodLog, getFoodLog, getRemyContext, MCP_FOOD_TOOLS,
  prepareFoodLog, type McpFoodOptions, type McpFoodStore } from '../lib/mcp-food';
import { DEFAULT_PROFILE, type Entry, type Kind, type Meal } from '../lib/domain';

const owner = '10000000-0000-4000-8000-000000000000';
const otherOwner = '20000000-0000-4000-8000-000000000000';
const requestId = '10000000-0000-4000-8000-000000000001';
const requestId2 = '10000000-0000-4000-8000-000000000002';
const date = '2026-11-06';
const now = '2026-11-07T02:00:00.000Z'; // November 6, 9 p.m. Eastern.
const meal: Meal = { title: 'Synthetic black bean bowl', mealType: 'Dinner', mealTime: null, messageTime: null,
  notes: 'Synthetic fixture, estimated cooked portions.', confidence: 'estimate', workoutId: null,
  calories: 500, protein: 25, carbs: 70, fat: 12, fiber: 8, etl: { beansG: 200, flexCalories: 0 } };
function row(kind: Kind, id: string, data: object, localDate: string | null = date): Entry {
  return { id, kind, localDate, source: 'manual', sourceId: id, revision: 1, updatedAt: now, data: data as Record<string, unknown> };
}
function input(overrides: Record<string, unknown> = {}) {
  const { messageTime: _time, photoId: _photo, ...draft } = meal;
  return { requestId, date, action: 'add', targetId: null, targetRevision: null, meal: draft,
    evidence: { report: 'Log this black bean bowl I ate.', kind: 'text', assumptions: ['Cooked portions estimated.'] }, ...overrides };
}
function decision(overrides: Record<string, unknown> = {}) {
  return { proposalId: `mcp-food-proposal:${requestId}`, revision: 1, userConfirmed: true, ...overrides };
}

/** Simulates owner isolation, guarded revisions and atomic batches, not network behavior. */
function harness(initial: Entry[] = []) {
  const journals = new Map<string, Map<string, Entry>>([[owner, new Map(initial.map(e => [e.id, structuredClone(e)]))]]);
  const locks = new Set<string>();
  let generation = 1, writes = 0, batches = 0;
  const hooks: { beforeBatch?: () => void; failAt?: number; lostResponse?: boolean } = {};
  const records = (id = owner) => {
    if (!journals.has(id)) journals.set(id, new Map());
    return journals.get(id)!;
  };
  const store: McpFoodStore = {
    getEntry: async (user, id) => structuredClone(records(user).get(id) ?? null),
    listEntries: async (user, deleted = false) => [...records(user).values()].filter(e => deleted || !e.deleted).map(e => structuredClone(e)),
    saveEntries: async (user, inputs, snapshot) => {
      const before = hooks.beforeBatch; delete hooks.beforeBatch; before?.();
      if (inputs.some(write => write.kind === 'meal')) {
        const actual = Object.fromEntries([...records(user).values()].filter(e => e.kind === 'meal' || e.kind === 'dailySummary').map(e => [e.id, e.revision]));
        try { assert.deepEqual(snapshot, actual); } catch { throw new Error('Synthetic food snapshot conflict'); }
      }
      const staged = new Map([...records(user)].map(([id, e]) => [id, structuredClone(e)]));
      const failAt = hooks.failAt; delete hooks.failAt;
      for (const [index, write] of inputs.entries()) {
        if (failAt === index) throw new Error('Synthetic transaction failure');
        if (write.guard?.generation !== generation) throw new Error('Stale journal generation');
        const id = write.id!, previous = staged.get(id);
        if (write.expectedRevision !== undefined && previous?.revision !== write.expectedRevision)
          throw new Error('Synthetic revision conflict');
        staged.set(id, { id, kind: write.kind, localDate: write.localDate, revision: (previous?.revision ?? 0) + 1,
          source: previous?.source ?? write.source ?? 'manual', sourceId: previous?.sourceId ?? write.sourceId ?? id,
          updatedAt: now, data: structuredClone(write.data) as Record<string, unknown>, deleted: !!write.deleted });
      }
      journals.set(user, staged); writes += inputs.length; batches++;
      if (hooks.lostResponse) { delete hooks.lostResponse; throw new Error('Synthetic response lost after commit'); }
    },
    acquireRefreshLock: async (user, name) => { const key = `${user}:${name}`; if (locks.has(key)) return null; locks.add(key); return key; },
    releaseRefreshLock: async (_user, _name, token) => { locks.delete(token); },
  };
  const options = (user = owner): McpFoodOptions => ({ owner: user, store, guard: { generation, provider: 'remy-mcp', version: 0 }, now });
  const revise = (id: string, data: object, deleted = false) => {
    const prior = records().get(id)!;
    records().set(id, { ...prior, data: data as Record<string, unknown>, revision: prior.revision + 1, deleted });
  };
  return { store, options, records, hooks, revise, writes: () => writes, batches: () => batches,
    nextGeneration: () => { generation++; }, mealRows: () => [...records().values()].filter(e => e.kind === 'meal') };
}

test('draft preparation does not log food; confirmation and retries save exactly one meal', async () => {
  const h = harness();
  const draft = await prepareFoodLog(input(), h.options());
  assert.equal(draft.status, 'pending');
  assert.equal(draft.totals.totals.calories, null);
  assert.equal(h.mealRows().length, 0);
  const replayDraft = await prepareFoodLog(input(), h.options());
  assert.deepEqual(replayDraft, draft);
  assert.equal(h.writes(), 1);
  const result = await confirmFoodLog(decision(), h.options());
  assert.equal(result.status, 'saved');
  if ('savedMeal' in result) {
    assert.equal(result.savedMeal?.id, `mcp-food-meal:${requestId}`);
    assert.equal(result.savedMeal?.source, 'remy-chatgpt');
    assert.equal(result.savedMeal?.messageTime, null);
    assert.equal(result.totals.totals.calories, 500);
  }
  await confirmFoodLog(decision(), h.options());
  await prepareFoodLog(input(), h.options());
  assert.equal(h.writes(), 3);
  assert.equal(h.mealRows().length, 1);
});

test('request identity cannot be reused with a different meal, date or evidence', async () => {
  const h = harness();
  await prepareFoodLog(input(), h.options());
  for (const changed of [input({ date: '2026-11-05' }), input({ meal: { ...input().meal, calories: 510 } }),
    input({ evidence: { ...input().evidence, report: 'Different report' } })])
    await assert.rejects(prepareFoodLog(changed, h.options()), /request ID was already used/);
  assert.equal(h.writes(), 1);
});

test('same-day cross-source duplicates require an explicitly confirmed separate eating occasion', async () => {
  const existing = row('meal', 'manual-bowl', { ...meal, calories: 510 });
  const h = harness([existing]);
  const draft = await prepareFoodLog(input(), h.options());
  assert.equal(draft.possibleDuplicates[0].id, 'manual-bowl');
  const blocked = await confirmFoodLog(decision(), h.options());
  assert.equal(blocked.status, 'needs_duplicate_review');
  assert.equal(h.mealRows().length, 1);
  const separate = await confirmFoodLog(decision({ repeatConfirmed: true }), h.options());
  assert.equal(separate.status, 'saved');
  assert.equal(h.mealRows().length, 2);
  assert.deepEqual(h.records().get(existing.id), existing);
});

test('duplicate check is repeated after preparation to catch a meal logged in the app meanwhile', async () => {
  const h = harness();
  await prepareFoodLog(input(), h.options());
  h.records().set('late-app-meal', row('meal', 'late-app-meal', meal));
  const result = await confirmFoodLog(decision(), h.options());
  assert.equal(result.status, 'needs_duplicate_review');
  assert.equal(h.mealRows().length, 1);
});

test('an explicit correction preserves source, photo and message time and omitted ETL fields', async () => {
  const existing = row('meal', 'old-bowl', { ...meal, photoId: `${owner}/1/meal-photos/example.jpg`, messageTime: '2026-11-06T17:00:00Z' });
  existing.source = 'remy-etl'; existing.sourceId = 'original-user-turn';
  const h = harness([existing]);
  const { etl: _etl, ...draftMeal } = input().meal;
  await prepareFoodLog(input({ action: 'correct', targetId: existing.id, targetRevision: 1,
    meal: { ...draftMeal, calories: 600, notes: 'User corrected portions.' } }), h.options());
  const saved = await confirmFoodLog(decision(), h.options());
  assert.equal(saved.status, 'saved');
  const actual = h.records().get(existing.id)!;
  assert.equal(actual.revision, 2);
  assert.equal(actual.data.calories, 600);
  assert.equal(actual.source, existing.source);
  assert.equal(actual.sourceId, existing.sourceId);
  assert.equal(actual.data.photoId, existing.data.photoId);
  assert.equal(actual.data.messageTime, existing.data.messageTime);
  assert.deepEqual(actual.data.etl, existing.data.etl);
  assert.equal(h.mealRows().length, 1);
  assert.doesNotMatch(JSON.stringify(saved), /meal-photos\/example/);
});

test('corrections never overwrite newer app edits, including edits during the transaction', async () => {
  for (const late of [false, true]) {
    const existing = row('meal', 'old-bowl', meal), h = harness([existing]);
    await prepareFoodLog(input({ action: 'correct', targetId: existing.id, targetRevision: 1,
      meal: { ...input().meal, calories: 600 } }), h.options());
    const edit = () => h.revise(existing.id, { ...meal, calories: 650 });
    if (late) h.hooks.beforeBatch = edit; else edit();
    await assert.rejects(confirmFoodLog(decision(), h.options()), /changed after this draft|revision conflict|food snapshot conflict/);
    assert.equal(h.records().get(existing.id)?.data.calories, 650);
    assert.equal(h.records().get(`mcp-food-proposal:${requestId}`)?.data.status, 'pending');
  }
});

test('an app meal inserted after final duplicate review aborts the atomic food write', async () => {
  const h = harness();
  await prepareFoodLog(input(), h.options());
  h.hooks.beforeBatch = () => { h.records().set('concurrent-app-meal', row('meal', 'concurrent-app-meal', meal)); };
  await assert.rejects(confirmFoodLog(decision(), h.options()), /food snapshot conflict/);
  assert.equal(h.mealRows().length, 1);
  assert.equal(h.records().get(`mcp-food-proposal:${requestId}`)?.data.status, 'pending');
  const retry = await confirmFoodLog(decision(), h.options());
  assert.equal(retry.status, 'needs_duplicate_review');
  assert.equal(h.mealRows().length, 1);
});

test('partial ETL corrections retain other categories and explicit null clears an uncertain value', async () => {
  const existing = row('meal', 'old-bowl', meal), h = harness([existing]);
  await prepareFoodLog(input({ action: 'correct', targetId: existing.id, targetRevision: 1,
    meal: { ...input().meal, etl: { beansG: null, rawVegetablesG: 50 } } }), h.options());
  await confirmFoodLog(decision(), h.options());
  assert.deepEqual(h.records().get(existing.id)?.data.etl, { beansG: null, rawVegetablesG: 50, flexCalories: 0 });
});

test('retry after a saved meal is edited or deleted preserves the later app action', async () => {
  for (const deleted of [false, true]) {
    const h = harness();
    await prepareFoodLog(input(), h.options());
    await confirmFoodLog(decision(), h.options());
    h.revise(`mcp-food-meal:${requestId}`, { ...meal, calories: 650 }, deleted);
    const result = await confirmFoodLog(decision(), h.options());
    assert.equal(h.records().get(`mcp-food-meal:${requestId}`)?.data.calories, 650);
    assert.equal(h.records().get(`mcp-food-meal:${requestId}`)?.deleted, deleted);
    assert.equal(h.writes(), 3);
    if ('savedMealWasDeleted' in result) assert.equal(result.savedMealWasDeleted, deleted);
  }
});

test('deleted targets and draft identities cannot be implicitly restored', async () => {
  const existing = { ...row('meal', 'deleted-bowl', meal), deleted: true }, h = harness([existing]);
  await assert.rejects(prepareFoodLog(input({ action: 'correct', targetId: existing.id, targetRevision: 1 }), h.options()), /deleted/);
  const draft = await prepareFoodLog(input(), h.options());
  assert.equal(draft.possibleDuplicates[0].deleted, true);
  h.revise(draft.proposalId, h.records().get(draft.proposalId)!.data, true);
  await assert.rejects(prepareFoodLog(input(), h.options()), /unavailable/);
  await assert.rejects(confirmFoodLog(decision(), h.options()), /unavailable/);
});

test('atomic failure leaves food untouched; a timeout after commit replays without more writes', async () => {
  const h = harness();
  await prepareFoodLog(input(), h.options());
  h.hooks.failAt = 1;
  await assert.rejects(confirmFoodLog(decision(), h.options()), /transaction failure/);
  assert.equal(h.mealRows().length, 0);
  assert.equal(h.records().get(`mcp-food-proposal:${requestId}`)?.data.status, 'pending');
  h.hooks.lostResponse = true;
  await assert.rejects(confirmFoodLog(decision(), h.options()), /response lost/);
  assert.equal(h.mealRows().length, 1);
  const before = h.writes();
  const replay = await confirmFoodLog(decision(), h.options());
  assert.equal(replay.status, 'saved');
  assert.equal(h.writes(), before);
});

test('journal reset invalidates pending and old request identities', async () => {
  const h = harness();
  await prepareFoodLog(input(), h.options());
  h.nextGeneration();
  await assert.rejects(confirmFoodLog(decision(), h.options()), /journal was reset/);
  await assert.rejects(prepareFoodLog(input(), h.options()), /previous journal/);
  assert.equal(h.mealRows().length, 0);
});

test('unknown nutrition stays null, supported fuel is counted once, invalid overlapping classification is rejected', async () => {
  const h = harness();
  const draft = { ...input().meal, calories: 320, carbs: 80, protein: null, fat: null, fiber: null,
    etl: { runFuelCalories: 320, flexCalories: 0 } };
  await prepareFoodLog(input({ meal: draft }), h.options());
  await confirmFoodLog(decision(), h.options());
  const log = await getFoodLog({ date }, h.options());
  assert.equal(log.progress.totals.calories, 320);
  assert.equal(log.progress.totals.protein, null);
  assert.equal(log.progress.runFuelCalories, 320);
  assert.equal(log.progress.flex.value, 0);
  await assert.rejects(prepareFoodLog(input({ requestId: requestId2, meal: { ...draft, etl: { runFuelCalories: 320, flexCalories: 20 } } }), h.options()), /counted once/);
});

test('food-date cutoffs use the journal timezone and actual eating timestamps', async () => {
  const h = harness();
  const context = await getRemyContext({}, h.options());
  assert.equal(context.selectedDate, '2026-11-06');
  await assert.rejects(prepareFoodLog(input({ date: '2026-11-07' }), h.options()), /today or an earlier date/);
  await assert.rejects(prepareFoodLog(input({ meal: { ...input().meal, mealTime: '2026-11-07T05:30:00Z' } }), h.options()), /falls on 2026-11-07/);
  await assert.rejects(prepareFoodLog(input({ meal: { ...input().meal, mealTime: '2026-11-07T03:00:00Z' } }), h.options()), /future time/);
  await prepareFoodLog(input({ meal: { ...input().meal, mealTime: '2026-11-07T01:00:00Z' } }), h.options());
  assert.equal(h.writes(), 1);
});

test('saved totals do not add historical summaries to meals', async () => {
  const h = harness([row('dailySummary', 'historical-day', { calories: 3000, protein: 120, carbs: 400, fat: 80, fiber: 40,
    notes: 'Historical source estimate', sourceMessageId: 'known-source', confidence: 'estimate', coverage: 'unknown' })]);
  const before = await getFoodLog({ date }, h.options());
  assert.equal(before.progress.totals.calories, 3000);
  await prepareFoodLog(input(), h.options());
  await confirmFoodLog(decision(), h.options());
  const after = await getFoodLog({ date }, h.options());
  assert.equal(after.progress.totals.calories, 500);
  assert.equal(after.progress.foodComplete, false);
});

test('context is bounded and excludes raw provider/location/photo and coach conversation contents', async () => {
  const secretMarker = 'DO-NOT-EXPOSE-RAW-PAYLOAD';
  const h = harness([
    row('profile', 'profile', { ...DEFAULT_PROFILE, name: 'Private Name', email: secretMarker }, null),
    row('meal', 'bowl', { ...meal, photoId: secretMarker }),
    row('workout', 'run', { title: 'Morning run', start: '2026-11-06T12:00:00Z', durationSec: 3600,
      distanceMeters: 16093.44, avgHr: 140, sport: 'running', route: secretMarker, streams: secretMarker, raw: secretMarker }),
    row('message', 'coach-private-message', { mode: 'ai-coach', role: 'user', text: secretMarker }),
    row('import', 'original-chat', { original: secretMarker }),
    row('connection', 'whoop', { provider: 'whoop', lastSuccess: now, credentials: secretMarker }),
  ]);
  const result = await getRemyContext({ date }, h.options());
  assert.doesNotMatch(JSON.stringify(result), new RegExp(secretMarker));
  assert.equal(result.running.recent[0].miles, 10);
  assert.equal(result.coverage.historyFrom, '2026-10-10');
  assert.equal(result.today.totals.calories, 500);
});

test('tool inputs cannot select another owner, write a photo path, invent message time, or skip authorization', async () => {
  const h = harness();
  for (const bad of [input({ owner: otherOwner }), input({ meal: { ...input().meal, photoId: 'private/path' } }),
    input({ meal: { ...input().meal, messageTime: now } })])
    await assert.rejects(prepareFoodLog(bad, h.options()));
  await prepareFoodLog(input(), h.options());
  await assert.rejects(confirmFoodLog(decision({ userConfirmed: false }), h.options()));
  await assert.rejects(confirmFoodLog(decision(), h.options(otherOwner)), /unavailable/);
  assert.equal(h.mealRows().length, 0);
  await assert.rejects(callFoodTool('delete_all', {}, h.options()), /Unknown Remy food tool/);
  assert.equal(MCP_FOOD_TOOLS.length, 4);
});
