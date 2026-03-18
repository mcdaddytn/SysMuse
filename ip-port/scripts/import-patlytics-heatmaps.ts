/**
 * Import Patlytics heatmap spreadsheets into JSON cache.
 *
 * Usage:
 *   npx tsx scripts/import-patlytics-heatmaps.ts [options]
 *     --source-dir <path>   (default: /Volumes/GLSSD2/data/products/patlytics/)
 *     --single <file>       Import one file only
 *     --dry-run             Parse and report without writing
 *     --force               Overwrite existing cache
 *     --verbose             Detailed per-row output
 */

import * as fs from 'fs';
import * as path from 'path';
import XLSX from 'xlsx';
import {
  slugify,
  normalizePatentId,
  parseProductHeader,
  ensureCacheDirs,
  readPatentCache,
  writePatentCache,
  readProductCache,
  writeProductCache,
  writeSourceCache,
  readManifest,
  writeManifest,
  readCompaniesIndex,
  writeCompaniesIndex,
  matchCompanyToCompetitor,
  type PatentCache,
  type PatentProduct,
  type PatentProductScore,
  type ProductCache,
  type ProductDocument,
  type DocumentPatentScore,
  type SourceManifestEntry,
  type CompanyEntry,
  type ParsedProductHeader,
} from '../src/api/services/patlytics-cache-service.js';

// ── Config ─────────────────────────────────────────────────────────────────

const DEFAULT_SOURCE_DIR = '/Volumes/GLSSD2/data/products/patlytics/';
const HOT_THRESHOLD = 0.80;

// ── Arg Parsing ────────────────────────────────────────────────────────────

interface ImportArgs {
  sourceDir: string;
  singleFile: string | null;
  dryRun: boolean;
  force: boolean;
  verbose: boolean;
}

function parseArgs(): ImportArgs {
  const args = process.argv.slice(2);
  let sourceDir = DEFAULT_SOURCE_DIR;
  let singleFile: string | null = null;
  let dryRun = false;
  let force = false;
  let verbose = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--source-dir' && args[i + 1]) {
      sourceDir = args[++i];
    } else if (arg === '--single' && args[i + 1]) {
      singleFile = args[++i];
    } else if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--force') {
      force = true;
    } else if (arg === '--verbose') {
      verbose = true;
    }
  }

  return { sourceDir, singleFile, dryRun, force, verbose };
}

// ── Spreadsheet Parsing ────────────────────────────────────────────────────

interface ParsedAnalysisRow {
  fullPatentId: string;
  patentId: string;
  title: string;
  inventors: string;
  patlyticsLink: string | null;
  productScores: Map<string, { score: number; product: ParsedProductHeader }>;
}

interface ParsedDocumentRow {
  companyName: string;
  productName: string;
  documentName: string;
  documentUrl: string | null;
  patlyticsStoredUrl: string | null;
  patentScores: Map<string, number>;
  patentNarratives: Map<string, string>;
}

interface ParsedSpreadsheet {
  sourceSlug: string;
  fileName: string;
  analysisRows: ParsedAnalysisRow[];
  productHeaders: ParsedProductHeader[];
  documentRows: ParsedDocumentRow[];
}

function getCellValue(ws: XLSX.WorkSheet, row: number, col: number): string {
  const addr = XLSX.utils.encode_cell({ r: row, c: col });
  const cell = ws[addr];
  if (!cell) return '';
  return String(cell.v ?? '').trim();
}

function getCellNumber(ws: XLSX.WorkSheet, row: number, col: number): number | null {
  const addr = XLSX.utils.encode_cell({ r: row, c: col });
  const cell = ws[addr];
  if (!cell || cell.v === undefined || cell.v === null || cell.v === '') return null;
  const num = Number(cell.v);
  return isNaN(num) ? null : num;
}

function getCellHyperlink(ws: XLSX.WorkSheet, row: number, col: number): string | null {
  const addr = XLSX.utils.encode_cell({ r: row, c: col });
  const cell = ws[addr];
  if (!cell) return null;

  // SheetJS stores hyperlinks in cell.l.Target
  if (cell.l && cell.l.Target) {
    return cell.l.Target;
  }
  return null;
}

function getSheetRange(ws: XLSX.WorkSheet): { maxRow: number; maxCol: number } {
  const ref = ws['!ref'];
  if (!ref) return { maxRow: 0, maxCol: 0 };
  const range = XLSX.utils.decode_range(ref);
  return { maxRow: range.e.r, maxCol: range.e.c };
}

function parseAnalysisTab(ws: XLSX.WorkSheet, verbose: boolean): {
  rows: ParsedAnalysisRow[];
  productHeaders: ParsedProductHeader[];
} {
  const { maxRow, maxCol } = getSheetRange(ws);
  if (maxRow < 2 || maxCol < 4) {
    console.warn('  ⚠ Analysis tab appears empty or too small');
    return { rows: [], productHeaders: [] };
  }

  // Row 1 (index 1) = headers. Cols E+ (index 4+) are product columns
  const productHeaders: ParsedProductHeader[] = [];
  for (let col = 4; col <= maxCol; col++) {
    const headerText = getCellValue(ws, 1, col);
    if (!headerText) continue;
    productHeaders.push(parseProductHeader(headerText));
  }

  if (verbose) {
    console.log(`  Products found: ${productHeaders.length}`);
    for (const ph of productHeaders) {
      console.log(`    - ${ph.productName} (${ph.companyName}) [${ph.docsFoundCount} docs]`);
    }
  }

  // Row 2+ (index 2+) = patent data
  const rows: ParsedAnalysisRow[] = [];
  for (let row = 2; row <= maxRow; row++) {
    const rawId = getCellValue(ws, row, 0);
    if (!rawId) continue;

    const { patentId, fullId } = normalizePatentId(rawId);
    const title = getCellValue(ws, row, 1);
    const inventors = getCellValue(ws, row, 2);
    const patlyticsLink = getCellHyperlink(ws, row, 3);

    const productScores = new Map<string, { score: number; product: ParsedProductHeader }>();
    for (let col = 4; col <= maxCol; col++) {
      const headerIdx = col - 4;
      if (headerIdx >= productHeaders.length) break;
      const score = getCellNumber(ws, row, col);
      if (score !== null && score > 0) {
        const ph = productHeaders[headerIdx];
        const key = `${slugify(ph.companyName)}/${slugify(ph.productName)}`;
        productScores.set(key, { score, product: ph });
      }
    }

    rows.push({
      fullPatentId: fullId,
      patentId,
      title,
      inventors,
      patlyticsLink,
      productScores,
    });

    if (verbose && productScores.size > 0) {
      const maxScore = Math.max(...[...productScores.values()].map(v => v.score));
      console.log(`  Patent ${patentId}: ${productScores.size} product scores (max: ${maxScore.toFixed(2)})`);
    }
  }

  return { rows, productHeaders };
}

function parseDocumentLinksTab(ws: XLSX.WorkSheet, verbose: boolean): ParsedDocumentRow[] {
  const { maxRow, maxCol } = getSheetRange(ws);
  if (maxRow < 2 || maxCol < 5) {
    if (verbose) console.log('  ⚠ Document Links tab appears empty or too small');
    return [];
  }

  // Row 1 (index 1) = headers. Cols F+ (index 5+) are patent ID columns
  const patentIds: string[] = [];
  for (let col = 5; col <= maxCol; col++) {
    const raw = getCellValue(ws, 1, col);
    if (!raw) continue;
    const { patentId } = normalizePatentId(raw);
    patentIds.push(patentId);
  }

  if (verbose) {
    console.log(`  Document Links: ${patentIds.length} patent columns`);
  }

  // Rows come in pairs: odd = data row, even = narrative row
  const documents: ParsedDocumentRow[] = [];
  for (let row = 2; row <= maxRow; row += 2) {
    const companyName = getCellValue(ws, row, 0);
    const productName = getCellValue(ws, row, 1);
    const documentName = getCellValue(ws, row, 2);

    // Skip empty rows
    if (!companyName && !productName && !documentName) continue;

    const documentUrl = getCellHyperlink(ws, row, 3);
    const patlyticsStoredUrl = getCellHyperlink(ws, row, 4);

    // Read patent scores from data row
    const patentScores = new Map<string, number>();
    for (let col = 5; col <= maxCol; col++) {
      const pIdx = col - 5;
      if (pIdx >= patentIds.length) break;
      const score = getCellNumber(ws, row, col);
      if (score !== null && score > 0) {
        patentScores.set(patentIds[pIdx], score);
      }
    }

    // Read narratives from the next (even) row
    const patentNarratives = new Map<string, string>();
    const narrativeRow = row + 1;
    if (narrativeRow <= maxRow) {
      for (let col = 5; col <= maxCol; col++) {
        const pIdx = col - 5;
        if (pIdx >= patentIds.length) break;
        const narrative = getCellValue(ws, narrativeRow, col);
        if (narrative) {
          patentNarratives.set(patentIds[pIdx], narrative);
        }
      }
    }

    documents.push({
      companyName,
      productName,
      documentName,
      documentUrl,
      patlyticsStoredUrl,
      patentScores,
      patentNarratives,
    });

    if (verbose) {
      console.log(`  Doc: "${documentName}" [${patentScores.size} scores, ${patentNarratives.size} narratives]`);
    }
  }

  return documents;
}

function parseSpreadsheet(filePath: string, verbose: boolean): ParsedSpreadsheet {
  const fileName = path.basename(filePath);
  const sourceSlug = slugify(path.basename(filePath, '.xlsx'));

  console.log(`\nParsing: ${fileName}`);

  const workbook = XLSX.readFile(filePath, { cellStyles: false, cellHTML: false });
  const sheetNames = workbook.SheetNames;

  if (verbose) {
    console.log(`  Sheets: ${sheetNames.join(', ')}`);
  }

  // Find Analysis tab (usually first sheet or named "Analysis")
  const analysisSheet = workbook.Sheets[sheetNames[0]];
  const { rows: analysisRows, productHeaders } = parseAnalysisTab(analysisSheet, verbose);

  // Find Document Links tab
  let documentRows: ParsedDocumentRow[] = [];
  const docLinksIdx = sheetNames.findIndex(n =>
    n.toLowerCase().includes('document') || n.toLowerCase().includes('links')
  );
  if (docLinksIdx >= 0) {
    const docSheet = workbook.Sheets[sheetNames[docLinksIdx]];
    documentRows = parseDocumentLinksTab(docSheet, verbose);
  } else if (sheetNames.length > 1) {
    // Try second sheet as fallback
    const docSheet = workbook.Sheets[sheetNames[1]];
    documentRows = parseDocumentLinksTab(docSheet, verbose);
  }

  console.log(`  → ${analysisRows.length} patents, ${productHeaders.length} products, ${documentRows.length} documents`);

  return { sourceSlug, fileName, analysisRows, productHeaders, documentRows };
}

// ── Cache Merge Logic ──────────────────────────────────────────────────────

function mergeIntoPatentCache(
  parsed: ParsedSpreadsheet,
  force: boolean,
  dryRun: boolean,
  verbose: boolean
): Set<string> {
  const now = new Date().toISOString();
  const updatedPatentIds = new Set<string>();

  for (const row of parsed.analysisRows) {
    const existing = force ? null : readPatentCache(row.patentId);
    const patent: PatentCache = existing ?? {
      patentId: row.patentId,
      fullPatentId: row.fullPatentId,
      title: row.title,
      inventors: row.inventors,
      patlyticsLink: row.patlyticsLink,
      products: [],
      hotProductCount: 0,
      maxScoreOverall: 0,
      sourceFiles: [],
      importedAt: now,
      updatedAt: now,
    };

    // Update metadata if we have better info
    if (row.title && (!patent.title || patent.title === '')) patent.title = row.title;
    if (row.inventors && (!patent.inventors || patent.inventors === '')) patent.inventors = row.inventors;
    if (row.patlyticsLink && !patent.patlyticsLink) patent.patlyticsLink = row.patlyticsLink;

    // Merge product scores
    for (const [key, { score, product }] of row.productScores) {
      const companySlug = slugify(product.companyName);
      const productSlug = slugify(product.productName);

      let existingProduct = patent.products.find(
        p => p.companySlug === companySlug && p.productSlug === productSlug
      );

      if (!existingProduct) {
        existingProduct = {
          companySlug,
          companyName: product.companyName,
          productSlug,
          productName: product.productName,
          scores: [],
          maxScore: 0,
          isHot: false,
        };
        patent.products.push(existingProduct);
      }

      // Check if this source already has a score entry
      const existingScoreIdx = existingProduct.scores.findIndex(
        s => s.sourceFile === parsed.sourceSlug
      );
      const scoreEntry: PatentProductScore = {
        score,
        sourceFile: parsed.sourceSlug,
        importedAt: now,
      };

      if (existingScoreIdx >= 0) {
        existingProduct.scores[existingScoreIdx] = scoreEntry;
      } else {
        existingProduct.scores.push(scoreEntry);
      }

      existingProduct.maxScore = Math.max(...existingProduct.scores.map(s => s.score));
      existingProduct.isHot = existingProduct.maxScore >= HOT_THRESHOLD;
    }

    // Recalculate aggregates
    patent.hotProductCount = patent.products.filter(p => p.isHot).length;
    patent.maxScoreOverall = patent.products.length > 0
      ? Math.max(...patent.products.map(p => p.maxScore))
      : 0;

    // Track source files
    if (!patent.sourceFiles.includes(parsed.sourceSlug)) {
      patent.sourceFiles.push(parsed.sourceSlug);
    }
    patent.updatedAt = now;

    if (!dryRun) {
      writePatentCache(row.patentId, patent);
    }
    updatedPatentIds.add(row.patentId);
  }

  return updatedPatentIds;
}

function mergeIntoProductCache(
  parsed: ParsedSpreadsheet,
  force: boolean,
  dryRun: boolean,
  verbose: boolean
): { productKeys: Set<string>; docCount: number } {
  const now = new Date().toISOString();
  const productKeys = new Set<string>();
  let docCount = 0;

  // Build a map of products from analysis tab headers
  const productMap = new Map<string, ParsedProductHeader>();
  for (const ph of parsed.productHeaders) {
    const key = `${slugify(ph.companyName)}/${slugify(ph.productName)}`;
    productMap.set(key, ph);
  }

  // Also gather products from document links tab
  for (const doc of parsed.documentRows) {
    if (doc.companyName && doc.productName) {
      const key = `${slugify(doc.companyName)}/${slugify(doc.productName)}`;
      if (!productMap.has(key)) {
        productMap.set(key, {
          productName: doc.productName,
          companyName: doc.companyName,
          docsFoundCount: 0,
        });
      }
    }
  }

  // For each product, build/merge cache
  for (const [key, ph] of productMap) {
    const companySlug = slugify(ph.companyName);
    const productSlug = slugify(ph.productName);
    productKeys.add(key);

    const existing = force ? null : readProductCache(companySlug, productSlug);
    const product: ProductCache = existing ?? {
      companySlug,
      companyName: ph.companyName,
      productSlug,
      productName: ph.productName,
      docsFoundCount: ph.docsFoundCount,
      documents: [],
      patents: {},
      sourceFiles: [],
      importedAt: now,
      updatedAt: now,
    };

    if (ph.docsFoundCount > 0) {
      product.docsFoundCount = Math.max(product.docsFoundCount, ph.docsFoundCount);
    }

    // Merge patent scores from analysis tab
    for (const row of parsed.analysisRows) {
      const scoreEntry = row.productScores.get(key);
      if (scoreEntry) {
        const existingPatent = product.patents[row.patentId];
        const newMaxScore = existingPatent
          ? Math.max(existingPatent.maxScore, scoreEntry.score)
          : scoreEntry.score;
        product.patents[row.patentId] = {
          maxScore: newMaxScore,
          isHot: newMaxScore >= HOT_THRESHOLD,
        };
      }
    }

    // Merge documents from document links tab
    const relevantDocs = parsed.documentRows.filter(
      d => slugify(d.companyName) === companySlug && slugify(d.productName) === productSlug
    );

    for (const doc of relevantDocs) {
      // Find or create document entry
      let existingDoc = product.documents.find(
        d => d.documentName === doc.documentName
      );

      if (!existingDoc) {
        existingDoc = {
          documentName: doc.documentName,
          documentUrl: doc.documentUrl,
          patlyticsStoredUrl: doc.patlyticsStoredUrl,
          localPath: null,
          downloadStatus: 'pending',
          patentScores: {},
        };
        product.documents.push(existingDoc);
        docCount++;
      }

      // Update URLs if we have them now
      if (doc.documentUrl && !existingDoc.documentUrl) {
        existingDoc.documentUrl = doc.documentUrl;
      }
      if (doc.patlyticsStoredUrl && !existingDoc.patlyticsStoredUrl) {
        existingDoc.patlyticsStoredUrl = doc.patlyticsStoredUrl;
      }

      // Merge patent-level scores and narratives
      for (const [patentId, score] of doc.patentScores) {
        const existing = existingDoc.patentScores[patentId];
        existingDoc.patentScores[patentId] = {
          score: existing ? Math.max(existing.score, score) : score,
          narrative: doc.patentNarratives.get(patentId) ?? existing?.narrative ?? null,
        };
      }
    }

    // Track source
    if (!product.sourceFiles.includes(parsed.sourceSlug)) {
      product.sourceFiles.push(parsed.sourceSlug);
    }
    product.updatedAt = now;

    if (!dryRun) {
      writeProductCache(companySlug, productSlug, product);
    }
  }

  return { productKeys, docCount };
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const config = parseArgs();

  console.log('=== Patlytics Heatmap Import ===');
  console.log(`Source dir: ${config.sourceDir}`);
  if (config.dryRun) console.log('MODE: DRY RUN (no files will be written)');
  if (config.force) console.log('MODE: FORCE (overwriting existing cache)');

  // Validate source directory
  if (!fs.existsSync(config.sourceDir)) {
    console.error(`ERROR: Source directory not found: ${config.sourceDir}`);
    process.exit(1);
  }

  // Ensure cache dirs exist
  if (!config.dryRun) {
    ensureCacheDirs();
  }

  // Find xlsx files
  let files = fs.readdirSync(config.sourceDir)
    .filter(f => f.endsWith('.xlsx') && !f.startsWith('._') && !f.startsWith('~$'))
    .sort();

  if (config.singleFile) {
    files = files.filter(f => f.includes(config.singleFile!));
    if (files.length === 0) {
      console.error(`ERROR: No file matching "${config.singleFile}" found`);
      process.exit(1);
    }
  }

  console.log(`Found ${files.length} spreadsheet(s) to import\n`);

  // Track totals
  let totalPatentIds = new Set<string>();
  let totalProductKeys = new Set<string>();
  let totalDocCount = 0;
  const allCompanyNames = new Map<string, string>(); // slug → name
  const sourceEntries: SourceManifestEntry[] = [];

  for (const file of files) {
    const filePath = path.join(config.sourceDir, file);

    try {
      const parsed = parseSpreadsheet(filePath, config.verbose);

      // Write source provenance
      if (!config.dryRun) {
        writeSourceCache(parsed.sourceSlug, {
          fileName: parsed.fileName,
          sourceSlug: parsed.sourceSlug,
          patentCount: parsed.analysisRows.length,
          productCount: parsed.productHeaders.length,
          documentCount: parsed.documentRows.length,
          parsedAt: new Date().toISOString(),
          productHeaders: parsed.productHeaders,
          patentIds: parsed.analysisRows.map(r => r.patentId),
        });
      }

      // Merge into patent cache
      const updatedPatentIds = mergeIntoPatentCache(parsed, config.force, config.dryRun, config.verbose);
      for (const id of updatedPatentIds) totalPatentIds.add(id);

      // Merge into product cache
      const { productKeys, docCount } = mergeIntoProductCache(
        parsed, config.force, config.dryRun, config.verbose
      );
      for (const key of productKeys) totalProductKeys.add(key);
      totalDocCount += docCount;

      // Collect company names
      for (const ph of parsed.productHeaders) {
        const slug = slugify(ph.companyName);
        if (!allCompanyNames.has(slug)) {
          allCompanyNames.set(slug, ph.companyName);
        }
      }

      sourceEntries.push({
        fileName: file,
        sourceSlug: parsed.sourceSlug,
        filePath: filePath,
        patentCount: parsed.analysisRows.length,
        productCount: parsed.productHeaders.length,
        documentCount: parsed.documentRows.length,
        importedAt: new Date().toISOString(),
      });

    } catch (err) {
      console.error(`ERROR processing ${file}:`, (err as Error).message);
      if (config.verbose) {
        console.error((err as Error).stack);
      }
    }
  }

  // Build companies index with competitor matching
  const companies: CompanyEntry[] = [];
  for (const [slug, name] of allCompanyNames) {
    const match = matchCompanyToCompetitor(name);
    // Count products for this company
    const companyProducts = [...totalProductKeys]
      .filter(k => k.startsWith(slug + '/'))
      .map(k => k.split('/')[1]);

    companies.push({
      companyName: name,
      companySlug: slug,
      competitorMatch: match?.name ?? null,
      competitorCategory: match?.category ?? null,
      productCount: companyProducts.length,
      products: companyProducts,
    });
  }

  if (!config.dryRun) {
    // Write manifest
    const manifest = readManifest();
    // Merge source entries (replace existing by sourceSlug)
    for (const entry of sourceEntries) {
      const idx = manifest.sources.findIndex(s => s.sourceSlug === entry.sourceSlug);
      if (idx >= 0) {
        manifest.sources[idx] = entry;
      } else {
        manifest.sources.push(entry);
      }
    }
    manifest.totalPatents = totalPatentIds.size;
    manifest.totalProducts = totalProductKeys.size;
    manifest.totalDocuments = totalDocCount;
    manifest.lastImportAt = new Date().toISOString();
    writeManifest(manifest);

    // Write companies index
    writeCompaniesIndex({
      companies,
      updatedAt: new Date().toISOString(),
    });
  }

  // ── Summary ──────────────────────────────────────────────────────────────

  console.log('\n=== Import Summary ===');
  console.log(`Files processed:     ${files.length}`);
  console.log(`Total patents:       ${totalPatentIds.size}`);
  console.log(`Total products:      ${totalProductKeys.size}`);
  console.log(`Total documents:     ${totalDocCount}`);
  console.log(`Companies found:     ${allCompanyNames.size}`);

  // Count competitor matches
  const matchedCompanies = companies.filter(c => c.competitorMatch);
  console.log(`Competitor matches:  ${matchedCompanies.length}/${companies.length}`);
  if (matchedCompanies.length > 0) {
    for (const c of matchedCompanies) {
      console.log(`  ✓ ${c.companyName} → ${c.competitorMatch} [${c.competitorCategory}]`);
    }
  }

  // Count hot patents (would need to read back from cache for non-dry-run)
  if (!config.dryRun) {
    const { getHotPatents } = await import('../src/api/services/patlytics-cache-service.js');
    const hotPatents = getHotPatents(HOT_THRESHOLD);
    console.log(`Hot patents (≥${HOT_THRESHOLD}): ${hotPatents.length}`);
    if (hotPatents.length > 0) {
      const top5 = hotPatents.slice(0, 5);
      for (const p of top5) {
        console.log(`  🔥 ${p.patentId} — max: ${p.maxScoreOverall.toFixed(2)} — ${p.hotProductCount} hot products`);
      }
      if (hotPatents.length > 5) console.log(`  ... and ${hotPatents.length - 5} more`);
    }
  }

  if (config.dryRun) {
    console.log('\n(Dry run — no cache files were written)');
  } else {
    console.log(`\nCache written to: cache/patlytics/`);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
