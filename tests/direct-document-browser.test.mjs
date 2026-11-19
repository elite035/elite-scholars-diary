import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';

test('browser: direct PDF/PNG downloads keep the current screen and print targets only the diary',async t=>{
 let browser;try{browser=await chromium.launch({headless:true,...(process.platform==='darwin'?{channel:'chrome'}:{})});}catch(error){if(process.env.REQUIRE_BROWSER_TESTS==='1')throw error;t.skip('Browser acceptance blocked: Chromium cannot launch in this environment. Native print and Android require device verification.');return;}
 process.env.NODE_ENV='test';process.env.DATA_DIR=mkdtempSync(join(tmpdir(),'elite-direct-browser-'));
 const {server,shutdown}=await import('../server/index.mjs'),{fixtures}=await import('../scripts/fixtures.mjs');const fixture=fixtures();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
 try{
  const response=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:fixture.users.teacher.email,password:fixture.password})}),login=await response.json(),cookie=response.headers.get('set-cookie').split(';')[0];assert.equal(response.status,200);
  const created=await fetch(base+'/api/diaries',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json','X-CSRF-Token':login.csrf},body:JSON.stringify({assignment_id:fixture.assignments.a,diary_date:'2026-10-19',period:1,submit:false,content:{topic:'Direct export verification',todays_lesson:'Long diary content. '.repeat(500)+'FINAL EXPORT CONTENT'}})});assert.equal(created.status,201);const diary=await created.json();
  for(const mobile of [false,true]){
   const context=await browser.newContext({acceptDownloads:true,...(mobile?{viewport:{width:393,height:851},isMobile:true,hasTouch:true}:{})});await context.addCookies([{name:'ess_session',value:cookie.slice(cookie.indexOf('=')+1),url:base}]);
   await context.addInitScript(()=>{window.__printCalls=0;window.__diaryPrintCalls=0;window.print=()=>{window.__printCalls++;if(window!==window.top){if(document.querySelector('.sidebar'))throw Error('App interface must not be printed');window.top.__diaryPrintCalls++;}window.dispatchEvent(new Event('afterprint'));};});
   const page=await context.newPage();await page.goto(base+'/');await page.waitForSelector('.sidebar');
   const original=page.url();await page.evaluate(id=>{for(const format of ['pdf','png','print']){const link=document.createElement('a');link.id='verify-'+format;link.href='/api/diaries/'+id+(format==='print'?'/print':'/export?format='+format);link.textContent=format;document.body.append(link);}},diary.id);
   for(const kind of ['pdf','png']){
    const download=page.waitForEvent('download',{timeout:120000}),operation=page.click('#verify-'+kind);const file=await download;await operation;await page.waitForFunction(()=>!document.querySelector('iframe[title^="Preparing diary"]'));const bytes=readFileSync(await file.path());assert.ok(bytes.length>1000);assert.equal(bytes.subarray(0,kind==='pdf'?4:8).toString('hex'),kind==='pdf'?Buffer.from('%PDF').toString('hex'):'89504e470d0a1a0a');assert.ok(file.suggestedFilename().endsWith('.'+kind));assert.equal(page.url(),original);assert.equal(await page.locator('iframe[title^="Preparing diary"]').count(),0);
   }
   await page.click('#verify-print');await page.waitForFunction(()=>window.__diaryPrintCalls===1&&!document.querySelector('iframe[title="Preparing diary print"]'));assert.equal(page.url(),original);assert.equal(await page.evaluate(()=>window.__printCalls),0);
   // Standalone previews must reuse their existing pages, not request another preview.
   await page.goto(base+'/api/diaries/'+diary.id+'/preview');await page.waitForFunction(()=>window.documentReady);
   const previewUrl=page.url(),documentRequests=[];page.on('request',request=>{if(request.isNavigationRequest())documentRequests.push(request.url());});
   for(const kind of ['pdf','png']){
    const pending=page.waitForEvent('download',{timeout:120000});await page.click('[data-document-format="'+kind+'"]');
    const file=await pending;assert.ok(readFileSync(await file.path()).length>1000);assert.ok(file.suggestedFilename().endsWith('.'+kind));
    await page.waitForFunction(()=>!document.querySelector('[data-document-format="pdf"]').disabled);
    assert.equal(page.url(),previewUrl);assert.equal(await page.locator('iframe').count(),0);
   }
   await page.click('[data-document-format="print"]');await page.waitForFunction(()=>window.__printCalls===1);
   assert.equal(await page.evaluate(()=>window.__diaryPrintCalls),0);assert.equal(documentRequests.length,0);
   await context.close();
  }
 }finally{await browser.close();await shutdown();}
});
