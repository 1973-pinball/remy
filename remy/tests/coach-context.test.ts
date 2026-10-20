import test from 'node:test';
import assert from 'node:assert/strict';
import {coachContextFingerprint, coachProgress, COACH_TARGETS} from '../lib/coach-context';
import type {Entry, Kind, Meal} from '../lib/domain';

const date = '2026-10-20';
const meal: Meal = {
  title: 'Synthetic meal', mealType: 'Lunch', mealTime: null, messageTime: null,
  notes: 'Synthetic test fixture', confidence: 'label', workoutId: null,
  calories: 500, carbs: 70, protein: 25, fat: 12, fiber: 8,
};
function entry(kind: Kind, id: string, data: object, day: string | null = date): Entry {
  return {id, kind, localDate: day, source: 'test', sourceId: id, revision: 1, updatedAt: `${date}T12:00:00Z`, data: data as Record<string, unknown>};
}
const complete = () => entry('day', 'day', {complete: true, adjustment: 0, adjustmentReason: '', feedback: ''});

test('empty and complete-but-empty days preserve unknown totals and undefined ratios', () => {
  for (const entries of [[], [complete()]]) {
    const result = coachProgress(entries, date);
    assert.deepEqual(result.totals, {calories: null, carbs: null, protein: null, fat: null, fiber: null});
    assert.deepEqual(result.nutrientCoverage.calories, {known: 0, total: 0, complete: false});
    assert.ok(result.etl.every(category => category.value === null && category.known === 0));
    assert.equal(result.flex.value, null);
    assert.equal(result.flex.loggedPercent, null);
    assert.equal(result.flex.ratioComplete, false);
    assert.equal(result.runFuelCalories, null);
  }
});

test('food-day completeness does not convert missing nutrient or category values into zeros', () => {
  const result = coachProgress([
    complete(),
    entry('meal', 'one', {...meal, protein: null, fiber: null, etl: {beansG: 0, rawVegetablesG: 100}}),
    entry('meal', 'two', {...meal, protein: 30, fiber: null, etl: {rawVegetablesG: null}}),
  ], date);
  assert.equal(result.foodComplete, true);
  assert.deepEqual(result.protein, {value: 30, range: [120, 135]});
  assert.deepEqual(result.nutrientCoverage.protein, {known: 1, total: 2, complete: false});
  assert.equal(result.totals.fiber, null);
  assert.deepEqual(result.etl.find(category => category.key === 'beansG'), {
    key: 'beansG', label: 'Beans', unit: 'g', value: 0, known: 1, total: 2, range: [500, 700],
  });
  assert.equal(result.etl.find(category => category.key === 'soyG')!.value, null);
  assert.equal(result.flex.loggedPercent, null);
});

test('run fuel counts once in intake and remains in the flex percentage denominator', () => {
  const result = coachProgress([
    complete(),
    entry('meal', 'food', {...meal, calories: 1800, etl: {flexCalories: 300, runFuelCalories: 0}}),
    entry('meal', 'fuel', {...meal, mealType: 'Run fuel', calories: 200, carbs: 50, etl: {flexCalories: 0, runFuelCalories: 200}}),
    entry('workout', 'run', {calories: 700}),
    entry('recovery', 'whoop', {kilojoules: 12000}),
  ], date);
  assert.equal(result.totals.calories, 2000);
  assert.equal(result.runFuelCalories, 200);
  assert.deepEqual(result.flex, {value: 300, range: [280, 300], loggedPercent: 15, ratioComplete: true});
  assert.equal('nutrientDensePercent' in result, false);
});

test('a percentage of fully classified logged meals is not a complete-day percentage', () => {
  const result = coachProgress([entry('meal', 'one', {...meal, calories: 1000, etl: {flexCalories: 100}})], date);
  assert.equal(result.flex.loggedPercent, 10);
  assert.equal(result.flex.ratioComplete, false);
  assert.equal(result.foodComplete, false);
});

test('a missing flex classification or calories suppresses the ratio instead of understating it', () => {
  const known = entry('meal', 'known', {...meal, etl: {flexCalories: 100}});
  for (const data of [
    {...meal},
    {...meal, etl: {flexCalories: null}},
    {...meal, calories: null, etl: {flexCalories: 0}},
    {...meal, etl: {flexCalories: 501}},
  ]) {
    const result = coachProgress([complete(), known, entry('meal', 'unknown', data)], date);
    assert.equal(result.flex.loggedPercent, null);
    assert.equal(result.flex.ratioComplete, false);
  }
});

test('explicit zero flex is known while zero total calories do not create a percentage', () => {
  const result = coachProgress([complete(), entry('meal', 'one', {...meal, etl: {flexCalories: 0}})], date);
  assert.equal(result.flex.value, 0);
  assert.equal(result.flex.loggedPercent, 0);
  assert.equal(result.flex.ratioComplete, true);
  const zero = coachProgress([complete(), entry('meal', 'zero', {...meal, calories: 0, etl: {flexCalories: 0}})], date);
  assert.equal(zero.flex.loggedPercent, null);
  assert.equal(zero.flex.ratioComplete, false);
});

test('date filtering and deleted records govern both intake and food completeness', () => {
  const result = coachProgress([
    entry('meal', 'today', {...meal, etl: {starchCups: 1.5, nutsSeedsG: 31, flexCalories: 30}}),
    entry('meal', 'yesterday', {...meal, calories: 9999}, '2026-10-19'),
    {...entry('meal', 'deleted', {...meal, calories: 9999}), deleted: true},
    {...complete(), deleted: true},
    entry('day', 'other-day', {complete: true}, '2026-10-19'),
  ], date);
  assert.equal(result.totals.calories, 500);
  assert.equal(result.foodComplete, false);
  assert.equal(result.etl.find(category => category.key === 'starchCups')!.value, 1.5);
  assert.deepEqual(result.nutrientCoverage.calories, {known: 1, total: 1, complete: true});
});

test('preference ranges are exact and intake above a range is not clipped', () => {
  assert.deepEqual(COACH_TARGETS, {
    protein: [120, 135], rawVegetablesG: [600, 800], cookedVegetablesG: [600, 800],
    beansG: [500, 700], soyG: [300, 450], fruitServings: [4, 6], starchCups: [1.5, 2.5],
    nutsSeedsG: [30, 45], flaxG: [10, 15], avocadoG: [50, 100], flexCalories: [280, 300],
  });
  const result = coachProgress([entry('meal', 'one', {...meal, protein: 150, etl: {beansG: 850, flexCalories: 350}})], date);
  assert.equal(result.protein.value, 150);
  assert.equal(result.etl.find(category => category.key === 'beansG')!.value, 850);
  assert.equal(result.flex.value, 350);
});

test('invalid legacy numeric values are unknown and output is deterministic without changing entries', () => {
  const entries = [entry('meal', 'one', {...meal, calories: NaN, protein: -1, fiber: Infinity, etl: {beansG: NaN, flexCalories: -1}})];
  const before = structuredClone(entries);
  const result = coachProgress(entries, date);
  assert.equal(result.totals.calories, null);
  assert.equal(result.protein.value, null);
  assert.equal(result.totals.fiber, null);
  assert.equal(result.etl.find(category => category.key === 'beansG')!.value, null);
  assert.equal(result.flex.value, null);
  assert.equal(result.flex.loggedPercent, null);
  assert.deepEqual(coachProgress(entries, date), result);
  assert.deepEqual(entries, before);
});

test('advice fingerprint detects additions, removals and revisions throughout the wider context window', () => {
  const relevant = [
    entry('meal', 'past-food', meal, '2026-09-23'),
    entry('workout', 'past-run', {durationSec: 3600}, '2026-10-01'),
    entry('profile', 'profile', {timezone: 'America/New_York', confirmed: true, weightKg: 70}, null),
    entry('plan', 'upcoming-plan', {title: 'Synthetic long run'}, '2026-10-27'),
    entry('recovery', 'overlapping-cycle', {start: '2026-09-22T23:00:00Z', end: '2026-09-23T05:00:00Z'}, '2026-09-22'),
    entry('day', 'past-completion', {complete: true}, '2026-10-05'),
    entry('connection', 'run-sync', {lastSyncedAt: `${date}T10:00:00Z`}, null),
  ];
  const empty = coachContextFingerprint([], date);
  for (const item of relevant) {
    const added = coachContextFingerprint([item], date);
    assert.notEqual(added, empty, `adding ${item.id} must invalidate advice even from an empty ledger`);
    assert.notEqual(coachContextFingerprint([{...item, revision: 2}], date), added, `revising ${item.id}`);
    assert.equal(coachContextFingerprint([{...item, deleted: true}], date), empty, `deleting ${item.id}`);
  }
  const all = coachContextFingerprint(relevant, date);
  for (const item of relevant) {
    assert.notEqual(coachContextFingerprint(relevant.filter(other => other.id !== item.id), date), all, `removing ${item.id}`);
  }
  assert.equal(coachContextFingerprint([...relevant].reverse(), date), all, 'entry ordering is immaterial');
});

test('chat activity and records outside the advice windows do not invalidate the saved advice fingerprint', () => {
  const base = [entry('meal', 'today-food', meal)];
  const ignored = [
    entry('message', 'coach-reply', {mode: 'ai-coach', role: 'assistant', text: 'Synthetic advice'}),
    entry('proposal', 'unsaved-food', {mode: 'ai-coach', status: 'pending', meal}),
    entry('meal', 'old-food', meal, '2026-09-22'),
    entry('workout', 'old-run', {durationSec: 3600}, '2026-09-22'),
    entry('meal', 'future-food', meal, '2026-10-21'),
    entry('plan', 'far-plan', {title: 'Synthetic run'}, '2026-10-28'),
    entry('plan', 'past-plan', {title: 'Synthetic run'}, '2026-10-19'),
    entry('recovery', 'finished-before-window', {start: '2026-09-22T04:00:00Z', end: '2026-09-23T04:00:00Z'}, '2026-09-22'),
    {...entry('profile', 'deleted-profile', {timezone: 'America/Los_Angeles'}, null), deleted: true},
  ];
  const expected = coachContextFingerprint(base, date);
  assert.equal(coachContextFingerprint([...base, ...ignored], date), expected);
  assert.equal(coachContextFingerprint([...base, ...ignored.map(item => ({...item, revision: 2}))], date), expected);
});
