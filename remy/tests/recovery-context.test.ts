import test from 'node:test';
import assert from 'node:assert/strict';
import { recoveryContext, recoveryForDate } from '../lib/recovery-context';
import { buildCoachContext } from '../lib/coach-model';
import { localDate, summarize, type Entry, type Recovery } from '../lib/domain';
import { insights } from '../lib/insights';

const zone = 'America/New_York', now = '2026-11-03T15:00:00Z';
function cycle(id: string, start: string, end: string | null, sleepEnd: string | null, recovery: number): Entry {
  return { id, kind: 'recovery', localDate: localDate(start, zone), source: 'whoop', sourceId: id,
    revision: 1, updatedAt: now, data: { start, end, scoreState: 'SCORED', kilojoules: 8368,
      recovery, hrv: 60, restingHr: 50, sleepHours: recovery === 21 ? 6.36 : 7.93, strain: 10,
      raw: { privateMarker: 'PRIVATE_RAW_MUST_NOT_LEAK', sleep: sleepEnd === null ? null : {end: sleepEnd, other: 'PRIVATE_SLEEP_MUST_NOT_LEAK'} },
    } };
}
const previous = cycle('previous', '2026-11-01T04:36:00Z', '2026-11-02T05:29:00Z', '2026-11-01T12:55:00Z', 37);
const selected = cycle('selected', '2026-11-02T05:29:00Z', '2026-11-03T03:19:00Z', '2026-11-02T12:17:00Z', 21);
const next = cycle('next', '2026-11-03T03:19:00Z', null, '2026-11-03T11:57:00Z', 64);
const records = [previous, selected, next];

test('selected-day recovery follows local sleep completion rather than latest overlapping cycle', () => {
  const before = structuredClone(records), daily = recoveryForDate(records, '2026-11-02', zone, now);
  assert.equal(daily.selected?.id, 'selected');
  assert.equal(daily.selected?.recovery, 21);assert.equal(daily.selected?.sleepHours, 6.36);
  assert.equal(daily.selected?.dateBasis, 'sleep-completion');assert.equal(daily.matchingCycleCount, 1);
  assert.equal(recoveryForDate(records, '2026-11-03', zone, now).selected?.recovery, 64);
  assert.deepEqual(records, before, 'Attribution must never modify provider records');
  assert.equal(recoveryForDate([{...selected, deleted:true}, next], '2026-11-02', zone, now).selected, null);
});

test('coach and sidebar share the selected recovery and withhold next-morning measurements from a past day', () => {
  const context = buildCoachContext(records, '2026-11-02', now);
  assert.deepEqual(context.today.recovery, recoveryForDate(records, '2026-11-02', zone, now));
  const later = context.recovery.find(row => row.id === 'next')!;
  assert.equal(later.recoveryDate, '2026-11-03');assert.equal(later.metricsScope, 'after-selected-period');
  for (const field of ['recovery','hrv','restingHr','sleepHours'] as const) assert.equal(later[field], null);
  assert.match(later.localStart!, /2026-11-02 22:19:00 GMT[-−]5/);
  assert.equal(later.expenditureKcal, null, 'Later-cycle exertion is not available as of the selected day');
  assert.equal(later.strain, null);assert.equal(later.cycleMetricsScope, 'after-selected-period');
  assert.match(later.expenditurePeriod, /not calendar-day/);
  assert.doesNotMatch(JSON.stringify(context), /PRIVATE_RAW_MUST_NOT_LEAK|PRIVATE_SLEEP_MUST_NOT_LEAK/);
});

test('historical recovery stays available while a cycle ending after the selected-day cutoff withholds final exertion', () => {
  const crossing = cycle('crossing', '2026-11-02T05:29:00Z', '2026-11-03T06:00:00Z', '2026-11-02T12:17:00Z', 21);
  const before = structuredClone(crossing);
  const projected = recoveryContext(crossing as unknown as Entry<Recovery>, '2026-11-02', zone, now);
  assert.equal(projected.recovery, 21);assert.equal(projected.sleepHours, 6.36);
  assert.equal(projected.cycleMetricsScope, 'after-selected-period');
  assert.equal(projected.expenditureKcal, null);assert.equal(projected.strain, null);
  assert.equal(projected.cycleMetricsAsOf, null);
  assert.equal(projected.end, '2026-11-03T06:00:00.000Z', 'Keep the actual cycle period visible');
  assert.deepEqual(crossing, before, 'Do not change provider data');
  const completed = recoveryContext(selected as unknown as Entry<Recovery>, '2026-11-02', zone, now);
  assert.equal(completed.cycleMetricsScope, 'completed-cycle');
  assert.equal(completed.expenditureKcal, 2000);assert.equal(completed.strain, 10);
  assert.equal(completed.cycleMetricsAsOf, '2026-11-03T03:19:00.000Z');
});

test('current ongoing cycles expose a clearly scoped recorded estimate, while future and historical open cycles do not', () => {
  const current = recoveryContext(next as unknown as Entry<Recovery>, '2026-11-03', zone, now);
  assert.equal(current.cycleMetricsScope, 'ongoing-cycle');
  assert.equal(current.expenditureKcal, 2000);assert.equal(current.strain, 10);
  assert.equal(current.cycleMetricsAsOf, new Date(now).toISOString());
  assert.match(current.expenditurePeriod, /Ongoing.*recorded estimate.*not calendar-day/);
  const historicalOpen = cycle('open', '2026-11-02T05:29:00Z', null, '2026-11-02T12:17:00Z', 21);
  assert.equal(recoveryContext(historicalOpen as unknown as Entry<Recovery>, '2026-11-02', zone, now).expenditureKcal, null);
  const beforeWake = recoveryContext(next as unknown as Entry<Recovery>, '2026-11-03', zone, '2026-11-03T10:00:00Z');
  assert.equal(beforeWake.expenditureKcal, null);assert.equal(beforeWake.strain, null);
  const future = cycle('future', '2026-11-03T16:00:00Z', null, null, 50);
  assert.equal(recoveryContext(future as unknown as Entry<Recovery>, '2026-11-03', zone, now).strain, null);
});

test('cycle completion at the local midnight cutoff is included and malformed periods stay unknown', () => {
  const boundary = cycle('boundary', '2026-11-01T04:36:00Z', '2026-11-02T05:00:00Z', '2026-11-01T12:55:00Z', 37);
  const projected = recoveryContext(boundary as unknown as Entry<Recovery>, '2026-11-01', zone, now);
  assert.equal(projected.cycleMetricsScope, 'completed-cycle');assert.equal(projected.expenditureKcal, 2000);
  for (const end of ['invalid end', '2026-11-01T04:00:00Z']) {
    const invalid = {...boundary, data:{...boundary.data, end}};
    const result = recoveryContext(invalid as unknown as Entry<Recovery>, '2026-11-01', zone, now);
    assert.equal(result.cycleMetricsScope, 'period-unknown');assert.equal(result.expenditureKcal, null);assert.equal(result.strain, null);
  }
});

test('daily summaries and legacy insight headlines share the coach cutoff without exposing a later cycle total', () => {
  const crossing = cycle('crossing', '2026-11-02T05:29:00Z', '2026-11-03T06:00:00Z', '2026-11-02T12:17:00Z', 21);
  for (const row of [crossing, next]) {
    const summary = summarize([row], '2026-11-02', {now});
    assert.equal(summary.expenditure.length, 1);
    assert.equal(summary.expenditure[0].kcal, null);
    assert.equal(summary.expenditure[0].cycleMetricsScope, 'after-selected-period');
    const headline = insights([row], '2026-11-02', {now}).headline.body;
    assert.match(headline, /not available as of this date/);
    assert.doesNotMatch(headline, /2,000 kcal|completed physiological cycle/);
  }
  const completed = summarize([selected], '2026-11-02', {now}).expenditure[0];
  assert.equal(completed.kcal, 2000);assert.equal(completed.cycleMetricsScope, 'completed-cycle');
  assert.match(insights([selected], '2026-11-02', {now}).headline.body, /2,000 kcal for its completed physiological cycle/);
  const current = summarize([next], '2026-11-03', {now}).expenditure[0];
  const projected = recoveryContext(next as unknown as Entry<Recovery>, '2026-11-03', zone, now);
  assert.equal(current.kcal, projected.expenditureKcal);assert.equal(current.cycleMetricsScope, projected.cycleMetricsScope);
  assert.equal(current.cycleMetricsAsOf, projected.cycleMetricsAsOf);
  assert.match(insights([next], '2026-11-03', {now}).headline.body, /ongoing physiological cycle.*current recorded estimate, not a final cycle total/);
});

test('sleep completion crosses the daylight-saving transition using the configured local timezone', () => {
  const projection = recoveryContext(previous as unknown as Entry<Recovery>, '2026-11-01', zone, now);
  assert.equal(projection.recoveryDate, '2026-11-01');
  assert.match(projection.localStart!, /2026-11-01 00:36:00 GMT[-−]4/);
  assert.match(projection.sleepCompletedLocal!, /2026-11-01 07:55:00 GMT[-−]5/);
  assert.equal(recoveryForDate(records, '2026-11-01', zone, now).selected?.id, 'previous');
});

test('missing completion uses an explicit provisional date while invalid or unfinished completion remains unknown', () => {
  const fallback = cycle('legacy', selected.data.start as string, selected.data.end as string, null, 55);
  const projected = recoveryForDate([fallback], '2026-11-02', zone, now).selected!;
  assert.equal(projected.dateBasis, 'cycle-start-fallback');assert.equal(projected.metricsScope, 'provisional-date');
  assert.equal(recoveryForDate([fallback, selected], '2026-11-02', zone, now).selected?.id, 'selected');
  const invalid = {...fallback, data:{...fallback.data, sleepEnd:'invalid timestamp'}};
  assert.equal(recoveryForDate([invalid], '2026-11-02', zone, now).selected, null);
  const invalidProjection = recoveryContext(invalid as unknown as Entry<Recovery>, '2026-11-02', zone, now);
  assert.equal(invalidProjection.dateBasis, 'unknown');assert.equal(invalidProjection.recovery, null);
  assert.equal(recoveryForDate([next], '2026-11-03', zone, '2026-11-03T10:00:00Z').selected, null,
    'A sleep finishing after the request time cannot supply current-day recovery');
});

test('historical coaching week excludes later completed runs while preserving clearly dated future plans', () => {
  const run = (id: string, date: string, distanceMeters: number): Entry => ({
    id, kind:'workout', source:'strava', sourceId:id, revision:1, updatedAt:now, localDate:date,
    data:{title:'Synthetic run',start:`${date}T15:00:00Z`,sport:'running',durationSec:2400,distanceMeters,avgHr:130},
  });
  const context = buildCoachContext([run('selected-run','2026-11-02',6450),run('later-run','2026-11-03',12000),{
    id:'future-plan',kind:'plan',source:'runna',sourceId:'future-plan',revision:1,updatedAt:now,localDate:'2026-11-03',
    data:{title:'Planned easy run',start:'2026-11-03T16:00:00Z',allDay:false,durationSec:3600,distanceMeters:10000,intensity:'easy',notes:'',completedWorkoutId:null},
  }], '2026-11-02', now);
  assert.equal(context.running.week.through,'2026-11-02');assert.equal(context.running.week.count,1);
  assert.equal(context.running.week.km,6.5);assert.deepEqual(context.running.recent.map(row=>row.id),['selected-run']);
  assert.equal(context.plans.length,1);assert.equal(context.plans[0].date,'2026-11-03');
  assert.doesNotMatch(JSON.stringify(context.running),/later-run/);
  const weekly = insights([run('selected-run','2026-11-02',6450),run('later-run','2026-11-03',12000)], '2026-11-02', {now})
    .observations.find(item => item.id === 'weekly-running')!;
  assert.match(weekly.body, /1 completed run across 1 day/);
  assert.deepEqual(weekly.recordLinks.map(link => link.id), ['selected-run']);
});
