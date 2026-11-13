/**
 * setup-superuser.js — One-time interactive Super User bootstrap.
 *
 * Run once, before the app's first start on a fresh deploy, to create the
 * ONE real Super User account (email + a password you choose right here)
 * instead of the app auto-seeding a fake faculty roster that all shared one
 * known default password. Safe to re-run: if data/members.json already has
 * at least one account, this is a no-op — it never overwrites live data.
 *
 * Also prompts, right after the Super User's email/password, for the
 * DATA_ENCRYPTION_KEY used to encrypt everything on disk — unless one is
 * already configured (.env, .env.local, or the shell environment), in which
 * case it's left untouched. Never overwrites an existing key.
 *
 * Usage:
 *   node scripts/setup-superuser.js
 *
 * (Wired into docs/vps-setup.sh right after .env is configured, and
 * available any time via `npm run setup`.)
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const crypto = require('crypto');

const DATA_DIR = path.join(process.cwd(), 'data');
const MEMBERS_PATH = path.join(DATA_DIR, 'members.json');
const ENV_PATH = path.join(process.cwd(), '.env');
const ENV_EXAMPLE_PATH = path.join(process.cwd(), '.env.example');
const ENCRYPTION_SALT = Buffer.from('LEADS_NEXT_GEN_CENTRE_MSRUAS_SALT_2026', 'utf-8');
const FALLBACK_KEY = 'LEADS_ERP_MASTER_SECRET_KEY_2026';

// --- best-effort .env / .env.local loader (no dependency, mirrors what
// Next.js itself loads at runtime, so this script's DATA_ENCRYPTION_KEY
// matches whatever the app will actually decrypt data/members.json with) ---
function loadDotEnv(filename) {
  const p = path.join(process.cwd(), filename);
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key && !(key in process.env)) process.env[key] = value;
  }
}
loadDotEnv('.env');
loadDotEnv('.env.local');

// Mutable: resolveOrSetEncryptionKey() below may set this to a key the
// operator just chose, before encryptData()/decryptData() are ever called.
let MASTER_KEY = process.env.DATA_ENCRYPTION_KEY || FALLBACK_KEY;

// --- same algorithms as src/lib/password.ts and src/lib/encryption.ts,
// duplicated here (not imported) since this plain script runs with no
// build step, before the TypeScript app is ever compiled ---
function hashPassword(plain) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(plain, salt, 64).toString('hex');
  return salt + ':' + derived;
}

function encryptData(text) {
  const key = crypto.pbkdf2Sync(MASTER_KEY, ENCRYPTION_SALT, 100000, 32, 'sha256');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let ciphertext = cipher.update(text, 'utf-8', 'hex');
  ciphertext += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return { _encrypted: true, algorithm: 'aes-256-gcm', iv: iv.toString('hex'), authTag: authTag, ciphertext: ciphertext };
}

function decryptData(payload) {
  const key = crypto.pbkdf2Sync(MASTER_KEY, ENCRYPTION_SALT, 100000, 32, 'sha256');
  const iv = Buffer.from(payload.iv, 'hex');
  const authTag = Buffer.from(payload.authTag, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  let plaintext = decipher.update(payload.ciphertext, 'hex', 'utf-8');
  plaintext += decipher.final('utf-8');
  return plaintext;
}

function existingMemberCount() {
  if (!fs.existsSync(MEMBERS_PATH)) return 0;
  try {
    const raw = fs.readFileSync(MEMBERS_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    const isEncrypted = parsed && parsed._encrypted === true && typeof parsed.ciphertext === 'string';
    const arr = isEncrypted ? JSON.parse(decryptData(parsed)) : parsed;
    return Array.isArray(arr) ? arr.length : 0;
  } catch (err) {
    console.error('\nCould not read/decrypt the existing data/members.json (' + err.message + ').');
    console.error('Refusing to touch it — resolve that manually before re-running this script.');
    process.exit(1);
  }
}

function ask(rl, question) {
  return new Promise(function (resolve) {
    rl.question(question, function (answer) { resolve(answer); });
  });
}

/** Appends/replaces DATA_ENCRYPTION_KEY in .env, creating it from
 * .env.example (or from scratch) first if .env doesn't exist yet. */
function writeEncryptionKeyToEnv(key) {
  if (!fs.existsSync(ENV_PATH)) {
    if (fs.existsSync(ENV_EXAMPLE_PATH)) {
      fs.copyFileSync(ENV_EXAMPLE_PATH, ENV_PATH);
    } else {
      fs.writeFileSync(ENV_PATH, '', 'utf-8');
    }
  }
  let content = fs.readFileSync(ENV_PATH, 'utf-8');
  if (/^DATA_ENCRYPTION_KEY=.*$/m.test(content)) {
    content = content.replace(/^DATA_ENCRYPTION_KEY=.*$/m, 'DATA_ENCRYPTION_KEY=' + key);
  } else {
    if (content.length && !content.endsWith('\n')) content += '\n';
    content += '\nDATA_ENCRYPTION_KEY=' + key + '\n';
  }
  fs.writeFileSync(ENV_PATH, content, 'utf-8');
}

/**
 * If DATA_ENCRYPTION_KEY is already set (via .env, .env.local, or the shell
 * environment), leaves it alone — changing it would silently make every
 * already-encrypted record unreadable. Otherwise asks the operator to set
 * one now, before it's ever used to encrypt anything, rather than quietly
 * falling back to the fallback key published in this project's own source.
 */
async function resolveOrSetEncryptionKey(rl) {
  if (process.env.DATA_ENCRYPTION_KEY) {
    console.log('Using the DATA_ENCRYPTION_KEY already configured in your environment — leaving it as is.\n');
    return;
  }

  console.log('\n--- Data encryption key ---');
  console.log('No DATA_ENCRYPTION_KEY is set yet. This is the key that encrypts every record this');
  console.log('app stores on disk — leaving it unset falls back to a key published in this project\'s');
  console.log('own source code, which is NOT safe for real data.\n');
  const choice = (await ask(rl, 'Press Enter to generate a strong random key (recommended), or paste your own: ')).trim();
  const key = choice || crypto.randomBytes(32).toString('hex');

  writeEncryptionKeyToEnv(key);
  MASTER_KEY = key;
  process.env.DATA_ENCRYPTION_KEY = key;

  console.log(choice ? '\nSaved your key to .env.' : '\nGenerated a new key and saved it to .env.');
  console.log('\n⚠️  SAVE THIS KEY SOMEWHERE OTHER THAN THIS SERVER — it is the only way to decrypt this');
  console.log('   data if this disk is ever lost. The app will never show it to you again:');
  console.log('   DATA_ENCRYPTION_KEY=' + key + '\n');
}

// Control bytes as \u escapes:
// Enter is handled via '\n'/'\r'; Ctrl+C is ETX (\u0003); backspace is
// either BS (\u0008) or DEL (\u007F) depending on the terminal.
var CTRL_C = '\u0003';
var BACKSPACE_CHARS = ['\u0008', '\u007F'];

/** Prompts for a password without echoing it to the terminal. */
function askPassword(question) {
  return new Promise(function (resolve) {
    process.stdout.write(question);
    var input = '';
    // A single 'data' chunk is NOT guaranteed to be one keystroke — fast
    // typing, a pasted password, or (as caught in testing) any bulk write
    // can deliver several characters in one chunk, so each one is walked
    // individually rather than treating the whole chunk as a unit.
    function onData(chunk) {
      var text = chunk.toString('utf-8');
      for (var i = 0; i < text.length; i++) {
        var char = text[i];
        if (char === '\n' || char === '\r') {
          process.stdin.removeListener('data', onData);
          process.stdin.setRawMode(false);
          process.stdout.write('\n');
          resolve(input);
          return;
        }
        if (char === CTRL_C) {
          process.stdout.write('\n');
          process.exit(130);
          return;
        }
        if (BACKSPACE_CHARS.indexOf(char) !== -1) {
          input = input.slice(0, -1);
          continue;
        }
        input += char;
      }
    }
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', onData);
  });
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function main() {
  const existing = existingMemberCount();
  if (existing > 0) {
    console.log('\nMembers already configured (' + existing + ' account' + (existing === 1 ? '' : 's') + ' in data/members.json) — skipping Super User setup.');
    console.log('This script only runs on a fresh install. Manage accounts from the Directory once logged in.\n');
    return;
  }

  if (!process.stdin.isTTY) {
    console.error('\nThis needs an interactive terminal to prompt for the Super User\'s email and password.');
    console.error('Run it directly: node scripts/setup-superuser.js\n');
    process.exit(1);
  }

  console.log('\n=== LEADS Dashboard — Super User Setup ===');
  console.log('No accounts exist yet on this instance. Create the one real Super User account below.');
  console.log('Everyone else gets added from the Directory after you log in.\n');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  let name = '';
  while (!name) {
    name = (await ask(rl, 'Full name: ')).trim();
  }

  let email = '';
  while (!EMAIL_RE.test(email)) {
    email = (await ask(rl, 'Email address: ')).trim().toLowerCase();
    if (!EMAIL_RE.test(email)) console.log('  Enter a valid email address (e.g. you@example.com).');
  }

  // Close readline's own stdin listeners before switching to manual raw-mode
  // reads for the password — leaving both attached at once means every
  // keystroke gets fought over by two different consumers of stdin.
  rl.close();

  let password = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    const first = await askPassword('Password (min 8 characters): ');
    if (first.length < 8) {
      console.log('  Too short — use at least 8 characters.');
      continue;
    }
    const confirm = await askPassword('Confirm password: ');
    if (first !== confirm) {
      console.log('  Passwords did not match — try again.');
      continue;
    }
    password = first;
    break;
  }

  if (process.stdin.isTTY) process.stdin.setRawMode(false);

  if (!password) {
    console.error('\nGave up after 3 attempts without a matching password. Re-run this script to try again.\n');
    process.exit(1);
  }

  // Asked last, right before it's actually needed to encrypt anything —
  // reuses process.env.DATA_ENCRYPTION_KEY (via loadDotEnv above) if one is
  // already configured, and only prompts when nothing is set yet.
  const rl2 = readline.createInterface({ input: process.stdin, output: process.stdout });
  await resolveOrSetEncryptionKey(rl2);
  rl2.close();

  const superUser = {
    id: 'm1',
    name: name,
    email: email,
    role: 'Super User',
    tier: 1,
    division: 'Core Committee',
    passwordHash: hashPassword(password),
  };

  fs.mkdirSync(DATA_DIR, { recursive: true });
  const encrypted = encryptData(JSON.stringify([superUser]));
  fs.writeFileSync(MEMBERS_PATH, JSON.stringify(encrypted, null, 2), 'utf-8');

  console.log('\n✅ Super User account created.');
  console.log('   Name:  ' + name);
  console.log('   Email: ' + email);
  console.log('This is the ONLY account on this instance — sign in with it, then add everyone else from the Directory.\n');
}

main().catch(function (err) {
  console.error('\nSetup failed:', err.message);
  process.exit(1);
});
