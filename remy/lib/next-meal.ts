import { COACH_TARGETS } from './coach-context';
import { round, type summarize } from './domain';

/** A current-record suggestion, never a calorie-gap calculation or an old AI reply. */
export function nextMealSuggestion(summary: ReturnType<typeof summarize>) {
  const protein = summary.totals.protein, [lower, upper] = COACH_TARGETS.protein;
  const runs = summary.workouts.filter(run => /run|treadmill/i.test(run.data.sport) && Date.parse(run.data.start) <= Date.parse(summary.generatedAt));
  const upcoming = summary.nextLong ?? summary.plans[0];
  const hasTraining = runs.length > 0 || !!upcoming, reachedLower = protein !== null && protein >= lower;
  const coverage = summary.nutrientCoverage.protein;
  const proteinLine = protein === null ? 'Your recorded protein total is still unknown.'
    : summary.nutritionSource === 'historical-summary' ? `The historical estimate records ${round(protein)} g protein; full-day coverage is unknown.`
      : `${round(protein)} g protein recorded${coverage.known < coverage.total ? ` across ${coverage.known}/${coverage.total} meals with known protein` : ''}; your usual daily range is ${lower}–${upper} g.`;
  const restriction = /allerg|avoid|free|\bno\b/i.test(summary.profile.diet);
  const meal = restriction ? 'a protein that fits your preferences, a tolerated starch and vegetables'
    : 'beans or whole soy, rice or potatoes, and vegetables';
  const title = hasTraining ? reachedLower ? 'Keep carbs in your next normal meal.' : 'Carbs and protein for your next meal.'
    : reachedLower ? 'Let appetite guide your next meal.' : protein === null ? 'Start with a balanced meal you can log.' : 'Give your next meal a protein anchor.';
  const mealLine = `${runs.length ? 'After the recorded run, try' : 'Try'} ${meal}. ${upcoming ? 'Near the planned session, choose familiar carbs and a fiber level you tolerate.' : 'Let hunger and comfortable portions guide the meal.'}`;
  const recordNote = summary.nutritionSource === 'historical-summary' ? 'Historical estimate · individual meals unknown.'
    : summary.meals.length ? `${summary.meals.length} ${summary.meals.length === 1 ? 'meal' : 'meals'} recorded${summary.day.complete ? ' · logging marked complete.' : ' · unlogged food remains unknown.'}` : 'No food logged for this date yet.';
  const trainingNote = [runs.length ? `${runs.length} ${runs.length === 1 ? 'run' : 'runs'} recorded.` : '', upcoming ? `Next: ${upcoming.data.title} on ${upcoming.localDate}.` : ''].filter(Boolean).join(' ');
  return {title, body: `${proteinLine} ${mealLine}`, note: `${recordNote}${trainingNote ? ` ${trainingNote}` : ''}`};
}
