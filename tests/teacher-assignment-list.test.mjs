import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {schoolUI} from '../public/school.js';
const esc=x=>String(x??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
function setup(edit=true){
 const {document,window}=parseHTML('<html><body><main id="content"></main></body></html>');globalThis.document=document;globalThis.window=window;
 Object.defineProperty(window.HTMLSelectElement.prototype,'value',{configurable:true,get(){return this.querySelector('option[selected]')?.value||'';},set(v){this.querySelectorAll('option').forEach(x=>x.toggleAttribute('selected',x.value===v));}});
 const section=(id,parent,name)=>({id,parent_id:parent,name,kind:'section',active:1}),assignment=(id,teacher_id,section_id,subject_id,active=1)=>({id,teacher_id,teacher_name:teacher_id==='b'?'Teacher B':'Teacher A',head_id:'head',head_name:'Head Teacher',section_id,subject_id,subject_name:subject_id==='math'?'Mathematics':'English',weekdays:[1,3],due_time:'16:00',review_time:'18:00',active,meta:{campus_id:'cp'}});
 const assignments=[assignment('a1','a','blue','en'),assignment('a2','a','pink','en'),assignment('a3','a','blue','math',0),assignment('b1','b','pink','math'),assignment('other1','different-id','blue','en')];
 const structure={teacherCampuses:[{teacher_id:'a',campus_id:'cp'}],users:[],nodes:[{id:'cp',name:'Main Campus',kind:'campus',active:1}],academics:[{id:'class',kind:'class',name:'Class 4',active:1},section('blue','class','Blue'),section('pink','class','Pink'),{id:'en',kind:'subject',name:'English',priority:1},{id:'math',kind:'subject',name:'Mathematics',priority:2}],classCampuses:[{class_id:'class',campus_id:'cp'}],sectionSubjects:[{section_id:'blue',subject_id:'en'},{section_id:'pink',subject_id:'en'},{section_id:'blue',subject_id:'math'},{section_id:'pink',subject_id:'math'}],assignments};
 const state={user:{id:'admin',role:'super_admin'},school:{submissionTime:'16:00',reviewTime:'18:00'},capabilities:edit?['assignments.manage','assignments.create','assignments.edit','assignments.delete']:[],schoolConfig:structure},calls=[],modals=[];
 const ui=schoolUI({state,esc,api:async(path,args)=>{calls.push({path,args});return path==='/api/school/bootstrap'?{capabilities:state.capabilities,structure}:{ok:true};},field:(label,name,type,value='')=>`<label>${label}<input name="${name}" type="${type}" value="${value}"></label>`,select:(label,name,options,value='')=>`<label>${label}<select name="${name}">${options.map(x=>`<option value="${x.id}" ${x.id===value?'selected':''}>${esc(x.name)}</option>`).join('')}</select></label>`,button:(label,action,cls='',attrs='')=>`<button type="button" data-action="${action}" ${attrs}>${label}</button>`,card:(title,body)=>`<section><h2>${title}</h2>${body}</section>`,heading:(title,description)=>`<h1>${title}</h1><p>${description}</p>`,empty:label=>`<p>${label}</p>`,toast(){},modal:(...args)=>modals.push(args),render:async()=>{}});
 return {document,ui,structure,calls,modals};
}
test('assignments render one row per teacher ID, keeping all subjects, sections, schedules and individual actions',async()=>{
 const h=setup(),before=JSON.stringify(h.structure);await h.ui.route('timetable',{});
 const rows=h.document.querySelectorAll('#teacher-assignment-list tbody tr');assert.equal(rows.length,3,'Teachers with identical names must remain distinct accounts');
 const group=[...rows].find(row=>row.querySelector('[data-assignment-id=a3]'));assert.equal(group.querySelectorAll('[data-assignment-id]').length,3);
 for(const text of ['Teacher A','Head Teacher','Class 4 / Blue','Class 4 / Pink','English','Mathematics','Mon, Wed','Submission 16:00','Review 18:00','archived'])assert.ok(group.textContent.includes(text),text);
 assert.deepEqual([...group.children][2].textContent.replace('English','English ').trim().split(/\s+/),['English','Mathematics']);
 for(const assignment of h.structure.assignments){assert.equal(h.document.querySelectorAll('[data-assignment-id="'+assignment.id+'"]').length,1);for(const action of ['school-edit-assignment','school-toggle-assignment','school-delete-assignment'])assert.equal(h.document.querySelectorAll('[data-action="'+action+'"][data-id="'+assignment.id+'"]').length,1);}
 assert.equal(h.document.querySelector('[data-action=school-toggle-assignment][data-id=a3]').dataset.active,'true');assert.equal(JSON.stringify(h.structure),before);assert.ok(!h.calls.some(call=>call.args?.method));
});
test('expanding grouped management retains actions for the exact selected assignment',async()=>{
 const h=setup();await h.ui.route('timetable',{});await h.ui.click('school-toggle-assignment',{dataset:{id:'a3',active:'true'}});assert.deepEqual(h.calls.at(-1),{path:'/api/school/assignments/a3',args:{method:'PATCH',body:{active:true}}});
 await h.ui.click('school-edit-assignment',{dataset:{id:'a2'}});assert.equal(h.modals.at(-1)[0],'Edit teaching responsibility');assert.ok(h.modals.at(-1)[1].includes('value="pink:en" selected'));
});
test('read-only assignment viewers retain grouped details without edit, archive or delete controls',async()=>{
 const h=setup(false);await h.ui.route('timetable',{});assert.equal(h.document.querySelectorAll('#teacher-assignment-list tbody tr').length,3);assert.equal(h.document.querySelectorAll('[data-assignment-id]').length,5);assert.equal(h.document.querySelectorAll('#teacher-assignment-list button').length,0);assert.match(h.document.querySelector('.teacher-assignment-details summary').textContent,/View/);
});

test('inactive staff assignments stay in saved data but are excluded from the active teacher list',async()=>{
 const h=setup();h.structure.users=[{id:'a',name:'Archived sample teacher',role:'teacher',active:false}];await h.ui.route('timetable',{});assert.equal(h.document.querySelectorAll('#teacher-assignment-list tbody tr').length,2);assert.equal(h.document.querySelector('[data-assignment-id=a1]'),null);assert.equal(h.structure.assignments.length,5);
});
