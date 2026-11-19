import {test} from 'node:test';
import assert from 'node:assert/strict';
import {consolidateClassDiary,groupClassDiaries,matchesClassDiary} from '../shared/class-diaries.mjs';
import {homeworkSource} from '../shared/homework-template.mjs';
const entry=(id,extra={})=>({id,teacher_id:id,section_id:'blue',diary_date:'2026-10-24',status:'approved',version:1,submitted_at:'2026-10-24',reviewed_at:'2026-10-24',snapshot:{meta:{class_id:'five',class_name:'5',section_name:'Blue'},teacher_name:'Teacher '+id},content:{homework_rows:[{subject_id:'english',subject:'English',detail:'Read chapter',hw:true,learn:true,test:false,direction:'ltr'}],hygiene:{}},...extra});
test('consolidation deduplicates entries and identical content, retains distinct same-subject content and traceability',()=>{
 const a=entry('a'),b=entry('b'),c=entry('c');c.content.homework_rows[0].detail='Complete exercise';
 const original=JSON.stringify([a,b,c]),d=consolidateClassDiary([a,a,b,c]);
 assert.equal(d.contributors.length,3);assert.equal(d.content.homework_rows.length,2);const shared=d.content.homework_rows.find(r=>r.detail==='Read chapter');assert.equal(shared.contributors.length,2);assert.equal(shared.teacher_name,'Teacher a, Teacher b');assert.equal(JSON.stringify([a,b,c]),original);
 assert.throws(()=>consolidateClassDiary([a,entry('other',{section_id:'pink'})]));
});
test('class/section/date grouping and content/status filters retain the complete group and stable reference',()=>{
 const a=entry('a'),b=entry('b',{status:'approved'}),pink=entry('pink',{section_id:'pink'}),tomorrow=entry('tomorrow',{diary_date:'2026-10-25'});
 let groups=groupClassDiaries([a,b,pink,tomorrow]);assert.equal(groups.length,3);assert.equal(groups[0].diary_date,'2026-10-25');const d=groups.find(x=>x.id==='blue~2026-10-24');assert.equal(d.status,'approved');
 assert.equal(matchesClassDiary(d,{status:'approved',search:'chapter',section:'blue'}),true);assert.equal(d.content.homework_rows[0].contributors.length,2);
 for(const q of [{status:'draft'},{search:'absent'},{section:'missing'},{start:'2026-10-25'}])assert.equal(matchesClassDiary(d,q),false);
 assert.equal(consolidateClassDiary([a]).id,consolidateClassDiary([a,b]).id);
});
test('old assessments are not rendered or calculated, and stored source records remain unchanged',()=>{
 const a=entry('a');a.content.hygiene={uniform:'tidy',hair:'untidy'};const before=JSON.stringify(a);
 const render=d=>homeworkSource({...d,template_snapshot:{name:'Elite Scholars School',assignmentSnapshot:d.snapshot.meta},quote_snapshot:[]});
 const combined=consolidateClassDiary([a]);assert.equal(combined.content.consolidated,true);assert.equal('hygiene_summary' in combined.content,false);assert.equal('hygiene' in combined.content,false);
 for(const d of [a,combined]){const html=render(d);assert.doesNotMatch(html,/hygiene|tidy|untidy/i);assert.ok(html.includes('Read chapter'));}
 assert.ok(!render(combined).includes('Teacher a'));assert.equal(combined.content.homework_rows[0].teacher_name,'Teacher a');assert.equal(JSON.stringify(a),before);
});

test('consolidation rejects every non-approved state, missing workflow timestamps and discarded records',()=>{
 const approved=entry('approved',{content:{homework_rows:[{subject:'English',detail:'Approved content'}],hygiene:{uniform:'tidy'}}});
 const excluded=['draft','submitted','resubmitted','under_review','returned','rejected'].map(status=>entry(status,{status,content:{homework_rows:[{subject:'Hidden',detail:'MUST NOT APPEAR'}],hygiene:{uniform:'untidy'}}}));
 excluded.push(entry('missing-review',{reviewed_at:null}),entry('missing-submission',{submitted_at:null}),entry('discarded',{content:{homework_rows:[],hygiene:{uniform:'untidy'},deleted_at:'now'}}));
 const combined=consolidateClassDiary([approved,...excluded]);assert.deepEqual(combined.entry_ids,['approved']);assert.ok(!JSON.stringify(combined).includes('MUST NOT APPEAR'));assert.equal(consolidateClassDiary(excluded),null);assert.deepEqual(groupClassDiaries(excluded),[]);
});
