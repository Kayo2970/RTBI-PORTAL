/**
 * password.ts — hashing for Member.passwordHash. Uses Node's built-in
 * crypto.scrypt (no new dependency) with a random salt per password and a
 * timing-safe comparison, so passwords are never stored or compared as
 * plaintext anywhere in the app.
 */
import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';

const KEY_LENGTH = 64;

export function hashPassword(plain: string): string {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(plain, salt, KEY_LENGTH).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(plain: string, stored: string | undefined | null): boolean {
  if (!stored) return false;
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;

  const derived = scryptSync(plain, salt, KEY_LENGTH);
  const stored_ = Buffer.from(hash, 'hex');
  if (derived.length !== stored_.length) return false;

  return timingSafeEqual(derived, stored_);
}
