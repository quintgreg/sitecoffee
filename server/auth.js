// Пароли (scrypt), токены сессий и cookie-утилиты.
import { scryptSync, randomBytes, timingSafeEqual, createHash } from 'node:crypto';

const KEYLEN = 64;

export function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, KEYLEN);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(password, stored) {
  const [algo, saltHex, hashHex] = String(stored).split('$');
  if (algo !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return timingSafeEqual(expected, actual);
}

export const newToken = () => randomBytes(32).toString('hex');
// в БД хранится только хеш токена: утечка таблицы sessions не даёт войти
export const hashToken = (t) => createHash('sha256').update(t).digest('hex');

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (!k) continue;
    // чужие cookie с битой %-кодировкой (общий localhost) не должны ронять запрос
    try { out[k] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* пропускаем */ }
  }
  return out;
}

export function cookie(name, value, { maxAge, secure = false } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (maxAge !== undefined) parts.push(`Max-Age=${maxAge}`);
  if (secure) parts.push('Secure');
  return parts.join('; ');
}
