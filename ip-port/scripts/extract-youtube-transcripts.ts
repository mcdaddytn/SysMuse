/**
 * Extract YouTube video transcripts from GLSSD2 product docs.
 *
 * Phase 1: Uses the youtube-transcript npm package (open source, no API key)
 * to extract existing auto-generated or manual captions from YouTube videos
 * referenced in GLSSD2 documentation.
 *
 * Saves transcripts as .txt files alongside the original HTML docs, enabling
 * the scoring engine to use clean transcript text instead of YouTube HTML garbage.
 *
 * Usage:
 *   npx tsx scripts/extract-youtube-transcripts.ts [options]
 *     --company <slug>     Single company
 *     --dry-run            Show what would be extracted
 *     --concurrency <n>    Parallel requests (default: 2, be gentle)
 *     --delay <ms>         Delay between requests (default: 2000)
 *     --output-dir <path>  Where to save transcripts (default: GLSSD2 alongside originals)
 */

import * as fs from 'fs';
import * as path from 'path';
// Dynamic import for ESM package
let YoutubeTranscript: any;
async function loadYoutubeTranscript() {
  const mod = await import('youtube-transcript/dist/youtube-transcript.esm.js');
  YoutubeTranscript = mod.YoutubeTranscript;
}

const GLSSD2_BASE = '/Volumes/GLSSD2/data/products/docs';
const TRANSCRIPT_CACHE = path.resolve('./cache/youtube-transcripts');

// YouTube URL patterns
const YT_WATCH_RE = /youtube\.com\/watch\?v=([a-zA-Z0-9_-]{11})/g;
const YT_SHORT_RE = /youtu\.be\/([a-zA-Z0-9_-]{11})/g;
const YT_EMBED_RE = /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/g;

interface VideoRef {
  videoId: string;
  companySlug: string;
  productSlug: string;
  sourceFile: string;
  sourceDocSlug: string;
}

interface Config {
  company: string | null;
  dryRun: boolean;
  concurrency: number;
  delay: number;
  outputDir: string;
}

function parseArgs(): Config {
  const args = process.argv.slice(2);
  const config: Config = {
    company: null,
    dryRun: false,
    concurrency: 2,
    delay: 2000,
    outputDir: GLSSD2_BASE,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--company': config.company = args[++i]; break;
      case '--dry-run': config.dryRun = true; break;
      case '--concurrency': config.concurrency = parseInt(args[++i]); break;
      case '--delay': config.delay = parseInt(args[++i]); break;
      case '--output-dir': config.outputDir = args[++i]; break;
    }
  }
  return config;
}

function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

/** Extract all YouTube video IDs from a file's content. */
function extractVideoIds(content: string): string[] {
  const ids = new Set<string>();
  for (const re of [YT_WATCH_RE, YT_SHORT_RE, YT_EMBED_RE]) {
    re.lastIndex = 0;
    let match;
    while ((match = re.exec(content)) !== null) {
      ids.add(match[1]);
    }
  }
  return [...ids];
}

/** Scan GLSSD2 for all YouTube video references. */
function discoverVideoRefs(config: Config): VideoRef[] {
  const refs: VideoRef[] = [];
  const seenVideoProducts = new Set<string>(); // videoId+company+product dedup

  if (!fs.existsSync(GLSSD2_BASE)) {
    console.log('GLSSD2 not mounted');
    return refs;
  }

  let companyDirs: string[];
  try {
    companyDirs = fs.readdirSync(GLSSD2_BASE).filter(d => {
      if (d.startsWith('.')) return false;
      return fs.statSync(path.join(GLSSD2_BASE, d)).isDirectory();
    });
  } catch { return refs; }

  if (config.company) {
    companyDirs = companyDirs.filter(d => d === config.company);
  }

  for (const companySlug of companyDirs) {
    const companyDir = path.join(GLSSD2_BASE, companySlug);
    let productDirs: string[];
    try {
      productDirs = fs.readdirSync(companyDir).filter(d => {
        if (d.startsWith('.')) return false;
        return fs.statSync(path.join(companyDir, d)).isDirectory();
      });
    } catch { continue; }

    for (const productSlug of productDirs) {
      const productDir = path.join(companyDir, productSlug);
      let files: string[];
      try { files = fs.readdirSync(productDir).filter(f => !f.startsWith('._')); } catch { continue; }

      for (const file of files) {
        const ext = path.extname(file).toLowerCase();
        if (ext !== '.html' && ext !== '.txt') continue;

        const fullPath = path.join(productDir, file);
        let content: string;
        try { content = fs.readFileSync(fullPath, 'utf-8'); } catch { continue; }

        const videoIds = extractVideoIds(content);
        for (const videoId of videoIds) {
          const key = `${videoId}:${companySlug}:${productSlug}`;
          if (seenVideoProducts.has(key)) continue;
          seenVideoProducts.add(key);

          refs.push({
            videoId,
            companySlug,
            productSlug,
            sourceFile: file,
            sourceDocSlug: slugify(path.basename(file, ext)),
          });
        }
      }
    }
  }

  return refs;
}

/** Fetch transcript for a single video. Returns null on failure. */
async function fetchTranscript(videoId: string): Promise<string | null> {
  // Check cache first
  const cachePath = path.join(TRANSCRIPT_CACHE, `${videoId}.txt`);
  if (fs.existsSync(cachePath)) {
    return fs.readFileSync(cachePath, 'utf-8');
  }

  try {
    const segments = await YoutubeTranscript.fetchTranscript(videoId, {
      lang: 'en',
    });

    if (!segments || segments.length === 0) return null;

    // Concatenate segment text, removing duplicate overlapping lines
    const lines: string[] = [];
    let lastText = '';
    for (const seg of segments) {
      const text = seg.text.trim();
      if (text && text !== lastText) {
        lines.push(text);
        lastText = text;
      }
    }

    const transcript = lines.join(' ');
    if (transcript.length < 50) return null;

    // Cache it
    ensureDir(TRANSCRIPT_CACHE);
    fs.writeFileSync(cachePath, transcript);

    return transcript;
  } catch (err: any) {
    const msg = err?.message || String(err);
    if (msg.includes('disabled') || msg.includes('Transcript is disabled')) {
      return null; // No captions available
    }
    if (msg.includes('Could not get')) {
      return null; // Video unavailable or private
    }
    throw err; // Unexpected error
  }
}

async function main() {
  await loadYoutubeTranscript();
  const config = parseArgs();

  console.log('=== YouTube Transcript Extraction ===');
  if (config.company) console.log(`Company: ${config.company}`);
  console.log(`Concurrency: ${config.concurrency}`);
  console.log(`Delay: ${config.delay}ms`);
  if (config.dryRun) console.log('MODE: DRY RUN');

  // Discover videos
  console.log('\nScanning GLSSD2 for YouTube references...');
  const refs = discoverVideoRefs(config);

  // Deduplicate by video ID (same video may appear in multiple products)
  const uniqueVideos = new Map<string, VideoRef[]>();
  for (const ref of refs) {
    if (!uniqueVideos.has(ref.videoId)) uniqueVideos.set(ref.videoId, []);
    uniqueVideos.get(ref.videoId)!.push(ref);
  }

  // Check which already have transcripts cached
  let cached = 0;
  for (const videoId of uniqueVideos.keys()) {
    if (fs.existsSync(path.join(TRANSCRIPT_CACHE, `${videoId}.txt`))) cached++;
  }

  console.log(`\nFound ${refs.length} video references across ${uniqueVideos.size} unique videos`);
  console.log(`Already cached: ${cached}`);
  console.log(`To fetch: ${uniqueVideos.size - cached}`);

  // Group by company for reporting
  const byCompany = new Map<string, Set<string>>();
  for (const ref of refs) {
    if (!byCompany.has(ref.companySlug)) byCompany.set(ref.companySlug, new Set());
    byCompany.get(ref.companySlug)!.add(ref.videoId);
  }
  console.log('\nBy company (top 15):');
  const sorted = [...byCompany.entries()].sort((a, b) => b[1].size - a[1].size);
  for (const [company, videos] of sorted.slice(0, 15)) {
    console.log(`  ${company}: ${videos.size} videos`);
  }
  if (sorted.length > 15) console.log(`  ... and ${sorted.length - 15} more`);

  if (config.dryRun) {
    console.log('\n(Dry run — no transcripts fetched)');
    return;
  }

  // Fetch transcripts
  const toFetch = [...uniqueVideos.keys()].filter(
    id => !fs.existsSync(path.join(TRANSCRIPT_CACHE, `${id}.txt`))
  );

  let succeeded = 0;
  let failed = 0;
  let noCaption = 0;

  for (let i = 0; i < toFetch.length; i += config.concurrency) {
    const batch = toFetch.slice(i, i + config.concurrency);
    const batchNum = Math.floor(i / config.concurrency) + 1;
    const totalBatches = Math.ceil(toFetch.length / config.concurrency);

    if (batchNum % 10 === 1 || batchNum === totalBatches) {
      console.log(`\n--- Batch ${batchNum}/${totalBatches} (${succeeded} ok, ${noCaption} no-caption, ${failed} failed) ---`);
    }

    const promises = batch.map(async (videoId) => {
      try {
        const transcript = await fetchTranscript(videoId);
        if (transcript) {
          const products = uniqueVideos.get(videoId) || [];
          const productList = products.map(r => `${r.companySlug}/${r.productSlug}`).slice(0, 3).join(', ');
          console.log(`  OK ${videoId} (${transcript.length} chars) → ${productList}`);

          // Save transcript to each product directory as a .txt file
          for (const ref of products) {
            const outDir = path.join(config.outputDir, ref.companySlug, ref.productSlug);
            const outFile = path.join(outDir, `yt-transcript-${videoId}.txt`);
            if (!fs.existsSync(outFile)) {
              ensureDir(outDir);
              fs.writeFileSync(outFile, `[YouTube Transcript: https://youtube.com/watch?v=${videoId}]\n\n${transcript}`);
            }
          }
          succeeded++;
        } else {
          noCaption++;
        }
      } catch (err) {
        console.log(`  FAIL ${videoId}: ${err instanceof Error ? err.message : err}`);
        failed++;
      }
    });

    await Promise.all(promises);

    // Rate limiting
    if (i + config.concurrency < toFetch.length) {
      await new Promise(r => setTimeout(r, config.delay));
    }
  }

  console.log(`\n=== Extraction Complete ===`);
  console.log(`Succeeded: ${succeeded}`);
  console.log(`No captions: ${noCaption}`);
  console.log(`Failed: ${failed}`);
  console.log(`Total cached: ${succeeded + cached}`);
  console.log(`\nTranscripts saved to: ${TRANSCRIPT_CACHE}`);
  console.log(`Product docs updated in: ${config.outputDir}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
