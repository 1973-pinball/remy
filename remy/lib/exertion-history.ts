import { addDays, dayBounds, ofKind, profileOf, round, type Entry, type Recovery, type Workout } from './domain';
import { recoveryContext, recoveryForDate } from './recovery-context';
import { milesFromMeters } from './run-distance';

/** Saved runs and separately attributed WHOOP cycles. Missing metrics stay unknown. */
export function exertionHistory(records: Entry[], through: string, range: number, now = new Date().toISOString()) {
  const runs = ofKind<Workout>(records, 'workout').filter(workout => /run|treadmill/i.test(workout.data.sport));
  const zone = profileOf(records).timezone;
  return Array.from({length: range}, (_, index) => {
    const date = addDays(through, index - range + 1), today = runs.filter(workout => workout.localDate === date);
    const distances = today.map(workout => workout.data.distanceMeters).filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0);
    const durations = today.map(workout => workout.data.durationSec).filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0);
    const cycle = recoveryForDate(records, date, zone, now).selected;
    return {
      date, miles: distances.length ? Math.round(milesFromMeters(distances.reduce((a,b) => a+b, 0)) * 100) / 100 : null,
      minutes: durations.length ? round(durations.reduce((a,b) => a+b, 0) / 60) : null,
      runCount: today.length, distanceKnown: distances.length, durationKnown: durations.length,
      recovery: cycle?.recovery ?? null, strain: cycle?.strain ?? null, burn: cycle?.expenditureKcal ?? null,
      period: cycle ? `${cycle.localStart} → ${cycle.localEnd ?? 'ongoing'}` : null,
      recoveryDateBasis: cycle?.dateBasis ?? null, cycleMetricsScope: cycle?.cycleMetricsScope ?? null,
    };
  });
}

/** Complete cycles remain separate periods, including those whose end crosses a
 * sleep date. The current selection bounds what was completed, not a food day. */
export function completedCycleHistory(records: Entry[], through: string, range: number, now = new Date().toISOString()) {
  const zone = profileOf(records).timezone, start = Date.parse(dayBounds(addDays(through, 1-range), zone).start);
  return ofKind<Recovery>(records, 'recovery').map(entry => ({
    ...recoveryContext(entry, through, zone, now), source: entry.source,
  })).filter(cycle => cycle.cycleMetricsScope === 'completed-cycle' && cycle.end !== null && Date.parse(cycle.end) > start)
    .sort((a,b) => b.end!.localeCompare(a.end!) || a.id.localeCompare(b.id));
}
