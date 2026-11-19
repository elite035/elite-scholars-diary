import test from 'node:test';import assert from 'node:assert/strict';import {parseHTML} from 'linkedom';import {schoolUI} from '../public/school.js';
const esc=x=>String(x??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
function setup(){
 const {document,window}=parseHTML('<main id="content"></main>');globalThis.document=document;globalThis.window=window;
 Object.defineProperty(window.HTMLSelectElement.prototype,'value',{configurable:true,get(){return this.querySelector('option[selected]')?.value||'';},set(v){this.querySelectorAll('option').forEach(x=>x.toggleAttribute('selected',x.value===v));}});
 const structure={users:[{id:'parent',name:'Parent One',role:'parent',active:1},{id:'other',name:'Parent Two',role:'parent',active:1}],nodes:[{id:'boys',name:'Boys Campus'},{id:'girls',name:'Girls Campus'}],classCampuses:[{class_id:'bc',campus_id:'boys'},{class_id:'gc',campus_id:'girls'}],academics:[{id:'bc',kind:'class',name:'Class 4',active:1},{id:'gc',kind:'class',name:'Class 4',active:1},{id:'bs',kind:'section',name:'Blue',parent_id:'bc',active:1},{id:'gs',kind:'section',name:'Blue',parent_id:'gc',active:1}]};
 const links=[{parent_id:'parent',parent_name:'Parent One',section_id:'bs',class_name:'Class 4',section_name:'Blue',child_name:'Existing child'}],calls=[];
 const api=async(path,args)=>{calls.push({path,args});return path==='/api/school/bootstrap'?{capabilities:['parents.manage'],structure}:path==='/api/school/parents'&&!args?links:{ok:true};};
 const ui=schoolUI({api,state:{user:{id:'admin',role:'super_admin'}},esc,field:(label,name,type,value='',extra='')=>`<label>${label}<input name="${name}" type="${type}" value="${value}" ${extra}></label>`,select:(label,name,items)=>`<label>${label}<select name="${name}"><option value="">Choose</option>${items.map(x=>`<option value="${x.id}">${x.name}</option>`).join('')}</select></label>`,card:(title,body)=>`<section><h2>${title}</h2>${body}</section>`,heading:(title,subtitle)=>`<h1>${title}</h1><p>${subtitle}</p>`,empty:()=>'<p>No records</p>',toast(){},render:async()=>{}});
 return {ui,document,window,calls,emit:(node,type)=>node.dispatchEvent(new window.Event(type,{bubbles:true,cancelable:true}))};
}
test('Parent Access disambiguates campuses, restores saved links and keeps checked sections when search hides them',async()=>{
 const h=setup();await h.ui.route('parents',{});const form=h.document.querySelector('form'),parent=form.querySelector('[name=parent_id]');
 const labels=[...form.querySelectorAll('[name=sections]')].map(x=>x.closest('label').textContent);assert.ok(labels.some(x=>x.includes('Boys Campus · Class 4 / Blue')));assert.ok(labels.some(x=>x.includes('Girls Campus · Class 4 / Blue')));
 parent.value='parent';h.emit(parent,'change');assert.equal(form.querySelector('[name=child_name]').value,'Existing child');assert.equal(form.querySelector('[value=bs]').checked,true);assert.match(form.querySelector('[data-parent-section-count]').textContent,/1 sections/);
 const search=form.querySelector('[name=section_search]');search.value='Girls';h.emit(search,'input');assert.equal(form.querySelector('[value=bs]').closest('label').hidden,true);assert.equal(form.querySelector('[value=bs]').checked,true);assert.equal(form.querySelector('[value=gs]').closest('label').hidden,false);
 search.value='missing';h.emit(search,'input');assert.equal(form.querySelector('[data-parent-no-results]').hidden,false);assert.ok(h.calls.every(x=>!x.args?.method));
 const Original=globalThis.FormData;globalThis.FormData=class{constructor(){return new Map([['parent_id','parent'],['child_name','Existing child']]);}};
 try{h.emit(form,'submit');await new Promise(r=>setTimeout(r,0));}finally{globalThis.FormData=Original;}
 const saved=h.calls.find(x=>x.args?.method==='PUT');assert.deepEqual(saved.args.body,{parent_id:'parent',links:[{section_id:'bs',child_name:'Existing child'}]});
 parent.value='other';h.emit(parent,'change');assert.equal(form.querySelector('[value=bs]').checked,false);assert.equal(form.querySelector('[name=child_name]').value,'');
});
