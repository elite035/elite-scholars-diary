import test from 'node:test';
import {encode} from 'fast-png';
import assert from 'node:assert/strict';
import {createDocumentActions,documentActionUrl} from '../public/diary-actions.js';
import {documentFilename} from '../public/document-filename.js';
import {renderDocumentBlob,waitForDocument} from '../client/export.mjs';
import {homeworkSample} from '../shared/homework-template.mjs';
import {readFileSync} from 'node:fs';
const origin='https://diary.example';
function harness(){
 const listeners=new Map(),frames=[],saved=[];let prints=0;
 const child={addEventListener(k,fn){listeners.set('child:'+k,fn);},focus(){},print(){prints++;}};
 const win={location:{origin},crypto:{randomUUID:()=> 'test-token'},setTimeout,clearTimeout,addEventListener(k,fn){listeners.set(k,fn);},removeEventListener(k){listeners.delete(k);}};
 const doc={body:{append(frame){frames.push(frame);}},createElement(){return {style:{},setAttribute(){},contentWindow:child,remove(){this.removed=true;}};}};
 const actions=createDocumentActions({win,doc,save:(blob,filename)=>saved.push({blob,filename}),timeoutMs:100});
 const send=(data,overrides={})=>listeners.get('message')?.({origin,source:child,data:{channel:'elite-diary-export',id:'test-token',...data},...overrides});
 return {actions,frames,saved,send,listeners,get prints(){return prints;}};
}
test('every supported diary action uses same-origin direct export; CSV and external links stay unchanged',()=>{
 for(const path of ['/api/school/diaries/a/preview','/api/school/class-diaries/preview','/api/school/family/preview','/api/class-diary/preview','/api/templates/homework-preview','/api/diaries/a/export','/api/school/diaries/export','/api/school/class-diaries/export','/api/export','/api/reports','/api/school/reports/export'])for(const format of ['pdf','png','jpg','print'])assert.ok(documentActionUrl(path+'?format='+format,origin));
 assert.ok(documentActionUrl('/api/diaries/a/print',origin));assert.equal(documentActionUrl('/api/export?format=csv',origin),null);assert.equal(documentActionUrl('https://other.example/api/export?format=pdf',origin),null);assert.equal(documentActionUrl('/#/diaries',origin),null);
});
test('one operation and one download despite repeated clicks and repeated results; verifies message origin/source/token',async()=>{
 const h=harness(),promise=h.actions.run('/api/export?format=pdf');assert.equal(h.actions.run('/api/export?format=png'),promise);assert.equal(h.frames.length,1);
 const result={type:'result',blob:new Blob(['pdf']),filename:'Class_4_Blue.pdf',pages:2};h.send(result,{origin:'https://evil.example'});h.send(result,{source:{}});h.send({...result,id:'wrong'});assert.equal(h.saved.length,0);h.send(result);h.send(result);assert.equal((await promise).pages,2);assert.equal(h.saved.length,1);assert.ok(h.frames[0].removed);assert.equal(h.actions.busy,false);
});
test('print calls only isolated diary window once and cleans up after native afterprint',async()=>{
 const h=harness(),promise=h.actions.run('/api/diaries/a/print');h.send({type:'ready'});h.send({type:'ready'});assert.equal(h.prints,1);assert.equal(h.saved.length,0);h.listeners.get('child:afterprint')();assert.equal((await promise).format,'print');assert.ok(h.frames[0].removed);
});
test('permission errors and rendering timeout reject with clear errors and release operation lock',async()=>{
 const h=harness();let promise=h.actions.run('/api/export?format=png');h.send({type:'error',error:'Export permission required.'});await assert.rejects(promise,/permission/);assert.equal(h.actions.busy,false);
 promise=h.actions.run('/api/export?format=png');h.frames.at(-1).contentDocument={contentType:'application/json',body:{textContent:'{"error":"Sign in required"}'}};h.frames.at(-1).onload();await assert.rejects(promise,/Sign in required/);
 await assert.rejects(h.actions.run('/api/export?format=pdf'),/timed out/);assert.equal(h.actions.busy,false);
});
const source={dataset:{className:'4',sectionName:'Blue',diaryDate:'2026-10-27'}};
const pages=[{offsetWidth:1122,offsetHeight:793},{offsetWidth:1122,offsetHeight:793}];
const doc={querySelectorAll:s=>s==='.document-source'?[source]:pages,body:{dataset:{exportName:'fallback'}},defaultView:{getComputedStyle:()=>({backgroundColor:'#fbf8ef'})}};
const png='data:image/png;base64,'+Buffer.from(encode({width:1,height:1,data:new Uint8Array([255,255,255,255]),channels:4})).toString('base64');
test('meaningful class section and date filenames; sanitized fallback collections',()=>{assert.equal(documentFilename(doc),'Class_4_Blue_27_October_2026');assert.equal(documentFilename({...doc,querySelectorAll:()=>[],body:{dataset:{exportName:'Reports / October'}}}),'Reports_October');});
test('real PDF contains every page and returns a PDF Blob with meaningful filename',async()=>{const result=await renderDocumentBlob(doc,'pdf',{rasterPng:async()=>png});assert.equal(result.pages,2);assert.equal(result.filename,'Class_4_Blue_27_October_2026.pdf');assert.equal(result.blob.type,'application/pdf');const text=await result.blob.text();assert.ok(text.startsWith('%PDF'));assert.match(text,/\/Count 2/);});
test('PNG combines every rendered page into one image rather than a ZIP; long diaries stay within canvas limits',async()=>{
 const draws=[],ratios=[],canvas={getContext:()=>({fillRect(){},drawImage(...args){draws.push(args);}}),toBlob(cb,type){cb(new Blob(['image'],{type}));}};
 const longDoc={...doc,querySelectorAll:s=>s==='.document-source'?[source]:Array(30).fill(pages[0])};
 const result=await renderDocumentBlob(longDoc,'png',{rasterPng:async(p,o)=>{ratios.push(o.pixelRatio);return png;},loadImage:async()=>({}),canvasFactory:()=>canvas});assert.equal(result.pages,30);assert.equal(result.blob.type,'image/png');assert.ok(result.filename.endsWith('.png'));assert.equal(draws.length,30);assert.ok(canvas.height<=16384);assert.ok(canvas.width*canvas.height<=24010000);assert.equal(new Set(ratios).size,1);assert.equal(draws.at(-1)[2]+draws.at(-1)[4],canvas.height);
});
test('layout errors and empty page exports fail explicitly',async()=>{await assert.rejects(waitForDocument({documentError:'Footer too large'}),/Footer too large/);await waitForDocument({documentReady:true});await assert.rejects(renderDocumentBlob({...doc,querySelectorAll:()=>[]},'pdf'),/no printable pages/);});
test('both document adapters expose shared actions, permission gate, source metadata and diary-only print CSS',()=>{
 for(const file of ['shared/document-shell.mjs']){const text=readFileSync(new URL('../'+file,import.meta.url),'utf8');assert.ok(text.includes('data-export-allowed="${allowPrint}"'));assert.ok(text.includes('id="print-document"'));assert.ok(text.includes('src="/export.js"'));assert.ok(!text.includes('onclick="window.print()"'));assert.ok(text.includes('.toolbar{display:none}'));assert.ok(text.includes('print-color-adjust:exact'));for(const adapter of ['server/documents.mjs','cloud/documents.mjs'])assert.ok(readFileSync(new URL('../'+adapter,import.meta.url),'utf8').includes('data-diary-date='));}
 const html=homeworkSample({name:'Elite Scholars',logo:'/assets/official-school-logo.jpeg'});assert.ok(html.includes('data-class-name="6th"'));assert.ok(html.includes('data-section-name="Blue + Pink"'));assert.ok(html.includes('data-diary-date="2026-10-14"'));assert.ok(html.includes('data-version='));
 const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');assert.match(app,/installDocumentActions\(\{\s*notify:\s*toast\s*\}\)/);assert.ok(!app.includes('window.location.assign(path)'));
});
