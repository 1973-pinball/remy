import { dayBounds, localDate, ofKind, type Entry, type Recovery } from './domain';
import { projectCycleExertion, recoverySleepCompletion } from './recovery-cycle';

type RecoveryData = Recovery & { sleepEnd?: unknown; raw?: unknown };
const metric = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : null;
function localTimestamp(value: string | null, timezone: string) {
  return value ? new Intl.DateTimeFormat('sv-SE', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', timeZoneName: 'shortOffset',
  }).format(new Date(value)) : null;
}

/** Project only the sleep-completion timestamp from provider data, never its raw
 * payload. Recovery belongs to the local day the associated sleep finished. */
export function recoveryContext(entry: Entry<Recovery>, date: string, timezone: string, now: string) {
  const data = entry.data as RecoveryData;
  const { supplied: suppliedSleepEnd, completedAt: sleepCompletedAt } = recoverySleepCompletion(data);
  const selectedDayEnd = Date.parse(dayBounds(date, timezone).end);
  const exertion = projectCycleExertion(data, {
    selectedDayEnd, now, currentDay: Number.isFinite(Date.parse(now)) && localDate(now, timezone) === date, updatedAt: entry.updatedAt,
  });
  const { start, end } = exertion;
  const dateBasis = sleepCompletedAt ? 'sleep-completion' as const
    : suppliedSleepEnd != null || !start ? 'unknown' as const : 'cycle-start-fallback' as const;
  const recoveryDate = sleepCompletedAt ? localDate(sleepCompletedAt, timezone)
    : dateBasis === 'cycle-start-fallback' ? localDate(start!, timezone) : null;
  const cutoff = Math.min(selectedDayEnd, Date.parse(now));
  const metricsAvailable = recoveryDate !== null && recoveryDate <= date &&
    (sleepCompletedAt ? Date.parse(sleepCompletedAt) < selectedDayEnd && Date.parse(sleepCompletedAt) <= cutoff : !!start && Date.parse(start) <= cutoff);
  const scope = recoveryDate === null ? 'date-unknown' as const
    : !metricsAvailable ? 'after-selected-period' as const
      : dateBasis === 'cycle-start-fallback' ? 'provisional-date' as const : 'sleep-completed' as const;
  return {
    id: entry.id, ...exertion, localStart: localTimestamp(start, timezone), localEnd: localTimestamp(end, timezone),
    recoveryDate, dateBasis, sleepCompletedAt, sleepCompletedLocal: localTimestamp(sleepCompletedAt, timezone),
    metricsScope: scope, scoreState: data.scoreState,
    recovery: metricsAvailable ? metric(data.recovery) : null,
    hrv: metricsAvailable ? metric(data.hrv) : null,
    restingHr: metricsAvailable ? metric(data.restingHr) : null,
    sleepHours: metricsAvailable ? metric(data.sleepHours) : null,
  };
}

/** Shared sidebar/model selection. Confirmed sleep dates outrank the explicit
 * legacy fallback; multiple sleeps on a date use the latest completion. */
export function recoveryForDate(entries: Entry[], date: string, timezone: string, now: string) {
  const candidates = ofKind<Recovery>(entries, 'recovery')
    .map(entry => recoveryContext(entry, date, timezone, now))
    .filter(cycle => cycle.recoveryDate === date &&
      (cycle.metricsScope === 'sleep-completed' || cycle.metricsScope === 'provisional-date') &&
      (cycle.recovery !== null || cycle.sleepHours !== null))
    .sort((a, b) => Number(b.dateBasis === 'sleep-completion') - Number(a.dateBasis === 'sleep-completion') ||
      (b.sleepCompletedAt ?? b.start ?? '').localeCompare(a.sleepCompletedAt ?? a.start ?? '') || a.id.localeCompare(b.id));
  return {
    selected: candidates[0] ?? null,
    matchingCycleCount: candidates.length,
    note: 'Recovery and sleep use the local sleep-completion date. If that timestamp is missing, cycle-start attribution is provisional; cycle expenditure remains a separate period.',
  };
}
