import test from 'node:test';
import assert from 'node:assert/strict';
import { milesFromMeters, milesInputValue, metersFromMilesInput } from '../lib/run-distance';

test('mile display and changed mile input convert while unchanged fields preserve source precision', () => {
  assert.equal(milesFromMeters(1609.344), 1);
  assert.equal(milesInputValue(6450), '4.01');
  assert.equal(metersFromMilesInput('4.01', 6450), 6450);
  assert.equal(metersFromMilesInput('5.00', 6450), 8046.72);
  assert.equal(metersFromMilesInput('1'), 1609.344);
  assert.equal(metersFromMilesInput('0'), 0);
  assert.equal(metersFromMilesInput('', 6450), null);
  assert.equal(milesInputValue(null), '');
  assert.throws(() => metersFromMilesInput('-1'), /valid distance/);
  assert.throws(() => metersFromMilesInput('NaN'), /valid distance/);
});
