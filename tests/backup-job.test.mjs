import test from 'node:test';import assert from 'node:assert/strict';import {runBackupJob} from '../shared/backup-job.mjs';import {backupStorage} from '../cloud/backup.mjs';
test('backup failures are audited once and propagate without a hidden retry or secret leakage',async()=>{
 const records=[];let calls=0;const error=Object.assign(Error('Provider details that must not be recorded'),{status:503,code:'STORAGE_RESTRICTED'});
 await assert.rejects(runBackupJob(async()=>{calls++;throw error;},async(...args)=>records.push(args)),e=>e===error);assert.equal(calls,1);assert.equal(records[0][1],'cloud_backup_failed');assert.deepEqual(records[0][3],{status:503,reason:'Storage service restricted'});assert.ok(!JSON.stringify(records).includes(error.message));
});
test('successful backups add a minimal completion event with no archive contents',async()=>{
 const records=[],result={createdAt:'2026-11-05',bytes:200,tables:40,files:0,key:'private-archive',secret:'not-for-audit'};
 assert.equal(await runBackupJob(async()=>result,async(...args)=>records.push(args)),result);assert.equal(records[0][1],'cloud_backup_completed');assert.deepEqual(records[0][3],{created_at:'2026-11-05',bytes:200,tables:40,files:0});
});
test('hosting quota restrictions produce an actionable service error',async()=>{
 const original=globalThis.fetch;globalThis.fetch=async()=>new Response('{}',{status:402});
 try{await assert.rejects(backupStorage('object/list/test'),{status:503,code:'STORAGE_RESTRICTED',message:/quota or billing restriction/});}finally{globalThis.fetch=original;}
});
