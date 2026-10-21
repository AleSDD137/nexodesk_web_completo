import test from 'node:test';
import assert from 'node:assert/strict';
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
