import { addDays, dayBounds, localDate, ofKind, profileOf, type Entry, type Nutrients, type Recovery, type Workout } from './domain';
import { NUTRITION_KEYS, nutritionHistory, type NutritionHistoryDay } from './nutrition-history';
import { weightHistory } from './weight-history';

export type SummaryRange = 7 | 14 | 30 | 'all';
type NutrientAverage = {
  average: number | null; total: number | null; knownDays: number;
  partialDays: number; completeLogDays: number; historicalDays: number;
};
type BurnStatus = 'complete' | 'partial' | 'overlap' | 'missing';
export type PeriodSummaryDay = NutritionHistoryDay & {
  burnKcal: number | null; burnStatus: BurnStatus; burnCoveredHours: number; hours: number;
};
type Cycle = { id: string; start: number; end: number; kcal: number };
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const mean = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const sum = (values: number[]) => values.length ? values.reduce((total, value) => total + value, 0) : null;

function validDate(date: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(`${date}T12:00:00Z`)) && new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) === date;
}

function completedCycles(records: Entry[], from: string, through: string, now: string, timezone: string): Cycle[] {
  const windowStart = Date.parse(dayBounds(from, timezone).start), windowEnd = Date.parse(dayBounds(through, timezone).end), nowMs = Date.parse(now);
  return ofKind<Recovery>(records, 'recovery').filter(entry => entry.source === 'whoop').flatMap(entry => {
    const start = Date.parse(entry.data.start), end = entry.data.end === null ? NaN : Date.parse(entry.data.end);
    return entry.data.scoreState === 'SCORED' && finite(entry.data.kilojoules) && Number.isFinite(start) && Number.isFinite(end)
      && end > start && end <= nowMs && start < windowEnd && end > windowStart
      ? [{id: entry.id, start, end, kcal: entry.data.kilojoules / 4.184}] : [];
  });
}

function blankDay(date: string): NutritionHistoryDay {
  return {
    date, calories: null, protein: null, carbs: null, fat: null, fiber: null,
    source: 'unknown', foodComplete: false,
    coverage: Object.fromEntries(NUTRITION_KEYS.map(key => [key, {known: 0, total: 0, complete: false}])) as NutritionHistoryDay['coverage'],
    etlPercent: null, flexPercent: null, runFuelPercent: null, shareStatus: 'no-intake',
    etlPercentRange: null, shareBasis: 'unknown', shareNotes: null,
  };
}

/** A cycle estimate is allocated uniformly across its elapsed time. This is a
 * retrospective approximation, not hourly measured expenditure. A date with a
 * gap or overlapping cycles cannot supply a complete daily burn estimate. */
function burnForDay(cycles: Cycle[], start: number, end: number) {
  const segments = cycles.filter(cycle => cycle.start < end && cycle.end > start)
    .map(cycle => ({start: Math.max(start, cycle.start), end: Math.min(end, cycle.end), cycle}))
    .sort((a, b) => a.start - b.start || a.end - b.end || a.cycle.id.localeCompare(b.cycle.id));
  let covered = 0, cursor = start, overlap = false, kcal = 0;
  for (const segment of segments) {
    if (segment.start < cursor) overlap = true;
    covered += Math.max(0, segment.end - Math.max(cursor, segment.start));
    cursor = Math.max(cursor, segment.end);
    kcal += segment.cycle.kcal * (segment.end - segment.start) / (segment.cycle.end - segment.cycle.start);
  }
  const status: BurnStatus = overlap ? 'overlap' : covered === end - start ? 'complete' : covered > 0 ? 'partial' : 'missing';
  return {burnKcal: status === 'complete' ? kcal : null, burnStatus: status, burnCoveredHours: covered / 3_600_000, hours: (end - start) / 3_600_000};
}

/** Full-history charts use their own inclusive window, independently of the
 * headline selector. Future, unfinished, or incompletely covered days stay gaps. */
export function dailyEnergyHistory(records: Entry[], from: string, through: string, now = new Date().toISOString()) {
  if (!validDate(from) || !validDate(through) || !Number.isFinite(Date.parse(now))) throw new Error('Choose valid energy-history dates.');
  const timezone = profileOf(records).timezone, cycles = completedCycles(records, from, through, now, timezone);
  const days: Array<{date: string} & ReturnType<typeof burnForDay>> = [];
  for (let date = from; date <= through; date = addDays(date, 1)) {
    const bounds = dayBounds(date, timezone);
    days.push({date, ...burnForDay(cycles, Date.parse(bounds.start), Date.parse(bounds.end))});
  }
  return days;
}

/** Headline averages over completed local dates. Saved meals take precedence
 * over historical daily summaries through the shared nutrition aggregation. */
export function nutritionPeriodSummary(records: Entry[], selectedDate: string, range: SummaryRange = 30, now = new Date().toISOString()) {
  if (!validDate(selectedDate))
    throw new Error('Choose a valid summary date.');
  if (!Number.isFinite(Date.parse(now))) throw new Error('A valid current time is required.');
  if (![7, 14, 30, 'all'].includes(range)) throw new Error('Choose a supported summary range.');
  const timezone = profileOf(records).timezone, yesterday = addDays(localDate(now, timezone), -1);
  const through = selectedDate < yesterday ? selectedDate : yesterday;
  const saved = nutritionHistory(records, through, 'all');
  const firstFood = saved.find(day => day.source !== 'unknown')?.date;
  const cycleDates = ofKind<Recovery>(records, 'recovery').filter(entry => entry.source === 'whoop' && entry.data.scoreState === 'SCORED'
    && finite(entry.data.kilojoules) && Number.isFinite(Date.parse(entry.data.start)) && entry.data.end !== null
    && Date.parse(entry.data.end) > Date.parse(entry.data.start) && Date.parse(entry.data.end) <= Date.parse(now))
    .map(entry => localDate(entry.data.start, timezone)).filter(date => date <= through);
  const weightDates = weightHistory(records).map(point => point.date).filter(date => date <= through);
  // Each canonical workout is counted once; linked provider snapshots are evidence,
  // not additional runs.
  const savedRuns = ofKind<Workout>(records, 'workout').filter(entry => /run|treadmill/i.test(entry.data.sport)
    && entry.localDate !== null && validDate(entry.localDate) && entry.localDate <= through);
  const runDates = savedRuns.map(entry => entry.localDate!);
  const firstRecorded = [...(firstFood ? [firstFood] : []), ...cycleDates, ...weightDates, ...runDates].sort()[0] ?? through;
  const from = range === 'all' ? firstRecorded : addDays(through, 1 - range);
  const nutritionByDate = new Map(saved.map(day => [day.date, day]));
  const cycles = completedCycles(records, from, through, now, timezone);
  const days: PeriodSummaryDay[] = [];
  for (let date = from; date <= through; date = addDays(date, 1)) {
    const bounds = dayBounds(date, timezone);
    days.push({... (nutritionByDate.get(date) ?? blankDay(date)), ...burnForDay(cycles, Date.parse(bounds.start), Date.parse(bounds.end))});
  }
  const runs = savedRuns.filter(entry => entry.localDate! >= from);
  const runDistances = runs.map(entry => entry.data.distanceMeters).filter(finite);
  const runMeters = sum(runDistances), totalMiles = runMeters === null ? null : runMeters / 1609.344;
  const missingDistanceRuns = runs.length - runDistances.length;
  const nutrients = Object.fromEntries(NUTRITION_KEYS.map(key => {
    const known = days.filter(day => finite(day[key])), values = known.map(day => day[key]!);
    return [key, {
      average: mean(values), total: sum(values), knownDays: known.length,
      partialDays: known.filter(day => day.source === 'meals' && day.coverage[key].known < day.coverage[key].total).length,
      completeLogDays: known.filter(day => day.foodComplete).length,
      historicalDays: known.filter(day => day.source === 'historical-summary').length,
    } satisfies NutrientAverage];
  })) as Record<keyof Nutrients, NutrientAverage>;
  const burned = days.filter(day => day.burnKcal !== null), burnValues = burned.map(day => day.burnKcal!);
  const paired = burned.filter(day => finite(day.calories));
  const shareDays = (key: 'etlPercent' | 'flexPercent' | 'runFuelPercent') => days.filter(day => finite(day[key]) && day[key]! <= 100 && finite(day.calories) && day.calories > 0);
  const classified = shareDays('etlPercent');
  const classifiedCalories = classified.reduce((total, day) => total + day.calories!, 0);
  const knownCalories = nutrients.calories.total;
  const weightedShare = (key: 'etlPercent' | 'flexPercent' | 'runFuelPercent') => {
    const available = shareDays(key), calories = available.reduce((total, day) => total + day.calories!, 0);
    return calories > 0 ? available.reduce((total, day) => total + day.calories! * day[key]!, 0) / calories : null;
  };
  return {
    from, through, timezone, range, dayCount: days.length, days,
    nutrients,
    training: {
      milesPerWeek: totalMiles === null ? null : totalMiles / days.length * 7,
      totalMiles, runCount: runs.length, knownDistanceRuns: runDistances.length,
      missingDistanceRuns, partial: missingDistanceRuns > 0,
    },
    burn: {
      average: mean(burnValues), total: sum(burnValues), knownDays: burned.length,
      missingDays: days.filter(day => day.burnStatus === 'missing').length,
      partialDays: days.filter(day => day.burnStatus === 'partial').length,
      overlappingDays: days.filter(day => day.burnStatus === 'overlap').length,
      cycleCount: cycles.length,
    },
    comparison: {
      intakeAverage: mean(paired.map(day => day.calories!)), burnAverage: mean(paired.map(day => day.burnKcal!)),
      differenceAverage: mean(paired.map(day => day.calories! - day.burnKcal!)), pairedDays: paired.length,
      partialIntakeDays: paired.filter(day => day.source === 'meals' && day.coverage.calories.known < day.coverage.calories.total).length,
      completeFoodDays: paired.filter(day => day.foodComplete).length,
    },
    etl: {
      percent: weightedShare('etlPercent'), flexPercent: weightedShare('flexPercent'), runFuelPercent: weightedShare('runFuelPercent'),
      classifiedDays: classified.length, classifiedCalories, knownCalorieDays: nutrients.calories.knownDays, knownCalories,
      flexClassifiedDays: shareDays('flexPercent').length, runFuelClassifiedDays: shareDays('runFuelPercent').length,
      calorieCoveragePercent: knownCalories !== null && knownCalories > 0 ? classifiedCalories / knownCalories * 100 : null,
    },
    method: {
      training: 'Miles/week is saved running distance divided by the selected completed calendar days, multiplied by seven. Days without a saved run remain in the denominator. Each canonical run is counted once, regardless of linked sources. Missing distances make the rate partial; missing source history can also understate it. With no known running distance, the value stays unknown.',
      burn: 'WHOOP estimates from completed, scored cycles are spread across their actual elapsed hours to estimate calendar-day burn. Only fully covered days without overlapping cycles enter the average; workout calories are not added again. This is a retrospective approximation, not hourly measured expenditure.',
      comparison: 'Logged intake minus estimated burn uses only the same dates with both values. Unlogged food remains unknown, and this is not a measured energy surplus or deficit.',
      etl: 'ETL percentage is weighted by logged calories across days with a known ETL percentage. Unclassified days are excluded, not counted as zero. Running fuel is tracked separately and does not lower the ETL score.',
    },
  };
}
