/**
 * Consolidate Vendor Packages
 *
 * Reads all sector vendor packages from output/vendor-exports/,
 * parses collective strategies, merges pivot CSVs, builds a target
 * summary, and generates a cross-package overview document.
 *
 * Usage: npx tsx scripts/consolidate-vendor-packages.ts [--date=2026-04-06] [--output-dir=output/vendor-summary-2026-04-08]
 */

import * as fs from 'fs';
import * as path from 'path';

// ─── CLI Args ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const dateArg = args.find(a => a.startsWith('--date='))?.split('=')[1] || '2026-04-06';
const outputDirArg = args.find(a => a.startsWith('--output-dir='))?.split('=')[1];
const outputDir = path.resolve(outputDirArg || `./output/vendor-summary-${new Date().toISOString().split('T')[0]}`);

// ─── Slugify (matches patlytics-cache-service) ──────────────────────────────

function slugify(name: string): string {
  return name.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

// ─── CSV Helpers ──────────────────────────────────────────────────────────────

function escapeCSV(value: string | number | boolean | null | undefined): string {
  if (value === undefined || value === null) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function csvRow(values: (string | number | boolean | null | undefined)[]): string {
  return values.map(escapeCSV).join(',');
}

function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        fields.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
  }
  fields.push(current);
  return fields;
}

// ─── Company Name Normalization ───────────────────────────────────────────────

const COMPANY_SUFFIXES = /\s*(?:,?\s*(?:Inc|Corp|Corporation|Technologies|Technology|Systems|Ltd|LLC|Co|Company|Group|Holdings|Holding|Pte|S\.?A\.?|N\.?V\.?|GmbH|AG|SE|plc|Limited)\.?\s*)+$/i;

// Hardcoded aliases for known tricky entries
const COMPANY_ALIASES: Record<string, string> = {
  'mellanox': 'nvidia',
  'mellanox technologies': 'nvidia',
  'nvidia mellanox': 'nvidia',
  'nvidia (mellanox division)': 'nvidia',
  'nvidia (mellanox)': 'nvidia',
  'nvidia/mellanox': 'nvidia',
  'red hat': 'red-hat',
  'red hat/ibm': 'red-hat',
  'hpe aruba': 'hewlett-packard-enterprise',
  'silver peak/hpe aruba': 'hewlett-packard-enterprise',
  'silver peak': 'hewlett-packard-enterprise',
  'hewlett packard enterprise': 'hewlett-packard-enterprise',
  'microsemi/microchip': 'microchip-technology',
  'microsemi': 'microchip-technology',
  'microchip': 'microchip-technology',
  'microchip technology': 'microchip-technology',
  'paypal/ebay': 'paypal',
  'square/block': 'block-inc',
  'google cloud': 'google',
  'alphabet': 'google',
  'samsung electronics': 'samsung',
  'lg electronics': 'lg',
  'sony corporation': 'sony',
  'nec corporation': 'nec',
  'canon inc': 'canon',
  'nikon corporation': 'nikon',
  'inside secure/verimatrix': 'verimatrix',
  'inside secure': 'verimatrix',
  'harman international': 'harman',
  'texas instruments': 'texas-instruments',
  'analog devices': 'analog-devices',
  'silicon laboratories': 'silicon-labs',
  'murata manufacturing': 'murata',
  'arris international/commscope': 'commscope',
  'arris international': 'commscope',
  'arris': 'commscope',
  'salesforce financial services': 'salesforce',
  'bosch security': 'bosch',
  'robert bosch': 'bosch',
  'hikvision digital technology': 'hikvision',
  'f5 networks': 'f5',
  'palo alto networks': 'palo-alto-networks',
  'check point software': 'check-point',
  'fortinet': 'fortinet',
  'citrix systems': 'citrix',
};

interface CompanyInfo {
  companyName: string;
  companySlug: string;
  competitorMatch: string | null;
  competitorCategory: string | null;
  productCount: number;
  products: string[];
}

interface CompetitorEntry {
  name: string;
  patterns: string[];
  category: string;
}

function loadCompaniesIndex(): CompanyInfo[] {
  const companiesPath = path.resolve('./cache/patlytics/companies.json');
  if (!fs.existsSync(companiesPath)) return [];
  const data = JSON.parse(fs.readFileSync(companiesPath, 'utf-8'));
  return data.companies || [];
}

function loadCompetitors(): CompetitorEntry[] {
  const competitorsPath = path.resolve('./config/competitors.json');
  if (!fs.existsSync(competitorsPath)) return [];
  const data = JSON.parse(fs.readFileSync(competitorsPath, 'utf-8'));
  const entries: CompetitorEntry[] = [];
  for (const [category, catData] of Object.entries(data.categories || {})) {
    for (const company of (catData as any).companies || []) {
      entries.push({
        name: company.name,
        patterns: company.patterns || [company.name],
        category,
      });
    }
  }
  return entries;
}

function getProductDirSlugs(): Set<string> {
  const productsDir = path.resolve('./cache/patlytics/products');
  if (!fs.existsSync(productsDir)) return new Set();
  return new Set(fs.readdirSync(productsDir).filter(d =>
    fs.statSync(path.join(productsDir, d)).isDirectory()
  ));
}

interface NormalizedCompany {
  slug: string;
  hasProductDocs: boolean;
  competitorCategory: string | null;
}

function buildCompanyNormalizer() {
  const companiesIndex = loadCompaniesIndex();
  const competitors = loadCompetitors();
  const productDirSlugs = getProductDirSlugs();

  // Build lookup maps
  const slugToInfo = new Map<string, CompanyInfo>();
  const nameToSlug = new Map<string, string>();
  for (const c of companiesIndex) {
    slugToInfo.set(c.companySlug, c);
    nameToSlug.set(c.companyName.toLowerCase(), c.companySlug);
  }

  const cache = new Map<string, NormalizedCompany>();

  return function normalize(rawName: string): NormalizedCompany {
    const key = rawName.trim().toLowerCase();
    if (cache.has(key)) return cache.get(key)!;

    let slug: string;
    let competitorCategory: string | null = null;

    // 0. Hardcoded aliases
    const aliasKey = key.replace(/\s+/g, ' ');
    if (COMPANY_ALIASES[aliasKey]) {
      slug = COMPANY_ALIASES[aliasKey];
    }
    // 1. Exact slug match to product dirs
    else if (productDirSlugs.has(slugify(rawName))) {
      slug = slugify(rawName);
    }
    // 2. Strip suffixes and re-slug
    else {
      const stripped = rawName.replace(COMPANY_SUFFIXES, '').trim();
      const strippedSlug = slugify(stripped);
      if (productDirSlugs.has(strippedSlug)) {
        slug = strippedSlug;
      }
      // 3. Match against competitors.json patterns
      else {
        let matched = false;
        for (const comp of competitors) {
          for (const pattern of comp.patterns) {
            if (key.includes(pattern.toLowerCase()) || pattern.toLowerCase().includes(key)) {
              slug = slugify(comp.name);
              competitorCategory = comp.category;
              matched = true;
              break;
            }
          }
          if (matched) break;
        }
        if (!matched) {
          // 4. Check companies.json index
          if (nameToSlug.has(key)) {
            slug = nameToSlug.get(key)!;
          } else {
            // Try stripped name
            const strippedKey = stripped.toLowerCase();
            if (nameToSlug.has(strippedKey)) {
              slug = nameToSlug.get(strippedKey)!;
            } else {
              // Partial match on companies index
              let found = false;
              for (const [name, s] of nameToSlug) {
                if (key.includes(name) || name.includes(key)) {
                  slug = s;
                  found = true;
                  break;
                }
              }
              if (!found) {
                slug = strippedSlug || slugify(rawName);
              }
            }
          }
        }
      }
    }

    // Resolve competitor category if not already set
    if (!competitorCategory) {
      const info = slugToInfo.get(slug!);
      if (info?.competitorCategory) {
        competitorCategory = info.competitorCategory;
      } else {
        // Check against competitor patterns
        for (const comp of competitors) {
          if (slugify(comp.name) === slug) {
            competitorCategory = comp.category;
            break;
          }
        }
      }
    }

    const hasProductDocs = productDirSlugs.has(slug!);

    const result: NormalizedCompany = { slug: slug!, hasProductDocs, competitorCategory };
    cache.set(key, result);
    return result;
  };
}

// ─── Collective Strategy Parsing ──────────────────────────────────────────────

interface TechCluster {
  sector: string;
  letter: string;
  name: string;
  patents: string[];
  strength: string;
}

interface ClaimChainPackage {
  sector: string;
  packageNum: string;
  patents: string[];
  damagesEstimate: string;
}

interface VulnerabilityEntry {
  sector: string;
  company: string;
  revenue: string;
  patentsInfringed: string;
  mostImpactful: string[];
  vulnerabilityLevel: string;
  priority: string;
}

interface TopPatent {
  sector: string;
  rank: number;
  patentId: string;
  title: string;
}

interface ParsedStrategy {
  clusters: TechCluster[];
  claimChains: ClaimChainPackage[];
  vulnerabilities: VulnerabilityEntry[];
  topPatents: TopPatent[];
}

function parseCollectiveStrategyFull(mdContent: string, sector: string): ParsedStrategy {
  const clusters: TechCluster[] = [];
  const claimChains: ClaimChainPackage[] = [];
  const vulnerabilities: VulnerabilityEntry[] = [];
  const topPatents: TopPatent[] = [];
  let match: RegExpExecArray | null;

  // ── Technology Clusters ──
  // Extract section 1 content first
  const section1Match = mdContent.match(/## 1\.\s+Technology Clusters([\s\S]*?)(?=## 2\.|$)/i);
  const section1 = section1Match ? section1Match[1] : '';

  if (section1) {
    // Format A: ### Cluster A: Name\n**Patents:** ...
    const clusterRegexA = /###\s+Cluster\s+([A-Z]):?\s*(.+?)[\n\r]+\*\*Patents:\*\*\s*([^\n]+)/gi;
    let foundLettered = false;
    while ((match = clusterRegexA.exec(section1)) !== null) {
      foundLettered = true;
      const letter = match[1];
      const name = match[2].trim();
      const patentNums = match[3].match(/\d{7,8}/g) || [];

      const afterMatch = section1.substring(match.index!, match.index! + 1000);
      const strengthMatch = afterMatch.match(/\*\*Combined Coverage(?:\s+Strength)?:\*\*\s*(?:[^\n]*?)(Very High|High|Medium[-\s]?High|Medium|Low)/i);
      const strength = strengthMatch ? strengthMatch[1].replace(/-/g, ' ').replace(/\s+/g, ' ').trim() : 'Unknown';
      clusters.push({ sector, letter, name, patents: patentNums, strength });
    }

    // Format B: ### Name Cluster\n**Patents:** ... (no letter prefix)
    if (!foundLettered) {
      const clusterRegexB = /###\s+(.+?)(?:\s+Cluster)?\s*\n\*\*Patents:\*\*\s*([^\n]+)/gi;
      let clusterIndex = 0;
      while ((match = clusterRegexB.exec(section1)) !== null) {
        const letter = String.fromCharCode(65 + clusterIndex); // A, B, C...
        const name = match[1].trim();
        const patentNums = match[2].match(/\d{7,8}/g) || [];

        const afterMatch = section1.substring(match.index!, match.index! + 1000);
        const strengthMatch = afterMatch.match(/\*\*Combined Coverage(?:\s+Strength)?:\*\*\s*(?:[^\n]*?)(Very High|High|Medium[-\s]?High|Medium|Low)/i);
        const strength = strengthMatch ? strengthMatch[1].replace(/-/g, ' ').replace(/\s+/g, ' ').trim() : 'Unknown';
        clusters.push({ sector, letter, name, patents: patentNums, strength });
        clusterIndex++;
      }
    }
  }

  // ── Claim Chain Packages ──
  // Format A: ### Package 1: Name\n**Patents:** ...
  // Format B: ### Package Alpha: Name\n**Patents:** ...
  const section2Match = mdContent.match(/## 2\.\s+Claim Chain Strategy([\s\S]*?)(?=## 3\.|$)/i);
  const section2 = section2Match ? section2Match[1] : '';

  if (section2) {
    // Match both numbered and named packages
    const packageRegex = /###\s+(?:Package\s+)?(\S+):?\s*[^\n]*\n\*\*Patents:\*\*\s*([^\n]+)/gi;
    let pkgIndex = 0;
    while ((match = packageRegex.exec(section2)) !== null) {
      pkgIndex++;
      const packageLabel = match[1];
      // Convert labels like "Alpha", "Beta" to numbers; keep existing numbers
      const packageNum = /^\d+$/.test(packageLabel) ? packageLabel : String(pkgIndex);
      const patentNums = match[2].match(/\d{7,8}/g) || [];

      // Find damages estimate nearby
      const afterMatch = section2.substring(match.index!, match.index! + 1500);
      const damagesMatch = afterMatch.match(/\*\*(?:Estimated )?Damages(?: Basis)?:\*\*\s*([^\n]+)/i);
      const damagesEstimate = damagesMatch ? damagesMatch[1].trim() : '';

      claimChains.push({ sector, packageNum, patents: patentNums, damagesEstimate });
    }
  }

  // ── Vulnerability Matrix — Multi-format parser ──
  // Extract section 3 content
  const section3Match = mdContent.match(/## 3\.\s+Competitor Vulnerability Matrix([\s\S]*?)(?=## 4\.|$)/i);
  const section3 = section3Match ? section3Match[1] : '';

  if (section3) {
    // Strategy: parse company blocks regardless of format.
    // Company blocks are identified by either:
    //   A) **CompanyName** (~$XB revenue)  or  **CompanyName (~$XB revenue)**
    //   B) ### CompanyName
    // Then look for vulnerability level, patents, priority within the block

    // Split into blocks by company headers
    // Pattern matches: **Company Name** (with optional revenue), or ### Company Name
    const companyBlockRegex = /(?:(?:\*\*([^*]+?)\*\*\s*(?:\(([^)]*revenue[^)]*)\))?)|(?:###\s+(?!HIGH|SECONDARY|Based)([^\n]+)))/g;
    let blockMatch;
    const blockPositions: { company: string; revenue: string; pos: number }[] = [];

    while ((blockMatch = companyBlockRegex.exec(section3)) !== null) {
      const company = (blockMatch[1] || blockMatch[3] || '').trim();
      const revenue = (blockMatch[2] || '').trim();
      if (!company) continue;
      // Skip section headers
      if (/^(HIGH PRIORITY|SECONDARY|MEDIUM|LOW|Based on)/i.test(company)) continue;
      // Skip if it's a field label like "Patents Likely Infringed:" or "Most Impactful:"
      if (/^(Patents|Most|Vulnerability|Priority|Assertion|Revenue|Number)/i.test(company)) continue;
      blockPositions.push({ company, revenue, pos: blockMatch.index! });
    }

    // For each block, extract vulnerability data from the text between this and next block
    for (let i = 0; i < blockPositions.length; i++) {
      const start = blockPositions[i].pos;
      const end = i + 1 < blockPositions.length ? blockPositions[i + 1].pos : section3.length;
      const block = section3.substring(start, end);

      let { company, revenue } = blockPositions[i];

      // Extract revenue if not found in header (may be on a separate line or in the block body)
      if (!revenue) {
        const revMatch = block.match(/(?:~?\$[\d.]+[BM]\s*(?:revenue|networking revenue)?|revenue\s*~?\$[\d.]+[BM]|\(~?\$[\d.]+[BM](?:\s*revenue)?\))/i);
        if (revMatch) revenue = revMatch[0].replace(/[()]/g, '').trim();
      }

      // Extract vulnerability level
      const vulnMatch = block.match(/Vulnerability(?:\s*Level)?:?\s*(HIGH|MEDIUM-HIGH|MEDIUM|LOW-MEDIUM|LOW|IMMEDIATE)/i);
      const vulnerabilityLevel = vulnMatch ? vulnMatch[1].toUpperCase() : '';

      // Extract patents infringed count or list
      const patInfringedMatch = block.match(/Patents\s*(?:Likely\s*)?Infringed:?\s*([^\n]+)/i);
      const patentsInfringed = patInfringedMatch ? patInfringedMatch[1].trim() : '';

      // Extract most impactful patents
      const impactfulMatch = block.match(/Most\s*Impactful(?:\s*Patents)?:?\s*([^\n]+)/i);
      const impactfulStr = impactfulMatch ? impactfulMatch[1].trim() : '';
      const mostImpactful = impactfulStr.match(/\d{7,8}/g) || [];

      // Extract priority
      const priorityMatch = block.match(/(?:Assertion\s*)?Priority:?\s*([^\n]+)/i);
      const priority = priorityMatch ? priorityMatch[1].trim() : '';

      // Clean company name: remove inline vulnerability, numbered prefixes, revenue in name
      company = company
        .replace(/\s*[-–—]\s*(?:VULNERABILITY|Vulnerability):?\s*(HIGH|MEDIUM|LOW)[-\w]*/gi, '')
        .replace(/^\d+\.\s*/, '')   // "2. Tokyo Electron" → "Tokyo Electron"
        .replace(/\s*\(~?\$[\d.]+[BM](?:\s*revenue)?(?:\s*-\s*[^)]+)?\)\s*/gi, '')  // Remove inline revenue
        .replace(/\s*[-–—]\s*~?\$[\d.]+[BM](?:\s*revenue)?\s*/gi, '')  // "Company - ~$3B revenue"
        .trim();

      // If we removed vulnerability from name but didn't find it in block, recover it
      if (!vulnerabilityLevel) {
        const nameVulnMatch = blockPositions[i].company.match(/VULNERABILITY:?\s*(HIGH|MEDIUM|LOW)/i);
        if (nameVulnMatch) {
          vulnerabilities.push({
            sector, company, revenue, patentsInfringed,
            mostImpactful, vulnerabilityLevel: nameVulnMatch[1].toUpperCase(), priority,
          });
          continue;
        }
      }

      if (company && (vulnerabilityLevel || patentsInfringed)) {
        vulnerabilities.push({
          sector,
          company,
          revenue,
          patentsInfringed,
          mostImpactful,
          vulnerabilityLevel,
          priority,
        });
      }
    }
  }

  // ── Top 10 Patents ──
  // Format A: 1. **7654321** — Title   or   1. **US7654321B2** — Title
  // Multiple formats:
  //   1. **7654321** — Title
  //   ### 1. Patent 7654321 - Title
  //   1. **Patent 7654321** - Title
  //   **1. Patent 7654321 - Title**
  // Unified regex: optional ### prefix, rank number, optional bold, optional "Patent", patent ID
  const section4Match = mdContent.match(/## 4\.\s+Top 10 Patents([\s\S]*?)(?=## 5\.|$)/i);
  const section4 = section4Match ? section4Match[1] : '';

  if (section4) {
    const topPatentRegex = /(?:###?\s*)?(?:\*{1,2})?(\d{1,2})\.\s*(?:\*{0,2})(?:Patent\s+)?(?:\*{0,2})(?:US)?(\d{7,8})(?:B\d?)?\*{0,2}\s*(?:[-–—:]\s*)?(.+?)(?:\*{0,2})(?:\n|$)/g;
    while ((match = topPatentRegex.exec(section4)) !== null) {
      topPatents.push({
        sector,
        rank: parseInt(match[1]),
        patentId: match[2],
        title: match[3].replace(/\*{1,2}$/, '').trim(),
      });
    }
  }

  return { clusters, claimChains, vulnerabilities, topPatents };
}

// ─── Pivot CSV Row ────────────────────────────────────────────────────────────

interface PivotRow {
  patentId: string;
  litScore: string;
  strategy: string;
  techCluster: string;
  claimChain: string;
  target: string;
  targetProduct: string;
  targetUrl: string;
  sector: string;
  packageDate: string;
}

// ─── Target Summary ───────────────────────────────────────────────────────────

interface TargetSummary {
  company: string;
  slug: string;
  sectorCount: number;
  totalPatentsExposed: number;
  topSectors: string;
  hasProductDocs: string;
  competitorCategory: string;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function main() {
  console.log(`\n=== Consolidate Vendor Packages ===`);
  console.log(`Package date: ${dateArg}`);
  console.log(`Output dir: ${outputDir}`);
  console.log();

  // ── Step 1: Package Discovery ──
  console.log('--- Step 1: Package Discovery ---');
  const vendorExportsDir = path.resolve('./output/vendor-exports');
  if (!fs.existsSync(vendorExportsDir)) {
    console.error('vendor-exports directory not found');
    process.exit(1);
  }

  const allDirs = fs.readdirSync(vendorExportsDir)
    .filter(d => d.endsWith(`-${dateArg}`))
    .filter(d => fs.statSync(path.join(vendorExportsDir, d)).isDirectory())
    .filter(d => !d.startsWith('nutanix-'));  // Skip nutanix target-specific packages

  const validPackages: { dir: string; sector: string }[] = [];
  for (const dir of allDirs) {
    const strategyPath = path.join(vendorExportsDir, dir, 'collective-strategy.md');
    const pivotPath = path.join(vendorExportsDir, dir, 'vendor-targets-pivot.csv');
    if (fs.existsSync(strategyPath) && fs.existsSync(pivotPath)) {
      // Extract sector slug: remove the date suffix
      const sector = dir.replace(`-${dateArg}`, '');
      validPackages.push({ dir, sector });
    } else {
      console.log(`  SKIP ${dir} — missing files`);
    }
  }

  console.log(`Found ${validPackages.length} valid sector packages\n`);

  // ── Step 2: Parse Collective Strategies ──
  console.log('--- Step 2: Parse Collective Strategies ---');

  const allClusters: TechCluster[] = [];
  const allClaimChains: ClaimChainPackage[] = [];
  const allVulnerabilities: VulnerabilityEntry[] = [];
  const allTopPatents: TopPatent[] = [];

  for (const pkg of validPackages) {
    const strategyPath = path.join(vendorExportsDir, pkg.dir, 'collective-strategy.md');
    const content = fs.readFileSync(strategyPath, 'utf-8');
    const parsed = parseCollectiveStrategyFull(content, pkg.sector);

    allClusters.push(...parsed.clusters);
    allClaimChains.push(...parsed.claimChains);
    allVulnerabilities.push(...parsed.vulnerabilities);
    allTopPatents.push(...parsed.topPatents);

    console.log(`  ${pkg.sector}: ${parsed.clusters.length} clusters, ${parsed.claimChains.length} chains, ${parsed.vulnerabilities.length} vuln entries, ${parsed.topPatents.length} top patents`);
  }

  console.log(`\nTotals: ${allClusters.length} clusters, ${allClaimChains.length} claim chains, ${allVulnerabilities.length} vulnerability entries, ${allTopPatents.length} top patents\n`);

  // ── Step 3: Merge Pivot CSVs ──
  console.log('--- Step 3: Merge Pivot CSVs ---');

  const allPivotRows: PivotRow[] = [];
  for (const pkg of validPackages) {
    const pivotPath = path.join(vendorExportsDir, pkg.dir, 'vendor-targets-pivot.csv');
    const lines = fs.readFileSync(pivotPath, 'utf-8').split('\n').filter(l => l.trim());
    const headers = parseCSVLine(lines[0]);

    for (let i = 1; i < lines.length; i++) {
      const fields = parseCSVLine(lines[i]);
      if (fields.length < 6) continue;

      allPivotRows.push({
        patentId: fields[headers.indexOf('PatentId')] || fields[0],
        litScore: fields[headers.indexOf('LitScore')] || fields[1],
        strategy: fields[headers.indexOf('Strategy')] || fields[2],
        techCluster: fields[headers.indexOf('TechCluster')] || fields[3],
        claimChain: fields[headers.indexOf('ClaimChain')] || fields[4],
        target: fields[headers.indexOf('Target')] || fields[5],
        targetProduct: fields[headers.indexOf('TargetProduct')] || fields[6] || '',
        targetUrl: fields[headers.indexOf('TargetUrl')] || fields[7] || '',
        sector: pkg.sector,
        packageDate: dateArg,
      });
    }
  }

  console.log(`Merged ${allPivotRows.length} pivot rows from ${validPackages.length} packages\n`);

  // ── Step 4: Build Target Summary ──
  console.log('--- Step 4: Build Target Summary ---');

  const normalizeCompany = buildCompanyNormalizer();

  // Group pivot rows by normalized target
  const targetData = new Map<string, {
    rawNames: Set<string>;
    sectors: Set<string>;
    patents: Set<string>;
    normalized: NormalizedCompany;
  }>();

  for (const row of allPivotRows) {
    if (!row.target.trim()) continue;
    const normalized = normalizeCompany(row.target);
    const key = normalized.slug;

    if (!targetData.has(key)) {
      targetData.set(key, {
        rawNames: new Set(),
        sectors: new Set(),
        patents: new Set(),
        normalized,
      });
    }
    const entry = targetData.get(key)!;
    entry.rawNames.add(row.target.trim());
    entry.sectors.add(row.sector);
    entry.patents.add(row.patentId);
  }

  // Build sorted summary
  const targetSummaries: TargetSummary[] = [];
  for (const [slug, data] of targetData) {
    // Pick the most common raw name as display name
    const nameFreqs = new Map<string, number>();
    for (const name of data.rawNames) {
      nameFreqs.set(name, (nameFreqs.get(name) || 0) + 1);
    }
    const displayName = [...nameFreqs.entries()].sort((a, b) => b[1] - a[1])[0][0];

    // Top sectors by patent count in that sector
    const sectorPatentCounts = new Map<string, number>();
    for (const row of allPivotRows) {
      if (!row.target.trim()) continue;
      const norm = normalizeCompany(row.target);
      if (norm.slug === slug) {
        sectorPatentCounts.set(row.sector, (sectorPatentCounts.get(row.sector) || 0) + 1);
      }
    }
    const topSectors = [...sectorPatentCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([s]) => s)
      .join('; ');

    targetSummaries.push({
      company: displayName,
      slug,
      sectorCount: data.sectors.size,
      totalPatentsExposed: data.patents.size,
      topSectors,
      hasProductDocs: data.normalized.hasProductDocs ? 'Y' : 'N',
      competitorCategory: data.normalized.competitorCategory || '',
    });
  }

  targetSummaries.sort((a, b) => b.totalPatentsExposed - a.totalPatentsExposed);

  const withDocs = targetSummaries.filter(t => t.hasProductDocs === 'Y').length;
  console.log(`Unique targets: ${targetSummaries.length}`);
  console.log(`With product docs: ${withDocs} (${(withDocs / targetSummaries.length * 100).toFixed(0)}%)`);
  console.log(`Without product docs: ${targetSummaries.length - withDocs}\n`);

  // ── Step 5: Write Output Files ──
  console.log('--- Step 5: Write Output Files ---');
  fs.mkdirSync(outputDir, { recursive: true });

  // 5a. Write merged pivot CSV
  const pivotHeaders = ['PatentId', 'LitScore', 'Strategy', 'TechCluster', 'ClaimChain', 'Target', 'TargetProduct', 'TargetUrl', 'Sector', 'PackageDate'];
  const pivotLines = [pivotHeaders.join(',')];
  for (const row of allPivotRows) {
    pivotLines.push(csvRow([
      row.patentId, row.litScore, row.strategy, row.techCluster, row.claimChain,
      row.target, row.targetProduct, row.targetUrl, row.sector, row.packageDate,
    ]));
  }
  const pivotPath = path.join(outputDir, 'all-patent-targets.csv');
  fs.writeFileSync(pivotPath, pivotLines.join('\n'));
  console.log(`  all-patent-targets.csv: ${allPivotRows.length} rows`);

  // 5b. Write target summary CSV
  const summaryHeaders = ['Company', 'Slug', 'SectorCount', 'TotalPatentsExposed', 'TopSectors', 'HasProductDocs', 'CompetitorCategory'];
  const summaryLines = [summaryHeaders.join(',')];
  for (const t of targetSummaries) {
    summaryLines.push(csvRow([
      t.company, t.slug, t.sectorCount, t.totalPatentsExposed,
      t.topSectors, t.hasProductDocs, t.competitorCategory,
    ]));
  }
  const summaryPath = path.join(outputDir, 'target-summary.csv');
  fs.writeFileSync(summaryPath, summaryLines.join('\n'));
  console.log(`  target-summary.csv: ${targetSummaries.length} targets`);

  // 5c. Generate overview document
  const overview = generateOverview(
    validPackages, allClusters, allClaimChains, allVulnerabilities,
    allTopPatents, allPivotRows, targetSummaries,
  );
  const overviewPath = path.join(outputDir, 'package-overview.md');
  fs.writeFileSync(overviewPath, overview);
  console.log(`  package-overview.md`);

  console.log(`\nDone. Files written to ${outputDir}\n`);
}

// ─── Overview Document Generation ─────────────────────────────────────────────

function generateOverview(
  packages: { dir: string; sector: string }[],
  clusters: TechCluster[],
  claimChains: ClaimChainPackage[],
  vulnerabilities: VulnerabilityEntry[],
  topPatents: TopPatent[],
  pivotRows: PivotRow[],
  targetSummaries: TargetSummary[],
): string {
  const lines: string[] = [];

  // ── Header ──
  const uniquePatents = new Set(pivotRows.map(r => r.patentId));
  const uniqueTargets = new Set(pivotRows.filter(r => r.target.trim()).map(r => r.target));

  lines.push(`# Cross-Package Vendor Summary`);
  lines.push(``);
  lines.push(`**Generated:** ${new Date().toISOString().split('T')[0]}`);
  lines.push(`**Source Date:** ${dateArg}`);
  lines.push(`**Packages:** ${packages.length} sector packages`);
  lines.push(``);
  lines.push(`## Summary Statistics`);
  lines.push(``);
  lines.push(`| Metric | Count |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Sector packages | ${packages.length} |`);
  lines.push(`| Unique patents | ${uniquePatents.size} |`);
  lines.push(`| Unique targets (raw) | ${uniqueTargets.size} |`);
  lines.push(`| Normalized targets | ${targetSummaries.length} |`);
  lines.push(`| Patent-target pairs | ${pivotRows.length} |`);
  lines.push(`| Targets with product docs | ${targetSummaries.filter(t => t.hasProductDocs === 'Y').length} |`);
  lines.push(`| Targets without docs | ${targetSummaries.filter(t => t.hasProductDocs === 'N').length} |`);
  lines.push(``);

  // ── Very High & High Technology Clusters ──
  lines.push(`## Very High & High Technology Clusters`);
  lines.push(``);
  const highClusters = clusters.filter(c =>
    /very high|high/i.test(c.strength)
  ).sort((a, b) => {
    const order = { 'very high': 0, 'high': 1 };
    const aOrder = (order as any)[a.strength.toLowerCase()] ?? 2;
    const bOrder = (order as any)[b.strength.toLowerCase()] ?? 2;
    return aOrder - bOrder || a.sector.localeCompare(b.sector);
  });

  if (highClusters.length > 0) {
    lines.push(`| Sector | Cluster | Name | Patents | Strength |`);
    lines.push(`|--------|---------|------|---------|----------|`);
    for (const c of highClusters) {
      lines.push(`| ${c.sector} | ${c.letter} | ${c.name.substring(0, 60)} | ${c.patents.length} | ${c.strength} |`);
    }
  } else {
    lines.push(`*No Very High or High strength clusters found.*`);
  }
  lines.push(``);

  // ── HIGH Vulnerability Targets ──
  lines.push(`## HIGH Vulnerability Targets`);
  lines.push(``);
  const highVulnTargets = vulnerabilities.filter(v =>
    /^HIGH$/i.test(v.vulnerabilityLevel)
  );

  // Deduplicate by company name (aggregate across sectors)
  const vulnByCompany = new Map<string, { sectors: string[]; revenue: string; totalImpactful: Set<string> }>();
  for (const v of highVulnTargets) {
    const key = v.company.toLowerCase().replace(/\s+/g, ' ');
    if (!vulnByCompany.has(key)) {
      vulnByCompany.set(key, { sectors: [], revenue: v.revenue, totalImpactful: new Set() });
    }
    const entry = vulnByCompany.get(key)!;
    entry.sectors.push(v.sector);
    if (!entry.revenue && v.revenue) entry.revenue = v.revenue;
    for (const p of v.mostImpactful) entry.totalImpactful.add(p);
  }

  if (vulnByCompany.size > 0) {
    lines.push(`| Company | Revenue | Sectors | Impactful Patents |`);
    lines.push(`|---------|---------|---------|-------------------|`);
    const sortedVuln = [...vulnByCompany.entries()].sort((a, b) =>
      b[1].sectors.length - a[1].sectors.length || b[1].totalImpactful.size - a[1].totalImpactful.size
    );
    for (const [company, data] of sortedVuln) {
      // Use the original casing from the first entry
      const displayName = highVulnTargets.find(v => v.company.toLowerCase().replace(/\s+/g, ' ') === company)?.company || company;
      lines.push(`| ${displayName} | ${data.revenue} | ${data.sectors.join(', ')} | ${data.totalImpactful.size} |`);
    }
  } else {
    lines.push(`*No HIGH vulnerability targets found.*`);
  }
  lines.push(``);

  // ── Top 20 Patents by Litigation Score ──
  lines.push(`## Top 20 Patents by Litigation Score`);
  lines.push(``);

  // Aggregate LitScore across sectors for each patent
  const patentScores = new Map<string, { maxScore: number; sectors: Set<string>; targetCount: number }>();
  for (const row of pivotRows) {
    const score = parseFloat(row.litScore) || 0;
    if (!patentScores.has(row.patentId)) {
      patentScores.set(row.patentId, { maxScore: score, sectors: new Set(), targetCount: 0 });
    }
    const entry = patentScores.get(row.patentId)!;
    if (score > entry.maxScore) entry.maxScore = score;
    entry.sectors.add(row.sector);
    entry.targetCount++;
  }

  const topByScore = [...patentScores.entries()]
    .sort((a, b) => b[1].maxScore - a[1].maxScore || b[1].targetCount - a[1].targetCount)
    .slice(0, 20);

  lines.push(`| Rank | PatentId | LitScore | Sectors | Targets |`);
  lines.push(`|------|----------|----------|---------|---------|`);
  for (let i = 0; i < topByScore.length; i++) {
    const [pid, data] = topByScore[i];
    lines.push(`| ${i + 1} | ${pid} | ${data.maxScore} | ${[...data.sectors].join(', ')} | ${data.targetCount} |`);
  }
  lines.push(``);

  // ── Per-Sector Summary Table ──
  lines.push(`## Per-Sector Summary`);
  lines.push(``);
  lines.push(`| Sector | Patents | Targets | Pairs | Top Cluster Strength |`);
  lines.push(`|--------|---------|---------|-------|---------------------|`);

  for (const pkg of packages.sort((a, b) => a.sector.localeCompare(b.sector))) {
    const sectorRows = pivotRows.filter(r => r.sector === pkg.sector);
    const sectorPatents = new Set(sectorRows.map(r => r.patentId));
    const sectorTargets = new Set(sectorRows.filter(r => r.target.trim()).map(r => r.target));
    const sectorClusters = clusters.filter(c => c.sector === pkg.sector);
    const strengthOrder = ['Very High', 'High', 'Medium', 'Low', 'Unknown'];
    const topStrength = sectorClusters
      .map(c => c.strength)
      .sort((a, b) => strengthOrder.indexOf(a) - strengthOrder.indexOf(b))[0] || 'N/A';

    lines.push(`| ${pkg.sector} | ${sectorPatents.size} | ${sectorTargets.size} | ${sectorRows.length} | ${topStrength} |`);
  }
  lines.push(``);

  // ── Top 20 Targets by Patent Exposure ──
  lines.push(`## Top 20 Targets by Patent Exposure`);
  lines.push(``);
  lines.push(`| Company | Slug | Sectors | Patents | Docs | Category |`);
  lines.push(`|---------|------|---------|---------|------|----------|`);
  for (const t of targetSummaries.slice(0, 20)) {
    lines.push(`| ${t.company} | ${t.slug} | ${t.sectorCount} | ${t.totalPatentsExposed} | ${t.hasProductDocs} | ${t.competitorCategory} |`);
  }
  lines.push(``);

  return lines.join('\n');
}

// ─── Run ──────────────────────────────────────────────────────────────────────

main();
