/**
 * Migration script: Load patent data from JSON + cache files into Postgres
 *
 * Idempotent — uses upserts throughout so it can be re-run safely.
 *
 * Expected volumes:
 * - Patent: ~29k rows (from candidates JSON)
 * - PatentCpc: ~60k rows
 * - PatentCitationAnalysis: ~29k rows
 * - PatentProsecution: ~11k rows
 * - PatentScore: ~250k rows (from LLM scores cache)
 * - PatentCompositeScore: ~36k rows (from V2/V3 snapshots)
 * - PortfolioPatent: ~29k rows (Broadcom portfolio linkage)
 *
 * Usage: npx tsx prisma/migrate-patents-to-postgres.ts
 */

import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();
const ROOT = process.cwd();

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function readJsonFile(filePath: string): any | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

function listJsonFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.endsWith('.json'));
}

function elapsed(start: number): string {
  return `${((Date.now() - start) / 1000).toFixed(1)}s`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 1: Load candidates JSON → Patent rows + PatentCpc rows
// ─────────────────────────────────────────────────────────────────────────────

async function migratePatentsFromCandidates(): Promise<Set<string>> {
  console.log('\n═══ Step 1: Patents from candidates JSON ═══');
  const start = Date.now();

  // Find latest candidates file
  const outputDir = path.join(ROOT, 'output');
  const files = fs.readdirSync(outputDir)
    .filter(f => f.startsWith('streaming-candidates-') && f.endsWith('.json'))
    .sort()
    .reverse();

  if (files.length === 0) {
    console.log('  No candidates file found, skipping');
    return new Set();
  }

  const filePath = path.join(outputDir, files[0]);
  console.log(`  Source: ${files[0]}`);
  const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  const candidates: any[] = data.candidates;
  console.log(`  Candidates: ${candidates.length}`);

  const patentIds = new Set<string>();
  const BATCH = 500;

  for (let i = 0; i < candidates.length; i += BATCH) {
    const batch = candidates.slice(i, i + BATCH);

    // Upsert patents
    await prisma.$transaction(
      batch.map((c: any) => {
        const pid = String(c.patent_id);
        patentIds.add(pid);

        return prisma.patent.upsert({
          where: { patentId: pid },
          create: {
            patentId: pid,
            title: c.patent_title || '',
            grantDate: c.patent_date || null,
            assignee: c.assignee || '',
            forwardCitations: c.forward_citations || 0,
            remainingYears: c.remaining_years ?? null,
            isExpired: (c.remaining_years ?? 0) <= 0,
            baseScore: c.score ?? null,
            affiliate: null, // Will be set by normalizer if needed
            superSector: c.super_sector || null,
            primarySector: c.primary_sector || c.sector || null,
            primaryCpc: c.primary_cpc || null,
            primarySubSectorId: c.primary_sub_sector_id || null,
            primarySubSectorName: c.primary_sub_sector_name || null,
          },
          update: {
            title: c.patent_title || '',
            grantDate: c.patent_date || null,
            assignee: c.assignee || '',
            forwardCitations: c.forward_citations || 0,
            remainingYears: c.remaining_years ?? null,
            isExpired: (c.remaining_years ?? 0) <= 0,
            baseScore: c.score ?? null,
            superSector: c.super_sector || null,
            primarySector: c.primary_sector || c.sector || null,
            primaryCpc: c.primary_cpc || null,
            primarySubSectorId: c.primary_sub_sector_id || null,
            primarySubSectorName: c.primary_sub_sector_name || null,
          },
        });
      })
    );

    if ((i + BATCH) % 5000 === 0 || i + BATCH >= candidates.length) {
      console.log(`  Patents: ${Math.min(i + BATCH, candidates.length)}/${candidates.length} (${elapsed(start)})`);
    }
  }

  // CPC codes
  console.log('  Loading CPC codes...');
  const cpcStart = Date.now();
  let cpcCount = 0;

  for (let i = 0; i < candidates.length; i += BATCH) {
    const batch = candidates.slice(i, i + BATCH);
    const cpcOps: any[] = [];

    for (const c of batch) {
      const pid = String(c.patent_id);
      const inventiveSet = new Set((c.inventive_cpc_codes || []).map((s: string) => s.toUpperCase()));

      // Use cpc_with_designation if available, fall back to cpc_codes
      const codes: Array<{ code: string; isInventive: boolean }> = [];

      if (c.cpc_with_designation?.length) {
        for (const cwd of c.cpc_with_designation) {
          codes.push({
            code: cwd.code,
            isInventive: cwd.designation === 'I',
          });
        }
      } else if (c.cpc_codes?.length) {
        for (const code of c.cpc_codes) {
          codes.push({
            code,
            isInventive: inventiveSet.has(code.toUpperCase()),
          });
        }
      }

      for (const { code, isInventive } of codes) {
        cpcOps.push(
          prisma.patentCpc.upsert({
            where: { patentId_cpcCode: { patentId: pid, cpcCode: code } },
            create: { patentId: pid, cpcCode: code, isInventive },
            update: { isInventive },
          })
        );
      }
    }

    if (cpcOps.length > 0) {
      await prisma.$transaction(cpcOps);
      cpcCount += cpcOps.length;
    }

    if ((i + BATCH) % 5000 === 0 || i + BATCH >= candidates.length) {
      console.log(`  CPC codes: batch ${Math.min(i + BATCH, candidates.length)}/${candidates.length}, total ops: ${cpcCount} (${elapsed(cpcStart)})`);
    }
  }

  console.log(`  ✓ Patents: ${patentIds.size}, CPC codes: ${cpcCount} (${elapsed(start)})`);
  return patentIds;
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 2: Citation classifications → PatentCitationAnalysis
// ─────────────────────────────────────────────────────────────────────────────

async function migrateCitationClassifications(validPatentIds: Set<string>): Promise<void> {
  console.log('\n═══ Step 2: Citation classifications ═══');
  const start = Date.now();

  const dir = path.join(ROOT, 'cache/citation-classification');
  const files = listJsonFiles(dir);
  console.log(`  Files found: ${files.length}`);

  let imported = 0;
  let skipped = 0;
  const BATCH = 500;

  for (let i = 0; i < files.length; i += BATCH) {
    const batch = files.slice(i, i + BATCH);
    const ops: any[] = [];

    for (const file of batch) {
      const data = readJsonFile(path.join(dir, file));
      if (!data?.patent_id) continue;

      const pid = String(data.patent_id);
      if (!validPatentIds.has(pid)) { skipped++; continue; }

      const cc = data.competitor_citations ?? 0;
      const nc = data.neutral_citations ?? 0;
      const ac = data.affiliate_citations ?? 0;
      const adjustedFwd = Math.round((cc * 1.5 + nc * 1.0 + ac * 0.25) * 100) / 100;
      const density = (cc + nc) > 0 ? Math.round(cc / (cc + nc) * 1000) / 1000 : 0;

      ops.push(
        prisma.patentCitationAnalysis.upsert({
          where: { patentId: pid },
          create: {
            patentId: pid,
            competitorCitations: cc,
            affiliateCitations: ac,
            neutralCitations: nc,
            competitorNames: data.competitor_names || [],
            adjustedForwardCitations: adjustedFwd,
            competitorDensity: density,
          },
          update: {
            competitorCitations: cc,
            affiliateCitations: ac,
            neutralCitations: nc,
            competitorNames: data.competitor_names || [],
            adjustedForwardCitations: adjustedFwd,
            competitorDensity: density,
          },
        })
      );
    }

    if (ops.length > 0) {
      await prisma.$transaction(ops);
      imported += ops.length;
    }

    if ((i + BATCH) % 5000 === 0 || i + BATCH >= files.length) {
      console.log(`  Progress: ${Math.min(i + BATCH, files.length)}/${files.length}, imported: ${imported} (${elapsed(start)})`);
    }
  }

  // Update hasCitationData flag
  await prisma.$executeRaw`
    UPDATE patents SET has_citation_data = true
    WHERE patent_id IN (SELECT patent_id FROM patent_citation_analyses)
  `;

  console.log(`  ✓ Imported: ${imported}, Skipped (not in portfolio): ${skipped} (${elapsed(start)})`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 3: LLM scores → PatentScore (EAV rows)
// ─────────────────────────────────────────────────────────────────────────────

// Fields from LLM cache that become rating (integer 1-5)
const RATING_FIELDS = [
  'eligibility_score', 'validity_score', 'claim_breadth', 'claim_clarity_score',
  'enforcement_clarity', 'design_around_difficulty', 'evidence_accessibility_score',
  'market_relevance_score', 'trend_alignment_score', 'investigation_priority_score',
  'confidence',
];

// Fields that become textValue
const TEXT_FIELDS = [
  'technology_category', 'implementation_type', 'standards_relevance',
  'market_segment', 'detection_method', 'implementation_complexity',
  'claim_type_primary', 'geographic_scope', 'lifecycle_stage',
];

// Fields that become long text (reasoning-like)
const LONG_TEXT_FIELDS = [
  'summary', 'prior_art_problem', 'technical_solution',
];

// Computed sub-scores → floatValue
const FLOAT_FIELDS = [
  'legal_viability_score', 'enforcement_potential_score', 'market_value_score',
];

const DISPLAY_NAMES: Record<string, string> = {
  eligibility_score: 'Eligibility Score',
  validity_score: 'Validity Score',
  claim_breadth: 'Claim Breadth',
  claim_clarity_score: 'Claim Clarity',
  enforcement_clarity: 'Enforcement Clarity',
  design_around_difficulty: 'Design-Around Difficulty',
  evidence_accessibility_score: 'Evidence Accessibility',
  market_relevance_score: 'Market Relevance',
  trend_alignment_score: 'Trend Alignment',
  investigation_priority_score: 'Investigation Priority',
  confidence: 'Confidence',
  technology_category: 'Technology Category',
  implementation_type: 'Implementation Type',
  standards_relevance: 'Standards Relevance',
  market_segment: 'Market Segment',
  detection_method: 'Detection Method',
  implementation_complexity: 'Implementation Complexity',
  claim_type_primary: 'Claim Type (Primary)',
  geographic_scope: 'Geographic Scope',
  lifecycle_stage: 'Lifecycle Stage',
  summary: 'LLM Summary',
  prior_art_problem: 'Prior Art Problem',
  technical_solution: 'Technical Solution',
  legal_viability_score: 'Legal Viability Score',
  enforcement_potential_score: 'Enforcement Potential Score',
  market_value_score: 'Market Value Score',
};

async function migrateLlmScores(validPatentIds: Set<string>): Promise<void> {
  console.log('\n═══ Step 3: LLM scores → PatentScore (EAV) ═══');
  const start = Date.now();

  const dir = path.join(ROOT, 'cache/llm-scores');
  const files = listJsonFiles(dir);
  console.log(`  Files found: ${files.length}`);

  let imported = 0;
  let skipped = 0;
  const BATCH = 200; // Smaller batch since each patent produces ~25 rows

  for (let i = 0; i < files.length; i += BATCH) {
    const batch = files.slice(i, i + BATCH);
    const ops: any[] = [];

    for (const file of batch) {
      const data = readJsonFile(path.join(dir, file));
      if (!data?.patent_id) continue;

      const pid = String(data.patent_id);
      if (!validPatentIds.has(pid)) { skipped++; continue; }

      const source = data.source || 'imported';

      // Rating fields (integer 1-5)
      for (const field of RATING_FIELDS) {
        if (data[field] != null) {
          ops.push(
            prisma.patentScore.upsert({
              where: { patentId_fieldName: { patentId: pid, fieldName: field } },
              create: {
                patentId: pid,
                fieldName: field,
                displayName: DISPLAY_NAMES[field] || field,
                rating: Math.round(Number(data[field])),
                source,
              },
              update: {
                rating: Math.round(Number(data[field])),
                displayName: DISPLAY_NAMES[field] || field,
              },
            })
          );
        }
      }

      // Text fields
      for (const field of TEXT_FIELDS) {
        if (data[field]) {
          ops.push(
            prisma.patentScore.upsert({
              where: { patentId_fieldName: { patentId: pid, fieldName: field } },
              create: {
                patentId: pid,
                fieldName: field,
                displayName: DISPLAY_NAMES[field] || field,
                textValue: String(data[field]),
                source,
              },
              update: {
                textValue: String(data[field]),
                displayName: DISPLAY_NAMES[field] || field,
              },
            })
          );
        }
      }

      // Long text fields (stored as reasoning for mouseover display)
      for (const field of LONG_TEXT_FIELDS) {
        if (data[field]) {
          ops.push(
            prisma.patentScore.upsert({
              where: { patentId_fieldName: { patentId: pid, fieldName: field } },
              create: {
                patentId: pid,
                fieldName: field,
                displayName: DISPLAY_NAMES[field] || field,
                reasoning: String(data[field]),
                source,
              },
              update: {
                reasoning: String(data[field]),
                displayName: DISPLAY_NAMES[field] || field,
              },
            })
          );
        }
      }

      // Float fields (computed sub-scores)
      for (const field of FLOAT_FIELDS) {
        if (data[field] != null) {
          ops.push(
            prisma.patentScore.upsert({
              where: { patentId_fieldName: { patentId: pid, fieldName: field } },
              create: {
                patentId: pid,
                fieldName: field,
                displayName: DISPLAY_NAMES[field] || field,
                floatValue: Number(data[field]),
                source,
              },
              update: {
                floatValue: Number(data[field]),
                displayName: DISPLAY_NAMES[field] || field,
              },
            })
          );
        }
      }
    }

    if (ops.length > 0) {
      // Transaction might be large, split if needed
      const TX_LIMIT = 1000;
      for (let j = 0; j < ops.length; j += TX_LIMIT) {
        await prisma.$transaction(ops.slice(j, j + TX_LIMIT));
      }
      imported += ops.length;
    }

    if ((i + BATCH) % 2000 === 0 || i + BATCH >= files.length) {
      console.log(`  Progress: ${Math.min(i + BATCH, files.length)}/${files.length}, score rows: ${imported} (${elapsed(start)})`);
    }
  }

  // Update hasLlmData flag
  await prisma.$executeRaw`
    UPDATE patents SET has_llm_data = true
    WHERE patent_id IN (SELECT DISTINCT patent_id FROM patent_scores WHERE source != 'calculated')
  `;

  console.log(`  ✓ Score rows: ${imported}, Skipped patents: ${skipped} (${elapsed(start)})`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 4: Prosecution data → PatentProsecution
// ─────────────────────────────────────────────────────────────────────────────

async function migrateProsecutionData(validPatentIds: Set<string>): Promise<void> {
  console.log('\n═══ Step 4: Prosecution data ═══');
  const start = Date.now();

  const dir = path.join(ROOT, 'cache/prosecution-scores');
  const files = listJsonFiles(dir);
  console.log(`  Files found: ${files.length}`);

  let imported = 0;
  let skipped = 0;
  const BATCH = 500;

  for (let i = 0; i < files.length; i += BATCH) {
    const batch = files.slice(i, i + BATCH);
    const ops: any[] = [];

    for (const file of batch) {
      const data = readJsonFile(path.join(dir, file));
      if (!data?.patent_id) continue;

      const pid = String(data.patent_id);
      if (!validPatentIds.has(pid)) { skipped++; continue; }
      if (data.error) { skipped++; continue; }

      ops.push(
        prisma.patentProsecution.upsert({
          where: { patentId: pid },
          create: {
            patentId: pid,
            applicationNumber: data.application_number || null,
            officeActionsCount: data.office_actions_count || 0,
            nonFinalRejections: data.non_final_rejections || 0,
            finalRejections: data.final_rejections || 0,
            allowances: data.allowances || 0,
            prosecutionQualityScore: data.prosecution_quality_score ?? null,
            prosecutionCategory: data.prosecution_quality_category || null,
          },
          update: {
            applicationNumber: data.application_number || null,
            officeActionsCount: data.office_actions_count || 0,
            nonFinalRejections: data.non_final_rejections || 0,
            finalRejections: data.final_rejections || 0,
            allowances: data.allowances || 0,
            prosecutionQualityScore: data.prosecution_quality_score ?? null,
            prosecutionCategory: data.prosecution_quality_category || null,
          },
        })
      );
    }

    if (ops.length > 0) {
      await prisma.$transaction(ops);
      imported += ops.length;
    }

    if ((i + BATCH) % 5000 === 0 || i + BATCH >= files.length) {
      console.log(`  Progress: ${Math.min(i + BATCH, files.length)}/${files.length}, imported: ${imported} (${elapsed(start)})`);
    }
  }

  // Update hasProsecutionData flag
  await prisma.$executeRaw`
    UPDATE patents SET has_prosecution_data = true
    WHERE patent_id IN (SELECT patent_id FROM patent_prosecution)
  `;

  console.log(`  ✓ Imported: ${imported}, Skipped: ${skipped} (${elapsed(start)})`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 5: V2/V3 snapshots → PatentCompositeScore
// ─────────────────────────────────────────────────────────────────────────────

async function migrateCompositeScores(validPatentIds: Set<string>): Promise<void> {
  console.log('\n═══ Step 5: V2/V3 snapshot scores → PatentCompositeScore ═══');
  const start = Date.now();

  // Find active V2 and V3 snapshots
  const activeSnapshots = await prisma.scoreSnapshot.findMany({
    where: { isActive: true },
    select: { id: true, scoreType: true, name: true, config: true },
  });

  for (const snapshot of activeSnapshots) {
    const scoreName = snapshot.scoreType === 'V2' ? 'v2_score' : snapshot.scoreType === 'V3' ? 'v3_score' : `${snapshot.scoreType.toLowerCase()}_score`;

    console.log(`  Processing ${snapshot.scoreType} snapshot: ${snapshot.name}`);

    const entries = await prisma.patentScoreEntry.findMany({
      where: { snapshotId: snapshot.id },
      select: { patentId: true, score: true, rank: true },
    });

    console.log(`  Entries: ${entries.length}`);

    const BATCH = 500;
    let imported = 0;

    for (let i = 0; i < entries.length; i += BATCH) {
      const batch = entries.slice(i, i + BATCH);
      const ops = batch
        .filter(e => validPatentIds.has(String(e.patentId)))
        .map(e => {
          const pid = String(e.patentId);
          return prisma.patentCompositeScore.upsert({
            where: { patentId_scoreName: { patentId: pid, scoreName } },
            create: {
              patentId: pid,
              scoreName,
              value: e.score,
              rank: e.rank,
              config: snapshot.config as any,
            },
            update: {
              value: e.score,
              rank: e.rank,
              config: snapshot.config as any,
            },
          });
        });

      if (ops.length > 0) {
        await prisma.$transaction(ops);
        imported += ops.length;
      }
    }

    console.log(`  ✓ ${snapshot.scoreType}: ${imported} composite scores`);
  }

  console.log(`  Done (${elapsed(start)})`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 6: Chelsio PortfolioPatent → create Patent rows for missing patents
// ─────────────────────────────────────────────────────────────────────────────

async function migrateChelsioPatents(): Promise<void> {
  console.log('\n═══ Step 6: Ensure Patent rows exist for all PortfolioPatent records ═══');
  const start = Date.now();

  // Get all PortfolioPatent entries
  const ppRecords = await prisma.portfolioPatent.findMany({
    select: { patentId: true },
  });

  const ppIds = [...new Set(ppRecords.map(r => r.patentId))];
  console.log(`  PortfolioPatent records: ${ppRecords.length}, unique patent IDs: ${ppIds.length}`);

  // Check which ones already have Patent rows
  const existingPatents = await prisma.patent.findMany({
    where: { patentId: { in: ppIds } },
    select: { patentId: true },
  });
  const existingSet = new Set(existingPatents.map(p => p.patentId));

  const missing = ppIds.filter(id => !existingSet.has(id));
  console.log(`  Missing Patent rows: ${missing.length}`);

  if (missing.length > 0) {
    // Create minimal Patent rows for these
    await prisma.$transaction(
      missing.map(pid =>
        prisma.patent.upsert({
          where: { patentId: pid },
          create: {
            patentId: pid,
            title: '',
            assignee: '',
          },
          update: {},
        })
      )
    );
    console.log(`  Created ${missing.length} Patent rows for orphan PortfolioPatent records`);
  }

  console.log(`  ✓ Done (${elapsed(start)})`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 7: Link Broadcom portfolio → PortfolioPatent join records
// ─────────────────────────────────────────────────────────────────────────────

async function linkBroadcomPortfolio(validPatentIds: Set<string>): Promise<void> {
  console.log('\n═══ Step 7: Link Broadcom portfolio ═══');
  const start = Date.now();

  // Find broadcom-core portfolio
  const broadcom = await prisma.portfolio.findUnique({
    where: { name: 'broadcom-core' },
    select: { id: true },
  });

  if (!broadcom) {
    console.log('  No broadcom-core portfolio found, skipping');
    return;
  }

  console.log(`  Portfolio ID: ${broadcom.id}`);
  console.log(`  Patents to link: ${validPatentIds.size}`);

  // Check existing links
  const existing = await prisma.portfolioPatent.count({
    where: { portfolioId: broadcom.id },
  });
  console.log(`  Existing links: ${existing}`);

  if (existing >= validPatentIds.size * 0.9) {
    console.log('  Already mostly linked, skipping');
    return;
  }

  const ids = [...validPatentIds];
  const BATCH = 500;
  let created = 0;

  for (let i = 0; i < ids.length; i += BATCH) {
    const batch = ids.slice(i, i + BATCH);

    const ops = batch.map(pid =>
      prisma.portfolioPatent.upsert({
        where: { portfolioId_patentId: { portfolioId: broadcom.id, patentId: pid } },
        create: {
          portfolioId: broadcom.id,
          patentId: pid,
          source: 'CANDIDATES_FILE',
        },
        update: {},
      })
    );

    await prisma.$transaction(ops);
    created += ops.length;

    if ((i + BATCH) % 5000 === 0 || i + BATCH >= ids.length) {
      console.log(`  Progress: ${Math.min(i + BATCH, ids.length)}/${ids.length} (${elapsed(start)})`);
    }
  }

  // Update patent count
  const totalCount = await prisma.portfolioPatent.count({
    where: { portfolioId: broadcom.id },
  });
  await prisma.portfolio.update({
    where: { id: broadcom.id },
    data: { patentCount: totalCount },
  });

  console.log(`  ✓ Linked ${created} patents, total: ${totalCount} (${elapsed(start)})`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('╔═══════════════════════════════════════════════════════╗');
  console.log('║  Patent Data Migration → Postgres                    ║');
  console.log('╚═══════════════════════════════════════════════════════╝');
  const start = Date.now();

  // Step 1: Candidates JSON → Patent + PatentCpc
  const validPatentIds = await migratePatentsFromCandidates();

  // Step 6 (early): Ensure Chelsio patents exist before FK linkage
  await migrateChelsioPatents();

  // Step 2: Citation classifications
  await migrateCitationClassifications(validPatentIds);

  // Step 3: LLM scores (largest — ~250k rows)
  await migrateLlmScores(validPatentIds);

  // Step 4: Prosecution data
  await migrateProsecutionData(validPatentIds);

  // Step 5: V2/V3 composite scores
  await migrateCompositeScores(validPatentIds);

  // Step 7: Link Broadcom portfolio
  await linkBroadcomPortfolio(validPatentIds);

  // Final summary
  const [patentCount, cpcCount, citationCount, prosCount, scoreCount, compositeCount, ppCount] = await Promise.all([
    prisma.patent.count(),
    prisma.patentCpc.count(),
    prisma.patentCitationAnalysis.count(),
    prisma.patentProsecution.count(),
    prisma.patentScore.count(),
    prisma.patentCompositeScore.count(),
    prisma.portfolioPatent.count(),
  ]);

  console.log('\n╔═══════════════════════════════════════════════════════╗');
  console.log('║  Migration Complete                                   ║');
  console.log('╠═══════════════════════════════════════════════════════╣');
  console.log(`║  Patent:                ${String(patentCount).padStart(8)}                      ║`);
  console.log(`║  PatentCpc:             ${String(cpcCount).padStart(8)}                      ║`);
  console.log(`║  PatentCitationAnalysis:${String(citationCount).padStart(8)}                      ║`);
  console.log(`║  PatentProsecution:     ${String(prosCount).padStart(8)}                      ║`);
  console.log(`║  PatentScore:           ${String(scoreCount).padStart(8)}                      ║`);
  console.log(`║  PatentCompositeScore:  ${String(compositeCount).padStart(8)}                      ║`);
  console.log(`║  PortfolioPatent:       ${String(ppCount).padStart(8)}                      ║`);
  console.log(`║  Total time:         ${elapsed(start).padStart(10)}                      ║`);
  console.log('╚═══════════════════════════════════════════════════════╝');

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('Migration failed:', err);
  await prisma.$disconnect();
  process.exit(1);
});
