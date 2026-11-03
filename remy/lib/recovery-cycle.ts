/** Dependency-free cycle projection shared by summaries and coach context. */
type CycleData = {
  start: unknown; end: unknown; scoreState?: unknown; kilojoules?: unknown;
  strain?: unknown; sleepEnd?: unknown; raw?: unknown;
};
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const instant = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
const metric = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : null;

export function recoverySleepCompletion(data: Pick<CycleData, 'sleepEnd' | 'raw'>) {
  const supplied = data.sleepEnd ?? object(object(data.raw).sleep).end;
  return { supplied, completedAt: instant(supplied) };
}

export function projectCycleExertion(data: CycleData, options: {
  selectedDayEnd: number; now: string; currentDay: boolean; updatedAt: string;
}) {
  const start = instant(data.start), end = instant(data.end);
  const startMs = start ? Date.parse(start) : NaN, endMs = end ? Date.parse(end) : NaN;
  const cutoff = Math.min(options.selectedDayEnd, Date.parse(options.now));
  const sleepCompletedAt = recoverySleepCompletion(data).completedAt;
  const futureSleep = !!sleepCompletedAt &&
    (Date.parse(sleepCompletedAt) >= options.selectedDayEnd || Date.parse(sleepCompletedAt) > cutoff);
  // A completed cycle is available only after its whole period ended. Open
  // cycles are current-day recorded estimates, never historical final totals.
  const scope = !start || data.end != null && !end || end && endMs <= startMs
    ? 'period-unknown' as const
    : startMs >= options.selectedDayEnd || startMs > cutoff || futureSleep
      ? 'after-selected-period' as const
      : end ? endMs <= cutoff ? 'completed-cycle' as const : 'after-selected-period' as const
        : options.currentDay ? 'ongoing-cycle' as const : 'after-selected-period' as const;
  const available = scope === 'completed-cycle' || scope === 'ongoing-cycle';
  const kilojoules = metric(data.kilojoules);
  return {
    start, end, cycleMetricsScope: scope,
    cycleMetricsAsOf: scope === 'completed-cycle' ? end : scope === 'ongoing-cycle' ? instant(options.updatedAt) : null,
    expenditureKcal: available && data.scoreState === 'SCORED' && kilojoules !== null ? Math.round(kilojoules / 4.184) : null,
    expenditurePeriod: scope === 'ongoing-cycle'
      ? 'Ongoing WHOOP physiological cycle; current recorded estimate, not calendar-day energy'
      : 'Full WHOOP physiological cycle; not calendar-day energy',
    strain: available ? metric(data.strain) : null,
  };
}
