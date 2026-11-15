import test from 'node:test';
import assert from 'node:assert/strict';
import { scrypt as scryptCallback } from 'node:crypto';
import { hashPassword, verifyPassword, passwordError, tokenDigest } from './password.ts';
test('scrypt sal aleatoria y contraseña verificada',async()=>{
  const secret='Clave-Larga-Segura-2026!!';
  const a=await hashPassword(secret);const b=await hashPassword(secret);
  assert.notEqual(a,b);assert.ok(a.startsWith('scrypt$'));
  assert.equal(await verifyPassword(secret,a),true);
  assert.equal(await verifyPassword('incorrecta',a),false);
  assert.equal(await verifyPassword(secret,'hash inválido'),false);
});
test('no permite contraseñas demasiado débiles',()=>{
  assert.ok(passwordError('123456'));
  assert.equal(passwordError('UnaClaveMasLarga2026!'),null);
});
test('digest de sesión es determinista y nunca devuelve el token original',()=>{
  const raw='f'.repeat(64);assert.notEqual(tokenDigest(raw),raw);assert.equal(tokenDigest(raw).length,64);
});
test('verifica un hash legado fijo sin modificar parámetros ni formato',async()=>{
  // Fixture sintético producido por el callback original, no una cuenta real.
  const secret='Compatibilidad-NEXODESK-2026!';
  const legacy='scrypt$32768$8$1$000102030405060708090a0b0c0d0e0f1011121314151617$1364369a553ef9c001a8e4f85842999c000ee7989d53fa89779d15b5fe1c9262997d62310685a909982f4fa21925639010fc2004abbd137437f05ea2daa13cb8';
  assert.equal(await verifyPassword(secret,legacy),true);
  assert.equal(await verifyPassword('OtraClaveLarga2026!',legacy),false);
  assert.equal(await verifyPassword(secret,legacy.replace('scrypt$32768','scrypt$16384')),false);
});
test('los hashes nuevos conservan compatibilidad con el callback original de scrypt',async()=>{
  const secret='Compatibilidad-NEXODESK-2026!';
  const [kind,n,r,p,salt,hash]=(await hashPassword(secret)).split('$');
  assert.deepEqual([kind,n,r,p],['scrypt','32768','8','1']);
  assert.match(salt,/^[a-f0-9]{48}$/);
  assert.match(hash,/^[a-f0-9]{128}$/);
  const original=await new Promise<Buffer>((resolve,reject)=>{
    scryptCallback(secret,Buffer.from(salt,'hex'),64,{N:32768,r:8,p:1,maxmem:64*1024*1024},(error,key)=>{
      if(error)reject(error);else resolve(key);
    });
  });
  assert.equal(hash,original.toString('hex'));
});
