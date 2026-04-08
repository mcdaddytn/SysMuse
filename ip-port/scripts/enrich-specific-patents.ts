/**
 * Targeted LLM enrichment for specific patent IDs.
 * Produces cache/llm-scores/{patentId}.json files compatible with loadEnrichedPatents().
 *
 * Usage: npx tsx scripts/enrich-specific-patents.ts
 */

import * as dotenv from 'dotenv';
dotenv.config();

import Anthropic from '@anthropic-ai/sdk';
import * as fs from 'fs';
import * as path from 'path';

const anthropic = new Anthropic();
const LLM_CACHE = path.resolve('./cache/llm-scores');
const PATENT_CACHE = path.resolve('./cache/api/patentsview/patent');
const CANDIDATES_PATH = path.resolve('./output/streaming-candidates-2026-01-25.json');

// ── Patents needing enrichment (85 total) ───────────────────────────────────

const PATENTS_TO_ENRICH = [
  // network-multiplexing (30)
  '7057465','7123063','7659782','6714056','9143308','7948325','9680621','7724096',
  '8139659','8896384','7088962','8143960','8174451','6549599','6985044','7082295',
  '9065464','7772930','9219625','8873682','7239212','8884704','6806787','7570122',
  '6647538','7884675','8320443','9729285','7906992','7826547',
  // wireless-power-mgmt (29)
  '7199670','7729670','9326254','9288736','8280324','8233849','9287901','7116259',
  '7482964','6115770','7928874','9143994','8937606','8611888','8064873','7499680',
  '7778352','6321309','8902796','7253763','8861413','8958821','7961812','8018361',
  '7817072','8055207','7956689','9641308','9106274',
  // wireless-infrastructure (26)
  '8831935','8193986','8472891','8670737','8879576','9288027','9713016','9648503',
  '9183271','8175108','9060382','7009542','8385188','9338669','8958831','7317410',
  '9445426','9618600','8626100','9503214','8837362','7111199','9198188','9414407',
  '9337986','8675592',
];

// ── Load patent data ────────────────────────────────────────────────────────

interface PatentData {
  patent_id: string;
  title: string;
  abstract: string;
}

function loadPatentData(patentId: string, candidatesMap: Map<string, any>): PatentData | null {
  // Try PatentsView cache first
  const cachePath = path.join(PATENT_CACHE, `${patentId}.json`);
  if (fs.existsSync(cachePath)) {
    try {
      const data = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
      return {
        patent_id: patentId,
        title: data.patent_title || data.title || '',
        abstract: data.patent_abstract || data.abstract || '',
      };
    } catch { /* fall through */ }
  }

  // Try candidates file
  const candidate = candidatesMap.get(patentId);
  if (candidate) {
    return {
      patent_id: patentId,
      title: candidate.patent_title || candidate.title || '',
      abstract: candidate.patent_abstract || candidate.abstract || '',
    };
  }

  return null;
}

// ── LLM prompt ──────────────────────────────────────────────────────────────

const ASSESSMENT_PROMPT = `You are a patent analyst. Analyze this patent and provide a structured assessment.

## Patent Information

**Patent ID:** {patent_id}
**Title:** {title}

**Abstract:**
{abstract}

## Required Assessment

Provide a JSON object with ALL of the following fields. Use the exact field names shown.

### Text fields (concise, 2-3 sentences each):
- "summary": Plain-language summary of what the patent covers
- "prior_art_problem": What problem in the prior art does this patent address?
- "technical_solution": What is the core technical approach/solution?

### Numeric scores (integer 1-5, where 5 = strongest):
- "eligibility_score": Patent eligibility under Alice/Mayo (5 = clearly eligible, 1 = abstract idea)
- "validity_score": Likely validity considering prior art (5 = very strong, 1 = likely invalid)
- "claim_breadth": How broadly do the claims cover the technology? (5 = very broad, 1 = very narrow)
- "claim_clarity_score": How clear and well-defined are the claims? (5 = very clear)
- "enforcement_clarity": How easy to detect infringement? (5 = easily detected)
- "design_around_difficulty": How hard to design around? (5 = very difficult)
- "evidence_accessibility_score": How accessible is infringement evidence? (5 = publicly visible)
- "market_relevance_score": Current market relevance (5 = highly relevant)
- "trend_alignment_score": Alignment with technology trends (5 = strongly aligned)
- "investigation_priority_score": Priority for enforcement investigation (5 = investigate first)
- "confidence": Overall confidence in this assessment (5 = very confident)

### Categorical fields:
- "technology_category": One of: "networking", "security", "cloud computing", "wireless", "semiconductor", "video/audio", "storage", "IoT", "AI/ML", "other"
- "product_types": Array of 2-4 product types that likely implement this technology
- "likely_implementers": Array of 2-4 types of companies likely implementing this
- "detection_method": One of: "network_analysis", "reverse_engineering", "technical_analysis", "standards_compliance", "public_documentation"
- "implementation_type": One of: "hardware", "software", "hybrid", "process"
- "standards_relevance": One of: "essential", "related", "none"
- "standards_bodies": Array of relevant standards bodies (empty if none)
- "market_segment": One of: "enterprise", "consumer", "industrial", "telecom", "automotive"
- "implementation_complexity": One of: "simple", "moderate", "complex"
- "claim_type_primary": One of: "method", "system", "apparatus", "composition"
- "geographic_scope": One of: "global", "regional", "domestic"
- "lifecycle_stage": One of: "emerging", "growth", "mature", "declining"

Respond with ONLY the JSON object, no markdown fences or explanation.`;

function buildPrompt(patent: PatentData): string {
  return ASSESSMENT_PROMPT
    .replace('{patent_id}', patent.patent_id)
    .replace('{title}', patent.title)
    .replace('{abstract}', patent.abstract || 'No abstract available.');
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('     TARGETED LLM ENRICHMENT');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Patents to enrich: ${PATENTS_TO_ENRICH.length}`);

  // Filter out already-enriched patents
  const needed = PATENTS_TO_ENRICH.filter(id => !fs.existsSync(path.join(LLM_CACHE, `${id}.json`)));
  console.log(`  Already cached: ${PATENTS_TO_ENRICH.length - needed.length}`);
  console.log(`  Need enrichment: ${needed.length}`);

  if (needed.length === 0) {
    console.log('\n  All patents already enriched. Nothing to do.');
    return;
  }

  // Load candidates map for patent data lookup
  let candidatesMap = new Map<string, any>();
  if (fs.existsSync(CANDIDATES_PATH)) {
    const candidates = JSON.parse(fs.readFileSync(CANDIDATES_PATH, 'utf-8'));
    const arr = Array.isArray(candidates) ? candidates : candidates.patents || [];
    for (const c of arr) {
      candidatesMap.set(c.patent_id || c.patentId, c);
    }
    console.log(`  Loaded ${candidatesMap.size} candidates for data lookup`);
  }

  // Ensure cache dir exists
  if (!fs.existsSync(LLM_CACHE)) fs.mkdirSync(LLM_CACHE, { recursive: true });

  // Process with concurrency
  const CONCURRENCY = 5;
  const MODEL = 'claude-sonnet-4-20250514';
  let completed = 0;
  let errors = 0;
  const startTime = Date.now();

  async function processPatent(patentId: string): Promise<void> {
    const patent = loadPatentData(patentId, candidatesMap);
    if (!patent || (!patent.title && !patent.abstract)) {
      console.log(`  [SKIP] ${patentId} - no data available`);
      errors++;
      return;
    }

    const prompt = buildPrompt(patent);

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await anthropic.messages.create({
          model: MODEL,
          max_tokens: 2048,
          messages: [{ role: 'user', content: prompt }],
        });

        const text = response.content[0].type === 'text' ? response.content[0].text : '';

        // Parse JSON - handle with or without markdown fences
        let jsonText = text;
        const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
        if (fenceMatch) jsonText = fenceMatch[1];

        const assessment = JSON.parse(jsonText.trim());

        // Add metadata
        assessment.patent_id = patentId;
        assessment.source = 'targeted-enrichment-2026-04-06';
        assessment.imported_at = new Date().toISOString();

        // Save to cache
        fs.writeFileSync(
          path.join(LLM_CACHE, `${patentId}.json`),
          JSON.stringify(assessment, null, 2)
        );

        completed++;
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
        const rate = (completed / (Date.now() - startTime) * 1000 * 60).toFixed(1);
        const eta = ((needed.length - completed - errors) / (completed / ((Date.now() - startTime) / 1000 / 60))).toFixed(1);
        process.stdout.write(`\r  Enriched: ${completed}/${needed.length} | Errors: ${errors} | ${rate}/min | ${elapsed}s elapsed | ETA: ${eta}m   `);
        return;
      } catch (err: any) {
        if (attempt < 2 && (err.status === 429 || err.status === 529)) {
          const delay = (attempt + 1) * 5000;
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        console.log(`\n  [ERROR] ${patentId}: ${err.message?.slice(0, 80)}`);
        errors++;
        return;
      }
    }
  }

  // Process in batches with concurrency
  for (let i = 0; i < needed.length; i += CONCURRENCY) {
    const batch = needed.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(processPatent));
  }

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n\n═══════════════════════════════════════════════════════════════`);
  console.log(`  ENRICHMENT COMPLETE`);
  console.log(`  Enriched: ${completed} | Errors: ${errors} | Time: ${totalTime}s`);
  console.log(`═══════════════════════════════════════════════════════════════`);
}

main();
