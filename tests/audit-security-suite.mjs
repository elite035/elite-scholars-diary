import {totp} from '../shared/account-security.mjs';
import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
export async function auditSuite(runtime){
 process.env.ACCOUNT_SECURITY_KEY='2'.repeat(64);process.env.NODE_ENV='test';process.env.COOKIE_SECURE='false';process.env.DATA_DIR=mkdtempSync(join(tmpdir(),'elite-audit-contract-'));
 if(runtime==='cloud')process.env.CLOUD_TEST_PGLITE='true';
 const db=await import('../'+runtime+'/db.mjs'),{server,shutdown}=await import('../'+runtime+'/index.mjs'),{fixtures}=await import('../scripts/'+(runtime==='cloud'?'cloud-':'')+'fixtures.mjs');
 const f=await fixtures();await db.run('INSERT INTO section_subjects VALUES(?,?)',f.academics.section,f.academics.subject);
 await new Promise(r=>server.listen(0,'127.0.0.1',r));after(shutdown);const base='http://127.0.0.1:'+server.address().port,auth={};
 async function req(path,user='super',method='GET',body){const a=auth[user],r=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(a?{Cookie:a.cookie,'X-CSRF-Token':a.csrf}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:r.headers.get('content-type')?.includes('json')?await r.json():await r.text(),cookie:r.headers.get('set-cookie')};}
 for(const [key,user]of Object.entries(f.users)){const r=await req('/api/login',null,'POST',{email:user.email,password:f.password});auth[key]={cookie:r.cookie.split(';')[0],csrf:r.data.csrf};}
 const grant=(user,allows=[],denies=[])=>req('/api/school/permissions','super','PUT',{user_id:f.users[user].id,allows,denies});
 const rows=[{assignment_id:f.assignments.a,detail:'Audit homework',language:'en',hw:true}];
 const modern=(day,submit)=>({section_id:f.academics.section,diary_date:'2026-11-'+day,subject_languages:true,rows,submit});
 const content={topic:'Audit topic',todays_lesson:'Audit lesson',learning_objectives:'Audit objective'};
 const legacy=(day,submit)=>({assignment_id:f.assignments.a,diary_date:'2026-11-'+day,period:1,content,submit});
 test(runtime+': submission input types cannot bypass a deny or submit a false string',async()=>{
  await grant('teacher',[],['diary.submit']);
  for(const submit of ['true','false',1,0,null,[],{}])assert.equal((await req('/api/school/diaries','teacher','POST',modern('10',submit))).status,400);
  assert.equal((await req('/api/school/diaries','teacher','POST',modern('10',true))).status,403);
  assert.equal((await req('/api/school/diaries','teacher','POST',modern('10',false))).status,201);
  await grant('teacher');
 });
 test(runtime+': legacy create plus submit requires create and submit, not just submit',async()=>{
  await grant('teacher',[],['diary.create']);const before=Number((await db.one('SELECT count(*) n FROM diaries')).n);
  for(const submit of [false,true])assert.equal((await req('/api/diaries','teacher','POST',legacy('11',submit))).status,403);
  assert.equal(Number((await db.one('SELECT count(*) n FROM diaries')).n),before);await grant('teacher');
 });
 test(runtime+': collection and individual legacy export use effective permission denial',async()=>{
  const created=await req('/api/diaries','teacher','POST',legacy('12',false));assert.equal(created.status,201);
  await grant('teacher',[],['diary.export']);
  for(const path of ['/api/export?format=pdf','/api/diaries/'+created.data.id+'/export?format=pdf','/api/diaries/'+created.data.id+'/print'])assert.equal((await req(path,'teacher')).status,403,path);
  await grant('teacher');
 });
 test(runtime+': helper settings and calendar writes obey academic capability denial',async()=>{
  await grant('admin',[],['structure.manage']);
  assert.equal((await req('/api/assignment-session','admin','POST',{session_id:f.academics.session})).status,403);
  assert.equal((await req('/api/exceptions','admin','POST',{date:'2026-11-10',reason:'Denied holiday'})).status,403);
  await grant('admin');
 });
 test(runtime+': lower-privilege account bootstrap excludes internal campus mappings',async()=>{
  const value=db.settings();await db.run('UPDATE settings SET value=? WHERE id=1',JSON.stringify({...value,teacherCampusAssignments:{[f.users.teacher.id]:'internal-campus'}}));
  assert.equal(Object.hasOwn((await req('/api/me','teacher')).data.school,'teacherCampusAssignments'),false);
 });
 test(runtime+': delegated assignment mutation cannot target a different Heads teacher',async()=>{
  await grant('head',['assignments.manage']);const old=await db.one('SELECT active FROM assignments WHERE id=?',f.assignments.b);
  assert.equal((await req('/api/school/assignments/'+f.assignments.b,'head','PATCH',{active:false})).status,403);
  assert.equal((await db.one('SELECT active FROM assignments WHERE id=?',f.assignments.b)).active,old.active);
 });
 test(runtime+': newly issued temporary passwords require change without resetting existing users',async()=>{
  const created=await req('/api/school/people','super','POST',{name:'New real account',email:'first-login@example.invalid',role:'teacher',password:f.password});assert.equal(created.status,201);
  const signed=await req('/api/login',null,'POST',{email:'first-login@example.invalid',password:f.password});assert.equal(signed.status,200);assert.equal(signed.data.user.mustChangePassword,true);auth.first={cookie:signed.cookie.split(';')[0],csrf:signed.data.csrf};
  assert.equal((await req('/api/school/diaries','first')).status,403);
  const changed=await req('/api/profile','first','PATCH',{name:'New real account',currentPassword:f.password,newPassword:f.password+'-changed'});assert.equal(changed.status,200,JSON.stringify(changed.data));
  assert.equal((await req('/api/me','first')).data.user.mustChangePassword,false);assert.equal((await req('/api/school/diaries','first')).status,200);
  assert.equal((await req('/api/me','teacher')).data.user.mustChangePassword,false);
 });
 test(runtime+': authenticator setup, replay protection, one-use recovery and disabling work end to end',async()=>{
  const setup=await req('/api/school/security/setup','head','POST',{currentPassword:f.password});assert.equal(setup.status,200,JSON.stringify(setup.data));
  const pending=await db.one('SELECT pending_secret FROM account_security WHERE user_id=?',f.users.head.id);assert.ok(!pending.pending_secret.includes(setup.data.secret));
  const enabled=await req('/api/school/security/enable','head','POST',{currentPassword:f.password,code:totp(setup.data.secret)});assert.equal(enabled.status,200,JSON.stringify(enabled.data));assert.equal(enabled.data.recoveryCodes.length,10);
  const login=otp=>req('/api/login',null,'POST',{email:f.users.head.email,password:f.password,...(otp?{otp}:{})});
  assert.equal((await login()).status,401);assert.equal((await login('invalid')).status,401);
  const code=totp(setup.data.secret);assert.equal((await login(code)).status,200);assert.equal((await login(code)).status,401);
  assert.equal((await login(enabled.data.recoveryCodes[0])).status,200);assert.equal((await login(enabled.data.recoveryCodes[0])).status,401);
  const status=await req('/api/school/security','head');assert.equal(status.data.mfaEnabled,true);assert.ok(status.data.sessions.some(session=>session.current));
  assert.equal((await req('/api/school/security/disable','head','POST',{currentPassword:f.password,code:enabled.data.recoveryCodes[1]})).status,200);
  assert.equal((await login()).status,200);
  const audit=await db.all("SELECT details FROM audit WHERE action LIKE 'mfa_%'");assert.ok(audit.every(row=>!row.details.includes(setup.data.secret)&&!row.details.includes(enabled.data.recoveryCodes[0])));
 });

}
