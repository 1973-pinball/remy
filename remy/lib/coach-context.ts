import {addDays, dayBounds, ofKind, profileOf, round, type Day, type Entry, type EtlField, type HistoricalDailySummary, type Meal, type Nutrients, type Recovery} from './domain';
import { dailyClassification } from './daily-classification';

/** Reproducible in browser and server; includes changes to the wider advice window. */
export function coachContextFingerprint(entries: Entry[], date: string) {
  const from = addDays(date, -27), through = addDays(date, 7), zone = profileOf(entries).timezone;
  const start = Date.parse(dayBounds(from, zone).start), end = Date.parse(dayBounds(date, zone).end);
  return entries.filter(entry => {
    if (entry.deleted) return false;
    if (entry.kind === 'profile' || entry.kind === 'connection') return true;
    if (entry.kind === 'recovery') {
      const cycle = entry.data as unknown as Recovery;
      return Date.parse(cycle.start) < end && (cycle.end === null || Date.parse(cycle.end) > start);
    }
    if (!entry.localDate) return false;
    if (entry.kind === 'plan') return entry.localDate >= date && entry.localDate <= through;
    return ['meal', 'dailySummary', 'workout', 'day'].includes(entry.kind) && entry.localDate >= from && entry.localDate <= date;
  }).map(entry => `${entry.id}:${entry.revision}`).sort().join('|');
}

/** User preferences for maintenance and training, not required quotas or restrictive caps. */
export const COACH_TARGETS = {
  protein: [120, 135],
  rawVegetablesG: [600, 800],
  cookedVegetablesG: [600, 800],
  beansG: [500, 700],
  soyG: [300, 450],
  fruitServings: [4, 6],
  starchCups: [1.5, 2.5],
  nutsSeedsG: [30, 45],
  flaxG: [10, 15],
  avocadoG: [50, 100],
  flexCalories: [280, 300],
} as const;

export const COACH_REFERENCES = [
  {
    title: 'Nutrition and Athletic Performance — Academy, Dietitians of Canada and ACSM (2016)',
    url: 'https://www.dietitians.ca/DietitiansOfCanada/media/Documents/Resources/noap-position-paper.pdf',
  },
  {
    title: 'Australian Institute of Sport — Carbohydrate during exercise',
    url: 'https://www.ausport.gov.au/ais/nutrition/supplements/group_a/sports-foods2/sports-drink/how-and-when-do-i-use-it',
  },
  {
    title: 'Australian Institute of Sport — Protein needs and distribution',
    url: 'https://www.ausport.gov.au/ais/nutrition/supplements/group_a/sports-foods2/isolated-protein-supplement2',
  },
  {
    title: 'SDA and USSF — Exercise-associated gastrointestinal symptoms (2025)',
    url: 'https://link.springer.com/article/10.1007/s40279-025-02186-6',
  },
  {
    title: 'WHOOP — Calorie estimates and their limitations',
    url: 'https://www.whoop.com/us/en/thelocker/calorie-tracking-science/',
  },
  {
    title: 'WHOOP — Physiological cycles and score availability',
    url: 'https://developer.prod.whoop.com/docs/developing/user-data/cycle/',
  },
] as const;

export const COACH_PRINCIPLES = `
Support weight maintenance, muscle retention, running performance and recovery within the user's ETL preferences. The configured food and protein ranges are user preferences, not universal requirements, required quotas or restrictive caps. Do not prescribe weight loss or praise restriction.
Use recorded meals, training duration and intensity, upcoming demanding sessions, recovery trends, hunger and gut tolerance. Separate facts, estimates and unknowns. An incomplete log cannot establish insufficient intake. Do not invent quantities, food-category zeros, body weight, exercise or calorie expenditure.
Historical daily summaries are estimates with unknown full-day coverage, not individual meals. They provide daily totals only when the day has no meal records. When meals exist, only that meal ledger contributes to totals; never add the historical summary, infer missing meals from the difference or turn a summary into a meal proposal.
Use body-weight-based gram targets only with a confirmed profile and a finite positive current weight; otherwise keep g/kg guidance conditional. Daily carbohydrate references are 3–5 g/kg for light activity, 5–7 for about one hour of moderate daily training, and 6–10 for about one to three hours of moderate-to-high endurance training. Adapt these references to the whole training context, not a workout title alone. Before exercise over an hour, 1–4 g/kg in the preceding 1–4 hours is a broad reference adjusted to timing and tolerance. Rapid carbohydrate replacement of 1–1.2 g/kg/hour for four hours is chiefly relevant when demanding sessions are less than eight hours apart.
During endurance exercise of 1–2.5 hours, 30–60 g carbohydrate/hour is a reference; beyond about 2.5–3 hours, up to 90 g/hour may suit practiced tolerance. Do not jump an inexperienced runner directly to high intakes. Higher intakes may need glucose/fructose mixtures and gut practice.
Preserve the user's 120–135 g protein preference while checking fit against confirmed body weight and training. Spread protein across meals and snacks; approximately 0.3–0.4 g/kg per eating occasion is an AIS reference. Include varied plant protein choices that fit the user's preferences.
Do not let large vegetable or bean portions displace adequate energy, carbohydrate or comfortable eating. Move bulky or high-fiber foods away from runs when helpful and suggest familiar, tolerable carbohydrate choices. Do not impose a permanent low-fiber or low-FODMAP diet; recurrent symptoms need individualized assessment.
Keep calorie goals provisional until supported by adequate logs and longer-term weight, performance and recovery trends. WHOOP expenditure is an estimate over physiological cycles that can cross calendar days. Do not add workout calories again to a WHOOP total, diagnose underfueling from a subtraction, or treat a recovery score as a diagnosis.
For selected-day recovery and sleep, use today.recovery.selected and its explicit dateBasis. Sleep-completion dates are local to the supplied timezone; a cycle can begin the prior evening. Do not substitute a later morning's recovery, including figures quoted in earlier conversation. Cycle-start fallback dates are provisional, and unknown attribution remains unknown. Recovery history with metricsScope after-selected-period has its later sleep/recovery measurements withheld. Expenditure and strain use the supplied cycleMetricsScope and cycle period, never the selected calendar day; ongoing-cycle values are current recorded estimates with an as-of time. Running week totals are through the selected date; future planned sessions are separate.
Count run-fuel calories and carbohydrate once in total intake, while showing run fuel separately for timing. The user's ETL balance is 100% minus regular-flex calories divided by all logged calories; dedicated running fuel is neutral to this score and is not subtracted again. A reviewed daily conversation estimate can supply regular-flex classification even when individual meal classifications are missing; it never adds calories or nutrients. Use only a current, revision-bound estimate supplied in context. Older historical classifications may include running fuel; preserve that qualification and any source range. Missing classifications are unknown, not zero. The remainder is not an independent assessment of nutrient density. A fixed 280–300 kcal allowance is exactly 10% only at 2,800–3,000 kcal. Distinguish complete recorded classification from a complete food day.
Avoid diagnosing deficiencies, injuries or REDs from app data. Offer a few concrete, preference-aware next actions, identify the evidence and limitations that matter, and use the supplied references rather than inventing research.
`.trim();

type Range = readonly [number, number];
type FoodTargetKey = Exclude<keyof typeof COACH_TARGETS, 'protein' | 'flexCalories'>;
type Coverage = {known: number; total: number; complete: boolean};

const FOOD_TARGETS: readonly {key: FoodTargetKey; label: string; unit: string}[] = [
  {key: 'rawVegetablesG', label: 'Raw vegetables', unit: 'g'},
  {key: 'cookedVegetablesG', label: 'Cooked vegetables', unit: 'g'},
  {key: 'beansG', label: 'Beans', unit: 'g'},
  {key: 'soyG', label: 'Soy foods', unit: 'g'},
  {key: 'fruitServings', label: 'Fruit', unit: 'servings'},
  {key: 'starchCups', label: 'Starch', unit: 'cups'},
  {key: 'nutsSeedsG', label: 'Nuts and seeds', unit: 'g'},
  {key: 'flaxG', label: 'Flax', unit: 'g'},
  {key: 'avocadoG', label: 'Avocado', unit: 'g'},
];
const NUTRIENTS = ['calories', 'carbs', 'protein', 'fat', 'fiber'] as const;

function isKnown(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function aggregate(values: unknown[]) {
  const known = values.filter(isKnown);
  return {
    value: known.length ? round(known.reduce((sum, value) => sum + value, 0)) : null,
    known: known.length,
    total: values.length,
    complete: values.length > 0 && known.length === values.length,
  };
}

export interface CoachProgress {
  nutritionSource: 'meals'|'historical-summary'|'unknown';
  totals: Nutrients;
  nutrientCoverage: Record<keyof Nutrients, Coverage>;
  foodComplete: boolean;
  protein: {value: number | null; range: Range};
  etl: {key: FoodTargetKey; label: string; unit: string; value: number | null; known: number; total: number; range: Range}[];
  flex: {value: number | null; range: Range; loggedPercent: number | null; ratioComplete: boolean};
  runFuelCalories: number | null;
  scopeNotes: readonly string[];
}

/** Pure selected-day progress: no clock, profile defaults, device estimates or inferred food. */
export function coachProgress(entries: Entry[], date: string): CoachProgress {
  const meals = ofKind<Meal>(entries, 'meal').filter(meal => meal.localDate === date);
  const historical = !meals.length ? ofKind<HistoricalDailySummary>(entries,'dailySummary').filter(s=>s.localDate===date).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)||a.id.localeCompare(b.id))[0] : undefined;
  const records = meals.length ? meals.map(m=>m.data) : historical ? [historical.data] : [];
  const totals = {} as Nutrients;
  const nutrientCoverage = {} as Record<keyof Nutrients, Coverage>;
  for (const key of NUTRIENTS) {
    const {value, ...coverage} = aggregate(records.map(data => data[key]));
    if(historical)coverage.complete=false;
    totals[key] = value;
    nutrientCoverage[key] = coverage;
  }
  const category = (key: EtlField) => aggregate(records.map(data => data.etl?.[key]));
  const foodComplete = !historical && ofKind<Day>(entries, 'day').some(day => day.localDate === date && day.data.complete === true);
  const etl = FOOD_TARGETS.map(target => {
    const {value, known, total} = category(target.key);
    return {...target, value, known, total, range: COACH_TARGETS[target.key]};
  });
  const flex = category('flexCalories');
  // Both sides of the ratio must cover the same meals. An omitted classification is unknown.
  const ratioCovered = meals.length > 0 && meals.every(({data}) =>
    isKnown(data.calories) && isKnown(data.etl?.flexCalories) && data.etl.flexCalories <= data.calories,
  );
  const calorieSum = ratioCovered ? meals.reduce((sum, meal) => sum + meal.data.calories!, 0) : 0;
  const flexSum = ratioCovered ? meals.reduce((sum, meal) => sum + meal.data.etl!.flexCalories!, 0) : 0;
  const reviewed = dailyClassification(entries,date).value;
  const sourceFlex = reviewed ? reviewed.regularFlexCalories ?? (reviewed.regularFlexRange ? (reviewed.regularFlexRange[0]+reviewed.regularFlexRange[1])/2 : null) : null;
  const loggedPercent = sourceFlex !== null && reviewed ? round(sourceFlex / reviewed.totalCalories * 100) : calorieSum > 0 ? round(flexSum / calorieSum * 100) : null;

  return {
    nutritionSource: meals.length?'meals':historical?'historical-summary':'unknown',
    totals,
    nutrientCoverage,
    foodComplete,
    protein: {value: totals.protein, range: COACH_TARGETS.protein},
    etl,
    flex: {
      value: sourceFlex ?? flex.value,
      range: COACH_TARGETS.flexCalories,
      loggedPercent,
      ratioComplete: foodComplete && loggedPercent !== null,
    },
    runFuelCalories: reviewed?.runFuelCalories ?? category('runFuelCalories').value,
    scopeNotes: [
      ...(historical?['Displayed totals come from a historical daily estimate with unknown full-day coverage. Individual meals and ETL details cannot be inferred.']:[]),
      'Ranges are your preferences for maintenance and training, not required quotas or hard limits.',
      'Known sums cover recorded meals only. Missing nutrients or food categories remain unknown, including on a day marked complete.',
      'Regular-flex percentage uses all logged calories as its denominator. ETL balance is its complement; running fuel is neutral to the score. The remainder is not automatically nutrient-dense food.',
      ...(reviewed ? [`Regular-flex classification comes from a reviewed daily REMY conversation estimate bound to the current food records. ${reviewed.convention === 'historical-flex-including-any-run-fuel' ? 'This historical flex bucket included any running fuel, before the separate training-fuel rule.' : 'Dedicated running fuel is separate from regular flex.'}${reviewed.regularFlexRange ? ` Source flex range ${reviewed.regularFlexRange[0]}–${reviewed.regularFlexRange[1]} kcal; the displayed value is its midpoint.` : ''}`] : []),
      'Run fuel is shown separately and is already part of meal calorie totals; it is not added again.',
      'Confirm preparation, serving sizes and category overlap before comparing portions; do not count the same portion twice within a category.',
    ],
  };
}
