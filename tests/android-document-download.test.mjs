import test from 'node:test';import assert from 'node:assert/strict';import {saveDocumentBlob} from '../public/diary-actions.js';
const origin='https://diary.elitescholars.edu.pk';
test('Android exports transfer the actual PDF, PNG and JPG bytes without fetch or object URLs',async()=>{
 for(const type of ['application/pdf','image/png','image/jpeg']){const calls=[];const win={location:{origin},URL:{createObjectURL(){throw Error('Object URLs must not be used');}},fetch(){throw Error('WebView fetch is blocked');},EliteNative:{saveFile:(...args)=>calls.push(args)},FileReader:class{readAsDataURL(blob){assert.equal(blob.type,type);queueMicrotask(()=>{this.result='data:'+type+';base64,dGVzdA==';this.onload();});}}};
 await saveDocumentBlob({size:4,type},'Class_4_Blue_Test.'+(type==='application/pdf'?'pdf':type==='image/png'?'png':'jpg'),{win,doc:{}});assert.equal(calls.length,1);assert.equal(calls[0][1],type);assert.equal(calls[0][2],'dGVzdA==');}
});
test('Android read errors reject so the export UI can show an error and release controls',async()=>{const win={location:{origin},EliteNative:{saveFile(){throw Error('Must not reach native code');}},FileReader:class{readAsDataURL(){queueMicrotask(()=>this.onerror());}}};await assert.rejects(saveDocumentBlob({size:4,type:'application/pdf'},'test.pdf',{win,doc:{}}),/could not be read/);});
test('Android rejects unsupported or oversized files before requesting native storage',()=>{const win={location:{origin},EliteNative:{saveFile(){throw Error('Must not reach native code');}}};assert.throws(()=>saveDocumentBlob({size:21*1024*1024,type:'application/pdf'},'test.pdf',{win,doc:{}}),/20 MB/);assert.throws(()=>saveDocumentBlob({size:4,type:'application/octet-stream'},'test.exe',{win,doc:{}}),/Unsupported/);});

test('updated Android bridge accepts ZIP bytes while old installed apps get a clear upgrade message',async()=>{
 const make=supported=>{const calls=[];return {calls,win:{location:{origin},EliteNative:{saveFile:(...args)=>calls.push(args),...(supported?{supportsArchiveDownloads:()=>true}:{})},FileReader:class{readAsDataURL(){this.result='data:application/zip;base64,UEsDBA==';this.onload();}}}};};
 const current=make(true);await saveDocumentBlob({size:4,type:'application/zip'},'Class_Diaries_PDF.zip',{win:current.win,doc:{}});assert.equal(current.calls.length,1);assert.equal(current.calls[0][1],'application/zip');
 const old=make(false);assert.throws(()=>saveDocumentBlob({size:4,type:'application/zip'},'Class_Diaries_PDF.zip',{win:old.win,doc:{}}),/Update the Android app/);assert.equal(old.calls.length,0);
});
