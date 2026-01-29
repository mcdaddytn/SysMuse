/**
 * Portfolio Enrichment Service
 *
 * Centralized service for all patent data enrichment operations.
 * This is the SINGLE code path for enriching patents - all scripts
 * and orchestrators should use this service.
 *
 * Uses the established PatentsViewClient for API calls.
 * Uses consistent cache paths and structures.
 */

import * as fs from 'fs';
import * as path from 'path';
import { PatentsViewClient } from '../../../clients/patentsview-client.js';

// ─────────────────────────────────────────────────────────────────────────────
// Configuration - Consistent cache paths
// ─────────────────────────────────────────────────────────────────────────────

const CACHE_BASE = path.join(process.cwd(), 'cache');
const PATENT_CACHE = path.join(CACHE_BASE, 'api/patentsview/patent');
const CITING_DETAILS_CACHE = path.join(CACHE_BASE, 'api/patentsview/citing-patent-details');
const CLASSIFICATION_CACHE = path.join(CACHE_BASE, 'citation-classification');
const LLM_SCORES_CACHE = path.join(CACHE_BASE, 'llm-scores');
const OUTPUT_DIR = path.join(process.cwd(), 'output');

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface EnrichmentStatus {
  patentId: string;
  hasAbstract: boolean;
  hasForwardCitations: boolean;
  hasCitingDetails: boolean;
  hasClassification: boolean;
  hasLlmScores: boolean;
  hasSector: boolean;
  hasScore: boolean;
}

export interface EnrichmentProgress {
  total: number;
  processed: number;
  errors: number;
  skipped: number;
}

export interface CitingPatentDetail {
  patent_id: string;
  patent_title: string;
  patent_date: string;
  assignee: string;
}

export interface CitationClassification {
  patent_id: string;
  competitor_citations: number;
  affiliate_citations: number;
  neutral_citations: number;
  competitor_count: number;
  competitor_names: string[];
  classified_at: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Utility Functions
// ─────────────────────────────────────────────────────────────────────────────

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function loadCompetitorConfig(): {
  excludePatterns: RegExp[];
  competitorPatterns: Array<{ pattern: RegExp; company: string }>;
} {
  const configPath = path.join(process.cwd(), 'config/competitors.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

  const excludePatterns = config.excludePatterns.map((p: string) => new RegExp(p, 'i'));
  const competitorPatterns: Array<{ pattern: RegExp; company: string }> = [];

  for (const [, category] of Object.entries(config.categories) as any) {
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

  return { excludePatterns, competitorPatterns };
}

// ─────────────────────────────────────────────────────────────────────────────
// Portfolio Enrichment Service
// ─────────────────────────────────────────────────────────────────────────────

export class PortfolioEnrichmentService {
  private client: PatentsViewClient;
  private competitorConfig: ReturnType<typeof loadCompetitorConfig> | null = null;

  constructor(apiKey: string) {
    // PatentsViewClient has built-in rate limiting (45 req/min) and retry logic
    this.client = new PatentsViewClient({ apiKey });
  }

  /**
   * Check enrichment status for a patent
   */
  getEnrichmentStatus(patent: any): EnrichmentStatus {
    const patentId = patent.patent_id;

    return {
      patentId,
      hasAbstract: !!(patent.patent_abstract && patent.patent_abstract.length > 0),
      hasForwardCitations: (patent.forward_citations || 0) > 0,
      hasCitingDetails: fs.existsSync(path.join(CITING_DETAILS_CACHE, `${patentId}.json`)),
      hasClassification: fs.existsSync(path.join(CLASSIFICATION_CACHE, `${patentId}.json`)),
      hasLlmScores: fs.existsSync(path.join(LLM_SCORES_CACHE, `${patentId}.json`)),
      hasSector: !!(patent.primary_sector && patent.primary_sector.length > 0),
      hasScore: (patent.score || 0) > 0,
    };
  }

  /**
   * Fetch patent details (abstract, title, etc.) using the established client
   */
  async fetchPatentDetails(patentId: string): Promise<any | null> {
    // Check cache first
    const cachePath = path.join(PATENT_CACHE, `${patentId}.json`);
    if (fs.existsSync(cachePath)) {
      const cached = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
      // Cache structure: { patents: [{ ... }] }
      return cached.patents?.[0] || cached;
    }

    // Fetch from API using the client
    const patent = await this.client.getPatent(patentId, [
      'patent_id',
      'patent_title',
      'patent_date',
      'patent_abstract',
      'patent_type',
      'assignees',
      'cpc_current',
      'patent_num_times_cited_by_us_patents',
    ]);

    if (patent) {
      // Cache the result in consistent structure
      ensureDir(PATENT_CACHE);
      fs.writeFileSync(cachePath, JSON.stringify({ patents: [patent] }, null, 2));
    }

    return patent;
  }

  /**
   * Fetch forward citation count for a patent
   */
  async fetchForwardCitationCount(patentId: string): Promise<number> {
    const patent = await this.client.getPatent(patentId, [
      'patent_id',
      'patent_num_times_cited_by_us_patents',
    ]);

    return patent?.patent_num_times_cited_by_us_patents || 0;
  }

  /**
   * Fetch citing patent details - who cites this patent
   * Uses the correct /patent/us_patent_citation/ endpoint
   */
  async fetchCitingPatentDetails(patentId: string): Promise<CitingPatentDetail[]> {
    // Check cache first
    const cachePath = path.join(CITING_DETAILS_CACHE, `${patentId}.json`);
    if (fs.existsSync(cachePath)) {
      const cached = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
      return cached.citing_patents || [];
    }

    // Step 1: Get citing patent IDs using the client's method
    const { citing_patent_ids } = await this.client.getForwardCitations(patentId, 1000);

    if (citing_patent_ids.length === 0) {
      // Cache empty result
      ensureDir(CITING_DETAILS_CACHE);
      fs.writeFileSync(cachePath, JSON.stringify({
        cited_patent_id: patentId,
        citing_patents: [],
        fetched_at: new Date().toISOString(),
      }, null, 2));
      return [];
    }

    // Step 2: Get details for citing patents in batches
    const citingPatents: CitingPatentDetail[] = [];
    const batchSize = 100;

    for (let i = 0; i < citing_patent_ids.length; i += batchSize) {
      const batch = citing_patent_ids.slice(i, i + batchSize);
      const patents = await this.client.getPatentsBatch(batch, [
        'patent_id',
        'patent_title',
        'patent_date',
        'assignees',
      ]);

      for (const p of patents) {
        citingPatents.push({
          patent_id: p.patent_id,
          patent_title: p.patent_title || '',
          patent_date: p.patent_date || '',
          assignee: p.assignees?.[0]?.assignee_organization ||
                   p.assignees?.[0]?.assignee_individual_name_first + ' ' +
                   p.assignees?.[0]?.assignee_individual_name_last || 'Unknown',
        });
      }
    }

    // Cache the result
    ensureDir(CITING_DETAILS_CACHE);
    fs.writeFileSync(cachePath, JSON.stringify({
      cited_patent_id: patentId,
      citing_patents: citingPatents,
      fetched_at: new Date().toISOString(),
    }, null, 2));

    return citingPatents;
  }

  /**
   * Classify citations as competitor/affiliate/neutral
   */
  classifyCitations(patentId: string, citingPatents: CitingPatentDetail[]): CitationClassification {
    // Check cache first
    const cachePath = path.join(CLASSIFICATION_CACHE, `${patentId}.json`);
    if (fs.existsSync(cachePath)) {
      return JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
    }

    // Load competitor config if not already loaded
    if (!this.competitorConfig) {
      this.competitorConfig = loadCompetitorConfig();
    }

    let competitor = 0, affiliate = 0, neutral = 0;
    const competitorNames = new Set<string>();

    for (const cp of citingPatents) {
      const assignee = cp.assignee || '';

      // Check if affiliate (exclude patterns)
      let isAffiliate = false;
      for (const p of this.competitorConfig.excludePatterns) {
        if (p.test(assignee)) {
          isAffiliate = true;
          break;
        }
      }

      if (isAffiliate) {
        affiliate++;
        continue;
      }

      // Check if competitor
      let isCompetitor = false;
      for (const { pattern, company } of this.competitorConfig.competitorPatterns) {
        if (pattern.test(assignee)) {
          isCompetitor = true;
          competitorNames.add(company);
          break;
        }
      }

      if (isCompetitor) {
        competitor++;
      } else {
        neutral++;
      }
    }

    const classification: CitationClassification = {
      patent_id: patentId,
      competitor_citations: competitor,
      affiliate_citations: affiliate,
      neutral_citations: neutral,
      competitor_count: competitorNames.size,
      competitor_names: Array.from(competitorNames),
      classified_at: new Date().toISOString(),
    };

    // Cache the result
    ensureDir(CLASSIFICATION_CACHE);
    fs.writeFileSync(cachePath, JSON.stringify(classification, null, 2));

    return classification;
  }

  /**
   * Full enrichment for a single patent
   * Runs all enrichment steps in order, skipping already-complete steps
   */
  async enrichPatent(patent: any, options: {
    fetchDetails?: boolean;
    fetchCitations?: boolean;
    mineCiting?: boolean;
    classify?: boolean;
  } = {}): Promise<{
    patent: any;
    status: EnrichmentStatus;
    updated: boolean;
  }> {
    const patentId = patent.patent_id;
    let updated = false;

    // Step 1: Fetch details (abstract, etc.)
    if (options.fetchDetails !== false) {
      if (!patent.patent_abstract || patent.patent_abstract === '') {
        const details = await this.fetchPatentDetails(patentId);
        if (details?.patent_abstract) {
          patent.patent_abstract = details.patent_abstract;
          updated = true;
        }
      }
    }

    // Step 2: Fetch forward citation count
    if (options.fetchCitations !== false) {
      if (!patent.forward_citations || patent.forward_citations === 0) {
        const count = await this.fetchForwardCitationCount(patentId);
        if (count > 0) {
          patent.forward_citations = count;
          // Recalculate V1 score
          if ((patent.remaining_years || 0) > 0) {
            patent.score = count * 1.5;
          }
          updated = true;
        }
      }
    }

    // Step 3: Mine citing patent details
    if (options.mineCiting !== false && (patent.forward_citations || 0) > 0) {
      const cachePath = path.join(CITING_DETAILS_CACHE, `${patentId}.json`);
      if (!fs.existsSync(cachePath)) {
        await this.fetchCitingPatentDetails(patentId);
        updated = true;
      }
    }

    // Step 4: Classify citations
    if (options.classify !== false) {
      const classPath = path.join(CLASSIFICATION_CACHE, `${patentId}.json`);
      const citingPath = path.join(CITING_DETAILS_CACHE, `${patentId}.json`);

      if (!fs.existsSync(classPath) && fs.existsSync(citingPath)) {
        const citing = JSON.parse(fs.readFileSync(citingPath, 'utf-8'));
        this.classifyCitations(patentId, citing.citing_patents || []);
        updated = true;
      }
    }

    return {
      patent,
      status: this.getEnrichmentStatus(patent),
      updated,
    };
  }

  /**
   * Batch enrichment for multiple patents
   */
  async enrichBatch(
    patents: any[],
    options: {
      onProgress?: (progress: EnrichmentProgress) => void;
      fetchDetails?: boolean;
      fetchCitations?: boolean;
      mineCiting?: boolean;
      classify?: boolean;
    } = {}
  ): Promise<EnrichmentProgress> {
    const progress: EnrichmentProgress = {
      total: patents.length,
      processed: 0,
      errors: 0,
      skipped: 0,
    };

    for (const patent of patents) {
      try {
        const { updated } = await this.enrichPatent(patent, options);
        if (!updated) {
          progress.skipped++;
        }
        progress.processed++;
      } catch (err) {
        progress.errors++;
        progress.processed++;
        console.error(`Error enriching ${patent.patent_id}:`, (err as Error).message);
      }

      if (options.onProgress && progress.processed % 10 === 0) {
        options.onProgress(progress);
      }
    }

    return progress;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton instance for API routes
// ─────────────────────────────────────────────────────────────────────────────

let _instance: PortfolioEnrichmentService | null = null;

export function getEnrichmentService(): PortfolioEnrichmentService {
  if (!_instance) {
    const apiKey = process.env.PATENTSVIEW_API_KEY;
    if (!apiKey) {
      throw new Error('PATENTSVIEW_API_KEY not set');
    }
    _instance = new PortfolioEnrichmentService(apiKey);
  }
  return _instance;
}
