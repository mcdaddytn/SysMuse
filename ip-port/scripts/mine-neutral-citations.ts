/**
 * Mine Neutral Citation Assignees (Phase 1)
 *
 * Iterates cached citing-patent-details files to identify NEUTRAL citation
 * assignees — companies citing Broadcom patents that are neither competitors
 * nor affiliates. These are potential litigation targets not yet in the config.
 *
 * Outputs:
 *   - output/neutral-citation-companies.csv — all neutral companies sorted by frequency
 *   - output/neutral-citations-by-sector.csv — grouped by Broadcom patent sector
 *
 * Usage:
 *   npx tsx scripts/mine-neutral-citations.ts [--min-citations N]
 */

import * as fs from 'fs';
import * as path from 'path';

// ─── Configuration ────────────────────────────────────────────────────────────

const CITING_DETAILS_DIR = './cache/api/patentsview/citing-patent-details';
const CLASSIFICATION_CACHE_DIR = './cache/citation-classification';
const OUTPUT_DIR = './output';

const args = process.argv.slice(2);
const minCitations = parseInt(args.find(a => a.startsWith('--min-citations='))?.split('=')[1] || '2');

// ─── Competitor/Affiliate matching (from classify-citations.ts) ───────────────

interface CompanyConfig { name: string; patterns: string[] }
interface CategoryConfig { enabled: boolean; companies: CompanyConfig[] }
interface CompetitorConfig {
  version: string;
  categories: Record<string, CategoryConfig>;
  excludePatterns: string[];
}

class CitationClassifier {
  private competitorPatterns: Array<{ pattern: RegExp; company: string }> = [];
  private excludePatterns: RegExp[] = [];

  constructor() {
    const config: CompetitorConfig = JSON.parse(
      fs.readFileSync(path.resolve('./config/competitors.json'), 'utf-8')
    );
    this.excludePatterns = config.excludePatterns.map(p => new RegExp(p, 'i'));
    for (const [, category] of Object.entries(config.categories)) {
      if (!category.enabled) continue;
      for (const company of category.companies) {
        for (const pattern of company.patterns) {
          this.competitorPatterns.push({ pattern: new RegExp(pattern, 'i'), company: company.name });
        }
      }
    }
  }

  classify(assignee: string): 'affiliate' | 'competitor' | 'neutral' {
    if (!assignee) return 'neutral';
    if (this.excludePatterns.some(p => p.test(assignee))) return 'affiliate';
    if (this.competitorPatterns.some(p => p.pattern.test(assignee))) return 'competitor';
    return 'neutral';
  }
}

// ─── Filters ──────────────────────────────────────────────────────────────────

const UNIVERSITY_PATTERNS = [
  /universit/i, /\bMIT\b/, /\bETH\b/, /institute of technology/i,
  /college\b/i, /\bschool\b/i, /\bacademy\b/i, /polytechnic/i,
  /nationale? de/i, /\bTsinghua\b/i, /\bStanford\b/i, /\bBerkeley\b/i,
];

const GOV_PATTERNS = [
  /\bgovernment\b/i, /\bnavy\b/i, /\barmy\b/i, /\bair force\b/i,
  /\bnational lab/i, /department of/i, /\bNASA\b/, /\bDARPA\b/,
  /\bCNRS\b/, /\bCSIR\b/, /\bNRC\b/, /ministry/i,
];

function isFilteredEntity(assignee: string): boolean {
  if (UNIVERSITY_PATTERNS.some(p => p.test(assignee))) return true;
  if (GOV_PATTERNS.some(p => p.test(assignee))) return true;
  // Filter individuals (no uppercase word of 3+ chars = likely a person name with no org)
  if (/^[A-Z][a-z]+ [A-Z][a-z]+$/.test(assignee)) return true;
  return false;
}

// ─── Load sector mapping from streaming-candidates ────────────────────────────

function loadPatentSectorMap(): Map<string, { sector: string; superSector: string }> {
  const files = fs.readdirSync(OUTPUT_DIR)
    .filter(f => f.startsWith('streaming-candidates-') && f.endsWith('.json'))
    .sort().reverse();
  if (files.length === 0) throw new Error('No streaming-candidates file found');

  const data = JSON.parse(fs.readFileSync(path.join(OUTPUT_DIR, files[0]), 'utf-8'));
  const map = new Map<string, { sector: string; superSector: string }>();
  for (const c of data.candidates || []) {
    map.set(c.patent_id, {
      sector: c.primary_sector || 'unknown',
      superSector: c.super_sector || 'UNKNOWN',
    });
  }
  return map;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function main() {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('     NEUTRAL CITATION MINING');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const classifier = new CitationClassifier();
  const sectorMap = loadPatentSectorMap();

  // Track neutral companies
  interface CompanyInfo {
    name: string;
    citationCount: number;
    patentsCited: Set<string>;
    sectors: Map<string, number>;
    superSectors: Map<string, number>;
  }
  const companies = new Map<string, CompanyInfo>();

  // Process citing-patent-details files
  if (!fs.existsSync(CITING_DETAILS_DIR)) {
    console.error(`No citing-patent-details directory: ${CITING_DETAILS_DIR}`);
    process.exit(1);
  }

  const files = fs.readdirSync(CITING_DETAILS_DIR).filter(f => f.endsWith('.json'));
  console.log(`Processing ${files.length.toLocaleString()} citing-patent-details files...`);

  let processed = 0;
  let totalNeutral = 0;
  let totalCompetitor = 0;
  let totalAffiliate = 0;
  let filesWithData = 0;

  for (const file of files) {
    const patentId = file.replace('.json', '');
    const data = JSON.parse(fs.readFileSync(path.join(CITING_DETAILS_DIR, file), 'utf-8'));

    if (!data.citing_patents || data.citing_patents.length === 0) {
      processed++;
      continue;
    }

    filesWithData++;
    const patentSector = sectorMap.get(patentId);

    for (const citing of data.citing_patents) {
      const assignee = citing.assignees?.[0]?.assignee_organization || '';
      if (!assignee) continue;

      const classification = classifier.classify(assignee);

      if (classification === 'neutral') {
        totalNeutral++;
        if (isFilteredEntity(assignee)) continue; // skip universities/gov/individuals

        // Normalize company name (basic deduplication)
        const normalized = assignee.trim()
          .replace(/,?\s*(Inc|LLC|Ltd|Corp|Corporation|Co|Company|GmbH|S\.A\.|AG|NV|BV|SE|PLC|Pty)\.?$/i, '')
          .replace(/,?\s*$/, '')
          .trim();

        if (!companies.has(normalized)) {
          companies.set(normalized, {
            name: normalized,
            citationCount: 0,
            patentsCited: new Set(),
            sectors: new Map(),
            superSectors: new Map(),
          });
        }

        const info = companies.get(normalized)!;
        info.citationCount++;
        info.patentsCited.add(patentId);

        if (patentSector) {
          info.sectors.set(patentSector.sector, (info.sectors.get(patentSector.sector) || 0) + 1);
          info.superSectors.set(patentSector.superSector, (info.superSectors.get(patentSector.superSector) || 0) + 1);
        }
      } else if (classification === 'competitor') {
        totalCompetitor++;
      } else {
        totalAffiliate++;
      }
    }

    processed++;
    if (processed % 5000 === 0) {
      process.stdout.write(`\r  Processed: ${processed.toLocaleString()} / ${files.length.toLocaleString()} | Neutral companies: ${companies.size.toLocaleString()}`);
    }
  }

  console.log(`\r  Processed: ${processed.toLocaleString()} files (${filesWithData.toLocaleString()} with data)`);
  console.log(`  Citations: competitor=${totalCompetitor.toLocaleString()}, neutral=${totalNeutral.toLocaleString()}, affiliate=${totalAffiliate.toLocaleString()}`);
  console.log(`  Unique neutral companies (after filtering): ${companies.size.toLocaleString()}`);

  // Sort by citation count
  const sorted = [...companies.values()]
    .filter(c => c.citationCount >= minCitations)
    .sort((a, b) => b.citationCount - a.citationCount);

  console.log(`  Companies with ≥${minCitations} citations: ${sorted.length.toLocaleString()}`);

  // ─── Output 1: neutral-citation-companies.csv ───────────────────────────────

  const csvHeaders = ['Company', 'CitationCount', 'PatentsCited', 'TopSector', 'TopSectorCount', 'TopSuperSector', 'AllSectors'];
  const csvRows = [csvHeaders.join(',')];

  for (const c of sorted) {
    const topSector = [...c.sectors.entries()].sort((a, b) => b[1] - a[1])[0];
    const topSuperSector = [...c.superSectors.entries()].sort((a, b) => b[1] - a[1])[0];
    const allSectors = [...c.sectors.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([s, n]) => `${s}(${n})`)
      .join('; ');

    csvRows.push([
      escapeCSV(c.name),
      c.citationCount,
      c.patentsCited.size,
      escapeCSV(topSector?.[0] || ''),
      topSector?.[1] || 0,
      escapeCSV(topSuperSector?.[0] || ''),
      escapeCSV(allSectors),
    ].join(','));
  }

  const companiesPath = path.join(OUTPUT_DIR, 'neutral-citation-companies.csv');
  fs.writeFileSync(companiesPath, csvRows.join('\n'));
  console.log(`\n  Output: ${companiesPath} (${sorted.length} companies)`);

  // ─── Output 2: neutral-citations-by-sector.csv ──────────────────────────────

  // Build sector → company → count mapping
  const sectorCompanies = new Map<string, Map<string, { count: number; patents: Set<string> }>>();

  for (const c of sorted) {
    for (const [sector, count] of c.sectors) {
      if (!sectorCompanies.has(sector)) sectorCompanies.set(sector, new Map());
      const sMap = sectorCompanies.get(sector)!;
      if (!sMap.has(c.name)) sMap.set(c.name, { count: 0, patents: new Set() });
      sMap.get(c.name)!.count += count;
      // Add patents from this sector
      for (const pid of c.patentsCited) {
        if (sectorMap.get(pid)?.sector === sector) {
          sMap.get(c.name)!.patents.add(pid);
        }
      }
    }
  }

  const sectorHeaders = ['Sector', 'Company', 'CitationCount', 'PatentsCited'];
  const sectorRows = [sectorHeaders.join(',')];

  for (const [sector, companyMap] of [...sectorCompanies.entries()].sort()) {
    const companiesInSector = [...companyMap.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 50); // Top 50 per sector
    for (const [company, info] of companiesInSector) {
      sectorRows.push([
        escapeCSV(sector),
        escapeCSV(company),
        info.count,
        info.patents.size,
      ].join(','));
    }
  }

  const sectorPath = path.join(OUTPUT_DIR, 'neutral-citations-by-sector.csv');
  fs.writeFileSync(sectorPath, sectorRows.join('\n'));
  console.log(`  Output: ${sectorPath} (${sectorRows.length - 1} rows)`);

  // ─── Summary: Top 30 companies ──────────────────────────────────────────────

  console.log('\n  Top 30 neutral citation companies:');
  for (const c of sorted.slice(0, 30)) {
    const topSector = [...c.sectors.entries()].sort((a, b) => b[1] - a[1])[0];
    console.log(`    ${c.citationCount.toString().padStart(4)} cites | ${c.patentsCited.size.toString().padStart(3)} patents | ${c.name} (${topSector?.[0] || '?'})`);
  }

  // ─── Summary: Top companies per niche sector ────────────────────────────────

  const nicheSectors = ['rf-acoustic', 'optics', 'analog-circuits', 'memory-storage', 'network-multiplexing'];
  console.log('\n  Top neutral companies in niche sectors:');
  for (const sector of nicheSectors) {
    const companyMap = sectorCompanies.get(sector);
    if (!companyMap) { console.log(`    ${sector}: (no data)`); continue; }
    const top5 = [...companyMap.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 5);
    console.log(`    ${sector}:`);
    for (const [company, info] of top5) {
      console.log(`      ${info.count} cites / ${info.patents.size} patents: ${company}`);
    }
  }

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  MINING COMPLETE');
  console.log('═══════════════════════════════════════════════════════════════\n');
}

function escapeCSV(value: string | number): string {
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

main();
