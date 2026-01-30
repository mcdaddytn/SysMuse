/**
 * Enrich Citations for Patent Family Building
 *
 * Fetches 1-generation parent and child citations for top-ranked patents.
 * - Parents: patents cited BY our patent (backward citations)
 * - Children: patents that cite our patent (already in forward-citations cache)
 *
 * Uses PatentsView /patent/us_patent_citation/ endpoint.
 *
 * Usage:
 *   npx tsx scripts/enrich-citations.ts --count 500
 *   npx tsx scripts/enrich-citations.ts --count 750 --skip-existing
 *   npx tsx scripts/enrich-citations.ts --patent-ids 10000000,10002051
 *   npx tsx scripts/enrich-citations.ts --dry-run --count 100
 */

import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

const PATENTSVIEW_BASE_URL = 'https://search.patentsview.org/api/v1';
const PATENT_FAMILIES_DIR = path.join(process.cwd(), 'cache/patent-families');
const PARENT_CITATIONS_DIR = path.join(PATENT_FAMILIES_DIR, 'parents');
const PARENT_DETAILS_DIR = path.join(PATENT_FAMILIES_DIR, 'parent-details');
const FORWARD_CITATIONS_DIR = path.join(process.cwd(), 'cache/api/patentsview/forward-citations');
const CANDIDATES_DIR = path.join(process.cwd(), 'output');

const RATE_LIMIT_MS = 1500; // 1.5 seconds between API calls (45/min limit)
const BATCH_DETAIL_SIZE = 100; // Max patents per detail fetch

// Retry helper for rate-limited requests
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  maxRetries = 3,
  baseDelayMs = 5000
): Promise<Response> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, options);

    if (response.status === 429) {
      if (attempt < maxRetries) {
        // Exponential backoff: 5s, 10s, 20s
        const delay = baseDelayMs * Math.pow(2, attempt);
        console.log(`  Rate limited (429). Waiting ${delay / 1000}s before retry ${attempt + 1}/${maxRetries}...`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
    }

    return response;
  }

  throw new Error('Max retries exceeded');
}

// Invalidate server cache after job completion
async function invalidateServerCache(): Promise<void> {
  try {
    const response = await fetch('http://localhost:3001/api/patents/invalidate-cache', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    if (response.ok) {
      console.log('\n[Cache] Server enrichment cache invalidated');
    } else {
      console.log('\n[Cache] Failed to invalidate cache (server may not be running)');
    }
  } catch (error) {
    console.log('\n[Cache] Could not contact server to invalidate cache');
  }
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function getApiKey(): string {
  const key = process.env.PATENTSVIEW_API_KEY;
  if (!key) {
    console.error('ERROR: PATENTSVIEW_API_KEY not set');
    process.exit(1);
  }
  return key;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─────────────────────────────────────────────────────────────────────────────
// Data loading (same ranking logic as scoring service)
// ─────────────────────────────────────────────────────────────────────────────

function loadCandidates(): any[] {
  const files = fs.readdirSync(CANDIDATES_DIR)
    .filter(f => f.startsWith('streaming-candidates-') && f.endsWith('.json'))
    .sort()
    .reverse();

  if (files.length === 0) throw new Error('No streaming-candidates file found');
  const data = JSON.parse(fs.readFileSync(path.join(CANDIDATES_DIR, files[0]), 'utf-8'));
  return data.candidates;
}

function loadClassifications(): Map<string, any> {
  const summaryFiles = fs.readdirSync(CANDIDATES_DIR)
    .filter(f => f.startsWith('citation-classification-') && f.endsWith('.json'))
    .sort()
    .reverse();

  const map = new Map<string, any>();
  if (summaryFiles.length > 0) {
    const data = JSON.parse(fs.readFileSync(path.join(CANDIDATES_DIR, summaryFiles[0]), 'utf-8'));
    for (const result of data.results) {
      map.set(result.patent_id, result);
    }
  }
  return map;
}

function simpleScore(candidate: any, classification: any): number {
  const cc = classification?.competitor_citations ?? 0;
  const fc = candidate.forward_citations ?? 0;
  const years = candidate.remaining_years ?? 0;
  const count = classification?.competitor_count ?? 0;

  const ccNorm = Math.min(1, cc / 20);
  const fcNorm = Math.min(1, Math.sqrt(fc) / 30);
  const yearsNorm = Math.min(1, years / 15);
  const countNorm = Math.min(1, count / 5);

  const score = ccNorm * 0.40 + fcNorm * 0.20 + yearsNorm * 0.27 + countNorm * 0.13;
  const yearMult = 0.3 + 0.7 * Math.pow(Math.min(1, Math.max(0, years) / 15), 0.8);
  return score * yearMult * 100;
}

// ─────────────────────────────────────────────────────────────────────────────
// PatentsView API calls
// ─────────────────────────────────────────────────────────────────────────────

async function fetchBackwardCitations(patentId: string, apiKey: string): Promise<string[]> {
  const response = await fetchWithRetry(
    `${PATENTSVIEW_BASE_URL}/patent/us_patent_citation/`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-Api-Key': apiKey,
      },
      body: JSON.stringify({
        q: { patent_id: patentId },
        f: ['citation_patent_id'],
        o: { size: 500 },
      }),
    },
    3,  // maxRetries
    5000 // baseDelayMs
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`API ${response.status}: ${text.substring(0, 200)}`);
  }

  const data = await response.json();
  if (!data.us_patent_citations || data.us_patent_citations.length === 0) {
    return [];
  }

  return [...new Set(
    data.us_patent_citations
      .map((c: any) => c.citation_patent_id)
      .filter((id: string) => id)
  )] as string[];
}

async function fetchPatentDetails(
  patentIds: string[],
  apiKey: string
): Promise<Map<string, any>> {
  const results = new Map<string, any>();

  // Batch in groups of 100
  for (let i = 0; i < patentIds.length; i += BATCH_DETAIL_SIZE) {
    const batch = patentIds.slice(i, i + BATCH_DETAIL_SIZE);

    try {
      const response = await fetchWithRetry(
        `${PATENTSVIEW_BASE_URL}/patent/`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'X-Api-Key': apiKey,
          },
          body: JSON.stringify({
            q: { _or: batch.map(id => ({ patent_id: id })) },
            f: ['patent_id', 'patent_title', 'patent_date', 'patent_abstract', 'assignees'],
            o: { size: BATCH_DETAIL_SIZE },
          }),
        },
        3,  // maxRetries
        5000 // baseDelayMs
      );

      if (!response.ok) {
        console.warn(`    Detail fetch error ${response.status} for batch starting ${batch[0]}`);
        await sleep(RATE_LIMIT_MS);
        continue;
      }

      const data = await response.json();
      for (const patent of data.patents || []) {
        results.set(patent.patent_id, {
          patent_id: patent.patent_id,
          patent_title: patent.patent_title || '',
          patent_date: patent.patent_date || '',
          patent_abstract: patent.patent_abstract || '',
          assignee: patent.assignees?.[0]?.assignee_organization ||
                    patent.assignees?.[0]?.assignee_individual || 'Unknown',
        });
      }

      await sleep(RATE_LIMIT_MS);
    } catch (error) {
      console.warn(`    Detail fetch failed for batch starting ${batch[0]}:`, error);
    }
  }

  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  const countIdx = args.indexOf('--count');
  const count = countIdx !== -1 ? parseInt(args[countIdx + 1] || '500') : 500;

  const patentIdsArg = args.indexOf('--patent-ids');
  const specificPatentIds = patentIdsArg !== -1
    ? args[patentIdsArg + 1]?.split(',').filter(Boolean)
    : null;

  const skipExisting = args.includes('--skip-existing');
  const dryRun = args.includes('--dry-run');
  const fetchDetails = !args.includes('--no-details');

  ensureDir(PARENT_CITATIONS_DIR);
  ensureDir(PARENT_DETAILS_DIR);

  const apiKey = getApiKey();

  console.log('='.repeat(60));
  console.log('Citation Enrichment for Patent Families');
  console.log('='.repeat(60));
  console.log(`Mode: ${specificPatentIds ? 'Specific patents' : `Top ${count} by score`}`);
  if (skipExisting) console.log('Skipping patents with existing parent citations');
  if (dryRun) console.log('DRY RUN — no API calls');
  if (fetchDetails) console.log('Will fetch parent patent details');
  console.log('');

  // 1. Determine which patents to process
  let targetPatentIds: string[];

  if (specificPatentIds) {
    targetPatentIds = specificPatentIds;
  } else {
    console.log('Loading candidates and ranking...');
    const candidates = loadCandidates();
    const classifications = loadClassifications();

    const scored = candidates
      .map(c => ({
        patent_id: c.patent_id,
        score: simpleScore(c, classifications.get(c.patent_id)),
      }))
      .sort((a, b) => b.score - a.score);

    targetPatentIds = scored.slice(0, count).map(s => s.patent_id);
    console.log(`  Top ${targetPatentIds.length} patents selected (score range: ${scored[0]?.score.toFixed(1)} - ${scored[Math.min(count - 1, scored.length - 1)]?.score.toFixed(1)})`);
  }

  // 2. Filter out patents with existing data if requested
  if (skipExisting) {
    const existingFiles = new Set(
      fs.readdirSync(PARENT_CITATIONS_DIR)
        .filter(f => f.endsWith('.json'))
        .map(f => f.replace('.json', ''))
    );

    const before = targetPatentIds.length;
    targetPatentIds = targetPatentIds.filter(id => !existingFiles.has(id));
    console.log(`  Filtered: ${before} → ${targetPatentIds.length} (${before - targetPatentIds.length} already cached)`);
  }

  if (targetPatentIds.length === 0) {
    console.log('\nNo patents to process.');
    return;
  }

  if (dryRun) {
    console.log(`\nDRY RUN — would fetch parent citations for ${targetPatentIds.length} patents.`);
    console.log('First 20:');
    for (const id of targetPatentIds.slice(0, 20)) {
      console.log(`  ${id}`);
    }
    return;
  }

  // 3. Fetch backward citations for each patent
  console.log(`\nFetching parent citations for ${targetPatentIds.length} patents...`);

  let totalParents = 0;
  let processed = 0;
  let errors = 0;
  const allParentIds = new Set<string>();

  for (const patentId of targetPatentIds) {
    processed++;
    if (processed % 10 === 0 || processed === 1) {
      console.log(`  [${processed}/${targetPatentIds.length}] Processing ${patentId}...`);
    }

    try {
      const parentIds = await fetchBackwardCitations(patentId, apiKey);

      const record = {
        patent_id: patentId,
        parent_patent_ids: parentIds,
        parent_count: parentIds.length,
        fetched_at: new Date().toISOString(),
      };

      fs.writeFileSync(
        path.join(PARENT_CITATIONS_DIR, `${patentId}.json`),
        JSON.stringify(record, null, 2)
      );

      totalParents += parentIds.length;
      for (const id of parentIds) allParentIds.add(id);

      await sleep(RATE_LIMIT_MS);
    } catch (error) {
      console.error(`  ERROR: ${patentId}: ${error}`);
      errors++;
      await sleep(RATE_LIMIT_MS * 2); // Extra wait on error
    }
  }

  console.log(`\nParent citations fetched: ${totalParents} total across ${processed} patents`);
  console.log(`Unique parent patent IDs: ${allParentIds.size}`);
  console.log(`Errors: ${errors}`);

  // 4. Optionally fetch details for parent patents
  if (fetchDetails && allParentIds.size > 0) {
    // Filter to parents we don't already have details for
    const existingDetailIds = new Set<string>();
    if (fs.existsSync(PARENT_DETAILS_DIR)) {
      for (const f of fs.readdirSync(PARENT_DETAILS_DIR).filter(f => f.endsWith('.json'))) {
        existingDetailIds.add(f.replace('.json', ''));
      }
    }

    // Also check main patent cache
    const patentCacheDir = path.join(process.cwd(), 'cache/api/patentsview/patent');
    if (fs.existsSync(patentCacheDir)) {
      for (const f of fs.readdirSync(patentCacheDir).filter(f => f.endsWith('.json'))) {
        existingDetailIds.add(f.replace('.json', ''));
      }
    }

    const needDetails = [...allParentIds].filter(id => !existingDetailIds.has(id));
    console.log(`\nParent details: ${allParentIds.size} total, ${existingDetailIds.size} already cached, ${needDetails.length} need fetching`);

    if (needDetails.length > 0) {
      console.log(`Fetching details for ${needDetails.length} parent patents...`);
      const details = await fetchPatentDetails(needDetails, apiKey);

      for (const [id, detail] of details) {
        fs.writeFileSync(
          path.join(PARENT_DETAILS_DIR, `${id}.json`),
          JSON.stringify(detail, null, 2)
        );
      }

      console.log(`  Saved details for ${details.size} parent patents`);
    }
  }

  // 5. Build summary
  const summary = {
    generated_at: new Date().toISOString(),
    patents_processed: processed,
    total_parent_citations: totalParents,
    unique_parent_patents: allParentIds.size,
    errors,
    avg_parents_per_patent: processed > 0 ? Math.round(totalParents / processed * 10) / 10 : 0,
  };

  const summaryPath = path.join(PATENT_FAMILIES_DIR, `enrichment-summary-${new Date().toISOString().split('T')[0]}.json`);
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));

  console.log('\n' + '='.repeat(60));
  console.log('Summary');
  console.log('='.repeat(60));
  console.log(`Patents processed:       ${processed}`);
  console.log(`Total parent citations:  ${totalParents}`);
  console.log(`Unique parent patents:   ${allParentIds.size}`);
  console.log(`Avg parents/patent:      ${summary.avg_parents_per_patent}`);
  console.log(`Errors:                  ${errors}`);
  console.log(`Parent cache:            ${PARENT_CITATIONS_DIR}`);
  console.log(`Summary:                 ${summaryPath}`);

  // Invalidate server cache so new results are visible immediately
  await invalidateServerCache();
}

main().catch(console.error);
