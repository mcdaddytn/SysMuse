/**
 * Run Sector-Based LLM Scoring
 *
 * Replacement for run-llm-analysis-v3.ts — uses the correct template-based
 * pipeline (llm-scoring-service) with claims, hierarchical templates, and
 * direct DB persistence via savePatentScore().
 *
 * Usage (called by batch-jobs system):
 *   npx tsx scripts/run-sector-scoring.ts <batchFile> [--model <model>]
 *
 * Environment variables:
 *   LLM_MODEL — override scoring model (e.g., claude-sonnet-4-20250514)
 */

import * as fs from 'fs';
import * as dotenv from 'dotenv';
dotenv.config();

import { PrismaClient } from '@prisma/client';
import {
  scorePatentBatch,
  PatentForScoring,
  DEFAULT_CONTEXT_OPTIONS,
} from '../src/api/services/llm-scoring-service.js';
import {
  getMergedTemplateForSector,
  getMergedTemplateForSubSector,
  loadSubSectorTemplates,
  matchSubSectorTemplate,
} from '../src/api/services/scoring-template-service.js';

const prisma = new PrismaClient();

function parseArgs(): { batchFile: string; model: string; concurrency: number } {
  const args = process.argv.slice(2);

  // Find batch file (first non-flag argument)
  const batchFile = args.find(arg => !arg.startsWith('--'));
  if (!batchFile) {
    console.error('Usage: npx tsx scripts/run-sector-scoring.ts <batchFile> [--model <model>] [--concurrency <n>]');
    process.exit(1);
  }

  // Parse --model flag or use env var
  let model = process.env.LLM_MODEL || 'claude-sonnet-4-20250514';
  const modelIdx = args.indexOf('--model');
  if (modelIdx !== -1 && args[modelIdx + 1]) {
    model = args[modelIdx + 1];
  }

  // Parse --concurrency flag or use env var (default: 3)
  let concurrency = parseInt(process.env.LLM_CONCURRENCY || '3', 10);
  const concIdx = args.indexOf('--concurrency');
  if (concIdx !== -1 && args[concIdx + 1]) {
    concurrency = parseInt(args[concIdx + 1], 10);
  }

  return { batchFile, model, concurrency };
}

async function main() {
  const { batchFile, model, concurrency } = parseArgs();

  // 1. Read patent IDs from batch file
  if (!fs.existsSync(batchFile)) {
    console.error(`Batch file not found: ${batchFile}`);
    process.exit(1);
  }

  const patentIds: string[] = JSON.parse(fs.readFileSync(batchFile, 'utf-8'));
  if (!Array.isArray(patentIds) || patentIds.length === 0) {
    console.error('Batch file must contain a non-empty JSON array of patent IDs');
    process.exit(1);
  }

  console.log('='.repeat(60));
  console.log('Sector-Based LLM Scoring');
  console.log('='.repeat(60));
  console.log(`Patents: ${patentIds.length}`);
  console.log(`Model: ${model}`);
  console.log(`Concurrency: ${concurrency}`);
  console.log(`Claims: ${DEFAULT_CONTEXT_OPTIONS.includeClaims}`);
  console.log('');

  // 2. Query Postgres for patent metadata
  const patents = await prisma.patent.findMany({
    where: { patentId: { in: patentIds } },
    select: {
      patentId: true,
      title: true,
      abstract: true,
      primarySector: true,
      superSector: true,
      primarySubSectorId: true,
      primarySubSectorName: true,
      cpcCodes: { select: { cpcCode: true } },
    },
  });

  if (patents.length === 0) {
    console.error('No patents found in database for the given IDs');
    process.exit(1);
  }

  console.log(`Found ${patents.length}/${patentIds.length} patents in database`);

  // 3. Group patents by sector
  const bySector = new Map<string, typeof patents>();
  let noSector = 0;
  for (const p of patents) {
    const sector = p.primarySector;
    if (!sector) {
      noSector++;
      continue;
    }
    if (!bySector.has(sector)) bySector.set(sector, []);
    bySector.get(sector)!.push(p);
  }

  if (noSector > 0) {
    console.log(`Warning: ${noSector} patents have no primarySector — skipping`);
  }

  console.log(`Sectors: ${[...bySector.keys()].join(', ')}`);
  console.log('');

  // 4. Score each sector group
  let totalCompleted = 0;
  const totalPatents = patents.length - noSector;

  // Load sub-sector templates once for all sectors
  const subSectorTemplates = loadSubSectorTemplates();

  for (const [sectorName, sectorPatents] of bySector) {
    const superSector = sectorPatents[0]?.superSector || 'UNKNOWN';

    // Map to PatentForScoring
    const forScoring: PatentForScoring[] = sectorPatents.map(p => ({
      patent_id: p.patentId,
      patent_title: p.title,
      abstract: p.abstract,
      primary_sector: p.primarySector!,
      super_sector: p.superSector || superSector,
      primary_sub_sector_id: p.primarySubSectorId || undefined,
      primary_sub_sector_name: p.primarySubSectorName || undefined,
      cpc_codes: p.cpcCodes.map(c => c.cpcCode),
    }));

    // Check for sub-sector templates for this sector
    const sectorSubTemplates = Array.from(subSectorTemplates.values())
      .filter(t => t.sectorName === sectorName && t.level === 'sub_sector');

    if (sectorSubTemplates.length > 0) {
      // Group patents by matching sub-sector template using CPC codes
      const groups = new Map<string | null, PatentForScoring[]>();
      for (const patent of forScoring) {
        const matched = matchSubSectorTemplate(sectorName, patent.cpc_codes || []);
        const key = matched?.id || null;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(patent);
      }

      console.log(`\n[${sectorName}] ${sectorPatents.length} patents, ${sectorSubTemplates.length} sub-sector templates:`);
      for (const [subId, groupPatents] of groups) {
        console.log(`  ${subId || '(sector-level)'}: ${groupPatents.length} patents`);
      }

      // Score each sub-sector group with its specific template
      for (const [subSectorId, groupPatents] of groups) {
        let template;
        if (subSectorId) {
          template = getMergedTemplateForSubSector(subSectorId, sectorName, superSector);
        } else {
          template = getMergedTemplateForSector(sectorName, superSector);
        }
        console.log(`[${sectorName}] Scoring ${groupPatents.length} patents with template: ${template.inheritanceChain.join(' → ')} (${template.questions.length} questions)`);

        const result = await scorePatentBatch(groupPatents, {
          model,
          saveToDb: true,
          concurrency,
          contextOptions: DEFAULT_CONTEXT_OPTIONS,
          template,
          sectorId: sectorName,
          progressCallback: (completed, total) => {
            const globalCompleted = totalCompleted + completed;
            const pct = Math.round((globalCompleted / totalPatents) * 100);
            console.log(`Progress: ${globalCompleted}/${totalPatents} (${pct}%)`);
          },
        });

        totalCompleted += groupPatents.length;
        console.log(`[${sectorName}/${subSectorId || 'sector-level'}] Done: ${result.successful} succeeded, ${result.failed} failed, ${result.totalTokens.input + result.totalTokens.output} tokens`);
      }
    } else {
      // No sub-sector templates — use sector-level template for all patents
      const template = getMergedTemplateForSector(sectorName, superSector);
      console.log(`\n[${sectorName}] ${sectorPatents.length} patents, template: ${template.inheritanceChain.join(' → ')} (${template.questions.length} questions)`);

      const result = await scorePatentBatch(forScoring, {
        model,
        saveToDb: true,
        concurrency,
        contextOptions: DEFAULT_CONTEXT_OPTIONS,
        template,
        sectorId: sectorName,
        progressCallback: (completed, total) => {
          const globalCompleted = totalCompleted + completed;
          const pct = Math.round((globalCompleted / totalPatents) * 100);
          console.log(`Progress: ${globalCompleted}/${totalPatents} (${pct}%)`);
        },
      });

      totalCompleted += sectorPatents.length;
      console.log(`[${sectorName}] Done: ${result.successful} succeeded, ${result.failed} failed, ${result.totalTokens.input + result.totalTokens.output} tokens`);
    }
  }

  // Final progress line
  console.log(`\nProgress: ${totalCompleted}/${totalPatents} (100%)`);
  console.log(`\nScoring complete: ${totalCompleted} patents processed`);

  // Invalidate server cache
  try {
    const response = await fetch('http://localhost:3001/api/patents/invalidate-cache', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    if (response.ok) {
      console.log('[Cache] Server enrichment cache invalidated');
    }
  } catch {
    // Server may not be running — non-fatal
  }

  await prisma.$disconnect();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
