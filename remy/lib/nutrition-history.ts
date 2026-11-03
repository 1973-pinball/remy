import { addDays, ofKind, type Entry, type HistoricalDailySummary, type Meal, type Nutrients } from './domain';
import { coachProgress } from './coach-context';

export type NutritionRange = 7 | 14 | 28 | 'all';
export const NUTRITION_KEYS = ['calories', 'protein', 'carbs', 'fat', 'fiber'] as const;
const known = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
export interface NutritionHistoryDay extends Nutrients {
  date: string;
  source: 'meals' | 'historical-summary' | 'unknown';
  foodComplete: boolean;
  coverage: Record<keyof Nutrients, {known: number; total: number; complete: boolean}>;
  etlPercent: number | null;
  flexPercent: number | null;
  runFuelPercent: number | null;
  shareStatus: 'known' | 'no-intake' | 'missing-calories' | 'missing-classification' | 'invalid-classification' | 'zero-calories';
}

/** The chart is the saved ledger, never an interpolation or a sum of summaries
 * and meals. Partial known nutrient sums keep their explicit coverage. */
export function nutritionHistory(entries: Entry[], through: string, range: NutritionRange): NutritionHistoryDay[] {
  const dates = entries.filter(e => !e.deleted && ['meal', 'dailySummary'].includes(e.kind) && e.localDate && e.localDate <= through)
    .map(e => e.localDate!).sort();
  const from = range === 'all' ? dates[0] ?? through : addDays(through, 1 - range);
  const result: NutritionHistoryDay[] = [];
  for (let date = from; date <= through; date = addDays(date, 1)) {
    const progress = coachProgress(entries, date);
    const meals = ofKind<Meal>(entries, 'meal').filter(e => e.localDate === date);
    const historical = !meals.length ? ofKind<HistoricalDailySummary>(entries, 'dailySummary').filter(e => e.localDate === date)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id))[0] : null;
    const records = meals.length ? meals.map(e => e.data) : historical ? [historical.data] : [];
    let shareStatus: NutritionHistoryDay['shareStatus'] = 'known';
    if (!records.length) shareStatus = 'no-intake';
    else if (records.some(r => !known(r.calories))) shareStatus = 'missing-calories';
    else if (records.some(r => !known(r.etl?.flexCalories) || !known(r.etl?.runFuelCalories))) shareStatus = 'missing-classification';
    else if (records.some(r => r.etl!.flexCalories! + r.etl!.runFuelCalories! > r.calories!)) shareStatus = 'invalid-classification';
    const calories = records.reduce((sum, r) => sum + (known(r.calories) ? r.calories : 0), 0);
    if (shareStatus === 'known' && calories === 0) shareStatus = 'zero-calories';
    const flex = records.reduce((sum, r) => sum + (known(r.etl?.flexCalories) ? r.etl.flexCalories : 0), 0);
    const fuel = records.reduce((sum, r) => sum + (known(r.etl?.runFuelCalories) ? r.etl.runFuelCalories : 0), 0);
    result.push({date, ...progress.totals, source: progress.nutritionSource, foodComplete: progress.foodComplete,
      coverage: progress.nutrientCoverage, shareStatus,
      etlPercent: shareStatus === 'known' ? (calories - flex - fuel) / calories * 100 : null,
      flexPercent: shareStatus === 'known' ? flex / calories * 100 : null,
      runFuelPercent: shareStatus === 'known' ? fuel / calories * 100 : null,
    });
  }
  return result;
}

export const shareExplanation: Record<NutritionHistoryDay['shareStatus'], string> = {
  known: 'Share of recorded energy; full-day coverage may be incomplete.',
  'no-intake': 'No saved intake for this date.',
  'missing-calories': 'Energy is unknown for one or more records.',
  'missing-classification': 'Flex or running-fuel calories are unclassified in one or more records.',
  'invalid-classification': 'Flex plus running-fuel calories exceed a record’s total; review their overlap.',
  'zero-calories': 'An energy share cannot be calculated from zero recorded calories.',
};
