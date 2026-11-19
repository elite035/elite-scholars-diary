import test from 'node:test';import assert from 'node:assert/strict';import {assertSettingsVersion,preserveSettingsLinks} from '../shared/settings-publication.mjs';import {historicalDisplay} from '../public/historical-display.js';
test('publication preserves newly saved teacher campuses and session choices from fresh database settings',()=>{
 const current={templateVersion:4,teacherCampusAssignments:{teacher:'girls'},assignmentSessionId:'new-session'},proposed={templateVersion:5,teacherCampusAssignments:{teacher:'boys'},assignmentSessionId:'old-session',name:'Updated school'};
 const saved=preserveSettingsLinks(proposed,current,4);assert.deepEqual(saved.teacherCampusAssignments,{teacher:'girls'});assert.equal(saved.assignmentSessionId,'new-session');assert.equal(saved.name,'Updated school');assert.equal(proposed.teacherCampusAssignments.teacher,'boys');assert.throws(()=>preserveSettingsLinks(proposed,{...current,templateVersion:5},4),{status:409});
});
test('stale settings forms cannot overwrite newer publication and old clients remain compatible',()=>{
 const current={templateVersion:7};assertSettingsVersion(7,current);assertSettingsVersion(undefined,current);assert.throws(()=>assertSettingsVersion(6,current),{status:409});for(const version of [0,null,'7',NaN])assert.throws(()=>assertSettingsVersion(version,current),{status:400});
});
test('historical display hides retired fields even inside serialized JSON while preserving stored snapshots',()=>{
 const snapshot={content:JSON.stringify({homework_rows:[{subject:'Math',detail:'Do exercise'}],hygiene:{uniform:'tidy'}}),details:{hygiene_summary:{percentage:100}},name:'Original record'},before=JSON.stringify(snapshot),display=historicalDisplay(snapshot);assert.doesNotMatch(JSON.stringify(display),/hygiene|tidy/i);assert.ok(JSON.stringify(display).includes('Do exercise'));assert.equal(display.name,'Original record');assert.equal(JSON.stringify(snapshot),before);
});
