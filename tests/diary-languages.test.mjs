import {test} from 'node:test';
import assert from 'node:assert/strict';
import {diaryLanguages,subjectLanguage,languageDirection} from '../public/diary-languages.js';
import {normalizeHomework,homeworkSource} from '../shared/homework-template.mjs';
import {consolidateClassDiary} from '../shared/class-diaries.mjs';
const check=(condition,message,status)=>{if(!condition)throw Object.assign(Error(message),{status});};
test('subject languages reuse existing options, retain explicit blanks and fall back only for legacy rows',()=>{
 assert.deepEqual(diaryLanguages.map(x=>x.id),['en','ur']);assert.equal(subjectLanguage({},'ur'),'ur');assert.equal(subjectLanguage({language:'en'},'ur'),'en');assert.equal(subjectLanguage({language:''},'ur'),'');assert.equal(languageDirection('ur'),'rtl');assert.equal(languageDirection('en'),'ltr');assert.equal(languageDirection(''),'auto');
 const rows=[{subject:'Math',detail:'Fractions',language:'en',direction:'rtl'},{subject:'Urdu',detail:'سبق پڑھیں',language:'ur',direction:'ltr'}];
 const normalized=normalizeHomework({diary_layout:'homework_grid',homework_rows:rows},true,check);assert.deepEqual(normalized.homework_rows.map(r=>[r.language,r.direction]),[['en','ltr'],['ur','rtl']]);assert.throws(()=>normalizeHomework({diary_layout:'homework_grid',homework_rows:[{...rows[0],language:'invalid'}]},false,check));
});
test('consolidation and existing document renderer preserve languages independently, including identical text',()=>{
 const make=(id,language)=>({id,teacher_id:id,section_id:'section',diary_date:'2026-10-26',language:'en',snapshot:{meta:{class_id:'class',class_name:'Class',section_name:'Section'},teacher_name:id},content:{homework_rows:[{subject:'Math',detail:'Same work',language,hw:true,direction:languageDirection(language)}],hygiene:{}},status:'approved',submitted_at:'2026-10-26',reviewed_at:'2026-10-26'});
 const combined=consolidateClassDiary([make('one','en'),make('two','ur')]);assert.equal(combined.content.homework_rows.length,2);assert.deepEqual(combined.content.homework_rows.map(r=>r.language),['en','ur']);
 const html=homeworkSource({...combined,template_snapshot:{name:'Elite Scholars School',assignmentSnapshot:combined.snapshot.meta}});assert.ok(html.includes('lang="en" dir="ltr">Same work'));assert.ok(html.includes('lang="ur" dir="rtl">Same work'));assert.ok(!html.includes('Language: English'));assert.ok(!html.includes('Language: اردو — Urdu'));assert.ok(html.includes('lang="en"'));assert.ok(html.includes('lang="ur"'));
});
