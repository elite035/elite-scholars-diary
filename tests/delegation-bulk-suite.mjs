import test,{after} from 'node:test';import assert from 'node:assert/strict';import {mkdtempSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
export async function suite(runtime){
 process.env.NODE_ENV='test';process.env.COOKIE_SECURE='false';process.env.DATA_DIR=mkdtempSync(join(tmpdir(),'elite-bulk-'));if(runtime==='cloud')process.env.CLOUD_TEST_PGLITE='true';
 const {server,shutdown}=await import('../'+runtime+'/index.mjs'),db=await import('../'+runtime+'/db.mjs'),{fixtures}=await import('../scripts/'+(runtime==='cloud'?'cloud-':'')+'fixtures.mjs'),f=await fixtures();await new Promise(r=>server.listen(0,'127.0.0.1',r));after(shutdown);const base='http://127.0.0.1:'+server.address().port,auth={};
 async function req(path,user='super',method='GET',body){const a=auth[user],r=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(a?{Cookie:a.cookie,'X-CSRF-Token':a.csrf}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:r.headers.get('content-type')?.includes('json')?await r.json():await r.text(),cookie:r.headers.get('set-cookie')};}
 async function ok(path,user,method,body,status=200){const r=await req(path,user,method,body);assert.equal(r.status,status,JSON.stringify(r.data));return r.data;}
 for(const [key,user]of Object.entries(f.users)){const r=await req('/api/login',null,'POST',{email:user.email,password:f.password});auth[key]={cookie:r.cookie.split(';')[0],csrf:r.data.csrf};}
 const grant=(user,allows=[],denies=[])=>ok('/api/school/permissions','super','PUT',{user_id:f.users[user].id,allows,denies});
 const make=async(kind,name,parent_id)=>(await ok('/api/school/structure','super','POST',{kind,name,parent_id},201)).id;
 const branch=await make('branch','Bulk Branch'),campus=await make('campus','Bulk Campus',branch),klass=await make('class','Bulk Class',campus),blue=await make('section','Blue',klass),pink=await make('section','Pink',klass),subject=await make('subject','Bulk English');
 for(const sid of [blue,pink])await ok('/api/school/curriculum','super','PUT',{section_id:sid,subject_ids:[subject]});
 const assignments={};for(const user of ['teacher','teacherB']){await ok('/api/school/teacher-campuses/'+f.users[user].id,'super','PUT',{campus_id:campus,expected_campus_id:null});for(const sid of user==='teacher'?[blue,pink]:[blue])assignments[user+sid]=(await ok('/api/school/assignments','super','POST',{teacher_id:f.users[user].id,pairs:[{section_id:sid,subject_id:subject}],weekdays:[0,1,2,3,4,5,6],due_time:'16:00',review_time:'18:00'},201)).created[0];}
 const create=(user,sid,day,submit=true)=>ok('/api/school/diaries',user,'POST',{section_id:sid,diary_date:'2026-11-'+day,subject_languages:true,rows:[{assignment_id:assignments[user+sid],detail:'Homework '+day,language:'en',hw:true}],submit},201);
 const item=d=>({id:d.id,version:d.version}),bulk=(action,diaries,user='head',extra={})=>req('/api/school/diaries/bulk',user,'POST',{action,items:diaries.map(item),...extra});
 let a,b,foreign,stale;
 test(runtime+': delegated Coordinator and Head quote CRUD works and revocation/denials remain enforced',async()=>{
  assert.equal((await req('/api/school/quotes','coordinator')).status,403);
  for(const user of ['head','coordinator']){await grant(user,['quotes.manage']);assert.equal((await req('/api/school/quotes',user)).status,200);const quote=await ok('/api/school/quotes',user,'POST',{text:'Delegated '+user,language:'en',date:'2026-11-10',priority:900},201);await ok('/api/school/quotes/'+quote.id,user,'PATCH',{text:'Edited quote'});await ok('/api/school/quotes/'+quote.id,user,'DELETE');}
  await grant('head',['quotes.manage'],['quotes.create']);assert.equal((await req('/api/school/quotes','head','POST',{text:'Denied',language:'en',date:'2026-11-10'})).status,403);
  await grant('head',['quotes.manage']);await ok('/api/school/quotes','head','POST',{text:'Delegated quote is published',language:'en',date:'2026-11-10',priority:900},201);
  await grant('teacher',['quotes.manage']);assert.equal((await req('/api/school/quotes','teacher')).status,403);await grant('teacher');
  await grant('coordinator',['people.manage']);assert.equal((await req('/api/school/people','coordinator')).status,403);await grant('coordinator');assert.equal((await req('/api/school/quotes','coordinator')).status,403);
 });
 test(runtime+': bulk approvals use individual scope/current versions and leave rejected records unchanged',async()=>{
  a=await create('teacher',blue,'10');b=await create('teacher',pink,'10');foreign=await create('teacherB',blue,'10');stale=await create('teacher',blue,'11');
  const current=await ok('/api/school/diaries/'+stale.id+'/review','head','POST',{action:'under_review',version:stale.version});
  const response=await bulk('approved',[a,b,foreign,stale],'head',{remarks:'Bulk review'});assert.equal(response.status,200);assert.equal(response.data.succeeded,2);assert.equal(response.data.failed,2);assert.deepEqual(response.data.results.map(x=>x.ok),[true,true,false,false]);assert.equal(response.data.results[2].status_code,404);assert.equal(response.data.results[3].status_code,409);
  a=await ok('/api/school/diaries/'+a.id);b=await ok('/api/school/diaries/'+b.id);assert.equal(a.status,'approved');assert.equal(b.status,'approved');assert.equal(a.quotes[0].text,'Delegated quote is published');assert.equal((await ok('/api/school/diaries/'+foreign.id)).version,foreign.version);assert.equal((await ok('/api/school/diaries/'+stale.id)).version,current.version);
  const history=await ok('/api/school/diaries/'+a.id+'/versions');assert.equal(history.filter(x=>x.action==='approved').length,1);
  await grant('head',['quotes.manage'],['diary.approve']);assert.equal((await bulk('approved',[current])).status,403);assert.equal((await req('/api/school/diaries/'+current.id+'/review','head','POST',{action:'approved',version:current.version})).status,403);await grant('head',['quotes.manage']);
 });
 test(runtime+': bulk start/return/resubmit/approval/amendment preserve the normal publication workflow',async()=>{
  let diary=await create('teacher',blue,'12');let response=await bulk('under_review',[diary]);assert.equal(response.data.succeeded,1);diary.version=response.data.results[0].version;
  assert.equal((await bulk('returned',[diary],'head',{remarks:''})).status,400);response=await bulk('returned',[diary],'head',{remarks:'Please correct this work'});assert.equal(response.data.succeeded,1);diary.version=response.data.results[0].version;
  response=await bulk('submit',[diary],'teacher');assert.equal(response.data.succeeded,1);diary.version=response.data.results[0].version;assert.equal(response.data.results[0].status,'resubmitted');
  await grant('coordinator',['diary.approve','diary.amend']);response=await bulk('approved',[diary,foreign],'coordinator');assert.equal(response.data.succeeded,1);assert.equal(response.data.failed,1);diary.version=response.data.results[0].version;
  response=await bulk('amend',[diary],'coordinator',{reason:'Correct the published homework'});assert.equal(response.data.succeeded,1);assert.equal((await ok('/api/school/diaries/'+diary.id)).status,'returned');assert.equal((await req('/api/school/class-diaries/detail?section='+blue+'&date=2026-11-12')).status,404);assert.ok((await ok('/api/school/diaries/'+diary.id+'/versions')).some(x=>x.action==='approved'));await grant('coordinator');
 });
 test(runtime+': delegated draft trash/restore is scoped, preserves history and never discards approved diaries',async()=>{
  const draft=await create('teacher',blue,'13',false),other=await create('teacherB',blue,'13',false);await grant('head',['quotes.manage','diary.delete']);
  let response=await bulk('trash',[draft,a,other]);assert.equal(response.data.succeeded,1);assert.equal(response.data.failed,2);assert.equal((await ok('/api/school/diaries/'+a.id)).status,'approved');assert.equal((await ok('/api/school/diaries/'+other.id)).content.deleted_at,undefined);
  const discarded=await ok('/api/school/diaries/'+draft.id);assert.ok(discarded.content.deleted_at);response=await bulk('restore',[discarded]);assert.equal(response.data.succeeded,1);assert.equal((await ok('/api/school/diaries/'+draft.id)).content.deleted_at,undefined);assert.equal((await ok('/api/school/diaries/'+draft.id+'/versions')).length,3);
  await grant('head',['quotes.manage']);assert.equal((await bulk('trash',[draft])).status,403);
 });
 test(runtime+': repeated concurrent approvals create one approval history record',async()=>{
  const diary=await create('teacher',blue,'15'),responses=await Promise.all([bulk('approved',[diary]),bulk('approved',[diary])]);assert.equal(responses.reduce((n,r)=>n+r.data.succeeded,0),1);assert.equal(responses.reduce((n,r)=>n+r.data.failed,0),1);assert.equal((await ok('/api/school/diaries/'+diary.id+'/versions')).filter(v=>v.action==='approved').length,1);
 });
 test(runtime+': bulk operations cannot modify a force-deleted historical diary',async()=>{
  const diary=await create('teacher',blue,'16',false),path='/api/school/force-delete/diary/'+diary.id,impact=await ok(path);await ok(path,'super','POST',{reason:'Isolated history preservation test',confirmation:'FORCE DELETE',confirm_name:impact.name,confirm_related:true,fingerprint:impact.fingerprint});
  const before=(await ok('/api/school/diaries/'+diary.id)).version,response=await bulk('approved',[{...diary,version:before}]);assert.equal(response.data.failed,1);assert.equal(response.data.results[0].status_code,409);assert.equal((await ok('/api/school/diaries/'+diary.id)).version,before);
 });
 test(runtime+': bulk payloads reject duplicates, missing versions and unsupported actions before any mutation',async()=>{
  assert.equal((await bulk('approve',[a])).status,400);assert.equal((await bulk('approved',[a,a])).status,400);assert.equal((await req('/api/school/diaries/bulk','head','POST',{action:'approved',items:[{id:a.id}]})).status,400);assert.equal((await bulk('approved',Array.from({length:51},()=>a))).status,400);assert.equal((await bulk('approved',[foreign],'teacher')).status,403);
 });
}
