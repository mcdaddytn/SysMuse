/**
 * Find Product Documentation Gaps
 *
 * Reads the consolidated vendor summary from Phase A, identifies
 * targets missing product documentation, gathers context from
 * merged data, and generates search queries for interactive use.
 *
 * Usage: npx tsx scripts/find-product-docs.ts [--summary-dir=output/vendor-summary-2026-04-08] [--top=50]
 */

import * as fs from 'fs';
import * as path from 'path';

// ─── CLI Args ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const summaryDirArg = args.find(a => a.startsWith('--summary-dir='))?.split('=')[1];
const topN = parseInt(args.find(a => a.startsWith('--top='))?.split('=')[1] || '50');

// Auto-detect latest summary directory if not specified
function findLatestSummaryDir(): string {
  const outputDir = path.resolve('./output');
  if (!fs.existsSync(outputDir)) {
    console.error('output/ directory not found');
    process.exit(1);
  }
  const dirs = fs.readdirSync(outputDir)
    .filter(d => d.startsWith('vendor-summary-'))
    .sort()
    .reverse();
  if (dirs.length === 0) {
    console.error('No vendor-summary directories found. Run consolidate-vendor-packages.ts first.');
    process.exit(1);
  }
  return path.join(outputDir, dirs[0]);
}

const summaryDir = path.resolve(summaryDirArg || findLatestSummaryDir());

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

// ─── Interfaces ──────────────────────────────────────────────────────────────

interface TargetRow {
  company: string;
  slug: string;
  sectorCount: number;
  totalPatentsExposed: number;
  topSectors: string;
  hasProductDocs: string;
  competitorCategory: string;
}

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

interface GapTarget {
  company: string;
  slug: string;
  sectorCount: number;
  totalPatentsExposed: number;
  topSectors: string[];
  competitorCategory: string;
  products: Set<string>;      // Product mentions from pivot data
  techAreas: Set<string>;     // Technology areas from sectors
  queries: string[];           // Generated search queries
}

// ─── Sector Display Names ────────────────────────────────────────────────────

const SECTOR_TECH_AREAS: Record<string, string> = {
  'analog-circuits': 'analog circuits, power amplifiers',
  'audio': 'audio processing, speech, codec',
  'computing-auth-boot': 'secure boot, authentication, hardware security',
  'computing-os-security': 'operating system security, virtualization',
  'computing-runtime': 'virtual machines, SDN, runtime',
  'computing-systems': 'memory management, storage controllers',
  'computing-ui': 'touch interface, gesture recognition',
  'data-retrieval': 'database, query processing',
  'fintech-business': 'payments, fintech, transaction processing',
  'memory-storage': 'memory, storage controllers',
  'network-auth-access': 'network access control, identity',
  'network-crypto': 'cryptography, PKI, key management',
  'network-error-control': 'error correction, LDPC, forward error correction',
  'network-management': 'network monitoring, SDN, load balancing',
  'network-multiplexing': 'MIMO, OFDM, multiplexing',
  'network-protocols': 'TCP offload, load balancing, protocols',
  'network-secure-compute': 'network security, secure computing',
  'network-signal-processing': 'signal processing, equalization',
  'network-switching': 'network switching, SDN, overlay networks',
  'network-threat-protection': 'threat detection, cybersecurity, malware',
  'optics': 'optical, laser, photonics',
  'power-management': 'wireless power, power management',
  'rf-acoustic': 'RF filters, BAW, FBAR, acoustic',
  'semiconductor-bonding': 'wire bonding, packaging, interconnect',
  'semiconductor-devices': 'semiconductor packaging, RF integration',
  'semiconductor-fabrication': 'semiconductor fabrication, metallization',
  'semiconductor-interconnect': 'semiconductor interconnect, packaging',
  'semiconductor-manufacturing': 'CVD, CMP, semiconductor process',
  'semiconductor-modern': 'power management, memory interface IC',
  'semiconductor-multichip': 'multi-chip packaging, PoP, stacking',
  'semiconductor-thermal-emi': 'thermal management, EMI shielding',
  'streaming-multimedia': 'streaming, VoIP, multimedia',
  'test-measurement': 'test, BIST, scan test',
  'video-broadcast': 'video processing, broadcast, display',
  'video-client-processing': 'video client, set-top box',
  'video-codec': 'video codec, compression, encoding',
  'video-drm-conditional': 'DRM, conditional access, content protection',
  'video-server-cdn': 'video server, CDN, streaming infrastructure',
  'video-storage': 'video storage, error correction, HDD',
  'wireless-infrastructure': 'wireless infrastructure, base station',
  'wireless-mobility': 'handover, mobility, roaming',
  'wireless-power-mgmt': 'wireless power control, resource allocation',
  'wireless-scheduling': 'scheduling, OFDMA, resource allocation',
  'wireless-transmission': 'NFC, RF, high-speed communication',
};

// ─── Main ─────────────────────────────────────────────────────────────────────

function main() {
  console.log(`\n=== Find Product Documentation Gaps ===`);
  console.log(`Summary dir: ${summaryDir}`);
  console.log(`Top N targets: ${topN}`);
  console.log();

  // ── Step 1: Read target summary ──
  console.log('--- Step 1: Identify Gap Targets ---');

  const targetSummaryPath = path.join(summaryDir, 'target-summary.csv');
  if (!fs.existsSync(targetSummaryPath)) {
    console.error(`target-summary.csv not found at ${targetSummaryPath}`);
    process.exit(1);
  }

  const targetLines = fs.readFileSync(targetSummaryPath, 'utf-8').split('\n').filter(l => l.trim());
  const targetHeaders = parseCSVLine(targetLines[0]);
  const targets: TargetRow[] = [];
  for (let i = 1; i < targetLines.length; i++) {
    const fields = parseCSVLine(targetLines[i]);
    targets.push({
      company: fields[targetHeaders.indexOf('Company')] || fields[0],
      slug: fields[targetHeaders.indexOf('Slug')] || fields[1],
      sectorCount: parseInt(fields[targetHeaders.indexOf('SectorCount')] || fields[2]) || 0,
      totalPatentsExposed: parseInt(fields[targetHeaders.indexOf('TotalPatentsExposed')] || fields[3]) || 0,
      topSectors: fields[targetHeaders.indexOf('TopSectors')] || fields[4],
      hasProductDocs: fields[targetHeaders.indexOf('HasProductDocs')] || fields[5],
      competitorCategory: fields[targetHeaders.indexOf('CompetitorCategory')] || fields[6] || '',
    });
  }

  const gapTargets = targets
    .filter(t => t.hasProductDocs === 'N')
    .sort((a, b) => b.totalPatentsExposed - a.totalPatentsExposed)
    .slice(0, topN);

  console.log(`Total targets: ${targets.length}`);
  console.log(`Targets without docs: ${targets.filter(t => t.hasProductDocs === 'N').length}`);
  console.log(`Top ${topN} gap targets selected (by patent exposure)`);
  console.log(`Patent exposure range: ${gapTargets[gapTargets.length - 1]?.totalPatentsExposed || 0} - ${gapTargets[0]?.totalPatentsExposed || 0}`);
  console.log();

  // ── Step 2: Gather Product Context ──
  console.log('--- Step 2: Gather Product Context ---');

  const pivotPath = path.join(summaryDir, 'all-patent-targets.csv');
  if (!fs.existsSync(pivotPath)) {
    console.error(`all-patent-targets.csv not found at ${pivotPath}`);
    process.exit(1);
  }

  const pivotLines = fs.readFileSync(pivotPath, 'utf-8').split('\n').filter(l => l.trim());
  const pivotHeaders = parseCSVLine(pivotLines[0]);

  // Build slug set for quick lookup
  const gapSlugs = new Set(gapTargets.map(t => t.slug));

  // Also normalize target names to match against pivot data
  const nameToSlug = new Map<string, string>();
  for (const t of gapTargets) {
    nameToSlug.set(t.company.toLowerCase(), t.slug);
  }

  // Build gap target context from pivot data
  const gapContext = new Map<string, GapTarget>();
  for (const t of gapTargets) {
    gapContext.set(t.slug, {
      company: t.company,
      slug: t.slug,
      sectorCount: t.sectorCount,
      totalPatentsExposed: t.totalPatentsExposed,
      topSectors: t.topSectors.split(';').map(s => s.trim()).filter(s => s),
      competitorCategory: t.competitorCategory,
      products: new Set(),
      techAreas: new Set(),
      queries: [],
    });
  }

  // Scan pivot rows for product mentions and sectors
  for (let i = 1; i < pivotLines.length; i++) {
    const fields = parseCSVLine(pivotLines[i]);
    const target = fields[pivotHeaders.indexOf('Target')] || fields[5] || '';
    const targetProduct = fields[pivotHeaders.indexOf('TargetProduct')] || fields[6] || '';
    const sector = fields[pivotHeaders.indexOf('Sector')] || fields[8] || '';

    if (!target.trim()) continue;

    // Check if this target matches a gap target
    const targetLower = target.toLowerCase();
    let matchedSlug: string | undefined;

    // Try direct slug match
    const directSlug = slugify(target);
    if (gapSlugs.has(directSlug)) {
      matchedSlug = directSlug;
    } else if (nameToSlug.has(targetLower)) {
      matchedSlug = nameToSlug.get(targetLower);
    } else {
      // Try partial match
      for (const [name, slug] of nameToSlug) {
        if (targetLower.includes(name) || name.includes(targetLower)) {
          matchedSlug = slug;
          break;
        }
      }
    }

    if (matchedSlug && gapContext.has(matchedSlug)) {
      const ctx = gapContext.get(matchedSlug)!;
      if (targetProduct.trim()) {
        // Parse product entries like "Company: Product description"
        const products = targetProduct.split(/;\s*/).map(p => {
          return p.replace(/^[^:]+:\s*/, '').trim();
        }).filter(p => p.length > 0 && p.length < 200);
        for (const p of products) ctx.products.add(p);
      }
      if (sector && SECTOR_TECH_AREAS[sector]) {
        ctx.techAreas.add(SECTOR_TECH_AREAS[sector]);
      }
    }
  }

  // Report context gathering
  let withProducts = 0;
  for (const ctx of gapContext.values()) {
    if (ctx.products.size > 0) withProducts++;
  }
  console.log(`Gap targets with product mentions: ${withProducts}/${gapContext.size}`);
  console.log();

  // ── Step 3: Generate Search Queries ──
  console.log('--- Step 3: Generate Search Queries ---');

  for (const ctx of gapContext.values()) {
    const queries: string[] = [];

    // Query 1: General product documentation
    queries.push(`"${ctx.company}" product documentation technical specifications`);

    // Query 2: Specific products if available
    if (ctx.products.size > 0) {
      // Find the best product mention that's company-specific
      const companyPattern = new RegExp(ctx.company.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      const companyProducts = [...ctx.products]
        .filter(p => companyPattern.test(p))
        .sort((a, b) => a.length - b.length); // Shorter = more focused

      const topProduct = companyProducts[0] || [...ctx.products][0];
      // Extract key product terms (remove company name, limit length)
      let productTerms = topProduct
        .replace(companyPattern, '')
        .replace(/^\s*[,;:]\s*/, '')
        .trim();
      // Truncate to first product mention if too long
      if (productTerms.length > 60) {
        productTerms = productTerms.split(/[,;]/)[0].trim();
      }
      if (productTerms.length > 5 && productTerms.length < 80) {
        queries.push(`"${ctx.company}" ${productTerms} datasheet whitepaper`);
      }
    }

    // Query 3: Technology area (use the top sector's tech area, not random)
    if (ctx.topSectors.length > 0) {
      const primarySector = ctx.topSectors[0];
      const techArea = SECTOR_TECH_AREAS[primarySector] || primarySector;
      queries.push(`"${ctx.company}" ${techArea} architecture documentation`);
    }

    ctx.queries = queries;
  }

  // ── Step 4: Write Output Files ──
  console.log('--- Step 4: Write Output Files ---');

  // 4a. Write search queries CSV
  const queryHeaders = ['Rank', 'Company', 'Slug', 'PatentsExposed', 'Sectors', 'Query', 'Context'];
  const queryLines = [queryHeaders.join(',')];
  let rank = 0;
  for (const ctx of [...gapContext.values()].sort((a, b) => b.totalPatentsExposed - a.totalPatentsExposed)) {
    rank++;
    const productContext = ctx.products.size > 0
      ? `Products: ${[...ctx.products].slice(0, 3).join('; ')}`
      : `Tech: ${[...ctx.techAreas].slice(0, 2).join('; ')}`;

    for (const query of ctx.queries) {
      queryLines.push(csvRow([
        rank, ctx.company, ctx.slug, ctx.totalPatentsExposed,
        ctx.topSectors.slice(0, 3).join('; '), query, productContext,
      ]));
    }
  }
  const queryPath = path.join(summaryDir, 'search-queries.csv');
  fs.writeFileSync(queryPath, queryLines.join('\n'));
  console.log(`  search-queries.csv: ${queryLines.length - 1} queries for ${gapContext.size} targets`);

  // 4b. Write gap targets summary for evidence tracking
  const gapHeaders = ['Rank', 'Company', 'Slug', 'PatentsExposed', 'SectorCount', 'TopSectors', 'ProductMentions', 'Category', 'EvidenceTier'];
  const gapLines = [gapHeaders.join(',')];
  rank = 0;
  for (const ctx of [...gapContext.values()].sort((a, b) => b.totalPatentsExposed - a.totalPatentsExposed)) {
    rank++;
    gapLines.push(csvRow([
      rank, ctx.company, ctx.slug, ctx.totalPatentsExposed, ctx.sectorCount,
      ctx.topSectors.slice(0, 5).join('; '),
      ctx.products.size > 0 ? [...ctx.products].slice(0, 3).join('; ') : '',
      ctx.competitorCategory,
      'pending',  // Will be updated after web search
    ]));
  }
  const gapPath = path.join(summaryDir, 'gap-targets.csv');
  fs.writeFileSync(gapPath, gapLines.join('\n'));
  console.log(`  gap-targets.csv: ${gapLines.length - 1} targets`);

  // 4c. Write empty product-doc-urls.csv for interactive filling
  const urlHeaders = ['Company', 'Slug', 'Product', 'URL', 'DocType', 'Priority'];
  fs.writeFileSync(path.join(summaryDir, 'product-doc-urls.csv'), urlHeaders.join(',') + '\n');
  console.log(`  product-doc-urls.csv: (empty template)`);

  // 4d. Write empty youtube-videos.csv for interactive filling
  const videoHeaders = ['Company', 'Slug', 'Product', 'VideoURL', 'Title', 'Priority'];
  fs.writeFileSync(path.join(summaryDir, 'youtube-videos.csv'), videoHeaders.join(',') + '\n');
  console.log(`  youtube-videos.csv: (empty template)`);

  // 4e. Generate evidence summary markdown
  const evidenceMd = generateEvidenceSummary([...gapContext.values()].sort((a, b) =>
    b.totalPatentsExposed - a.totalPatentsExposed
  ));
  fs.writeFileSync(path.join(summaryDir, 'evidence-summary.md'), evidenceMd);
  console.log(`  evidence-summary.md`);

  console.log(`\nDone. ${gapContext.size} gap targets ready for web search.`);
  console.log(`\nNext steps:`);
  console.log(`  1. Review search-queries.csv for search terms`);
  console.log(`  2. Use WebSearch in Claude session for top priority targets`);
  console.log(`  3. Add found URLs to product-doc-urls.csv`);
  console.log(`  4. Run: npx tsx scripts/find-product-docs.ts --update-cache`);
  console.log();
}

// ─── Evidence Summary Generation ──────────────────────────────────────────────

function generateEvidenceSummary(targets: GapTarget[]): string {
  const lines: string[] = [];

  lines.push(`# Product Documentation Evidence Summary`);
  lines.push(``);
  lines.push(`**Generated:** ${new Date().toISOString().split('T')[0]}`);
  lines.push(`**Gap Targets:** ${targets.length}`);
  lines.push(``);
  lines.push(`## Evidence Tiers`);
  lines.push(``);
  lines.push(`- **Tier 1 (Strong):** Multiple product docs found covering primary sectors`);
  lines.push(`- **Tier 2 (Partial):** Some docs but incomplete sector coverage`);
  lines.push(`- **Tier 3 (Manual Needed):** No docs found, needs manual search or alternative sources`);
  lines.push(``);
  lines.push(`## Status: Pending Web Search`);
  lines.push(``);
  lines.push(`The following targets need product documentation. Run web searches interactively`);
  lines.push(`in a Claude session to find technical docs, datasheets, and whitepapers.`);
  lines.push(``);

  // High exposure targets (top 20)
  lines.push(`### Priority 1: High Exposure Targets (${Math.min(20, targets.length)} targets)`);
  lines.push(``);
  for (const t of targets.slice(0, 20)) {
    lines.push(`#### ${t.company}`);
    lines.push(`- **Slug:** ${t.slug}`);
    lines.push(`- **Patents Exposed:** ${t.totalPatentsExposed}`);
    lines.push(`- **Sectors:** ${t.topSectors.join(', ')}`);
    if (t.products.size > 0) {
      lines.push(`- **Known Products:** ${[...t.products].slice(0, 5).join('; ')}`);
    }
    lines.push(`- **Evidence Tier:** Pending`);
    lines.push(`- **Search Queries:**`);
    for (const q of t.queries) {
      lines.push(`  - \`${q}\``);
    }
    lines.push(``);
  }

  // Medium exposure targets
  if (targets.length > 20) {
    lines.push(`### Priority 2: Medium Exposure Targets (${targets.length - 20} targets)`);
    lines.push(``);
    lines.push(`| Company | Patents | Sectors | Products Known |`);
    lines.push(`|---------|---------|---------|----------------|`);
    for (const t of targets.slice(20)) {
      lines.push(`| ${t.company} | ${t.totalPatentsExposed} | ${t.topSectors.slice(0, 3).join(', ')} | ${t.products.size > 0 ? 'Yes' : 'No'} |`);
    }
    lines.push(``);
  }

  return lines.join('\n');
}

// ─── Update Cache (Phase B Step 6) ──────────────────────────────────────────

function updateProductCache() {
  console.log(`\n=== Update Product Cache from Found URLs ===`);

  const urlsPath = path.join(summaryDir, 'product-doc-urls.csv');
  if (!fs.existsSync(urlsPath)) {
    console.error('product-doc-urls.csv not found');
    process.exit(1);
  }

  const urlLines = fs.readFileSync(urlsPath, 'utf-8').split('\n').filter(l => l.trim());
  if (urlLines.length <= 1) {
    console.log('No URLs found in product-doc-urls.csv. Add URLs first.');
    return;
  }

  const urlHeaders = parseCSVLine(urlLines[0]);
  let created = 0;
  let updated = 0;

  for (let i = 1; i < urlLines.length; i++) {
    const fields = parseCSVLine(urlLines[i]);
    const company = fields[urlHeaders.indexOf('Company')] || fields[0] || '';
    const companySlug = fields[urlHeaders.indexOf('Slug')] || fields[1] || slugify(company);
    const product = fields[urlHeaders.indexOf('Product')] || fields[2] || '';
    const url = fields[urlHeaders.indexOf('URL')] || fields[3] || '';
    const docType = fields[urlHeaders.indexOf('DocType')] || fields[4] || 'documentation';

    if (!company || !url || !product) continue;

    const productSlug = slugify(product);
    const productDir = path.resolve(`./cache/patlytics/products/${companySlug}`);
    const productFile = path.join(productDir, `${productSlug}.json`);

    fs.mkdirSync(productDir, { recursive: true });

    if (fs.existsSync(productFile)) {
      // Update existing product cache
      const existing = JSON.parse(fs.readFileSync(productFile, 'utf-8'));
      const existingUrls = new Set(existing.documents?.map((d: any) => d.documentUrl) || []);
      if (!existingUrls.has(url)) {
        existing.documents = existing.documents || [];
        existing.documents.push({
          documentName: `${product} - ${docType}`,
          documentUrl: url,
          patlyticsStoredUrl: null,
          localPath: null,
          downloadStatus: 'pending',
          patentScores: {},
        });
        existing.docsFoundCount = existing.documents.length;
        existing.updatedAt = new Date().toISOString();
        fs.writeFileSync(productFile, JSON.stringify(existing, null, 2));
        updated++;
      }
    } else {
      // Create new product cache entry
      const productCache = {
        companySlug,
        companyName: company,
        productSlug,
        productName: product,
        docsFoundCount: 1,
        documents: [{
          documentName: `${product} - ${docType}`,
          documentUrl: url,
          patlyticsStoredUrl: null,
          localPath: null,
          downloadStatus: 'pending',
          patentScores: {},
        }],
        patents: {},
        sourceFiles: [],
        importedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      fs.writeFileSync(productFile, JSON.stringify(productCache, null, 2));
      created++;
    }
  }

  console.log(`Created ${created} new product caches, updated ${updated} existing`);
}

// ─── Run ──────────────────────────────────────────────────────────────────────

if (args.includes('--update-cache')) {
  updateProductCache();
} else {
  main();
}
