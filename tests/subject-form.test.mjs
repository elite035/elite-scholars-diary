import {test} from 'node:test';
import assert from 'node:assert/strict';
import {campusClasses,selectionState,toggleSelection,validateSubjectAssignments,duplicateSubjectMessage} from '../public/subject-form.js';
const catalog={nodes:[{id:'campus',kind:'campus',active:1},{id:'other',kind:'campus',active:1}],classCampuses:[{class_id:'class',campus_id:'campus'},{class_id:'nursery',campus_id:'campus'},{class_id:'foreign',campus_id:'other'}],academics:[
 {id:'class',kind:'class',name:'Prep',active:1},{id:'nursery',kind:'class',active:1},{id:'foreign',kind:'class',active:1},
 {id:'a',kind:'section',parent_id:'class',active:1},{id:'b',kind:'section',parent_id:'class',active:1},{id:'c',kind:'section',parent_id:'nursery',active:1},
 {id:'archived',kind:'section',parent_id:'class',active:0},{id:'foreign-a',kind:'section',parent_id:'foreign',active:1},{id:'subject',kind:'subject',name:'English',active:1}
]};
test('subject tree filters campus and archived sections; selection derives parent and indeterminate states',()=>{
 const classes=campusClasses(catalog,'campus');assert.deepEqual(classes.map(x=>x.id),['class','nursery']);assert.deepEqual(classes.flatMap(x=>x.sections.map(s=>s.id)),['a','b','c']);
 const selected=new Set();assert.deepEqual(selectionState(['a','b'],selected),{checked:false,indeterminate:false});
 toggleSelection(selected,['a'],true);assert.deepEqual(selectionState(['a','b'],selected),{checked:false,indeterminate:true});
 toggleSelection(selected,['b'],true);assert.deepEqual(selectionState(['a','b'],selected),{checked:true,indeterminate:false});
 assert.deepEqual(selectionState(['a','b','c'],selected),{checked:false,indeterminate:true});
 toggleSelection(selected,['a','b','c'],true);assert.deepEqual(selectionState(['a','b','c'],selected),{checked:true,indeterminate:false});
 toggleSelection(selected,['a','b'],false);assert.deepEqual([...selected],['c']);toggleSelection(selected,['a','b','c'],false);assert.equal(selected.size,0);
 assert.deepEqual(selectionState([],selected),{checked:false,indeterminate:false});
});
test('subject validation requires campus/sections, rejects duplicates and cross-campus IDs',()=>{
 const input={name:' Mathematics ',priority:0,campus_id:'campus',section_ids:['a','c']};assert.deepEqual(validateSubjectAssignments(input,catalog),{...input,name:'Mathematics'});
 for(const changes of [{priority:undefined},{priority:''},{priority:-1},{priority:1.5},{name:''},{name:'a'.repeat(101)},{campus_id:''},{campus_id:'missing'},{section_ids:[]},{section_ids:['foreign-a']},{section_ids:['archived']},{section_ids:['a','missing']},{section_ids:[123]}])assert.throws(()=>validateSubjectAssignments({...input,...changes},catalog),{status:400});
 assert.throws(()=>validateSubjectAssignments({...input,section_ids:['a','a']},catalog),{status:409});
 assert.throws(()=>validateSubjectAssignments({...input,name:' english '},catalog),{message:duplicateSubjectMessage,status:409});
});
