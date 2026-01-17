/**
 * LLM Patent Analysis Service v2 - Expanded Analysis
 *
 * Uses enhanced prompt with market applicability, enforcement potential,
 * and investigation priority metrics.
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
const LLM_RATE_LIMIT_MS = parseInt(process.env.LLM_RATE_LIMIT_MS || '1000');
const LLM_MAX_RETRIES = parseInt(process.env.LLM_MAX_RETRIES || '3');

const OUTPUT_DIR = './output';
const LLM_OUTPUT_DIR = './output/llm-analysis-v2';
const BATCHES_DIR = './output/llm-analysis-v2/batches';

// Extended schema for v2 analysis
const PatentAnalysisV2Schema = z.object({
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
  // Meta
  confidence: z.number().min(1).max(5),
});

const AnalysesResponseV2Schema = z.object({
  analyses: z.array(PatentAnalysisV2Schema),
});

export type PatentAnalysisV2 = z.infer<typeof PatentAnalysisV2Schema>;

interface PatentInput {
  patent_id: string;
  title: string;
  abstract?: string;
  grant_date?: string;
}

const SYSTEM_PROMPT = `You are a patent analysis expert with deep knowledge of patent law, technology markets, and infringement analysis. Your task is to analyze patents and provide structured assessments that help identify valuable patents for licensing and litigation.

Be objective, thorough, and base your analysis on the patent information provided combined with your knowledge of current technology markets and products. For rating scales, use the specific criteria given. When uncertain, lean toward moderate scores and indicate lower confidence.

Key focus areas:
- 101 eligibility and validity risk
- Commercial applicability to real products
- Evidence accessibility for enforcement
- Alignment with current technology trends
- Claim clarity and litigation viability

Always return valid JSON matching the exact schema requested.`;

function buildUserPromptV2(patents: PatentInput[]): string {
  const patentsJson = patents.map(p => ({
    patent_id: p.patent_id,
    title: p.title,
    abstract: p.abstract || 'Not available',
    grant_date: p.grant_date || 'Unknown',
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
11. technology_category: Primary technology category (e.g., "video streaming", "cloud computing", "mobile devices", "cybersecurity", "AI/ML", "IoT", "networking", "data storage", "wireless communications")
12. product_types: Array of specific product types this might cover (e.g., ["streaming services", "smart TVs", "mobile apps"])
13. market_relevance_score (1-5): How relevant to current products in market?
14. trend_alignment_score (1-5): Alignment with current technology trends?

## INVESTIGATION GUIDANCE
15. likely_implementers: Types of companies likely using this technology (e.g., ["streaming providers", "device manufacturers", "cloud providers"])
16. detection_method: How would you detect infringement? ("observable from product", "technical documentation review", "product testing required", "reverse engineering needed", "discovery required")
17. investigation_priority_score (1-5): Priority for infringement investigation

18. confidence: Overall confidence in this analysis (1-5)

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
      "confidence": number
    }
  ]
}`;
}

export class LLMPatentAnalyzerV2 {
  private model: ChatAnthropic;

  constructor() {
    if (!ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY not set in environment');
    }

    this.model = new ChatAnthropic({
      apiKey: ANTHROPIC_API_KEY,
      model: LLM_MODEL,
      maxTokens: 8192, // Increased for expanded output
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

  async analyzePatents(patents: PatentInput[]): Promise<PatentAnalysisV2[]> {
    const messages = [
      new SystemMessage(SYSTEM_PROMPT),
      new HumanMessage(buildUserPromptV2(patents)),
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
        const validated = AnalysesResponseV2Schema.parse(parsed);

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
  ): Promise<PatentAnalysisV2[]> {
    const { batchSize = LLM_BATCH_SIZE, startIndex = 0, onProgress } = options;

    const allResults: PatentAnalysisV2[] = [];
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
          `batch-v2-${String(startIndex + batchNum).padStart(3, '0')}-${this.getDateString()}.json`
        );
        fs.writeFileSync(batchFile, JSON.stringify({
          batchNumber: startIndex + batchNum,
          timestamp: new Date().toISOString(),
          promptVersion: 'v2',
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
  calculateLegalViabilityScore(a: PatentAnalysisV2): number {
    return (
      a.eligibility_score * 0.30 +
      a.validity_score * 0.30 +
      a.claim_breadth * 0.20 +
      a.claim_clarity_score * 0.20
    ) / 5 * 100;
  }

  calculateEnforcementPotentialScore(a: PatentAnalysisV2): number {
    return (
      a.enforcement_clarity * 0.35 +
      a.evidence_accessibility_score * 0.35 +
      a.design_around_difficulty * 0.30
    ) / 5 * 100;
  }

  calculateMarketValueScore(a: PatentAnalysisV2): number {
    return (
      a.market_relevance_score * 0.50 +
      a.trend_alignment_score * 0.50
    ) / 5 * 100;
  }

  calculateOverallScore(a: PatentAnalysisV2): number {
    const legal = this.calculateLegalViabilityScore(a);
    const enforcement = this.calculateEnforcementPotentialScore(a);
    const market = this.calculateMarketValueScore(a);
    const investigation = a.investigation_priority_score / 5 * 100;

    return (
      legal * 0.35 +
      enforcement * 0.35 +
      market * 0.20 +
      investigation * 0.10
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private getDateString(): string {
    return new Date().toISOString().split('T')[0];
  }
}

// Load patent data
function loadPatentData(): Map<string, PatentInput> {
  const patents = new Map<string, PatentInput>();

  const portfolioPath = path.join(OUTPUT_DIR, 'broadcom-portfolio-2026-01-15.json');
  if (fs.existsSync(portfolioPath)) {
    const data = JSON.parse(fs.readFileSync(portfolioPath, 'utf-8'));
    for (const p of data.patents || []) {
      patents.set(p.patent_id, {
        patent_id: p.patent_id,
        title: p.patent_title,
        abstract: p.patent_abstract,
        grant_date: p.patent_date,
      });
    }
  }

  const batchFiles = fs.readdirSync(OUTPUT_DIR).filter(f => f.startsWith('patents-batch-'));
  for (const file of batchFiles) {
    const data = JSON.parse(fs.readFileSync(path.join(OUTPUT_DIR, file), 'utf-8'));
    for (const p of data.patents || []) {
      if (!patents.has(p.patent_id) || !patents.get(p.patent_id)?.abstract) {
        patents.set(p.patent_id, {
          patent_id: p.patent_id,
          title: p.patent_title,
          abstract: p.patent_abstract,
          grant_date: p.patent_date,
        });
      }
    }
  }

  return patents;
}

// Load patents from citation overlap results
function loadCitationOverlapPatents(file: string): string[] {
  const filepath = path.join(OUTPUT_DIR, file);
  if (!fs.existsSync(filepath)) return [];

  const data = JSON.parse(fs.readFileSync(filepath, 'utf-8'));
  return (data.results || [])
    .filter((r: any) => r.competitor_citations > 0)
    .map((r: any) => r.broadcom_patent_id || r.patent_id);
}

// CLI
async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  LLM PATENT ANALYSIS v2 - EXPANDED');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const analyzer = new LLMPatentAnalyzerV2();

  switch (command) {
    case 'test': {
      console.log('Running test with 2 patents...\n');

      const allPatents = loadPatentData();
      const testPatents = Array.from(allPatents.values())
        .filter(p => p.abstract)
        .slice(0, 2);

      console.log('Test patents:');
      testPatents.forEach(p => console.log(`  ${p.patent_id}: ${p.title}`));
      console.log();

      const results = await analyzer.analyzePatents(testPatents);

      console.log('\nResults:');
      for (const r of results) {
        console.log(`\n${'─'.repeat(60)}`);
        console.log(`Patent: ${r.patent_id}`);
        console.log(`${'─'.repeat(60)}`);
        console.log(`\nSummary: ${r.summary}`);
        console.log(`\nTechnology: ${r.technology_category}`);
        console.log(`Products: ${r.product_types.join(', ')}`);
        console.log(`Likely Implementers: ${r.likely_implementers.join(', ')}`);
        console.log(`Detection: ${r.detection_method}`);
        console.log(`\nScores:`);
        console.log(`  Eligibility: ${r.eligibility_score}/5`);
        console.log(`  Validity: ${r.validity_score}/5`);
        console.log(`  Claim Breadth: ${r.claim_breadth}/5`);
        console.log(`  Claim Clarity: ${r.claim_clarity_score}/5`);
        console.log(`  Enforcement: ${r.enforcement_clarity}/5`);
        console.log(`  Design-Around: ${r.design_around_difficulty}/5`);
        console.log(`  Evidence Access: ${r.evidence_accessibility_score}/5`);
        console.log(`  Market Relevance: ${r.market_relevance_score}/5`);
        console.log(`  Trend Alignment: ${r.trend_alignment_score}/5`);
        console.log(`  Investigation Priority: ${r.investigation_priority_score}/5`);
        console.log(`  Confidence: ${r.confidence}/5`);
        console.log(`\nComposite Scores:`);
        console.log(`  Legal Viability: ${analyzer.calculateLegalViabilityScore(r).toFixed(1)}`);
        console.log(`  Enforcement Potential: ${analyzer.calculateEnforcementPotentialScore(r).toFixed(1)}`);
        console.log(`  Market Value: ${analyzer.calculateMarketValueScore(r).toFixed(1)}`);
        console.log(`  Overall LLM Score: ${analyzer.calculateOverallScore(r).toFixed(1)}`);
      }
      break;
    }

    case 'analyze-file': {
      const file = args[1];
      if (!file) {
        console.log('Usage: analyze-file <citation-overlap-file.json>');
        break;
      }

      console.log(`Analyzing patents from ${file}...`);
      const patentIds = loadCitationOverlapPatents(file);
      console.log(`Found ${patentIds.length} patents with competitor citations`);

      const allPatents = loadPatentData();
      const patentsToAnalyze = patentIds
        .map(id => allPatents.get(id))
        .filter((p): p is PatentInput => p !== undefined && !!p.abstract);

      console.log(`${patentsToAnalyze.length} patents have abstracts`);

      if (patentsToAnalyze.length === 0) {
        console.log('No patents to analyze');
        break;
      }

      const results = await analyzer.processBatches(patentsToAnalyze, {
        onProgress: (completed, total) => {
          console.log(`  Progress: ${completed}/${total}`);
        },
      });

      // Save combined results
      const outputFile = path.join(
        LLM_OUTPUT_DIR,
        `analysis-v2-${file.replace('.json', '')}-${new Date().toISOString().split('T')[0]}.json`
      );
      fs.writeFileSync(outputFile, JSON.stringify({
        sourceFile: file,
        timestamp: new Date().toISOString(),
        promptVersion: 'v2',
        totalAnalyzed: results.length,
        analyses: results.map(r => ({
          ...r,
          legal_viability_score: analyzer.calculateLegalViabilityScore(r),
          enforcement_potential_score: analyzer.calculateEnforcementPotentialScore(r),
          market_value_score: analyzer.calculateMarketValueScore(r),
          overall_llm_score: analyzer.calculateOverallScore(r),
        })),
      }, null, 2));

      console.log(`\n✓ Saved: ${outputFile}`);
      break;
    }

    default:
      console.log(`
LLM Patent Analysis v2 - Expanded Analysis

Commands:
  test                           Quick test with 2 patents
  analyze-file <file.json>       Analyze patents from citation overlap file

Examples:
  npx tsx services/llm-patent-analysis-v2.ts test
  npx tsx services/llm-patent-analysis-v2.ts analyze-file citation-overlap-3500-4000-2026-01-16.json

Environment:
  Model: ${LLM_MODEL}
  Batch Size: ${LLM_BATCH_SIZE}
  Output: ${LLM_OUTPUT_DIR}
      `);
  }
}

if (process.argv[1]?.includes('llm-patent-analysis-v2')) {
  main().catch(console.error);
}
