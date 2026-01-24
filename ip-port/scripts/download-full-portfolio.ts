/**
 * Download Full Portfolio
 *
 * Downloads ALL Broadcom portfolio patents (all affiliates, no CPC filter).
 * Sorts by grant date (most recent first) for citation analysis.
 *
 * Usage:
 *   npx tsx scripts/download-full-portfolio.ts [--limit N] [--resume]
 */

import * as fs from 'fs';
import * as dotenv from 'dotenv';
import { createCachedPatentsViewClient } from '../clients/cached-clients.js';
import { getCacheStats } from '../services/cache-service.js';

dotenv.config();

const OUTPUT_DIR = './output';
const DATE_STAMP = new Date().toISOString().slice(0, 10);

// All Broadcom portfolio assignees from config
const PORTFOLIO_ASSIGNEES = [
  // Broadcom
  'Broadcom Inc.', 'Broadcom Corporation', 'Broadcom Corp.',
  // Avago
  'Avago Technologies International Sales Pte. Limited',
  'Avago Technologies General IP (Singapore) Pte. Ltd.',
  'Avago Technologies Limited', 'Avago Technologies U.S. Inc.',
  'Avago Technologies', 'Avago Technologies Fiber IP (Singapore) Pte. Ltd.',
  // LSI
  'LSI Corporation', 'LSI Logic Corporation', 'LSI Logic',
  // Brocade
  'Brocade Communications Systems, Inc.', 'Brocade Communications Systems', 'Brocade',
  // CA Technologies
  'CA, Inc.', 'CA Technologies', 'Computer Associates International, Inc.', 'Computer Associates',
  // Symantec/Blue Coat
  'Symantec Corporation', 'Symantec Operating Corporation', 'Blue Coat Systems, Inc.',
  // VMware family
  'VMware LLC', 'VMware, Inc.', 'VMware, LLC', 'VMware International Limited', 'VMware',
  'Nicira, Inc.', 'Nicira Inc.', 'Nicira',
  'Avi Networks', 'Avi Networks Inc.',
  'Lastline, Inc.', 'Lastline Inc.',
  'PIVOTAL SOFTWARE, INC.', 'Pivotal Software, Inc.', 'Pivotal Software',
  'Carbon Black, Inc.', 'Carbon Black Inc.', 'Carbon Black',
  'NYANSA', 'Nyansa', 'Nyansa Inc', 'Nyansa, Inc.',
];

interface PatentCandidate {
  patent_id: string;
  patent_title: string;
  patent_date: string;
  assignee: string;
  forward_citations: number;
  remaining_years: number;
  score: number;
}

function parseArgs(): { limit: number | null; resume: boolean } {
  const args = process.argv.slice(2);
  let limit: number | null = null;
  let resume = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--limit' && args[i + 1]) {
      limit = parseInt(args[i + 1]);
      i++;
    } else if (args[i] === '--resume') {
      resume = true;
    }
  }

  return { limit, resume };
}

function calculateRemainingYears(grantDate: string): number {
  const grant = new Date(grantDate);
  const now = new Date();
  const expirationDate = new Date(grant);
  expirationDate.setFullYear(expirationDate.getFullYear() + 20);

  const remainingMs = expirationDate.getTime() - now.getTime();
  const remainingYears = remainingMs / (1000 * 60 * 60 * 24 * 365.25);

  return Math.max(0, remainingYears);
}

function calculateScore(patent: any): number {
  const citations = patent.patent_num_times_cited_by_us_patents || 0;
  const remainingYears = calculateRemainingYears(patent.patent_date || '2000-01-01');

  // Simple score: citations * remaining years factor
  const yearsFactor = Math.min(remainingYears / 10, 1.5); // Up to 1.5x for 15+ years remaining
  return citations * yearsFactor;
}

async function main() {
  const { limit, resume } = parseArgs();

  console.log('\n' + '═'.repeat(65));
  console.log('     FULL PORTFOLIO DOWNLOAD');
  console.log('═'.repeat(65));
  console.log(`\nDate: ${DATE_STAMP}`);
  console.log(`Assignees: ${PORTFOLIO_ASSIGNEES.length} variants`);
  console.log(`Limit: ${limit || 'none'}`);

  // Create output directory
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // Check for existing progress
  const progressFile = `${OUTPUT_DIR}/portfolio-download-progress.json`;
  let startAfter: string | null = null;
  let existingPatents: PatentCandidate[] = [];

  if (resume && fs.existsSync(progressFile)) {
    const progress = JSON.parse(fs.readFileSync(progressFile, 'utf-8'));
    startAfter = progress.lastPatentId;
    existingPatents = progress.patents || [];
    console.log(`\nResuming from: ${existingPatents.length} patents, last ID: ${startAfter}`);
  }

  const client = createCachedPatentsViewClient();
  const rawClient = client.getRawClient();

  // Build query for all portfolio assignees
  const query = {
    _or: PORTFOLIO_ASSIGNEES.map(assignee => ({
      'assignees.assignee_organization': assignee
    }))
  };

  const candidates: PatentCandidate[] = [...existingPatents];
  let fetched = 0;
  let pageCount = 0;
  const startTime = Date.now();

  console.log('\nFetching patents (sorted by date, newest first)...\n');

  try {
    for await (const page of rawClient.searchPaginated(
      {
        query,
        fields: [
          'patent_id',
          'patent_title',
          'patent_date',
          'assignees.assignee_organization',
          'patent_num_times_cited_by_us_patents',
        ],
        sort: [{ patent_date: 'desc' }],
        options: {
          after: startAfter ? startAfter : undefined,
        },
      },
      500
    )) {
      pageCount++;

      for (const patent of page) {
        const assignee = patent.assignees?.[0]?.assignee_organization || 'Unknown';
        const remainingYears = calculateRemainingYears(patent.patent_date || '2000-01-01');
        const forwardCitations = patent.patent_num_times_cited_by_us_patents || 0;

        candidates.push({
          patent_id: patent.patent_id,
          patent_title: patent.patent_title || '',
          patent_date: patent.patent_date || '',
          assignee,
          forward_citations: forwardCitations,
          remaining_years: Math.round(remainingYears * 10) / 10,
          score: calculateScore(patent),
        });
        fetched++;
      }

      // Progress update
      const elapsed = (Date.now() - startTime) / 1000;
      const rate = fetched / elapsed;
      process.stdout.write(
        `\r  Page ${pageCount}: ${candidates.length.toLocaleString()} patents | ` +
        `${rate.toFixed(0)} p/s | ` +
        `Latest: ${page[page.length - 1]?.patent_date || 'N/A'}     `
      );

      // Save progress periodically
      if (pageCount % 10 === 0) {
        fs.writeFileSync(progressFile, JSON.stringify({
          lastPatentId: page[page.length - 1]?.patent_id,
          patents: candidates,
          timestamp: new Date().toISOString(),
        }));
      }

      // Check limit
      if (limit && candidates.length >= limit) {
        console.log(`\n\nReached limit of ${limit} patents`);
        break;
      }

      // Rate limiting (1.4s between requests)
      await new Promise(r => setTimeout(r, 1400));
    }

  } catch (err: any) {
    console.error(`\n\nError: ${err.message}`);
    console.log('Progress saved. Run with --resume to continue.');

    // Save progress on error
    if (candidates.length > 0) {
      fs.writeFileSync(progressFile, JSON.stringify({
        lastPatentId: candidates[candidates.length - 1].patent_id,
        patents: candidates,
        timestamp: new Date().toISOString(),
        error: err.message,
      }));
    }
    process.exit(1);
  }

  // Sort by date (newest first) - should already be sorted but ensure it
  candidates.sort((a, b) =>
    new Date(b.patent_date).getTime() - new Date(a.patent_date).getTime()
  );

  // Summary
  const elapsed = (Date.now() - startTime) / 1000 / 60;
  console.log('\n\n' + '─'.repeat(65));
  console.log('DOWNLOAD COMPLETE');
  console.log('─'.repeat(65));
  console.log(`  Total patents: ${candidates.length.toLocaleString()}`);
  console.log(`  Time: ${elapsed.toFixed(1)} minutes`);

  // Date range
  const newestDate = candidates[0]?.patent_date || 'N/A';
  const oldestDate = candidates[candidates.length - 1]?.patent_date || 'N/A';
  console.log(`  Date range: ${oldestDate} to ${newestDate}`);

  // Expired vs active
  const active = candidates.filter(p => p.remaining_years > 0);
  const expired = candidates.filter(p => p.remaining_years <= 0);
  console.log(`  Active patents: ${active.length.toLocaleString()} (${(active.length / candidates.length * 100).toFixed(1)}%)`);
  console.log(`  Expired patents: ${expired.length.toLocaleString()}`);

  // Top assignees
  const assigneeCounts = new Map<string, number>();
  candidates.forEach(p => {
    const name = p.assignee.split(',')[0].trim();
    assigneeCounts.set(name, (assigneeCounts.get(name) || 0) + 1);
  });

  console.log('\n  Top Assignees:');
  [...assigneeCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .forEach(([name, count]) => {
      console.log(`    ${name}: ${count.toLocaleString()}`);
    });

  // Save final output
  const outputFile = `${OUTPUT_DIR}/portfolio-candidates-${DATE_STAMP}.json`;
  fs.writeFileSync(outputFile, JSON.stringify({
    metadata: {
      generatedDate: new Date().toISOString(),
      totalPatents: candidates.length,
      activePatents: active.length,
      expiredPatents: expired.length,
      dateRange: { oldest: oldestDate, newest: newestDate },
    },
    candidates,
  }, null, 2));

  console.log(`\nSaved to: ${outputFile}`);

  // Also save a streaming-candidates file for compatibility with existing scripts
  const streamingFile = `${OUTPUT_DIR}/streaming-candidates-${DATE_STAMP}.json`;
  fs.writeFileSync(streamingFile, JSON.stringify({
    candidates,
  }, null, 2));
  console.log(`Also saved as: ${streamingFile}`);

  // Clean up progress file
  if (fs.existsSync(progressFile)) {
    fs.unlinkSync(progressFile);
  }

  // Cache stats
  const stats = await getCacheStats();
  console.log(`\nCache: ${stats.apiCache.count} entries, ${(stats.apiCache.totalSize / 1024 / 1024).toFixed(2)} MB`);

  process.exit(0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
