/**
 * Import patents via manifest search + XML hydration.
 * Direct script version — bypasses HTTP timeout issues.
 *
 * Usage:
 *   npx tsx scripts/import-via-manifests.ts --portfolio nutanix-all
 *   npx tsx scripts/import-via-manifests.ts --portfolio nutanix-all --max 100
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { searchManifests, hydrateFromXml, type ManifestMatch } from '../src/api/services/manifest-search-service.js';
import { releaseForwardCounts } from '../src/api/services/manifest-builder-service.js';
import { calculateRemainingYears, calculateBaseScore } from '../src/api/services/patent-hydration-service.js';
import { getPrimarySectorAsync, getSuperSectorAsync } from '../src/api/utils/sector-mapper.js';
import { matchesAssigneePattern } from '../src/api/services/bulk-patent-search-service.js';

const prisma = new PrismaClient();

async function main() {
  const args = process.argv.slice(2);
  const portfolioName = args[args.indexOf('--portfolio') + 1];
  const maxPatents = args.includes('--max') ? parseInt(args[args.indexOf('--max') + 1]) : 50000;

  if (!portfolioName) {
    console.error('Usage: npx tsx scripts/import-via-manifests.ts --portfolio <name> [--max N]');
    process.exit(1);
  }

  const portfolio = await prisma.portfolio.findFirst({
    where: { name: portfolioName },
    include: {
      company: {
        include: {
          affiliates: {
            where: { isActive: true },
            include: { patterns: true },
          },
        },
      },
    },
  });

  if (!portfolio) {
    console.error(`Portfolio "${portfolioName}" not found`);
    process.exit(1);
  }

  const allPatterns = portfolio.company.affiliates.flatMap(a => a.patterns.map(p => p.pattern));
  const patternToAffiliate = new Map<string, string>();
  for (const affiliate of portfolio.company.affiliates) {
    for (const pat of affiliate.patterns) {
      patternToAffiliate.set(pat.pattern.toLowerCase(), affiliate.name);
    }
  }

  // Pre-load existing patents
  const existingLinks = await prisma.portfolioPatent.findMany({
    where: { portfolioId: portfolio.id },
    select: { patentId: true },
  });
  const existingPatentIds = new Set(existingLinks.map(l => l.patentId));

  console.log(`Portfolio: ${portfolio.name} (${existingPatentIds.size} existing patents)`);
  console.log(`Company: ${portfolio.company.name} (${portfolio.company.affiliates.length} affiliates, ${allPatterns.length} patterns)`);
  console.log(`Max patents: ${maxPatents}\n`);

  // Phase 1: Search
  console.log('=== Phase 1: Manifest Search ===');
  const t1 = Date.now();
  const allMatches: ManifestMatch[] = [];
  let alreadyExists = 0;
  const seenIds = new Set<string>();

  for await (const batch of searchManifests({
    patterns: allPatterns,
    maxPatents: maxPatents + existingPatentIds.size, // budget for skipping existing
    startYear: 2025,
    endYear: 2015,
    onProgress: (msg) => console.log(`  ${msg}`),
  })) {
    for (const match of batch) {
      if (seenIds.has(match.patent_id)) continue;
      seenIds.add(match.patent_id);
      if (existingPatentIds.has(match.patent_id)) {
        alreadyExists++;
        continue;
      }
      allMatches.push(match);
      if (allMatches.length >= maxPatents) break;
    }
    if (allMatches.length >= maxPatents) break;
  }
  console.log(`  Search complete: ${allMatches.length} new, ${alreadyExists} existing (${((Date.now() - t1) / 1000).toFixed(1)}s)\n`);

  if (allMatches.length === 0) {
    console.log('No new patents to import.');
    releaseForwardCounts();
    await prisma.$disconnect();
    return;
  }

  // Phase 2: Hydrate
  console.log('=== Phase 2: XML Hydration ===');
  const t2 = Date.now();
  const hydrated = await hydrateFromXml(allMatches, (msg) => console.log(`  ${msg}`));
  console.log(`  Hydrated ${hydrated.size}/${allMatches.length} patents (${((Date.now() - t2) / 1000).toFixed(1)}s)\n`);

  releaseForwardCounts();

  // Phase 3: Upsert
  console.log('=== Phase 3: Database Upsert ===');
  const t3 = Date.now();
  let imported = 0;
  let failed = 0;
  let falsePositives = 0;

  for (const match of allMatches) {
    const patentId = match.patent_id;
    const p = hydrated.get(patentId);

    try {
      const assigneeOrg = p?.assignees?.[0]?.assignee_organization || match.assignee;

      // Double-check for false positives using actual assignee from XML
      if (p && !p.assignees.some(a => matchesAssigneePattern(a.assignee_organization, allPatterns))) {
        falsePositives++;
        continue;
      }

      const inventors = (p?.inventors || []).map(
        (inv: any) => `${inv.inventor_name_first || ''} ${inv.inventor_name_last || ''}`.trim()
      ).filter(Boolean);
      const cpcCodes = (p?.cpc_current || [])
        .map((c: any) => c.cpc_subgroup_id || c.cpc_group_id || '').filter(Boolean);
      const filingDate = p?.application?.[0]?.filing_date || match.filing_date;
      const grantDate = p?.patent_date || match.grant_date;
      const forwardCitations = match.forward_citations;
      const dateForExpiry = filingDate || grantDate;
      const { remainingYears, isExpired } = calculateRemainingYears(dateForExpiry);
      const primaryCpc = cpcCodes[0] || match.primary_cpc || null;
      const primarySector = await getPrimarySectorAsync(cpcCodes, p?.patent_title || '', p?.patent_abstract) || null;
      const superSector = primarySector ? await getSuperSectorAsync(primarySector) : null;
      const baseScore = calculateBaseScore({ forwardCitations, remainingYears, grantDate, primarySector });

      const affiliateName = patternToAffiliate.get(assigneeOrg.toLowerCase())
        || [...patternToAffiliate.entries()].find(([pat]) => assigneeOrg.toLowerCase().includes(pat))?.[1]
        || assigneeOrg;

      await prisma.patent.upsert({
        where: { patentId },
        create: {
          patentId,
          title: p?.patent_title || '', abstract: p?.patent_abstract || null,
          grantDate, filingDate, assignee: assigneeOrg, affiliate: affiliateName,
          inventors, forwardCitations, remainingYears, isExpired,
          baseScore, primarySector, superSector, primaryCpc,
        },
        update: {
          title: p?.patent_title || '', abstract: p?.patent_abstract || null,
          grantDate, filingDate, assignee: assigneeOrg, affiliate: affiliateName,
          inventors, forwardCitations, remainingYears, isExpired,
          baseScore, primarySector, superSector, primaryCpc,
        },
      });

      for (const code of cpcCodes) {
        await prisma.patentCpc.upsert({
          where: { patentId_cpcCode: { patentId, cpcCode: code } },
          create: { patentId, cpcCode: code },
          update: {},
        }).catch(() => {});
      }

      await prisma.portfolioPatent.create({
        data: { portfolioId: portfolio.id, patentId, source: 'BULK_DATA_IMPORT' },
      });

      imported++;
      if (imported % 50 === 0) console.log(`  ${imported} imported...`);
    } catch (err: any) {
      console.error(`  Failed ${patentId}: ${err?.message?.slice(0, 80)}`);
      failed++;
    }
  }

  // Update count
  const patentCount = await prisma.portfolioPatent.count({ where: { portfolioId: portfolio.id } });
  await prisma.portfolio.update({ where: { id: portfolio.id }, data: { patentCount } });

  const totalTime = ((Date.now() - t1) / 1000).toFixed(1);
  console.log(`\n=== Done (${totalTime}s total) ===`);
  console.log(`  Imported: ${imported}`);
  console.log(`  Already existed: ${alreadyExists}`);
  console.log(`  False positives skipped: ${falsePositives}`);
  console.log(`  Failed: ${failed}`);
  console.log(`  Portfolio total: ${patentCount}`);

  await prisma.$disconnect();
}
main();
