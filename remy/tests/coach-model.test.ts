import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCoachContext, coachOutputSchema, coachRequestDigest, coachRequestSchema,
  generateCoach, validateCoachImage, type CoachRequest,
} from '../lib/coach-model';
import { addDays, DEFAULT_PROFILE, ETL_FIELDS, type Entry, type Kind, type Meal } from '../lib/domain';
import type { CoachImage } from '../lib/coach-types';

const date = '2026-04-04';
const now = '2026-04-04T16:00:00Z';
const requestId = '10000000-0000-4000-8000-000000000001';
const request = (changes: Partial<CoachRequest> = {}): CoachRequest => ({
  id: requestId, date, message: 'How should I fuel my next run?', style: 'medium', consent: true, ...changes,
});
const meal: Meal = {
  title: 'Synthetic oats', mealType: 'Breakfast', mealTime: null, messageTime: null,
  calories: 500, carbs: 70, protein: 25, fat: 15, fiber: 12,
  notes: 'Synthetic record', confidence: 'estimate', workoutId: null,
  etl: { fruitServings: 1, flexCalories: 0 },
};
function entry(kind: Kind, id: string, data: object, localDate: string | null = date): Entry {
  return {
    id, kind, localDate, source: 'synthetic', sourceId: id, revision: 1,
    updatedAt: now, data: data as Record<string, unknown>,
  };
}
const run = (overrides: Record<string, unknown> = {}) => ({
  title: 'Synthetic run', start: '2026-04-04T12:00:00Z', durationSec: 3600,
  distanceMeters: 10000, avgHr: 140, calories: 600, elevationMeters: 50,
  sport: 'running', notes: '', ...overrides,
});
const recovery = (overrides: Record<string, unknown> = {}) => ({
  start: '2026-04-04T04:00:00Z', end: '2026-04-05T04:00:00Z',
  scoreState: 'SCORED', kilojoules: 8368, recovery: 75, hrv: 45,
  restingHr: 50, sleepHours: 8, strain: 10, ...overrides,
});
const png: CoachImage = {
  mimeType: 'image/png',
  base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1cAAAAASUVORK5CYII=',
};
const draft = () => ({
  action: 'add', targetId: null, date,
  meal: {
    title: 'Synthetic oats', mealType: 'Breakfast', mealTime: null,
    notes: 'Portion estimated from the supplied description.', workoutId: null,
    calories: 500, carbs: 70, protein: 25, fat: 15, fiber: 12,
    etl: Object.fromEntries(ETL_FIELDS.map(key => [key, null])),
  },
  assumptions: ['One serving; preparation not measured.'],
});
const output = () => ({ text: 'This is an estimate awaiting review.', drafts: [draft()] });
const completed = (value: unknown) => ({
  status: 'completed',
  output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(value) }] }],
});
const context = () => buildCoachContext([], date, now);
const fakeFetch = (response: Response): typeof fetch => async () => response;

test('coach requests require explicit consent, usable input and bounded image/text fields', () => {
  assert.equal(coachRequestSchema.safeParse(request()).success, true);
  assert.equal(coachRequestSchema.safeParse({ ...request(), consent: false }).success, false);
  assert.equal(coachRequestSchema.safeParse({ ...request(), consent: undefined }).success, false);
  assert.equal(coachRequestSchema.safeParse(request({ message: '   ' })).success, false);
  assert.equal(coachRequestSchema.safeParse(request({ message: '', image: png })).success, true);
  assert.equal(coachRequestSchema.safeParse(request({ message: 'x'.repeat(6001) })).success, false);
  assert.equal(coachRequestSchema.safeParse({ ...request(), apiKey: 'never accept client keys' }).success, false);
  assert.equal(coachRequestSchema.safeParse({ ...request(), image: { url: 'https://example.invalid/image.png' } }).success, false);
});

test('photo validation rejects MIME mismatch, non-base64 content and excessive decoded bytes', () => {
  assert.match(validateCoachImage(png)!, /^[a-f0-9]{64}$/);
  assert.equal(validateCoachImage(), null);
  assert.throws(() => validateCoachImage({ ...png, mimeType: 'image/jpeg' }), /format does not match/);
  assert.throws(() => validateCoachImage({ ...png, base64: 'https://example.invalid/image.png' }), /valid JPEG/);
  assert.throws(() => validateCoachImage({ ...png, base64: 'AAAA' }), /900 KB/);
  const tooLarge = Buffer.alloc(900_001);
  Buffer.from(png.base64, 'base64').copy(tooLarge);
  assert.throws(() => validateCoachImage({ ...png, base64: tooLarge.toString('base64') }), /900 KB/);
});

test('retry digest binds the message, date, response style and photo content', () => {
  const initial = request({ image: png });
  const original = coachRequestDigest(initial);
  assert.equal(coachRequestDigest(structuredClone(initial)), original);
  for (const changed of [
    request({ image: png, message: 'A different meal' }),
    request({ image: png, date: '2026-04-03' }),
    request({ image: png, style: 'short' }),
    request(),
    request({ image: { ...png, base64: Buffer.concat([Buffer.from(png.base64, 'base64'), Buffer.from([0])]).toString('base64') } }),
  ]) assert.notEqual(coachRequestDigest(changed), original);
});

test('model context excludes identity, raw provider data, routes, credentials and original imports', () => {
  const privateMarkers = [
    'PRIVATE_PROFILE_NAME', 'PRIVATE_EMAIL', 'PRIVATE_ROUTE', 'PRIVATE_SOURCE_RESPONSE',
    'PRIVATE_CONNECTION_TOKEN', 'PRIVATE_IMPORT', 'PRIVATE_RECOVERY_RAW', 'PRIVATE_MESSAGE_METADATA',
    'PRIVATE_SYNC_ERROR',
  ];
  const records = [
    entry('profile', 'profile', { ...DEFAULT_PROFILE, name: privateMarkers[0], email: privateMarkers[1], weightKg: 75, confirmed: false }, null),
    entry('meal', 'meal', { ...meal, raw: privateMarkers[3] }),
    entry('workout', 'run', run({ raw: { route: privateMarkers[2] }, sourceRecords: privateMarkers[3], streams: privateMarkers[2] })),
    entry('recovery', 'cycle', recovery({ raw: privateMarkers[6] })),
    entry('connection', 'connection:strava', {
      provider: 'strava', lastSuccess: now, complete: false,
      access_token: privateMarkers[4], error: privateMarkers[8],
    }, null),
    entry('import', 'import', { original: privateMarkers[5] }, null),
    entry('message', 'message', { role: 'user', mode: 'ai-coach', text: 'Synthetic question', apiKey: privateMarkers[7], hasPhoto: true }),
    { ...entry('meal', 'deleted-meal', { ...meal, calories: 9000 }), deleted: true },
  ];
  const result = buildCoachContext(records, date, now);
  const serialized = JSON.stringify(result);
  for (const marker of privateMarkers) assert.ok(!serialized.includes(marker), marker);
  assert.equal(result.profile.weightKg, null);
  assert.equal(result.meals.length, 1);
  assert.equal(result.today.totals.calories, 500);
  assert.equal(result.recovery[0].expenditureKcal, 2000);
  assert.equal(result.conversation[0].hadPhoto, true);
  assert.deepEqual(result.connections, [{
    provider: 'strava', lastSuccess: now, lastAttempt: null,
    complete: false, disconnected: false, syncFailed: true,
  }]);
  assert.equal(result.today.foodComplete, false);
  assert.equal(result.today.planningCalories, DEFAULT_PROFILE.baseline);
});

test('context preserves unknown intake and bounds date ranges, detail counts and conversation history', () => {
  const records: Entry[] = [];
  for (let i = 0; i < 65; i++) records.push(entry('meal', `meal-${i}`, { ...meal, calories: null }));
  for (let i = 0; i < 85; i++) records.push(entry('workout', `run-${i}`, run()));
  for (let i = 0; i < 25; i++) records.push(entry('plan', `plan-${i}`, {
    title: 'Synthetic planned run', start: null, allDay: true, durationSec: 3600,
    distanceMeters: 10000, intensity: 'easy', notes: '', completedWorkoutId: null,
  }, addDays(date, 1)));
  for (let i = 0; i < 15; i++) records.push({
    ...entry('message', `message-${i}`, { role: 'user', mode: 'ai-coach', text: `turn-${i}` }),
    updatedAt: new Date(Date.parse(now) + i * 1000).toISOString(),
  });
  records.push(entry('meal', 'old-meal', meal, addDays(date, -3)));
  records.push(entry('workout', 'too-old-run', run(), addDays(date, -28)));
  records.push(entry('workout', 'future-run', run(), addDays(date, 1)));
  records.push(entry('plan', 'too-late-plan', {
    title: 'Outside context', start: null, allDay: true, durationSec: null,
    distanceMeters: null, intensity: '', notes: '', completedWorkoutId: null,
  }, addDays(date, 8)));
  const result = buildCoachContext(records, date, now);
  assert.equal(result.history.length, 28);
  assert.equal(result.history[0].date, addDays(date, -27));
  assert.equal(result.history.at(-1)!.date, date);
  assert.equal(result.today.totals.calories, null);
  assert.equal(result.today.nutrientCoverage.calories.complete, false);
  assert.equal(result.history[0].totals.calories, null);
  assert.equal(result.meals.length, 60);
  assert.equal(result.coverage.recentMealsOmitted, 5);
  assert.equal(result.running.recent.length, 80);
  assert.equal(result.coverage.runsOmitted, 5);
  assert.equal(result.plans.length, 20);
  assert.equal(result.coverage.plansOmitted, 5);
  assert.equal(result.conversation.length, 12);
  assert.equal(result.conversation[0].text, 'turn-3');
  assert.equal(result.conversation.at(-1)!.text, 'turn-14');
  assert.ok(!JSON.stringify(result.running).includes('too-old-run'));
  assert.ok(!JSON.stringify(result.running).includes('future-run'));
});

test('running context does not label other recorded sports as runs', () => {
  const result = buildCoachContext([
    entry('workout', 'run', run()),
    entry('workout', 'ride', run({ sport: 'cycling', durationSec: 7200, distanceMeters: 50000 })),
  ], date, now);
  assert.deepEqual(result.running.recent.map(row => row.id), ['run']);
  assert.equal(result.history.at(-1)!.runCount, 1);
  assert.equal(result.history.at(-1)!.runMinutes, 60);
});

test('historical recovery context excludes cycles beginning after the selected date', () => {
  const result = buildCoachContext([
    entry('recovery', 'selected-cycle', recovery()),
    entry('recovery', 'future-cycle', recovery({
      start: '2026-04-05T04:00:00Z', end: '2026-04-06T04:00:00Z', recovery: 99,
    }), '2026-04-05'),
  ], date, '2026-04-20T16:00:00Z');
  assert.equal(result.coverage.historyThrough, date);
  assert.equal(result.recovery.length, 1);
  assert.equal(result.recovery[0].recovery, 75);
});

test('pending cycle energy stays unknown without hiding independently scored recovery or sleep', () => {
  const result = buildCoachContext([
    entry('recovery', 'pending-cycle', recovery({
      scoreState: 'PENDING_SCORE', kilojoules: 8368, recovery: 75,
      hrv: null, restingHr: null, sleepHours: 8, strain: null,
    })),
  ], date, now);
  assert.equal(result.recovery[0].expenditureKcal, null);
  assert.equal(result.recovery[0].recovery, 75);
  assert.equal(result.recovery[0].sleepHours, 8);
  assert.equal(result.recovery[0].hrv, null);
  assert.equal(result.recovery[0].restingHr, null);
  assert.equal(result.recovery[0].strain, null);
});

test('drafts and earlier conversational estimates never inflate the saved nutrient ledger', () => {
  const records = [
    entry('meal', 'saved-meal', meal),
    entry('message', 'estimate-message', {
      role: 'assistant', mode: 'ai-coach', text: 'Estimated meal: 2000 kcal awaiting review.',
    }),
    ...['pending', 'saved', 'dismissed'].map(status => entry('proposal', `proposal:${status}`, {
      mode: 'ai-coach', status, action: 'add', date, meal: { ...meal, calories: 2000 },
    })),
  ];
  const result = buildCoachContext(records, date, now);
  assert.equal(result.today.totals.calories, 500);
  assert.equal(result.history.at(-1)!.totals.calories, 500);
  assert.equal(result.history.at(-1)!.meals, 1);
  assert.equal(result.meals.length, 1);
  assert.deepEqual(result.recentDrafts.map(proposal => proposal.status).sort(), ['dismissed', 'pending', 'saved']);
  assert.ok(result.recentDrafts.every(proposal => !Object.hasOwn(proposal, 'meal')));
});

test('coach output validates reviewable numbers and rejects unexpected or excessive drafts', () => {
  assert.equal(coachOutputSchema.safeParse(output()).success, true);
  for (const bad of [
    { ...output(), unexpectedInstruction: 'save immediately' },
    { text: '', drafts: [] },
    { text: 'Too many', drafts: Array.from({ length: 7 }, draft) },
    { text: 'Invalid', drafts: [{ ...draft(), date: '2026-02-30' }] },
    { text: 'Invalid', drafts: [{ ...draft(), meal: { ...draft().meal, calories: -1 } }] },
    { text: 'Invalid', drafts: [{ ...draft(), meal: { ...draft().meal, calories: 20000 } }] },
    { text: 'Invalid', drafts: [{ ...draft(), meal: { ...draft().meal, calories: '500' } }] },
    { text: 'Invalid', drafts: [{ ...draft(), meal: { ...draft().meal, confidence: 'label' } }] },
  ]) assert.equal(coachOutputSchema.safeParse(bad).success, false);
});

test('model request uses server authentication, no storage, strict structured output and only current image', async () => {
  let observed: { url: string; init: RequestInit } | undefined;
  const stub: typeof fetch = async (url, init) => {
    observed = { url: String(url), init: init! };
    return Response.json(completed(output()));
  };
  const result = await generateCoach(request({ image: png }), context(), { apiKey: 'synthetic-key', fetch: stub });
  assert.equal(result.output.drafts.length, 1);
  assert.equal(result.output.drafts[0].meal.calories, 500);
  assert.equal(observed!.url, 'https://api.openai.com/v1/responses');
  assert.equal(observed!.init.redirect, 'error');
  assert.equal(new Headers(observed!.init.headers).get('Authorization'), 'Bearer synthetic-key');
  assert.ok(observed!.init.signal instanceof AbortSignal);
  const body = JSON.parse(String(observed!.init.body));
  assert.equal(body.store, false);
  assert.equal(body.text.format.type, 'json_schema');
  assert.equal(body.text.format.strict, true);
  assert.equal(body.input.length, 1);
  assert.equal(body.input[0].content.filter((part: { type: string }) => part.type === 'input_image').length, 1);
  assert.equal(body.input[0].content[1].image_url, `data:image/png;base64,${png.base64}`);
  assert.equal(body.input[0].content[0].text.includes('synthetic-key'), false);
  assert.match(body.instructions, /untrusted DATA/);
  assert.match(body.instructions, /Drafts are NOT saved/);
});

test('invalid model configuration fails before any provider call', async () => {
  let called = false;
  const stub: typeof fetch = async () => { called = true; return Response.json(completed(output())); };
  await assert.rejects(generateCoach(request(), context(), { apiKey: 'synthetic-key', model: 'https://example.invalid/model', fetch: stub }), /configuration is invalid/);
  assert.equal(called, false);
});

test('upstream failures never return response bodies, keys or raw exception details', async () => {
  for (const status of [401, 403, 429, 500]) {
    await assert.rejects(
      generateCoach(request(), context(), { apiKey: 'synthetic-key', fetch: fakeFetch(new Response('PRIVATE_UPSTREAM_DETAILS', { status })) }),
      (error: Error & { status?: number }) => {
        assert.equal(error.status, 503);
        assert.doesNotMatch(error.message, /PRIVATE_UPSTREAM_DETAILS|synthetic-key/);
        return true;
      },
    );
  }
  const failed: typeof fetch = async () => { throw new Error('PRIVATE_NETWORK_DETAIL synthetic-key'); };
  await assert.rejects(
    generateCoach(request(), context(), { apiKey: 'synthetic-key', fetch: failed }),
    (error: Error & { status?: number }) => {
      assert.equal(error.status, 503);
      assert.doesNotMatch(error.message, /PRIVATE_NETWORK_DETAIL|synthetic-key/);
      return true;
    },
  );
});

test('incomplete, refused and invalid model output never becomes a reviewable answer', async () => {
  const cases: [unknown, RegExp][] = [
    [{ status: 'incomplete', output: [] }, /incomplete/],
    [{ status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'No' }] }] }, /could not help/],
    [{ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'not JSON' }] }] }, /valid reviewable answer/],
    [completed({ text: 'Bad nutrition', drafts: [{ ...draft(), meal: { ...draft().meal, protein: -10 } }] }), /valid reviewable answer/],
  ];
  for (const [body, expected] of cases)
    await assert.rejects(generateCoach(request(), context(), { apiKey: 'synthetic-key', fetch: fakeFetch(Response.json(body)) }), expected);
  await assert.rejects(generateCoach(request(), context(), { apiKey: 'synthetic-key', fetch: fakeFetch(new Response('not JSON')) }), /unreadable response/);
});

test('malformed provider envelopes produce a controlled error instead of a runtime TypeError', async () => {
  for (const body of [
    { status: 'completed', output: [null] },
    { status: 'completed', output: [{ type: 'message', content: [null] }] },
  ]) {
    await assert.rejects(
      generateCoach(request(), context(), { apiKey: 'synthetic-key', fetch: fakeFetch(Response.json(body)) }),
      (error: Error) => {
        assert.ok(!(error instanceof TypeError), error.message);
        assert.match(error.message, /unreadable response|valid reviewable answer|incomplete/);
        return true;
      },
    );
  }
});
