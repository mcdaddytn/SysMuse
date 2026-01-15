/**
 * Streaming Video Patent Downloader
 *
 * Downloads Broadcom patents focused on streaming video technology.
 * Designed for batch processing with:
 * - Incremental saves (resumable)
 * - Progress tracking
 * - Configurable batch sizes
 * - Standalone execution (can run overnight)
 *
 * Usage:
 *   npx tsx examples/streaming-video-downloader.ts [--limit N] [--batch-size N]
 *
 * CPC Codes for Streaming Video:
 *   H04N - Pictorial communication (video coding, transmission)
 *   H04L - Transmission of digital information (streaming protocols)
 *   H04W - Wireless communication (mobile video)
 *   G06T - Image data processing
 *   G11B - Information storage (media storage)
 */

import { createPatentsViewClient, Patent } from '../clients/patentsview-client.js';
import * as fs from 'fs/promises';
import * as dotenv from 'dotenv';

dotenv.config();

// Configuration
interface DownloadConfig {
  outputDir: string;
  batchSize: number;       // Patents per API request
  maxPatents: number;      // 0 = unlimited
  saveEvery: number;       // Save checkpoint every N patents
  delayMs: number;         // Delay between requests (rate limiting)
  focusAreas: string[];    // CPC codes to focus on
}

const DEFAULT_CONFIG: DownloadConfig = {
  outputDir: './output/streaming-video',
  batchSize: 500,          // Smaller batches for more frequent progress
  maxPatents: 0,           // Download all
  saveEvery: 1000,         // Save every 1000 patents
  delayMs: 1400,           // ~43 requests/min (under 45 limit)
  focusAreas: ['H04N', 'H04L', 'H04W', 'G06T', 'G11B'],
};

// Streaming video CPC descriptions
const CPC_DESCRIPTIONS: Record<string, string> = {
  'H04N': 'Pictorial Communication (Video Coding/Transmission)',
  'H04L': 'Digital Information Transmission (Streaming Protocols)',
  'H04W': 'Wireless Communication Networks (Mobile Video)',
  'G06T': 'Image Data Processing (Video Processing)',
  'G11B': 'Information Storage (Media Storage/Playback)',
  'H04N19': 'Video Coding Methods',
  'H04N21': 'Selective Content Distribution (Streaming)',
  'H04L65': 'Network Streaming Protocols',
  'H04L67': 'Network Services',
};

// Broadcom assignee variants (from config)
const BROADCOM_VARIANTS = [
  'Broadcom Inc.', 'Broadcom Corporation', 'Broadcom Corp.',
  'Avago Technologies International Sales Pte. Limited',
  'Avago Technologies General IP (Singapore) Pte. Ltd.',
  'Avago Technologies Limited', 'Avago Technologies U.S. Inc.',
  'Avago Technologies', 'Avago Technologies Fiber IP (Singapore) Pte. Ltd.',
  'LSI Corporation', 'LSI Logic Corporation', 'LSI Logic',
  'Brocade Communications Systems, Inc.', 'Brocade Communications Systems', 'Brocade',
  'CA, Inc.', 'CA Technologies', 'Computer Associates International, Inc.', 'Computer Associates',
  'Symantec Corporation', 'Symantec Operating Corporation',
  'VMware, Inc.', 'VMware, LLC', 'VMware International Limited', 'VMware',
];

interface DownloadProgress {
  startedAt: string;
  lastUpdated: string;
  totalFetched: number;
  lastPatentDate: string | null;
  lastPatentId: string | null;
  pagesCompleted: number;
  estimatedTotal: number | null;
  config: DownloadConfig;
}

interface DownloadResult {
  patents: Patent[];
  progress: DownloadProgress;
}

/**
 * Load existing progress if resuming
 */
async function loadProgress(outputDir: string): Promise<DownloadProgress | null> {
  try {
    const progressFile = `${outputDir}/progress.json`;
    const data = await fs.readFile(progressFile, 'utf-8');
    return JSON.parse(data);
  } catch {
    return null;
  }
}

/**
 * Save current progress
 */
async function saveProgress(progress: DownloadProgress, outputDir: string): Promise<void> {
  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(
    `${outputDir}/progress.json`,
    JSON.stringify(progress, null, 2)
  );
}

/**
 * Save patents batch to file
 */
async function savePatentsBatch(
  patents: Patent[],
  batchNumber: number,
  outputDir: string
): Promise<void> {
  await fs.mkdir(outputDir, { recursive: true });
  const timestamp = new Date().toISOString().split('T')[0];
  await fs.writeFile(
    `${outputDir}/patents-batch-${String(batchNumber).padStart(4, '0')}-${timestamp}.json`,
    JSON.stringify(patents, null, 2)
  );
}

/**
 * Build query for streaming video patents
 */
function buildStreamingVideoQuery(cpcCodes: string[]): any {
  // Combine assignee filter with CPC filter
  const assigneeQuery = {
    _or: BROADCOM_VARIANTS.map(variant => ({
      'assignees.assignee_organization': variant
    }))
  };

  // CPC filter for streaming video
  const cpcQuery = {
    _or: cpcCodes.map(cpc => ({
      _begins: { 'cpc_current.cpc_group_id': cpc }
    }))
  };

  return {
    _and: [assigneeQuery, cpcQuery]
  };
}

/**
 * Main download function
 */
async function downloadStreamingVideoPatents(
  config: DownloadConfig = DEFAULT_CONFIG
): Promise<DownloadResult> {
  const client = createPatentsViewClient();

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('     BROADCOM STREAMING VIDEO PATENT DOWNLOADER');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log('Configuration:');
  console.log(`  Output directory: ${config.outputDir}`);
  console.log(`  Batch size: ${config.batchSize} patents/request`);
  console.log(`  Max patents: ${config.maxPatents || 'unlimited'}`);
  console.log(`  Save checkpoint every: ${config.saveEvery} patents`);
  console.log(`  Rate limit delay: ${config.delayMs}ms (~${Math.floor(60000/config.delayMs)} req/min)`);
  console.log(`  Focus CPC codes: ${config.focusAreas.join(', ')}\n`);

  // Check for existing progress
  const existingProgress = await loadProgress(config.outputDir);
  if (existingProgress) {
    console.log('Found existing progress:');
    console.log(`  Previously fetched: ${existingProgress.totalFetched} patents`);
    console.log(`  Last patent date: ${existingProgress.lastPatentDate}`);
    console.log('  Resuming from checkpoint...\n');
  }

  // Initialize progress
  const progress: DownloadProgress = existingProgress || {
    startedAt: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
    totalFetched: 0,
    lastPatentDate: null,
    lastPatentId: null,
    pagesCompleted: 0,
    estimatedTotal: null,
    config,
  };

  const allPatents: Patent[] = [];
  let batchNumber = existingProgress ? Math.floor(existingProgress.totalFetched / config.saveEvery) : 0;
  let currentBatch: Patent[] = [];

  // Build query
  const query = buildStreamingVideoQuery(config.focusAreas);

  console.log('Starting download...\n');
  console.log('Progress:');

  const startTime = Date.now();
  let requestCount = 0;

  try {
    for await (const page of client.searchPaginated(
      {
        query,
        fields: [
          'patent_id',
          'patent_title',
          'patent_date',
          'patent_abstract',
          'assignees',
          'inventors',
          'cpc_current',
        ],
        sort: [{ patent_date: 'desc' }],
      },
      config.batchSize
    )) {
      requestCount++;
      allPatents.push(...page);
      currentBatch.push(...page);

      // Update progress
      progress.totalFetched = allPatents.length;
      progress.lastUpdated = new Date().toISOString();
      progress.pagesCompleted++;

      if (page.length > 0) {
        progress.lastPatentDate = page[page.length - 1].patent_date || null;
        progress.lastPatentId = page[page.length - 1].patent_id || null;
      }

      // Calculate rate
      const elapsed = (Date.now() - startTime) / 1000;
      const rate = allPatents.length / elapsed;

      // Progress output
      const progressLine = `  ${allPatents.length.toLocaleString().padStart(8)} patents | ` +
        `${requestCount} requests | ` +
        `${rate.toFixed(0)} patents/sec | ` +
        `Latest: ${progress.lastPatentDate || 'N/A'}`;

      process.stdout.write(`\r${progressLine}`);

      // Save checkpoint
      if (currentBatch.length >= config.saveEvery) {
        batchNumber++;
        await savePatentsBatch(currentBatch, batchNumber, config.outputDir);
        await saveProgress(progress, config.outputDir);
        console.log(`\n  ✓ Checkpoint saved: batch ${batchNumber} (${currentBatch.length} patents)`);
        currentBatch = [];
      }

      // Check limit
      if (config.maxPatents > 0 && allPatents.length >= config.maxPatents) {
        console.log(`\n  Reached max patents limit (${config.maxPatents})`);
        break;
      }

      // Rate limit delay
      await new Promise(resolve => setTimeout(resolve, config.delayMs));
    }

    // Save final batch
    if (currentBatch.length > 0) {
      batchNumber++;
      await savePatentsBatch(currentBatch, batchNumber, config.outputDir);
      await saveProgress(progress, config.outputDir);
      console.log(`\n  ✓ Final batch saved: batch ${batchNumber} (${currentBatch.length} patents)`);
    }

  } catch (error) {
    // Save progress on error
    await saveProgress(progress, config.outputDir);
    console.error(`\n\n✗ Error during download: ${error}`);
    console.log(`  Progress saved. Run again to resume from ${progress.totalFetched} patents.`);
    throw error;
  }

  // Summary
  const totalTime = (Date.now() - startTime) / 1000;

  console.log('\n\n═══════════════════════════════════════════════════════════════');
  console.log('                    DOWNLOAD COMPLETE');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log('Summary:');
  console.log(`  Total patents: ${allPatents.length.toLocaleString()}`);
  console.log(`  Total time: ${totalTime.toFixed(1)} seconds`);
  console.log(`  Average rate: ${(allPatents.length / totalTime).toFixed(1)} patents/second`);
  console.log(`  API requests: ${requestCount}`);
  console.log(`  Date range: ${progress.lastPatentDate} to ${allPatents[0]?.patent_date || 'N/A'}`);
  console.log(`\n  Files saved to: ${config.outputDir}/`);

  // CPC breakdown
  const cpcCounts = new Map<string, number>();
  allPatents.forEach(p => {
    const cpc = (p as any).cpc_current?.[0]?.cpc_group_id?.substring(0, 4) || 'Unknown';
    cpcCounts.set(cpc, (cpcCounts.get(cpc) || 0) + 1);
  });

  console.log('\n  CPC Breakdown:');
  Array.from(cpcCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .forEach(([cpc, count]) => {
      const desc = CPC_DESCRIPTIONS[cpc] || cpc;
      console.log(`    ${cpc}: ${count.toLocaleString()} (${desc})`);
    });

  return { patents: allPatents, progress };
}

/**
 * Parse command line arguments
 */
function parseArgs(): Partial<DownloadConfig> {
  const args = process.argv.slice(2);
  const config: Partial<DownloadConfig> = {};

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--limit' && args[i + 1]) {
      config.maxPatents = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--batch-size' && args[i + 1]) {
      config.batchSize = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--output' && args[i + 1]) {
      config.outputDir = args[i + 1];
      i++;
    } else if (args[i] === '--save-every' && args[i + 1]) {
      config.saveEvery = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--help' || args[i] === '-h') {
      console.log(`
Streaming Video Patent Downloader

Usage:
  npx tsx examples/streaming-video-downloader.ts [options]

Options:
  --limit N        Maximum patents to download (default: unlimited)
  --batch-size N   Patents per API request (default: 500)
  --output DIR     Output directory (default: ./output/streaming-video)
  --save-every N   Save checkpoint every N patents (default: 1000)
  --help, -h       Show this help

Examples:
  # Download first 1000 patents (test run)
  npx tsx examples/streaming-video-downloader.ts --limit 1000

  # Full download with custom output
  npx tsx examples/streaming-video-downloader.ts --output ./data/broadcom-video

  # Run overnight (full download)
  nohup npx tsx examples/streaming-video-downloader.ts > download.log 2>&1 &
`);
      process.exit(0);
    }
  }

  return config;
}

// Main execution
const customConfig = parseArgs();
const config = { ...DEFAULT_CONFIG, ...customConfig };

downloadStreamingVideoPatents(config)
  .then(({ patents }) => {
    console.log(`\n✓ Successfully downloaded ${patents.length} patents`);
  })
  .catch(error => {
    console.error('\nDownload failed:', error.message);
    process.exit(1);
  });
