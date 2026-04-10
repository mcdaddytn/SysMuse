/**
 * Build a control group for apples-to-apples calibration.
 *
 * Selects diverse Patlytics-scored patent-document pairs with super-sector
 * quota-based selection. Downloads docs (preferring local GLSSD2 copies),
 * extracts text for same-document comparison.
 *
 * Usage:
 *   npx tsx scripts/build-control-group.ts [options]
 *     --max-pairs <n>       Max pairs to include (default: 150)
 *     --min-score <n>       Min Patlytics score (default: 0.35)
 *     --max-per-patent <n>  Max docs per patent (default: 3)
 *     --max-per-company <n> Max docs per company (default: 10)
 *     --dry-run             Show selection without downloading
 *     --download            Actually download docs
 *     --no-quotas           Disable super-sector quotas (original behavior)
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
const GLSSD2_DOCS_DIR = '/Volumes/GLSSD2/data/products/docs';
const EXPORTS_DIR = path.resolve('./output/vendor-exports');
const SCORE_HISTORY_DIR = path.resolve('./cache/score-history');

// ── Super-sector quota configuration ────────────────────────────────────────
// User-corrected taxonomy: VIRTUALIZATION→COMPUTING, SDN_NETWORK→NETWORKING
// Skip IMAGING and AI_ML

interface SuperSectorQuota {
  target: number;       // target number of pairs
  priority: number;     // 1=highest, lower is higher priority for overflow
}

const SUPER_SECTOR_QUOTAS: Record<string, SuperSectorQuota> = {
  SEMICONDUCTOR:   { target: 28, priority: 1 },  // boost
  COMPUTING:       { target: 32, priority: 2 },  // boost (includes VIRTUALIZATION)
  SECURITY:        { target: 28, priority: 3 },  // maintain
  WIRELESS:        { target: 18, priority: 4 },  // retain what available
  NETWORKING:      { target: 22, priority: 5 },  // lower
  VIDEO_STREAMING: { target: 16, priority: 6 },  // lower
};
// Total target: 144 pairs → expect ~100+ clean after quarantine

// ── Sector-to-SuperSector mapping (prefix-based) ───────────────────────────

const SECTOR_PREFIX_MAP: Record<string, string> = {
  'semiconductor': 'SEMICONDUCTOR',
  'lithography': 'SEMICONDUCTOR',
  'magnetics': 'SEMICONDUCTOR',
  'memory-storage': 'SEMICONDUCTOR',
  'pcb': 'SEMICONDUCTOR',
  'analog-circuits': 'SEMICONDUCTOR',
  'rf-acoustic': 'SEMICONDUCTOR',
  'test-measurement': 'SEMICONDUCTOR',
  'optics': 'SEMICONDUCTOR',
  'antennas': 'SEMICONDUCTOR',
  'network-threat': 'SECURITY',
  'network-auth': 'SECURITY',
  'network-crypto': 'SECURITY',
  'network-secure': 'SECURITY',
  'computing-os-security': 'SECURITY',
  'computing-auth': 'SECURITY',
  'network-switching': 'NETWORKING',
  'network-management': 'NETWORKING',
  'network-protocols': 'NETWORKING',
  'network-signal': 'NETWORKING',
  'network-multiplexing': 'NETWORKING',
  'network-error': 'NETWORKING',
  'wireless': 'WIRELESS',
  'video': 'VIDEO_STREAMING',
  'streaming': 'VIDEO_STREAMING',
  'audio': 'VIDEO_STREAMING',
  'computing-runtime': 'COMPUTING',
  'computing-systems': 'COMPUTING',
  'computing-ui': 'COMPUTING',
  'data-retrieval': 'COMPUTING',
  'fintech': 'COMPUTING',
  'power-management': 'COMPUTING',
  'nutanix': 'COMPUTING',
};

function mapSectorToSuper(sector: string): string {
  if (SECTOR_PREFIX_MAP[sector]) return SECTOR_PREFIX_MAP[sector];
  for (const [prefix, ss] of Object.entries(SECTOR_PREFIX_MAP)) {
    if (sector.startsWith(prefix)) return ss;
  }
  return 'UNKNOWN';
}

// ── Patent-to-sector mapping ────────────────────────────────────────────────

function buildPatentSectorMap(): Map<string, Set<string>> {
  const patentToSectors = new Map<string, Set<string>>();

  // Method 1: vendor-exports CSVs (most comprehensive)
  if (fs.existsSync(EXPORTS_DIR)) {
    for (const dir of fs.readdirSync(EXPORTS_DIR)) {
      const csvPath = path.join(EXPORTS_DIR, dir, 'tier1-assessment-results.csv');
      if (!fs.existsSync(csvPath)) continue;
      const sectorName = dir.replace(/-2026-\d{2}-\d{2}$/, '');
      const csv = fs.readFileSync(csvPath, 'utf8');
      for (const line of csv.split('\n').slice(1)) {
        const patentId = line.split(',')[0]?.replace(/"/g, '').trim();
        if (patentId && /^\d+$/.test(patentId)) {
          if (!patentToSectors.has(patentId)) patentToSectors.set(patentId, new Set());
          patentToSectors.get(patentId)!.add(sectorName);
        }
      }
    }
  }

  // Method 2: score-history directories
  if (fs.existsSync(SCORE_HISTORY_DIR)) {
    for (const sector of fs.readdirSync(SCORE_HISTORY_DIR).filter(d => !d.startsWith('cmlat'))) {
      const sectorDir = path.join(SCORE_HISTORY_DIR, sector);
      if (!fs.statSync(sectorDir).isDirectory()) continue;
      for (const f of fs.readdirSync(sectorDir)) {
        const match = f.match(/^(\d+)_/);
        if (match) {
          if (!patentToSectors.has(match[1])) patentToSectors.set(match[1], new Set());
          patentToSectors.get(match[1])!.add(sector);
        }
      }
    }
  }

  return patentToSectors;
}

function getPatentSuperSector(patentId: string, patentSectorMap: Map<string, Set<string>>): string {
  const sectors = patentSectorMap.get(patentId);
  if (!sectors) return 'UNKNOWN';
  // Return the first mapped super-sector (prefer higher-priority ones)
  const superSectors = new Set<string>();
  for (const s of sectors) {
    superSectors.add(mapSectorToSuper(s));
  }
  // Priority: return the one with highest quota priority
  for (const ss of ['SEMICONDUCTOR', 'COMPUTING', 'SECURITY', 'WIRELESS', 'NETWORKING', 'VIDEO_STREAMING']) {
    if (superSectors.has(ss)) return ss;
  }
  return 'UNKNOWN';
}

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
  superSector: string;
  hasLocalDoc: boolean;   // true if doc already on GLSSD2
}

interface Config {
  maxPairs: number;
  minScore: number;
  maxPerPatent: number;
  maxPerCompany: number;
  dryRun: boolean;
  download: boolean;
  useQuotas: boolean;
}

function parseArgs(): Config {
  const args = process.argv.slice(2);
  const config: Config = {
    maxPairs: 150,
    minScore: 0.35,
    maxPerPatent: 3,
    maxPerCompany: 10,
    dryRun: false,
    download: false,
    useQuotas: true,
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--max-pairs' && args[i + 1]) config.maxPairs = parseInt(args[++i], 10);
    else if (args[i] === '--min-score' && args[i + 1]) config.minScore = parseFloat(args[++i]);
    else if (args[i] === '--max-per-patent' && args[i + 1]) config.maxPerPatent = parseInt(args[++i], 10);
    else if (args[i] === '--max-per-company' && args[i + 1]) config.maxPerCompany = parseInt(args[++i], 10);
    else if (args[i] === '--dry-run') config.dryRun = true;
    else if (args[i] === '--download') config.download = true;
    else if (args[i] === '--no-quotas') config.useQuotas = false;
  }
  return config;
}

function ensureDir(d: string) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

function checkLocalDoc(companySlug: string, productSlug: string, docSlug: string): string | null {
  const companyDir = path.join(GLSSD2_DOCS_DIR, companySlug, productSlug);
  if (!fs.existsSync(companyDir)) return null;
  // Look for any file starting with docSlug
  try {
    const files = fs.readdirSync(companyDir);
    const match = files.find(f => f.startsWith(docSlug));
    if (match) {
      const fullPath = path.join(companyDir, match);
      const stat = fs.statSync(fullPath);
      if (stat.size > 100) return fullPath;
    }
  } catch {}
  return null;
}

function selectControlGroup(config: Config, patentSectorMap: Map<string, Set<string>>): ControlPair[] {
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

      // Prefer docs that are already downloaded locally
      const docSlug = slugify(doc.documentName || 'unknown');
      const localPath = checkLocalDoc(pc.companySlug, pc.productSlug, docSlug);
      const hasLocalDoc = localPath !== null ||
        (doc.downloadStatus === 'completed' && doc.localPath && fs.existsSync(doc.localPath));

      const isPdf = url.toLowerCase().includes('.pdf') || cdn.toLowerCase().includes('.pdf') ||
        (localPath?.endsWith('.pdf') ?? false);

      for (const [patentId, score] of Object.entries(ps)) {
        if ((score as any).sourceFile === 'internal-v1') continue;
        if (score.score < config.minScore) continue;

        const superSector = getPatentSuperSector(patentId, patentSectorMap);

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
          superSector,
          hasLocalDoc,
        });
      }
    }
  }

  // Sort: prefer local docs > PDFs > highest scores
  allPairs.sort((a, b) => {
    if (a.hasLocalDoc !== b.hasLocalDoc) return a.hasLocalDoc ? -1 : 1;
    if (a.isPdf !== b.isPdf) return a.isPdf ? -1 : 1;
    return b.patlyticsScore - a.patlyticsScore;
  });

  console.log(`\nTotal candidate pairs (score >= ${config.minScore}): ${allPairs.length}`);
  console.log(`  With local docs: ${allPairs.filter(p => p.hasLocalDoc).length}`);

  // Per super-sector breakdown
  const ssCounts = new Map<string, number>();
  for (const p of allPairs) {
    ssCounts.set(p.superSector, (ssCounts.get(p.superSector) || 0) + 1);
  }
  console.log('  By super-sector:');
  for (const [ss, count] of [...ssCounts.entries()].sort((a, b) => b[1] - a[1])) {
    const quota = SUPER_SECTOR_QUOTAS[ss];
    console.log(`    ${ss}: ${count} candidates${quota ? ` (quota: ${quota.target})` : ''}`);
  }

  // ── Quota-based selection ──────────────────────────────────────────────
  if (!config.useQuotas) {
    return selectWithoutQuotas(allPairs, config);
  }

  const selected: ControlPair[] = [];
  const patentCounts = new Map<string, number>();
  const companyCounts = new Map<string, number>();
  const docsSeen = new Set<string>();
  const sectorFilled = new Map<string, number>();

  // Initialize sector counts
  for (const ss of Object.keys(SUPER_SECTOR_QUOTAS)) {
    sectorFilled.set(ss, 0);
  }

  function tryAdd(pair: ControlPair): boolean {
    const patCount = patentCounts.get(pair.patentId) || 0;
    const compCount = companyCounts.get(pair.companySlug) || 0;
    const docKey = `${pair.companySlug}/${pair.productSlug}/${pair.docSlug}`;

    if (patCount >= config.maxPerPatent) return false;
    if (compCount >= config.maxPerCompany) return false;
    if (docsSeen.has(docKey)) return false;

    selected.push(pair);
    patentCounts.set(pair.patentId, patCount + 1);
    companyCounts.set(pair.companySlug, compCount + 1);
    docsSeen.add(docKey);
    sectorFilled.set(pair.superSector, (sectorFilled.get(pair.superSector) || 0) + 1);
    return true;
  }

  // Score tiers for each super-sector
  const tiers = [0.80, 0.60, 0.35];

  // Fill each super-sector quota in priority order, tier by tier
  for (const tierMin of tiers) {
    const tierMax = tierMin === 0.80 ? 1.0 : tierMin === 0.60 ? 0.80 : 0.60;

    // Sort super-sectors by priority (highest first = lowest number)
    const ssByPriority = Object.entries(SUPER_SECTOR_QUOTAS)
      .sort((a, b) => a[1].priority - b[1].priority);

    for (const [ss, quota] of ssByPriority) {
      const filled = sectorFilled.get(ss) || 0;
      if (filled >= quota.target) continue;

      const candidates = allPairs.filter(p =>
        p.superSector === ss &&
        p.patlyticsScore >= tierMin &&
        p.patlyticsScore < tierMax &&
        !docsSeen.has(`${p.companySlug}/${p.productSlug}/${p.docSlug}`)
      );

      for (const pair of candidates) {
        if ((sectorFilled.get(ss) || 0) >= quota.target) break;
        if (selected.length >= config.maxPairs) break;
        tryAdd(pair);
      }
    }
  }

  // Overflow pass: redistribute unfilled slots to high-priority sectors only
  // Cap low-priority sectors (NETWORKING, VIDEO_STREAMING) at their target
  const OVERFLOW_SECTORS = new Set(['SEMICONDUCTOR', 'COMPUTING', 'SECURITY', 'WIRELESS']);
  if (selected.length < config.maxPairs) {
    const remaining = config.maxPairs - selected.length;
    const unfilled = allPairs.filter(p =>
      !docsSeen.has(`${p.companySlug}/${p.productSlug}/${p.docSlug}`) &&
      OVERFLOW_SECTORS.has(p.superSector)
    );
    unfilled.sort((a, b) => b.patlyticsScore - a.patlyticsScore);

    let added = 0;
    for (const pair of unfilled) {
      if (added >= remaining) break;
      if (tryAdd(pair)) added++;
    }
  }

  return selected;
}

function selectWithoutQuotas(allPairs: ControlPair[], config: Config): ControlPair[] {
  const selected: ControlPair[] = [];
  const patentCounts = new Map<string, number>();
  const companyCounts = new Map<string, number>();
  const docsSeen = new Set<string>();

  const tiers = [
    allPairs.filter(p => p.patlyticsScore >= 0.80),
    allPairs.filter(p => p.patlyticsScore >= 0.60 && p.patlyticsScore < 0.80),
    allPairs.filter(p => p.patlyticsScore >= 0.35 && p.patlyticsScore < 0.60),
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

function detectFileType(filePath: string): '.pdf' | '.html' {
  // Check magic bytes first
  try {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(5);
    fs.readSync(fd, buf, 0, 5, 0);
    fs.closeSync(fd);
    if (buf.toString('ascii', 0, 5) === '%PDF-') return '.pdf';
  } catch {}
  // Check file extension
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.pdf') return '.pdf';
  return '.html';
}

function downloadDoc(pair: ControlPair): { docPath: string; textPath: string } | null {
  const companyDir = path.join(DOCS_DIR, pair.companySlug, pair.productSlug);
  ensureDir(companyDir);

  const textPath = path.join(TEXTS_DIR, pair.companySlug, pair.productSlug, `${pair.docSlug}.txt`);

  // Check if already extracted (skip re-download)
  if (fs.existsSync(textPath) && fs.statSync(textPath).size > 100) {
    // Find the existing doc file
    const pdfPath = path.join(companyDir, `${pair.docSlug}.pdf`);
    const htmlPath = path.join(companyDir, `${pair.docSlug}.html`);
    if (fs.existsSync(pdfPath)) return { docPath: pdfPath, textPath };
    if (fs.existsSync(htmlPath)) return { docPath: htmlPath, textPath };
  }

  // Check GLSSD2 for pre-downloaded copy first
  const localDoc = checkLocalDoc(pair.companySlug, pair.productSlug, pair.docSlug);
  if (localDoc) {
    try {
      // Use the ACTUAL file type, not the URL-based guess
      const actualExt = detectFileType(localDoc);
      const docPath = path.join(companyDir, `${pair.docSlug}${actualExt}`);
      // Remove stale copies with wrong extension
      const wrongExt = actualExt === '.pdf' ? '.html' : '.pdf';
      const wrongPath = path.join(companyDir, `${pair.docSlug}${wrongExt}`);
      if (fs.existsSync(wrongPath)) fs.unlinkSync(wrongPath);

      fs.copyFileSync(localDoc, docPath);
      if (fs.statSync(docPath).size > 100) {
        return { docPath, textPath };
      }
    } catch {}
  }

  // Skip if already in calibration dir with correct extension
  const pdfPath = path.join(companyDir, `${pair.docSlug}.pdf`);
  const htmlPath = path.join(companyDir, `${pair.docSlug}.html`);
  if (fs.existsSync(pdfPath) && fs.statSync(pdfPath).size > 100) {
    return { docPath: pdfPath, textPath };
  }
  if (fs.existsSync(htmlPath) && fs.statSync(htmlPath).size > 100) {
    return { docPath: htmlPath, textPath };
  }

  // Try raw URL first (CDN is expired), fall back to CDN
  const urls = [pair.documentUrl, pair.patlyticsStoredUrl].filter(Boolean);

  for (const url of urls) {
    // Download to a temp path, then detect type
    const tmpPath = path.join(companyDir, `${pair.docSlug}.tmp`);
    try {
      const cleanUrl = url.replace(/&amp;/g, '&');
      execSync(`curl -sL -o "${tmpPath}" --max-time 60 "${cleanUrl}"`, {
        timeout: 70000,
        stdio: 'pipe',
      });

      const stat = fs.statSync(tmpPath);
      if (stat.size > 100) {
        const actualExt = detectFileType(tmpPath);
        const docPath = path.join(companyDir, `${pair.docSlug}${actualExt}`);
        fs.renameSync(tmpPath, docPath);
        return { docPath, textPath };
      }
      fs.unlinkSync(tmpPath);
    } catch (err) {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
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
  console.log(`Quotas: ${config.useQuotas ? 'enabled' : 'disabled'}`);
  if (config.useQuotas) {
    console.log('  Super-sector targets:');
    for (const [ss, q] of Object.entries(SUPER_SECTOR_QUOTAS).sort((a, b) => a[1].priority - b[1].priority)) {
      console.log(`    ${ss}: ${q.target} (priority ${q.priority})`);
    }
  }

  console.log('\nBuilding patent → sector mapping...');
  const patentSectorMap = buildPatentSectorMap();
  console.log(`  Mapped ${patentSectorMap.size} patents to sectors`);

  const selected = selectControlGroup(config, patentSectorMap);

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
  console.log(`  Score tiers: ${byScore.high} high (>=0.80), ${byScore.moderate} moderate (0.60-0.79), ${byScore.weak} weak (0.35-0.59)`);
  console.log(`  PDFs: ${selected.filter(p => p.isPdf).length}, HTML: ${selected.filter(p => !p.isPdf).length}`);
  console.log(`  With local doc: ${selected.filter(p => p.hasLocalDoc).length}`);

  // Show by super-sector
  const ssFilled = new Map<string, { count: number; avgScore: number; local: number }>();
  for (const p of selected) {
    const e = ssFilled.get(p.superSector) || { count: 0, avgScore: 0, local: 0 };
    e.avgScore = (e.avgScore * e.count + p.patlyticsScore) / (e.count + 1);
    e.count++;
    if (p.hasLocalDoc) e.local++;
    ssFilled.set(p.superSector, e);
  }
  console.log('\nBy super-sector:');
  for (const [ss, { count, avgScore, local }] of [...ssFilled.entries()].sort((a, b) => b[1].count - a[1].count)) {
    const quota = SUPER_SECTOR_QUOTAS[ss];
    const quotaStr = quota ? ` / ${quota.target} target` : '';
    console.log(`  ${ss}: ${count}${quotaStr} (avg ${avgScore.toFixed(2)}, ${local} local)`);
  }

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
    console.log('\nFirst 30 pairs:');
    for (const p of selected.slice(0, 30)) {
      const local = p.hasLocalDoc ? '✓local' : '⬇need';
      console.log(`  ${p.patentId} × ${p.companyName}/${p.productName}: ${p.patlyticsScore.toFixed(2)} ${p.superSector} ${p.isPdf ? 'PDF' : 'HTML'} ${local}`);
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
  let fromLocal = 0, fromUrl = 0;

  for (let i = 0; i < selected.length; i++) {
    const pair = selected[i];
    process.stdout.write(`  [${i + 1}/${selected.length}] ${pair.superSector.substring(0, 10).padEnd(11)} ${pair.companySlug}/${pair.docSlug.substring(0, 35)}... `);

    const result = downloadDoc(pair);
    if (!result) {
      console.log('DOWNLOAD FAILED');
      failed++;
      continue;
    }
    downloaded++;

    // Track source
    const localDoc = checkLocalDoc(pair.companySlug, pair.productSlug, pair.docSlug);
    if (localDoc) fromLocal++;
    else fromUrl++;

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
      fromLocal,
      fromUrl,
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
      superSector: p.superSector,
      textPath: path.join(TEXTS_DIR, p.companySlug, p.productSlug, `${p.docSlug}.txt`),
    })),
  };

  ensureDir(CONTROL_DIR);
  fs.writeFileSync(path.join(CONTROL_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));

  console.log(`\n=== Done ===`);
  console.log(`Downloaded: ${downloaded} (${fromLocal} from GLSSD2, ${fromUrl} from URL)`);
  console.log(`Extracted:  ${extracted}`);
  console.log(`Failed:     ${failed}`);
  console.log(`Manifest:   ${path.join(CONTROL_DIR, 'manifest.json')}`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
