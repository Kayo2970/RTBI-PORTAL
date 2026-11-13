/**
 * scripts/wipe-data.js — Clean wipe of all application memory, collections, and uploads.
 *
 * Usage:
 *   node scripts/wipe-data.js
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(process.cwd(), 'data');

function wipe() {
  console.log('\n=========================================');
  console.log('   RTBI PORTAL — DATA & MEMORY PURGE');
  console.log('=========================================\n');

  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    console.log('[+] Created clean data directory.');
    return;
  }

  // 1. Remove all collection files, backups, and metadata
  const entries = fs.readdirSync(DATA_DIR);
  let filesRemoved = 0;

  for (const entry of entries) {
    const fullPath = path.join(DATA_DIR, entry);
    try {
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        fs.rmSync(fullPath, { recursive: true, force: true });
        console.log(`[-] Removed directory: data/${entry}`);
      } else {
        fs.unlinkSync(fullPath);
        filesRemoved++;
      }
    } catch (err) {
      console.warn(`[!] Warning: Could not remove data/${entry}:`, err.message);
    }
  }

  console.log(`[-] Removed ${filesRemoved} collection/database files from data/.`);

  // 2. Remove any legacy database files in root or data
  const legacyFiles = [
    'data.pre-restore',
    'database.json',
    'database.json.migrated',
  ];
  for (const lf of legacyFiles) {
    const p = path.join(DATA_DIR, lf);
    if (fs.existsSync(p)) {
      try {
        fs.rmSync(p, { recursive: true, force: true });
      } catch (_) {}
    }
  }

  console.log('\n[OK] Clean wipe completed successfully.');
  console.log('[*] All members, events, tasks, uploads, and sessions have been cleared.');
  console.log('[*] Next startup will prompt for initial Super User setup at /setup.\n');
}

wipe();
