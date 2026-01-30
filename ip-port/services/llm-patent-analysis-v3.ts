/**
 * LLM Patent Analysis Service v3 - Enhanced with Cross-Sector Signals
 *
 * Uses V3 prompt with additional broadly-applicable signals:
 * - implementation_type (hardware/software/hybrid)
 * - standards_relevance and standards_bodies
 * - market_segment
 * - implementation_complexity
 * - claim_type_primary
 * - geographic_scope
 * - lifecycle_stage
 */

import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { ChatAnthropic } from '@langchain/anthropic';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { z } from 'zod';

dotenv.config();

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const LLM_MODEL = process.env.LLM_MODEL || 'claude-sonnet-4-20250514';
const LLM_BATCH_SIZE = parseInt(process.env.LLM_BATCH_SIZE || '5');
const LLM_RATE_LIMIT_MS = parseInt(process.env.LLM_RATE_LIMIT_MS || '2000');
const LLM_MAX_RETRIES = parseInt(process.env.LLM_MAX_RETRIES || '3');

const LLM_OUTPUT_DIR = './output/llm-analysis-v3';
const BATCHES_DIR = './output/llm-analysis-v3/batches';
const LLM_CACHE_DIR = './cache/llm-scores';

// V3 schema with cross-sector signals
const PatentAnalysisV3Schema = z.object({
  patent_id: z.string(),
  // Core assessment
  summary: z.string(),
  prior_art_problem: z.string(),
  technical_solution: z.string(),
  // Legal viability
  eligibility_score: z.number().min(1).max(5),
  validity_score: z.number().min(1).max(5),
  claim_breadth: z.number().min(1).max(5),
  claim_clarity_score: z.number().min(1).max(5),
  // Enforcement potential
  enforcement_clarity: z.number().min(1).max(5),
  design_around_difficulty: z.number().min(1).max(5),
  evidence_accessibility_score: z.number().min(1).max(5),
  // Market applicability
  technology_category: z.string(),
  product_types: z.array(z.string()),
  market_relevance_score: z.number().min(1).max(5),
  trend_alignment_score: z.number().min(1).max(5),
  // Investigation guidance
  likely_implementers: z.array(z.string()),
  detection_method: z.string(),
  investigation_priority_score: z.number().min(1).max(5),
  // NEW in V3: Cross-sector signals
  implementation_type: z.string(),
  standards_relevance: z.string(),
  standards_bodies: z.array(z.string()),
  market_segment: z.string(),
  implementation_complexity: z.string(),
  claim_type_primary: z.string(),
  geographic_scope: z.string(),
  lifecycle_stage: z.string(),
  // Meta
  confidence: z.number().min(1).max(5),
});

const AnalysesResponseV3Schema = z.object({
  analyses: z.array(PatentAnalysisV3Schema),
});

export type PatentAnalysisV3 = z.infer<typeof PatentAnalysisV3Schema>;

interface PatentInput {
  patent_id: string;
  title: string;
  abstract?: string;
  grant_date?: string;
  cpc_codes?: string[];
}

const SYSTEM_PROMPT = `You are a patent analysis expert with deep knowledge of patent law, technology markets, and infringement analysis. Your task is to analyze patents and provide structured assessments that help identify valuable patents for licensing and litigation.

Be objective, thorough, and base your analysis on the patent information provided combined with your knowledge of current technology markets and products. For rating scales, use the specific criteria given. When uncertain, lean toward moderate scores and indicate lower confidence.

Key focus areas:
- 101 eligibility and validity risk
- Commercial applicability to real products
- Evidence accessibility for enforcement
- Alignment with current technology trends
- Standards body relevance (3GPP, IEEE, ETSI, etc.)
- Hardware vs software implementation (affects 101 risk)

Always return valid JSON matching the exact schema requested.`;

function buildUserPromptV3(patents: PatentInput[]): string {
  const patentsJson = patents.map(p => ({
    patent_id: p.patent_id,
    title: p.title,
    abstract: p.abstract || 'Not available',
    grant_date: p.grant_date || 'Unknown',
    cpc_codes: p.cpc_codes?.slice(0, 5) || [],
  }));

  return `Analyze the following patent(s) and return a comprehensive JSON response.

For each patent, provide:

## CORE ASSESSMENT
1. summary: High-level summary for non-technical audience (2-3 sentences)
2. prior_art_problem: What problem in prior art does this solve? (2-3 sentences)
3. technical_solution: How does the technical solution work? (2-3 sentences)

## LEGAL VIABILITY RATINGS (1-5, higher = better for patent holder)
4. eligibility_score: Patent eligibility strength under 35 USC 101
5. validity_score: Strength against prior art invalidity challenges
6. claim_breadth: Scope and breadth of patent claims
7. claim_clarity_score: How clear and well-defined are claim boundaries?

## ENFORCEMENT POTENTIAL RATINGS (1-5, higher = better)
8. enforcement_clarity: How easily can infringement be detected?
9. design_around_difficulty: How difficult to avoid this patent?
10. evidence_accessibility_score: How accessible is infringement evidence?

## MARKET APPLICABILITY
11. technology_category: Primary technology category (e.g., "video streaming", "cloud computing", "mobile devices", "cybersecurity", "AI/ML", "IoT", "networking", "rf/wireless", "semiconductor")
12. product_types: Array of specific product types this might cover
13. market_relevance_score (1-5): How relevant to current products in market?
14. trend_alignment_score (1-5): Alignment with current technology trends?

## INVESTIGATION GUIDANCE
15. likely_implementers: Types of companies likely using this technology
16. detection_method: How would you detect infringement? ("observable", "technical_analysis", "reverse_engineering", "discovery_required")
17. investigation_priority_score (1-5): Priority for infringement investigation

## CROSS-SECTOR SIGNALS (broadly applicable across technology areas)
18. implementation_type: Primary implementation type - one of: "hardware", "software", "firmware", "system", "method", "hybrid"
19. standards_relevance: Standards body relevance - one of: "none", "related", "likely_essential", "declared_essential"
20. standards_bodies: Array of relevant standards bodies if any (e.g., ["3GPP", "IEEE", "ETSI", "IETF", "W3C", "ITU", "JEDEC", "USB-IF", "Bluetooth SIG"])
21. market_segment: Primary market segment - one of: "consumer", "enterprise", "infrastructure", "industrial", "automotive", "medical", "mixed"
22. implementation_complexity: How complex to implement - one of: "simple", "moderate", "complex", "highly_complex"
23. claim_type_primary: Primary claim type - one of: "method", "system", "apparatus", "device", "computer_readable_medium", "composition"
24. geographic_scope: Where is this technology primarily deployed? - one of: "us_centric", "global", "regional"
25. lifecycle_stage: Technology lifecycle - one of: "emerging", "growth", "mature", "declining"

26. confidence: Overall confidence in this analysis (1-5)

Rating Scale Reference (ALL: Higher = Better):
- 5 = Very Strong/Broad/Clear/High Priority
- 4 = Strong/Good
- 3 = Moderate
- 2 = Weak/Limited
- 1 = Very Weak/Low Priority

Patents to analyze:
${JSON.stringify(patentsJson, null, 2)}

Return ONLY valid JSON in this exact format (no markdown, no explanation):
{
  "analyses": [
    {
      "patent_id": "string",
      "summary": "string",
      "prior_art_problem": "string",
      "technical_solution": "string",
      "eligibility_score": number,
      "validity_score": number,
      "claim_breadth": number,
      "claim_clarity_score": number,
      "enforcement_clarity": number,
      "design_around_difficulty": number,
      "evidence_accessibility_score": number,
      "technology_category": "string",
      "product_types": ["string"],
      "market_relevance_score": number,
      "trend_alignment_score": number,
      "likely_implementers": ["string"],
      "detection_method": "string",
      "investigation_priority_score": number,
      "implementation_type": "string",
      "standards_relevance": "string",
      "standards_bodies": ["string"],
      "market_segment": "string",
      "implementation_complexity": "string",
      "claim_type_primary": "string",
      "geographic_scope": "string",
      "lifecycle_stage": "string",
      "confidence": number
    }
  ]
}`;
}

export class LLMPatentAnalyzerV3 {
  private model: ChatAnthropic;

  constructor() {
    if (!ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY not set in environment');
    }

    this.model = new ChatAnthropic({
      apiKey: ANTHROPIC_API_KEY,
      model: LLM_MODEL,
      maxTokens: 8192,
      temperature: 0.3,
    });

    this.ensureDirectories();
  }

  private ensureDirectories(): void {
    [LLM_OUTPUT_DIR, BATCHES_DIR].forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });
  }

  private getDateString(): string {
    return new Date().toISOString().split('T')[0];
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async analyzePatents(patents: PatentInput[]): Promise<PatentAnalysisV3[]> {
    const messages = [
      new SystemMessage(SYSTEM_PROMPT),
      new HumanMessage(buildUserPromptV3(patents)),
    ];

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= LLM_MAX_RETRIES; attempt++) {
      try {
        const response = await this.model.invoke(messages);
        const content = response.content as string;

        let jsonStr = content;
        if (content.includes('```json')) {
          jsonStr = content.split('```json')[1].split('```')[0].trim();
        } else if (content.includes('```')) {
          jsonStr = content.split('```')[1].split('```')[0].trim();
        }

        const parsed = JSON.parse(jsonStr);
        const validated = AnalysesResponseV3Schema.parse(parsed);

        return validated.analyses;
      } catch (error) {
        lastError = error as Error;
        console.error(`Attempt ${attempt}/${LLM_MAX_RETRIES} failed:`, error);

        if (attempt < LLM_MAX_RETRIES) {
          await this.sleep(LLM_RATE_LIMIT_MS * attempt);
        }
      }
    }

    throw new Error(`Failed after ${LLM_MAX_RETRIES} attempts: ${lastError?.message}`);
  }

  async processBatches(
    patents: PatentInput[],
    options: {
      batchSize?: number;
      startIndex?: number;
      onProgress?: (completed: number, total: number) => void;
    } = {}
  ): Promise<PatentAnalysisV3[]> {
    const { batchSize = LLM_BATCH_SIZE, startIndex = 0, onProgress } = options;

    const allResults: PatentAnalysisV3[] = [];
    const totalBatches = Math.ceil(patents.length / batchSize);

    for (let i = 0; i < patents.length; i += batchSize) {
      const batchNum = Math.floor(i / batchSize) + 1;
      const batch = patents.slice(i, i + batchSize);

      console.log(`\nProcessing batch ${batchNum}/${totalBatches} (${batch.length} patents)...`);

      try {
        const results = await this.analyzePatents(batch);
        allResults.push(...results);

        const batchFile = path.join(
          BATCHES_DIR,
          `batch-v3-${String(startIndex + batchNum).padStart(3, '0')}-${this.getDateString()}.json`
        );
        fs.writeFileSync(batchFile, JSON.stringify({
          batchNumber: startIndex + batchNum,
          timestamp: new Date().toISOString(),
          promptVersion: 'v3',
          patentIds: batch.map(p => p.patent_id),
          analyses: results,
        }, null, 2));
        console.log(`  Saved: ${batchFile}`);

        if (onProgress) {
          onProgress(Math.min(i + batchSize, patents.length), patents.length);
        }

        if (i + batchSize < patents.length) {
          await this.sleep(LLM_RATE_LIMIT_MS);
        }
      } catch (error) {
        console.error(`Batch ${batchNum} failed:`, error);
      }
    }

    return allResults;
  }

  // Calculate sub-scores
  calculateLegalViabilityScore(a: PatentAnalysisV3): number {
    return (
      a.eligibility_score * 0.30 +
      a.validity_score * 0.30 +
      a.claim_breadth * 0.20 +
      a.claim_clarity_score * 0.20
    ) / 5 * 100;
  }

  calculateEnforcementPotentialScore(a: PatentAnalysisV3): number {
    return (
      a.enforcement_clarity * 0.35 +
      a.evidence_accessibility_score * 0.35 +
      a.design_around_difficulty * 0.30
    ) / 5 * 100;
  }

  calculateMarketValueScore(a: PatentAnalysisV3): number {
    return (
      a.market_relevance_score * 0.50 +
      a.trend_alignment_score * 0.50
    ) / 5 * 100;
  }

  // Aggregate all results and save combined output + per-patent cache files
  async saveResults(results: PatentAnalysisV3[]): Promise<string> {
    const outputPath = path.join(LLM_OUTPUT_DIR, `combined-v3-${this.getDateString()}.json`);

    // Ensure cache directory exists
    if (!fs.existsSync(LLM_CACHE_DIR)) {
      fs.mkdirSync(LLM_CACHE_DIR, { recursive: true });
    }

    const enrichedResults = results.map(r => ({
      ...r,
      legal_viability_score: this.calculateLegalViabilityScore(r),
      enforcement_potential_score: this.calculateEnforcementPotentialScore(r),
      market_value_score: this.calculateMarketValueScore(r),
    }));

    // Save combined output
    const output = {
      generated_at: new Date().toISOString(),
      version: 'v3',
      total_patents: results.length,
      analyses: enrichedResults,
    };

    fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
    console.log(`\nCombined results saved to: ${outputPath}`);

    // Save per-patent cache files for enrichment tracking
    for (const result of enrichedResults) {
      const cacheFile = path.join(LLM_CACHE_DIR, `${result.patent_id}.json`);
      const cacheRecord = {
        ...result,
        source: 'v3',
        cached_at: new Date().toISOString(),
      };
      fs.writeFileSync(cacheFile, JSON.stringify(cacheRecord, null, 2));
    }
    console.log(`Per-patent cache files saved to: ${LLM_CACHE_DIR} (${results.length} files)`);

    return outputPath;
  }
}
