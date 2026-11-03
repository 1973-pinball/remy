import { ofKind, type Entry, type HistoricalDailySummary, type Meal } from './domain';

/** A reviewed daily source estimate. It annotates the food ledger, never adds food. */
export interface DailyNutritionClassification {
  version: 1;
  totalCalories: number;
  regularFlexCalories: number | null;
  regularFlexRange?: [number, number] | null;
  runFuelCalories: number | null;
  convention: 'training-fuel-neutral' | 'historical-flex-including-any-run-fuel';
  sourceMessageIds: string[];
  sourceConversationId: string;
  notes: string;
  foodFingerprint: string;
  reviewedAt: string;
}

export function dailyFoodRecords(entries: Entry[], date: string) {
  const meals = ofKind<Meal>(entries, 'meal').filter(e => e.localDate === date);
  if (meals.length) return meals;
  const summary = ofKind<HistoricalDailySummary>(entries, 'dailySummary').filter(e => e.localDate === date)
    .sort((a,b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id))[0];
  return summary ? [summary] : [];
}

/** Revision binding invalidates the estimate after a meal is added, corrected or deleted. */
export function foodClassificationFingerprint(entries: Entry[], date: string) {
  return JSON.stringify(dailyFoodRecords(entries, date).map(e => [e.id, e.revision]).sort((a,b) => String(a[0]).localeCompare(String(b[0]))));
}

export function dailyClassification(entries: Entry[], date: string) {
  const day = entries.find(e => !e.deleted && e.kind === 'day' && e.id === `day:${date}`);
  const value = day?.data.nutritionClassification as DailyNutritionClassification | undefined;
  if (!value) return { value: null, stale: false };
  const foods = dailyFoodRecords(entries, date);
  const calories = foods.reduce((total,e) => total + (e.data.calories ?? 0), 0);
  const valid = value.version === 1 && foods.length > 0 && foods.every(e => e.data.calories !== null) &&
    value.foodFingerprint === foodClassificationFingerprint(entries,date) &&
    Math.abs(calories - value.totalCalories) <= Math.max(2, calories * .01);
  return { value: valid ? value : null, stale: !valid };
}
