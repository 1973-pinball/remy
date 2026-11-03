import 'server-only';
import { fetchSource, providerToken, type OAuthTokens } from './connections';
import { dayBounds, localDate, profileOf } from './domain';
import { listEntries, operationGuard, readSecret } from './store';

export interface YtdRun {
  sourceId: string; start: string; date: string; title: string;
  distanceMeters: number | null; durationSec: number | null; avgHr: number | null;
  elevationMeters: number | null; sport: 'running';
}

const number = (value: unknown, maximum = Infinity): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= maximum ? value : null;
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const activityId = (value: unknown): string | null => typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? String(value)
  : typeof value === 'string' && /^[1-9]\d{0,29}$/.test(value) ? value : null;

/** Read the authorized athlete's current-year runs without importing or changing
 * workout records. Credentials and provider-only fields never leave the server. */
export async function runningYearToDate(owner: string, now = new Date().toISOString()) {
  const nowMs = Date.parse(now);
  if (!Number.isFinite(nowMs)) throw new Error('A valid current time is required.');
  const guard = await operationGuard(owner, 'strava');
  if (guard.disabled) throw new Error('Connect Strava before reading running history.');
  const entries = await listEntries(owner);
  if (entries.some(entry => entry.id === 'connection:strava' && entry.data.disconnected === true))
    throw new Error('Connect Strava before reading running history.');
  const saved = await readSecret<OAuthTokens>(owner, 'strava');
  if (!saved?.scope?.split(/[\s,]+/).includes('activity:read_all'))
    throw new Error('Reconnect Strava and allow access to all activities so private runs are included. Existing permission could not be verified.');
  const timezone = profileOf(entries).timezone, through = localDate(now, timezone), from = `${through.slice(0,4)}-01-01`;
  const startMs = Date.parse(dayBounds(from, timezone).start);
  const token = await providerToken(owner, 'strava', guard), deadline = Date.now() + 40_000;
  const refreshed = await readSecret<OAuthTokens>(owner, 'strava');
  if (!refreshed?.scope?.split(/[\s,]+/).includes('activity:read_all'))
    throw new Error('Strava permission changed during renewal. Reconnect and allow access to all activities before reading full running history.');
  const byId = new Map<string, YtdRun>();
  let paginationComplete = false, invalidRunRecords = 0;
  for (let page = 1; page <= 20; page++) {
    if (Date.now() >= deadline - 1000) break;
    const url = new URL('https://www.strava.com/api/v3/athlete/activities');
    // Widen strict API boundaries by one second, then apply exact bounds below.
    url.searchParams.set('after', String(Math.floor(startMs / 1000) - 1));
    url.searchParams.set('before', String(Math.floor(nowMs / 1000) + 1));
    url.searchParams.set('per_page', '50');
    url.searchParams.set('page', String(page));
    const response = await fetchSource(url.href, token, deadline);
    let payload: unknown;
    try { payload = await response.json(); } catch { throw new Error('Strava returned invalid running-history data. Try again later.'); }
    if (!Array.isArray(payload)) throw new Error('Strava returned unsupported running-history data. Try again later.');
    // Strava may return short pages before the last page; only an empty page proves completion.
    if (payload.length === 0) { paginationComplete = true; break; }
    for (const item of payload) {
      const raw = object(item);
      const sport = raw.sport_type ?? raw.type;
      if (typeof sport !== 'string') throw new Error('Strava returned an activity without a valid sport. Full running history could not be verified.');
      if (!['Run', 'TrailRun', 'VirtualRun'].includes(sport)) continue;
      const id = activityId(raw.id), start = typeof raw.start_date === 'string' ? Date.parse(raw.start_date) : NaN;
      if (!id || !Number.isFinite(start)) { invalidRunRecords++; continue; }
      if (start < startMs || start > nowMs || byId.has(id)) continue;
      byId.set(id, {
        sourceId: id, start: new Date(start).toISOString(), date: localDate(new Date(start), timezone),
        title: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0,300) : 'Run',
        distanceMeters: number(raw.distance), durationSec: number(raw.moving_time),
        avgHr: number(raw.average_heartrate, 250), elevationMeters: number(raw.total_elevation_gain), sport: 'running',
      });
    }
  }
  const current = await operationGuard(owner, 'strava');
  if (current.disabled || current.generation !== guard.generation || current.version !== guard.version)
    throw Object.assign(new Error('Your journal or Strava connection changed during this request. Refresh before trying again.'), {status:409});
  const runs = [...byId.values()].sort((a,b) => a.start.localeCompare(b.start) || a.sourceId.localeCompare(b.sourceId));
  const missingDistanceRuns = runs.filter(run => run.distanceMeters === null).length;
  const complete = paginationComplete && invalidRunRecords === 0;
  const knownMiles = runs.reduce((total,run) => total + (run.distanceMeters ?? 0), 0) / 1609.344;
  const totalMiles = complete && missingDistanceRuns === 0 ? knownMiles : null;
  const calendarDays = Math.round((Date.parse(`${through}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000) + 1;
  const weeks = calendarDays / 7;
  return {
    source: 'Strava', from, through, asOf: new Date(nowMs).toISOString(), timezone, complete,
    runCount: runs.length, totalMiles, knownMiles, missingDistanceRuns, invalidRunRecords,
    calendarDays, weeks, milesPerWeek: totalMiles === null ? null : totalMiles / weeks,
    method: 'Running miles divided by calendar days from January 1 through the date shown, multiplied by seven. The current calendar day is included.',
    ...(!paginationComplete ? {incompleteReason:'The request reached its page or time limit before all activity pages were read.'} : {}),
    runs,
  };
}
