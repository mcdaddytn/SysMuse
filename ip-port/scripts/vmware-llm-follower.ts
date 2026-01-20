/**
 * VMware LLM Follower Job
 *
 * Follows behind the citation analysis job, processing high-potential
 * VMware patents through LLM analysis as chunks complete.
 *
 * Criteria for LLM processing:
 * - Any patent with competitor_citations >= 1
 *
 * This maximizes overnight productivity by running LLM analysis
 * in parallel with citation analysis.
 *
 * Usage: npx tsx scripts/vmware-llm-follower.ts
 */

import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { ChatAnthropic } from '@langchain/anthropic';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { z } from 'zod';

dotenv.config();

const CHUNK_DIR = './output/vmware-chunks';
const LLM_OUTPUT_DIR = './output/vmware-llm-analysis';
const CHECK_INTERVAL_MS = 60000; // Check for new chunks every 60 seconds
const MIN_COMPETITOR_CITATIONS = 1; // Threshold for LLM analysis

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const LLM_MODEL = process.env.LLM_MODEL || 'claude-sonnet-4-20250514';

if (!ANTHROPIC_API_KEY) {
  console.error('Error: ANTHROPIC_API_KEY not set in .env');
  process.exit(1);
}

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

type PatentAnalysis = z.infer<typeof PatentAnalysisSchema>;

interface ChunkPatent {
  patent_id: string;
  title: string;
  assignee: string;
  grant_date: string;
  forward_citations: number;
  competitor_citations: number;
  competitor_count: number;
  competitors: string[];
}

const SYSTEM_PROMPT = `You are a patent analysis expert with deep knowledge of patent law, prior art research, and technical analysis. Your task is to analyze patents and provide structured assessments.

Be objective, thorough, and base your analysis only on the patent information provided. For rating scales, use the specific criteria given. When uncertain, lean toward moderate scores and indicate lower confidence.

Important guidelines:
- For 101 eligibility: Focus on whether claims recite patent-eligible subject matter (not abstract ideas, laws of nature, or natural phenomena without significantly more)
- For validity: Consider the patent's grant date when assessing prior art risk
- For claim breadth: Assess both independent and dependent claim scope
- For enforcement: Consider how infringement would be detected in practice
- For design-around: Consider practical alternatives available to competitors

Always return valid JSON matching the exact schema requested.`;

function buildUserPrompt(patents: ChunkPatent[]): string {
  const patentsJson = patents.map(p => ({
    patent_id: p.patent_id,
    title: p.title,
    assignee: p.assignee,
    grant_date: p.grant_date,
    competitor_citations: p.competitor_citations,
    competitors_citing: p.competitors,
  }));

  return `Analyze the following patent(s) and return a JSON response.

Context: These patents have been cited by competitor companies (listed), indicating potential licensing or litigation value.

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

class VMwareLLMFollower {
  private model: ChatAnthropic;
  private processedChunks: Set<string> = new Set();
  private processedPatentIds: Set<string> = new Set();
  private totalLLMProcessed = 0;
  private startTime = Date.now();

  constructor() {
    this.model = new ChatAnthropic({
      apiKey: ANTHROPIC_API_KEY,
      model: LLM_MODEL,
      maxTokens: 4096,
      temperature: 0.3,
    });
  }

  async initialize(): Promise<void> {
    // Create output directory
    await fs.mkdir(LLM_OUTPUT_DIR, { recursive: true });

    // Load already processed patent IDs
    const processedFile = path.join(LLM_OUTPUT_DIR, 'processed-patent-ids.txt');
    if (fsSync.existsSync(processedFile)) {
      const content = await fs.readFile(processedFile, 'utf-8');
      for (const line of content.split('\n')) {
        const id = line.trim();
        if (id) this.processedPatentIds.add(id);
      }
      console.log(`Resuming: ${this.processedPatentIds.size} patents already processed`);
    }

    // Load already processed chunks
    const chunksFile = path.join(LLM_OUTPUT_DIR, 'processed-chunks.txt');
    if (fsSync.existsSync(chunksFile)) {
      const content = await fs.readFile(chunksFile, 'utf-8');
      for (const line of content.split('\n')) {
        const chunk = line.trim();
        if (chunk) this.processedChunks.add(chunk);
      }
    }
  }

  async analyzePatents(patents: ChunkPatent[]): Promise<PatentAnalysis[]> {
    const messages = [
      new SystemMessage(SYSTEM_PROMPT),
      new HumanMessage(buildUserPrompt(patents)),
    ];

    for (let attempt = 1; attempt <= 3; attempt++) {
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
        const validated = AnalysesResponseSchema.parse(parsed);
        return validated.analyses;
      } catch (error) {
        console.error(`  Attempt ${attempt}/3 failed:`, error);
        if (attempt < 3) {
          await new Promise(r => setTimeout(r, 2000 * attempt));
        }
      }
    }

    throw new Error('LLM analysis failed after 3 attempts');
  }

  async processChunk(chunkFile: string): Promise<number> {
    const chunkPath = path.join(CHUNK_DIR, chunkFile);
    const chunk = JSON.parse(await fs.readFile(chunkPath, 'utf-8'));

    // Filter for high-potential patents not yet processed
    const candidates: ChunkPatent[] = chunk.results.filter(
      (p: ChunkPatent) =>
        p.competitor_citations >= MIN_COMPETITOR_CITATIONS &&
        !this.processedPatentIds.has(p.patent_id)
    );

    if (candidates.length === 0) {
      return 0;
    }

    console.log(`\n  Found ${candidates.length} high-potential patents in ${chunkFile}`);

    // Process in small batches (3 patents per API call)
    const batchSize = 3;
    let processedCount = 0;

    for (let i = 0; i < candidates.length; i += batchSize) {
      const batch = candidates.slice(i, i + batchSize);

      try {
        console.log(`    Analyzing batch ${Math.floor(i/batchSize) + 1}: ${batch.map(p => p.patent_id).join(', ')}`);
        const analyses = await this.analyzePatents(batch);

        // Save each analysis
        for (const analysis of analyses) {
          const outFile = path.join(LLM_OUTPUT_DIR, `patent-${analysis.patent_id}.json`);
          await fs.writeFile(outFile, JSON.stringify({
            patent_id: analysis.patent_id,
            source_chunk: chunkFile,
            analyzed_at: new Date().toISOString(),
            patent_info: batch.find(p => p.patent_id === analysis.patent_id),
            analysis,
          }, null, 2));

          // Mark as processed
          this.processedPatentIds.add(analysis.patent_id);
          await fs.appendFile(
            path.join(LLM_OUTPUT_DIR, 'processed-patent-ids.txt'),
            analysis.patent_id + '\n'
          );

          processedCount++;
          this.totalLLMProcessed++;
        }

        // Rate limit
        await new Promise(r => setTimeout(r, 1500));

      } catch (error) {
        console.error(`    Error processing batch:`, error);
      }
    }

    return processedCount;
  }

  async updateStatus(): Promise<void> {
    const elapsed = (Date.now() - this.startTime) / 1000 / 60;
    const status = [
      `VMware LLM Follower Status`,
      `==========================`,
      `Last Updated: ${new Date().toISOString()}`,
      ``,
      `Patents Analyzed (this session): ${this.totalLLMProcessed}`,
      `Total Patents with LLM: ${this.processedPatentIds.size}`,
      `Chunks Processed: ${this.processedChunks.size}`,
      ``,
      `Elapsed: ${elapsed.toFixed(1)} min`,
      `Threshold: ${MIN_COMPETITOR_CITATIONS}+ competitor citations`,
    ].join('\n');

    await fs.writeFile(path.join(LLM_OUTPUT_DIR, 'status.txt'), status);
  }

  async run(): Promise<void> {
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('        VMWARE LLM FOLLOWER JOB');
    console.log('═══════════════════════════════════════════════════════════════\n');
    console.log(`Threshold: ${MIN_COMPETITOR_CITATIONS}+ competitor citations`);
    console.log(`Check interval: ${CHECK_INTERVAL_MS / 1000}s`);
    console.log(`Output: ${LLM_OUTPUT_DIR}/\n`);
    console.log('Monitor: cat output/vmware-llm-analysis/status.txt\n');

    await this.initialize();

    let consecutiveEmptyChecks = 0;
    const maxEmptyChecks = 30; // Stop after 30 min of no new chunks

    while (consecutiveEmptyChecks < maxEmptyChecks) {
      try {
        // Get list of chunk files
        const files = await fs.readdir(CHUNK_DIR);
        const chunkFiles = files
          .filter(f => f.startsWith('chunk-') && f.endsWith('.json'))
          .sort();

        // Find unprocessed chunks
        const newChunks = chunkFiles.filter(f => !this.processedChunks.has(f));

        if (newChunks.length === 0) {
          consecutiveEmptyChecks++;
          console.log(`[${new Date().toISOString()}] No new chunks. Waiting... (${consecutiveEmptyChecks}/${maxEmptyChecks})`);
        } else {
          consecutiveEmptyChecks = 0;

          for (const chunkFile of newChunks) {
            console.log(`\n[${new Date().toISOString()}] Processing ${chunkFile}...`);

            const processed = await this.processChunk(chunkFile);

            // Mark chunk as processed
            this.processedChunks.add(chunkFile);
            await fs.appendFile(
              path.join(LLM_OUTPUT_DIR, 'processed-chunks.txt'),
              chunkFile + '\n'
            );

            if (processed > 0) {
              console.log(`  Completed: ${processed} patents analyzed`);
            } else {
              console.log(`  No high-potential patents in this chunk`);
            }
          }
        }

        await this.updateStatus();

        // Check if citation job is still running
        const citationStatus = await fs.readFile(path.join(CHUNK_DIR, 'status.txt'), 'utf-8').catch(() => '');
        if (citationStatus.includes('COMPLETE')) {
          console.log('\nCitation analysis complete. Processing any remaining chunks...');
          // Process any final chunks then exit
          const finalFiles = (await fs.readdir(CHUNK_DIR))
            .filter(f => f.startsWith('chunk-') && f.endsWith('.json') && !this.processedChunks.has(f));

          for (const chunkFile of finalFiles) {
            await this.processChunk(chunkFile);
            this.processedChunks.add(chunkFile);
          }
          break;
        }

      } catch (error) {
        console.error('Error in main loop:', error);
      }

      await new Promise(r => setTimeout(r, CHECK_INTERVAL_MS));
    }

    // Final summary
    console.log('\n' + '═'.repeat(60));
    console.log('LLM FOLLOWER COMPLETE');
    console.log('═'.repeat(60));
    console.log(`Total patents analyzed: ${this.totalLLMProcessed}`);
    console.log(`Output directory: ${LLM_OUTPUT_DIR}/`);
    console.log('═'.repeat(60) + '\n');

    // Create combined output
    await this.createCombinedOutput();
  }

  async createCombinedOutput(): Promise<void> {
    const files = await fs.readdir(LLM_OUTPUT_DIR);
    const patentFiles = files.filter(f => f.startsWith('patent-') && f.endsWith('.json'));

    const analyses: any[] = [];
    for (const f of patentFiles) {
      try {
        const data = JSON.parse(await fs.readFile(path.join(LLM_OUTPUT_DIR, f), 'utf-8'));
        analyses.push(data);
      } catch (e) {
        // Skip corrupted files
      }
    }

    const timestamp = new Date().toISOString().split('T')[0];
    const combinedFile = path.join(LLM_OUTPUT_DIR, `combined-vmware-llm-${timestamp}.json`);

    await fs.writeFile(combinedFile, JSON.stringify({
      generated_at: new Date().toISOString(),
      total_patents: analyses.length,
      threshold: `${MIN_COMPETITOR_CITATIONS}+ competitor citations`,
      analyses: analyses.sort((a, b) =>
        (b.patent_info?.competitor_citations || 0) - (a.patent_info?.competitor_citations || 0)
      ),
    }, null, 2));

    console.log(`Combined output: ${combinedFile}`);
  }
}

const follower = new VMwareLLMFollower();
follower.run().catch(console.error);
