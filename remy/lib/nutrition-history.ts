import { addDays, ofKind, type Entry, type HistoricalDailySummary, type Meal, type Nutrients } from './domain';
import { coachProgress } from './coach-context';
import { dailyClassification } from './daily-classification';

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
  etlPercentRange: [number, number] | null;
  shareBasis: 'meal-estimates' | 'daily-conversation-estimate' | 'historical-conversation-estimate' | 'unknown';
  shareNotes: string | null;
  shareStatus: 'known' | 'no-intake' | 'missing-calories' | 'missing-classification' | 'invalid-classification' | 'zero-calories' | 'stale-classification';
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
    else if (records.some(r => !known(r.etl?.flexCalories))) shareStatus = 'missing-classification';
    else if (records.some(r => r.etl!.flexCalories! > r.calories!)) shareStatus = 'invalid-classification';
    const calories = records.reduce((sum, r) => sum + (known(r.calories) ? r.calories : 0), 0);
    if (shareStatus === 'known' && calories === 0) shareStatus = 'zero-calories';
    const flex = records.reduce((sum, r) => sum + (known(r.etl?.flexCalories) ? r.etl.flexCalories : 0), 0);
    const fuel = records.reduce((sum, r) => sum + (known(r.etl?.runFuelCalories) ? r.etl.runFuelCalories : 0), 0);
    const fuelKnown = records.length > 0 && records.every(r => known(r.calories) && known(r.etl?.runFuelCalories) && r.etl.runFuelCalories <= r.calories!);
    let flexPercent = shareStatus === 'known' ? flex / calories * 100 : null;
    let runFuelPercent = fuelKnown && calories > 0 ? fuel / calories * 100 : null;
    let etlPercentRange: [number,number] | null = null;
    let shareBasis: NutritionHistoryDay['shareBasis'] = shareStatus === 'known' ? 'meal-estimates' : 'unknown';
    let shareNotes: string | null = null;
    const reviewed = dailyClassification(entries, date);
    if (reviewed.value && calories > 0) {
      const source = reviewed.value, range = source.regularFlexRange;
      const sourceFlex = source.regularFlexCalories ?? (range ? (range[0]+range[1])/2 : null);
      if (known(sourceFlex) && sourceFlex <= source.totalCalories) {
        flexPercent = sourceFlex / source.totalCalories * 100;
        if (range) etlPercentRange = [(1-range[1]/source.totalCalories)*100,(1-range[0]/source.totalCalories)*100];
        runFuelPercent = known(source.runFuelCalories) ? source.runFuelCalories / source.totalCalories * 100 : runFuelPercent;
        shareStatus = 'known';
        shareBasis = source.convention === 'training-fuel-neutral' ? 'daily-conversation-estimate' : 'historical-conversation-estimate';
        shareNotes = `${source.notes}${range ? ' The plotted point is the midpoint of the source range.' : ''}${source.convention === 'historical-flex-including-any-run-fuel' ? ' Historical flex included any running fuel; this predates the separate training-fuel rule.' : ''}`;
      }
    } else if (reviewed.stale && shareStatus !== 'known') {
      shareStatus = 'stale-classification';
      shareNotes = 'Food entries changed after this daily source estimate was reconciled. Its classification is withheld until reviewed again.';
    }
    result.push({date, ...progress.totals, source: progress.nutritionSource, foodComplete: progress.foodComplete,
      coverage: progress.nutrientCoverage, shareStatus, shareBasis, shareNotes, etlPercentRange,
      etlPercent: flexPercent === null ? null : 100 - flexPercent,
      flexPercent, runFuelPercent,
    });
  }
  return result;
}

export const shareExplanation: Record<NutritionHistoryDay['shareStatus'], string> = {
  known: 'ETL balance is 100% minus regular-flex calories as a share of recorded intake. Running fuel is shown separately.',
  'no-intake': 'No saved intake for this date.',
  'missing-calories': 'Energy is unknown for one or more records.',
  'missing-classification': 'Regular-flex calories are unclassified in one or more records and no reviewed daily estimate is available.',
  'invalid-classification': 'Regular-flex calories exceed a record’s total; review the classification.',
  'zero-calories': 'An energy share cannot be calculated from zero recorded calories.',
  'stale-classification': 'Food records changed after the daily classification was reconciled; review the source estimate again.',
};
