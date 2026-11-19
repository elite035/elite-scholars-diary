import {businessNow} from '../shared/clock.mjs';
import {test,after} from 'node:test';import assert from 'node:assert/strict';import {mkdtempSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import webpush from 'web-push';
export async function suite(runtime){
 process.env.NODE_ENV='test';process.env.COOKIE_SECURE='false';process.env.DATA_DIR=mkdtempSync(join(tmpdir(),'elite-school-'));if(runtime==='cloud')process.env.CLOUD_TEST_PGLITE='true';const vapid=webpush.generateVAPIDKeys();process.env.VAPID_PUBLIC_KEY=vapid.publicKey;process.env.VAPID_PRIVATE_KEY=vapid.privateKey;process.env.VAPID_SUBJECT='https://diary.elitescholars.edu.pk';
 const {server,shutdown}=await import('../'+runtime+'/index.mjs'),db=await import('../'+runtime+'/db.mjs'),domain=await import('../'+runtime+'/domain.mjs');const {fixtures}=await import('../scripts/'+(runtime==='cloud'?'cloud-':'')+'fixtures.mjs');const f=await fixtures();await new Promise(r=>server.listen(0,'127.0.0.1',r));after(shutdown);const base='http://127.0.0.1:'+server.address().port,auth={};
 async function req(path,user='super',method='GET',body,csrf=true){const a=auth[user],r=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(a?{Cookie:a.cookie,...(csrf?{'X-CSRF-Token':a.csrf}:{})}:{})},...(body?{body:JSON.stringify(body)}:{})});const data=r.headers.get('content-type')?.includes('json')?await r.json():await r.text();return {status:r.status,data,cookie:r.headers.get('set-cookie')};}
 async function ok(path,user,method,body,status=200){const r=await req(path,user,method,body);assert.equal(r.status,status,JSON.stringify(r.data));return r.data;}
 async function login(key,user){const r=await req('/api/login',null,'POST',{email:user.email,password:f.password});assert.equal(r.status,200,JSON.stringify(r.data));auth[key]={cookie:r.cookie.split(';')[0],csrf:r.data.csrf};if(r.data.user.mustChangePassword){const changed=await req('/api/profile',key,'PATCH',{name:user.name||'Test account',currentPassword:f.password,newPassword:f.password+'-changed'});assert.equal(changed.status,200,JSON.stringify(changed.data));}}
 for(const key of Object.keys(f.users))await login(key,f.users[key]);
 let branch,campus,klass,section,otherSection,english,urdu,parent,parentB,diary,second,quote;
 const setCampus=async(teacherId,campusId)=>{const map=(await db.one('SELECT value FROM settings WHERE id=1')).value;const current=(typeof map==='string'?JSON.parse(map):map).teacherCampusAssignments||{};return ok('/api/school/teacher-campuses/'+teacherId,'super','PUT',{campus_id:campusId,expected_campus_id:current[teacherId]||null});};
 const date=businessNow().toISOString().slice(0,10),make=(kind,name,parent_id)=>ok('/api/school/structure','super','POST',{kind,name,parent_id},201);
 test(runtime+': diary notices are permissioned, validated, listed and never exposed in public settings',async()=>{
  assert.deepEqual((await ok('/api/school/notices','super')).notices,[]);
  assert.equal((await req('/api/school/notices','teacher','POST',{text:'x',published:true})).status,403);
  assert.equal((await req('/api/school/notices','super','POST',{published:true})).status,400);
  assert.equal((await req('/api/school/notices','super','POST',{text:'x'.repeat(401)})).status,400);
  assert.equal((await req('/api/school/notices','super','POST',{text:'x',class_ids:['missing']})).status,400);
  const made=await ok('/api/school/notices','super','POST',{title:'Meeting',text:'Parent meeting on Saturday',language:'en',published:true},201);
  const saved=(await ok('/api/school/notices','super')).notices;assert.equal(saved.length,1);assert.equal(saved[0].published,true);assert.deepEqual(saved[0].class_ids,[]);assert.equal(saved[0].startDate,businessNow().toISOString().slice(0,10));
  const s=await ok('/api/settings');assert.equal(s.diaryNotice,undefined);assert.equal(s.diaryNotices,undefined);
  await ok('/api/school/notices/'+made.notice.id,'super','PUT',{published:false});
  assert.equal((await ok('/api/school/notices','super')).notices[0].published,false);
  await ok('/api/school/notices/'+made.notice.id,'super','DELETE');
  assert.deepEqual((await ok('/api/school/notices','super')).notices,[]);
 });
 test(runtime+': branch/campus/class/section relationships and invalid parents are enforced',async()=>{
  assert.equal((await req('/api/school/structure','super','POST',{kind:'class',name:'No campus'})).status,400);branch=(await make('branch','Test Branch')).id;campus=(await make('campus','Test Campus',branch)).id;await setCampus(f.users.teacher.id,campus);await setCampus(f.users.teacherB.id,campus);klass=(await make('class','Test Platform Class',campus)).id;section=(await make('section','Blue',klass)).id;otherSection=(await make('section','Pink',klass)).id;english=(await make('subject','Platform English')).id;urdu=(await make('subject','Platform Urdu')).id;assert.equal((await req('/api/school/structure','teacher','POST',{kind:'branch',name:'Hacked'})).status,403);assert.equal((await req('/api/school/structure/'+campus,'super','PATCH',{active:false})).status,409);assert.equal((await req('/api/school/structure','super','POST',{kind:'section',name:'Bad',parent_id:campus})).status,400);assert.equal((await req('/api/school/structure','super','POST',{kind:'branch',name:'test branch'})).status,409);
 });
 test(runtime+': malformed request bodies and pagination return controlled errors, not server failures',async()=>{
  for(const body of ['null','[]','true','"text"','{broken']){const response=await fetch(base+'/api/school/people',{method:'POST',headers:{'Content-Type':'application/json',Cookie:auth.super.cookie,'X-CSRF-Token':auth.super.csrf},body});assert.equal(response.status,400);}
  for(const page of ['Infinity','-1','1.5'])assert.equal((await req('/api/school/diaries?page='+page)).status,400);
 });
 test(runtime+': teacher campus updates validate active teacher role, parent branch and stale mappings',async()=>{
  const before=(await db.one('SELECT value FROM settings WHERE id=1')).value;
  for(const teacher of ['missing',f.users.head.id,f.users.super.id])assert.equal((await req('/api/school/teacher-campuses/'+teacher,'super','PUT',{campus_id:campus,expected_campus_id:null})).status,400);
  assert.equal((await req('/api/school/teacher-campuses/'+f.users.teacher.id,'teacher','PUT',{campus_id:campus,expected_campus_id:campus})).status,403);
  assert.equal((await req('/api/school/teacher-campuses/'+f.users.teacher.id,'super','PUT',{campus_id:campus,expected_campus_id:null})).status,409);
  await db.run('UPDATE school_nodes SET active=0 WHERE id=?',branch);
  try{assert.equal((await req('/api/school/teacher-campuses/'+f.users.teacher.id,'super','PUT',{campus_id:campus,expected_campus_id:campus})).status,400);}finally{await db.run('UPDATE school_nodes SET active=1 WHERE id=?',branch);}
  assert.deepEqual((await db.one('SELECT value FROM settings WHERE id=1')).value,before);
 });
 test(runtime+': stale school identity and template forms preserve the current settings and mappings',async()=>{
  const before=(await ok('/api/settings')),version=before.templateVersion;
  assert.equal((await req('/api/school-identity','super','PATCH',{name:before.name,address:before.address,contact:before.contact,logo:before.logo,expected_template_version:version-1})).status,version===1?400:409);
  assert.equal((await req('/api/settings','super','PUT',{...before,expected_template_version:version-1})).status,version===1?400:409);
  assert.deepEqual(await ok('/api/settings'),before);
 });
 test(runtime+': subject creation assigns one master to multiple campus sections atomically and preserves existing curriculum',async()=>{
  const baseline=await db.all('SELECT * FROM academics ORDER BY id'),links=await db.all('SELECT * FROM section_subjects ORDER BY section_id,subject_id');
  const secondClass=(await make('class','Subject tree class',campus)).id,third=(await make('section','Green',secondClass)).id;
  const create=(name,section_ids,campus_id=campus,user='super',csrf=true)=>req('/api/school/structure',user,'POST',{kind:'subject_assignments',name,priority:0,campus_id,section_ids},csrf);
  const one=await create('New Single Subject',[section]);assert.equal(one.status,201,JSON.stringify(one.data));
  const multi=await create('New Multi Subject',[section,otherSection,third]);assert.equal(multi.status,201,JSON.stringify(multi.data));
  assert.equal(Number((await db.one("SELECT COUNT(*) n FROM academics WHERE name='New Multi Subject'")).n),1);
  assert.equal((await db.all('SELECT * FROM section_subjects WHERE subject_id=?',multi.data.id)).length,3);
  assert.equal((await db.all('SELECT * FROM class_subjects WHERE subject_id=?',multi.data.id)).length,2);
  for(const [name,ids,cp,status] of [[' new multi subject ',[section],campus,409],['Invalid empty',[],campus,400],['Invalid duplicate',[section,section],campus,409],['Invalid campus',[section],branch,400],['Invalid scope',[f.academics.section],campus,400],['Invalid mixed',[section,'missing'],campus,400],['',[section],campus,400]]){
   const result=await create(name,ids,cp);assert.equal(result.status,status,JSON.stringify(result.data));
   if(name.startsWith('Invalid'))assert.ok(!await db.one("SELECT 1 FROM academics WHERE name=?",name));
  }
  assert.equal((await create('Forbidden subject',[section],campus,'teacher')).status,403);
  assert.equal((await create('CSRF subject',[section],campus,'super',false)).status,403);
  const concurrent=await Promise.all([create('Concurrent Subject',[section]),create('Concurrent Subject',[otherSection])]);assert.deepEqual(concurrent.map(x=>x.status).sort(),[201,409]);
  const raced=concurrent.find(x=>x.status===201).data.id;
  await ok('/api/school/structure/'+multi.data.id,'super','PATCH',{name:'Renamed Multi Subject'});
  const structure=await ok('/api/school/structure');assert.equal(structure.academics.find(x=>x.id===multi.data.id).name,'Renamed Multi Subject');assert.equal(structure.sectionSubjects.filter(x=>x.subject_id===multi.data.id).length,3);
  assert.equal((await req('/api/school/structure/'+multi.data.id,'super','DELETE')).status,409);
  for(const old of baseline)assert.deepEqual(await db.one('SELECT * FROM academics WHERE id=?',old.id),old);
  for(const link of links)assert.ok(await db.one('SELECT 1 FROM section_subjects WHERE section_id=? AND subject_id=?',link.section_id,link.subject_id));
  for(const sid of [section,otherSection,third])await ok('/api/school/curriculum','super','PUT',{section_id:sid,subject_ids:links.filter(x=>x.section_id===sid).map(x=>x.subject_id)});
  for(const id of [one.data.id,multi.data.id,raced,third,secondClass])await ok('/api/school/structure/'+id,'super','DELETE');
 });
 test(runtime+': combined Class and Sections create atomically, reuse existing classes and preserve subject links',async()=>{
  const original=await db.all('SELECT * FROM academics ORDER BY id'),originalLinks=await db.all('SELECT * FROM class_subjects ORDER BY class_id,subject_id'),duplicate='This class and section are already assigned to this campus.';
  const create=(name,sections,parent_id=campus)=>req('/api/school/structure','super','POST',{kind:'class_sections',parent_id,name,sections});
  let response=await create('Combined Class',['Blue','Pink']);assert.equal(response.status,201,JSON.stringify(response.data));const klass=response.data.id,sectionIDs=response.data.sections.map(x=>x.id);assert.equal(response.data.class_created,true);assert.equal(response.data.sections.length,2);assert.equal((await db.one('SELECT campus_id FROM class_campuses WHERE class_id=?',klass)).campus_id,campus);for(const sid of sectionIDs)assert.equal((await db.one('SELECT parent_id FROM academics WHERE id=?',sid)).parent_id,klass);
  response=await create(' combined class ',[' blue ','Green']);assert.equal(response.status,409);assert.equal(response.data.error,duplicate);assert.ok(!await db.one("SELECT 1 FROM academics WHERE parent_id=? AND name='Green'",klass));
  response=await create('COMBINED CLASS',['Green']);assert.equal(response.status,201);assert.equal(response.data.id,klass);assert.equal(response.data.class_created,false);sectionIDs.push(response.data.sections[0].id);
  response=await create('Rejected Class',['A',' a ']);assert.equal(response.status,409);assert.equal(response.data.error,duplicate);assert.ok(!await db.one("SELECT 1 FROM academics WHERE name='Rejected Class'"));assert.equal((await create('No Sections',[])).status,400);assert.equal((await create('Wrong Campus',['A'],branch)).status,400);
  const otherCampus=(await make('campus','Combined other campus',branch)).id;response=await create('Combined Class',['Blue'],otherCampus);assert.equal(response.status,201);assert.notEqual(response.data.id,klass);await ok('/api/school/structure/'+response.data.sections[0].id,'super','DELETE');await ok('/api/school/structure/'+response.data.id,'super','DELETE');await ok('/api/school/structure/'+otherCampus,'super','DELETE');
  await ok('/api/school/curriculum','super','PUT',{section_id:sectionIDs[0],subject_ids:[english,urdu]});await ok('/api/school/curriculum','super','PUT',{section_id:sectionIDs[1],subject_ids:[english]});assert.equal((await db.all('SELECT * FROM section_subjects WHERE section_id=?',sectionIDs[0])).length,2);assert.equal((await db.all('SELECT * FROM section_subjects WHERE section_id=?',sectionIDs[1])).length,1);
  for(const old of original)assert.deepEqual(await db.one('SELECT * FROM academics WHERE id=?',old.id),old);for(const link of originalLinks)assert.ok(await db.one('SELECT 1 FROM class_subjects WHERE class_id=? AND subject_id=?',link.class_id,link.subject_id));
  for(const sid of sectionIDs){await ok('/api/school/curriculum','super','PUT',{section_id:sid,subject_ids:[]});await ok('/api/school/structure/'+sid,'super','DELETE');}await ok('/api/school/structure/'+klass,'super','DELETE');
  const unauthorized=await req('/api/school/structure','teacher','POST',{kind:'class_sections',parent_id:campus,name:'Forbidden',sections:['A']});assert.equal(unauthorized.status,403);assert.equal((await req('/api/school/structure','super','POST',{kind:'class_sections',parent_id:campus,name:'No CSRF',sections:['A']},false)).status,403);
 });
 test(runtime+': simultaneous combined requests cannot duplicate a campus/class/section',async()=>{
  const body={kind:'class_sections',parent_id:campus,name:'Concurrent Combined',sections:['A','B']},responses=await Promise.all([req('/api/school/structure','super','POST',body),req('/api/school/structure','super','POST',body)]);assert.deepEqual(responses.map(x=>x.status).sort(),[201,409]);assert.equal(responses.find(x=>x.status===409).data.error,'This class and section are already assigned to this campus.');const made=responses.find(x=>x.status===201).data;for(const section of made.sections)await ok('/api/school/structure/'+section.id,'super','DELETE');await ok('/api/school/structure/'+made.id,'super','DELETE');
 });
 test(runtime+': section curricula differ, assignment combinations are validated and hierarchy is explicit',async()=>{
  await ok('/api/school/curriculum','super','PUT',{section_id:section,subject_ids:[english,urdu]});await ok('/api/school/curriculum','super','PUT',{section_id:otherSection,subject_ids:[english]});await ok('/api/school/hierarchy','super','PUT',{coordinator_id:f.users.coordinator.id,head_ids:[f.users.head.id]});await ok('/api/school/reviewers','super','PUT',{head_id:f.users.head.id,teacher_ids:[f.users.teacher.id]});await ok('/api/school/reviewers','super','PUT',{head_id:f.users.headB.id,teacher_ids:[f.users.teacherB.id]});const body={teacher_id:f.users.teacher.id,session_id:f.academics.session,pairs:[{section_id:section,subject_id:english},{section_id:section,subject_id:urdu}],weekdays:[0,1,2,3,4,5,6],due_time:'16:00',review_time:'18:00'};assert.equal((await ok('/api/school/assignments','super','POST',body,201)).created.length,2);assert.equal((await ok('/api/school/assignments','super','POST',body,201)).created.length,0);assert.equal((await req('/api/school/assignments','super','POST',{...body,pairs:[{section_id:otherSection,subject_id:urdu}]})).status,400);await ok('/api/school/assignments','super','POST',{...body,teacher_id:f.users.teacherB.id,pairs:[{section_id:section,subject_id:english},{section_id:otherSection,subject_id:english}]},201);assert.equal((await req('/api/school/curriculum','super','PUT',{section_id:section,subject_ids:[english]})).status,409);const scoped=await ok('/api/school/structure','teacher');assert.ok(scoped.assignments.every(a=>a.teacher_id===f.users.teacher.id));
 });
 test(runtime+': unused management records support delete and protected records reject destructive edits',async()=>{
  const unusedSubject=await make('subject','Archive regression subject');await ok('/api/school/structure/'+unusedSubject.id,'super','PATCH',{active:false});await ok('/api/school/structure/'+unusedSubject.id,'super','PATCH',{active:true});await ok('/api/school/structure/'+unusedSubject.id,'super','DELETE');const unit=await make('branch','Unused branch');await ok('/api/school/structure/'+unit.id,'super','DELETE');assert.equal((await req('/api/school/structure/'+campus,'super','DELETE')).status,409);
  const body={teacher_id:f.users.teacher.id,session_id:f.academics.session,pairs:[{section_id:otherSection,subject_id:english}],weekdays:[0,1,2,3,4,5,6],due_time:'16:00',review_time:'18:00'},made=await ok('/api/school/assignments','super','POST',body,201);const aid=made.created[0];await ok('/api/school/assignments/'+aid,'super','PUT',{weekdays:[1,2],due_time:'15:00',review_time:'17:00'});const spare=(await make('section','Unused schedule section',klass)).id;await ok('/api/school/curriculum','super','PUT',{section_id:spare,subject_ids:[english]});await ok('/api/school/assignments/'+aid,'super','PUT',{teacher_id:f.users.teacherB.id,section_id:spare,subject_id:english,weekdays:[1],due_time:'15:00',review_time:'17:00'});assert.equal((await db.one('SELECT teacher_id FROM assignments WHERE id=?',aid)).teacher_id,f.users.teacherB.id);assert.equal((await req('/api/school/assignments/'+aid,'super','PUT',{section_id:otherSection,weekdays:[1],due_time:'15:00',review_time:'17:00'})).status,409);await ok('/api/school/assignments/'+aid,'super','DELETE');assert.ok(!await db.one('SELECT 1 FROM assignments WHERE id=?',aid));await ok('/api/school/curriculum','super','PUT',{section_id:spare,subject_ids:[]});await ok('/api/school/structure/'+spare,'super','DELETE');
  const q=await ok('/api/school/quotes','super','POST',{text:'Temporary verification quote',language:'en',date:'2027-01-01',priority:0},201);await ok('/api/school/quotes/'+q.id,'super','DELETE');assert.ok(!await db.one('SELECT 1 FROM quotes WHERE id=?',q.id));
 });
 test(runtime+': structure CRUD persists parent/date edits and permits the same class name in different campuses',async()=>{
  const b=(await make('branch','CRUD Branch')).id,c1=(await make('campus','CRUD Campus A',b)).id,c2=(await make('campus','CRUD Campus B',b)).id,k1=(await make('class','CRUD Class',c1)).id,k2=(await make('class','CRUD Class',c2)).id;
  assert.equal((await req('/api/school/structure','super','POST',{kind:'class',name:'CRUD Class',parent_id:c1})).status,409);
  const sec=(await make('section','CRUD Section',k1)).id;await ok('/api/school/structure/'+sec,'super','PATCH',{parent_id:k2,name:'Moved section'});assert.equal((await db.one('SELECT parent_id FROM academics WHERE id=?',sec)).parent_id,k2);
  const session=await ok('/api/school/structure','super','POST',{kind:'session',name:'CRUD Future Session',start_date:'2030-01-01',end_date:'2030-12-31'},201);await ok('/api/school/structure/'+session.id,'super','PATCH',{start_date:'2031-01-01',end_date:'2031-12-31'});assert.equal((await db.one('SELECT start_date FROM academics WHERE id=?',session.id)).start_date,'2031-01-01');assert.equal((await req('/api/school/structure/'+session.id,'super','PATCH',{start_date:'2032-01-01',end_date:'2031-01-01'})).status,400);
  for(const uid of [sec,k1,k2,c1,c2,b,session.id])await ok('/api/school/structure/'+uid,'super','DELETE');
 });
 test(runtime+': hierarchy deselection really removes links and reviewer changes update future class duties',async()=>{
  await ok('/api/school/reviewers','super','PUT',{head_id:f.users.head.id,teacher_ids:[],confirm_unassigned:true});assert.equal(await db.one('SELECT 1 FROM teacher_reviewers WHERE teacher_id=?',f.users.teacher.id),undefined);
  await ok('/api/school/reviewers','super','PUT',{head_id:f.users.headB.id,teacher_ids:[f.users.teacher.id,f.users.teacherB.id]});const duties=await db.all('SELECT head_id FROM assignments WHERE teacher_id=? AND section_id=?',f.users.teacher.id,section);assert.ok(duties.every(x=>x.head_id===f.users.headB.id));
  await ok('/api/school/reviewers','super','PUT',{head_id:f.users.head.id,teacher_ids:[f.users.teacher.id]});await ok('/api/school/reviewers','super','PUT',{head_id:f.users.headB.id,teacher_ids:[f.users.teacherB.id]});
 });
 test(runtime+': assignment session is automatic and quote date/language/priority updates persist',async()=>{
  const created=await ok('/api/school/assignments','super','POST',{teacher_id:f.users.teacher.id,pairs:[{section_id:otherSection,subject_id:english}],weekdays:[1,2],due_time:'15:00',review_time:'17:00'},201);assert.equal(created.created.length,1);await ok('/api/school/assignments/'+created.created[0],'super','DELETE');
  const q=await ok('/api/school/quotes','super','POST',{text:'Quote before edit',language:'en',date:'2030-01-01',priority:0},201);await ok('/api/school/quotes/'+q.id,'super','PATCH',{text:'علم روشنی ہے',language:'ur',date:'2030-01-02',priority:10});const saved=await db.one('SELECT * FROM quotes WHERE id=?',q.id),schedule=await db.one('SELECT * FROM quote_schedules WHERE quote_id=?',q.id);assert.equal(saved.language,'ur');assert.equal(saved.direction,'rtl');assert.equal(schedule.date,'2030-01-02');assert.equal(schedule.priority,10);await ok('/api/school/quotes/'+q.id,'super','DELETE');
 });
 test(runtime+': School Admin identity/template access and bounded permission delegation work without legacy grants',async()=>{
  const before=db.settings();await ok('/api/school-identity','admin','PATCH',{name:before.name,address:before.address,contact:before.contact,logo:before.logo});assert.equal((await req('/api/templates','admin')).status,200);assert.equal((await req('/api/school/permissions','admin')).status,200);
  assert.equal((await req('/api/school/permissions','admin','PUT',{user_id:f.users.teacher.id,allows:['communication.oversight'],denies:[]})).status,403);assert.equal((await req('/api/school/permissions','admin','PUT',{role:'school_admin',grants:['diary.view']})).status,403);
  await ok('/api/school/permissions','super','PUT',{user_id:f.users.admin.id,allows:[],denies:['settings.manage','template.manage']});assert.equal((await req('/api/school-identity','admin','PATCH',{name:'Blocked edit'})).status,403);assert.equal((await req('/api/templates','admin')).status,403);await ok('/api/school/permissions','super','PUT',{user_id:f.users.admin.id,allows:[],denies:[]});
  const self=await ok('/api/school/people/'+f.users.super.id,'super','PATCH',{name:f.users.super.name});assert.equal(self.ok,true);assert.equal((await req('/api/me','super')).status,200);
 });
 test(runtime+': granular CRUD denials block both modern and retained mutation endpoints',async()=>{
  const branch=(await make('branch','Granular permission branch')).id;await ok('/api/school/permissions','super','PUT',{user_id:f.users.admin.id,allows:[],denies:['structure.delete']});assert.equal((await req('/api/school/structure/'+branch,'admin','DELETE')).status,403);assert.equal((await req('/api/academics/'+f.academics.subject,'admin','DELETE')).status,403);await ok('/api/school/structure/'+branch,'admin','PATCH',{name:'Permitted name edit'});await ok('/api/school/permissions','super','PUT',{user_id:f.users.admin.id,allows:[],denies:[]});await ok('/api/school/structure/'+branch,'super','DELETE');
 });
 test(runtime+': changing an unused account role clears former explicit privilege grants',async()=>{
  const account=await ok('/api/school/people','super','POST',{name:'Role transition regression',email:'role-transition@example.invalid',role:'head_teacher',password:f.password},201);await db.run('UPDATE users SET permissions=? WHERE id=?',JSON.stringify(['read_all','manage_settings']),account.id);await ok('/api/school/permissions','super','PUT',{user_id:account.id,allows:['diary.amend'],denies:[]});await ok('/api/school/people/'+account.id,'super','PATCH',{role:'teacher'});const saved=await db.one('SELECT * FROM users WHERE id=?',account.id);assert.equal(saved.permissions,'[]');assert.equal(await db.one('SELECT 1 FROM user_capabilities WHERE user_id=?',account.id),undefined);await ok('/api/users/'+account.id,'super','DELETE');
 });
 test(runtime+': parent accounts and links persist without opening administrative APIs',async()=>{
  parent=await ok('/api/school/people','super','POST',{name:'Test Family A',email:'family-a@example.invalid',password:f.password,role:'parent'},201);parentB=await ok('/api/school/people','super','POST',{name:'Test Family B',email:'family-b@example.invalid',password:f.password,role:'parent'},201);await login('parent',parent);await login('parentB',parentB);await ok('/api/school/parents','super','PUT',{parent_id:parent.id,links:[{section_id:section,child_name:'Child A'}]});await ok('/api/school/parents','super','PUT',{parent_id:parentB.id,links:[{section_id:otherSection,child_name:'Child B'}]});for(const path of ['/api/lookups','/api/diaries','/api/audit','/api/communication','/api/school/structure','/api/school/people','/api/school/reports?start='+date+'&end='+date])assert.equal((await req(path,'parent')).status,403,path);assert.equal((await req('/api/school/family?section='+section,'parentB')).status,404);assert.equal((await req('/api/school/parents','teacher','PUT',{parent_id:parent.id,links:[]})).status,403);assert.equal((await req('/api/school/curriculum','super','PUT',{section_id:section,subject_ids:[english,urdu]},false)).status,403);
 });
 test(runtime+': one English/Urdu diary holds multiple authorized subjects and rejects duplicates and forged rows',async()=>{
  const as=(await ok('/api/school/structure','teacher')).assignments.filter(a=>a.section_id===section),rows=as.map(a=>({assignment_id:a.id,detail:a.subject_id===urdu?'سبق پڑھیں — اردو کی مشق کریں۔':'Read the chapter and complete the exercise.',hw:true,learn:true,test:false}));const body={section_id:section,diary_date:date,language:'ur',rows};diary=await ok('/api/school/diaries','teacher','POST',body,201);assert.equal(diary.content.homework_rows.length,2);assert.equal(diary.language,'ur');assert.ok(diary.content.homework_rows.every(r=>r.direction==='rtl'));assert.equal((await req('/api/school/diaries','teacher','POST',body)).status,409);assert.equal((await req('/api/school/diaries','teacher','POST',{...body,diary_date:'2027-01-01',rows:[{...rows[0],assignment_id:f.assignments.b}]})).status,403);assert.equal((await req('/api/school/diaries/'+diary.id,'teacherB')).status,404);assert.equal((await req('/api/school/diaries/'+diary.id,'headB')).status,404);assert.equal((await ok('/api/school/family?section='+section,'parent')).available,false);assert.equal((await req('/api/school/family/preview?section='+section+'&date='+date,'parent')).status,404);
 });
 test(runtime+': drafts move to recoverable Trash with stale-version protection and retained content/history',async()=>{
  const a=(await ok('/api/school/structure','teacherB')).assignments.find(a=>a.section_id===otherSection);let d=await ok('/api/school/diaries','teacherB','POST',{section_id:otherSection,diary_date:date,language:'en',rows:[{assignment_id:a.id,detail:'Draft kept for recovery',hw:true}]},201);
  await ok('/api/school/diaries/'+d.id,'teacherB','DELETE',{version:d.version});assert.ok(!(await ok('/api/school/diaries','teacherB')).items.some(x=>x.id===d.id));const trash=await ok('/api/school/diaries?deleted=1','teacherB');assert.ok(trash.items.some(x=>x.id===d.id));
  assert.equal((await req('/api/school/diaries/'+d.id+'/restore','teacherB','POST',{version:d.version})).status,409);d=await ok('/api/school/diaries/'+d.id,'teacherB');assert.equal(d.content.homework_rows[0].detail,'Draft kept for recovery');await ok('/api/school/diaries/'+d.id+'/restore','teacherB','POST',{version:d.version});assert.ok((await ok('/api/school/diaries','teacherB')).items.some(x=>x.id===d.id));assert.ok((await ok('/api/school/diaries/'+d.id+'/versions','teacherB')).some(v=>v.action==='draft_restored'));
 });
 test(runtime+': submit, return with private comments, stale-version rejection, resubmit and final Head approval',async()=>{
  const rows=diary.content.homework_rows.map(r=>({assignment_id:r.assignment_id,detail:r.detail,hw:r.hw,learn:r.learn,test:r.test})),body={language:'ur',rows,version:diary.version,submit:true};diary=await ok('/api/school/diaries/'+diary.id,'teacher','PUT',body);assert.equal(diary.status,'submitted');assert.ok((await ok('/api/school/diaries?status=pending','head')).items.some(x=>x.id===diary.id));assert.equal((await req('/api/school/diaries/'+diary.id,'teacher','PUT',{...body,version:diary.version})).status,409);assert.equal((await req('/api/school/diaries/'+diary.id+'/review','headB','POST',{action:'approved',version:diary.version})).status,404);assert.equal((await req('/api/school/diaries/'+diary.id+'/review','head','POST',{action:'returned',version:diary.version,remarks:''})).status,400);diary=await ok('/api/school/diaries/'+diary.id+'/review','head','POST',{action:'returned',version:diary.version,remarks:'INTERNAL-REVIEW-COMMENT: clarify exercise'});assert.equal((await req('/api/school/diaries/'+diary.id,'teacher','PUT',{...body,version:1})).status,409);diary=await ok('/api/school/diaries/'+diary.id,'teacher','PUT',{...body,version:diary.version});assert.equal(diary.status,'resubmitted');assert.ok((await ok('/api/school/diaries?status=pending','head')).items.some(x=>x.id===diary.id));quote=await ok('/api/school/quotes','super','POST',{text:'Together for better learning — علم روشنی ہے',language:'ur',date,priority:100},201);diary=await ok('/api/school/diaries/'+diary.id+'/review','head','POST',{action:'approved',version:diary.version,remarks:'INTERNAL-APPROVAL-NOTE'});assert.equal(diary.status,'approved');assert.equal(diary.quotes[0].id,quote.id);assert.equal((await req('/api/school/diaries/'+diary.id,'teacher','PUT',{...body,version:diary.version})).status,409);assert.ok((await ok('/api/school/diaries/'+diary.id+'/versions','teacher')).some(v=>v.action==='returned'&&v.remarks.includes('INTERNAL-REVIEW-COMMENT')));await assert.rejects(async()=>db.run('UPDATE school_diary_versions SET remarks=? WHERE diary_id=?','tamper',diary.id));
 });
 test(runtime+': list and dashboard payloads omit repeated branding while original diary snapshots remain intact',async()=>{
  const full=await ok('/api/school/diaries/'+diary.id);assert.ok(full.snapshot.school);
  const list=await ok('/api/school/diaries'),listed=list.items.find(d=>d.id===diary.id);assert.ok(listed);assert.equal(listed.snapshot.school,undefined);assert.deepEqual(listed.snapshot.meta,full.snapshot.meta);assert.deepEqual(listed.content,full.content);
  const dashboard=await ok('/api/school/dashboard?date='+full.diary_date);assert.ok(dashboard.diaries.every(d=>d.snapshot.school===undefined));
  const combined=await ok('/api/school/class-diaries');assert.ok(combined.items.every(d=>d.snapshot.school===undefined));
  assert.deepEqual((await ok('/api/school/diaries/'+diary.id)).snapshot,full.snapshot);
 });
 test(runtime+': published family view renders scheduled quotes dynamically without changing approval snapshots',async()=>{
  const quoteBefore=await db.one('SELECT quote_payload FROM school_diaries WHERE id=?',diary.id);await ok('/api/school/quotes/'+quote.id,'super','PATCH',{text:'Changed future quote'});const data=await ok('/api/school/family?section='+section+'&date='+date,'parent');assert.equal(data.subjects.length,2);assert.ok(!JSON.stringify(data).includes('INTERNAL'));for(const format of ['','pdf','png']){const html=await ok('/api/school/family/preview?section='+section+'&date='+date+(format?'&format='+format:''),'parent');assert.ok(!html.includes('Together for better learning — علم روشنی ہے'));assert.ok(html.includes('Changed future quote'));assert.ok(!html.includes('INTERNAL'));assert.ok(html.includes('dir="rtl"'));assert.ok(html.includes('H.W')&&html.includes('L.W')&&html.includes('Test'));}assert.equal((await req('/api/school/family/preview?section='+section+'&date='+date,'parentB')).status,404);assert.deepEqual(await db.one('SELECT quote_payload FROM school_diaries WHERE id=?',diary.id),quoteBefore);await ok('/api/school/quotes/'+quote.id,'super','PATCH',{date:'2031-01-01'});const noQuote=await ok('/api/school/family/preview?section='+section+'&date='+date,'parent');assert.ok(!noQuote.includes('Changed future quote'));assert.ok(!noQuote.includes('judge a book'));await ok('/api/school/quotes/'+quote.id,'super','PATCH',{date});
 });
 test(runtime+': another teacher contributes one approved record and parents get a complete shared class view',async()=>{
  const a=(await ok('/api/school/structure','teacherB')).assignments.find(a=>a.section_id===section);second=await ok('/api/school/diaries','teacherB','POST',{section_id:section,diary_date:date,language:'en',submit:true,rows:[{assignment_id:a.id,detail:'Teacher B contribution',hw:true,learn:false,test:true}]},201);assert.equal((await ok('/api/school/family?section='+section+'&date='+date,'parent')).subjects.length,2);second=await ok('/api/school/diaries/'+second.id+'/review','headB','POST',{action:'approved',version:second.version});assert.equal((await ok('/api/school/family?section='+section+'&date='+date,'parent')).subjects.length,3);assert.equal((await req('/api/school/diaries/'+second.id,'coordinator')).status,404);const aScope=await ok('/api/school/diaries','coordinator');assert.ok(aScope.items.some(d=>d.id===diary.id));assert.ok(!aScope.items.some(d=>d.id===second.id));
 });
 test(runtime+': diary reports and exports apply branch, section, teacher and role scope',async()=>{
  const report=await ok('/api/school/reports?start='+date+'&end='+date+'&branch='+branch);assert.equal(report.counts.approved,2);assert.equal(report.slots.filter(x=>x.section_id===section).length,2);const own=await ok('/api/school/reports?start='+date+'&end='+date,'teacher');assert.ok(own.slots.every(x=>x.teacher_id===f.users.teacher.id));const html=await ok('/api/school/reports/export?start='+date+'&end='+date+'&branch='+branch+'&format=pdf','super');assert.ok(html.includes('Class diary report'));assert.equal((await req('/api/school/reports/export?start='+date+'&end='+date+'&format=pdf','parent')).status,403);const audit=await ok('/api/school/audit?branch='+branch);assert.ok(audit.items.some(x=>x.action==='class_diary_approved'));assert.equal((await req('/api/school/audit','teacher')).status,403);const bulk=await ok('/api/school/diaries/export?ids='+diary.id+','+second.id+'&format=pdf');assert.ok(bulk.includes('Teacher B contribution'));assert.equal((bulk.match(/class="document-source"/g)||[]).length,2);assert.ok(!bulk.includes('subject-author'));assert.equal((await req('/api/school/diaries/export?ids='+diary.id+','+second.id+'&format=pdf','teacher')).status,404);
 });
 test(runtime+': individual deny overrides role grants without expanding hierarchical scope',async()=>{
  await ok('/api/school/permissions','super','PUT',{user_id:f.users.teacher.id,allows:[],denies:['diary.export']});assert.equal((await req('/api/school/diaries/'+diary.id+'/preview?format=png&__diary_action=test','teacher')).status,403);const restrictedPreview=await ok('/api/school/diaries/'+diary.id+'/preview','teacher');assert.ok(restrictedPreview.includes('data-export-allowed="false"'));assert.ok(!restrictedPreview.includes('id="print-document"'));assert.equal((await req('/api/reports?start='+date+'&end='+date+'&format=csv','teacher')).status,403);assert.equal((await req('/api/school/diaries/'+diary.id+'/preview','teacher')).status,200);assert.equal((await req('/api/school/permissions','teacher','PUT',{role:'teacher',grants:[]})).status,403);await ok('/api/school/permissions','super','PUT',{user_id:f.users.teacher.id,allows:[],denies:[]});await ok('/api/school/permissions','super','PUT',{role:'coordinator',grants:['diary.view','diary.approve','reports.view']});assert.equal((await req('/api/school/diaries/'+second.id,'coordinator')).status,404);assert.equal((await req('/api/school/permissions','super','PUT',{role:'super_admin',grants:[]})).status,400);
 });
 test(runtime+': Overview monitoring is scoped, distinguishes official approval and sends only deduplicated permitted reminders',async()=>{
  const matrix=await ok('/api/school/monitoring?date='+date,'super');const row=matrix.rows.find(row=>row.section_id===section);assert.ok(row);assert.equal(row.expected,2);assert.ok(row.approved>=1);assert.equal(row.subjects.length,3);assert.ok((await ok('/api/school/dashboard?date='+date,'super')).monitoring.rows.length);
  assert.equal((await req('/api/school/monitoring?date='+date,'parent')).status,403);assert.equal((await req('/api/school/monitoring?date='+date+'&campus=foreign-campus','head')).status,404);
  assert.equal((await req('/api/school/monitoring/reminders','teacher','POST',{date,section_id:section})).status,403);
  const wrong=await req('/api/school/monitoring/reminders','headB','POST',{date,section_id:section});assert.ok([403,404].includes(wrong.status));
  const reminderDate=new Date(Date.parse(date)+86400000).toISOString().slice(0,10);const first=await ok('/api/school/monitoring/reminders','super','POST',{date:reminderDate,section_id:section});const repeat=await ok('/api/school/monitoring/reminders','super','POST',{date:reminderDate,section_id:section});assert.equal(repeat.sent,0);assert.ok(first.sent>=1);assert.equal(repeat.alreadySent,first.sent);
 });
 test(runtime+': selected diary exports enable named ZIP mode without changing standalone previews or print',async()=>{
  const classKey=section+'~'+date;
  for(const format of ['pdf','png','jpg']){
   for(const path of ['/api/school/class-diaries/export?ids='+encodeURIComponent(classKey),'/api/school/diaries/export?ids='+diary.id]){
    const html=await ok(path+'&format='+format,'super');assert.ok(html.includes('data-export-archive="zip"'));assert.ok(html.includes('data-class-name='));assert.ok(html.includes('data-section-name='));assert.ok(html.includes('data-diary-date="'+date+'"'));
   }
  }
  const preview=await ok('/api/school/class-diaries/preview?section='+section+'&date='+date,'super');assert.ok(!preview.includes('data-export-archive="zip"'));
  const printed=await ok('/api/school/class-diaries/export?ids='+encodeURIComponent(classKey)+'&format=print','super');assert.ok(!printed.includes('data-export-archive="zip"'));
  assert.equal((await req('/api/school/class-diaries/export?ids='+encodeURIComponent(classKey)+'&format=pdf','parent')).status,403);
 });
 test(runtime+': parent link revocation takes effect immediately and amendments preserve approved history',async()=>{
  await ok('/api/school/parents','super','PUT',{parent_id:parent.id,links:[]});assert.equal((await req('/api/school/family?section='+section,'parent')).status,404);await ok('/api/school/parents','super','PUT',{parent_id:parent.id,links:[{section_id:section,child_name:'Child A'}]});const amended=await ok('/api/school/diaries/'+diary.id+'/amend','super','POST',{reason:'Correct a published instruction',version:diary.version});assert.equal(amended.status,'returned');const data=await ok('/api/school/family?section='+section+'&date='+date,'parent');assert.equal(data.subjects.length,1);assert.ok((await ok('/api/school/diaries/'+diary.id+'/versions','super')).some(x=>x.snapshot.status==='approved'));
 });
 test(runtime+': archived assignments still contribute their historical section curriculum to reports',async()=>{
  const as=await db.all('SELECT * FROM assignments WHERE teacher_id=? AND section_id=?',f.users.teacher.id,section);for(const a of as)await db.run('UPDATE assignments SET start_date=? WHERE id=?','2026-01-01',a.id);const yesterday=new Date(Date.parse(date)-86400000).toISOString().slice(0,10);await ok('/api/school/assignments/'+as[0].id,'super','PATCH',{active:false});const report=await ok('/api/school/reports?start='+yesterday+'&end='+yesterday+'&teacher='+f.users.teacher.id);assert.equal(report.slots.length,1);assert.equal(report.slots[0].subjects.length,2);
 });
 test(runtime+': deadlines are deduplicated and legacy period reminders do not mislabel class diaries',async()=>{
  process.env.CRON_SECRET='test-school-cron';if(runtime==='cloud'){for(let i=0;i<2;i++){const response=await fetch(base+'/api/cron/deadlines',{headers:{Authorization:'Bearer test-school-cron'}});assert.equal(response.status,200);}}
  else{const {schoolPlatform}=await import('../shared/school-platform.mjs'),documents=await import('../server/documents.mjs'),service=schoolPlatform(db,domain,documents);await service.deadlines();const before=Number((await db.one('SELECT COUNT(*) n FROM notifications')).n);await service.deadlines();assert.equal(Number((await db.one('SELECT COUNT(*) n FROM notifications')).n),before);}
  const as=await db.all('SELECT a.id FROM assignments a JOIN section_subjects s ON s.section_id=a.section_id AND s.subject_id=a.subject_id');for(const a of as)assert.equal(Number((await db.one('SELECT COUNT(*) n FROM notifications WHERE dedupe_key LIKE ?',a.id+':'+date+':%')).n),0);
 });
 test(runtime+': push subscriptions are authenticated, endpoint-validated, deduplicated and invalid devices removed',async()=>{
  const endpoint='https://fcm.googleapis.com/fcm/send/test-device',keys={p256dh:'A'.repeat(87),auth:'B'.repeat(22)},subscription={endpoint,keys};assert.equal((await req('/api/school/push','teacher','POST',{subscription:{...subscription,endpoint:'https://127.0.0.1/private'}})).status,400);assert.equal((await req('/api/school/push','teacher','POST',{subscription},false)).status,403);await ok('/api/school/push','teacher','POST',{subscription});await ok('/api/school/push','teacherB','POST',{subscription});assert.equal(Number((await db.one('SELECT COUNT(*) n FROM push_subscriptions WHERE user_id=?',f.users.teacher.id)).n),0);await ok('/api/school/push','teacher','POST',{subscription});const {pushService}=await import('../shared/school-push.mjs');let sends=0;const sender=pushService(db,async()=>{sends++;});await db.notify(f.users.teacher.id,null,'Test push update','test-push-update');for(let i=0;i<5;i++)await sender.dispatch();const before=sends;await sender.dispatch();assert.equal(sends,before);assert.ok(sends>0);await db.notify(f.users.teacher.id,null,'Expired device','test-expired-device');await db.notify(f.users.teacher.id,null,'Another queued alert','test-expired-device-two');const expired=pushService(db,async()=>{throw {statusCode:410};});await expired.dispatch();assert.equal(Number((await db.one('SELECT COUNT(*) n FROM push_subscriptions WHERE user_id=?',f.users.teacher.id)).n),0);await ok('/api/school/push','teacher','DELETE');
 });
 test(runtime+': consolidated diaries and exports require current workflow approval and update after late approvals and amendments',async()=>{
  const combined=await ok('/api/school/structure','super','POST',{kind:'class_sections',parent_id:campus,name:'Consolidated QA class',sections:['Blue','Pink']},201),blue=combined.sections[0].id,pink=combined.sections[1].id;
  const subjectA=(await make('subject','Consolidated English')).id,subjectB=(await make('subject','Consolidated Science')).id;
  for(const section_id of [blue,pink])await ok('/api/school/curriculum','super','PUT',{section_id,subject_ids:[subjectA,subjectB]});
  for(const [user,subject_id] of [['teacher',subjectA],['teacherB',subjectB]])await ok('/api/school/assignments','super','POST',{teacher_id:f.users[user].id,pairs:[blue,pink].map(section_id=>({section_id,subject_id})),weekdays:[0,1,2,3,4,5,6],due_time:'23:00',review_time:'23:30'},201);
  const as=(await ok('/api/school/structure')).assignments,day='2026-12-15';
  const body=(user,section_id,detail,hygiene={},submit=true)=>({section_id,diary_date:day,language:'en',submit,hygiene,rows:[{assignment_id:as.find(a=>a.teacher_id===f.users[user].id&&a.section_id===section_id).id,detail,hw:true,learn:true,test:false}]});

  let a=await ok('/api/school/diaries','teacher','POST',body('teacher',blue,'APPROVED-A reading',{uniform:'tidy',hair:'untidy'}),201);
  let b=await ok('/api/school/diaries','teacherB','POST',body('teacherB',blue,'DRAFT-MUST-NOT-APPEAR',{uniform:'untidy'},false),201);
  const other=await ok('/api/school/diaries','teacherB','POST',body('teacherB',pink,'OTHER-SECTION-SUBMISSION'),201);
  const query='section='+blue+'&date='+day,list='/api/school/class-diaries?start='+day+'&end='+day,key=blue+'~'+day;
  const existingLinks=await ok('/api/school/parents');await ok('/api/school/parents','super','PUT',{parent_id:parent.id,links:[...existingLinks.filter(x=>x.parent_id===parent.id).map(x=>({section_id:x.section_id,child_name:x.child_name})),{section_id:blue,child_name:'QA child'}]});
  const absent=async()=>{assert.equal((await ok(list+'&section='+blue)).total,0);assert.equal((await req('/api/school/class-diaries/detail?'+query)).status,404);for(const format of ['','pdf','png','jpg','print'])assert.equal((await req('/api/school/class-diaries/preview?'+query+(format?'&format='+format:''))).status,404);assert.equal((await req('/api/school/class-diaries/export?ids='+encodeURIComponent(key)+'&format=pdf')).status,404);assert.equal((await ok('/api/school/family?section='+blue+'&date='+day,'parent')).available,false);};
  await absent();assert.equal((await ok(list)).total,0);
  // A status flag without the current version's immutable approval record is insufficient.
  await db.run("UPDATE school_diaries SET status='approved',reviewed_at=? WHERE id=?",new Date().toISOString(),a.id);await absent();await db.run("UPDATE school_diaries SET status='submitted',reviewed_at=NULL WHERE id=?",a.id);
  a=await ok('/api/school/diaries/'+a.id+'/review','head','POST',{action:'approved',version:a.version});
  let group=(await ok(list)).items[0];assert.equal(group.id,key);assert.equal(group.contributors.length,1);assert.equal('hygiene_summary' in group.content,false);assert.ok(!JSON.stringify(group).includes('DRAFT-MUST'));
  const assertOnlyA=async()=>{const d=await ok('/api/school/class-diaries/detail?'+query);assert.deepEqual(d.entry_ids,[a.id]);assert.equal('hygiene_summary' in d.content,false);for(const format of ['','pdf','png','jpg','print']){const html=await ok('/api/school/class-diaries/preview?'+query+(format?'&format='+format:''));assert.ok(html.includes('APPROVED-A reading'));assert.ok(html.includes('src="/export.js"'));assert.ok(html.includes('data-export-allowed="true"'));assert.ok(html.includes('id="print-document"'));assert.ok(html.includes('data-diary-date="'+day+'"'));assert.ok(!html.includes('PENDING-B experiments'));assert.ok(!html.includes('DRAFT-MUST'));assert.ok(!html.includes('UNAPPROVED-CORRECTION'));assert.doesNotMatch(html,/hygiene|tidy|untidy/i);}};
  await assertOnlyA();await db.run('UPDATE school_diaries SET version=version+1 WHERE id=?',a.id);await absent();await db.run('UPDATE school_diaries SET version=? WHERE id=?',a.version,a.id);
  b=await ok('/api/school/diaries/'+b.id,'teacherB','PUT',{...body('teacherB',blue,'PENDING-B experiments',{uniform:'tidy',hair:'tidy',nails:'tidy',teeth:'tidy',shoes:'tidy'}),version:b.version});await assertOnlyA();
  assert.equal((await ok(list+'&search=PENDING-B')).total,0);
  b=await ok('/api/school/diaries/'+b.id+'/review','headB','POST',{action:'under_review',version:b.version});await assertOnlyA();
  b=await ok('/api/school/diaries/'+b.id+'/review','headB','POST',{action:'returned',remarks:'Correct instruction',version:b.version});await assertOnlyA();
  b=await ok('/api/school/diaries/'+b.id,'teacherB','PUT',{...body('teacherB',blue,'PENDING-B experiments',{uniform:'tidy',hair:'tidy',nails:'tidy',teeth:'tidy',shoes:'tidy'}),version:b.version});await assertOnlyA();assert.equal(b.status,'resubmitted');
  let familyHTML=await ok('/api/school/family/preview?section='+blue+'&date='+day,'parent');assert.ok(!familyHTML.includes('PENDING-B'));assert.doesNotMatch(familyHTML,/hygiene|tidy|untidy/i);
  b=await ok('/api/school/diaries/'+b.id+'/review','headB','POST',{action:'approved',version:b.version});
  group=(await ok(list)).items[0];assert.equal(group.id,key);assert.equal(group.contributors.length,2);assert.equal('hygiene_summary' in group.content,false);assert.equal('hygiene_summary' in group.content,false);assert.equal('hygiene_summary' in group.content,false);
  await ok('/api/school/diaries/'+other.id+'/review','headB','POST',{action:'approved',version:other.version});let data=await ok(list);assert.equal(data.total,2);assert.equal('hygiene_summary' in data.items.find(x=>x.section_id===pink).content,false);
  const originals=await db.all('SELECT * FROM school_diaries ORDER BY id'),history=await db.all('SELECT * FROM school_diary_versions ORDER BY id');
  for(const status of ['draft','pending','submitted','under_review','returned','resubmitted','rejected'])assert.equal((await ok(list+'&status='+status)).total,0);
  assert.equal((await ok(list+'&search=APPROVED-A&status=approved')).items[0].contributors.length,2);
  for(const user of ['teacher','head','coordinator']){const own=await ok('/api/school/class-diaries/detail?'+query,user);assert.equal(own.contributors.length,1);assert.equal(own.contributors[0].teacher_id,f.users.teacher.id);}
  for(const format of ['','pdf','png','jpg','print']){const html=await ok('/api/school/class-diaries/preview?'+query+(format?'&format='+format:''));assert.ok(html.includes('APPROVED-A reading'));assert.ok(html.includes('PENDING-B experiments'));assert.doesNotMatch(html,/hygiene|tidy|untidy/i);assert.ok(!html.includes('OTHER-SECTION-SUBMISSION'));}
  const bulk=await ok('/api/school/class-diaries/export?ids='+encodeURIComponent(key)+','+encodeURIComponent(key)+'&format=jpg');assert.equal((bulk.match(/<article class="document-source"/g)||[]).length,1);assert.doesNotMatch(bulk,/hygiene|tidy|untidy/i);
  assert.equal((await req('/api/school/class-diaries/detail?'+query,'parent')).status,403);assert.equal((await req('/api/school/class-diaries/detail?section='+blue+'&date=invalid')).status,400);
  assert.deepEqual(await db.all('SELECT * FROM school_diaries ORDER BY id'),originals);assert.deepEqual(await db.all('SELECT * FROM school_diary_versions ORDER BY id'),history);assert.equal((await ok('/api/school/diaries/'+a.id,'teacher')).status,'approved');
  await ok('/api/school/permissions','super','PUT',{user_id:f.users.teacher.id,allows:[],denies:['diary.export']});assert.equal((await req('/api/school/class-diaries/preview?'+query+'&format=pdf','teacher')).status,403);await ok('/api/school/permissions','super','PUT',{user_id:f.users.teacher.id,allows:[],denies:[]});
  b=await ok('/api/school/diaries/'+b.id+'/amend','super','POST',{reason:'Correct approved instruction',version:b.version});await assertOnlyA();
  b=await ok('/api/school/diaries/'+b.id,'teacherB','PUT',{...body('teacherB',blue,'UNAPPROVED-CORRECTION',{uniform:'untidy'},false),version:b.version});await assertOnlyA();
  b=await ok('/api/school/diaries/'+b.id,'teacherB','PUT',{...body('teacherB',blue,'RESUBMITTED-CORRECTION',{uniform:'untidy'}),version:b.version});await assertOnlyA();
  for(const format of ['','pdf','png']){familyHTML=await ok('/api/school/family/preview?section='+blue+'&date='+day+(format?'&format='+format:''),'parent');assert.ok(!familyHTML.includes('RESUBMITTED-CORRECTION'));assert.doesNotMatch(familyHTML,/hygiene|tidy|untidy/i);}
  b=await ok('/api/school/diaries/'+b.id+'/review','headB','POST',{action:'approved',version:b.version});group=await ok('/api/school/class-diaries/detail?'+query);assert.equal(group.id,key);assert.equal('hygiene_summary' in group.content,false);familyHTML=await ok('/api/school/family/preview?section='+blue+'&date='+day,'parent');assert.ok(familyHTML.includes('RESUBMITTED-CORRECTION'));assert.doesNotMatch(familyHTML,/hygiene|tidy|untidy/i);assert.ok(!familyHTML.includes('Correct instruction'));
  a=await ok('/api/school/diaries/'+a.id+'/amend','super','POST',{reason:'Reopen approved A',version:a.version});group=await ok('/api/school/class-diaries/detail?'+query);assert.deepEqual(group.entry_ids,[b.id]);assert.equal('hygiene_summary' in group.content,false);
  await ok('/api/school/diaries/'+b.id+'/amend','super','POST',{reason:'Reopen approved B',version:b.version});await absent();
 });

 test(runtime+': per-subject languages survive drafts, previews, review, consolidation and parent exports independently',async()=>{
  const combined=await ok('/api/school/structure','super','POST',{kind:'class_sections',parent_id:campus,name:'Language QA class',sections:['Blue']},201),sid=combined.sections[0].id;
  const math=(await make('subject','Language Math')).id,urdu=(await make('subject','Language Urdu')).id;
  await ok('/api/school/curriculum','super','PUT',{section_id:sid,subject_ids:[math,urdu]});await ok('/api/school/assignments','super','POST',{teacher_id:f.users.teacher.id,pairs:[math,urdu].map(subject_id=>({section_id:sid,subject_id})),weekdays:[0,1,2,3,4,5,6],due_time:'23:00',review_time:'23:30'},201);
  const as=(await ok('/api/school/structure','teacher')).assignments.filter(a=>a.section_id===sid),day='2026-12-16';
  const rows=as.map(a=>({assignment_id:a.id,detail:a.subject_id===math?'Solve fractions':'سبق پڑھیں',language:a.subject_id===math?'en':'',hw:true,learn:true,test:false})),body={section_id:sid,diary_date:day,subject_languages:true,rows};
  let d=await ok('/api/school/diaries','teacher','POST',body,201);assert.equal(d.content.homework_rows.find(r=>r.subject_id===urdu).language,'');assert.equal(d.content.homework_rows.find(r=>r.subject_id===math).language,'en');
  assert.equal((await req('/api/school/diaries/'+d.id,'teacher','PUT',{...body,submit:true,version:d.version})).status,400);
  assert.equal((await req('/api/school/diaries/'+d.id,'teacher','PUT',{...body,rows:rows.map(r=>({...r,language:'invalid'})),version:d.version})).status,400);
  rows.find(r=>r.language==='').language='ur';d=await ok('/api/school/diaries/'+d.id,'teacher','PUT',{...body,version:d.version});
  const expectLanguages=current=>{assert.equal(current.content.homework_rows.find(r=>r.subject_id===math).language,'en');assert.equal(current.content.homework_rows.find(r=>r.subject_id===urdu).language,'ur');assert.equal(current.content.homework_rows.find(r=>r.subject_id===math).direction,'ltr');assert.equal(current.content.homework_rows.find(r=>r.subject_id===urdu).direction,'rtl');};expectLanguages(d);expectLanguages(await ok('/api/school/diaries/'+d.id,'teacher'));
  const verifyHtml=(html,consolidated=false)=>{assert.ok(html.includes('lang="en" dir="ltr">Solve fractions'));assert.ok(html.includes('lang="ur" dir="rtl">سبق پڑھیں'));assert.equal(html.includes('Language: English'),false);assert.equal(html.includes('Language: اردو — Urdu'),false);if(consolidated){assert.ok(html.includes('data-consolidated="true"'));assert.ok(html.includes('Elite Scholars School &amp; College'));}};
  verifyHtml(await ok('/api/school/diaries/'+d.id+'/preview','teacher'));
  d=await ok('/api/school/diaries/'+d.id,'teacher','PUT',{...body,version:d.version,submit:true});expectLanguages(d);
  d=await ok('/api/school/diaries/'+d.id+'/review','head','POST',{action:'under_review',version:d.version});expectLanguages(d);d=await ok('/api/school/diaries/'+d.id+'/review','head','POST',{action:'approved',version:d.version});expectLanguages(d);
  const versions=await ok('/api/school/diaries/'+d.id+'/versions','teacher');for(const version of versions.filter(v=>['submitted','under_review','approved'].includes(v.action)))expectLanguages(version.snapshot);
  expectLanguages(await ok('/api/school/class-diaries/detail?section='+sid+'&date='+day));
  for(const format of ['pdf','png','jpg'])verifyHtml(await ok('/api/school/class-diaries/preview?section='+sid+'&date='+day+'&format='+format),true);
  const links=await ok('/api/school/parents');await ok('/api/school/parents','super','PUT',{parent_id:parent.id,links:[...links.filter(x=>x.parent_id===parent.id).map(x=>({section_id:x.section_id,child_name:x.child_name})),{section_id:sid,child_name:'Language QA'}]});
  for(const format of ['','pdf','png'])verifyHtml(await ok('/api/school/family/preview?section='+sid+'&date='+day+(format?'&format='+format:''),'parent'),true);
  const family=await ok('/api/school/family?section='+sid+'&date='+day,'parent');assert.deepEqual(family.subjects.map(r=>r.language).sort(),['en','ur']);
  if(runtime==='server'){const module=await fetch(base+'/diary-languages.js');assert.equal(module.status,200);assert.ok(module.headers.get('content-type').includes('javascript'));}
 });

 test(runtime+': configurable subject priorities sort approved merged entries consistently across all previews and exports',async()=>{
  const original=await db.all('SELECT * FROM academics ORDER BY id'),classData=await ok('/api/school/structure','super','POST',{kind:'class_sections',parent_id:campus,name:'Priority QA Class',sections:['Blue']},201),sid=classData.sections[0].id,day='2026-12-17';
  const create=async(name,priority)=>ok('/api/school/structure','super','POST',{kind:'subject_assignments',name,campus_id:campus,section_ids:[sid],priority},201);
  const zulu=(await create('Zulu Priority Subject',1)).id,alpha=(await create('Alpha Priority Subject',20)).id,beta=(await create('Beta Priority Subject',1)).id;
  assert.equal((await ok('/api/school/structure')).academics.find(a=>a.id===zulu).priority,1);
  const missingPriorityName='Missing Priority Subject';assert.equal((await req('/api/school/structure','super','POST',{kind:'subject_assignments',name:missingPriorityName,campus_id:campus,section_ids:[sid]})).status,400);assert.ok(!await db.one('SELECT 1 FROM academics WHERE name=?',missingPriorityName));
  await ok('/api/school/structure/'+zulu,'super','PATCH',{name:'Zulu Priority Subject Renamed'});assert.equal((await ok('/api/school/structure')).academics.find(a=>a.id===zulu).priority,1);
  for(const priority of [-1,1.5,1000001,null,'bad','']){assert.equal((await req('/api/school/structure/'+alpha,'super','PATCH',{priority})).status,400);const name='Rejected priority '+JSON.stringify(priority);assert.equal((await req('/api/school/structure','super','POST',{kind:'subject_assignments',name,campus_id:campus,section_ids:[sid],priority})).status,400);assert.ok(!await db.one('SELECT 1 FROM academics WHERE name=?',name));}
  for(const [teacher,ids] of [['teacher',[alpha,zulu]],['teacherB',[beta]]])await ok('/api/school/assignments','super','POST',{teacher_id:f.users[teacher].id,pairs:ids.map(subject_id=>({section_id:sid,subject_id})),weekdays:[0,1,2,3,4,5,6],due_time:'23:00',review_time:'23:30'},201);
  const as=(await ok('/api/school/structure')).assignments;
  for(const [teacher,reviewer,ids] of [['teacherB','headB',[beta]],['teacher','head',[alpha,zulu]]]){const d=await ok('/api/school/diaries',teacher,'POST',{section_id:sid,diary_date:day,subject_languages:true,submit:true,rows:ids.map(subject_id=>({assignment_id:as.find(a=>a.teacher_id===f.users[teacher].id&&a.subject_id===subject_id&&a.section_id===sid).id,language:'en',detail:'Homework for '+subject_id,hw:true,learn:true,test:false}))},201);await ok('/api/school/diaries/'+d.id+'/review',reviewer,'POST',{action:'approved',version:d.version});}
  const records=await db.all('SELECT * FROM school_diaries ORDER BY id'),versions=await db.all('SELECT * FROM school_diary_versions ORDER BY id'),ties=[zulu,beta].sort(),query='section='+sid+'&date='+day;
  const links=await ok('/api/school/parents');await ok('/api/school/parents','super','PUT',{parent_id:parent.id,links:[...links.filter(x=>x.parent_id===parent.id).map(x=>({section_id:x.section_id,child_name:x.child_name})),{section_id:sid,child_name:'Priority QA'}]});
  const verify=async expected=>{const d=await ok('/api/school/class-diaries/detail?'+query);assert.deepEqual(d.content.homework_rows.map(r=>r.subject_id),expected);assert.equal(d.contributors.length,2);assert.deepEqual((await ok('/api/school/class-diaries?'+query)).items[0].content.homework_rows.map(r=>r.subject_id),expected);const names=d.content.homework_rows.map(r=>r.subject);const assertOrder=html=>{const positions=names.map(name=>html.indexOf('<h2>'+name+'</h2>'));assert.ok(positions.every(x=>x>=0));assert.deepEqual(positions,[...positions].sort((a,b)=>a-b));};for(const format of ['','pdf','png','jpg','print'])assertOrder(await ok('/api/school/class-diaries/preview?'+query+(format?'&format='+format:'')));for(const format of ['pdf','png','jpg'])assertOrder(await ok('/api/school/class-diaries/export?ids='+encodeURIComponent(d.id)+'&format='+format));assert.deepEqual((await ok('/api/school/family?'+query,'parent')).subjects.map(r=>r.subject),names);for(const format of ['','pdf','png'])assertOrder(await ok('/api/school/family/preview?'+query+(format?'&format='+format:''),'parent'));};
  await verify([...ties,alpha]);await ok('/api/school/structure/'+alpha,'super','PATCH',{priority:0});await verify([alpha,...ties]);
  assert.equal((await req('/api/school/structure/'+alpha,'teacher','PATCH',{priority:1})).status,403);
  for(const old of original)assert.deepEqual(await db.one('SELECT * FROM academics WHERE id=?',old.id),old);
  assert.deepEqual(await db.all('SELECT * FROM school_diaries ORDER BY id'),records);assert.deepEqual(await db.all('SELECT * FROM school_diary_versions ORDER BY id'),versions);
 });

 test(runtime+': hierarchy CRUD, stale edits, reassignment scope and history preservation',async()=>{
  const people={};for(const [key,role] of [['ca','coordinator'],['cb','coordinator'],['ha','head_teacher'],['hb','head_teacher'],['ta','teacher'],['tb','teacher'],['inactive','teacher']]){people[key]=await db.createUser({name:'Hierarchy '+key,email:'hierarchy-'+key+'@example.invalid',password:f.password,role});await login('hierarchy-'+key,people[key]);}
  const {ca,cb,ha,hb,ta,tb,inactive}=people;await db.run('UPDATE users SET active=0 WHERE id=?',inactive.id);
  const graph=()=>ok('/api/school/hierarchy');
  const heads=(cid,ids,extra={})=>req('/api/school/hierarchy','super','PUT',{coordinator_id:cid,head_ids:ids,...extra});
  const teachers=(hid,ids,extra={})=>req('/api/school/reviewers','super','PUT',{head_id:hid,teacher_ids:ids,...extra});
  assert.equal((await req('/api/school/hierarchy','admin','PUT',{coordinator_id:ca.id,head_ids:[ha.id,hb.id]})).status,200);assert.equal((await heads(ca.id,[ha.id,hb.id])).status,200);assert.equal((await db.all('SELECT * FROM coordinator_heads WHERE coordinator_id=?',ca.id)).length,2);
  assert.equal((await teachers(ha.id,[ta.id,tb.id])).status,200);
  const initial=await graph();assert.ok(initial.canManage);assert.ok(initial.users.every(x=>!('password' in x)));
  const own=await ok('/api/school/hierarchy','hierarchy-ca');assert.ok(own.users.some(x=>x.id===tb.id));assert.ok(!own.users.some(x=>x.id===f.users.teacher.id));assert.equal(own.canManage,false);
  for(const key of ['hierarchy-ta','teacher'])assert.equal((await req('/api/school/hierarchy',key)).status,403);
  for(const key of ['hierarchy-ha','hierarchy-ca','hierarchy-ta'])assert.equal((await req('/api/school/reviewers',key,'PUT',{head_id:ha.id,teacher_ids:[]})).status,403);
  assert.equal((await heads(ta.id,[ha.id])).status,400);assert.equal((await heads(ca.id,[ha.id,ha.id])).status,409);assert.equal((await teachers(ha.id,[inactive.id])).status,400);assert.equal((await teachers(ha.id,[ta.id,cb.id])).status,400);assert.deepEqual((await graph()).reviewers,initial.reviewers);
  assert.equal((await req('/api/school/people/'+ta.id,'super','PATCH',{role:'head_teacher'})).status,409);
  // A single relationship can move without removing any other person's link.
  await ok('/api/school/hierarchy/coordinator/'+hb.id,'super','PATCH',{parent_id:cb.id,expected_parent_id:ca.id,revision:initial.revision});
  assert.equal((await heads(ca.id,[ha.id],{revision:initial.revision})).status,409);
  assert.equal((await db.one('SELECT coordinator_id FROM coordinator_heads WHERE head_id=?',ha.id)).coordinator_id,ca.id);
  assert.equal((await req('/api/hierarchy','super','POST',{coordinator_id:ca.id,head_id:hb.id})).status,409);
  await assert.rejects(Promise.resolve().then(()=>db.run('INSERT INTO coordinator_heads VALUES(?,?)',ca.id,hb.id)));
  await setCampus(ta.id,campus);
  const teaching=await ok('/api/school/assignments','super','POST',{teacher_id:ta.id,pairs:[{section_id:section,subject_id:english}],weekdays:[0,1,2,3,4,5,6],due_time:'16:00',review_time:'18:00'},201),aid=teaching.created[0];
  const record=await ok('/api/school/diaries','hierarchy-ta','POST',{section_id:section,diary_date:date,rows:[{assignment_id:aid,detail:'Historical hierarchy verification homework',language:'en',hw:true,learn:false,test:false}],submit:true},201);
  const versions=await ok('/api/school/diaries/'+record.id+'/versions'),saved=await db.one('SELECT * FROM school_diaries WHERE id=?',record.id);
  assert.equal((await req('/api/school/diaries/'+record.id,'hierarchy-ha')).status,200);assert.equal((await req('/api/school/diaries/'+record.id,'hierarchy-hb')).status,404);
  // Make a legacy diary too, so retained endpoints cannot keep an old supervisor's access.
  const legacy=await ok('/api/diaries','hierarchy-ta','POST',{assignment_id:aid,diary_date:date,period:1,submit:false,content:{topic:'Historical legacy diary'}},201);
  await ok('/api/school/hierarchy/reviewer/'+ta.id,'super','PATCH',{parent_id:hb.id,expected_parent_id:ha.id,revision:(await graph()).revision});
  assert.equal((await db.one('SELECT head_id FROM teacher_reviewers WHERE teacher_id=?',tb.id)).head_id,ha.id);
  for(const path of ['/api/school/diaries/'+record.id,'/api/diaries/'+legacy.id]){assert.equal((await req(path,'hierarchy-ha')).status,404);assert.equal((await req(path,'hierarchy-ca')).status,404);assert.equal((await req(path,'hierarchy-hb')).status,200);assert.equal((await req(path,'hierarchy-cb')).status,200);}
  assert.deepEqual(await db.one('SELECT * FROM school_diaries WHERE id=?',record.id),saved);assert.deepEqual(await ok('/api/school/diaries/'+record.id+'/versions'),versions);
  assert.equal((await req('/api/school/hierarchy/reviewer/'+ta.id,'super','DELETE',{parent_id:hb.id})).status,409);
  await ok('/api/school/hierarchy/reviewer/'+ta.id,'super','DELETE',{parent_id:hb.id,confirm_unassigned:true,revision:(await graph()).revision});
  assert.equal((await req('/api/school/diaries/'+record.id,'hierarchy-hb')).status,404);assert.equal((await req('/api/school/diaries/'+record.id,'hierarchy-ta')).status,200);assert.ok(await db.one('SELECT 1 FROM users WHERE id=?',ta.id));
  assert.equal((await req('/api/school/diaries','hierarchy-ta','POST',{section_id:section,diary_date:date,rows:[{assignment_id:aid,detail:'Blocked after removal',language:'en'}]})).status,403);
  assert.equal((await req('/api/diaries','hierarchy-ta','POST',{assignment_id:aid,diary_date:date,period:1,content:{topic:'Blocked after removal'}})).status,403);
  assert.equal((await req('/api/school/hierarchy/coordinator/'+ha.id,'super','DELETE',{parent_id:ca.id})).status,409);
  await ok('/api/school/hierarchy/coordinator/'+ha.id,'super','DELETE',{parent_id:ca.id,confirm_unassigned:true});assert.equal((await db.one('SELECT head_id FROM teacher_reviewers WHERE teacher_id=?',tb.id)).head_id,ha.id);
  const history=await db.all("SELECT * FROM audit WHERE resource_id=? ORDER BY created_at",'reviewer:'+ta.id);assert.deepEqual(history.map(r=>r.action),['hierarchy_created','hierarchy_updated','hierarchy_deleted']);assert.ok(history.every(r=>JSON.parse(r.details).outcome==='success'&&r.actor_id===f.users.super.id));
  assert.deepEqual(await db.one('SELECT * FROM school_diaries WHERE id=?',record.id),saved);assert.deepEqual(await ok('/api/school/diaries/'+record.id+'/versions'),versions);
  // Account management and hierarchy writes remain administrator-only, even with explicit grants.
  await ok('/api/school/hierarchy','super','PUT',{coordinator_id:ca.id,head_ids:[ha.id]});
  for(const [key,account] of [['hierarchy-ca',ca],['hierarchy-ha',ha],['hierarchy-ta',ta]]){
   await ok('/api/school/permissions','super','PUT',{user_id:account.id,allows:['hierarchy.manage','people.manage'],denies:[]});
   if(account.role!=='teacher'){
    const scopedGraph=await ok('/api/school/hierarchy',key);assert.equal(scopedGraph.canManage,false);assert.deepEqual(scopedGraph.canManageKinds,[]);
    assert.ok(!scopedGraph.users.some(x=>x.id===hb.id||x.id===cb.id));
   }else assert.equal((await req('/api/school/hierarchy',key)).status,403);
   for(const [path,method,body] of [
    ['/api/school/hierarchy','PUT',{coordinator_id:ca.id,head_ids:[ha.id]}],
    ['/api/school/reviewers','PUT',{head_id:ha.id,teacher_ids:[tb.id]}],
    ['/api/school/hierarchy/reviewer/'+tb.id,'PATCH',{parent_id:hb.id,expected_parent_id:ha.id}],
    ['/api/school/hierarchy/reviewer/'+tb.id,'DELETE',{parent_id:ha.id,confirm_unassigned:true}],
    ['/api/school/hierarchy/coordinator/'+ha.id,'PATCH',{parent_id:cb.id,expected_parent_id:ca.id}],
    ['/api/school/hierarchy/coordinator/'+ha.id,'DELETE',{parent_id:ca.id,confirm_unassigned:true}],
    ['/api/hierarchy','POST',{coordinator_id:ca.id,head_id:ha.id}],
    ['/api/teacher-reviewers','POST',{head_id:ha.id,teacher_id:tb.id}],
    ['/api/teacher-reviewers','DELETE',{teacher_id:tb.id,confirm_unassigned:true}],
    ['/api/school/people','POST',{name:'Denied hierarchy account',email:'denied-hierarchy@example.invalid',role:'teacher',password:f.password}],
    ['/api/school/people/'+tb.id,'PATCH',{name:'Denied edit'}]
   ])assert.equal((await req(path,key,method,body)).status,403,key+' '+method+' '+path);
   assert.equal((await req('/api/school/people',key)).status,403);
  }
  assert.equal((await db.one('SELECT head_id FROM teacher_reviewers WHERE teacher_id=?',tb.id)).head_id,ha.id);
  assert.equal((await req('/api/school/diaries/'+record.id,'hierarchy-ca')).status,404);
  // Inactive saved links are removable through bulk replacement, without deleting accounts.
  await db.run('UPDATE users SET active=0 WHERE id=?',tb.id);
  assert.equal((await teachers(ha.id,[])).status,200);assert.equal(await db.one('SELECT 1 FROM teacher_reviewers WHERE teacher_id=?',tb.id),undefined);assert.ok(await db.one('SELECT 1 FROM users WHERE id=?',tb.id));
  await db.run('UPDATE users SET active=1 WHERE id=?',tb.id);await teachers(ha.id,[tb.id]);
  await ok('/api/school/permissions','super','PUT',{user_id:ha.id,allows:[],denies:['hierarchy.manage']});assert.equal((await ok('/api/school/hierarchy','hierarchy-ha')).canManage,false);assert.equal((await req('/api/school/reviewers','hierarchy-ha','PUT',{head_id:ha.id,teacher_ids:[tb.id]})).status,403);
  await ok('/api/school/permissions','super','PUT',{user_id:ta.id,allows:['hierarchy.manage'],denies:[]});assert.equal((await req('/api/school/hierarchy','hierarchy-ta')).status,403);assert.equal((await req('/api/school/reviewers','hierarchy-ta','PUT',{head_id:ha.id,teacher_ids:[]})).status,403);
  await db.run('UPDATE users SET permissions=? WHERE id=?',JSON.stringify(['read_all','export']),tb.id);assert.deepEqual((await ok('/api/lookups','hierarchy-tb')).users.map(x=>x.id),[tb.id]);assert.equal((await req('/api/school/diaries/'+record.id,'hierarchy-tb')).status,404);assert.equal((await req('/api/diaries/'+legacy.id,'hierarchy-tb')).status,404);await db.run('UPDATE users SET permissions=? WHERE id=?',tb.permissions,tb.id);const snapshot=(await graph()).revision;const concurrent=await Promise.all([heads(ca.id,[ha.id,hb.id],{revision:snapshot}),heads(cb.id,[hb.id],{revision:snapshot})]);assert.ok(concurrent.every(r=>r.status===200||r.status===409));assert.ok(concurrent.some(r=>r.status===200));assert.equal(Number((await db.one('SELECT COUNT(*) n FROM coordinator_heads WHERE head_id=?',hb.id)).n),1);
 });

 test(runtime+': User Management creates accounts independently and Hierarchy Management uses only saved active roles',async()=>{
  const hierarchyBefore=await db.all('SELECT * FROM coordinator_heads ORDER BY head_id'),reviewersBefore=await db.all('SELECT * FROM teacher_reviewers ORDER BY teacher_id'),diariesBefore=await db.all('SELECT * FROM school_diaries ORDER BY id');
  const created=[];for(const [name,role] of [['Separate Coordinator','coordinator'],['Separate Head','head_teacher'],['Separate Teacher','teacher']])created.push(await ok('/api/school/people','super','POST',{name,email:name.replaceAll(' ','-').toLowerCase()+'@example.invalid',role,password:f.password},201));
  assert.deepEqual(await db.all('SELECT * FROM coordinator_heads ORDER BY head_id'),hierarchyBefore);assert.deepEqual(await db.all('SELECT * FROM teacher_reviewers ORDER BY teacher_id'),reviewersBefore);assert.deepEqual(await db.all('SELECT * FROM school_diaries ORDER BY id'),diariesBefore);
  for(const u of created){const graph=await ok('/api/school/hierarchy');assert.ok(graph.users.some(x=>x.id===u.id&&x.role===u.role&&x.active));assert.ok((await ok('/api/school/people')).some(x=>x.id===u.id));}
  const [coordinator,head,teacher]=created;
  await ok('/api/school/hierarchy','super','PUT',{coordinator_id:coordinator.id,head_ids:[head.id]});await ok('/api/school/reviewers','super','PUT',{head_id:head.id,teacher_ids:[teacher.id]});
  await ok('/api/school/hierarchy/reviewer/'+teacher.id,'super','DELETE',{parent_id:head.id});assert.ok(await db.one('SELECT 1 FROM users WHERE id=?',teacher.id));
  await ok('/api/school/people/'+teacher.id,'super','PATCH',{name:'Renamed Separate Teacher',active:false});assert.equal((await ok('/api/school/hierarchy')).users.find(x=>x.id===teacher.id).active,false);assert.equal((await req('/api/school/reviewers','super','PUT',{head_id:head.id,teacher_ids:[teacher.id]})).status,400);
  assert.equal((await req('/api/school/people','super','POST',{name:'Duplicate account',email:teacher.email.toUpperCase(),role:'teacher',password:f.password})).status,409);
  for(const who of ['teacher','head','coordinator']){assert.equal((await req('/api/school/people',who)).status,403);assert.equal((await req('/api/school/people',who,'POST',{name:'Unauthorized',email:'unauthorized@example.invalid',role:'teacher',password:f.password})).status,403);assert.equal((await req('/api/school/reviewers',who,'PUT',{head_id:head.id,teacher_ids:[]})).status,403);}
  for(const who of ['teacher','head','coordinator']){const account=f.users[who],old=await db.one('SELECT permissions FROM users WHERE id=?',account.id);await db.run('UPDATE users SET permissions=? WHERE id=?',JSON.stringify(['manage_users','read_all']),account.id);assert.equal((await req('/api/users',who,'POST',{name:'Denied legacy creation',email:'legacy-denied@example.invalid',role:'teacher',password:f.password})).status,403);assert.equal((await req('/api/users/'+head.id,who,'PATCH',{name:'Denied edit'})).status,403);assert.equal((await req('/api/users/'+teacher.id,who,'DELETE')).status,403);await db.run('UPDATE users SET permissions=? WHERE id=?',old.permissions,account.id);}
  await ok('/api/users/'+teacher.id,'super','DELETE');assert.ok(!await db.one('SELECT 1 FROM users WHERE id=?',teacher.id));assert.deepEqual(await db.all('SELECT * FROM school_diaries ORDER BY id'),diariesBefore);
 });

 test(runtime+': Subject Management edits one record across campuses, reloads saved details and preserves unrelated academics',async()=>{
  const baseline=await db.all('SELECT * FROM academics ORDER BY id'),oldLinks=await db.all('SELECT * FROM section_subjects ORDER BY section_id,subject_id'),oldAssignments=await db.all('SELECT * FROM assignments ORDER BY id'),oldDiaries=await db.all('SELECT * FROM school_diaries ORDER BY id');
  const cp2=(await make('campus','Subject editing south campus',branch)).id,c1=(await make('class','Subject editing prep',campus)).id,c2=(await make('class','Subject editing nursery',cp2)).id,legacy=(await make('class','Subject editing class-only',campus)).id;
  const s1=(await make('section','Blue',c1)).id,s2=(await make('section','Pink',c1)).id,s3=(await make('section','Gold',c2)).id,archived=(await make('section','Old section',c2)).id;
  const created=await ok('/api/school/structure','super','POST',{kind:'subject_assignments',name:'Subject editing original',priority:7,campus_id:campus,section_ids:[s1,s2]},201),subject=created.id;
  await db.run('INSERT INTO class_subjects VALUES(?,?)',legacy,subject);
  const patch=(body,user='super',csrf=true)=>req('/api/school/structure/'+subject,user,'PATCH',body,csrf);
  let response=await patch({name:'Subject editing renamed',priority:2,section_ids:[s2,s3],expected_section_ids:[s1,s2],active:true});assert.equal(response.status,200,JSON.stringify(response.data));
  let data=await ok('/api/school/structure');assert.equal(data.academics.find(x=>x.id===subject).priority,2);assert.equal(data.academics.find(x=>x.id===subject).name,'Subject editing renamed');assert.equal(Number((await db.one("SELECT COUNT(*) n FROM academics WHERE name='Subject editing renamed'")).n),1);
  assert.deepEqual(new Set(data.sectionSubjects.filter(x=>x.subject_id===subject).map(x=>x.section_id)),new Set([s2,s3]));assert.deepEqual(new Set(data.classSubjects.filter(x=>x.subject_id===subject).map(x=>x.class_id)),new Set([c1,c2,legacy]));
  const saved=await db.one('SELECT * FROM academics WHERE id=?',subject),savedLinks=await db.all('SELECT * FROM section_subjects WHERE subject_id=? ORDER BY section_id',subject);
  for(const [body,status] of [[{name:'Platform English',priority:2,section_ids:[s2,s3]},409],[{name:'Should roll back invalid sections',priority:3,section_ids:[s2,'missing']},400],[{section_ids:[s2,s2]},409],[{section_ids:[s2],expected_section_ids:[s1,s2]},409],[{section_ids:[s2],priority:-1},400]]){response=await patch(body);assert.equal(response.status,status,JSON.stringify(response.data));assert.deepEqual(await db.one('SELECT * FROM academics WHERE id=?',subject),saved);assert.deepEqual(await db.all('SELECT * FROM section_subjects WHERE subject_id=? ORDER BY section_id',subject),savedLinks);}
  assert.equal((await patch({section_ids:[]},'teacher')).status,403);assert.equal((await patch({section_ids:[]},'super',false)).status,403);
  await ok('/api/school/structure/'+s3,'super','PATCH',{active:false});await ok('/api/school/structure/'+archived,'super','PATCH',{active:false});
  response=await patch({section_ids:[s3],priority:4});assert.equal(response.status,200,JSON.stringify(response.data));assert.equal((await patch({section_ids:[s3,archived]})).status,400);
  data=await ok('/api/school/structure');assert.deepEqual(data.sectionSubjects.filter(x=>x.subject_id===subject).map(x=>x.section_id),[s3]);assert.deepEqual(new Set(data.classSubjects.filter(x=>x.subject_id===subject).map(x=>x.class_id)),new Set([c2,legacy]));
  assert.equal((await req('/api/school/structure/'+subject,'super','DELETE')).status,409);
  assert.equal((await patch({active:false,section_ids:[s3]})).status,200);assert.equal((await db.one('SELECT active FROM academics WHERE id=?',subject)).active,0);
  assert.equal((await patch({active:true,section_ids:[s3]})).status,200);
  assert.equal((await patch({section_ids:[]})).status,200);assert.ok(await db.one('SELECT 1 FROM class_subjects WHERE class_id=? AND subject_id=?',legacy,subject));
  assert.equal((await patch({section_ids:[],class_only_ids:['missing']})).status,400);assert.equal((await patch({section_ids:[],class_only_ids:[],expected_class_only_ids:[]})).status,409);assert.equal((await patch({section_ids:[],class_only_ids:[],expected_class_only_ids:[legacy]})).status,200);assert.equal(await db.one('SELECT 1 FROM class_subjects WHERE class_id=? AND subject_id=?',legacy,subject),undefined);
  await ok('/api/school/structure/'+subject,'super','DELETE');assert.equal(await db.one('SELECT 1 FROM academics WHERE id=?',subject),undefined);
  for(const old of baseline)assert.deepEqual(await db.one('SELECT * FROM academics WHERE id=?',old.id),old);
  for(const link of oldLinks)assert.ok(await db.one('SELECT 1 FROM section_subjects WHERE section_id=? AND subject_id=?',link.section_id,link.subject_id));
  assert.deepEqual(await db.all('SELECT * FROM assignments ORDER BY id'),oldAssignments);assert.deepEqual(await db.all('SELECT * FROM school_diaries ORDER BY id'),oldDiaries);
 });
 test(runtime+': Subject Management protects teaching links and diary history during assignment edits and archival',async()=>{
  const c=(await make('class','Protected subject class',campus)).id,sid=(await make('section','Protected',c)).id;
  const subject=(await ok('/api/school/structure','super','POST',{kind:'subject_assignments',name:'Protected subject history',priority:8,campus_id:campus,section_ids:[sid]},201)).id;
  const head=await db.createUser({name:'Subject edit reviewer',email:'subject-edit-head@example.invalid',password:f.password,role:'head_teacher'}),teacher=await db.createUser({name:'Subject edit teacher',email:'subject-edit-teacher@example.invalid',password:f.password,role:'teacher'});await login('subject-edit-teacher',teacher);
  await ok('/api/school/reviewers','super','PUT',{head_id:head.id,teacher_ids:[teacher.id]});
  await setCampus(teacher.id,campus);
  const assigned=await ok('/api/school/assignments','super','POST',{teacher_id:teacher.id,pairs:[{section_id:sid,subject_id:subject}],weekdays:[0,1,2,3,4,5,6],due_time:'16:00',review_time:'18:00'},201),aid=assigned.created[0];
  const record=await ok('/api/school/diaries','subject-edit-teacher','POST',{section_id:sid,diary_date:date,rows:[{assignment_id:aid,detail:'Preserve this homework and approval history',language:'en',hw:true,learn:false,test:false}],submit:false},201);
  const saved=await db.one('SELECT * FROM school_diaries WHERE id=?',record.id),versions=await db.all('SELECT * FROM school_diary_versions WHERE diary_id=? ORDER BY version',record.id),assignment=await db.one('SELECT * FROM assignments WHERE id=?',aid);
  for(const body of [{section_ids:[]},{section_ids:[],name:'Must roll back rename',priority:3},{section_ids:[sid],active:false}])assert.equal((await req('/api/school/structure/'+subject,'super','PATCH',body)).status,409);
  assert.equal((await req('/api/school/structure/'+subject,'super','DELETE')).status,409);
  await ok('/api/school/structure/'+subject,'super','PATCH',{name:'Protected subject renamed',priority:1,section_ids:[sid]});
  assert.deepEqual(await db.one('SELECT * FROM school_diaries WHERE id=?',record.id),saved);assert.deepEqual(await db.all('SELECT * FROM school_diary_versions WHERE diary_id=? ORDER BY version',record.id),versions);assert.deepEqual(await db.one('SELECT * FROM assignments WHERE id=?',aid),assignment);
  // A retained diary reference also protects a link independently of teaching defaults.
  await db.run('DELETE FROM assignments WHERE id=?',aid);assert.equal((await req('/api/school/structure/'+subject,'super','PATCH',{section_ids:[]})).status,409);
  await db.run('DELETE FROM section_subjects WHERE section_id=? AND subject_id=?',sid,subject);assert.equal((await req('/api/school/structure/'+subject,'super','PATCH',{section_ids:[],class_only_ids:[]})).status,409);await db.run('INSERT INTO section_subjects VALUES(?,?)',sid,subject);
  await db.run('INSERT INTO assignments VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',...['id','teacher_id','head_id','section_id','subject_id','session_id','start_date','end_date','weekdays','periods','due_time','review_time','active'].map(k=>assignment[k]));
  await ok('/api/school/assignments/'+aid,'super','PATCH',{active:false});await ok('/api/school/structure/'+subject,'super','PATCH',{active:false,section_ids:[sid]});assert.equal((await db.one('SELECT active FROM academics WHERE id=?',subject)).active,0);
  assert.deepEqual(await db.one('SELECT * FROM school_diaries WHERE id=?',record.id),saved);assert.deepEqual(await db.all('SELECT * FROM school_diary_versions WHERE diary_id=? ORDER BY version',record.id),versions);
  assert.ok(await db.one('SELECT 1 FROM section_subjects WHERE section_id=? AND subject_id=?',sid,subject));
 });

 test(runtime+': Force Delete preserves historical diaries, exports, reports and immutable audit across all supported records',async()=>{
  const fb=(await make('branch','Force preservation branch')).id,fc=(await make('campus','Force preservation campus',fb)).id,cl=(await make('class','Force preservation class',fc)).id,se=(await make('section','Force preservation section',cl)).id;
  const sub=(await ok('/api/school/structure','super','POST',{kind:'subject_assignments',name:'Force preservation subject',priority:3,campus_id:fc,section_ids:[se]},201)).id;
  const head=await db.createUser({name:'Force Head',email:'force-head@example.invalid',role:'head_teacher',password:f.password,permissions:['export']}),teacher=await db.createUser({name:'Force Teacher',email:'force-teacher@example.invalid',role:'teacher',password:f.password,permissions:['export']}),parent=await db.createUser({name:'Force Parent',email:'force-parent@example.invalid',role:'parent',password:f.password});
  await login('force-head',head);await login('force-teacher',teacher);await login('force-parent',parent);
  await ok('/api/school/reviewers','super','PUT',{head_id:head.id,teacher_ids:[teacher.id]});await ok('/api/school/parents','super','PUT',{parent_id:parent.id,links:[{section_id:se,child_name:'Preserved student'}]});
  const quote=(await ok('/api/school/quotes','super','POST',{text:'Preserve the original school quote.',language:'en',date,priority:999},201)).id;
  await setCampus(teacher.id,fc);
  const aid=(await ok('/api/school/assignments','super','POST',{teacher_id:teacher.id,pairs:[{section_id:se,subject_id:sub}],weekdays:[0,1,2,3,4,5,6],due_time:'16:00',review_time:'18:00'},201)).created[0];
  const draft=await ok('/api/school/diaries','force-teacher','POST',{section_id:se,diary_date:date,rows:[{assignment_id:aid,detail:'Original approved homework survives deletion.',language:'en',hw:true,learn:true,test:false}],submit:true},201);
  const approved=await ok('/api/school/diaries/'+draft.id+'/review','force-head','POST',{action:'approved',version:draft.version,remarks:'Original approval'});
  const legacy=await ok('/api/diaries','force-teacher','POST',{assignment_id:aid,diary_date:date,period:1,content:{topic:'Original legacy homework'},submit:false},201);
  const raw=await db.one('SELECT * FROM school_diaries WHERE id=?',approved.id),legacyRaw=await db.one('SELECT * FROM diaries WHERE id=?',legacy.id),versions=await db.all('SELECT * FROM school_diary_versions WHERE diary_id=? ORDER BY version',approved.id),legacyVersions=await db.all('SELECT * FROM diary_versions WHERE diary_id=? ORDER BY version',legacy.id);
  const route=(type,id)=>'/api/school/force-delete/'+type+'/'+id;
  const preview=()=>ok(route('academic',se));
  const beforeAudit=Number((await db.one('SELECT COUNT(*) n FROM audit')).n),impact=await preview();assert.equal(impact.recordKind,'section');assert.ok(impact.requiresAdditionalConfirmation);assert.equal(impact.history.approved,1);assert.ok(impact.summary.assignment>=1);
  assert.equal(Number((await db.one('SELECT COUNT(*) n FROM audit')).n),beforeAudit,'Preview/Cancel must perform no writes');assert.deepEqual(await db.one('SELECT * FROM school_diaries WHERE id=?',approved.id),raw);
  const payload={reason:'Confirmed test of history-preserving removal',confirmation:'FORCE DELETE',confirm_name:impact.name,confirm_related:true,fingerprint:impact.fingerprint};
  for(const [patch,status] of [[{reason:''},400],[{confirmation:'DELETE'},400],[{confirm_name:'wrong name'},400],[{confirm_related:false},400],[{fingerprint:'stale'},409]])assert.equal((await req(route('academic',se),'super','POST',{...payload,...patch})).status,status);
  assert.equal((await req(route('academic',se),'super','POST',payload,false)).status,403);assert.equal(Number((await db.one('SELECT COUNT(*) n FROM audit')).n),beforeAudit);
  await ok('/api/school/permissions','super','PUT',{user_id:teacher.id,allows:['records.force_delete','structure.delete'],denies:[]});
  for(const who of ['force-teacher','force-head','coordinator','force-parent']){assert.equal((await req(route('academic',se),who)).status,403);assert.equal((await req(route('academic',se),who,'POST',payload)).status,403);assert.equal((await req('/api/school/deleted-records',who)).status,403);}
  await ok(route('academic',se),'super','POST',payload);assert.equal((await req(route('academic',se))).status,409);
  for(const path of ['/api/school/structure','/api/lookups']){const data=await ok(path);assert.ok(!data.academics.some(x=>x.id===se));assert.ok(!data.assignments.some(x=>x.id===aid));}
  assert.equal((await req('/api/school/structure/'+se,'super','PATCH',{active:true})).status,409);assert.equal((await req('/api/academics/'+se,'super','PATCH',{active:true})).status,409);
  assert.equal((await req('/api/school/structure','super','POST',{kind:'subject_assignments',name:'Cannot assign deleted section',priority:0,campus_id:fc,section_ids:[se]})).status,409);
  async function historical(){
   assert.deepEqual(await db.one('SELECT * FROM school_diaries WHERE id=?',approved.id),raw);assert.deepEqual(await db.all('SELECT * FROM school_diary_versions WHERE diary_id=? ORDER BY version',approved.id),versions);
   assert.deepEqual(await db.one('SELECT * FROM diaries WHERE id=?',legacy.id),legacyRaw);assert.deepEqual(await db.all('SELECT * FROM diary_versions WHERE diary_id=? ORDER BY version',legacy.id),legacyVersions);
   const d=await ok('/api/school/diaries/'+approved.id);assert.equal(d.snapshot.teacher_name,'Force Teacher');assert.equal(d.snapshot.meta.section_name,'Force preservation section');assert.equal(d.status,'approved');assert.equal(d.reviewed_at,raw.reviewed_at);
   const html=await ok('/api/school/diaries/'+approved.id+'/preview?format=pdf');assert.ok(html.includes('Original approved homework survives deletion.'));assert.ok(html.includes('Force preservation section'));assert.ok(html.includes('Force preservation subject'));
   const report=await ok('/api/school/reports?'+new URLSearchParams({start:date,end:date,teacher:teacher.id,section:se}));assert.equal(report.counts.approved,1);assert.equal(report.slots[0].section_name,'Force preservation section');
  }
  await historical();assert.equal((await req('/api/school/family/preview?'+new URLSearchParams({section:se,date}),'force-parent')).status,200);
  async function remove(type,id){const view=await ok(route(type,id));await ok(route(type,id),'super','POST',{reason:'History-preserving acceptance test',confirmation:'FORCE DELETE',confirm_name:view.name,confirm_related:true,fingerprint:view.fingerprint});return view;}
  const subjectImpact=await remove('academic',sub);assert.ok(subjectImpact.history.diaries>=1);assert.ok(!(await ok('/api/school/structure')).academics.some(x=>x.id===sub));await historical();
  await remove('academic',cl);await remove('node',fc);await historical();assert.ok(!(await ok('/api/school/structure')).nodes.some(x=>x.id===fc));assert.equal((await req('/api/school/family/preview?'+new URLSearchParams({section:se,date}),'force-parent')).status,200);
  const teacherImpact=await remove('user',teacher.id);assert.ok(teacherImpact.history.diaries>=1);assert.equal((await req('/api/me','force-teacher')).status,401);assert.ok(!(await ok('/api/school/people')).some(x=>x.id===teacher.id));assert.equal((await req('/api/users/'+teacher.id,'super','PATCH',{active:true})).status,409);await historical();
  const deleted=await ok('/api/school/deleted-records');const deletedUser=deleted.find(x=>x.record_type==='user'&&x.record_id===teacher.id);assert.ok(deletedUser);assert.equal(deletedUser.snapshot.name,'Force Teacher');assert.ok(!Object.hasOwn(deletedUser.snapshot,'password'));assert.ok(!Object.hasOwn(deletedUser.snapshot,'permissions'));assert.ok(deletedUser.reason&&deletedUser.actor&&deletedUser.created_at);assert.equal(deletedUser.outcome,'success');assert.ok(deleted.find(x=>x.record_type==='assignment'&&x.record_id===aid).record_name.includes('Force Teacher'));
  assert.equal((await req(route('user',f.users.super.id))).status,409);assert.equal((await req('/api/school/force-delete/audit/'+deletedUser.id)).status,404);
  await remove('diary',approved.id);assert.equal((await ok('/api/school/diaries/'+approved.id)).force_deleted,true);assert.equal((await ok('/api/school/diaries?teacher='+teacher.id)).items.length,0);assert.equal((await req('/api/school/family/preview?'+new URLSearchParams({section:se,date}),'force-parent')).status,404);assert.equal((await req('/api/school/diaries/'+approved.id+'/amend','super','POST',{reason:'Must stay historical',version:approved.version})).status,409);await historical();
  await remove('legacy_diary',legacy.id);assert.equal((await ok('/api/diaries/'+legacy.id)).force_deleted,true);assert.ok(!(await ok('/api/diaries')).items.some(x=>x.id===legacy.id));
  const quoteImpact=await remove('quote',quote);assert.ok(quoteImpact.history.diaries>=1);assert.ok(!(await ok('/api/school/quotes')).quotes.some(x=>x.id===quote));await historical();
  const snapshot=await ok('/api/school/deleted-records');await assert.rejects(Promise.resolve().then(()=>db.run('DELETE FROM audit WHERE id=?',snapshot[0].id)),/append-only/);assert.ok(await db.one('SELECT 1 FROM audit WHERE id=?',snapshot[0].id));
 });

 test(runtime+': Force Delete rejects changed dependencies, respects granular permissions and serializes duplicate requests',async()=>{
  const subject=(await make('subject','Force concurrency subject')).id;
  const path='/api/school/force-delete/academic/'+subject,preview=await ok(path);
  await ok('/api/school/structure/'+subject,'super','PATCH',{name:'Force concurrency renamed'});
  const body=view=>({reason:'Confirmed safe concurrency test',confirmation:'FORCE DELETE',confirm_name:view.name,confirm_related:true,fingerprint:view.fingerprint});
  assert.equal((await req(path,'super','POST',body(preview))).status,400);
  const refreshed=await ok(path);const stale={...body(refreshed),fingerprint:preview.fingerprint};assert.equal((await req(path,'super','POST',stale)).status,409);
  const admin=await db.createUser({name:'Restricted Force Admin',email:'restricted-force-admin@example.invalid',role:'school_admin',password:f.password});await login('restricted-force-admin',admin);
  await ok('/api/school/permissions','super','PUT',{user_id:admin.id,allows:['records.force_delete'],denies:['structure.delete']});assert.equal((await req(path,'restricted-force-admin')).status,403);assert.equal((await req(path,'restricted-force-admin','POST',body(refreshed))).status,403);
  const responses=await Promise.all([req(path,'super','POST',body(refreshed)),req(path,'super','POST',body(refreshed))]);assert.deepEqual(responses.map(x=>x.status).sort(),[200,409]);assert.equal(Number((await db.one("SELECT COUNT(*) n FROM audit WHERE action='record_force_deleted' AND resource_id=?",'academic:'+subject)).n),1);
 });

 test(runtime+': teacher campus ownership filters catalog metadata and rejects cross-campus creates, edits and reactivation',async()=>{
  const cb=(await make('campus','Campus ownership Boys',branch)).id,cg=(await make('campus','Campus ownership Girls',branch)).id;
  const boysClass=(await make('class','Campus Boys class',cb)).id,girlsClass=(await make('class','Campus Girls class',cg)).id;
  const boysSection=(await make('section','Blue',boysClass)).id,girlsSection=(await make('section','Blue',girlsClass)).id;
  const subject=(await make('subject','Campus ownership subject')).id;
  for(const section_id of [boysSection,girlsSection])await ok('/api/school/curriculum','super','PUT',{section_id,subject_ids:[subject]});
  const teacher=await db.createUser({name:'Campus teacher',email:'campus-ownership@example.invalid',role:'teacher',password:f.password});
  await ok('/api/school/reviewers','super','PUT',{head_id:f.users.headB.id,teacher_ids:[...(await db.all('SELECT teacher_id FROM teacher_reviewers WHERE head_id=?',f.users.headB.id)).map(x=>x.teacher_id),teacher.id]});
  const body={teacher_id:teacher.id,pairs:[{section_id:boysSection,subject_id:subject}],weekdays:[1],due_time:'16:00',review_time:'18:00'};
  const missing=await req('/api/school/assignments','super','POST',body);assert.equal(missing.status,400);assert.match(missing.data.error,/no campus assignment/);
  assert.equal((await req('/api/school/teacher-campuses/'+teacher.id,'teacher','PUT',{campus_id:cb,expected_campus_id:null})).status,403);
  await setCampus(teacher.id,cb);
  const settingsValue=JSON.parse((await db.one('SELECT value FROM settings WHERE id=1')).value);
  await ok('/api/settings','super','PUT',{...settingsValue,teacherCampusAssignments:{[teacher.id]:cg}});
  assert.equal(JSON.parse((await db.one('SELECT value FROM settings WHERE id=1')).value).teacherCampusAssignments[teacher.id],cb,'Unrelated settings publication must preserve the authoritative campus map');
  const metadata=(await ok('/api/school/bootstrap')).structure.teacherCampuses;assert.ok(metadata.some(x=>x.teacher_id===teacher.id&&x.campus_id===cb));
  const invalid={...body,pairs:[...body.pairs,{section_id:girlsSection,subject_id:subject}]};
  assert.equal((await req('/api/school/assignments','super','POST',invalid)).status,400);assert.equal(Number((await db.one('SELECT COUNT(*) n FROM assignments WHERE teacher_id=?',teacher.id)).n),0,'mixed-campus save must roll back completely');
  const aid=(await ok('/api/school/assignments','super','POST',body,201)).created[0];
  const edit={section_id:girlsSection,subject_id:subject,weekdays:[1],due_time:'15:00',review_time:'17:00'};
  assert.equal((await req('/api/school/assignments/'+aid,'super','PUT',edit)).status,400);assert.equal((await db.one('SELECT section_id FROM assignments WHERE id=?',aid)).section_id,boysSection);
  await ok('/api/school/assignments/'+aid,'super','PATCH',{active:false});await setCampus(teacher.id,cg);
  assert.equal((await req('/api/school/assignments/'+aid,'super','PATCH',{active:true})).status,400);
  assert.equal((await req('/api/assignments/'+aid,'super','PATCH',{active:true})).status,400);
  assert.equal((await req('/api/school/teacher-campuses/'+teacher.id,'super','PUT',{campus_id:cb,expected_campus_id:null})).status,409);
  assert.equal((await ok('/api/school/assignments','super','POST',{...body,pairs:[{section_id:girlsSection,subject_id:subject}]},201)).created.length,1);
  const history=await db.all('SELECT * FROM audit WHERE action=? AND resource_id=?','teacher_campus_assigned',teacher.id);assert.equal(history.length,2);
 });

}
