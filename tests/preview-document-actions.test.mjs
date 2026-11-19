import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {createPreviewActions,initExportDocument} from '../client/export.mjs';
import {documentHtml as localHtml} from '../shared/document-shell.mjs';
const cloudHtml=localHtml;
function fixture(allowed=true){
 const {document:doc}=parseHTML(localHtml(['<article class="document-source">Current diary version</article>'],undefined,allowed));
 const listeners=new Map(),saved=[],renders=[];let prints=0;
 const win={document:doc,documentReady:true,location:{href:'https://diary.example/api/school/class-diaries/preview?section=1&date=2026-10-27',origin:'https://diary.example'},parent:null,setTimeout,clearTimeout,focus(){},addEventListener(k,f){listeners.set(k,f);},removeEventListener(k){listeners.delete(k);},print(){prints++;listeners.get('afterprint')?.();}};win.parent=win;
 const render=async(document,kind)=>{renders.push({document,kind});return {blob:new Blob(['current version']),filename:'Class_4_Blue_27_October_2026.'+kind,pages:1};};
 const actions=createPreviewActions({win,doc,render,save:(blob,filename)=>saved.push({blob,filename})});
 return {doc,win,actions,saved,renders,get prints(){return prints;}};
}
test('every standalone document preview offers PDF, PNG and PRINT regardless of requested export format',()=>{
 for(const html of [localHtml,cloudHtml])for(const format of [undefined,'pdf','png','print']){
  const {document}=parseHTML(html(['<article>Diary</article>'],format));
  assert.deepEqual([...document.querySelectorAll('[data-document-format]')].map(b=>b.dataset.documentFormat),['pdf','png','print']);
  assert.equal(document.querySelectorAll('iframe').length,0);
  const denied=parseHTML(html([],format,false)).document;assert.equal(denied.querySelectorAll('[data-document-format]').length,0);
 }
});
test('preview downloads use current document without a second request, frame or navigation; duplicate operations share one promise',async()=>{
 const h=fixture(),original=h.win.location.href;
 for(const kind of ['pdf','png']){
  const promise=h.actions.run(kind);assert.equal(h.actions.run(kind),promise);
  await promise;assert.equal(h.renders.at(-1).document,h.doc);assert.equal(h.renders.at(-1).kind,kind);
  assert.equal(h.saved.at(-1).filename,'Class_4_Blue_27_October_2026.'+kind);
  assert.equal(h.doc.querySelectorAll('iframe').length,0);assert.equal(h.win.location.href,original);
 }
 assert.equal(h.saved.length,2);assert.equal(h.actions.busy,false);
});
test('preview prints its own diary document once and restores controls after afterprint',async()=>{
 const h=fixture();const promise=h.actions.run('print');assert.equal(h.actions.run('print'),promise);
 await promise;assert.equal(h.prints,1);assert.equal(h.saved.length,0);assert.equal(h.renders.length,0);
 assert.ok([...h.doc.querySelectorAll('button')].every(button=>!button.disabled));
});
test('preview permission and layout errors prevent download and printing and restore controls',async()=>{
 const denied=fixture(false);await assert.rejects(denied.actions.run('pdf'),/permission/);await assert.rejects(denied.actions.run('print'),/permission/);assert.equal(denied.prints,0);
 const h=fixture();h.win.documentError='Diary cannot fit legibly on one A4 page';
 for(const kind of ['pdf','png','print'])await assert.rejects(h.actions.run(kind),/cannot fit/);
 assert.equal(h.saved.length,0);assert.equal(h.prints,0);assert.equal(h.actions.busy,false);
 assert.ok([...h.doc.querySelectorAll('button')].every(button=>!button.disabled));
});
test('preview initialization registers toolbar listeners only once',()=>{
 const h=fixture();assert.equal(initExportDocument(h.win,h.doc),initExportDocument(h.win,h.doc));
});
