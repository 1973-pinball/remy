import { localDate as dateInZone, type Entry, type Kind } from './domain';

/** Validate new temporal assignments while retaining dates already recorded in history. */
export function assertJournalDate(kind: Kind, date: string | null, data: Record<string, unknown>, timezone: string, previous?: Entry | null) {
  if (kind !== 'meal' && kind !== 'workout' && kind !== 'plan') return;
  if (!date) throw new Error('A journal date is required.');

  if (kind === 'plan') {
    if (data.allDay === true && data.start !== null) throw new Error('An all-day plan must not have a start time. Clear the time or mark it as a timed session.');
    if (data.allDay === false && typeof data.start !== 'string') throw new Error('A timed plan needs a start time. Enter a time or mark it as all-day.');
  }

  const field = kind === 'meal' ? 'mealTime' : 'start';
  const instant = data[field];
  // A meal without a known time and an all-day prescription have only a date.
  if (instant == null && (kind === 'meal' || (kind === 'plan' && data.allDay === true))) return;
  if (typeof instant !== 'string' || !Number.isFinite(Date.parse(instant))) throw new Error('Enter a valid timestamp with a UTC offset.');

  // Changing the profile timezone never rebuckets history. A correction or
  // completion link may retain an existing, unchanged date/time assignment.
  // Changing either part is a new assignment and must use the current zone.
  if (previous?.kind === kind && previous.localDate === date && previous.data[field] === instant) return;

  const expected = dateInZone(instant, timezone);
  if (date !== expected) {
    const label = kind === 'meal' ? 'meal time' : kind === 'workout' ? 'run start' : 'session start';
    throw new Error(`The ${label} falls on ${expected} in your saved timezone (${timezone}). Choose that journal date or correct the time.`);
  }
}
