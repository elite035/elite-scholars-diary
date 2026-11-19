import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
process.env.NODE_ENV='test';process.env.DATA_DIR=mkdtempSync(join(tmpdir(),'elite-transaction-'));
const {db,run,one,transaction}=await import('../server/db.mjs');
test('unrelated asynchronous SQLite transactions cannot share a rollback or see uncommitted data',async()=>{
 run('CREATE TABLE concurrency_probe(id TEXT PRIMARY KEY)');
 let release,started;const gate=new Promise(r=>release=r),ready=new Promise(r=>started=r);
 const first=transaction(async()=>{run("INSERT INTO concurrency_probe VALUES('first')");started();await gate;throw Error('Rollback first');});
 const rejected=assert.rejects(first,/Rollback first/);await ready;
 assert.throws(()=>one("SELECT * FROM concurrency_probe WHERE id='first'"),{status:503});
 let returned=false;const second=transaction(async()=>{run("INSERT INTO concurrency_probe VALUES('second')");returned=true;});
 assert.equal(returned,false);release();await rejected;await second;
 assert.equal(one("SELECT COUNT(*) n FROM concurrency_probe WHERE id='first'").n,0);
 assert.equal(one("SELECT COUNT(*) n FROM concurrency_probe WHERE id='second'").n,1);
});
test('real nested SQLite transactions stay atomic and synchronous callers remain compatible',async()=>{
 assert.equal(transaction(()=>transaction(()=>42)),42);
 await assert.rejects(transaction(async()=>{run("INSERT INTO concurrency_probe VALUES('nested')");await transaction(async()=>run("INSERT INTO concurrency_probe VALUES('nested-child')"));throw Error('Nested rollback');}),/Nested rollback/);
 assert.equal(one("SELECT COUNT(*) n FROM concurrency_probe WHERE id LIKE 'nested%'").n,0);db.close();
});
