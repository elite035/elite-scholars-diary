import test from 'node:test';
import assert from 'node:assert/strict';
import { parseList, sessionDefaults, planSetup, cellState } from '../public/school-structure.js';
const catalog = () => ({
  nodes: [
    { id: 'b1', kind: 'branch', name: 'Main Branch', active: 1 },
    { id: 'c1', kind: 'campus', name: 'Boys Campus', parent_id: 'b1', active: 1 },
  ],
  academics: [
    { id: 'k5', kind: 'class', name: 'Class 5', active: 1 },
    { id: 's5a', kind: 'section', name: 'A', parent_id: 'k5', active: 1 },
    { id: 'k6', kind: 'class', name: 'Class 6', active: 0 },
    { id: 'en', kind: 'subject', name: 'English', active: 1 },
  ],
  classCampuses: [{ class_id: 'k5', campus_id: 'c1' }, { class_id: 'k6', campus_id: 'c1' }],
  sectionSubjects: [{ section_id: 's5a', subject_id: 'en' }],
});
test('lists are split, trimmed and de-duplicated', () => {
  assert.deepEqual(parseList('A, B\nb ,  C  '), ['A', 'B', 'C']);
  assert.deepEqual(parseList(''), []);
});
test('the academic session runs April to March', () => {
  assert.deepEqual(sessionDefaults('2026-11-16'), { name: '2026–27', start_date: '2026-04-01', end_date: '2027-03-31' });
  assert.equal(sessionDefaults('2027-02-10').name, '2026–27');
});
test('the plan never duplicates what already exists', () => {
  const plan = planSetup(catalog(), {
    branchName: 'main branch',
    campusName: 'Boys Campus',
    classes: ['Class 5', 'Class 6', 'Class 7'],
    sections: ['A', 'B'],
    subjects: ['English', 'Urdu'],
  });
  assert.equal(plan.branch.create, false);
  assert.equal(plan.campus.create, false);
  assert.deepEqual(plan.classes.map((c) => [c.name, c.create, c.missing]), [
    ['Class 5', false, ['B']],
    ['Class 6', false, []],
    ['Class 7', true, ['A', 'B']],
  ]);
  assert.deepEqual(plan.blocked, ['Class 6']);
  assert.equal(plan.newSections, 3);
  assert.equal(plan.newSubjects, 1);
  // Class 5/A needs Urdu only (1), Class 5/B and Class 7/A,B need both subjects (6)
  assert.equal(plan.linkCount, 7);
});
test('a brand new school plans everything', () => {
  const plan = planSetup({ nodes: [], academics: [], classCampuses: [], sectionSubjects: [] }, { branchName: 'Main', campusName: 'Girls', classes: ['Nursery'], sections: ['A'], subjects: ['English'] });
  assert.equal(plan.branch.create && plan.campus.create, true);
  assert.equal(plan.newClasses, 1);
  assert.equal(plan.linkCount, 1);
});
test('grid cells show all, some or none of a class’s sections', () => {
  const c = catalog();
  assert.equal(cellState(c, 'k5', 'en'), 'all');
  c.academics.push({ id: 's5b', kind: 'section', name: 'B', parent_id: 'k5', active: 1 });
  assert.equal(cellState(c, 'k5', 'en'), 'some');
  assert.equal(cellState(c, 'k5', 'xx'), 'none');
});
import { compareClasses } from '../public/school-structure.js';
test('classes sort early years first, then Class 1 to Class 10', () => {
  const sorted = ['Class 10', 'Class 2', 'Prep', 'Nursery', 'Class 1', 'Playgroup', 'Hifz'].sort(compareClasses);
  assert.deepEqual(sorted, ['Playgroup', 'Nursery', 'Prep', 'Class 1', 'Class 2', 'Class 10', 'Hifz']);
});
