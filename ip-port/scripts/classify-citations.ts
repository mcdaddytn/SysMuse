/**
 * Citation Classification Pipeline (P-0a)
 *
 * Processes cached citing-patent-details files to classify each citation
 * as competitor, affiliate, or neutral. Produces per-patent breakdowns
 * needed for V3 scoring and the portfolio grid.
 *
 * Classification logic:
 *   1. If citing assignee matches exclude patterns (Broadcom family) → AFFILIATE
 *   2. If citing assignee matches competitor patterns (131 companies) → COMPETITOR
 *   3. Otherwise → NEUTRAL
 *
 * Reads from:
 *   - cache/api/patentsview/citing-patent-details/{patent_id}.json
 *   - output/streaming-candidates-*.json (portfolio patent list)
 *   - config/competitors.json (competitor + exclude patterns)
 *
 * Writes to:
 *   - cache/citation-classification/{patent_id}.json (per-patent)
 *   - output/citation-classification-{date}.json (full summary)
 *
 * Usage:
 *   npx tsx scripts/classify-citations.ts [options]
 *
 * Options:
 *   --dry-run        Show stats without writing output
 *   --force          Re-classify even if cache file exists
 *   --start N        Start at patent index N
 *   --limit N        Process only N patents
 *   --validate       Compare against existing citation-overlap output
 */

import * as fs from 'fs';
import * as path from 'path';

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

const CITING_DETAILS_DIR = './cache/api/patentsview/citing-patent-details';
const CLASSIFICATION_CACHE_DIR = './cache/citation-classification';
const OUTPUT_DIR = './output';
const DATE_STAMP = new Date().toISOString().slice(0, 10);

// ─────────────────────────────────────────────────────────────────────────────
// Competitor/Affiliate matching (inline to avoid ESM import issues)
// ─────────────────────────────────────────────────────────────────────────────

interface CompanyConfig {
  name: string;
  patterns: string[];
}

interface CategoryConfig {
  enabled: boolean;
  companies: CompanyConfig[];
}

interface CompetitorConfig {
  version: string;
  categories: Record<string, CategoryConfig>;
  excludePatterns: string[];
}

interface CompetitorMatch {
  company: string;
  category: string;
}

class CitationClassifier {
  private competitorPatterns: Array<{ pattern: RegExp; company: string; category: string }> = [];
  private excludePatterns: RegExp[] = [];

  constructor() {
    const configPath = path.resolve('./config/competitors.json');
    const config: CompetitorConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

    // Build exclude patterns (these match affiliate/portfolio entities)
    this.excludePatterns = config.excludePatterns.map(p => new RegExp(p, 'i'));

    // Build competitor match patterns
    for (const [categoryName, category] of Object.entries(config.categories)) {
      if (!category.enabled) continue;
      for (const company of category.companies) {
        for (const pattern of company.patterns) {
          this.competitorPatterns.push({
            pattern: new RegExp(pattern, 'i'),
            company: company.name,
            category: categoryName,
          });
        }
      }
    }
  }

  /**
   * Classify an assignee name as 'affiliate', 'competitor', or 'neutral'
   */
  classify(assignee: string): { type: 'affiliate' | 'competitor' | 'neutral'; company?: string; category?: string } {
    if (!assignee) {
      return { type: 'neutral' };
    }

    // Check affiliate first (Broadcom family)
    if (this.excludePatterns.some(p => p.test(assignee))) {
      return { type: 'affiliate' };
    }

    // Check competitor
    for (const { pattern, company, category } of this.competitorPatterns) {
      if (pattern.test(assignee)) {
        return { type: 'competitor', company, category };
      }
    }

    return { type: 'neutral' };
  }

  get competitorCount(): number {
    const names = new Set(this.competitorPatterns.map(p => p.company));
    return names.size;
  }

  get excludeCount(): number {
    return this.excludePatterns.length;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface CitingPatentDetail {
  patent_id: string;
  patent_title?: string;
  patent_date?: string;
  assignees?: Array<{
    assignee_organization?: string;
  }>;
}

interface CitingPatentsFile {
  total_hits: number;
  citing_patents: CitingPatentDetail[];
}

interface CompetitorCite {
  patent_id: string;
  assignee: string;
  company: string;
  category: string;
}

interface PatentCitationClassification {
  patent_id: string;
  total_forward_citations: number;
  competitor_citations: number;
  affiliate_citations: number;
  neutral_citations: number;
  competitor_count: number;       // distinct competitor companies
  competitor_names: string[];     // list of distinct competitor names
  competitor_details: CompetitorCite[];
  has_citation_data: boolean;     // false if no cache file exists
}

// ─────────────────────────────────────────────────────────────────────────────
// Argument parsing
// ─────────────────────────────────────────────────────────────────────────────

interface Args {
  dryRun: boolean;
  force: boolean;
  start: number;
  limit: number | null;
  validate: boolean;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const args: Args = {
    dryRun: false,
    force: false,
    start: 0,
    limit: null,
    validate: false,
  };

  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--dry-run': args.dryRun = true; break;
      case '--force': args.force = true; break;
      case '--validate': args.validate = true; break;
      case '--start': args.start = parseInt(argv[++i]); break;
      case '--limit': args.limit = parseInt(argv[++i]); break;
    }
  }

  return args;
}

// ─────────────────────────────────────────────────────────────────────────────
// Core functions
// ─────────────────────────────────────────────────────────────────────────────

function loadPatentIds(): string[] {
  const files = fs.readdirSync(OUTPUT_DIR)
    .filter(f => f.startsWith('streaming-candidates-') && f.endsWith('.json'))
    .sort()
    .reverse();

  if (files.length === 0) {
    throw new Error('No streaming-candidates file found in output/');
  }

  const filepath = path.join(OUTPUT_DIR, files[0]);
  console.log(`Reading patent IDs from: ${files[0]}`);

  const data = JSON.parse(fs.readFileSync(filepath, 'utf-8'));
  const candidates = data.candidates || [];
  return candidates.map((c: any) => c.patent_id).filter(Boolean);
}

function readCitingDetails(patentId: string): CitingPatentsFile | null {
  const filepath = path.join(CITING_DETAILS_DIR, `${patentId}.json`);
  if (!fs.existsSync(filepath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(filepath, 'utf-8'));
}

function classificationCacheExists(patentId: string): boolean {
  return fs.existsSync(path.join(CLASSIFICATION_CACHE_DIR, `${patentId}.json`));
}

function saveClassification(result: PatentCitationClassification): void {
  const filepath = path.join(CLASSIFICATION_CACHE_DIR, `${result.patent_id}.json`);
  fs.writeFileSync(filepath, JSON.stringify(result, null, 2));
}

function classifyPatent(patentId: string, classifier: CitationClassifier): PatentCitationClassification {
  const citingData = readCitingDetails(patentId);

  if (!citingData) {
    return {
      patent_id: patentId,
      total_forward_citations: 0,
      competitor_citations: 0,
      affiliate_citations: 0,
      neutral_citations: 0,
      competitor_count: 0,
      competitor_names: [],
      competitor_details: [],
      has_citation_data: false,
    };
  }

  let competitorCount = 0;
  let affiliateCount = 0;
  let neutralCount = 0;
  const competitorDetails: CompetitorCite[] = [];
  const competitorNameSet = new Set<string>();

  for (const citingPatent of citingData.citing_patents) {
    const assignee = citingPatent.assignees?.[0]?.assignee_organization || '';
    const classification = classifier.classify(assignee);

    switch (classification.type) {
      case 'affiliate':
        affiliateCount++;
        break;
      case 'competitor':
        competitorCount++;
        competitorDetails.push({
          patent_id: citingPatent.patent_id,
          assignee,
          company: classification.company!,
          category: classification.category!,
        });
        competitorNameSet.add(classification.company!);
        break;
      case 'neutral':
        neutralCount++;
        break;
    }
  }

  return {
    patent_id: patentId,
    total_forward_citations: citingData.total_hits,
    competitor_citations: competitorCount,
    affiliate_citations: affiliateCount,
    neutral_citations: neutralCount,
    competitor_count: competitorNameSet.size,
    competitor_names: Array.from(competitorNameSet).sort(),
    competitor_details: competitorDetails,
    has_citation_data: true,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Validation (compare against existing citation-overlap output)
// ─────────────────────────────────────────────────────────────────────────────

function validateAgainstExisting(results: Map<string, PatentCitationClassification>): void {
  console.log('\n' + '─'.repeat(65));
  console.log('VALIDATION: Comparing against citation-overlap output files');
  console.log('─'.repeat(65));

  const overlapFiles = fs.readdirSync(OUTPUT_DIR)
    .filter(f => f.startsWith('citation-overlap-cached-') && f.endsWith('.json'))
    .sort();

  if (overlapFiles.length === 0) {
    console.log('  No citation-overlap files found for validation.');
    return;
  }

  let totalCompared = 0;
  let exactMatches = 0;
  let mismatches = 0;
  let mismatchExamples: string[] = [];

  for (const file of overlapFiles) {
    const data = JSON.parse(fs.readFileSync(path.join(OUTPUT_DIR, file), 'utf-8'));

    for (const existing of data.results) {
      const myResult = results.get(existing.patent_id);
      if (!myResult || !myResult.has_citation_data) continue;

      totalCompared++;

      // Compare competitor citation counts
      // Note: existing output only has competitor_citations, not affiliate/neutral
      if (myResult.competitor_citations === existing.competitor_citations) {
        exactMatches++;
      } else {
        mismatches++;
        if (mismatchExamples.length < 5) {
          mismatchExamples.push(
            `  ${existing.patent_id}: overlap=${existing.competitor_citations}, ` +
            `mine=${myResult.competitor_citations} (total=${myResult.total_forward_citations}, ` +
            `aff=${myResult.affiliate_citations}, neut=${myResult.neutral_citations})`
          );
        }
      }
    }
  }

  console.log(`  Compared: ${totalCompared.toLocaleString()} patents`);
  console.log(`  Exact matches: ${exactMatches.toLocaleString()} (${(exactMatches / totalCompared * 100).toFixed(1)}%)`);
  console.log(`  Mismatches: ${mismatches.toLocaleString()}`);

  if (mismatchExamples.length > 0) {
    console.log('\n  Mismatch examples:');
    for (const ex of mismatchExamples) {
      console.log(ex);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

function main() {
  const args = parseArgs();
  const classifier = new CitationClassifier();

  console.log('\n' + '═'.repeat(65));
  console.log('     CITATION CLASSIFICATION PIPELINE (P-0a)');
  console.log('═'.repeat(65));
  console.log(`\n  Competitor patterns: ${classifier.competitorCount} companies`);
  console.log(`  Affiliate patterns: ${classifier.excludeCount} patterns`);

  // Ensure cache directory exists
  fs.mkdirSync(CLASSIFICATION_CACHE_DIR, { recursive: true });

  // Load all patent IDs
  const allIds = loadPatentIds();
  console.log(`  Portfolio size: ${allIds.length.toLocaleString()} patents`);

  // Slice for start/limit
  const endIndex = args.limit ? Math.min(args.start + args.limit, allIds.length) : allIds.length;
  const patentIds = allIds.slice(args.start, endIndex);
  console.log(`  Processing: ${patentIds.length.toLocaleString()} patents (index ${args.start}–${endIndex})`);

  // Check how many need processing
  let needsProcessing = 0;
  let alreadyCached = 0;
  let noCitationData = 0;

  for (const id of patentIds) {
    if (!args.force && classificationCacheExists(id)) {
      alreadyCached++;
    } else if (!fs.existsSync(path.join(CITING_DETAILS_DIR, `${id}.json`))) {
      noCitationData++;
      needsProcessing++; // Will create a "no data" record
    } else {
      needsProcessing++;
    }
  }

  console.log(`\n  Already classified: ${alreadyCached.toLocaleString()}`);
  console.log(`  Need classification: ${needsProcessing.toLocaleString()}`);
  console.log(`  No citation data: ${noCitationData.toLocaleString()}`);

  if (args.dryRun) {
    console.log('\n[DRY RUN] No files written.');
    process.exit(0);
  }

  // Process patents
  console.log('\n' + '─'.repeat(65));
  console.log('CLASSIFYING');
  console.log('─'.repeat(65));

  const startTime = Date.now();
  const allResults = new Map<string, PatentCitationClassification>();

  // Aggregate stats
  let processed = 0;
  let skipped = 0;
  let totalCompetitor = 0;
  let totalAffiliate = 0;
  let totalNeutral = 0;
  let patentsWithCompetitor = 0;
  let patentsWithAffiliate = 0;
  let patentsWithCitations = 0;
  let patentsWithNoCacheFile = 0;

  for (const patentId of patentIds) {
    // Skip if already cached (unless --force)
    if (!args.force && classificationCacheExists(patentId)) {
      // Load existing to include in results for validation
      const existing = JSON.parse(
        fs.readFileSync(path.join(CLASSIFICATION_CACHE_DIR, `${patentId}.json`), 'utf-8')
      );
      allResults.set(patentId, existing);
      skipped++;

      // Aggregate stats from cached
      if (existing.has_citation_data) {
        totalCompetitor += existing.competitor_citations;
        totalAffiliate += existing.affiliate_citations;
        totalNeutral += existing.neutral_citations;
        if (existing.competitor_citations > 0) patentsWithCompetitor++;
        if (existing.affiliate_citations > 0) patentsWithAffiliate++;
        if (existing.total_forward_citations > 0) patentsWithCitations++;
      } else {
        patentsWithNoCacheFile++;
      }

      continue;
    }

    // Classify
    const result = classifyPatent(patentId, classifier);
    allResults.set(patentId, result);
    saveClassification(result);

    // Aggregate stats
    totalCompetitor += result.competitor_citations;
    totalAffiliate += result.affiliate_citations;
    totalNeutral += result.neutral_citations;
    if (result.competitor_citations > 0) patentsWithCompetitor++;
    if (result.affiliate_citations > 0) patentsWithAffiliate++;
    if (result.total_forward_citations > 0) patentsWithCitations++;
    if (!result.has_citation_data) patentsWithNoCacheFile++;

    processed++;

    // Progress
    if (processed % 1000 === 0 || processed === needsProcessing) {
      const elapsed = (Date.now() - startTime) / 1000;
      const rate = processed / elapsed;
      const eta = (needsProcessing - processed) / rate;

      process.stdout.write(
        `\r  Classified: ${processed.toLocaleString()} / ${needsProcessing.toLocaleString()} | ` +
        `${rate.toFixed(0)} p/s | ` +
        `ETA: ${(eta / 60).toFixed(1)}m     `
      );
    }
  }

  console.log('\n');

  // Competitor breakdown
  const competitorCounts = new Map<string, number>();
  for (const [_, result] of allResults) {
    for (const detail of result.competitor_details) {
      competitorCounts.set(detail.company, (competitorCounts.get(detail.company) || 0) + 1);
    }
  }

  // Summary
  const elapsed = (Date.now() - startTime) / 1000;
  const totalCitations = totalCompetitor + totalAffiliate + totalNeutral;

  console.log('─'.repeat(65));
  console.log('RESULTS');
  console.log('─'.repeat(65));
  console.log(`  Time: ${elapsed.toFixed(1)}s`);
  console.log(`  Newly classified: ${processed.toLocaleString()}`);
  console.log(`  From cache: ${skipped.toLocaleString()}`);
  console.log(`  No citation data: ${patentsWithNoCacheFile.toLocaleString()}`);
  console.log();
  console.log(`  Total citations analyzed: ${totalCitations.toLocaleString()}`);
  console.log(`    Competitor: ${totalCompetitor.toLocaleString()} (${totalCitations > 0 ? (totalCompetitor / totalCitations * 100).toFixed(1) : 0}%)`);
  console.log(`    Affiliate:  ${totalAffiliate.toLocaleString()} (${totalCitations > 0 ? (totalAffiliate / totalCitations * 100).toFixed(1) : 0}%)`);
  console.log(`    Neutral:    ${totalNeutral.toLocaleString()} (${totalCitations > 0 ? (totalNeutral / totalCitations * 100).toFixed(1) : 0}%)`);
  console.log();
  console.log(`  Patents with any citations: ${patentsWithCitations.toLocaleString()}`);
  console.log(`  Patents with competitor cites: ${patentsWithCompetitor.toLocaleString()}`);
  console.log(`  Patents with affiliate cites: ${patentsWithAffiliate.toLocaleString()}`);

  // Top competitors
  if (competitorCounts.size > 0) {
    console.log('\n  Top 15 competitors by citation count:');
    const sorted = [...competitorCounts.entries()].sort((a, b) => b[1] - a[1]);
    for (const [name, count] of sorted.slice(0, 15)) {
      const pct = (count / totalCompetitor * 100).toFixed(1);
      console.log(`    ${name}: ${count.toLocaleString()} (${pct}%)`);
    }
    console.log(`    ... ${competitorCounts.size} total distinct competitors`);
  }

  // Save summary output
  const summaryPath = path.join(OUTPUT_DIR, `citation-classification-${DATE_STAMP}.json`);

  // Build compact summary (without competitor_details to keep file size reasonable)
  const compactResults = Array.from(allResults.values()).map(r => ({
    patent_id: r.patent_id,
    total_forward_citations: r.total_forward_citations,
    competitor_citations: r.competitor_citations,
    affiliate_citations: r.affiliate_citations,
    neutral_citations: r.neutral_citations,
    competitor_count: r.competitor_count,
    competitor_names: r.competitor_names,
    has_citation_data: r.has_citation_data,
  }));

  const summary = {
    metadata: {
      generatedDate: new Date().toISOString(),
      totalPatents: allResults.size,
      patentsWithCitations: patentsWithCitations,
      patentsWithCompetitorCites: patentsWithCompetitor,
      patentsWithAffiliateCites: patentsWithAffiliate,
      patentsWithNoCitationData: patentsWithNoCacheFile,
      totalCitations: totalCitations,
      competitorCitations: totalCompetitor,
      affiliateCitations: totalAffiliate,
      neutralCitations: totalNeutral,
      topCompetitors: [...competitorCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 25)
        .map(([name, count]) => ({ name, count })),
    },
    results: compactResults,
  };

  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
  console.log(`\n  Summary saved: ${summaryPath}`);
  console.log(`  Per-patent cache: ${CLASSIFICATION_CACHE_DIR}/ (${allResults.size} files)`);

  // Validation
  if (args.validate) {
    validateAgainstExisting(allResults);
  }

  console.log('\n' + '═'.repeat(65));
  console.log('  CLASSIFICATION COMPLETE');
  console.log('═'.repeat(65) + '\n');
}

main();
