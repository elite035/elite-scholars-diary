import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeBackupPayload,decodeBackupPayload} from '../cloud/backup-codec.mjs';
import {randomBytes} from 'node:crypto';
import {sealBackup,openBackup} from '../cloud/backup.mjs';
process.env.BACKUP_ENCRYPTION_KEY=randomBytes(32).toString('hex');
const source={format:'elite-scholars-cloud-backup',version:1,tables:{users:[{email:'private@example.invalid',password:'private-hash'}]},files:[],sessionsExcluded:true};
test('cloud archives encrypt private account content and recover it exactly',()=>{const encrypted=sealBackup(source);assert.ok(!encrypted.includes(Buffer.from('private@example.invalid')));assert.deepEqual(openBackup(encrypted),source);assert.notDeepEqual(encrypted,sealBackup(source));});
test('modified archives and wrong recovery keys fail authentication',()=>{const encrypted=sealBackup(source);const changed=Buffer.from(encrypted);changed[changed.length-1]^=1;assert.throws(()=>openBackup(changed));const correct=process.env.BACKUP_ENCRYPTION_KEY;process.env.BACKUP_ENCRYPTION_KEY=randomBytes(32).toString('hex');assert.throws(()=>openBackup(encrypted));process.env.BACKUP_ENCRYPTION_KEY=correct;});
test('backup encryption refuses an absent or malformed key',()=>{const key=process.env.BACKUP_ENCRYPTION_KEY;process.env.BACKUP_ENCRYPTION_KEY='';assert.throws(()=>sealBackup(source),/not configured/);process.env.BACKUP_ENCRYPTION_KEY=key;});

test('backup plaintext limits are enforced on writing and reading while retaining the existing encrypted format',()=>{
 const bytes=sealBackup(source);assert.equal(bytes.subarray(0,5).toString(),'ESSB1');assert.throws(()=>sealBackup(source,{maxBytes:10}),{status:413});assert.throws(()=>openBackup(bytes,{maxBytes:10}));assert.deepEqual(openBackup(bytes),source);
});

test('repeated branding is stored once without changing historical JSON strings or breaking old archives',()=>{
 const image='data:image/jpeg;base64,'+randomBytes(6000).toString('base64'),snapshot=JSON.stringify({school:{logo:image,name:'Original school'},meta:{class_name:'Class 4'}}),large={...source,tables:{...source.tables,school_diaries:Array.from({length:20},(_,i)=>({id:String(i),snapshot,content:'{"homework":"Read"}'}))}};
 const before=JSON.stringify(large),encoded=encodeBackupPayload(large);assert.equal(encoded.magic,'ESSB2');assert.ok(encoded.plaintext.length<Buffer.byteLength(before)/5);const archive=sealBackup(large);assert.equal(archive.subarray(0,5).toString(),'ESSB2');assert.deepEqual(openBackup(archive),large);assert.equal(JSON.stringify(large),before);assert.deepEqual(openBackup(sealBackup(source)),source);
 assert.throws(()=>decodeBackupPayload(encoded.plaintext,encoded.magic,{maxBytes:encoded.plaintext.length+1}),{status:413});
 const invalid=JSON.parse(encoded.plaintext);invalid.assets=[];assert.throws(()=>decodeBackupPayload(Buffer.from(JSON.stringify(invalid)),'ESSB2'),/Invalid backup image reference/);
});
