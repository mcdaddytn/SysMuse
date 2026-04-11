/**
 * Preflight Batch Readiness Checker
 *
 * Validates readiness before committing to an expensive scoring batch.
 * Reports: target CSV coverage, doc availability, summary gaps, cost estimates.
 *
 * Usage:
 *   npx tsx scripts/preflight-batch.ts [options]
 *     --super-sector <key>       Required unless --from-targets
 *     --from-targets <csv>       Vendor-targets CSV (overrides super-sector CSV discovery)
 *     --company <slug>           Restrict to one company
 *     --max-docs-per-product <n> Cap docs per product (0 = no limit, default)
 *     --generate-summaries       Auto-run summarization for gaps
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  getAllProductCaches,
  readProductCache,
  slugify,
  normalizePatentId,
  type ProductCache,
} from '../src/api/services/patlytics-cache-service.js';

const SUPER_SECTORS_CONFIG = path.resolve('./config/super-sectors.json');
const VENDOR_EXPORTS_DIR = path.resolve('./output/vendor-exports');
const SUMMARIES_V2_DIR = path.resolve('./cache/product-summaries-v2');
const SCORES_DIR = path.resolve('./cache/infringement-scores');
const GLSSD2_BASE = '/Volumes/GLSSD2/data/products/docs';

// ── CLI ──────────────────────────────────────────────────────────────────

interface Config {
  superSector: string | null;
  fromTargets: string | null;
  company: string | null;
  maxDocsPerProduct: number;
  generateSummaries: boolean;
}

function parseArgs(): Config {
  const args = process.argv.slice(2);
  const config: Config = {
    superSector: null,
    fromTargets: null,
    company: null,
    maxDocsPerProduct: 0,
    generateSummaries: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--super-sector' && args[i + 1]) config.superSector = args[++i];
    else if (arg === '--from-targets' && args[i + 1]) config.fromTargets = args[++i];
    else if (arg === '--company' && args[i + 1]) config.company = args[++i];
    else if (arg === '--max-docs-per-product' && args[i + 1]) config.maxDocsPerProduct = parseInt(args[++i], 10);
    else if (arg === '--generate-summaries') config.generateSummaries = true;
  }

  return config;
}

// ── Super-Sector Config ─────────────────────────────────────────────────

let _superSectorConfig: any = null;
function getSuperSectorConfig(): any {
  if (!_superSectorConfig) {
    _superSectorConfig = JSON.parse(fs.readFileSync(SUPER_SECTORS_CONFIG, 'utf-8'));
  }
  return _superSectorConfig;
}

function getSectorsForSuperSector(ssKey: string): string[] {
  const config = getSuperSectorConfig();
  const ss = config.superSectors[ssKey];
  return ss ? ss.sectors : [];
}

// ── Target CSV Discovery ────────────────────────────────────────────────

interface TargetRow {
  patentId: string;
  companySlug: string;
  productSlug: string | null;
  sectorName: string | null;
}

function discoverTargetCSVs(superSectorKey: string): string[] {
  const sectors = getSectorsForSuperSector(superSectorKey);
  const csvPaths: string[] = [];

  if (!fs.existsSync(VENDOR_EXPORTS_DIR)) return csvPaths;

  const exportDirs = fs.readdirSync(VENDOR_EXPORTS_DIR).filter(d => {
    return fs.statSync(path.join(VENDOR_EXPORTS_DIR, d)).isDirectory();
  });

  // Find the most recent export dir for each sector
  const sectorDirs = new Map<string, string>();
  for (const dir of exportDirs) {
    for (const sector of sectors) {
      if (dir.startsWith(sector + '-')) {
        const existing = sectorDirs.get(sector);
        if (!existing || dir > existing) {
          sectorDirs.set(sector, dir);
        }
      }
    }
  }

  for (const [sector, dir] of sectorDirs) {
    const pivotPath = path.join(VENDOR_EXPORTS_DIR, dir, 'vendor-targets-pivot.csv');
    const targetPath = path.join(VENDOR_EXPORTS_DIR, dir, 'vendor-targets.csv');
    if (fs.existsSync(pivotPath)) csvPaths.push(pivotPath);
    else if (fs.existsSync(targetPath)) csvPaths.push(targetPath);
  }

  return csvPaths;
}

function parseTargetCSV(csvPath: string): TargetRow[] {
  const rows: TargetRow[] = [];
  const content = fs.readFileSync(csvPath, 'utf-8');
  const lines = content.split('\n').filter(l => l.trim());
  if (lines.length < 2) return rows;

  const header = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
  const findCol = (...names: string[]) => {
    for (const n of names) { const i = header.indexOf(n); if (i >= 0) return i; }
    return -1;
  };

  const patentIdx = findCol('patent_id', 'PatentId', 'patentId');
  const companyIdx = findCol('company_slug', 'target_company_slug', 'Target');
  const productIdx = findCol('product_slug', 'target_product_slug', 'TargetProduct');
  const sectorIdx = findCol('Sector', 'sector', 'sector_name');

  if (patentIdx === -1 || companyIdx === -1) return rows;

  // Extract sector name from directory name (e.g., "network-threat-protection-2026-03-11" → "network-threat-protection")
  const dirName = path.basename(path.dirname(csvPath));
  const dirSector = dirName.replace(/-\d{4}-\d{2}-\d{2}$/, '');

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map(c => c.trim().replace(/"/g, ''));
    const rawPatentId = cols[patentIdx];
    const rawCompany = cols[companyIdx];
    const rawProduct = productIdx !== -1 ? cols[productIdx] : null;
    const sectorName = sectorIdx !== -1 ? cols[sectorIdx] : dirSector;

    if (!rawPatentId || !rawCompany) continue;
    // Skip narrative rows (e.g., "Primary targets include...")
    if (rawCompany.includes('targets include') || rawCompany.includes('include ')) continue;

    rows.push({
      patentId: normalizePatentId(rawPatentId).patentId,
      companySlug: slugify(rawCompany),
      productSlug: rawProduct ? slugify(rawProduct) : null,
      sectorName: sectorName || null,
    });
  }

  return rows;
}

// ── Doc Discovery ───────────────────────────────────────────────────────

interface DocInfo {
  companySlug: string;
  productSlug: string;
  docSlug: string;
  documentName: string;
  textPath: string;
  hasSummary: boolean;
  source: 'patlytics' | 'glssd2';
}

function discoverDocs(companySlug: string, productSlug: string | null): DocInfo[] {
  const docs: DocInfo[] = [];
  const seen = new Set<string>();

  // Patlytics product cache docs
  const allProducts = getAllProductCaches().filter(p => p.companySlug === companySlug);
  const products = productSlug ? allProducts.filter(p => p.productSlug === productSlug) : allProducts;

  for (const productMeta of products) {
    const product = readProductCache(productMeta.companySlug, productMeta.productSlug);
    if (!product) continue;

    for (const doc of product.documents) {
      if (doc.downloadStatus !== 'completed' || !doc.localPath) continue;

      const docBase = path.basename(doc.localPath, path.extname(doc.localPath));
      const docSlug = slugify(doc.documentName || docBase);
      const textPath = (doc as any).extractedTextPath ||
        path.join(path.dirname(doc.localPath), `${docBase}.txt`);
      if (!fs.existsSync(textPath)) continue;

      const key = `${product.companySlug}/${product.productSlug}/${docSlug}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const summaryFile = path.join(SUMMARIES_V2_DIR, product.companySlug, product.productSlug, `${docSlug}.json`);

      docs.push({
        companySlug: product.companySlug,
        productSlug: product.productSlug,
        docSlug,
        documentName: doc.documentName,
        textPath,
        hasSummary: fs.existsSync(summaryFile),
        source: 'patlytics',
      });
    }
  }

  // GLSSD2 docs
  if (fs.existsSync(GLSSD2_BASE)) {
    const companyDir = path.join(GLSSD2_BASE, companySlug);
    if (fs.existsSync(companyDir)) {
      let productDirs: string[];
      try {
        productDirs = fs.readdirSync(companyDir).filter(d => {
          if (d.startsWith('.') || d.startsWith('._')) return false;
          try { return fs.statSync(path.join(companyDir, d)).isDirectory(); } catch { return false; }
        });
      } catch { productDirs = []; }

      if (productSlug) productDirs = productDirs.filter(d => d === productSlug);

      for (const pSlug of productDirs) {
        const pDir = path.join(companyDir, pSlug);
        let files: string[];
        try { files = fs.readdirSync(pDir).filter(f => !f.startsWith('._')); } catch { continue; }

        for (const file of files) {
          const ext = path.extname(file).toLowerCase();
          if (ext !== '.txt' && ext !== '.html') continue;

          const fullPath = path.join(pDir, file);
          const docBase = path.basename(file, ext);
          const dSlug = slugify(docBase);
          const key = `${companySlug}/${pSlug}/${dSlug}`;
          if (seen.has(key)) continue;
          seen.add(key);

          const summaryFile = path.join(SUMMARIES_V2_DIR, companySlug, pSlug, `${dSlug}.json`);

          docs.push({
            companySlug,
            productSlug: pSlug,
            docSlug: dSlug,
            documentName: docBase,
            textPath: fullPath,
            hasSummary: fs.existsSync(summaryFile),
            source: 'glssd2',
          });
        }
      }
    }
  }

  return docs;
}

/** Cap docs per product by file size (prefer richest docs). */
function capDocsBySize(docs: DocInfo[], maxDocs: number): DocInfo[] {
  if (maxDocs <= 0 || docs.length <= maxDocs) return docs;
  return docs
    .map(d => {
      let size = 0;
      try { size = fs.statSync(d.textPath).size; } catch {}
      return { doc: d, size };
    })
    .sort((a, b) => b.size - a.size)
    .slice(0, maxDocs)
    .map(d => d.doc);
}

// ── Score Cache Check ───────────────────────────────────────────────────

function isScored(companySlug: string, productSlug: string, patentId: string): boolean {
  const filePath = path.join(SCORES_DIR, companySlug, productSlug, `${patentId}.json`);
  return fs.existsSync(filePath);
}

// ── Main ────────────────────────────────────────────────────────────────

async function main() {
  const config = parseArgs();

  if (!config.superSector && !config.fromTargets) {
    console.error('Error: Specify --super-sector or --from-targets');
    process.exit(1);
  }

  const ssKey = config.superSector || '(custom)';
  console.log(`\n=== ${ssKey} Batch Preflight ===\n`);

  // Discover target CSVs
  let targetRows: TargetRow[] = [];
  let csvPaths: string[] = [];

  if (config.fromTargets) {
    csvPaths = [config.fromTargets];
    targetRows = parseTargetCSV(config.fromTargets);
    console.log(`Target CSV: ${config.fromTargets}`);
  } else if (config.superSector) {
    csvPaths = discoverTargetCSVs(config.superSector);
    console.log(`Target CSVs found: ${csvPaths.length}`);
    for (const csv of csvPaths) {
      const rows = parseTargetCSV(csv);
      const dir = path.basename(path.dirname(csv));
      console.log(`  ${dir}: ${rows.length} rows`);
      targetRows.push(...rows);
    }
  }

  if (config.company) {
    targetRows = targetRows.filter(r => r.companySlug === config.company);
  }

  console.log(`\nTotal target rows: ${targetRows.length}`);

  // Unique patents and companies
  const uniquePatents = new Set(targetRows.map(r => r.patentId));
  const uniqueCompanies = new Set(targetRows.map(r => r.companySlug));
  console.log(`Unique patents: ${uniquePatents.size}`);
  console.log(`Unique companies: ${uniqueCompanies.size}`);

  // Discover docs for each company
  console.log('\nDiscovering product docs...');
  if (config.maxDocsPerProduct > 0) console.log(`  Doc cap: max ${config.maxDocsPerProduct} docs per product`);
  let totalDocs = 0;
  let docsWithText = 0;
  let docsWithSummary = 0;
  let alreadyScored = 0;
  let totalPairs = 0;
  let docsBeforeCap = 0;
  let productsCapped = 0;
  const companyStats: Array<{
    company: string;
    docs: number;
    summaries: number;
    pairs: number;
    scored: number;
  }> = [];

  const productDocsCache = new Map<string, DocInfo[]>();

  for (const company of uniqueCompanies) {
    // Get all products for this company from targets
    const companyTargets = targetRows.filter(r => r.companySlug === company);
    const targetProducts = new Set(companyTargets.map(r => r.productSlug).filter(Boolean));

    // Discover docs — if targets specify products, get docs for each; otherwise get all
    let companyDocs: DocInfo[];
    if (targetProducts.size > 0) {
      companyDocs = [];
      const seen = new Set<string>();
      for (const prodSlug of targetProducts) {
        let docs = discoverDocs(company, prodSlug!);
        // Apply per-product doc cap
        if (config.maxDocsPerProduct > 0) {
          docsBeforeCap += docs.length;
          if (docs.length > config.maxDocsPerProduct) productsCapped++;
          docs = capDocsBySize(docs, config.maxDocsPerProduct);
        }
        for (const d of docs) {
          const key = `${d.companySlug}/${d.productSlug}/${d.docSlug}`;
          if (!seen.has(key)) { companyDocs.push(d); seen.add(key); }
        }
      }
      // Also get docs for unspecified products (company-level targeting)
      if (companyTargets.some(r => !r.productSlug)) {
        const allDocs = discoverDocs(company, null);
        // Group by product for capping
        const byProduct = new Map<string, DocInfo[]>();
        for (const d of allDocs) {
          const existing = byProduct.get(d.productSlug) || [];
          existing.push(d);
          byProduct.set(d.productSlug, existing);
        }
        for (const [, prodDocs] of byProduct) {
          if (config.maxDocsPerProduct > 0) {
            docsBeforeCap += prodDocs.length;
            if (prodDocs.length > config.maxDocsPerProduct) productsCapped++;
          }
          const capped = capDocsBySize(prodDocs, config.maxDocsPerProduct);
          for (const d of capped) {
            const key = `${d.companySlug}/${d.productSlug}/${d.docSlug}`;
            if (!seen.has(key)) { companyDocs.push(d); seen.add(key); }
          }
        }
      }
    } else {
      const allDocs = discoverDocs(company, null);
      // Group by product for capping
      const byProduct = new Map<string, DocInfo[]>();
      for (const d of allDocs) {
        const existing = byProduct.get(d.productSlug) || [];
        existing.push(d);
        byProduct.set(d.productSlug, existing);
      }
      companyDocs = [];
      for (const [, prodDocs] of byProduct) {
        if (config.maxDocsPerProduct > 0) {
          docsBeforeCap += prodDocs.length;
          if (prodDocs.length > config.maxDocsPerProduct) productsCapped++;
        }
        companyDocs.push(...capDocsBySize(prodDocs, config.maxDocsPerProduct));
      }
    }

    productDocsCache.set(company, companyDocs);

    const summaryCount = companyDocs.filter(d => d.hasSummary).length;

    // Count pairs: each patent × each doc
    const companyPatents = new Set(companyTargets.map(r => r.patentId));
    let pairCount = 0;
    let scoredCount = 0;
    for (const patentId of companyPatents) {
      for (const doc of companyDocs) {
        pairCount++;
        if (isScored(doc.companySlug, doc.productSlug, patentId)) scoredCount++;
      }
    }

    totalDocs += companyDocs.length;
    docsWithText += companyDocs.length; // they all have text (discovery filters for it)
    docsWithSummary += summaryCount;
    totalPairs += pairCount;
    alreadyScored += scoredCount;

    companyStats.push({
      company,
      docs: companyDocs.length,
      summaries: summaryCount,
      pairs: pairCount,
      scored: scoredCount,
    });
  }

  // Report
  if (config.maxDocsPerProduct > 0 && productsCapped > 0) {
    console.log(`\nDoc cap: ${productsCapped} products reduced from ${docsBeforeCap} to ${totalDocs} docs (cap=${config.maxDocsPerProduct})`);
  }
  console.log(`\nUnique products with docs: ${totalDocs}`);
  console.log(`  Docs with text: ${docsWithText} / ${docsWithText}`);
  const summaryPct = docsWithText > 0 ? ((docsWithSummary / docsWithText) * 100).toFixed(0) : '0';
  const summaryGap = docsWithText - docsWithSummary;
  console.log(`  Docs with summaries: ${docsWithSummary} / ${docsWithText} (${summaryPct}%)${summaryGap > 0 ? ' ← GAP' : ''}`);
  console.log(`  Already scored pairs: ${alreadyScored} / ${totalPairs}`);

  // Company breakdown (top 15)
  const sortedCompanies = companyStats.sort((a, b) => b.pairs - a.pairs);
  console.log(`\n${'Company'.padEnd(30)} ${'Docs'.padStart(6)} ${'Summ'.padStart(6)} ${'Pairs'.padStart(8)} ${'Scored'.padStart(8)}`);
  console.log('─'.repeat(60));
  for (const c of sortedCompanies.slice(0, 15)) {
    console.log(`${c.company.substring(0, 29).padEnd(30)} ${String(c.docs).padStart(6)} ${String(c.summaries).padStart(6)} ${String(c.pairs).padStart(8)} ${String(c.scored).padStart(8)}`);
  }
  if (sortedCompanies.length > 15) {
    console.log(`  ... and ${sortedCompanies.length - 15} more companies`);
  }

  // Cost estimates
  const unscoredPairs = totalPairs - alreadyScored;
  const summaryCostPerDoc = 0.002; // Haiku default
  const summaryCost = summaryGap * summaryCostPerDoc;
  const pass0Cost = unscoredPairs * 0.003;
  const pass0PassRate = 0.80; // estimate 80% pass pass0
  const pass1Count = Math.round(unscoredPairs * pass0PassRate);
  const pass1Cost = pass1Count * 0.008;
  const pass2Rate = 0.30; // estimate 30% pass pass1
  const pass2Count = Math.round(pass1Count * pass2Rate);
  const pass2Cost = pass2Count * 0.015;
  const totalCost = summaryCost + pass0Cost + pass1Cost + pass2Cost;

  console.log('\nCost Estimate:');
  if (summaryGap > 0) {
    console.log(`  Summary generation (${summaryGap} docs × $${summaryCostPerDoc}/doc Haiku): ~$${summaryCost.toFixed(2)}`);
  }
  console.log(`  Pass0 screening (${unscoredPairs} pairs): ~$${pass0Cost.toFixed(2)}`);
  console.log(`  Pass1 (est ${(pass0PassRate * 100).toFixed(0)}% pass pass0): ~${pass1Count} pairs × ~$0.008 = ~$${pass1Cost.toFixed(2)}`);
  console.log(`  Pass2 (est ${(pass2Rate * 100).toFixed(0)}% pass pass1): ~${pass2Count} pairs × ~$0.015 = ~$${pass2Cost.toFixed(2)}`);
  console.log(`  Total: ~$${totalCost.toFixed(2)}`);

  // Generate summaries if requested
  if (config.generateSummaries && summaryGap > 0) {
    console.log(`\n--- Auto-generating ${summaryGap} summaries ---`);
    console.log(`Run: npx tsx scripts/summarize-production-docs.ts${config.company ? ` --company ${config.company}` : ''}${config.superSector ? ` --super-sector ${config.superSector}` : ''} --concurrency 5`);
    console.log('(Auto-execution not implemented — run the above command manually)');
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
