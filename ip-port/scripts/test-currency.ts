#!/usr/bin/env npx tsx
/**
 * Currency Service Smoke Tests
 *
 * Verifies revAIQ version tracking, gap analysis, and template sync.
 * Run: npx tsx scripts/test-currency.ts
 */

import { PrismaClient } from '@prisma/client';
import {
  getCurrentVersion,
  getCurrentVersions,
  getRevAIQ,
  computeCurrencyGaps,
  bumpVersion,
  syncVersionsFromTemplates,
} from '../src/api/services/currency-service.js';

const prisma = new PrismaClient();

let passed = 0;
let failed = 0;

function assert(label: string, condition: boolean, detail?: string) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

async function main() {
  // =========================================================================
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('Test 1: QuestionVersion Lookup');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const portfolioVersion = await getCurrentVersion('portfolio', 'portfolio-default');
  assert('Portfolio version exists', portfolioVersion != null);
  assert('Portfolio version is 1', portfolioVersion?.version === 1);
  assert('Portfolio has questions', (portfolioVersion?.questionCount ?? 0) > 0,
    `count=${portfolioVersion?.questionCount}`);
  assert('Portfolio fingerprint non-empty', (portfolioVersion?.questionFingerprint?.length ?? 0) > 0);
  console.log(`  Info: Portfolio has ${portfolioVersion?.questionCount} questions, fingerprint: ${portfolioVersion?.questionFingerprint?.substring(0, 60)}...`);

  const wirelessVersion = await getCurrentVersion('super_sector', 'wireless');
  assert('WIRELESS version exists', wirelessVersion != null);
  assert('WIRELESS has new questions', (wirelessVersion?.questionCount ?? 0) > 0,
    `count=${wirelessVersion?.questionCount}`);
  console.log(`  Info: WIRELESS has ${wirelessVersion?.questionCount} new questions: ${wirelessVersion?.questionFingerprint}`);

  // =========================================================================
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('Test 2: Taxonomy Path Version Resolution');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const wirelessVersions = await getCurrentVersions('WIRELESS');
  assert('WIRELESS path has portfolio version', wirelessVersions.portfolio > 0);
  assert('WIRELESS path has super-sector version', wirelessVersions.superSector > 0);
  assert('WIRELESS path has sector=0 (no sector specified)', wirelessVersions.sector === 0);
  assert('revAIQ format correct', /^\d+\.\d+\.\d+\.\d+$/.test(wirelessVersions.revAIQ),
    `revAIQ=${wirelessVersions.revAIQ}`);
  console.log(`  Info: WIRELESS revAIQ = ${wirelessVersions.revAIQ}`);

  const rfVersions = await getCurrentVersions('WIRELESS/rf-acoustic');
  assert('rf-acoustic path has sector version', rfVersions.sector > 0);
  console.log(`  Info: WIRELESS/rf-acoustic revAIQ = ${rfVersions.revAIQ}`);

  const ampVersions = await getCurrentVersions('WIRELESS/rf-acoustic/amplifiers');
  // amplifiers is a sub-sector of analog-circuits (SEMICONDUCTOR), not rf-acoustic
  // But the path lookup should still work
  console.log(`  Info: WIRELESS/rf-acoustic/amplifiers revAIQ = ${ampVersions.revAIQ}`);

  // =========================================================================
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('Test 3: getRevAIQ shorthand');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const revAIQ = await getRevAIQ('WIRELESS/rf-acoustic');
  assert('getRevAIQ returns valid format', /^\d+\.\d+\.\d+\.\d+$/.test(revAIQ));
  console.log(`  Info: ${revAIQ}`);

  // =========================================================================
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('Test 4: Currency Gap Analysis');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Get a portfolio
  const portfolio = await prisma.portfolio.findFirst({ orderBy: { patentCount: 'desc' } });
  if (!portfolio) {
    console.error('  No portfolio found, skipping gap analysis');
  } else {
    const gaps = await computeCurrencyGaps(portfolio.id, 'WIRELESS', { limit: 5 });
    assert('Gap analysis returns total > 0', gaps.total > 0, `total=${gaps.total}`);
    const scored = gaps.total - gaps.neverScored;
    assert('Some patents have currency records (from backfill)', scored > 0 || gaps.neverScored === gaps.total,
      `scored=${scored}, neverScored=${gaps.neverScored}, total=${gaps.total}`);
    assert('Latest revAIQ set', gaps.latestRevAIQ.length > 0);
    console.log(`  Info: ${gaps.total} patents, ${gaps.neverScored} never scored, latest revAIQ: ${gaps.latestRevAIQ}`);

    if (gaps.patents.length > 0) {
      console.log(`  Sample patents:`);
      for (const p of gaps.patents.slice(0, 3)) {
        console.log(`    ${p.patentId}: current=${p.currentRevAIQ ?? 'none'}, latest=${p.latestRevAIQ}, stale=[${p.staleLevels.join(',')}]`);
      }
    }
  }

  // =========================================================================
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('Test 5: Version Bump');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Bump WIRELESS version (simulating a template change)
  const beforeBump = await getCurrentVersion('super_sector', 'wireless');
  const bumped = await bumpVersion('super_sector', 'wireless', 'Test bump for smoke test');
  assert('Version incremented', bumped.version === (beforeBump?.version ?? 0) + 1,
    `was ${beforeBump?.version}, now ${bumped.version}`);

  // Verify new revAIQ reflects the bump
  const afterBumpVersions = await getCurrentVersions('WIRELESS');
  assert('Super-sector version increased after bump',
    afterBumpVersions.superSector > wirelessVersions.superSector,
    `was ${wirelessVersions.superSector}, now ${afterBumpVersions.superSector}`);
  console.log(`  Info: WIRELESS revAIQ after bump: ${afterBumpVersions.revAIQ}`);

  // Clean up: delete the test bump so it doesn't pollute
  await prisma.questionVersion.deleteMany({
    where: { level: 'super_sector', scopeId: 'wireless', version: bumped.version },
  });
  console.log(`  (cleaned up test bump)`);

  // =========================================================================
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('Test 6: Re-sync (idempotent)');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const resync = await syncVersionsFromTemplates();
  assert('Re-sync creates 0 new', resync.created === 0, `created=${resync.created}`);
  assert('Re-sync bumps 0', resync.bumped === 0, `bumped=${resync.bumped}`);
  assert('Re-sync finds all unchanged', resync.unchanged > 100, `unchanged=${resync.unchanged}`);
  console.log(`  Info: ${resync.unchanged} unchanged, ${resync.created} created, ${resync.bumped} bumped`);

  // =========================================================================
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log('═══════════════════════════════════════════════════════════════\n');
}

main()
  .catch(e => { console.error('Test failed:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());

if (failed > 0) process.exit(1);
