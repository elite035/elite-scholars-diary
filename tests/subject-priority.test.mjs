import {test} from 'node:test';
import assert from 'node:assert/strict';
import {subjectPriority} from '../public/subject-priority.js';
import {validateSubjectAssignments} from '../public/subject-form.js';
import {consolidateClassDiary} from '../shared/class-diaries.mjs';
test('subject priority validates persisted integers and form values without coercing missing/invalid input',()=>{
 assert.equal(subjectPriority(),0);assert.equal(subjectPriority('12'),12);
 for(const value of [null,'',true,-1,1.5,'bad',1000001,Infinity])assert.throws(()=>subjectPriority(value),{status:400});
 assert.throws(()=>validateSubjectAssignments({name:'Math',campus_id:'campus',section_ids:['section']}),{message:'Subject Priority is required.',status:400});
 assert.equal(validateSubjectAssignments({name:'Math',campus_id:'campus',section_ids:['section'],priority:'8'}).priority,8);
});
test('priority sorting uses subject IDs for ties and preserves all distinct content across teacher ordering',()=>{
 const row=(subject_id,detail)=>({subject_id,subject:subject_id==='z'?'Alpha':'Zulu',detail,language:'en'});
 const diary=(id,rows,status='approved')=>({id,teacher_id:id,section_id:'section',diary_date:'2026-10-26',status,submitted_at:'now',reviewed_at:'now',snapshot:{meta:{class_id:'class'},teacher_name:id},content:{homework_rows:rows,hygiene:{}}});
 const entries=[diary('teacher-z',[row('z','Last by priority'),row('b','Second detail')]),diary('teacher-a',[row('a','First detail'),row('b','Other detail')]),diary('pending',[row('pending','Do not include')],'submitted')];
 const priorities=[{subject_id:'z',priority:20},{subject_id:'a',priority:1},{subject_id:'b',priority:1},{subject_id:'pending',priority:0}],result=consolidateClassDiary(entries,priorities);
 assert.deepEqual(result.content.homework_rows.map(r=>r.subject_id),['a','b','b','z']);assert.equal(result.content.homework_rows.length,4);
 assert.deepEqual(consolidateClassDiary([...entries].reverse(),priorities).content.homework_rows,result.content.homework_rows);
 assert.deepEqual(consolidateClassDiary(entries,priorities.map(p=>p.subject_id==='z'?{...p,priority:0}:p)).content.homework_rows.map(r=>r.subject_id),['z','a','b','b']);
});
