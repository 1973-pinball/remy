import test from 'node:test';
import assert from 'node:assert/strict';
import { ownedDeviceDrafts, claimUnassignedDeviceDrafts } from '../app/journal';

const drafts = [
  { id: 'mine', ownerId: 'owner-a', data: { title: 'Synthetic owner A draft' } },
  { id: 'theirs', ownerId: 'owner-b', data: { title: 'Synthetic owner B draft' } },
  { id: 'anonymous', ownerId: null, data: { title: 'Synthetic unsigned draft' } },
  { id: 'legacy', data: { title: 'Synthetic legacy unsigned draft' } },
];

test('signed-out visitors cannot see device drafts, and signed-in owners see only their own', () => {
  assert.deepEqual(ownedDeviceDrafts(drafts, null), []);
  assert.deepEqual(ownedDeviceDrafts(drafts, 'owner-a').map(draft => draft.id), ['mine']);
  assert.deepEqual(ownedDeviceDrafts(drafts, 'owner-b').map(draft => draft.id), ['theirs']);
  assert.deepEqual(ownedDeviceDrafts(drafts, 'unrelated-owner'), []);
});

test('explicit claiming assigns only unassigned drafts and cannot run without a signed-in owner', () => {
  assert.throws(() => claimUnassignedDeviceDrafts(drafts, null), /Sign in/);
  const claimed = claimUnassignedDeviceDrafts(drafts, 'owner-a');
  assert.deepEqual(ownedDeviceDrafts(claimed, 'owner-a').map(draft => draft.id), ['mine', 'anonymous', 'legacy']);
  assert.equal(claimed.find(draft => draft.id === 'theirs')?.ownerId, 'owner-b');
  assert.equal(drafts.find(draft => draft.id === 'anonymous')?.ownerId, null);
});

test('hiding on sign-out retains owner drafts for later sign-in without exposing foreign content', () => {
  const stored = JSON.parse(JSON.stringify(drafts));
  assert.equal(ownedDeviceDrafts(stored, null).length, 0);
  assert.equal(stored.length, drafts.length);
  assert.deepEqual(ownedDeviceDrafts(stored, 'owner-a'), [drafts[0]]);
  assert.ok(!ownedDeviceDrafts(stored, 'owner-a').some(draft => draft.id === 'theirs' || draft.id === 'anonymous'));
});
