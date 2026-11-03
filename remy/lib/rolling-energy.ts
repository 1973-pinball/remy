import { addDays } from './domain';

type DailyNet = {date: string; netKcal: number | null};

/** Inclusive seven-calendar-day sum. Missing or unknown dates remain gaps;
 * seven observed values spread across a longer period are not a valid window. */
export function withRollingSevenDayNet<T extends DailyNet>(days: readonly T[]): Array<T & {rollingNetKcal: number | null}> {
  const byDate = new Map(days.map(day => [day.date, day.netKcal]));
  return days.map(day => {
    let rollingNetKcal: number | null = 0;
    for (let offset = -6; offset <= 0; offset++) {
      const amount = byDate.get(addDays(day.date, offset));
      if (typeof amount !== 'number' || !Number.isFinite(amount)) {
        rollingNetKcal = null;
        break;
      }
      rollingNetKcal += amount;
    }
    return {...day, rollingNetKcal};
  });
}
