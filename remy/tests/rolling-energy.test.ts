import test from 'node:test';
import assert from 'node:assert/strict';
import { addDays } from '../lib/domain';
import { withRollingSevenDayNet } from '../lib/rolling-energy';

const days = (values: Array<number | null>, start = '2026-10-27') =>
  values.map((netKcal, index) => ({date: addDays(start, index), netKcal}));

test('seven-day net is an inclusive rolling sum with negative and zero values, not an average or all-time total', () => {
  const source = days([-500,100,0,-50,75,-125,200,300]);
  const before = structuredClone(source), result = withRollingSevenDayNet(source);
  assert.deepEqual(result.slice(0,6).map(day => day.rollingNetKcal), Array(6).fill(null));
  assert.equal(result[6].date, '2026-11-02'); assert.equal(result[6].rollingNetKcal, -300);
  assert.equal(result[7].rollingNetKcal, 500);
  assert.deepEqual(source, before);
  assert.equal(withRollingSevenDayNet(days(Array(7).fill(0))).at(-1)!.rollingNetKcal, 0);
});

test('an unknown daily net invalidates every window containing it and recovers after seven known calendar days', () => {
  for (const missing of [null, NaN, Infinity, -Infinity]) {
    const source = days([...Array(7).fill(100), missing, ...Array(7).fill(100)]);
    const result = withRollingSevenDayNet(source);
    assert.equal(result[6].rollingNetKcal, 700);
    assert.deepEqual(result.slice(7,14).map(day => day.rollingNetKcal), Array(7).fill(null));
    assert.equal(result[14].rollingNetKcal, 700);
  }
});

test('missing calendar rows never collapse into a seven-observation window, including across DST', () => {
  const source = days(Array(9).fill(100), '2026-10-27').filter(day => day.date !== '2026-10-31');
  assert.ok(withRollingSevenDayNet(source).every(day => day.rollingNetKcal === null));
  const dst = withRollingSevenDayNet(days(Array(7).fill(100), '2026-10-27'));
  assert.equal(dst.at(-1)!.date, '2026-11-02'); assert.equal(dst.at(-1)!.rollingNetKcal, 700);
  assert.deepEqual(withRollingSevenDayNet([]), []);
});
