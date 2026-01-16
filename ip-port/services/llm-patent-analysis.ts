/**
 * LLM Patent Analysis Service
 *
 * Uses Claude via LangChain to perform qualitative patent analysis.
 * Analyzes patents for 101 eligibility, validity, claim breadth,
 * enforcement clarity, and design-around difficulty.
 */

import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { ChatAnthropic } from '@langchain/anthropic';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { z } from 'zod';

dotenv.config();

// Configuration
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const LLM_MODEL = process.env.LLM_MODEL || 'claude-sonnet-4-20250514';
const LLM_BATCH_SIZE = parseInt(process.env.LLM_BATCH_SIZE || '5');
const LLM_RATE_LIMIT_MS = parseInt(process.env.LLM_RATE_LIMIT_MS || '1000');
const LLM_MAX_RETRIES = parseInt(process.env.LLM_MAX_RETRIES || '3');

const OUTPUT_DIR = './output';
const LLM_OUTPUT_DIR = './output/llm-analysis';
const BATCHES_DIR = './output/llm-analysis/batches';

// Zod schema for validation
const PatentAnalysisSchema = z.object({
  patent_id: z.string(),
  summary: z.string(),
  prior_art_problem: z.string(),
  technical_solution: z.string(),
  eligibility_score: z.number().min(1).max(5),
  validity_score: z.number().min(1).max(5),
  claim_breadth: z.number().min(1).max(5),
  enforcement_clarity: z.number().min(1).max(5),
  design_around_difficulty: z.number().min(1).max(5),
  confidence: z.number().min(1).max(5),
});

const AnalysesResponseSchema = z.object({
  analyses: z.array(PatentAnalysisSchema),
});

export type PatentAnalysis = z.infer<typeof PatentAnalysisSchema>;
export type AnalysesResponse = z.infer<typeof AnalysesResponseSchema>;

// Input patent data structure
interface PatentInput {
  patent_id: string;
  title: string;
  abstract?: string;
  grant_date?: string;
  assignee?: string;
}

// System prompt for the LLM
const SYSTEM_PROMPT = `You are a patent analysis expert with deep knowledge of patent law, prior art research, and technical analysis. Your task is to analyze patents and provide structured assessments.

Be objective, thorough, and base your analysis only on the patent information provided. For rating scales, use the specific criteria given. When uncertain, lean toward moderate scores and indicate lower confidence.

Important guidelines:
- For 101 eligibility: Focus on whether claims recite patent-eligible subject matter (not abstract ideas, laws of nature, or natural phenomena without significantly more)
- For validity: Consider the patent's grant date when assessing prior art risk
- For claim breadth: Assess both independent and dependent claim scope
- For enforcement: Consider how infringement would be detected in practice
- For design-around: Consider practical alternatives available to competitors

Always return valid JSON matching the exact schema requested.`;

// User prompt template
function buildUserPrompt(patents: PatentInput[]): string {
  const patentsJson = patents.map(p => ({
    patent_id: p.patent_id,
    title: p.title,
    abstract: p.abstract || 'Not available',
    grant_date: p.grant_date || 'Unknown',
  }));

  return `Analyze the following patent(s) and return a JSON response.

For each patent, provide:
1. summary: High-level summary for non-technical audience (2-3 sentences)
2. prior_art_problem: What problem in prior art does this solve? (2-3 sentences)
3. technical_solution: How does the technical solution work? (2-3 sentences)
4. eligibility_score: Patent eligibility strength under 101 (1-5)
5. validity_score: Strength against prior art invalidity (1-5)
6. claim_breadth: Claim scope/breadth (1-5)
7. enforcement_clarity: How easy to detect infringement (1-5)
8. design_around_difficulty: How hard to avoid this patent (1-5)
9. confidence: Your confidence in this analysis (1-5)

Rating Scales (ALL: Higher = Better for patent holder):
- 5 = Very Strong/Very Broad/Very Clear/Very Difficult to avoid
- 4 = Strong/Broad/Clear/Difficult to avoid
- 3 = Moderate
- 2 = Weak/Narrow/Unclear/Easy to avoid
- 1 = Very Weak/Very Narrow/Very Unclear/Very Easy to avoid

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
      "enforcement_clarity": number,
      "design_around_difficulty": number,
      "confidence": number
    }
  ]
}`;
}

export class LLMPatentAnalyzer {
  private model: ChatAnthropic;

  constructor() {
    if (!ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY not set in environment');
    }

    this.model = new ChatAnthropic({
      apiKey: ANTHROPIC_API_KEY,
      model: LLM_MODEL,
      maxTokens: 4096,
      temperature: 0.3, // Lower temperature for more consistent analysis
    });

    // Ensure output directories exist
    this.ensureDirectories();
  }

  private ensureDirectories(): void {
    [LLM_OUTPUT_DIR, BATCHES_DIR].forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });
  }

  /**
   * Analyze a single patent
   */
  async analyzeSingle(patent: PatentInput): Promise<PatentAnalysis> {
    const results = await this.analyzePatents([patent]);
    return results[0];
  }

  /**
   * Analyze multiple patents in a single API call
   */
  async analyzePatents(patents: PatentInput[]): Promise<PatentAnalysis[]> {
    const messages = [
      new SystemMessage(SYSTEM_PROMPT),
      new HumanMessage(buildUserPrompt(patents)),
    ];

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= LLM_MAX_RETRIES; attempt++) {
      try {
        const response = await this.model.invoke(messages);
        const content = response.content as string;

        // Parse JSON from response (handle potential markdown wrapping)
        let jsonStr = content;
        if (content.includes('```json')) {
          jsonStr = content.split('```json')[1].split('```')[0].trim();
        } else if (content.includes('```')) {
          jsonStr = content.split('```')[1].split('```')[0].trim();
        }

        const parsed = JSON.parse(jsonStr);
        const validated = AnalysesResponseSchema.parse(parsed);

        return validated.analyses;
      } catch (error) {
        lastError = error as Error;
        console.error(`Attempt ${attempt}/${LLM_MAX_RETRIES} failed:`, error);

        if (attempt < LLM_MAX_RETRIES) {
          await this.sleep(LLM_RATE_LIMIT_MS * attempt); // Exponential backoff
        }
      }
    }

    throw new Error(`Failed after ${LLM_MAX_RETRIES} attempts: ${lastError?.message}`);
  }

  /**
   * Process patents in batches
   */
  async processBatches(
    patents: PatentInput[],
    options: {
      batchSize?: number;
      startIndex?: number;
      onProgress?: (completed: number, total: number) => void;
      saveBatches?: boolean;
    } = {}
  ): Promise<PatentAnalysis[]> {
    const {
      batchSize = LLM_BATCH_SIZE,
      startIndex = 0,
      onProgress,
      saveBatches = true,
    } = options;

    const allResults: PatentAnalysis[] = [];
    const totalBatches = Math.ceil(patents.length / batchSize);

    for (let i = 0; i < patents.length; i += batchSize) {
      const batchNum = Math.floor(i / batchSize) + 1;
      const batch = patents.slice(i, i + batchSize);

      console.log(`\nProcessing batch ${batchNum}/${totalBatches} (${batch.length} patents)...`);

      try {
        const results = await this.analyzePatents(batch);
        allResults.push(...results);

        if (saveBatches) {
          const batchFile = path.join(
            BATCHES_DIR,
            `batch-${String(startIndex + batchNum).padStart(3, '0')}-${this.getDateString()}.json`
          );
          fs.writeFileSync(batchFile, JSON.stringify({
            batchNumber: startIndex + batchNum,
            timestamp: new Date().toISOString(),
            patentIds: batch.map(p => p.patent_id),
            analyses: results,
          }, null, 2));
          console.log(`  Saved: ${batchFile}`);
        }

        if (onProgress) {
          onProgress(Math.min(i + batchSize, patents.length), patents.length);
        }

        // Rate limiting between batches
        if (i + batchSize < patents.length) {
          await this.sleep(LLM_RATE_LIMIT_MS);
        }
      } catch (error) {
        console.error(`Batch ${batchNum} failed:`, error);
        // Continue with next batch instead of failing completely
      }
    }

    return allResults;
  }

  /**
   * Calculate LLM quality score from analysis
   */
  calculateQualityScore(analysis: PatentAnalysis): number {
    return (
      analysis.eligibility_score * 0.25 +
      analysis.validity_score * 0.25 +
      analysis.claim_breadth * 0.20 +
      analysis.enforcement_clarity * 0.15 +
      analysis.design_around_difficulty * 0.15
    ) / 5 * 100;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private getDateString(): string {
    return new Date().toISOString().split('T')[0];
  }
}

// Load patent data from various sources
function loadPatentData(): PatentInput[] {
  const patents: Map<string, PatentInput> = new Map();

  // Load from portfolio
  const portfolioPath = path.join(OUTPUT_DIR, 'broadcom-portfolio-2026-01-15.json');
  if (fs.existsSync(portfolioPath)) {
    const data = JSON.parse(fs.readFileSync(portfolioPath, 'utf-8'));
    for (const p of data.patents || []) {
      patents.set(p.patent_id, {
        patent_id: p.patent_id,
        title: p.patent_title,
        abstract: p.patent_abstract,
        grant_date: p.patent_date,
        assignee: p.assignees?.[0]?.assignee_organization,
      });
    }
  }

  // Load from streaming batches (may have more abstracts)
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
          assignee: p.assignees?.[0]?.assignee_organization,
        });
      }
    }
  }

  return Array.from(patents.values());
}

// Load top 250 from CSV
function loadTop250(): string[] {
  const csvPath = path.join(OUTPUT_DIR, 'top-250-actionable-2026-01-15.csv');
  if (!fs.existsSync(csvPath)) {
    throw new Error('Top 250 CSV not found');
  }

  const content = fs.readFileSync(csvPath, 'utf-8');
  const lines = content.trim().split('\n').slice(1); // Skip header

  return lines.map(line => {
    const match = line.match(/^\d+,"?(\d+)"?/);
    return match ? match[1] : '';
  }).filter(Boolean);
}

// CLI
async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  LLM PATENT ANALYSIS');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const analyzer = new LLMPatentAnalyzer();

  switch (command) {
    case 'analyze': {
      // Analyze single patent
      const patentId = args[1];
      if (!patentId) {
        console.log('Usage: analyze <patent_id>');
        break;
      }

      console.log(`Analyzing patent ${patentId}...`);
      const allPatents = loadPatentData();
      const patent = allPatents.find(p => p.patent_id === patentId);

      if (!patent) {
        console.error(`Patent ${patentId} not found in data`);
        break;
      }

      const result = await analyzer.analyzeSingle(patent);
      console.log('\nAnalysis Result:');
      console.log(JSON.stringify(result, null, 2));
      console.log(`\nLLM Quality Score: ${analyzer.calculateQualityScore(result).toFixed(1)}`);
      break;
    }

    case 'batch': {
      // Process batch of patents
      const startIdx = parseInt(args[1] || '0');
      const count = parseInt(args[2] || '10');

      console.log(`Processing ${count} patents starting at index ${startIdx}...`);

      const top250 = loadTop250();
      const allPatents = loadPatentData();
      const patentMap = new Map(allPatents.map(p => [p.patent_id, p]));

      const patentsToAnalyze = top250
        .slice(startIdx, startIdx + count)
        .map(id => patentMap.get(id))
        .filter((p): p is PatentInput => p !== undefined);

      console.log(`Found ${patentsToAnalyze.length} patents with data`);

      const results = await analyzer.processBatches(patentsToAnalyze, {
        startIndex: Math.floor(startIdx / LLM_BATCH_SIZE),
        onProgress: (completed, total) => {
          console.log(`  Progress: ${completed}/${total}`);
        },
      });

      console.log(`\n✓ Completed ${results.length} analyses`);

      // Save combined results
      const combinedPath = path.join(
        LLM_OUTPUT_DIR,
        `analyses-${startIdx}-${startIdx + count}-${new Date().toISOString().split('T')[0]}.json`
      );
      fs.writeFileSync(combinedPath, JSON.stringify({
        startIndex: startIdx,
        count: results.length,
        timestamp: new Date().toISOString(),
        analyses: results,
      }, null, 2));
      console.log(`Saved: ${combinedPath}`);
      break;
    }

    case 'test': {
      // Quick test with first 2 patents
      console.log('Running quick test with 2 patents...\n');

      const top250 = loadTop250().slice(0, 2);
      const allPatents = loadPatentData();
      const patentMap = new Map(allPatents.map(p => [p.patent_id, p]));

      const testPatents = top250
        .map(id => patentMap.get(id))
        .filter((p): p is PatentInput => p !== undefined);

      console.log('Test patents:');
      testPatents.forEach(p => console.log(`  ${p.patent_id}: ${p.title}`));
      console.log();

      const results = await analyzer.analyzePatents(testPatents);

      console.log('\nResults:');
      for (const r of results) {
        console.log(`\n─── ${r.patent_id} ───`);
        console.log(`Summary: ${r.summary}`);
        console.log(`Eligibility: ${r.eligibility_score}/5`);
        console.log(`Validity: ${r.validity_score}/5`);
        console.log(`Claim Breadth: ${r.claim_breadth}/5`);
        console.log(`Enforcement: ${r.enforcement_clarity}/5`);
        console.log(`Design-Around: ${r.design_around_difficulty}/5`);
        console.log(`Confidence: ${r.confidence}/5`);
        console.log(`Quality Score: ${analyzer.calculateQualityScore(r).toFixed(1)}`);
      }
      break;
    }

    default:
      console.log(`
LLM Patent Analysis CLI

Commands:
  test                    Quick test with 2 patents
  analyze <patent_id>     Analyze a single patent
  batch <start> <count>   Process patents in batches

Examples:
  npx tsx services/llm-patent-analysis.ts test
  npx tsx services/llm-patent-analysis.ts analyze 10200706
  npx tsx services/llm-patent-analysis.ts batch 0 50

Environment:
  Model: ${LLM_MODEL}
  Batch Size: ${LLM_BATCH_SIZE}
  Rate Limit: ${LLM_RATE_LIMIT_MS}ms
      `);
  }
}

// Run if executed directly
if (process.argv[1]?.includes('llm-patent-analysis')) {
  main().catch(console.error);
}
