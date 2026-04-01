#!/usr/bin/env npx tsx
/**
 * Seed QuestionVersion from Template Files
 *
 * Reads all scoring template JSON files and creates v1 QuestionVersion
 * rows for each scope that has questions. Establishes the revAIQ baseline.
 *
 * Safe to re-run — uses syncVersionsFromTemplates which checks existing rows.
 *
 * Run: npx tsx prisma/seed-question-versions.ts
 */

import { syncVersionsFromTemplates } from '../src/api/services/currency-service.js';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Syncing QuestionVersion from template files...\n');

  const result = await syncVersionsFromTemplates();

  console.log(`\nResults:`);
  console.log(`  Created: ${result.created}`);
  console.log(`  Bumped:  ${result.bumped}`);
  console.log(`  Unchanged: ${result.unchanged}`);

  // Show details grouped by level
  const byLevel = new Map<string, typeof result.details>();
  for (const d of result.details) {
    if (!byLevel.has(d.level)) byLevel.set(d.level, []);
    byLevel.get(d.level)!.push(d);
  }

  for (const [level, details] of byLevel) {
    console.log(`\n  ${level} (${details.length}):`);
    for (const d of details) {
      const marker = d.action === 'created' ? '✓ NEW' : d.action === 'bumped' ? '↑ BUMPED' : '  ok';
      console.log(`    ${marker} ${d.scopeId} v${d.version}`);
    }
  }

  // Final count
  const totalVersions = await prisma.questionVersion.count();
  console.log(`\n✓ Total QuestionVersion rows: ${totalVersions}`);
}

main()
  .catch(e => { console.error('Seed failed:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
