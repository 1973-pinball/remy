import { localDate, ofKind, type Day, type Entry } from './domain';

export const WHOOP_WEIGHT_LABEL = 'WHOOP profile weight · observed on this date';
export interface WhoopWeightSnapshot { date: string; weightKg: number; observedAt: string; sourceLabel: string }
export interface WeightHistoryPoint {
  date: string; weightKg: number; weightLb: number; sourceLabel: string; source: string;
  observedAt: string | null; measurementDateKnown: boolean;
}
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const validWeight = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;
const validDate = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T12:00:00Z`)) && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
const validInstant = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));

export function hasWhoopWeightScope(scope: unknown) {
  return typeof scope === 'string' && scope.split(/[\s,]+/).includes('read:body_measurement');
}

/** WHOOP returns its current profile value without a measurement timestamp.
 * Only the time Remy observed that value supplies this snapshot's date. */
export function observeWhoopWeight(payload: unknown, observedAt: string, timezone: string): WhoopWeightSnapshot | null {
  const weightKg = object(payload).weight_kilogram;
  if (!validWeight(weightKg) || !validInstant(observedAt)) return null;
  const observed = new Date(observedAt).toISOString();
  return {date: localDate(observed, timezone), weightKg, observedAt: observed, sourceLabel: WHOOP_WEIGHT_LABEL};
}

/** Latest observation per date; older dated snapshots remain unchanged. */
export function mergeWhoopWeightSnapshots(previous: unknown, incoming: WhoopWeightSnapshot | null): WhoopWeightSnapshot[] {
  const byDate = new Map<string, WhoopWeightSnapshot>();
  for (const raw of [...(Array.isArray(previous) ? previous : []), ...(incoming ? [incoming] : [])]) {
    const item = object(raw);
    if (!validDate(item.date) || !validWeight(item.weightKg) || !validInstant(item.observedAt)) continue;
    const snapshot: WhoopWeightSnapshot = {date: item.date, weightKg: item.weightKg, observedAt: new Date(item.observedAt).toISOString(), sourceLabel: WHOOP_WEIGHT_LABEL};
    const old = byDate.get(snapshot.date);
    if (!old || snapshot.observedAt >= old.observedAt) byDate.set(snapshot.date, snapshot);
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** Explicit dated weights outrank profile observations on the same date.
 * Undated profile.weightKg is deliberately never a historical measurement. */
export function weightHistory(records: Entry[]): WeightHistoryPoint[] {
  const points = new Map<string, WeightHistoryPoint>();
  const connection = records.find(entry => !entry.deleted && entry.kind === 'connection' && entry.id === 'connection:whoop');
  for (const snapshot of mergeWhoopWeightSnapshots(connection?.data.weightSnapshots, null)) {
    points.set(snapshot.date, {...snapshot, weightLb: snapshot.weightKg / 0.45359237, source: 'whoop', measurementDateKnown: false});
  }
  const days = ofKind<Day>(records, 'day').filter(entry => validDate(entry.localDate) && validWeight(entry.data.weightKg))
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt) || a.revision - b.revision || a.id.localeCompare(b.id));
  for (const entry of days) points.set(entry.localDate!, {
    date: entry.localDate!, weightKg: entry.data.weightKg!, weightLb: entry.data.weightKg! / 0.45359237,
    sourceLabel: entry.source === 'remy-etl' ? 'Dated weight reported in REMY history' : 'Recorded weigh-in',
    source: entry.source, observedAt: null, measurementDateKnown: true,
  });
  return [...points.values()].sort((a, b) => a.date.localeCompare(b.date));
}
