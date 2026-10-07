import test from 'node:test';
import assert from 'node:assert/strict';
import { assertJournalDate } from '../lib/journal-date';
import { DEFAULT_PROFILE, profileOf, type Entry } from '../lib/domain';

const zone = 'America/New_York';
const record = (kind: Entry['kind'], date: string, data: Record<string, unknown>): Entry => ({ id: 'record', kind, localDate: date, source: kind === 'plan' ? 'runna' : 'manual', sourceId: 'source', revision: 2, updatedAt: '2026-10-06T15:00:00Z', data });

test('meal date follows time eaten in the saved timezone, not UTC or message time', () => {
  const data = { mealTime: '2026-10-07T02:30:00Z', messageTime: '2026-10-08T15:00:00Z' };
  assert.doesNotThrow(() => assertJournalDate('meal', '2026-10-06', data, zone));
  assert.throws(() => assertJournalDate('meal', '2026-10-07', data, zone), /falls on 2026-10-06/);
  assert.doesNotThrow(() => assertJournalDate('meal', '2026-10-06', { mealTime: null, messageTime: data.messageTime }, zone));
});

test('run and timed-plan starts must match their date using explicit offset instants', () => {
  const start = '2026-10-07T00:15:00+09:00';
  assert.doesNotThrow(() => assertJournalDate('workout', '2026-10-06', { start }, zone));
  assert.throws(() => assertJournalDate('workout', '2026-10-07', { start }, zone), /run start falls on 2026-10-06/);
  assert.doesNotThrow(() => assertJournalDate('plan', '2026-10-06', { start, allDay: false }, zone));
  assert.throws(() => assertJournalDate('plan', '2026-10-07', { start, allDay: false }, zone), /session start falls on 2026-10-06/);
});

test('all-day and timed-plan representations cannot contradict each other', () => {
  assert.doesNotThrow(() => assertJournalDate('plan', '2026-11-01', { allDay: true, start: null }, zone));
  assert.throws(() => assertJournalDate('plan', '2026-11-01', { allDay: true, start: '2026-11-01T08:00:00Z' }, zone), /all-day plan must not/);
  assert.throws(() => assertJournalDate('plan', '2026-11-01', { allDay: false, start: null }, zone), /timed plan needs/);
  const old = record('plan', '2026-11-01', { allDay: false, start: null });
  assert.throws(() => assertJournalDate('plan', old.localDate, old.data, zone, old), /timed plan needs/);
});

test('date matching uses actual DST boundaries in the saved profile zone', () => {
  assert.doesNotThrow(() => assertJournalDate('workout', '2026-03-07', { start: '2026-03-08T04:59:59Z' }, zone));
  assert.doesNotThrow(() => assertJournalDate('workout', '2026-03-08', { start: '2026-03-08T05:00:00Z' }, zone));
  for (const start of ['2026-11-01T01:30:00-04:00', '2026-11-01T01:30:00-05:00']) {
    assert.doesNotThrow(() => assertJournalDate('workout', '2026-11-01', { start }, zone));
  }
});

test('timezone edits preserve historical assignments and Runna completion links', () => {
  const old = record('plan', '2026-10-06', { start: '2026-10-07T02:30:00Z', allDay: false, completedWorkoutId: null });
  const before = structuredClone(old);
  const changedProfile = { ...DEFAULT_PROFILE, timezone: 'Europe/London' };
  const profileEntry: Entry = { ...record('profile', '2026-10-06', changedProfile), id: 'profile', localDate: null };
  const newZone = profileOf([profileEntry, old]).timezone;
  assert.doesNotThrow(() => assertJournalDate('plan', old.localDate, { ...old.data, completedWorkoutId: 'completed-run' }, newZone, old));
  assert.deepEqual(old, before);
  assert.throws(() => assertJournalDate('plan', old.localDate, { ...old.data, start: '2026-10-07T02:45:00Z' }, newZone, old), /falls on 2026-10-07/);
  assert.doesNotThrow(() => assertJournalDate('plan', '2026-10-07', { ...old.data, start: '2026-10-07T02:45:00Z' }, newZone, old));
});

test('unchanged old records cannot excuse an inconsistent new date/time assignment', () => {
  const old = record('workout', '2026-10-06', { start: '2026-10-06T15:00:00Z' });
  assert.throws(() => assertJournalDate('workout', '2026-10-07', old.data, zone, old), /falls on 2026-10-06/);
  assert.throws(() => assertJournalDate('workout', old.localDate, { start: '2026-10-07T15:00:00Z' }, zone, old), /falls on 2026-10-07/);
  assert.throws(() => assertJournalDate('workout', old.localDate, { start: '' }, zone, old), /valid timestamp/);
});
