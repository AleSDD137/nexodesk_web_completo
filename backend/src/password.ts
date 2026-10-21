/* Derivación de contraseña con scrypt de Node.js: sal aleatoria + comparación constante. */
import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
const scrypt = promisify(scryptCallback);
const N=32768, r=8, p=1, keyLength=64;
const maxmem=64 * 1024 * 1024;
export function passwordError(password: string): string | null {
  if(password.length < 12) return 'La contraseña debe tener al menos 12 caracteres.';
  if(password.length > 128 || Buffer.byteLength(password,'utf8')>256)return 'Contraseña demasiado larga (máximo 128 caracteres / 256 bytes).';
  return null;
}
export async function hashPassword(password: string): Promise<string> {
  const problem=passwordError(password);if(problem)throw Error(problem);
  const salt=randomBytes(24);
  const hash=await scrypt(password,salt,keyLength,{N,r,p,maxmem}) as Buffer;
  return `scrypt$${N}$${r}$${p}$${salt.toString('hex')}$${hash.toString('hex')}`;
}
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try{
    if(typeof password!=='string'||Buffer.byteLength(password,'utf8')>256)return false;
    const [kind,ns,rs,ps,saltText,hashText]=stored.split('$');
    if(kind!=='scrypt'||Number(ns)!==N||Number(rs)!==r||Number(ps)!==p||
       !/^[a-f0-9]{48}$/.test(saltText)||!/^[a-f0-9]{128}$/.test(hashText))return false;
    const expected=Buffer.from(hashText,'hex');
    const actual=await scrypt(password,Buffer.from(saltText,'hex'),expected.length,{N,r,p,maxmem}) as Buffer;
    return timingSafeEqual(expected,actual);
  }catch{return false;}
}
export function tokenDigest(token: string): string { return createHash('sha256').update(token).digest('hex'); }
