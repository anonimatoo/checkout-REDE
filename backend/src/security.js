import { argon2, createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const derive = promisify(argon2);
export const token = () => randomBytes(32).toString('base64url');
export const digest = text => createHash('sha256').update(text).digest('hex');
export const validToken = value => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
export const validPassword = value => typeof value === 'string' && value.length >= 12 && value.length <= 128;

function argon(secret, salt) {
  return derive('argon2id', {
    message: Buffer.from(secret, 'utf8'), nonce: salt,
    parallelism: 1, tagLength: 32, memory: 65536, passes: 3,
  });
}

export async function hashPassword(secret) {
  const salt = randomBytes(16);
  const hash = await argon(secret, salt);
  return salt.toString('base64url') + '.' + hash.toString('base64url');
}

export function matches(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function verifyPassword(secret, encoded) {
  const [salt, expected] = encoded.split('.');
  return matches((await argon(secret, Buffer.from(salt, 'base64url'))).toString('base64url'), expected);
}

export function seal(value, key, id) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(Buffer.from(id));
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]).toString('base64url');
}

export function unseal(sealed, key, id) {
  const payload = Buffer.from(sealed, 'base64url');
  const decipher = createDecipheriv('aes-256-gcm', key, payload.subarray(0, 12));
  decipher.setAAD(Buffer.from(id));
  decipher.setAuthTag(payload.subarray(12, 28));
  return Buffer.concat([decipher.update(payload.subarray(28)), decipher.final()]).toString('utf8');
}
