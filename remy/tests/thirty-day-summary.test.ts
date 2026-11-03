import test from 'node:test';
import assert from 'node:assert/strict';
import { dayBounds, type Entry, type Kind } from '../lib/domain';
import { dailyEnergyHistory, nutritionPeriodSummary } from '../lib/thirty-day-summary';

const now = '2026-11-03T20:00:00Z', zone = 'America/New_York';
const entry = (id: string, kind: Kind, data: Record<string, unknown>, date = '2026-11-02', source = 'test'): Entry =>
  ({id, kind, data, localDate: date, source, sourceId: id, revision: 1, updatedAt: now});
const food = (id: string, date: string, calories: number | null, extra: Record<string, unknown> = {}) =>
  entry(id, 'meal', {calories, protein: 100, carbs: 250, fat: 60, fiber: 40, ...extra}, date);
const cycle = (id: string, start: string, end: string | null, kcal: number, extra: Record<string, unknown> = {}) =>
  entry(id, 'recovery', {start, end, kilojoules: kcal * 4.184, scoreState: 'SCORED', ...extra}, start.slice(0, 10), 'whoop');
const dayCycle = (id: string, date: string, kcal: number) => {
  const bounds = dayBounds(date, zone);
  return cycle(id, bounds.start, bounds.end, kcal);
};
const close = (actual: number | null, expected: number) => assert.ok(actual !== null && Math.abs(actual - expected) < 0.00001, `${actual} ≠ ${expected}`);

test('headline windows contain completed local dates, with 30 days by default and no fabricated zero averages', () => {
  for (const selected of ['2026-11-02', '2026-11-03', '2099-01-01']) {
    const summary = nutritionPeriodSummary([], selected, 30, now);
    assert.equal(summary.from, '2026-10-04'); assert.equal(summary.through, '2026-11-02'); assert.equal(summary.dayCount, 30);
    assert.equal(summary.nutrients.calories.average, null); assert.equal(summary.nutrients.protein.knownDays, 0);
    assert.equal(summary.burn.average, null); assert.equal(summary.burn.missingDays, 30); assert.equal(summary.comparison.differenceAverage, null);
    assert.equal(summary.etl.percent, null);
  }
  const seven = nutritionPeriodSummary([], '2026-10-31', 7, now);
  assert.equal(seven.from, '2026-10-25'); assert.equal(seven.through, '2026-10-31'); assert.equal(seven.dayCount, 7);
  assert.equal(nutritionPeriodSummary([], '2026-11-02', 14, now).from, '2026-10-20');
  const la = nutritionPeriodSummary([entry('profile', 'profile', {timezone: 'America/Los_Angeles'})], '2026-11-03', 7, '2026-11-03T03:00:00Z');
  assert.equal(la.through, '2026-11-01');
});

test('averages use saved meal precedence, individual known nutrient coverage, and explicit zero values', () => {
  const records = [
    entry('old-summary', 'dailySummary', {calories: 9000, protein: 900}, '2026-10-31'),
    food('first', '2026-10-31', 600, {protein: 60, fiber: null}),
    food('second', '2026-11-01', 1000, {protein: 80, fiber: null}),
    food('unknown', '2026-11-01', null, {protein: null, carbs: null, fat: null, fiber: null}),
    entry('summary', 'dailySummary', {calories: 2000, protein: 120, carbs: 300, fat: 75, fiber: 50}, '2026-11-02'),
    food('future', '2026-11-03', 50000), { ...food('deleted', '2026-10-30', 50000), deleted: true },
  ];
  const copy = structuredClone(records), result = nutritionPeriodSummary(records, '2026-11-02', 7, now);
  assert.equal(result.nutrients.calories.average, 1200); assert.equal(result.nutrients.calories.knownDays, 3);
  assert.equal(result.nutrients.calories.partialDays, 1); assert.equal(result.nutrients.calories.historicalDays, 1);
  assert.equal(result.nutrients.fiber.average, 50); assert.equal(result.nutrients.fiber.knownDays, 1);
  close(result.nutrients.protein.average, 260 / 3); assert.deepEqual(records, copy);
  const zero = nutritionPeriodSummary([food('zero', '2026-11-02', 0, {protein: 0, carbs: 0, fat: 0, fiber: 0}), dayCycle('zero-burn', '2026-11-02', 0)], '2026-11-02', 7, now);
  assert.equal(zero.nutrients.calories.average, 0); assert.equal(zero.burn.average, 0); assert.equal(zero.comparison.differenceAverage, 0);
});

test('ETL uses a calorie-weighted share of classified days and reports excluded energy instead of inventing classifications', () => {
  const result = nutritionPeriodSummary([
    food('large', '2026-10-31', 2000, {etl: {flexCalories: 0, runFuelCalories: 0}}),
    food('small', '2026-11-01', 1000, {etl: {flexCalories: 1000, runFuelCalories: 0}}),
    food('unclassified', '2026-11-02', 3000),
  ], '2026-11-02', 7, now);
  close(result.etl.percent, 2000 / 3000 * 100); close(result.etl.flexPercent, 1000 / 3000 * 100);
  assert.equal(result.etl.classifiedDays, 2); assert.equal(result.etl.classifiedCalories, 3000);
  assert.equal(result.etl.knownCalories, 6000); assert.equal(result.etl.calorieCoveragePercent, 50);
  const bad = nutritionPeriodSummary([food('invalid', '2026-11-02', 100, {etl: {flexCalories: 110, runFuelCalories: 0}})], '2026-11-02', 7, now);
  assert.equal(bad.etl.percent, null); assert.equal(bad.etl.classifiedDays, 0);
});

test('WHOOP cycles are retrospectively prorated and difference compares only dates with both values', () => {
  const records = [
    food('unpaired', '2026-11-01', 3000), food('paired', '2026-11-02', 1000),
    cycle('first', '2026-11-01T17:00:00Z', '2026-11-02T17:00:00Z', 2400),
    cycle('second', '2026-11-02T17:00:00Z', '2026-11-03T17:00:00Z', 4800),
    entry('run', 'workout', {calories: 1500, sport: 'Run'}, '2026-11-02'),
  ];
  const result = nutritionPeriodSummary(records, '2026-11-02', 7, now);
  assert.equal(result.nutrients.calories.average, 2000); close(result.burn.average, 3600);
  assert.equal(result.burn.knownDays, 1); assert.equal(result.burn.partialDays, 1);
  assert.equal(result.comparison.pairedDays, 1); assert.equal(result.comparison.intakeAverage, 1000);
  close(result.comparison.burnAverage, 3600); close(result.comparison.differenceAverage, -2600);
  assert.match(result.method.burn, /retrospective approximation/); assert.match(result.method.comparison, /same dates/);
});

test('missing, open, pending, invalid, and overlapping cycles never become complete burn or double-counted energy', () => {
  const valid = dayCycle('valid', '2026-11-02', 2400);
  const excluded = [
    cycle('open', '2026-11-02T05:00:00Z', null, 2400),
    cycle('future-end', '2026-11-02T05:00:00Z', '2026-11-04T05:00:00Z', 2400),
    dayCycle('pending', '2026-11-02', 2400), cycle('backward', '2026-11-03T05:00:00Z', '2026-11-02T05:00:00Z', 2400),
    {...valid, id: 'not-whoop', source: 'another-provider'},
  ];
  excluded[2].data.scoreState = 'PENDING_SCORE';
  const missing = nutritionPeriodSummary(excluded, '2026-11-02', 7, now);
  assert.equal(missing.burn.knownDays, 0); assert.equal(missing.burn.cycleCount, 0);
  const overlap = nutritionPeriodSummary([valid, cycle('overlap', '2026-11-02T10:00:00Z', '2026-11-02T11:00:00Z', 500)], '2026-11-02', 7, now);
  assert.equal(overlap.burn.average, null); assert.equal(overlap.burn.overlappingDays, 1);
  const gap = nutritionPeriodSummary([cycle('gap', '2026-11-02T05:00:00Z', '2026-11-03T04:00:00Z', 2300)], '2026-11-02', 7, now);
  assert.equal(gap.burn.average, null); assert.equal(gap.burn.partialDays, 1);
  assert.equal(gap.days.at(-1)!.burnCoveredHours, 23);
});

test('DST dates use their actual 23 or 25 elapsed hours and all-history includes the earliest usable source', () => {
  for (const [date, hours, instant] of [['2026-03-08', 23, '2026-03-10T15:00:00Z'], ['2026-11-01', 25, now]] as const) {
    const result = nutritionPeriodSummary([dayCycle('dst', date, hours * 100), food('meal', date, 2000)], date, 'all', instant);
    assert.equal(result.dayCount, 1); assert.equal(result.from, date); assert.equal(result.days[0].hours, hours);
    assert.equal(result.days[0].burnCoveredHours, hours); close(result.burn.average, hours * 100);
  }
  const all = nutritionPeriodSummary([dayCycle('older-burn', '2026-10-25', 2400), food('first', '2026-10-31', 1000), food('last', '2026-11-02', 2000)], '2026-11-02', 'all', now);
  assert.equal(all.from, '2026-10-25'); assert.equal(all.through, '2026-11-02'); assert.equal(all.dayCount, 9);
  assert.equal(all.days[1].calories, null);
  const burnOnly = nutritionPeriodSummary([dayCycle('old', '2026-10-25', 2400)], '2026-11-02', 'all', now);
  assert.equal(burnOnly.from, '2026-10-25'); assert.equal(burnOnly.nutrients.calories.average, null); close(burnOnly.burn.average, 2400);
  const weightOnly = nutritionPeriodSummary([entry('weight', 'day', {weightKg: 75}, '2026-10-01')], '2026-11-02', 'all', now);
  assert.equal(weightOnly.from, '2026-10-01'); assert.equal(weightOnly.dayCount, 33);
});

test('full energy history uses its explicit date window independently of the headline range', () => {
  const records = [dayCycle('old', '2026-09-01', 2400), dayCycle('last', '2026-11-02', 2200)];
  const history = dailyEnergyHistory(records, '2026-09-01', '2026-11-03', now);
  assert.equal(history[0].date, '2026-09-01'); assert.equal(history.at(-1)!.date, '2026-11-03');
  close(history[0].burnKcal, 2400); close(history.find(day => day.date === '2026-11-02')!.burnKcal, 2200);
  assert.equal(history.at(-1)!.burnKcal, null);
  const headline = nutritionPeriodSummary(records, '2026-11-02', 7, now);
  assert.equal(headline.dayCount, 7); assert.equal(headline.days[0].date, '2026-10-27');
  assert.equal(history[0].date, '2026-09-01');
});
