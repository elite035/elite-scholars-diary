import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateClassSections,duplicateClassSectionMessage} from '../public/class-sections.js';
import {schoolUI} from '../public/school.js';
const catalog={nodes:[{id:'campus',kind:'campus',name:'Campus',active:1},{id:'other',kind:'campus',name:'Other Campus',active:1}],classCampuses:[{class_id:'class',campus_id:'campus'}],academics:[{id:'class',kind:'class',name:'Class 4',active:1},{id:'section',kind:'section',name:'Blue',parent_id:'class',active:1}]};
test('combined form validates multiple names, case/whitespace duplicates and campus scope',()=>{
 assert.deepEqual(validateClassSections({parent_id:'campus',name:' Class 5 ',sections:' A\nB\n\n C '} ,catalog),{parent_id:'campus',name:'Class 5',sections:['A','B','C']});
 for(const sections of ['A\n a ',['Blue','Pink']])assert.throws(()=>validateClassSections({parent_id:'campus',name:' class 4 ',sections},catalog),{message:duplicateClassSectionMessage,status:409});
 assert.equal(validateClassSections({parent_id:'other',name:'Class 4',sections:['Blue']},catalog).sections[0],'Blue');
 for(const input of [{parent_id:'missing',name:'Class',sections:['A']},{parent_id:'campus',name:'',sections:['A']},{parent_id:'campus',name:'Class',sections:[]},{parent_id:'campus',name:'Class',sections:[123]},{parent_id:'campus',name:'Class',sections:['x'.repeat(101)]}])assert.throws(()=>validateClassSections(input,catalog));
});
test('Add Class and Section uses Campus and one request; frontend blocks duplicate combinations',async()=>{
 let dialog,calls=[];const ui=schoolUI({state:{schoolConfig:catalog},esc:String,field:(label,name)=>`<label>${label}<input name="${name}"></label>`,select:(label,name)=>`<label>${label}<select name="${name}"></select></label>`,modal:(title,body,submit)=>{dialog={title,body,submit};},api:async(path,options)=>{calls.push({path,...options});},toast:()=>{}});
 await ui.click('school-add-class-section',{dataset:{}});assert.equal(dialog.title,'Add Class and Section');assert.ok(dialog.body.includes('Parent Campus'));assert.ok(dialog.body.includes('name="sections"'));assert.ok(!dialog.body.includes('name="class_id"'));
 await assert.rejects(dialog.submit({parent_id:'campus',name:'Class 4',sections:'blue\nNew Section'}),{message:duplicateClassSectionMessage});assert.equal(calls.length,0);
 await dialog.submit({parent_id:'campus',name:'Class 4',sections:'Pink\nGreen'});assert.deepEqual(calls,[{path:'/api/school/structure',method:'POST',body:{kind:'class_sections',parent_id:'campus',name:'Class 4',sections:['Pink','Green']}}]);
});
