import test from 'node:test';import assert from 'node:assert/strict';import {Readable} from 'node:stream';import {readJsonBody,validateQuery} from '../shared/http-input.mjs';
test('chunked Urdu and Arabic JSON preserves every Unicode character at every byte boundary',async()=>{
 const expected={detail:'سبق پڑھیں، قرآن کریم — سوال ۵',name:'Teacher 🌟'},bytes=Buffer.from(JSON.stringify(expected));
 for(let i=1;i<bytes.length;i++)assert.deepEqual(await readJsonBody(Readable.from([bytes.subarray(0,i),bytes.subarray(i)])),expected);
});
test('streamed and platform-parsed request bodies reject invalid shapes and enforce byte limits',async()=>{
 for(const value of [null,[],true,3,'text']){
  await assert.rejects(readJsonBody(Readable.from([JSON.stringify(value)])),{status:400});
  await assert.rejects(readJsonBody({body:typeof value==='string'?JSON.stringify(value):value}),{status:400});
 }
 await assert.rejects(readJsonBody(Readable.from(['{broken'])),{status:400});
 await assert.rejects(readJsonBody(Readable.from(['{"x":"', '1234567890"}']),{maxBytes:10}),{status:413});
 await assert.rejects(readJsonBody({body:{x:'1234567890'}},{parsedMaxBytes:10}),{status:413});
 assert.deepEqual(await readJsonBody(Readable.from([])),{});assert.deepEqual(await readJsonBody({body:Buffer.from('{"ok":true}')}),{ok:true});
});
test('pagination rejects nonfinite, fractional and negative offsets before database access',()=>{
 for(const page of ['0','-1','1.5','Infinity','NaN','1e6','1000000',''])assert.throws(()=>validateQuery({page}),{status:400});
 for(const page of ['1','100','999999'])assert.equal(validateQuery({page}).page,page);assert.deepEqual(validateQuery({}),{});
});
