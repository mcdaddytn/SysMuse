/**
 * Doc Quality Screening & Quarantine System
 *
 * Fast, zero-LLM-cost heuristic screening of extracted text files.
 * Identifies junk docs (paywalls, video stubs, JS-rendered empty pages,
 * irrelevant transcripts) and quarantines them before expensive scoring.
 *
 * Usage:
 *   npx tsx scripts/screen-doc-quality.ts [options]
 *     --control-only      Screen only the control group docs (from manifest.json)
 *     --all               Screen all extracted docs under cache/calibration-control/texts/
 *     --threshold <bytes> Override thin_content threshold (default 3000)
 *     --verbose           Print per-doc details
 *     --llm-screen        (Future) Add cheap Haiku LLM verification pass
 */

import * as fs from 'fs';
import * as path from 'path';

// ── Paths ──────────────────────────────────────────────────────────────────

const CONTROL_DIR = path.resolve('./cache/calibration-control');
const MANIFEST_PATH = path.join(CONTROL_DIR, 'manifest.json');
const TEXTS_DIR = path.join(CONTROL_DIR, 'texts');
const OUTPUT_DIR = path.resolve('./cache/doc-quality-screening');

// ── Types ──────────────────────────────────────────────────────────────────

type QuarantineReason =
  | 'extraction_failed'
  | 'stub_extraction'
  | 'video_stub'
  | 'paywall_stub'
  | 'junk_html'
  | 'thin_content';

interface DocScreenResult {
  company: string;
  product: string;
  docSlug: string;
  documentName: string;
  textPath: string;
  textBytes: number;
  strippedBytes: number;
  quarantined: boolean;
  reason: QuarantineReason | null;
  recommendation: string | null;
  junkLineRatio?: number;
}

interface ScreeningResults {
  screenedAt: string;
  totalDocs: number;
  quarantined: number;
  passed: number;
  byReason: Record<string, number>;
  results: DocScreenResult[];
}

interface ManifestPair {
  patentId: string;
  companySlug: string;
  productSlug: string;
  documentName: string;
  docSlug: string;
  patlyticsScore: number;
  isPdf: boolean;
  textPath: string;
}

interface Config {
  controlOnly: boolean;
  all: boolean;
  thinContentThreshold: number;
  verbose: boolean;
  llmScreen: boolean;
}

// ── CLI Parsing ────────────────────────────────────────────────────────────

function parseArgs(): Config {
  const args = process.argv.slice(2);
  return {
    controlOnly: args.includes('--control-only'),
    all: args.includes('--all'),
    thinContentThreshold: (() => {
      const i = args.indexOf('--threshold');
      return i >= 0 ? parseInt(args[i + 1], 10) : 3000;
    })(),
    verbose: args.includes('--verbose'),
    llmScreen: args.includes('--llm-screen'),
  };
}

// ── Junk HTML Patterns ─────────────────────────────────────────────────────

const NAVIGATION_PATTERNS = [
  /sign\s*in|log\s*in|log\s*out|sign\s*up/i,
  /cookie\s*(policy|consent|preferences|notice)/i,
  /terms\s+of\s+(use|service)/i,
  /privacy\s+policy/i,
  /copyright\s+©?\s*\d{4}/i,
  /subscribe|newsletter|follow\s+us\s+on/i,
  /breadcrumb|sidebar|footer|header/i,
  /download\s+(free|now|save|share|print|embed)/i,
  /about\s+scribd|join\s+our\s+team|adchoices/i,
  /get\s+our\s+free\s+apps/i,
  /we\s+take\s+content\s+rights\s+seriously/i,
  /uploaded\s+by\s+\w+/i,
  /ai-enhanced\s+(title|description)/i,
  /^\s*\d+[KMB]?\s+views?\s/i,
  /^\s*\d+\s+ratings?\s/i,
  /share\s+this\s+document/i,
  /^\s*\d+:\d{2}\s+/,  // video timestamps like "0:05 ..."
  /^\s*search\s+in\s+video\s*$/i,
  /^\s*transcript\s*$/i,
  /^\s*chapters\s*$/i,
];

/** YouTube sidebar/recommendation patterns */
const YOUTUBE_SIDEBAR_PATTERNS = [
  /^\s*\d+[KMB]?\s+views?\s*•?\s*\d+\s*(years?|months?|weeks?|days?|hours?)\s+ago/i,
  /^\s*\d+:\d{2}(:\d{2})?\s*$/,  // bare timestamps like "1:24:35"
];

// ── Screening Heuristics ───────────────────────────────────────────────────

function stripWhitespace(text: string): string {
  return text.replace(/\s+/g, '');
}

function computeJunkLineRatio(text: string): number {
  const lines = text.split('\n').filter(l => l.trim().length > 0);
  if (lines.length === 0) return 1;

  let junkLines = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    // Skip very short lines (likely formatting artifacts)
    if (trimmed.length < 3) { junkLines++; continue; }

    const isJunk = NAVIGATION_PATTERNS.some(p => p.test(trimmed))
      || YOUTUBE_SIDEBAR_PATTERNS.some(p => p.test(trimmed));
    if (isJunk) junkLines++;
  }

  return junkLines / lines.length;
}

function screenDoc(
  textPath: string,
  docSlug: string,
  documentName: string,
  company: string,
  product: string,
  config: Config,
): DocScreenResult {
  const result: DocScreenResult = {
    company,
    product,
    docSlug,
    documentName,
    textPath,
    textBytes: 0,
    strippedBytes: 0,
    quarantined: false,
    reason: null,
    recommendation: null,
  };

  // Rule 1: Empty/missing file
  if (!fs.existsSync(textPath)) {
    result.quarantined = true;
    result.reason = 'extraction_failed';
    result.recommendation = 'File not found. Re-download or find alternative source.';
    return result;
  }

  const stat = fs.statSync(textPath);
  result.textBytes = stat.size;

  if (stat.size === 0) {
    result.quarantined = true;
    result.reason = 'extraction_failed';
    result.recommendation = 'Empty file. Extraction likely failed. Re-download with headless browser.';
    return result;
  }

  const text = fs.readFileSync(textPath, 'utf-8');
  result.strippedBytes = stripWhitespace(text).length;

  // Rule 2: Tiny stub (< 1,000 bytes)
  if (stat.size < 1000) {
    result.quarantined = true;
    result.reason = 'stub_extraction';
    result.recommendation = 'Tiny stub. Re-download with headless browser or find alternative spec doc.';
    return result;
  }

  // Rule 3: YouTube metadata (contains "youtube" in slug/name + < 2,000 bytes)
  const isYouTubeLike = /youtube/i.test(docSlug) || /youtube/i.test(documentName)
    || text.includes('youtube.com') || /search\s+in\s+video/i.test(text);
  if (isYouTubeLike && stat.size < 2000) {
    result.quarantined = true;
    result.reason = 'video_stub';
    result.recommendation = 'YouTube video stub. Extract transcript with yt-dlp --write-auto-sub or find text-based documentation.';
    return result;
  }

  // Rule 4: Scribd paywall (contains "scribd" in slug/name or content + < 2,000 bytes)
  const isScribdLike = /scribd/i.test(docSlug) || /scribd/i.test(documentName)
    || text.includes('scribd.com') || text.includes('About Scribd');
  if (isScribdLike && stat.size < 2000) {
    result.quarantined = true;
    result.reason = 'paywall_stub';
    result.recommendation = 'Scribd paywall. Download via Scribd subscription, library access, or find alternative source (vendor website, IEEE).';
    return result;
  }

  // Rule 5: Junk HTML patterns (> 30% of non-empty lines match nav/footer/cookie patterns)
  const junkRatio = computeJunkLineRatio(text);
  result.junkLineRatio = Math.round(junkRatio * 1000) / 1000;
  if (junkRatio > 0.30) {
    result.quarantined = true;
    result.reason = 'junk_html';
    result.recommendation = `${Math.round(junkRatio * 100)}% junk lines (nav/footer/cookie/sidebar). Re-extract with headless browser or find alternative documentation.`;
    return result;
  }

  // Rule 6: Thin content (< threshold bytes after stripping whitespace)
  if (result.strippedBytes < config.thinContentThreshold) {
    result.quarantined = true;
    result.reason = 'thin_content';
    result.recommendation = `Only ${result.strippedBytes} bytes of actual content (threshold: ${config.thinContentThreshold}). Find more comprehensive documentation (admin guide, reference manual instead of marketing page).`;
    return result;
  }

  return result;
}

// ── Doc Discovery ──────────────────────────────────────────────────────────

interface DocToScreen {
  textPath: string;
  docSlug: string;
  documentName: string;
  company: string;
  product: string;
}

function discoverControlGroupDocs(): DocToScreen[] {
  if (!fs.existsSync(MANIFEST_PATH)) {
    console.error(`Manifest not found: ${MANIFEST_PATH}`);
    process.exit(1);
  }

  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8'));
  const pairs: ManifestPair[] = manifest.pairs;

  // Deduplicate by textPath (same doc may appear for multiple patents)
  const seen = new Set<string>();
  const docs: DocToScreen[] = [];
  for (const p of pairs) {
    if (seen.has(p.textPath)) continue;
    seen.add(p.textPath);
    docs.push({
      textPath: p.textPath,
      docSlug: p.docSlug,
      documentName: p.documentName,
      company: p.companySlug,
      product: p.productSlug,
    });
  }
  return docs;
}

function discoverAllDocs(): DocToScreen[] {
  const docs: DocToScreen[] = [];

  if (!fs.existsSync(TEXTS_DIR)) {
    console.error(`Texts directory not found: ${TEXTS_DIR}`);
    process.exit(1);
  }

  // Walk cache/calibration-control/texts/{company}/{product}/{docSlug}.txt
  for (const company of fs.readdirSync(TEXTS_DIR)) {
    const companyDir = path.join(TEXTS_DIR, company);
    if (!fs.statSync(companyDir).isDirectory()) continue;

    for (const product of fs.readdirSync(companyDir)) {
      const productDir = path.join(companyDir, product);
      if (!fs.statSync(productDir).isDirectory()) continue;

      for (const file of fs.readdirSync(productDir)) {
        if (!file.endsWith('.txt')) continue;
        const docSlug = file.replace(/\.txt$/, '');
        docs.push({
          textPath: path.join(productDir, file),
          docSlug,
          documentName: docSlug, // No human-friendly name in filesystem; use slug
          company,
          product,
        });
      }
    }
  }

  return docs;
}

// ── Quarantine Report ──────────────────────────────────────────────────────

function generateReport(results: ScreeningResults): string {
  const lines: string[] = [];
  const quarantined = results.results.filter(r => r.quarantined);

  lines.push('# Doc Quality Quarantine Report');
  lines.push('');
  lines.push(`Generated: ${results.screenedAt}`);
  lines.push('');

  // Summary stats
  lines.push('## Summary');
  lines.push('');
  lines.push(`| Metric | Count |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Total screened | ${results.totalDocs} |`);
  lines.push(`| Passed | ${results.passed} |`);
  lines.push(`| Quarantined | ${results.quarantined} |`);
  lines.push(`| Quarantine rate | ${((results.quarantined / results.totalDocs) * 100).toFixed(1)}% |`);
  lines.push('');

  lines.push('### By Reason');
  lines.push('');
  lines.push('| Reason | Count |');
  lines.push('|--------|-------|');
  for (const [reason, count] of Object.entries(results.byReason).sort((a, b) => b[1] - a[1])) {
    lines.push(`| ${reason} | ${count} |`);
  }
  lines.push('');

  // Company breakdown
  const byCompany = new Map<string, DocScreenResult[]>();
  for (const r of quarantined) {
    const list = byCompany.get(r.company) || [];
    list.push(r);
    byCompany.set(r.company, list);
  }

  lines.push('### By Company');
  lines.push('');
  for (const [company, docs] of [...byCompany.entries()].sort((a, b) => b[1].length - a[1].length)) {
    lines.push(`- **${company}**: ${docs.length} quarantined — ${docs.map(d => d.reason).join(', ')}`);
  }
  lines.push('');

  // Group by reason for actionable sections
  const grouped = new Map<string, DocScreenResult[]>();
  for (const r of quarantined) {
    const list = grouped.get(r.reason!) || [];
    list.push(r);
    grouped.set(r.reason!, list);
  }

  // Paywall docs
  const paywalls = grouped.get('paywall_stub') || [];
  if (paywalls.length > 0) {
    lines.push('## Paywall Docs');
    lines.push('');
    lines.push('Content exists behind paywall (Scribd, IEEE, ACM). Action: manual download or library access.');
    lines.push('');
    for (const r of paywalls) {
      lines.push(`- **${r.company}/${r.product}** — \`${r.docSlug}\``);
      lines.push(`  - Extracted bytes: ${r.textBytes}`);
      lines.push(`  - ${r.recommendation}`);
    }
    lines.push('');
  }

  // Video stubs
  const videos = grouped.get('video_stub') || [];
  if (videos.length > 0) {
    lines.push('## Video Stubs');
    lines.push('');
    lines.push('YouTube/video URLs where transcripts could be extracted. Action: `yt-dlp --write-auto-sub` or manual transcript.');
    lines.push('');
    for (const r of videos) {
      lines.push(`- **${r.company}/${r.product}** — \`${r.docSlug}\``);
      lines.push(`  - Extracted bytes: ${r.textBytes}`);
      lines.push(`  - ${r.recommendation}`);
    }
    lines.push('');
  }

  // Junk HTML
  const junkHtml = grouped.get('junk_html') || [];
  if (junkHtml.length > 0) {
    lines.push('## Junk HTML / JS-Rendered Pages');
    lines.push('');
    lines.push('Pages dominated by navigation, footers, cookie banners, or sidebar content. Action: re-extract with Playwright headless browser.');
    lines.push('');
    for (const r of junkHtml) {
      lines.push(`- **${r.company}/${r.product}** — \`${r.docSlug}\``);
      lines.push(`  - Extracted bytes: ${r.textBytes} | Junk line ratio: ${((r.junkLineRatio || 0) * 100).toFixed(0)}%`);
      lines.push(`  - ${r.recommendation}`);
    }
    lines.push('');
  }

  // Extraction failures
  const failures = grouped.get('extraction_failed') || [];
  if (failures.length > 0) {
    lines.push('## Extraction Failures');
    lines.push('');
    lines.push('PDFs too large, HTML that crashed parser, or missing files. Action: page-range extraction or alternative source.');
    lines.push('');
    for (const r of failures) {
      lines.push(`- **${r.company}/${r.product}** — \`${r.docSlug}\``);
      lines.push(`  - ${r.recommendation}`);
    }
    lines.push('');
  }

  // Stub extraction
  const stubs = grouped.get('stub_extraction') || [];
  if (stubs.length > 0) {
    lines.push('## Stub Extractions');
    lines.push('');
    lines.push('Very small files (< 1,000 bytes) that likely failed to extract meaningful content.');
    lines.push('');
    for (const r of stubs) {
      lines.push(`- **${r.company}/${r.product}** — \`${r.docSlug}\``);
      lines.push(`  - Extracted bytes: ${r.textBytes}`);
      lines.push(`  - ${r.recommendation}`);
    }
    lines.push('');
  }

  // Thin content
  const thin = grouped.get('thin_content') || [];
  if (thin.length > 0) {
    lines.push('## Thin Content');
    lines.push('');
    lines.push('Docs that extracted but have too little technical material. Action: find alternative documentation (admin guide, reference manual instead of marketing page).');
    lines.push('');
    for (const r of thin) {
      lines.push(`- **${r.company}/${r.product}** — \`${r.docSlug}\``);
      lines.push(`  - Extracted bytes: ${r.textBytes} | Content bytes (stripped): ${r.strippedBytes}`);
      lines.push(`  - ${r.recommendation}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ── Main ───────────────────────────────────────────────────────────────────

function main() {
  const config = parseArgs();

  if (!config.controlOnly && !config.all) {
    console.error('Please specify --control-only or --all');
    process.exit(1);
  }

  // Discover docs to screen
  const docs = config.controlOnly ? discoverControlGroupDocs() : discoverAllDocs();
  console.log(`=== Doc Quality Screening ===`);
  console.log(`Mode: ${config.controlOnly ? 'control-only' : 'all'}`);
  console.log(`Docs to screen: ${docs.length}`);
  console.log(`Thin content threshold: ${config.thinContentThreshold} bytes`);
  console.log('');

  // Screen each doc
  const screenResults: DocScreenResult[] = [];
  for (const doc of docs) {
    const result = screenDoc(
      doc.textPath,
      doc.docSlug,
      doc.documentName,
      doc.company,
      doc.product,
      config,
    );
    screenResults.push(result);

    if (config.verbose) {
      const status = result.quarantined ? `QUARANTINED (${result.reason})` : 'PASSED';
      const size = result.textBytes > 0 ? `${(result.textBytes / 1024).toFixed(1)}K` : '0';
      const stripped = result.strippedBytes > 0 ? `${(result.strippedBytes / 1024).toFixed(1)}K stripped` : '';
      const junk = result.junkLineRatio !== undefined ? `${(result.junkLineRatio * 100).toFixed(0)}% junk` : '';
      const details = [size, stripped, junk].filter(Boolean).join(', ');
      console.log(`  ${status.padEnd(35)} ${doc.company}/${doc.product}/${doc.docSlug.substring(0, 40)} (${details})`);
    }
  }

  // Compute summary
  const quarantined = screenResults.filter(r => r.quarantined);
  const byReason: Record<string, number> = {};
  for (const r of quarantined) {
    byReason[r.reason!] = (byReason[r.reason!] || 0) + 1;
  }

  const results: ScreeningResults = {
    screenedAt: new Date().toISOString(),
    totalDocs: screenResults.length,
    quarantined: quarantined.length,
    passed: screenResults.length - quarantined.length,
    byReason,
    results: screenResults,
  };

  // Write results
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const resultsPath = path.join(OUTPUT_DIR, 'results.json');
  fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2));
  console.log(`\nResults written to: ${resultsPath}`);

  // Write quarantine report
  const reportPath = path.join(OUTPUT_DIR, 'quarantine-report.md');
  fs.writeFileSync(reportPath, generateReport(results));
  console.log(`Report written to: ${reportPath}`);

  // Print summary
  console.log(`\n${'='.repeat(60)}`);
  console.log('SCREENING SUMMARY');
  console.log(`${'='.repeat(60)}`);
  console.log(`Total docs:   ${results.totalDocs}`);
  console.log(`Passed:       ${results.passed}`);
  console.log(`Quarantined:  ${results.quarantined} (${((results.quarantined / results.totalDocs) * 100).toFixed(1)}%)`);
  console.log('');
  console.log('By reason:');
  for (const [reason, count] of Object.entries(byReason).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${reason.padEnd(25)} ${count}`);
  }

  // Show passed docs by size bucket
  const passed = screenResults.filter(r => !r.quarantined);
  const buckets = { '<10K': 0, '10-50K': 0, '50-100K': 0, '100-500K': 0, '>500K': 0 };
  for (const r of passed) {
    const kb = r.textBytes / 1024;
    if (kb < 10) buckets['<10K']++;
    else if (kb < 50) buckets['10-50K']++;
    else if (kb < 100) buckets['50-100K']++;
    else if (kb < 500) buckets['100-500K']++;
    else buckets['>500K']++;
  }
  console.log('\nPassed docs by size:');
  for (const [bucket, count] of Object.entries(buckets)) {
    if (count > 0) console.log(`  ${bucket.padEnd(15)} ${count}`);
  }
}

main();
