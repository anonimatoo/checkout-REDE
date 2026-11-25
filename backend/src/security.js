import { argon2, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
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

export { seal, unseal } from '../../shared/secrets.js';
