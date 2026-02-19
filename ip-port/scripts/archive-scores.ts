/**
 * Archive current scoring cache files as a safety net before Phase 1 changes.
 * Creates tarballs of llm-scores, prosecution-scores, and ipr-scores directories.
 *
 * Usage: npx tsx scripts/archive-scores.ts
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(import.meta.dirname, '..');
const CACHE_DIR = path.join(ROOT, 'cache');
const ARCHIVE_DIR = path.join(ROOT, 'archives');

const dateStr = new Date().toISOString().split('T')[0];
const archiveName = `pre-phase1-${dateStr}`;
const archivePath = path.join(ARCHIVE_DIR, archiveName);

const DIRS_TO_ARCHIVE = ['llm-scores', 'prosecution-scores', 'ipr-scores'];

function countFiles(dir: string): number {
  try {
    const result = execSync(`find "${dir}" -type f | wc -l`, { encoding: 'utf-8' });
    return parseInt(result.trim(), 10);
  } catch {
    return 0;
  }
}

function main() {
  console.log(`\n=== Score Archive: ${archiveName} ===\n`);

  // Verify cache dirs exist
  for (const dirName of DIRS_TO_ARCHIVE) {
    const fullPath = path.join(CACHE_DIR, dirName);
    if (!fs.existsSync(fullPath)) {
      console.error(`  Cache directory not found: ${fullPath}`);
      process.exit(1);
    }
    const count = countFiles(fullPath);
    console.log(`  ${dirName}: ${count.toLocaleString()} files`);
  }

  // Create archive directory
  fs.mkdirSync(archivePath, { recursive: true });
  console.log(`\nArchiving to: ${archivePath}\n`);

  for (const dirName of DIRS_TO_ARCHIVE) {
    const srcPath = path.join(CACHE_DIR, dirName);
    const tarFile = path.join(archivePath, `${dirName}.tar.gz`);

    console.log(`  Archiving ${dirName}...`);
    const start = Date.now();

    execSync(`tar -czf "${tarFile}" -C "${CACHE_DIR}" "${dirName}"`, { stdio: 'pipe' });

    const sizeMB = (fs.statSync(tarFile).size / (1024 * 1024)).toFixed(1);
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`    -> ${tarFile} (${sizeMB} MB, ${elapsed}s)`);
  }

  console.log(`\nArchive complete: ${archivePath}\n`);
}

main();
