import test from 'node:test';import assert from 'node:assert/strict';import {createApiClient} from '../public/api-client.js';
test('client sends CSRF and JSON once and does not retry writes after network failures',async()=>{
 let calls=0;const api=createApiClient({csrf:()=> 'csrf',fetchImpl:async(path,options)=>{calls++;assert.equal(options.headers['X-CSRF-Token'],'csrf');assert.equal(options.credentials,'same-origin');assert.equal(options.body,'{"detail":"سبق"}');throw TypeError('Failed to fetch');}});
 await assert.rejects(api('/api/school/diaries',{method:'POST',body:{detail:'سبق'}}),/changes have not been confirmed/);assert.equal(calls,1);
});
test('client handles HTML server failures, session expiry, unexpected responses and timeouts clearly',async()=>{
 let expired=0;const failing=status=>createApiClient({onUnauthorized:()=>expired++,fetchImpl:async()=>new Response('<html>Error</html>',{status})});
 await assert.rejects(failing(503)('/api/me'),/temporarily unavailable/);await assert.rejects(failing(401)('/api/me'));assert.equal(expired,1);
 await assert.rejects(createApiClient({fetchImpl:async()=>new Response('not json',{status:200})})('/api/me'),/unexpected response/);
 const timeout=createApiClient({timeoutMs:5,fetchImpl:(_path,{signal})=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(Object.assign(Error(),{name:'AbortError'}))))});await assert.rejects(timeout('/api/me'),/timed out/);
});
test('successful transport preserves API arrays and error messages without changing payloads',async()=>{
 const api=createApiClient({fetchImpl:async()=>Response.json([{id:'a'}])});assert.deepEqual(await api('/api/school/people'),[{id:'a'}]);
 await assert.rejects(createApiClient({fetchImpl:async()=>Response.json({error:'Diary changed; reload'},{status:409})})('/api/x'),{message:'Diary changed; reload',status:409});
});
