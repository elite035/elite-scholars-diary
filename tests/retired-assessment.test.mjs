import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {schoolUI} from '../public/school.js';
import {normalizeHomework,homeworkSource,homeworkCss} from '../shared/homework-template.mjs';
import {consolidateClassDiary} from '../shared/class-diaries.mjs';

const check=(ok,message)=>{if(!ok)throw Error(message);};
test('old assessment payloads are ignored without validation or mutation',()=>{
 const input={diary_layout:'homework_grid',homework_rows:[{subject:'Math',detail:'Exercise',hw:true}],hygiene:{uniform:'legacy value'}};
 const before=JSON.stringify(input),normalized=normalizeHomework(input,true,check);
 assert.equal('hygiene' in normalized,false);assert.equal(normalized.homework_rows[0].detail,'Exercise');assert.equal(JSON.stringify(input),before);
 assert.doesNotMatch(homeworkCss,/hygiene|tidy|untidy/i);
});

function harness(existing=false){
 const {document,window}=parseHTML('<main id="content"></main>');globalThis.document=document;globalThis.window=window;globalThis.location={hash:''};
 Object.defineProperty(window.HTMLSelectElement.prototype,'value',{configurable:true,get(){return this.querySelector('option[selected]')?.value||'';},set(v){this.querySelectorAll('option').forEach(x=>x.toggleAttribute('selected',x.value===v));}});
 const assignment={id:'assignment',active:1,teacher_id:'teacher',subject_id:'math',subject_name:'Math',head_name:'Head',section_id:'blue',start_date:'2026-01-01',end_date:'2027-12-31',meta:{class_id:'four',class_name:'4',section_name:'Blue'}};
 const diary={id:'old',teacher_id:'teacher',section_id:'blue',diary_date:'2026-11-05',status:'draft',version:3,snapshot:{meta:assignment.meta,teacher_name:'Teacher'},content:{diary_layout:'homework_grid',homework_rows:[{subject_id:'math',assignment_id:'assignment',subject:'Math',detail:'Saved homework',language:'en',hw:true}],hygiene:{uniform:'tidy'}}};
 const calls=[],before=JSON.stringify(diary),structure={assignments:[assignment],sectionSubjects:[{section_id:'blue',subject_id:'math'}],users:[],academics:[],nodes:[]};
 const api=async(path,args)=>{calls.push({path,args});if(path==='/api/school/bootstrap')return {structure,capabilities:['diary.create','diary.export']};if(args)return {id:'saved'};if(path.includes('/class-diaries/detail'))return consolidateClassDiary([{...diary,status:'approved',submitted_at:'now',reviewed_at:'now'}]);return diary;};
 const esc=x=>String(x??'').replaceAll('<','&lt;').replaceAll('"','&quot;');
 const ui=schoolUI({api,state:{user:{id:'teacher',role:'teacher'}},esc,field:(label,name,type,value='',extra='')=>`<label>${label}<input name="${name}" type="${type}" value="${value}" ${extra}></label>`,select:(label,name,items,value='',extra='')=>`<label>${label}<select name="${name}" ${extra}><option value="">Choose</option>${items.map(x=>`<option value="${x.id}" ${x.id===value?'selected':''}>${x.name}</option>`).join('')}</select></label>`,card:(title,body)=>`<section><h2>${title}</h2>${body}</section>`,heading:(title,subtitle)=>`<h1>${title}</h1><p>${subtitle}</p>`,empty:()=>'<p>No records</p>',today:()=>diary.diary_date,displayDate:x=>x,toast(){},render:async()=>{}});
 return {ui,document,window,calls,diary,before};
}
for(const existing of [false,true])test((existing?'reopening and editing':'creating')+' class diary retains subjects, languages, flags and actions without assessment fields',async()=>{
 const h=harness(existing);await h.ui.route('new',existing?{id:'old'}:{});
 assert.doesNotMatch(h.document.body.innerHTML,/hygiene|tidy|untidy/i);
 const form=h.document.querySelector('#school-diary-write');assert.ok(form);assert.equal(form.querySelectorAll('button[type=submit]').length,3);const subject=form.querySelector('.school-subject');subject.querySelector('[name=selected]').checked=true;subject.querySelector('[name=language]').value='en';subject.querySelector('textarea').value=existing?'Edited homework':'New homework';subject.querySelector('[name=hw]').checked=true;
 const Original=globalThis.FormData;globalThis.FormData=class{constructor(){return new Map();}};
 try{form.dispatchEvent(new h.window.Event('submit',{bubbles:true,cancelable:true}));form.dispatchEvent(new h.window.Event('submit',{bubbles:true,cancelable:true}));await new Promise(r=>setTimeout(r,0));}finally{globalThis.FormData=Original;}
 assert.equal(h.calls.filter(x=>x.args).length,1);const saved=h.calls.find(x=>x.args);assert.ok(saved);assert.equal(saved.args.method,existing?'PUT':'POST');assert.equal('hygiene' in saved.args.body,false);assert.equal(saved.args.body.rows[0].language,'en');assert.equal(saved.args.body.rows[0].hw,true);assert.equal(saved.args.body.rows[0].detail,existing?'Edited homework':'New homework');assert.equal(JSON.stringify(h.diary),h.before);
});
test('consolidated page and historical export templates show homework and export actions without assessments',async()=>{
 const h=harness();await h.ui.route('schooldiaries',{section:'blue',date:'2026-11-05',consolidated:'1'});assert.doesNotMatch(h.document.body.innerHTML,/hygiene|tidy|untidy/i);for(const kind of ['pdf','png','jpg','print'])assert.ok(h.document.querySelector(`a[href*="format=${kind}"]`));
 const before=JSON.stringify(h.diary);const html=homeworkSource({...h.diary,template_snapshot:{name:'Elite Scholars',assignmentSnapshot:h.diary.snapshot.meta},quote_snapshot:[]});assert.doesNotMatch(html,/hygiene|tidy|untidy/i);assert.ok(html.includes('Saved homework'));assert.equal(JSON.stringify(h.diary),before);
});
