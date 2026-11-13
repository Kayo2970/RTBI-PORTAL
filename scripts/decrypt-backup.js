/**
 * decrypt-backup.js — Standalone Offline Decryption Utility
 *
 * Usage:
 *   node scripts/decrypt-backup.js <encrypted-file.json> [passphrase]
 *
 * Example:
 *   node scripts/decrypt-backup.js data/members.json "LEADS_ERP_MASTER_SECRET_KEY_2026"
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const filePath = process.argv[2];
const passphrase = process.argv[3] || process.env.DATA_ENCRYPTION_KEY || 'LEADS_ERP_MASTER_SECRET_KEY_2026';

if (!filePath) {
  console.log('Usage: node scripts/decrypt-backup.js <path-to-encrypted-file.json> [passphrase]');
  process.exit(1);
}

const resolvedPath = path.resolve(filePath);

if (!fs.existsSync(resolvedPath)) {
  console.error(`Error: File not found at ${resolvedPath}`);
  process.exit(1);
}

try {
  const fileContent = fs.readFileSync(resolvedPath, 'utf-8');
  const payload = JSON.parse(fileContent);

  if (!payload || !payload._encrypted || !payload.iv || !payload.ciphertext || !payload.authTag) {
    console.log('File is plain unencrypted JSON. Content:');
    console.log(JSON.stringify(payload, null, 2));
    process.exit(0);
  }

  const salt = Buffer.from('LEADS_NEXT_GEN_CENTRE_MSRUAS_SALT_2026', 'utf-8');
  const key = crypto.pbkdf2Sync(passphrase, salt, 100000, 32, 'sha256');
  const iv = Buffer.from(payload.iv, 'hex');
  const authTag = Buffer.from(payload.authTag, 'hex');

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  let plaintext = decipher.update(payload.ciphertext, 'hex', 'utf-8');
  plaintext += decipher.final('utf-8');

  const parsed = JSON.parse(plaintext);
  console.log('✅ Decryption Successful!\n');
  console.log(JSON.stringify(parsed, null, 2));

  // Save decrypted copy alongside
  const outputPath = resolvedPath.replace(/\.json$/, '.decrypted.json');
  fs.writeFileSync(outputPath, JSON.stringify(parsed, null, 2), 'utf-8');
  console.log(`\n📄 Saved decrypted output to: ${outputPath}`);
} catch (err) {
  console.error('❌ Decryption failed. Please verify your passphrase.', err.message);
  process.exit(1);
}
