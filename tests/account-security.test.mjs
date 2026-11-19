import test from 'node:test';
import assert from 'node:assert/strict';
import {base32,totp} from '../shared/account-security.mjs';
import {passwordHashAsync,passwordValidAsync} from '../shared/passwords.mjs';
test('authenticator matches the RFC 6238 SHA-1 test vectors including future 64-bit times',()=>{
 const secret=base32(Buffer.from('12345678901234567890'));
 for(const [seconds,expected]of [[59,'94287082'],[1111111109,'07081804'],[1111111111,'14050471'],[1234567890,'89005924'],[2000000000,'69279037'],[20000000000,'65353130']])assert.equal(totp(secret,seconds*1000,8),expected);
});
test('asynchronous password hashes preserve the existing scrypt format and reject invalid credentials',async()=>{
 const password='A strong test password!';const hash=await passwordHashAsync(password);
 assert.match(hash,/^[a-f0-9]{32}:[a-f0-9]{128}$/);assert.equal(await passwordValidAsync(password,hash),true);assert.equal(await passwordValidAsync('Wrong',hash),false);assert.equal(await passwordValidAsync(password,'broken'),false);
});
