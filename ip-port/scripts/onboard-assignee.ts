/**
 * Assignee Onboarding Pipeline
 *
 * Complete pipeline for adding a new assignee to the portfolio.
 * Runs all necessary steps to fully populate patent data:
 *
 * Steps:
 *   1. DISCOVER  - Search PatentsView for assignee patents
 *   2. DOWNLOAD  - Fetch basic patent data and add to portfolio
 *   3. ENRICH    - Fetch full patent details (abstract, type, etc.)
 *   4. CITATIONS - Fetch forward citation counts
 *   5. MINE      - Fetch citing patent details (who cites us)
 *   6. CLASSIFY  - Categorize citations as competitor/affiliate/neutral
 *   7. SECTORS   - Assign sectors based on CPC codes
 *   8. SCORES    - Calculate V1 base scores
 *   9. LLM       - Run LLM analysis (optional, slow)
 *
 * Usage:
 *   npx tsx scripts/onboard-assignee.ts --assignee "Brocade Communications"
 *   npx tsx scripts/onboard-assignee.ts --assignee "Brocade" --skip-llm
 *   npx tsx scripts/onboard-assignee.ts --assignee "Brocade" --step enrich
 *   npx tsx scripts/onboard-assignee.ts --status
 *
 * Each step is idempotent and can be re-run safely.
 * Progress is tracked in cache/onboarding/{assignee-slug}/status.json
 */

import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

const PATENTSVIEW_BASE_URL = 'https://search.patentsview.org/api/v1';
const OUTPUT_DIR = path.join(process.cwd(), 'output');
const CACHE_DIR = path.join(process.cwd(), 'cache');
const ONBOARDING_DIR = path.join(CACHE_DIR, 'onboarding');
const RATE_LIMIT_MS = 2500; // PatentsView rate limit (increased to avoid 429s)
const MAX_RETRIES = 3; // Retry count for rate limit errors

interface OnboardingStatus {
  assignee: string;
  slug: string;
  startedAt: string;
  updatedAt: string;
  steps: {
    discover: StepStatus;
    download: StepStatus;
    enrich: StepStatus;
    citations: StepStatus;
    mine: StepStatus;
    classify: StepStatus;
    sectors: StepStatus;
    scores: StepStatus;
    llm: StepStatus;
  };
  patentCount: number;
  errors: string[];
}

interface StepStatus {
  status: 'pending' | 'running' | 'complete' | 'error' | 'skipped';
  startedAt?: string;
  completedAt?: string;
  processed?: number;
  total?: number;
  error?: string;
}

const STEP_ORDER = ['discover', 'download', 'enrich', 'citations', 'mine', 'classify', 'sectors', 'scores', 'llm'] as const;
type StepName = typeof STEP_ORDER[number];

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function getApiKey(): string {
  const key = process.env.PATENTSVIEW_API_KEY;
  if (!key) {
    console.error('ERROR: PATENTSVIEW_API_KEY not set in .env');
    process.exit(1);
  }
  return key;
}

function log(message: string): void {
  const timestamp = new Date().toISOString().slice(11, 19);
  console.log(`[${timestamp}] ${message}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Status Management
// ─────────────────────────────────────────────────────────────────────────────

function getStatusPath(slug: string): string {
  return path.join(ONBOARDING_DIR, slug, 'status.json');
}

function loadStatus(assignee: string): OnboardingStatus {
  const slug = slugify(assignee);
  const statusPath = getStatusPath(slug);

  if (fs.existsSync(statusPath)) {
    return JSON.parse(fs.readFileSync(statusPath, 'utf-8'));
  }

  const emptyStep: StepStatus = { status: 'pending' };
  return {
    assignee,
    slug,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    steps: {
      discover: { ...emptyStep },
      download: { ...emptyStep },
      enrich: { ...emptyStep },
      citations: { ...emptyStep },
      mine: { ...emptyStep },
      classify: { ...emptyStep },
      sectors: { ...emptyStep },
      scores: { ...emptyStep },
      llm: { ...emptyStep },
    },
    patentCount: 0,
    errors: [],
  };
}

function saveStatus(status: OnboardingStatus): void {
  const dir = path.join(ONBOARDING_DIR, status.slug);
  ensureDir(dir);
  status.updatedAt = new Date().toISOString();
  fs.writeFileSync(getStatusPath(status.slug), JSON.stringify(status, null, 2));
}

function updateStep(status: OnboardingStatus, step: StepName, update: Partial<StepStatus>): void {
  status.steps[step] = { ...status.steps[step], ...update };
  saveStatus(status);
}

// ─────────────────────────────────────────────────────────────────────────────
// Portfolio Management
// ─────────────────────────────────────────────────────────────────────────────

function loadPortfolio(): { filename: string; data: any; candidates: Map<string, any> } {
  const files = fs.readdirSync(OUTPUT_DIR)
    .filter(f => f.startsWith('streaming-candidates-') && f.endsWith('.json'))
    .sort()
    .reverse();

  if (files.length === 0) {
    throw new Error('No streaming-candidates file found');
  }

  const filename = files[0];
  const data = JSON.parse(fs.readFileSync(path.join(OUTPUT_DIR, filename), 'utf-8'));
  const candidates = new Map<string, any>();
  for (const c of data.candidates) {
    candidates.set(c.patent_id, c);
  }

  return { filename, data, candidates };
}

function savePortfolio(filename: string, data: any): void {
  data.metadata = data.metadata || {};
  data.metadata.lastUpdated = new Date().toISOString();
  fs.writeFileSync(path.join(OUTPUT_DIR, filename), JSON.stringify(data, null, 2));
}

// ─────────────────────────────────────────────────────────────────────────────
// PatentsView API
// ─────────────────────────────────────────────────────────────────────────────

let lastRequestTime = 0;

async function patentsviewRequest(endpoint: string, options: RequestInit = {}, retries = 0): Promise<any> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < RATE_LIMIT_MS) {
    await sleep(RATE_LIMIT_MS - elapsed);
  }
  lastRequestTime = Date.now();

  const apiKey = getApiKey();
  const url = `${PATENTSVIEW_BASE_URL}${endpoint}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'X-Api-Key': apiKey,
      ...options.headers,
    },
  });

  // Handle rate limiting with retry
  if (response.status === 429 && retries < MAX_RETRIES) {
    const retryAfter = parseInt(response.headers.get('retry-after') || '30');
    log(`  Rate limited, waiting ${retryAfter}s (retry ${retries + 1}/${MAX_RETRIES})...`);
    await sleep(retryAfter * 1000);
    return patentsviewRequest(endpoint, options, retries + 1);
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`PatentsView API error ${response.status}: ${text}`);
  }

  return response.json();
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 1: DISCOVER - Find patents for assignee
// ─────────────────────────────────────────────────────────────────────────────

async function stepDiscover(status: OnboardingStatus): Promise<string[]> {
  log('Step 1: DISCOVER - Searching PatentsView for assignee patents...');
  updateStep(status, 'discover', { status: 'running', startedAt: new Date().toISOString() });

  const patentIds: string[] = [];
  let page = 1;
  const perPage = 1000;
  let hasMore = true;

  while (hasMore) {
    const query = {
      q: { _contains: { assignees: { assignee_organization: status.assignee } } },
      f: ['patent_id'],
      o: { per_page: perPage, page },
      s: [{ patent_id: 'asc' }],
    };

    const result = await patentsviewRequest('/patent/', {
      method: 'POST',
      body: JSON.stringify(query),
    });

    const patents = result.patents || [];
    for (const p of patents) {
      patentIds.push(p.patent_id);
    }

    log(`  Page ${page}: found ${patents.length} patents (total: ${patentIds.length})`);

    hasMore = patents.length === perPage;
    page++;
  }

  // Save discovered patent IDs
  const discoveredPath = path.join(ONBOARDING_DIR, status.slug, 'discovered-patents.json');
  fs.writeFileSync(discoveredPath, JSON.stringify(patentIds, null, 2));

  status.patentCount = patentIds.length;
  updateStep(status, 'discover', {
    status: 'complete',
    completedAt: new Date().toISOString(),
    total: patentIds.length,
    processed: patentIds.length,
  });

  log(`  Discovered ${patentIds.length} patents for "${status.assignee}"`);
  return patentIds;
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 2: DOWNLOAD - Fetch basic patent data and add to portfolio
// ─────────────────────────────────────────────────────────────────────────────

async function stepDownload(status: OnboardingStatus): Promise<void> {
  log('Step 2: DOWNLOAD - Fetching patent data and adding to portfolio...');
  updateStep(status, 'download', { status: 'running', startedAt: new Date().toISOString() });

  const discoveredPath = path.join(ONBOARDING_DIR, status.slug, 'discovered-patents.json');
  const patentIds: string[] = JSON.parse(fs.readFileSync(discoveredPath, 'utf-8'));

  const { filename, data, candidates } = loadPortfolio();

  // Find patents not already in portfolio
  const missing = patentIds.filter(id => !candidates.has(id));
  log(`  ${missing.length} patents to add (${patentIds.length - missing.length} already in portfolio)`);

  if (missing.length === 0) {
    updateStep(status, 'download', {
      status: 'complete',
      completedAt: new Date().toISOString(),
      processed: 0,
      total: patentIds.length,
    });
    return;
  }

  let added = 0;
  for (let i = 0; i < missing.length; i++) {
    const patentId = missing[i];

    try {
      // Use search endpoint with query filter (individual patent endpoint is GET only)
      const result = await patentsviewRequest('/patent/', {
        method: 'POST',
        body: JSON.stringify({
          q: { patent_id: patentId },
          f: ['patent_id', 'patent_title', 'patent_date', 'patent_abstract', 'assignees', 'cpc_current'],
        }),
      });

      const patent = result.patents?.[0];
      if (!patent) continue;

      // Calculate remaining years
      const grantDate = new Date(patent.patent_date);
      const expiryDate = new Date(grantDate);
      expiryDate.setFullYear(expiryDate.getFullYear() + 20);
      const remainingYears = Math.round((expiryDate.getTime() - Date.now()) / (365.25 * 24 * 60 * 60 * 1000) * 10) / 10;

      // Extract CPC codes
      const cpcCodes = (patent.cpc_current || []).map((c: any) => c.cpc_subgroup || c.cpc_group || c.cpc_subclass);

      // Add to portfolio
      const newPatent = {
        patent_id: patent.patent_id,
        patent_title: patent.patent_title,
        patent_date: patent.patent_date,
        patent_abstract: patent.patent_abstract || '',
        assignee: patent.assignees?.[0]?.assignee_organization || status.assignee,
        forward_citations: 0,
        remaining_years: remainingYears,
        score: 0,
        cpc_codes: cpcCodes,
        primary_sector: '',
        super_sector: '',
        affiliate: status.assignee,
      };

      data.candidates.push(newPatent);
      added++;

      // Also cache the full patent detail
      const detailCacheDir = path.join(CACHE_DIR, 'api/patentsview/patent');
      ensureDir(detailCacheDir);
      fs.writeFileSync(
        path.join(detailCacheDir, `${patentId}.json`),
        JSON.stringify(patent, null, 2)
      );

      if ((i + 1) % 50 === 0) {
        log(`  Progress: ${i + 1}/${missing.length} (${added} added)`);
        savePortfolio(filename, data);
      }
    } catch (err) {
      log(`  Error fetching ${patentId}: ${(err as Error).message}`);
    }
  }

  savePortfolio(filename, data);
  updateStep(status, 'download', {
    status: 'complete',
    completedAt: new Date().toISOString(),
    processed: added,
    total: missing.length,
  });

  log(`  Added ${added} patents to portfolio`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 3: ENRICH - Fetch full patent details (for patents missing abstract)
// ─────────────────────────────────────────────────────────────────────────────

async function stepEnrich(status: OnboardingStatus): Promise<void> {
  log('Step 3: ENRICH - Fetching missing patent details (abstracts)...');
  updateStep(status, 'enrich', { status: 'running', startedAt: new Date().toISOString() });

  const { filename, data, candidates } = loadPortfolio();

  // Find assignee patents missing abstract
  const toEnrich = data.candidates.filter((p: any) =>
    p.affiliate === status.assignee &&
    (!p.patent_abstract || p.patent_abstract === '')
  );

  log(`  ${toEnrich.length} patents need abstract enrichment`);

  if (toEnrich.length === 0) {
    updateStep(status, 'enrich', {
      status: 'complete',
      completedAt: new Date().toISOString(),
      processed: 0,
      total: 0,
    });
    return;
  }

  let enriched = 0;
  for (let i = 0; i < toEnrich.length; i++) {
    const patent = toEnrich[i];
    const patentId = patent.patent_id;

    // Check cache first
    const cachePath = path.join(CACHE_DIR, 'api/patentsview/patent', `${patentId}.json`);
    if (fs.existsSync(cachePath)) {
      const cached = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
      // Cache structure: { patents: [{ patent_abstract: ... }] }
      const cachedPatent = cached.patents?.[0] || cached;
      if (cachedPatent.patent_abstract) {
        patent.patent_abstract = cachedPatent.patent_abstract;
        enriched++;
        continue;
      }
    }

    try {
      // Use search endpoint with query filter (individual patent endpoint is GET only)
      const result = await patentsviewRequest('/patent/', {
        method: 'POST',
        body: JSON.stringify({
          q: { patent_id: patentId },
          f: ['patent_id', 'patent_title', 'patent_date', 'patent_abstract', 'patent_type', 'assignees', 'cpc_current'],
        }),
      });

      const fetched = result.patents?.[0];
      if (fetched?.patent_abstract) {
        patent.patent_abstract = fetched.patent_abstract;
        enriched++;

        // Update cache (preserve API response structure)
        const detailCacheDir = path.join(CACHE_DIR, 'api/patentsview/patent');
        ensureDir(detailCacheDir);
        fs.writeFileSync(cachePath, JSON.stringify({ patents: [fetched] }, null, 2));
      }

      if ((i + 1) % 50 === 0) {
        log(`  Progress: ${i + 1}/${toEnrich.length} (${enriched} enriched)`);
        savePortfolio(filename, data);
      }
    } catch (err) {
      log(`  Error enriching ${patentId}: ${(err as Error).message}`);
    }
  }

  savePortfolio(filename, data);
  updateStep(status, 'enrich', {
    status: 'complete',
    completedAt: new Date().toISOString(),
    processed: enriched,
    total: toEnrich.length,
  });

  log(`  Enriched ${enriched} patents with abstracts`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 4: CITATIONS - Fetch forward citation counts
// ─────────────────────────────────────────────────────────────────────────────

async function stepCitations(status: OnboardingStatus): Promise<void> {
  log('Step 4: CITATIONS - Fetching forward citation counts...');
  updateStep(status, 'citations', { status: 'running', startedAt: new Date().toISOString() });

  const { filename, data, candidates } = loadPortfolio();

  // Find assignee patents with 0 or missing forward_citations
  const toFetch = data.candidates.filter((p: any) =>
    p.affiliate === status.assignee &&
    (p.forward_citations === 0 || p.forward_citations === undefined)
  );

  log(`  ${toFetch.length} patents need citation counts`);

  if (toFetch.length === 0) {
    updateStep(status, 'citations', {
      status: 'complete',
      completedAt: new Date().toISOString(),
      processed: 0,
      total: 0,
    });
    return;
  }

  let updated = 0;
  for (let i = 0; i < toFetch.length; i++) {
    const patent = toFetch[i];
    const patentId = patent.patent_id;

    try {
      // Use search endpoint with query filter
      const result = await patentsviewRequest('/patent/', {
        method: 'POST',
        body: JSON.stringify({
          q: { patent_id: patentId },
          f: ['patent_id', 'patent_num_times_cited_by_us_patents'],
        }),
      });

      const fetched = result.patents?.[0];
      if (fetched) {
        const citations = fetched.patent_num_times_cited_by_us_patents || 0;
        patent.forward_citations = citations;

        // Recalculate V1 score
        if (patent.remaining_years > 0) {
          patent.score = citations * 1.5;
        } else {
          patent.score = 0;
        }
        updated++;
      }

      if ((i + 1) % 50 === 0) {
        log(`  Progress: ${i + 1}/${toFetch.length} (${updated} updated)`);
        savePortfolio(filename, data);
      }
    } catch (err) {
      log(`  Error fetching citations for ${patentId}: ${(err as Error).message}`);
    }
  }

  savePortfolio(filename, data);
  updateStep(status, 'citations', {
    status: 'complete',
    completedAt: new Date().toISOString(),
    processed: updated,
    total: toFetch.length,
  });

  log(`  Updated ${updated} patents with citation counts`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 5: MINE - Fetch citing patent details
// ─────────────────────────────────────────────────────────────────────────────

async function stepMine(status: OnboardingStatus): Promise<void> {
  log('Step 5: MINE - Fetching citing patent details...');
  updateStep(status, 'mine', { status: 'running', startedAt: new Date().toISOString() });

  const { candidates } = loadPortfolio();
  const citingDetailsDir = path.join(CACHE_DIR, 'api/patentsview/citing-patent-details');
  ensureDir(citingDetailsDir);

  // Get assignee patents with forward citations that need mining
  const toMine: any[] = [];
  for (const [id, p] of candidates) {
    if (p.affiliate === status.assignee && (p.forward_citations || 0) > 0) {
      const cachePath = path.join(citingDetailsDir, `${id}.json`);
      if (!fs.existsSync(cachePath)) {
        toMine.push(p);
      }
    }
  }

  log(`  ${toMine.length} patents need citing details mined`);

  if (toMine.length === 0) {
    updateStep(status, 'mine', {
      status: 'complete',
      completedAt: new Date().toISOString(),
      processed: 0,
      total: 0,
    });
    return;
  }

  let mined = 0;
  for (let i = 0; i < toMine.length; i++) {
    const patent = toMine[i];
    const patentId = patent.patent_id;

    try {
      // Fetch citing patents
      const result = await patentsviewRequest('/patent/', {
        method: 'POST',
        body: JSON.stringify({
          q: { _contains: { us_patent_citations: { citation_patent_id: patentId } } },
          f: ['patent_id', 'patent_title', 'patent_date', 'assignees'],
          o: { per_page: 1000 },
        }),
      });

      const citingPatents = (result.patents || []).map((p: any) => ({
        patent_id: p.patent_id,
        patent_title: p.patent_title,
        patent_date: p.patent_date,
        assignee: p.assignees?.[0]?.assignee_organization || 'Unknown',
      }));

      // Cache the result
      const cachePath = path.join(citingDetailsDir, `${patentId}.json`);
      fs.writeFileSync(cachePath, JSON.stringify({
        cited_patent_id: patentId,
        citing_patents: citingPatents,
        fetched_at: new Date().toISOString(),
      }, null, 2));

      mined++;

      if ((i + 1) % 20 === 0) {
        log(`  Progress: ${i + 1}/${toMine.length} (${mined} mined)`);
      }
    } catch (err) {
      log(`  Error mining ${patentId}: ${(err as Error).message}`);
    }
  }

  updateStep(status, 'mine', {
    status: 'complete',
    completedAt: new Date().toISOString(),
    processed: mined,
    total: toMine.length,
  });

  log(`  Mined citing details for ${mined} patents`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 6: CLASSIFY - Categorize citations
// ─────────────────────────────────────────────────────────────────────────────

async function stepClassify(status: OnboardingStatus): Promise<void> {
  log('Step 6: CLASSIFY - Categorizing citations as competitor/affiliate/neutral...');
  updateStep(status, 'classify', { status: 'running', startedAt: new Date().toISOString() });

  // Load competitor config
  const competitorConfig = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), 'config/competitors.json'), 'utf-8')
  );

  const excludePatterns = competitorConfig.excludePatterns.map((p: string) => new RegExp(p, 'i'));
  const competitorPatterns: Array<{ pattern: RegExp; company: string }> = [];

  for (const [, category] of Object.entries(competitorConfig.categories) as any) {
    if (!category.enabled) continue;
    for (const company of category.companies) {
      for (const pattern of company.patterns) {
        competitorPatterns.push({
          pattern: new RegExp(pattern, 'i'),
          company: company.name,
        });
      }
    }
  }

  // Classify function
  function classify(assignee: string): { type: 'affiliate' | 'competitor' | 'neutral'; company?: string } {
    if (!assignee) return { type: 'neutral' };
    for (const p of excludePatterns) {
      if (p.test(assignee)) return { type: 'affiliate' };
    }
    for (const { pattern, company } of competitorPatterns) {
      if (pattern.test(assignee)) return { type: 'competitor', company };
    }
    return { type: 'neutral' };
  }

  // Process citing details
  const citingDetailsDir = path.join(CACHE_DIR, 'api/patentsview/citing-patent-details');
  const classificationDir = path.join(CACHE_DIR, 'citation-classification');
  ensureDir(classificationDir);

  const { candidates } = loadPortfolio();
  const results: any[] = [];
  let classified = 0;

  for (const [id, p] of candidates) {
    if (p.affiliate !== status.assignee) continue;

    const citingPath = path.join(citingDetailsDir, `${id}.json`);
    if (!fs.existsSync(citingPath)) continue;

    const citing = JSON.parse(fs.readFileSync(citingPath, 'utf-8'));
    const citingPatents = citing.citing_patents || [];

    let competitor = 0, affiliate = 0, neutral = 0;
    const competitorNames = new Set<string>();

    for (const cp of citingPatents) {
      const result = classify(cp.assignee);
      if (result.type === 'competitor') {
        competitor++;
        if (result.company) competitorNames.add(result.company);
      } else if (result.type === 'affiliate') {
        affiliate++;
      } else {
        neutral++;
      }
    }

    const classification = {
      patent_id: id,
      competitor_citations: competitor,
      affiliate_citations: affiliate,
      neutral_citations: neutral,
      competitor_count: competitorNames.size,
      competitor_names: Array.from(competitorNames),
      classified_at: new Date().toISOString(),
    };

    // Cache per-patent classification
    fs.writeFileSync(
      path.join(classificationDir, `${id}.json`),
      JSON.stringify(classification, null, 2)
    );

    results.push(classification);
    classified++;
  }

  // Save combined classification output
  const outputPath = path.join(OUTPUT_DIR, `citation-classification-${new Date().toISOString().slice(0, 10)}.json`);

  // Merge with existing classification if present
  let existingResults: any[] = [];
  const existingFiles = fs.readdirSync(OUTPUT_DIR)
    .filter(f => f.startsWith('citation-classification-') && f.endsWith('.json'))
    .sort()
    .reverse();

  if (existingFiles.length > 0) {
    const existingData = JSON.parse(fs.readFileSync(path.join(OUTPUT_DIR, existingFiles[0]), 'utf-8'));
    existingResults = existingData.results || [];
    // Remove any existing results for this assignee
    existingResults = existingResults.filter((r: any) => {
      const p = candidates.get(r.patent_id);
      return !p || p.affiliate !== status.assignee;
    });
  }

  fs.writeFileSync(outputPath, JSON.stringify({
    generated_at: new Date().toISOString(),
    results: [...existingResults, ...results],
  }, null, 2));

  updateStep(status, 'classify', {
    status: 'complete',
    completedAt: new Date().toISOString(),
    processed: classified,
    total: classified,
  });

  log(`  Classified ${classified} patents`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 7: SECTORS - Assign sectors based on CPC codes
// ─────────────────────────────────────────────────────────────────────────────

async function stepSectors(status: OnboardingStatus): Promise<void> {
  log('Step 7: SECTORS - Assigning sectors based on CPC codes...');
  updateStep(status, 'sectors', { status: 'running', startedAt: new Date().toISOString() });

  // Load sector config
  const sectorConfig = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), 'config/sector-breakout-v2.json'), 'utf-8')
  );
  const superSectorConfig = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), 'config/super-sectors.json'), 'utf-8')
  );

  // Build CPC prefix to sector mapping
  const cpcToSector = new Map<string, string>();
  for (const [sectorKey, sectorData] of Object.entries(sectorConfig.sectorMappings) as any) {
    for (const pattern of sectorData.cpc_patterns || []) {
      cpcToSector.set(pattern, sectorKey);
    }
  }

  // Build sector to super-sector mapping
  const sectorToSuper = new Map<string, string>();
  for (const [ssKey, ssData] of Object.entries(superSectorConfig.superSectors) as any) {
    for (const sectorName of ssData.sectors) {
      sectorToSuper.set(sectorName, ssKey);
    }
  }

  function getPrimarySector(cpcCodes: string[]): string {
    if (!cpcCodes || cpcCodes.length === 0) return 'general';

    // Sort CPC prefixes by length (longest first for most specific match)
    const sortedPrefixes = Array.from(cpcToSector.keys()).sort((a, b) => b.length - a.length);

    for (const cpc of cpcCodes) {
      for (const prefix of sortedPrefixes) {
        if (cpc.startsWith(prefix)) {
          return cpcToSector.get(prefix)!;
        }
      }
    }
    return 'general';
  }

  const { filename, data } = loadPortfolio();
  let updated = 0;

  for (const patent of data.candidates) {
    if (patent.affiliate !== status.assignee) continue;
    if (patent.primary_sector && patent.super_sector) continue;

    const sector = getPrimarySector(patent.cpc_codes || []);
    const superSector = sectorToSuper.get(sector) || 'COMPUTING';

    patent.primary_sector = sector;
    patent.super_sector = superSector;
    updated++;
  }

  savePortfolio(filename, data);
  updateStep(status, 'sectors', {
    status: 'complete',
    completedAt: new Date().toISOString(),
    processed: updated,
    total: updated,
  });

  log(`  Assigned sectors to ${updated} patents`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 8: SCORES - Calculate V1 base scores
// ─────────────────────────────────────────────────────────────────────────────

async function stepScores(status: OnboardingStatus): Promise<void> {
  log('Step 8: SCORES - Calculating V1 base scores...');
  updateStep(status, 'scores', { status: 'running', startedAt: new Date().toISOString() });

  const { filename, data } = loadPortfolio();
  let updated = 0;

  for (const patent of data.candidates) {
    if (patent.affiliate !== status.assignee) continue;

    const oldScore = patent.score || 0;
    const newScore = patent.remaining_years > 0 ? (patent.forward_citations || 0) * 1.5 : 0;

    if (Math.abs(newScore - oldScore) > 0.001) {
      patent.score = newScore;
      updated++;
    }
  }

  savePortfolio(filename, data);
  updateStep(status, 'scores', {
    status: 'complete',
    completedAt: new Date().toISOString(),
    processed: updated,
    total: updated,
  });

  log(`  Recalculated scores for ${updated} patents`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 9: LLM - Run LLM analysis (optional)
// ─────────────────────────────────────────────────────────────────────────────

async function stepLlm(status: OnboardingStatus, skip: boolean): Promise<void> {
  if (skip) {
    log('Step 9: LLM - Skipped (use --with-llm to include)');
    updateStep(status, 'llm', { status: 'skipped' });
    return;
  }

  log('Step 9: LLM - Running LLM analysis (this is slow)...');
  log('  Run manually with: npx tsx scripts/run-llm-top-patents.ts --affiliate "' + status.assignee + '"');
  updateStep(status, 'llm', {
    status: 'pending',
    error: 'Run manually: npx tsx scripts/run-llm-top-patents.ts --affiliate "' + status.assignee + '"',
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Pipeline
// ─────────────────────────────────────────────────────────────────────────────

async function runPipeline(assignee: string, options: { step?: string; skipLlm?: boolean }): Promise<void> {
  const status = loadStatus(assignee);

  log(`\n${'='.repeat(70)}`);
  log(`ASSIGNEE ONBOARDING: ${assignee}`);
  log(`${'='.repeat(70)}\n`);

  const startFrom = options.step ? STEP_ORDER.indexOf(options.step as StepName) : 0;
  if (startFrom === -1) {
    console.error(`Unknown step: ${options.step}`);
    console.error(`Valid steps: ${STEP_ORDER.join(', ')}`);
    process.exit(1);
  }

  try {
    for (let i = startFrom; i < STEP_ORDER.length; i++) {
      const step = STEP_ORDER[i];

      switch (step) {
        case 'discover':
          await stepDiscover(status);
          break;
        case 'download':
          await stepDownload(status);
          break;
        case 'enrich':
          await stepEnrich(status);
          break;
        case 'citations':
          await stepCitations(status);
          break;
        case 'mine':
          await stepMine(status);
          break;
        case 'classify':
          await stepClassify(status);
          break;
        case 'sectors':
          await stepSectors(status);
          break;
        case 'scores':
          await stepScores(status);
          break;
        case 'llm':
          await stepLlm(status, options.skipLlm !== false);
          break;
      }
    }

    log(`\n${'='.repeat(70)}`);
    log('ONBOARDING COMPLETE');
    log(`${'='.repeat(70)}`);
    log(`\nPatents onboarded: ${status.patentCount}`);
    log(`Status file: ${getStatusPath(status.slug)}`);
    log(`\nNext steps:`);
    log(`  1. Reload API cache: curl -X POST http://localhost:3001/api/scores/reload`);
    log(`  2. Run LLM analysis: npx tsx scripts/run-llm-top-patents.ts --affiliate "${assignee}"`);
  } catch (err) {
    status.errors.push((err as Error).message);
    saveStatus(status);
    throw err;
  }
}

function showStatus(): void {
  ensureDir(ONBOARDING_DIR);
  const dirs = fs.readdirSync(ONBOARDING_DIR).filter(f =>
    fs.statSync(path.join(ONBOARDING_DIR, f)).isDirectory()
  );

  if (dirs.length === 0) {
    console.log('No onboarding sessions found.');
    return;
  }

  console.log('\nOnboarding Status:\n');
  for (const dir of dirs) {
    const statusPath = path.join(ONBOARDING_DIR, dir, 'status.json');
    if (!fs.existsSync(statusPath)) continue;

    const status: OnboardingStatus = JSON.parse(fs.readFileSync(statusPath, 'utf-8'));
    console.log(`${status.assignee} (${status.patentCount} patents)`);

    for (const step of STEP_ORDER) {
      const s = status.steps[step];
      const icon = s.status === 'complete' ? '✓' : s.status === 'running' ? '⟳' : s.status === 'error' ? '✗' : s.status === 'skipped' ? '○' : '·';
      const progress = s.processed !== undefined ? ` (${s.processed}/${s.total})` : '';
      console.log(`  ${icon} ${step}${progress}`);
    }
    console.log();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes('--status')) {
    showStatus();
    return;
  }

  if (args.includes('--help') || args.length === 0) {
    console.log(`
Assignee Onboarding Pipeline

Usage:
  npx tsx scripts/onboard-assignee.ts --assignee "Company Name"
  npx tsx scripts/onboard-assignee.ts --assignee "Company" --step enrich
  npx tsx scripts/onboard-assignee.ts --assignee "Company" --with-llm
  npx tsx scripts/onboard-assignee.ts --status

Options:
  --assignee NAME   Company name to search for (required)
  --step STEP       Start from specific step (discover, download, enrich, citations, mine, classify, sectors, scores, llm)
  --with-llm        Include LLM analysis step (slow)
  --status          Show onboarding status for all assignees

Steps:
  1. discover   - Search PatentsView for assignee patents
  2. download   - Fetch basic patent data and add to portfolio
  3. enrich     - Fetch full patent details (abstract)
  4. citations  - Fetch forward citation counts
  5. mine       - Fetch citing patent details
  6. classify   - Categorize citations as competitor/affiliate/neutral
  7. sectors    - Assign sectors based on CPC codes
  8. scores     - Calculate V1 base scores
  9. llm        - Run LLM analysis (optional)
`);
    return;
  }

  const assigneeIdx = args.indexOf('--assignee');
  if (assigneeIdx === -1 || !args[assigneeIdx + 1]) {
    console.error('ERROR: --assignee is required');
    process.exit(1);
  }
  const assignee = args[assigneeIdx + 1];

  const stepIdx = args.indexOf('--step');
  const step = stepIdx !== -1 ? args[stepIdx + 1] : undefined;

  const skipLlm = !args.includes('--with-llm');

  await runPipeline(assignee, { step, skipLlm });
}

main().catch(err => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
