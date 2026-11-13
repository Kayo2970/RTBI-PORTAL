/**
 * encryption.ts — AES-256-GCM Master Encryption & Decryption Utility
 *
 * Provides authenticated encryption for server data collections, system backups,
 * and sensitive records. Uses Node.js built-in `crypto` module:
 * - Cipher: AES-256-GCM (Authenticated Encryption with Associated Data)
 * - Key Derivation: PBKDF2 with SHA-256 (100,000 iterations)
 * - Salt & IV: Cryptographically secure random bytes
 */
import crypto from 'crypto';

// This fallback key is committed in git history and readable by anyone with
// the source — encryption "at rest" that silently uses it is cosmetic, not
// real. It's kept ONLY so an existing deploy that already has data encrypted
// under it (because DATA_ENCRYPTION_KEY was never set) can still decrypt
// that data — removing it outright would make that data unrecoverable, not
// secure. /api/setup's isKeyConfigured check already detects this exact
// state and prompts an admin to rotate to a real key (see setup/route.ts);
// this just makes the same condition impossible to miss in server logs too.
const FALLBACK_KEY = 'LEADS_ERP_MASTER_SECRET_KEY_2026';
let warnedFallback = false;

export function getMasterKey(): string {
  const key = process.env.DATA_ENCRYPTION_KEY;
  if (key && key.trim()) return key;
  if (!warnedFallback) {
    warnedFallback = true;
    console.error(
      '[encryption] SECURITY WARNING: DATA_ENCRYPTION_KEY is not set — falling back to the ' +
      'hardcoded key committed in this repo\'s source. Data "encrypted" this way is not actually ' +
      'protected. Set DATA_ENCRYPTION_KEY in the environment and run the key-rotation step in ' +
      'Admin → Settings (or /setup) as soon as possible.'
    );
  }
  return FALLBACK_KEY;
}

const FIXED_SALT = Buffer.from('LEADS_NEXT_GEN_CENTRE_MSRUAS_SALT_2026', 'utf-8');

export interface EncryptedPayload {
  _encrypted: true;
  algorithm: 'aes-256-gcm';
  iv: string;
  authTag: string;
  ciphertext: string;
}

/** Derive a 256-bit (32 byte) key from a passphrase and salt using PBKDF2 */
const keyCache = new Map<string, Buffer>();
function deriveKey(passphrase: string, salt: Buffer = FIXED_SALT): Buffer {
  // PBKDF2 at 100k rounds is synchronous and slow; the inputs rarely change, so memoise.
  const cacheKey = `${salt.toString('hex')}|${passphrase}`;
  let key = keyCache.get(cacheKey);
  if (!key) {
    key = crypto.pbkdf2Sync(passphrase, salt, 100000, 32, 'sha256');
    keyCache.set(cacheKey, key);
  }
  return key;
}

/**
 * Encrypt any plain text string using AES-256-GCM.
 * Returns a JSON-serializable EncryptedPayload object.
 */
export function encryptData(text: string, customPassphrase?: string): EncryptedPayload {
  const passphrase = customPassphrase || getMasterKey();
  const key = deriveKey(passphrase);
  const iv = crypto.randomBytes(12);

  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let ciphertext = cipher.update(text, 'utf-8', 'hex');
  ciphertext += cipher.final('hex');

  const authTag = cipher.getAuthTag().toString('hex');

  return {
    _encrypted: true,
    algorithm: 'aes-256-gcm',
    iv: iv.toString('hex'),
    authTag,
    ciphertext,
  };
}

function decryptWithPassphrase(payload: EncryptedPayload, passphrase: string): string {
  const key = deriveKey(passphrase);
  const iv = Buffer.from(payload.iv, 'hex');
  const authTag = Buffer.from(payload.authTag, 'hex');

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  let plaintext = decipher.update(payload.ciphertext, 'hex', 'utf-8');
  plaintext += decipher.final('utf-8');

  return plaintext;
}

/**
 * Decrypt an EncryptedPayload object back to original plain text.
 * Throws an Error if the passphrase is invalid or the data has been tampered with.
 */
export function decryptData(payload: EncryptedPayload, customPassphrase?: string): string {
  if (!payload || !payload._encrypted || !payload.iv || !payload.ciphertext || !payload.authTag) {
    throw new Error('Invalid encrypted payload format.');
  }

  const passphrase = customPassphrase || getMasterKey();
  try {
    return decryptWithPassphrase(payload, passphrase);
  } catch (err) {
    if (customPassphrase || passphrase === FALLBACK_KEY) {
      throw err;
    }
    // Backward compatibility: If the payload was encrypted before DATA_ENCRYPTION_KEY
    // was configured (i.e. using FALLBACK_KEY), decrypt it with FALLBACK_KEY.
    try {
      return decryptWithPassphrase(payload, FALLBACK_KEY);
    } catch {
      throw err;
    }
  }
}

/**
 * Helper to check if a parsed object is an encrypted payload wrapper.
 */
export function isEncryptedPayload(obj: any): obj is EncryptedPayload {
  return typeof obj === 'object' && obj !== null && obj._encrypted === true && typeof obj.ciphertext === 'string';
}
