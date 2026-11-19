import test from 'node:test';import assert from 'node:assert/strict';import {createDiaryScope} from '../shared/diary-scope.mjs';
test('scope filtering uses constant queries for hundreds of records, and a fresh hierarchy on each operation',async()=>{
 let head='h1',queries=0;const db={all:async(sql)=>{queries++;return sql.includes('teacher_reviewers')?[{teacher_id:'teacher',head_id:head}]:[{head_id:'h1'}];}};
 const coordinator={id:'coordinator',role:'coordinator'},first=await createDiaryScope(db,coordinator);assert.equal(queries,2);
 for(let i=0;i<500;i++){assert.equal(first({teacher_id:'teacher'}),true);assert.equal(first({teacher_id:'other'}),false);}assert.equal(queries,2);
 head='h2';const fresh=await createDiaryScope(db,coordinator);assert.equal(fresh({teacher_id:'teacher'}),false);assert.equal(queries,4);
 const h2=await createDiaryScope(db,{id:'h2',role:'head_teacher'});assert.equal(h2({teacher_id:'teacher'}),true);assert.equal(h2({teacher_id:'other'}),false);
});
test('own-record and authorized school-wide access work without hierarchy queries; parent read_all cannot escalate',async()=>{
 const db={all:()=>{throw Error('Unexpected database query');}};
 for(const role of ['teacher','parent']){const scope=await createDiaryScope(db,{id:'self',role},{readAll:true});assert.equal(scope({teacher_id:'self'}),true);assert.equal(scope({teacher_id:'other'}),false);}
 for(const role of ['super_admin','school_admin','head_teacher','coordinator'])assert.equal((await createDiaryScope(db,{id:'self',role},{readAll:true}))({teacher_id:'other'}),true);
});
