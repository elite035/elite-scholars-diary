import test from 'node:test';
import assert from 'node:assert/strict';
import { capabilityNames } from '../shared/school-permissions.mjs';
import { groupCapabilities, countChanges, overrideState, labelOf, GROUPS } from '../public/school-permissions.js';
test('every server capability appears in exactly one friendly group', () => {
  const groups = groupCapabilities(capabilityNames);
  assert.ok(!groups.some((g) => g.id === 'other'), 'a capability is missing a label/group');
  const listed = groups.flatMap((g) => g.caps.map(([id]) => id));
  assert.equal(listed.length, new Set(listed).size);
  assert.deepEqual([...listed].sort(), [...capabilityNames].sort());
});
test('unknown capabilities fall into Other instead of disappearing', () => {
  const groups = groupCapabilities([...capabilityNames, 'future.feature']);
  assert.equal(groups.at(-1).title, 'Other');
  assert.equal(labelOf('future.feature'), 'future · feature');
});
test('labels are plain English and unsaved changes are counted both ways', () => {
  assert.equal(labelOf('diary.approve'), 'Approve diaries');
  assert.ok(GROUPS.every((g) => g.caps.every(([, label]) => label && !label.includes('.'))));
  assert.equal(countChanges(new Set(['a', 'b']), new Set(['b', 'c'])), 2);
  assert.equal(countChanges(new Set(['a']), new Set(['a'])), 0);
});
test('deny wins over allow in the override state', () => {
  assert.equal(overrideState('x', new Set(['x']), new Set(['x'])), 'deny');
  assert.equal(overrideState('x', new Set(['x']), new Set()), 'allow');
  assert.equal(overrideState('x', new Set(), new Set()), 'default');
});
