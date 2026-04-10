/**
 * Build a control group for apples-to-apples calibration.
 *
 * Selects diverse Patlytics-scored patent-document pairs (score >= 0.40),
 * downloads the exact same docs Patlytics used (via CDN or original URL),
 * and extracts text for same-document comparison.
 *
 * Usage:
 *   npx tsx scripts/build-control-group.ts [options]
 *     --max-pairs <n>       Max pairs to include (default: 100)
 *     --min-score <n>       Min Patlytics score (default: 0.40)
 *     --max-per-patent <n>  Max docs per patent (default: 3)
 *     --max-per-company <n> Max docs per company (default: 8)
 *     --dry-run             Show selection without downloading
 *     --download            Actually download docs
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import {
  getAllProductCaches,
  readProductCache,
  slugify,
} from '../src/api/services/patlytics-cache-service.js';

const CONTROL_DIR = path.resolve('./cache/calibration-control');
const DOCS_DIR = path.join(CONTROL_DIR, 'docs');
const TEXTS_DIR = path.join(CONTROL_DIR, 'texts');

interface ControlPair {
  patentId: string;
  companySlug: string;
  companyName: string;
  productSlug: string;
  productName: string;
  documentName: string;
  docSlug: string;
  patlyticsScore: number;
  patlyticsNarrative: string | null;
  documentUrl: string;
  patlyticsStoredUrl: string;
  isPdf: boolean;
}

interface Config {
  maxPairs: number;
  minScore: number;
  maxPerPatent: number;
  maxPerCompany: number;
  dryRun: boolean;
  download: boolean;
}

function parseArgs(): Config {
  const args = process.argv.slice(2);
  const config: Config = {
    maxPairs: 100,
    minScore: 0.40,
    maxPerPatent: 3,
    maxPerCompany: 8,
    dryRun: false,
    download: false,
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--max-pairs' && args[i + 1]) config.maxPairs = parseInt(args[++i], 10);
    else if (args[i] === '--min-score' && args[i + 1]) config.minScore = parseFloat(args[++i]);
    else if (args[i] === '--max-per-patent' && args[i + 1]) config.maxPerPatent = parseInt(args[++i], 10);
    else if (args[i] === '--max-per-company' && args[i + 1]) config.maxPerCompany = parseInt(args[++i], 10);
    else if (args[i] === '--dry-run') config.dryRun = true;
    else if (args[i] === '--download') config.download = true;
  }
  return config;
}

function ensureDir(d: string) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

function selectControlGroup(config: Config): ControlPair[] {
  const allPairs: ControlPair[] = [];
  const products = getAllProductCaches();

  for (const pm of products) {
    const pc = readProductCache(pm.companySlug, pm.productSlug);
    if (!pc) continue;

    for (const doc of pc.documents) {
      const ps = doc.patentScores || {};
      const url = doc.documentUrl || '';
      const cdn = doc.patlyticsStoredUrl || '';
      if (!url && !cdn) continue;

      const isPdf = url.toLowerCase().includes('.pdf') || cdn.toLowerCase().includes('.pdf');

      for (const [patentId, score] of Object.entries(ps)) {
        if ((score as any).sourceFile === 'internal-v1') continue;
        if (score.score < config.minScore) continue;

        const docSlug = slugify(doc.documentName || 'unknown');
        allPairs.push({
          patentId,
          companySlug: pc.companySlug,
          companyName: pc.companyName,
          productSlug: pc.productSlug,
          productName: pc.productName,
          documentName: doc.documentName,
          docSlug,
          patlyticsScore: score.score,
          patlyticsNarrative: score.narrative,
          documentUrl: url,
          patlyticsStoredUrl: cdn,
          isPdf,
        });
      }
    }
  }

  // Sort: highest scores first, prefer PDFs
  allPairs.sort((a, b) => {
    if (a.isPdf !== b.isPdf) return a.isPdf ? -1 : 1;
    return b.patlyticsScore - a.patlyticsScore;
  });

  // Select diverse subset
  const selected: ControlPair[] = [];
  const patentCounts = new Map<string, number>();
  const companyCounts = new Map<string, number>();
  const docsSeen = new Set<string>();

  // First pass: 0.80+ (must-haves)
  // Second pass: 0.60-0.79
  // Third pass: 0.40-0.59
  const tiers = [
    allPairs.filter(p => p.patlyticsScore >= 0.80),
    allPairs.filter(p => p.patlyticsScore >= 0.60 && p.patlyticsScore < 0.80),
    allPairs.filter(p => p.patlyticsScore >= 0.40 && p.patlyticsScore < 0.60),
  ];

  for (const tier of tiers) {
    for (const pair of tier) {
      if (selected.length >= config.maxPairs) break;

      const patCount = patentCounts.get(pair.patentId) || 0;
      const compCount = companyCounts.get(pair.companySlug) || 0;
      const docKey = `${pair.companySlug}/${pair.productSlug}/${pair.docSlug}`;

      if (patCount >= config.maxPerPatent) continue;
      if (compCount >= config.maxPerCompany) continue;
      if (docsSeen.has(docKey)) continue;

      selected.push(pair);
      patentCounts.set(pair.patentId, patCount + 1);
      companyCounts.set(pair.companySlug, compCount + 1);
      docsSeen.add(docKey);
    }
  }

  return selected;
}

function downloadDoc(pair: ControlPair): { docPath: string; textPath: string } | null {
  const companyDir = path.join(DOCS_DIR, pair.companySlug, pair.productSlug);
  ensureDir(companyDir);

  const ext = pair.isPdf ? '.pdf' : '.html';
  const docPath = path.join(companyDir, `${pair.docSlug}${ext}`);
  const textPath = path.join(TEXTS_DIR, pair.companySlug, pair.productSlug, `${pair.docSlug}.txt`);

  // Skip if already downloaded
  if (fs.existsSync(docPath) && fs.statSync(docPath).size > 100) {
    return { docPath, textPath };
  }

  // Try CDN first (guaranteed to be what Patlytics used), fall back to original
  const urls = [pair.patlyticsStoredUrl, pair.documentUrl].filter(Boolean);

  for (const url of urls) {
    try {
      // Decode HTML entities in URL
      const cleanUrl = url.replace(/&amp;/g, '&');
      execSync(`curl -sL -o "${docPath}" --max-time 60 "${cleanUrl}"`, {
        timeout: 70000,
        stdio: 'pipe',
      });

      const stat = fs.statSync(docPath);
      if (stat.size > 100) {
        return { docPath, textPath };
      }
      // Too small, try next URL
      fs.unlinkSync(docPath);
    } catch (err) {
      if (fs.existsSync(docPath)) fs.unlinkSync(docPath);
    }
  }

  return null;
}

function extractText(docPath: string, textPath: string): boolean {
  ensureDir(path.dirname(textPath));

  if (fs.existsSync(textPath) && fs.statSync(textPath).size > 100) {
    return true;
  }

  const ext = path.extname(docPath).toLowerCase();
  try {
    if (ext === '.pdf') {
      execSync(`pdftotext -layout "${docPath}" "${textPath}"`, {
        timeout: 30000,
        stdio: 'pipe',
      });
    } else {
      // HTML: use python to strip tags
      const html = fs.readFileSync(docPath, 'utf-8');
      const text = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#\d+;/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      fs.writeFileSync(textPath, text);
    }

    return fs.existsSync(textPath) && fs.statSync(textPath).size > 100;
  } catch {
    return false;
  }
}

async function main() {
  const config = parseArgs();

  console.log('=== Control Group Builder ===');
  console.log(`Min score: ${config.minScore}`);
  console.log(`Max pairs: ${config.maxPairs}`);
  console.log(`Max per patent: ${config.maxPerPatent}`);
  console.log(`Max per company: ${config.maxPerCompany}`);

  const selected = selectControlGroup(config);

  // Stats
  const byScore = { high: 0, moderate: 0, weak: 0 };
  for (const p of selected) {
    if (p.patlyticsScore >= 0.80) byScore.high++;
    else if (p.patlyticsScore >= 0.60) byScore.moderate++;
    else byScore.weak++;
  }

  const patents = new Set(selected.map(p => p.patentId));
  const companies = new Set(selected.map(p => p.companySlug));

  console.log(`\nSelected: ${selected.length} pairs`);
  console.log(`  Patents: ${patents.size}`);
  console.log(`  Companies: ${companies.size}`);
  console.log(`  Score tiers: ${byScore.high} high (>=0.80), ${byScore.moderate} moderate (0.60-0.79), ${byScore.weak} weak (0.40-0.59)`);
  console.log(`  PDFs: ${selected.filter(p => p.isPdf).length}, HTML: ${selected.filter(p => !p.isPdf).length}`);

  // Show by company
  const compCounts = new Map<string, { count: number; avgScore: number }>();
  for (const p of selected) {
    const e = compCounts.get(p.companyName) || { count: 0, avgScore: 0 };
    e.avgScore = (e.avgScore * e.count + p.patlyticsScore) / (e.count + 1);
    e.count++;
    compCounts.set(p.companyName, e);
  }
  console.log('\nBy company:');
  for (const [name, { count, avgScore }] of [...compCounts.entries()].sort((a, b) => b[1].count - a[1].count)) {
    console.log(`  ${name}: ${count} pairs (avg ${avgScore.toFixed(2)})`);
  }

  if (config.dryRun) {
    console.log('\n(Dry run — no downloads)');
    // Show first 20
    console.log('\nFirst 20 pairs:');
    for (const p of selected.slice(0, 20)) {
      console.log(`  ${p.patentId} × ${p.companyName}/${p.productName}: ${p.patlyticsScore.toFixed(2)} ${p.isPdf ? 'PDF' : 'HTML'}`);
      console.log(`    ${p.documentName.substring(0, 70)}`);
    }
    return;
  }

  if (!config.download) {
    console.log('\nUse --download to fetch docs, or --dry-run to preview.');
    return;
  }

  // Download and extract
  console.log('\n--- Downloading & extracting ---');
  let downloaded = 0, extracted = 0, failed = 0;

  for (let i = 0; i < selected.length; i++) {
    const pair = selected[i];
    process.stdout.write(`  [${i + 1}/${selected.length}] ${pair.companySlug}/${pair.docSlug.substring(0, 40)}... `);

    const result = downloadDoc(pair);
    if (!result) {
      console.log('DOWNLOAD FAILED');
      failed++;
      continue;
    }
    downloaded++;

    if (extractText(result.docPath, result.textPath)) {
      const textSize = fs.statSync(result.textPath).size;
      console.log(`OK (${(textSize / 1024).toFixed(1)} KB text)`);
      extracted++;
    } else {
      console.log('EXTRACT FAILED');
      failed++;
    }
  }

  // Save control group manifest
  const manifest = {
    generatedAt: new Date().toISOString(),
    config,
    stats: {
      selected: selected.length,
      downloaded,
      extracted,
      failed,
      patents: patents.size,
      companies: companies.size,
      scoreTiers: byScore,
    },
    pairs: selected.map(p => ({
      patentId: p.patentId,
      companySlug: p.companySlug,
      productSlug: p.productSlug,
      documentName: p.documentName,
      docSlug: p.docSlug,
      patlyticsScore: p.patlyticsScore,
      patlyticsNarrative: p.patlyticsNarrative,
      isPdf: p.isPdf,
      textPath: path.join(TEXTS_DIR, p.companySlug, p.productSlug, `${p.docSlug}.txt`),
    })),
  };

  ensureDir(CONTROL_DIR);
  fs.writeFileSync(path.join(CONTROL_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));

  console.log(`\n=== Done ===`);
  console.log(`Downloaded: ${downloaded}`);
  console.log(`Extracted:  ${extracted}`);
  console.log(`Failed:     ${failed}`);
  console.log(`Manifest:   ${path.join(CONTROL_DIR, 'manifest.json')}`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
