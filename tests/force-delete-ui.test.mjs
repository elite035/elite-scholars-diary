import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {schoolUI} from '../public/school.js';
const esc=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
function setup(role='super_admin'){
 const {document,window}=parseHTML('<html><body><main id="content"></main><div id="modal"></div></body></html>');globalThis.document=document;globalThis.window=window;
 const capabilities=['records.force_delete','structure.manage','structure.view','structure.edit','structure.delete','people.manage','people.view','people.delete','assignments.manage','assignments.delete','quotes.manage','quotes.delete','diary.delete'],calls=[],modals=[];
 const structure={academics:[{id:'subject',kind:'subject',name:'Historical Subject',active:1,priority:2}],nodes:[],classCampuses:[],classSubjects:[],sectionSubjects:[],assignments:[],users:[],hierarchy:[],reviewers:[]};
 const impact={type:'academic',recordKind:'subject',id:'subject',name:'Historical Subject',summary:{academic:1,assignment:3},history:{diaries:2,approved:1},dependentRelationships:0,requiresAdditionalConfirmation:true,fingerprint:'current-dependency-fingerprint'};
 const api=async(path,args)=>{calls.push({path,args});if(path==='/api/school/bootstrap')return {capabilities,structure};if(path.includes('/force-delete/'))return args?.method?{ok:true}:impact;if(path==='/api/school/deleted-records')return [];return [];};
 const ui=schoolUI({api,state:{user:{id:'actor',role},capabilities,schoolConfig:structure},esc,field:(label,name,type,value='',attrs='')=>`<label>${label}<input name="${name}" type="${type}" value="${esc(value)}" ${attrs}></label>`,select:()=>'',button:(label,action,cls='',attrs='')=>`<button data-action="${action}" ${attrs}>${label}</button>`,card:(title,body)=>'<section><h2>'+title+'</h2>'+body+'</section>',heading:(title,description)=>'<h1>'+title+'</h1><p>'+description+'</p>',empty:label=>'<p>'+label+'</p>',modal:(title,html,save)=>{modals.push({title,html,save});document.querySelector('#modal').innerHTML='<form id="modal-form">'+html+'<button type="button">Cancel</button><button type="submit">Save</button></form>';},toast(){},render:async()=>{},displayDate:value=>value});
 return {ui,document,calls,modals,impact};
}
test('Force Delete is separate from Delete/Archive and previews a reasoned, typed, dependency-aware confirmation',async()=>{
 const h=setup();await h.ui.route('academics',{kind:'subject'});assert.ok(h.document.querySelector('[data-action=school-edit-structure]'));assert.ok(h.document.querySelector('[data-action=school-delete-structure]'));assert.ok(h.document.querySelector('[data-action=school-force-delete]'));assert.ok(h.ui.nav().some(item=>item[0]==='deleted'));
 await h.ui.click('school-force-delete',{dataset:{type:'academic',id:'subject'}});assert.equal(h.calls.at(-1).path,'/api/school/force-delete/academic/subject');assert.ok(!h.calls.some(call=>call.args?.method));
 const form=h.document.querySelector('#modal-form');assert.equal(form.querySelector('button[type=submit]').textContent,'Force Delete');for(const name of ['reason','confirm_name','confirmation','confirm_related'])assert.ok(form.querySelector('[name='+name+']').hasAttribute('required'));
 assert.match(form.textContent,/Historical Subject/);assert.match(form.textContent,/Historical diaries preserved: 2/);assert.match(form.textContent,/historical/i);
 const modal=h.modals.at(-1);await assert.rejects(modal.save({reason:'Confirmed removal',confirm_name:'wrong',confirmation:'FORCE DELETE',confirm_related:true}),/exact record name/);assert.ok(!h.calls.some(call=>call.args?.method));
 // Cancel closes this form without invoking the save callback or issuing a mutation.
 form.remove();assert.ok(!h.calls.some(call=>call.args?.method));
 await h.ui.click('school-force-delete',{dataset:{type:'academic',id:'subject'}});await h.modals.at(-1).save({reason:'Confirmed removal',confirm_name:h.impact.name,confirmation:'FORCE DELETE',confirm_related:true});assert.equal(h.calls.at(-1).args.method,'POST');assert.equal(h.calls.at(-1).args.body.fingerprint,h.impact.fingerprint);assert.equal(h.calls.at(-1).args.body.confirm_related,true);
});
test('non-administrators cannot expose Force Delete controls even with a forged frontend capability',async()=>{
 const h=setup('head_teacher');await h.ui.route('academics',{kind:'subject'});assert.equal(h.document.querySelector('[data-action=school-force-delete]'),null);assert.ok(!h.ui.nav().some(item=>item[0]==='deleted'));await assert.rejects(h.ui.click('school-force-delete',{dataset:{type:'academic',id:'subject'}}),/authorized administrators/);
});
test('Deleted records is a distinct read-only history page',async()=>{
 const h=setup();await h.ui.route('deleted',{});assert.equal(h.document.querySelector('h1').textContent,'Deleted records');assert.ok(h.calls.some(call=>call.path==='/api/school/deleted-records'));assert.equal(h.document.querySelectorAll('form,[data-action=school-force-delete]').length,0);
});
