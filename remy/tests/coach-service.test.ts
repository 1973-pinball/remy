import test from 'node:test';
import assert from 'node:assert/strict';
import {coachDecisionSchema, decideCoach, sendCoach, type CoachStore} from '../lib/coach-service';
import {coachOutputSchema, coachRequestSchema, type CoachOutput, type CoachRequest} from '../lib/coach-model';
import type {Entry, Kind, Meal} from '../lib/domain';
import type {CoachProposal} from '../lib/coach-types';
import type {OperationGuard, SaveInput} from '../lib/store';

const owner = '10000000-0000-4000-8000-000000000000';
const otherOwner = '20000000-0000-4000-8000-000000000000';
const date = '2026-10-20';
const now = `${date}T16:00:00.000Z`;
const requestId = '10000000-0000-4000-8000-000000000001';
const secondId = '10000000-0000-4000-8000-000000000002';
const proposalId = `coach-proposal:${requestId}:0`;
const mealId = `coach-meal:${requestId}:0`;
const meal: Meal = {
  title: 'Synthetic bean bowl', mealType: 'Lunch', mealTime: null, messageTime: null,
  notes: 'Synthetic test fixture', confidence: 'label', workoutId: null,
  calories: 500, carbs: 70, protein: 25, fat: 12, fiber: 8, etl: {beansG: 200},
};

function record(kind: Kind, id: string, data: object, localDate: string | null = date): Entry {
  return {id, kind, localDate, source: 'test', sourceId: id, revision: 1, updatedAt: now, data: data as Record<string, unknown>};
}
function request(overrides: Partial<CoachRequest> = {}): CoachRequest {
  return coachRequestSchema.parse({id: requestId, date, message: 'I ate a bean bowl for lunch.', style: 'medium', consent: true, ...overrides});
}
function draft(overrides: Partial<CoachOutput['drafts'][number]> = {}): CoachOutput['drafts'][number] {
  const {confidence: _confidence, messageTime: _messageTime, photoId: _photoId, ...draftMeal} = meal;
  return coachOutputSchema.parse({
    text: 'This estimate is ready for review.',
    drafts: [{action: 'add', targetId: null, date, meal: draftMeal, assumptions: ['Synthetic portion estimate.'], ...overrides}],
  }).drafts[0];
}
function output(drafts = [draft()]): CoachOutput {
  return {text: 'This estimate is ready for review.', drafts};
}
function status(expected: number, message: RegExp) {
  return (error: unknown) => error instanceof Error && (error as Error & {status?: number}).status === expected && message.test(error.message);
}

/** Models owner isolation, optimistic revisions and atomic batches without a database or network. */
function harness(initial: Entry[] = []) {
  const journals = new Map<string, Map<string, Entry>>([[owner, new Map(initial.map(entry => [entry.id, structuredClone(entry)]))]]);
  const generations = new Map<string, number>();
  const locks = new Map<string, string>();
  const committed: {owner: string; inputs: SaveInput[]}[] = [];
  let clock = 0, token = 0;
  const hooks: {beforeBatch?: (inputs: SaveInput[]) => void; failBatchAt?: number; failUnlock?: boolean} = {};
  const records = (user = owner) => {
    if (!journals.has(user)) journals.set(user, new Map());
    return journals.get(user)!;
  };
  const guard = (user = owner): OperationGuard => ({generation: generations.get(user) ?? 1});
  function apply(user: string, target: Map<string, Entry>, input: SaveInput) {
    if (input.guard?.generation !== guard(user).generation)
      throw Object.assign(new Error('Journal generation changed'), {status: 409, staleOperation: true});
    const id = input.id ?? `synthetic-${++clock}`, previous = target.get(id);
    if (input.expectedRevision != null && previous?.revision !== input.expectedRevision)
      throw Object.assign(new Error('Revision conflict'), {status: 409});
    const duplicate = !!previous && previous.kind === input.kind && previous.localDate === input.localDate &&
      JSON.stringify(previous.data) === JSON.stringify(input.data) && !!previous.deleted === !!input.deleted;
    if (duplicate) return {entry: structuredClone(previous!), duplicate: true};
    const next: Entry = {
      id, kind: input.kind, localDate: input.localDate, source: previous?.source ?? input.source ?? 'manual',
      sourceId: previous?.sourceId ?? input.sourceId ?? id, revision: (previous?.revision ?? 0) + 1,
      updatedAt: new Date(Date.parse(now) + ++clock).toISOString(),
      data: structuredClone(input.data) as Record<string, unknown>, deleted: !!input.deleted,
    };
    target.set(id, next);
    return {entry: structuredClone(next), duplicate: false};
  }
  const store: CoachStore = {
    getEntry: async (user, id) => structuredClone(records(user).get(id) ?? null),
    listEntries: async user => [...records(user).values()].filter(entry => !entry.deleted).map(entry => structuredClone(entry)),
    saveEntry: async (user, input) => {
      const result = apply(user, records(user), input);
      committed.push({owner: user, inputs: [structuredClone(input)]});
      return result;
    },
    saveEntries: async (user, inputs) => {
      const hook = hooks.beforeBatch;
      delete hooks.beforeBatch;
      hook?.(inputs);
      const staged = new Map([...records(user)].map(([id, entry]) => [id, structuredClone(entry)]));
      const failAt = hooks.failBatchAt;
      delete hooks.failBatchAt;
      for (const [index, input] of inputs.entries()) {
        if (index === failAt) throw new Error('Simulated transaction failure');
        apply(user, staged, input);
      }
      journals.set(user, staged);
      committed.push({owner: user, inputs: structuredClone(inputs)});
    },
    acquireRefreshLock: async (user, name) => {
      const key = `${user}:${name}`;
      if (locks.has(key)) return null;
      const value = `lock-${++token}`;
      locks.set(key, value);
      return value;
    },
    releaseRefreshLock: async (user, name, value) => {
      const key = `${user}:${name}`;
      if (locks.get(key) === value) locks.delete(key);
      if (hooks.failUnlock) throw new Error('Synthetic unlock failure');
    },
  };
  let calls = 0;
  const generate = async () => { calls++; return {output: output(), model: 'synthetic-model'}; };
  const send = (input = request(), generator = generate, user = owner) => sendCoach(user, input, guard(user), store, generator, now);
  const decide = (decision: 'save' | 'dismiss' = 'save', id = proposalId, revision = 1, user = owner) =>
    decideCoach(user, {id, revision, decision}, guard(user), store);
  const revise = (id: string, data: object, deleted = false, user = owner) => {
    const previous = records(user).get(id)!;
    records(user).set(id, {...previous, revision: previous.revision + 1, data: structuredClone(data) as Record<string, unknown>, deleted});
  };
  return {
    store, records, guard, hooks, committed, send, decide, revise, calls: () => calls, locks,
    reset: (user = owner) => { generations.set(user, guard(user).generation + 1); journals.set(user, new Map()); },
  };
}

test('generation saves reviewable proposals, never meals or image bytes, and replay avoids another generation', async () => {
  const h = harness();
  const photo = {mimeType: 'image/png' as const, base64: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]).toString('base64')};
  const input = request({image: photo});
  const result = await h.send(input);
  assert.equal(h.calls(), 1);
  assert.equal(result.proposals.length, 1);
  assert.equal(result.proposals[0].data.status, 'pending');
  assert.equal(result.proposals[0].data.meal.confidence, 'estimate');
  assert.equal(result.proposals[0].data.meal.messageTime, now);
  assert.equal([...h.records().values()].filter(entry => entry.kind === 'meal').length, 0);
  assert.equal(h.committed.flatMap(batch => batch.inputs).filter(input => input.kind === 'meal').length, 0);
  assert.doesNotMatch(JSON.stringify([...h.records().values()]), new RegExp(photo.base64));
  assert.equal(h.records().get(`coach-user:${requestId}`)!.data.hasPhoto, true);
  const replay = await h.send(input);
  assert.deepEqual(replay, result);
  assert.equal(h.calls(), 1);
  assert.equal(h.locks.size, 0);
});

test('a reused request ID cannot change message, selected date, response style or photo', async () => {
  const h = harness();
  await h.send();
  for (const changed of [
    request({message: 'Different food'}),
    request({date: '2026-10-19'}),
    request({style: 'short'}),
    request({image: {mimeType: 'image/png', base64: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]).toString('base64')}}),
  ]) await assert.rejects(h.send(changed), status(409, /different message/));
  assert.equal(h.calls(), 1);
});

test('a reviewed matching photo uploads only on confirmation, attaches once, and is never stored in journal JSON', async () => {
  const h = harness(), files = new Map<string, string>(); let uploads = 0;
  const photo = {mimeType: 'image/png' as const, base64: Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0]).toString('base64')};
  const path = `${owner}/1/meal-photos/${requestId}-0.png`;
  h.store.saveMealPhoto = async (user, id, image, guard) => { assert.equal(user, owner); assert.equal(id, proposalId); assert.equal(guard.generation, 1); uploads++; files.set(path, image.base64); return path; };
  h.store.removeMealPhoto = async (_user, photoPath) => { files.delete(photoPath); };
  await h.send(request({image: photo}));
  assert.equal(files.size, 0);
  const confirmation = {id: proposalId, revision: 1, decision: 'save' as const, image: photo};
  const saved = await decideCoach(owner, confirmation, h.guard(), h.store);
  assert.equal(saved.meal?.data.photoId, path);
  assert.equal(files.size, 1);
  await decideCoach(owner, confirmation, h.guard(), h.store);
  assert.equal(uploads, 1);
  assert.equal([...h.records().values()].filter(row => row.kind === 'meal').length, 1);
  assert.ok(!JSON.stringify([...h.records().values()]).includes(photo.base64));
});

test('photo mismatch and dismissal cannot upload files, and an unsuccessful confirmation removes its orphan upload', async () => {
  const h = harness(), files = new Set<string>(); let uploads = 0, removals = 0;
  const photo = {mimeType: 'image/png' as const, base64: Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0]).toString('base64')};
  h.store.saveMealPhoto = async () => { uploads++; files.add('photo-path'); return 'photo-path'; };
  h.store.removeMealPhoto = async (_user, path) => { removals++; files.delete(path); };
  await h.send(request({image: photo}));
  const confirmation = {id: proposalId, revision: 1, decision: 'save' as const, image: photo};
  const different = {...photo, base64: Buffer.from([137,80,78,71,13,10,26,10,1,0,0,0]).toString('base64')};
  await assert.rejects(decideCoach(owner, {...confirmation, image: different}, h.guard(), h.store), /differs from the reviewed estimate/);
  await assert.rejects(decideCoach(owner, {...confirmation, decision: 'dismiss'}, h.guard(), h.store), /only with a confirmed meal/);
  assert.equal(uploads, 0);
  h.hooks.failBatchAt = 1;
  await assert.rejects(decideCoach(owner, confirmation, h.guard(), h.store), /Simulated transaction failure/);
  assert.equal(files.size, 0); assert.equal(removals, 1); assert.equal(h.records().has(mealId), false);
  assert.equal(h.records().get(proposalId)!.data.status, 'pending');
  await decideCoach(owner, confirmation, h.guard(), h.store);
  assert.equal(files.size, 1);
});

test('a lost save response preserves an earlier photo revision even if a later edit replaces its attachment', async () => {
  const h = harness(); let removals = 0;
  const photo = {mimeType: 'image/png' as const, base64: Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0]).toString('base64')};
  h.store.saveMealPhoto = async () => 'attached-photo';
  h.store.removeMealPhoto = async () => { removals++; };
  await h.send(request({image: photo}));
  const save = h.store.saveEntries;
  h.store.saveEntries = async (user, writes) => {
    await save(user, writes);
    h.revise(mealId, {...h.records().get(mealId)!.data, photoId: 'later-replacement-photo'});
    throw new Error('Response lost after commit');
  };
  const confirmation = {id: proposalId, revision: 1, decision: 'save' as const, image: photo};
  await assert.rejects(decideCoach(owner, confirmation, h.guard(), h.store), /Response lost/);
  assert.equal(removals, 0);
  const replay = await decideCoach(owner, confirmation, h.guard(), h.store);
  assert.equal(replay.meal?.data.photoId, 'later-replacement-photo');
});

test('explicit confirmation adds once and a replay preserves later corrections and deletion', async () => {
  const h = harness();
  await h.send();
  const saved = await h.decide();
  assert.equal(saved.meal?.id, mealId);
  assert.equal(saved.meal?.revision, 1);
  assert.equal((h.records().get(proposalId)!.data as unknown as CoachProposal).status, 'saved');
  h.revise(mealId, {...saved.meal!.data, calories: 350});
  const replay = await h.decide();
  assert.equal(replay.meal?.data.calories, 350);
  assert.equal(replay.meal?.revision, 2);
  h.revise(mealId, h.records().get(mealId)!.data, true);
  const deletedReplay = await h.decide();
  assert.equal(deletedReplay.meal, null);
  assert.equal(h.records().get(mealId)!.deleted, true);
  assert.equal(h.records().get(mealId)!.revision, 3);
  assert.equal(h.committed.flatMap(batch => batch.inputs).filter(input => input.kind === 'meal').length, 1);
  await assert.rejects(h.decide('dismiss'), status(409, /already handled differently/));
});

test('dismissal never adds a meal and cannot later be replayed as a save', async () => {
  const h = harness();
  await h.send();
  await h.decide('dismiss');
  await h.decide('dismiss');
  assert.equal(h.records().has(mealId), false);
  await assert.rejects(h.decide('save'), status(409, /already handled differently/));
});

test('correction uses its original revision, preserves provenance and accepts user-verified nutrition confidence', async () => {
  const original = record('meal', 'original', {...meal, messageTime: '2026-10-19T15:00:00Z', photoId: 'private-original'});
  const h = harness([original]);
  await h.send(request(), async () => ({
    output: output([draft({action: 'update', targetId: original.id, meal: {...draft().meal, calories: 400}})]), model: 'synthetic-model',
  }));
  const proposal = h.records().get(proposalId)!.data as unknown as CoachProposal;
  assert.equal(proposal.meal.confidence, 'estimate');
  const result = await decideCoach(owner, {
    id: proposalId, revision: 1, decision: 'save',
    meal: {...proposal.meal, mealType: 'Lunch', calories: 375, messageTime: now, confidence: 'label', photoId: 'replacement'},
  }, h.guard(), h.store);
  assert.equal(result.meal?.id, original.id);
  assert.equal(result.meal?.revision, 2);
  assert.equal(result.meal?.data.calories, 375);
  assert.equal(result.meal?.data.messageTime, original.data.messageTime);
  assert.equal(result.meal?.data.photoId, original.data.photoId);
  assert.equal(result.meal?.data.confidence, 'label');
  assert.equal([...h.records().values()].filter(entry => entry.kind === 'meal').length, 1);
});

test('a changed or deleted correction target requires a fresh proposal', async () => {
  for (const deleted of [false, true]) {
    const original = record('meal', 'original', meal), h = harness([original]);
    await h.send(request(), async () => ({
      output: output([draft({action: 'update', targetId: original.id})]), model: 'synthetic-model',
    }));
    h.revise(original.id, {...meal, calories: 325}, deleted);
    await assert.rejects(h.decide(), status(409, /original meal changed/));
    assert.equal(h.records().get(original.id)!.data.calories, 325);
    assert.equal(h.records().get(original.id)!.deleted, deleted);
    assert.equal(h.records().get(proposalId)!.data.status, 'pending');
  }
});

test('stale proposal revisions and a target race during confirmation cause no partial commits', async () => {
  const h = harness();
  await h.send();
  h.revise(proposalId, {...h.records().get(proposalId)!.data, assumptions: ['Changed in another session.']});
  await assert.rejects(h.decide(), status(409, /estimate changed/));
  assert.equal(h.records().has(mealId), false);

  const original = record('meal', 'original', meal), race = harness([original]);
  await race.send(request(), async () => ({
    output: output([draft({action: 'update', targetId: original.id})]), model: 'synthetic-model',
  }));
  race.hooks.beforeBatch = () => race.revise(original.id, {...meal, calories: 300});
  await assert.rejects(race.decide(), status(409, /Revision conflict/));
  assert.equal(race.records().get(original.id)!.data.calories, 300);
  assert.equal(race.records().get(proposalId)!.data.status, 'pending');
});

test('failed proposal/reply and meal/confirmation batches roll back together and can be retried', async () => {
  const h = harness();
  h.hooks.failBatchAt = 1;
  await assert.rejects(h.send(), /transaction failure/);
  assert.equal(h.records().has(`coach-user:${requestId}`), true);
  assert.equal(h.records().has(proposalId), false);
  assert.equal(h.records().has(`coach-reply:${requestId}`), false);
  await h.send();
  assert.equal(h.calls(), 2);
  h.hooks.failBatchAt = 1;
  await assert.rejects(h.decide(), /transaction failure/);
  assert.equal(h.records().has(mealId), false);
  assert.equal(h.records().get(proposalId)!.data.status, 'pending');
  await h.decide();
  assert.equal(h.records().get(mealId)!.revision, 1);
  assert.equal(h.records().get(proposalId)!.data.status, 'saved');
});

test('a journal reset during generation cannot resurrect messages, proposals or meals', async () => {
  const h = harness();
  await assert.rejects(h.send(request(), async () => {
    assert.equal(h.records().has(`coach-user:${requestId}`), true);
    h.reset();
    return {output: output(), model: 'synthetic-model'};
  }), status(409, /generation changed/));
  assert.equal(h.records().size, 0);
  assert.equal(h.locks.size, 0);
});

test('failed model attempts consume the hourly allowance and cannot reuse the ID for other content', async () => {
  const h = harness();
  let attempts = 0;
  const failed = async () => { attempts++; throw new Error('Synthetic unavailable model'); };
  for (let i = 0; i < 30; i++) await assert.rejects(h.send(request(), failed), /unavailable model/);
  assert.equal(attempts, 30);
  assert.equal((h.records().get(`coach-user:${requestId}`)!.data.attemptedAt as string[]).length, 30);
  await assert.rejects(h.send(request(), failed), status(429, /30 per hour/));
  await assert.rejects(h.send(request({id: secondId}), failed), status(429, /30 per hour/));
  await assert.rejects(h.send(request({message: 'Changed after failure'}), failed), status(409, /different message/));
  assert.equal(attempts, 30);
  assert.equal(h.records().has(`coach-user:${secondId}`), false);
  assert.equal([...h.records().values()].filter(entry => entry.kind !== 'message').length, 0);
  assert.equal(h.locks.size, 0);
});

test('the daily allowance applies outside the hourly window, while older attempts expire', async () => {
  const priorAttempts = Array.from({length: 100}, () => '2026-10-20T13:00:00Z');
  const previous = record('message', 'prior-attempts', {mode: 'ai-coach', role: 'user', text: 'Synthetic', attemptedAt: priorAttempts});
  const limited = harness([previous]);
  await assert.rejects(limited.send(), status(429, /100 per day/));
  assert.equal(limited.calls(), 0);
  const expired = harness([{...previous, data: {...previous.data, attemptedAt: priorAttempts.map(() => '2026-10-19T15:59:59Z')}}]);
  await expired.send();
  assert.equal(expired.calls(), 1);
});

test('one owner lock prevents overlapping paid generations but does not block another owner', async () => {
  const h = harness();
  let entered!: () => void, finish!: () => void;
  const running = new Promise<void>(resolve => { entered = resolve; });
  const completion = new Promise<void>(resolve => { finish = resolve; });
  let calls = 0;
  const pending = h.send(request(), async () => {
    calls++; entered(); await completion;
    return {output: output(), model: 'synthetic-model'};
  });
  await running;
  await assert.rejects(h.send(request({id: secondId})), status(429, /Another coach request/));
  await h.send(request(), async () => { calls++; return {output: output([]), model: 'synthetic-model'}; }, otherOwner);
  assert.equal(calls, 2);
  assert.equal(h.records(otherOwner).has(proposalId), false);
  finish();
  await pending;
  assert.equal(h.locks.size, 0);
  h.hooks.failUnlock = true;
  const replay = await h.send();
  assert.equal(replay.message.id, `coach-reply:${requestId}`);
});

test('untrusted draft target IDs cannot access absent, deleted, wrong-kind, old or other-owner records', async () => {
  const existing = record('meal', 'existing', meal);
  for (const target of [
    '../../other-owner/meal',
    'deleted',
    'wrong-kind',
    'old-meal',
    'other-owner-meal',
  ]) {
    const h = harness([
      existing,
      {...record('meal', 'deleted', meal), deleted: true},
      record('connection', 'wrong-kind', {secret: 'synthetic-not-for-model'}),
      record('meal', 'old-meal', meal, '2026-09-01'),
    ]);
    h.records(otherOwner).set('other-owner-meal', record('meal', 'other-owner-meal', meal));
    await assert.rejects(h.send(request(), async () => ({
      output: output([draft({action: 'update', targetId: target})]), model: 'synthetic-model',
    })), status(422, /identify the original meal safely/));
    assert.equal(h.records().has(proposalId), false);
    assert.equal(h.records().get(existing.id)!.revision, 1);
    assert.equal(h.records(otherOwner).get('other-owner-meal')!.revision, 1);
  }
});

test('invalid addition links, duplicate corrections and fabricated workout links never become proposals', async () => {
  const original = record('meal', 'original', meal);
  const cases: {drafts: CoachOutput['drafts']; message: RegExp}[] = [
    {drafts: [draft({targetId: original.id})], message: /identify the original meal safely/},
    {drafts: [draft({action: 'update', targetId: original.id}), draft({action: 'update', targetId: original.id})], message: /two corrections/},
    {drafts: [draft({meal: {...draft().meal, workoutId: 'fabricated-run'}})], message: /unknown run link/},
  ];
  for (const item of cases) {
    const h = harness([original]);
    await assert.rejects(h.send(request(), async () => ({output: output(item.drafts), model: 'synthetic-model'})), status(422, item.message));
    assert.equal(h.records().has(proposalId), false);
    assert.equal(h.records().get(original.id)!.revision, 1);
  }
});

test('decision IDs are structurally valid and valid-looking IDs never cross ownership', async () => {
  for (const id of [
    '../coach-proposal',
    `coach-user:${requestId}`,
    'coach-proposal:------------------------------------:0',
    `coach-proposal:${requestId}:0/../../meal`,
  ]) assert.equal(coachDecisionSchema.safeParse({id, revision: 1, decision: 'save'}).success, false, id);
  const h = harness();
  await h.send();
  await assert.rejects(h.decide('save', proposalId, 1, otherOwner), status(409, /no longer available/));
  assert.equal(h.records(otherOwner).size, 0);
  assert.equal(h.records().get(proposalId)!.data.status, 'pending');
});
