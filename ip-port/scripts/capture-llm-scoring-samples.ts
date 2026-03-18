/**
 * Capture LLM Scoring Samples
 *
 * Captures the full LLM prompt and response for a small set of patents,
 * documenting the complete scoring pipeline for developer reference.
 *
 * For each patent:
 *   1. Loads patent data from DB
 *   2. Enriches with abstract, LLM summary, and independent claims
 *   3. Resolves template inheritance (portfolio → super-sector → sector)
 *   4. Builds the complete prompt
 *   5. Sends to Claude and captures full input/output
 *   6. Parses scores and writes everything to output files
 *
 * Output: output/llm-scoring-samples/
 *
 * Usage: npx tsx scripts/capture-llm-scoring-samples.ts
 */

import Anthropic from '@anthropic-ai/sdk';
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import {
  getMergedTemplateForSector,
  getMergedTemplateForSubSector,
  calculateCompositeScore,
  type MergedTemplate,
  type ScoringQuestion,
  type MetricScore,
} from '../src/api/services/scoring-template-service.js';
import {
  extractClaimsText,
  getClaimsStats,
} from '../src/api/services/patent-xml-parser-service.js';
import {
  parseScoreResponse,
  DEFAULT_CONTEXT_OPTIONS,
  type PatentForScoring,
  type ContextOptions,
} from '../src/api/services/llm-scoring-service.js';

const prisma = new PrismaClient();
const anthropic = new Anthropic();

const MODEL = 'claude-sonnet-4-20250514';
const OUTPUT_DIR = path.join(process.cwd(), 'output', 'llm-scoring-samples');

// ─── Sample Patents ─────────────────────────────────────────────────────────

interface SamplePatent {
  patentId: string;
  sector: string;
  superSector: string;
  subSectorTemplateId?: string; // if set, uses 4-level template resolution
  label: string; // short label for filenames
}

const SAMPLE_PATENTS: SamplePatent[] = [
  // ─── 5 with sub-sector templates (4-level inheritance) ───
  { patentId: '8959215',  sector: 'computing-runtime',    superSector: 'COMPUTING',    subSectorTemplateId: 'error-detection',  label: 'error-detection' },
  { patentId: '7068110',  sector: 'analog-circuits',      superSector: 'SEMICONDUCTOR', subSectorTemplateId: 'pll-clock',       label: 'pll-clock' },
  { patentId: '7603670',  sector: 'computing-runtime',    superSector: 'COMPUTING',    subSectorTemplateId: 'virtualization',   label: 'virtualization' },
  { patentId: '9444651',  sector: 'network-switching',    superSector: 'NETWORKING',   subSectorTemplateId: 'routing',          label: 'routing' },
  { patentId: '12432811', sector: 'wireless-power-mgmt',  superSector: 'WIRELESS',     subSectorTemplateId: 'wpm-drx-sleep',    label: 'wpm-drx-sleep' },

  // ─── 10 with sector-level templates (3-level inheritance) ───
  { patentId: '11645587', sector: 'ai-ml',                  superSector: 'AI_ML',           label: 'ai-ml' },
  { patentId: '9865983',  sector: 'optics',                 superSector: 'IMAGING',         label: 'optics' },
  { patentId: '7558388',  sector: 'network-secure-compute', superSector: 'SECURITY',        label: 'secure-compute' },
  { patentId: '12341960', sector: 'video-codec',            superSector: 'VIDEO_STREAMING',  label: 'video-codec' },
  { patentId: '12259816', sector: 'computing-systems',      superSector: 'COMPUTING',       label: 'computing-systems' },
  { patentId: '7656428',  sector: 'cameras-sensors',        superSector: 'IMAGING',         label: 'cameras-sensors' },
  { patentId: '7017106',  sector: 'network-error-control',  superSector: 'NETWORKING',      label: 'net-error-ctrl' },
  { patentId: '8387046',  sector: 'computing-os-security',  superSector: 'SECURITY',        label: 'os-security' },
  { patentId: '10567307', sector: 'network-switching',      superSector: 'NETWORKING',      label: 'net-switching' },
  { patentId: '10141891', sector: 'wireless-transmission',  superSector: 'WIRELESS',        label: 'wireless-tx' },
];

// ─── Enrichment (inline, mirrors llm-scoring-service.ts) ────────────────────

function loadAbstract(patentId: string): string | null {
  try {
    const cachePath = path.join(process.cwd(), 'cache/api/patentsview/patent', `${patentId}.json`);
    if (fs.existsSync(cachePath)) {
      const data = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
      return data.patent_abstract || null;
    }
  } catch { /* ignore */ }
  return null;
}

function loadLlmData(patentId: string): { summary?: string; prior_art_problem?: string; technical_solution?: string } | null {
  try {
    const cachePath = path.join(process.cwd(), 'cache/llm-scores', `${patentId}.json`);
    if (fs.existsSync(cachePath)) {
      const data = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
      return {
        summary: data.summary || null,
        prior_art_problem: data.prior_art_problem || null,
        technical_solution: data.technical_solution || null,
      };
    }
  } catch { /* ignore */ }

  try {
    const dbCachePath = path.join(process.cwd(), 'cache/llm-scores-db', `${patentId}.json`);
    if (fs.existsSync(dbCachePath)) {
      const metrics = JSON.parse(fs.readFileSync(dbCachePath, 'utf-8'));
      const summary = metrics.patent_summary?.reasoning;
      const priorArt = metrics.prior_art_problem?.reasoning;
      const techSolution = metrics.technical_solution?.reasoning;
      if (summary || priorArt || techSolution) {
        return { summary: summary || null, prior_art_problem: priorArt || null, technical_solution: techSolution || null };
      }
    }
  } catch { /* ignore */ }

  return null;
}

function loadClaims(patentId: string, options: ContextOptions): string | null {
  if (options.includeClaims === 'none') return null;
  const xmlDir = process.env.USPTO_PATENT_GRANT_XML_DIR || '/Volumes/GLSSD2/data/uspto/export';
  return extractClaimsText(patentId, xmlDir, {
    independentOnly: options.includeClaims === 'independent_only',
    maxClaims: options.maxClaims || 5,
    maxTokens: options.maxClaimTokens || 800,
  });
}

function enrichPatent(patent: PatentForScoring, contextOptions: ContextOptions): PatentForScoring {
  const abstract = contextOptions.includeAbstract ? loadAbstract(patent.patent_id) : null;
  const llmData = contextOptions.includeLlmSummary ? loadLlmData(patent.patent_id) : null;
  const claimsText = loadClaims(patent.patent_id, contextOptions);

  return {
    ...patent,
    abstract: abstract || patent.abstract,
    llm_summary: llmData?.summary || null,
    llm_prior_art_problem: llmData?.prior_art_problem || null,
    llm_technical_solution: llmData?.technical_solution || null,
    claims_text: claimsText || patent.claims_text,
  };
}

// ─── Prompt Builder (mirrors llm-scoring-service.ts:buildScoringPrompt) ─────

function buildScoringPrompt(patent: PatentForScoring, template: MergedTemplate): string {
  const questions = template.questions;
  const scoringGuidance = template.scoringGuidance || [];
  const contextDescription = template.contextDescription || '';

  const numericQuestions = questions.filter(q => q.answerType !== 'text');
  const textQuestions = questions.filter(q => q.answerType === 'text');

  const numericPrompts = numericQuestions.map((q, i) => {
    let prompt = `${i + 1}. **${q.displayName}** (fieldName: "${q.fieldName}")
   Question: ${q.question}`;
    if (q.scale) prompt += `\n   Scale: ${q.scale.min}-${q.scale.max}`;
    if (q.reasoningPrompt) prompt += `\n   Reasoning guidance: ${q.reasoningPrompt}`;
    return prompt;
  }).join('\n\n');

  const textPrompts = textQuestions.map((q, i) => {
    return `${numericQuestions.length + i + 1}. **${q.displayName}** (fieldName: "${q.fieldName}")
   Question: ${q.question}`;
  }).join('\n\n');

  const hasLlmData = patent.llm_summary || patent.llm_prior_art_problem || patent.llm_technical_solution;
  let llmContextSection = '';
  if (hasLlmData) {
    llmContextSection = `
## AI Analysis Summary
${patent.llm_summary ? `**Summary:** ${patent.llm_summary}` : ''}
${patent.llm_prior_art_problem ? `**Problem Addressed:** ${patent.llm_prior_art_problem}` : ''}
${patent.llm_technical_solution ? `**Technical Solution:** ${patent.llm_technical_solution}` : ''}
`;
  }

  let guidanceSection = '';
  if (scoringGuidance.length > 0) {
    guidanceSection = `
## Scoring Guidelines

${scoringGuidance.map(g => `- ${g}`).join('\n')}
`;
  }

  let techContextSection = '';
  if (contextDescription) {
    techContextSection = `
## Technology Context

${contextDescription}
`;
  }

  return `You are a patent analyst evaluating patents for litigation and licensing potential.
${guidanceSection}${techContextSection}
## Patent Information

**Patent ID:** ${patent.patent_id}
**Title:** ${patent.patent_title}
**Sector:** ${patent.super_sector} > ${patent.primary_sector}
**Sub-Sector:** ${patent.primary_sub_sector_name || 'Unassigned'}
${patent.cpc_codes?.length ? `**CPC Codes:** ${patent.cpc_codes.join(', ')}` : ''}

**Abstract:**
${patent.abstract || 'No abstract available.'}
${llmContextSection}
${patent.claims_text ? `\n## Key Claims\n${patent.claims_text}` : ''}

## Scoring Questions

For each numeric question below, provide:
1. A numeric score within the specified scale
2. A brief reasoning explaining your score (2-3 sentences)
3. A confidence level (high/medium/low)

${numericPrompts}
${textQuestions.length > 0 ? `
## Text Questions

For each text question below, provide a concise text response:

${textPrompts}
` : ''}
## Response Format

Respond with a JSON object containing the scores. Use this exact structure:

\`\`\`json
{
  "scores": {
    "${numericQuestions[0]?.fieldName || 'example_field'}": {
      "score": 7,
      "reasoning": "Brief explanation of the score...",
      "confidence": "high"
    }${textQuestions.length > 0 ? `,
    "${textQuestions[0]?.fieldName || 'text_field'}": {
      "text": "Your concise text response...",
      "confidence": "high"
    }` : ''}
  }
}
\`\`\`

Be objective and critical. Follow the scoring guidelines above.`;
}

// ─── Main ───────────────────────────────────────────────────────────────────

interface CaptureResult {
  patentId: string;
  title: string;
  superSector: string;
  sector: string;
  subSector: string | null;
  cpcCodes: string[];
  templateInheritanceChain: string[];
  questionCount: number;
  questionsBreakdown: {
    fromPortfolioDefault: string[];
    fromSuperSector: string[];
    fromSector: string[];
    fromSubSector: string[];
  };
  contextIncluded: {
    abstract: boolean;
    llmSummary: boolean;
    claimsMode: string;
    maxClaims: number;
    maxClaimTokens: number;
    independentClaimsFound: number;
    dependentClaimsFound: number;
    claimsIncludedCount: number;
    claimsTruncated: boolean;
  };
  fullPrompt: string;
  fullResponse: string;
  parsedScores: Record<string, MetricScore>;
  compositeScore: number;
  tokenUsage: { input: number; output: number };
  model: string;
  timestamp: string;
}

async function capturePatent(sample: SamplePatent): Promise<CaptureResult> {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`Processing: ${sample.patentId} (${sample.superSector} > ${sample.sector})`);
  console.log('='.repeat(70));

  // 1. Load patent data from DB
  const dbPatent = await prisma.patent.findUnique({
    where: { patentId: sample.patentId },
    include: { cpcCodes: { select: { cpcCode: true } } },
  });

  if (!dbPatent) {
    throw new Error(`Patent ${sample.patentId} not found in database`);
  }

  const patent: PatentForScoring = {
    patent_id: dbPatent.patentId,
    patent_title: dbPatent.title,
    abstract: dbPatent.abstract,
    primary_sector: sample.sector,
    super_sector: sample.superSector,
    primary_sub_sector_id: dbPatent.primarySubSectorId || undefined,
    primary_sub_sector_name: dbPatent.primarySubSectorName || undefined,
    cpc_codes: dbPatent.cpcCodes.map(c => c.cpcCode),
  };

  console.log(`  Title: ${patent.patent_title}`);
  console.log(`  CPC codes: ${patent.cpc_codes?.length || 0}`);

  // 2. Enrich
  const contextOptions = DEFAULT_CONTEXT_OPTIONS;
  const enriched = enrichPatent(patent, contextOptions);
  console.log(`  Abstract: ${enriched.abstract ? 'yes' : 'no'}`);
  console.log(`  LLM summary: ${enriched.llm_summary ? 'yes' : 'no'}`);
  console.log(`  Claims: ${enriched.claims_text ? 'yes' : 'no'}`);

  // 3. Resolve template (4-level if sub-sector, 3-level otherwise)
  const template = sample.subSectorTemplateId
    ? getMergedTemplateForSubSector(sample.subSectorTemplateId, sample.sector, sample.superSector)
    : getMergedTemplateForSector(sample.sector, sample.superSector);
  console.log(`  Template chain: ${template.inheritanceChain.join(' → ')}`);
  console.log(`  Questions: ${template.questions.length}`);

  // Break down questions by source level
  const questionsBreakdown = {
    fromPortfolioDefault: template.questions.filter(q => q.sourceLevel === 'portfolio').map(q => q.fieldName),
    fromSuperSector: template.questions.filter(q => q.sourceLevel === 'super_sector').map(q => q.fieldName),
    fromSector: template.questions.filter(q => q.sourceLevel === 'sector').map(q => q.fieldName),
    fromSubSector: template.questions.filter(q => q.sourceLevel === 'sub_sector').map(q => q.fieldName),
  };

  console.log(`  From portfolio: ${questionsBreakdown.fromPortfolioDefault.length} questions`);
  console.log(`  From super-sector: ${questionsBreakdown.fromSuperSector.length} questions`);
  console.log(`  From sector: ${questionsBreakdown.fromSector.length} questions`);
  if (questionsBreakdown.fromSubSector.length > 0) {
    console.log(`  From sub-sector: ${questionsBreakdown.fromSubSector.length} questions`);
  }

  // 4. Build prompt
  const fullPrompt = buildScoringPrompt(enriched, template);
  console.log(`  Prompt length: ${fullPrompt.length} chars (~${Math.round(fullPrompt.length / 4)} tokens)`);

  // 5. Send to Claude
  console.log(`  Sending to ${MODEL}...`);
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 4096,
    messages: [{ role: 'user', content: fullPrompt }],
  });

  const responseText = response.content[0].type === 'text' ? response.content[0].text : '';
  console.log(`  Response: ${responseText.length} chars`);
  console.log(`  Tokens: ${response.usage.input_tokens} in / ${response.usage.output_tokens} out`);

  // 6. Parse scores
  const { metrics, compositeScore } = parseScoreResponse(responseText, template.questions);
  console.log(`  Composite score: ${compositeScore}`);

  // Get claims stats
  const xmlDir = process.env.USPTO_PATENT_GRANT_XML_DIR || '/Volumes/GLSSD2/data/uspto/export';
  const claimsStats = getClaimsStats(sample.patentId, xmlDir);
  const maxClaims = contextOptions.maxClaims || 5;
  const independentFound = claimsStats?.independentClaims || 0;
  const dependentFound = claimsStats?.dependentClaims || 0;
  const claimsIncluded = Math.min(independentFound, maxClaims);
  const claimsTruncated = independentFound > maxClaims;

  console.log(`  Claims stats: ${independentFound} independent, ${dependentFound} dependent${claimsTruncated ? ' (TRUNCATED)' : ''}`);

  return {
    patentId: sample.patentId,
    title: patent.patent_title,
    superSector: sample.superSector,
    sector: sample.sector,
    subSector: sample.subSectorTemplateId || patent.primary_sub_sector_name || null,
    cpcCodes: patent.cpc_codes || [],
    templateInheritanceChain: template.inheritanceChain,
    questionCount: template.questions.length,
    questionsBreakdown,
    contextIncluded: {
      abstract: !!enriched.abstract,
      llmSummary: !!enriched.llm_summary,
      claimsMode: contextOptions.includeClaims || 'independent_only',
      maxClaims,
      maxClaimTokens: contextOptions.maxClaimTokens || 800,
      independentClaimsFound: independentFound,
      dependentClaimsFound: dependentFound,
      claimsIncludedCount: claimsIncluded,
      claimsTruncated,
    },
    fullPrompt,
    fullResponse: responseText,
    parsedScores: metrics,
    compositeScore,
    tokenUsage: {
      input: response.usage.input_tokens,
      output: response.usage.output_tokens,
    },
    model: MODEL,
    timestamp: new Date().toISOString(),
  };
}

function generateReadme(results: CaptureResult[]): string {
  return `# LLM Scoring System — Developer Reference

## Overview

This directory contains captured LLM scoring input/output for ${results.length} sample patents.
Each JSON file shows exactly what goes into and comes out of the LLM scoring pipeline.

Generated: ${new Date().toISOString()}

---

## Template Inheritance

Scoring questions are organized in a 4-level hierarchy. Each level can add new questions
or override inherited ones (matched by \`fieldName\`). Weights are re-normalized after merging.

\`\`\`
portfolio-default          (base questions: technical_novelty, claim_breadth, etc.)
  └─ super-sector          (e.g., "wireless" adds spectrum_efficiency, signal_quality)
       └─ sector            (e.g., "wireless-transmission" adds rf_chain_position, nfc_relevance)
            └─ sub-sector   (e.g., "wt-power-amplifier" — CPC-pattern matched, adds PA-specific Qs)
\`\`\`

### How Merging Works

1. Start with all portfolio-default questions
2. Add super-sector questions — if a \`fieldName\` already exists, the super-sector version **replaces** it
   (this is how WIRELESS overrides portfolio-default's \`claim_breadth\` weight from 0.15 to 0.20)
3. Add sector questions (same override logic)
4. Add sub-sector questions (same override logic)
5. **Normalize weights** so all numeric question weights sum to ~1.0

---

## Context Preparation

For each patent, the prompt includes:

| Data Source | Description | Typical Size |
|-------------|-------------|--------------|
| **Title** | Patent title from DB | ~10 words |
| **Abstract** | From PatentsView API cache (\`cache/api/patentsview/patent/{id}.json\`) | ~150 words |
| **AI Summary** | From prior LLM analysis (\`cache/llm-scores/{id}.json\`) — summary, prior art problem, technical solution | ~200 words |
| **Independent Claims** | Extracted from USPTO XML (\`/Volumes/.../US{id}.xml\`) — up to 5 claims, ~800 tokens max | ~300 words |
| **CPC Codes** | Classification codes from DB | ~5 codes |
| **Sector/Super-Sector** | Hierarchical classification | 2 labels |

---

## Question Types

| Type | Count (typical) | Weight | Purpose |
|------|----------------|--------|---------|
| **Scored Numeric** | 7 | > 0 | Core scoring — weighted average becomes composite score |
| **Info-Capture Numeric** | 4 | 0 | Captures structured data (product mapping, detectability, licensing, tech components) without affecting score |
| **Text** | 3 | 0 | Captures text responses (patent summary, prior art problem, technical solution) |

The 4 info-capture numeric questions (weight=0) were recently added to the portfolio-default template:
- \`product_mapping_probability\` — likelihood claims read on commercial products
- \`evidence_of_use_detectability\` — can infringement be detected externally?
- \`licensing_revenue_potential\` — commercial significance for licensing
- \`tech_component_classification\` — maps to technology building blocks

---

## Composite Score Calculation

\`\`\`
compositeScore = (sum of (normalizedScore_i * weight_i)) / (sum of weight_i) * 100
\`\`\`

Where:
- Only **numeric** questions with **weight > 0** contribute
- \`normalizedScore\` = (score - scale.min) / (scale.max - scale.min)
- Result is on a **0–100 scale**

---

## Response Format

The LLM returns a JSON block with per-field entries:

\`\`\`json
{
  "scores": {
    "technical_novelty": {
      "score": 7,
      "reasoning": "2-3 sentence explanation...",
      "confidence": "high"
    },
    "patent_summary": {
      "text": "Concise summary...",
      "confidence": "high"
    }
  }
}
\`\`\`

---

## Claims Context Analysis

The current claims preparation approach takes up to 5 independent claims, capped at ~800 tokens.
This works well for simple patents but has limitations with complex ones:

| Limitation | Impact | Patents Affected |
|-----------|--------|-----------------|
| Max 5 independent claims | Loses scope for patents with 6-7 independent claims | ${results.filter(r => r.contextIncluded.independentClaimsFound > 5).map(r => r.patentId).join(', ') || 'None in sample'} |
| No dependent claims | Misses specific implementation details that help scoring | All patents |
| No summarization | Raw claim text is token-heavy, reduces context budget | All patents |

### Claims Diversity in Samples

${results.map(r => `- **${r.patentId}** (${r.sector}): ${r.contextIncluded.independentClaimsFound} independent, ${r.contextIncluded.dependentClaimsFound} dependent claims${r.contextIncluded.claimsTruncated ? ' **[TRUNCATED]**' : ''}`).join('\n')}

### Future Enhancement: Pre-Scoring Claims Summarization

For patents with complex claims (4+ independent, 20+ total), a separate LLM call could produce
a structured claims summary — one-line scope per independent claim, grouped dependent claims
showing implementation variants, and key limitations highlighted. This would provide more
consistent context across patents with varying claim complexity.

---

## Files in This Directory

${results.map(r => `- **sample-${r.patentId}-${r.sector}.json** — ${r.superSector} > ${r.sector} (score: ${r.compositeScore})`).join('\n')}
- **summary.md** — Human-readable comparison of all ${results.length} samples
- **README.md** — This file
`;
}

function generateSummary(results: CaptureResult[]): string {
  let md = `# LLM Scoring Samples — Summary\n\nGenerated: ${new Date().toISOString()}\n\n`;

  md += `## Overview\n\n`;
  md += `| Patent | Super-Sector | Sector | Sub-Sector | Score | Questions | IndCl | DepCl | Tokens (in/out) |\n`;
  md += `|--------|-------------|--------|------------|-------|-----------|-------|-------|------------------|\n`;
  for (const r of results) {
    const trunc = r.contextIncluded.claimsTruncated ? '*' : '';
    md += `| ${r.patentId} | ${r.superSector} | ${r.sector} | ${r.subSector || '—'} | ${r.compositeScore} | ${r.questionCount} | ${r.contextIncluded.independentClaimsFound}${trunc} | ${r.contextIncluded.dependentClaimsFound} | ${r.tokenUsage.input} / ${r.tokenUsage.output} |\n`;
  }
  md += `\n*\\* = claims truncated (more independent claims than maxClaims limit)*\n`;

  md += `\n---\n\n`;

  for (const r of results) {
    md += `## ${r.patentId} — ${r.title}\n\n`;
    md += `**Super-Sector:** ${r.superSector}  \n`;
    md += `**Sector:** ${r.sector}  \n`;
    md += `**Sub-Sector:** ${r.subSector || 'None'}  \n`;
    md += `**Template Chain:** ${r.templateInheritanceChain.join(' → ')}  \n`;
    md += `**Composite Score:** ${r.compositeScore}  \n\n`;

    md += `### Template Inheritance Breakdown\n\n`;
    md += `| Source Level | Questions |\n`;
    md += `|-------------|----------|\n`;
    md += `| Portfolio Default | ${r.questionsBreakdown.fromPortfolioDefault.join(', ') || '—'} |\n`;
    md += `| Super-Sector | ${r.questionsBreakdown.fromSuperSector.join(', ') || '—'} |\n`;
    md += `| Sector | ${r.questionsBreakdown.fromSector.join(', ') || '—'} |\n`;
    md += `| Sub-Sector | ${r.questionsBreakdown.fromSubSector.join(', ') || '—'} |\n\n`;

    md += `### Context Included\n\n`;
    md += `- Abstract: ${r.contextIncluded.abstract ? 'Yes' : 'No'}\n`;
    md += `- LLM Summary: ${r.contextIncluded.llmSummary ? 'Yes' : 'No'}\n`;
    md += `- Claims: ${r.contextIncluded.claimsMode} (${r.contextIncluded.independentClaimsFound} independent, ${r.contextIncluded.dependentClaimsFound} dependent found; ${r.contextIncluded.claimsIncludedCount} included, max ${r.contextIncluded.maxClaims})${r.contextIncluded.claimsTruncated ? ' **TRUNCATED**' : ''}\n\n`;

    md += `### Scores\n\n`;
    md += `| Field | Score | Confidence | Reasoning |\n`;
    md += `|-------|-------|------------|----------|\n`;
    for (const [fieldName, metric] of Object.entries(r.parsedScores)) {
      const conf = metric.confidence === 1.0 ? 'high' : metric.confidence === 0.7 ? 'medium' : 'low';
      const reasoning = metric.reasoning.length > 120 ? metric.reasoning.substring(0, 120) + '...' : metric.reasoning;
      md += `| ${fieldName} | ${metric.score} | ${conf} | ${reasoning.replace(/\|/g, '\\|').replace(/\n/g, ' ')} |\n`;
    }

    md += `\n---\n\n`;
  }

  // Claims analysis section
  md += `## Claims Context Analysis\n\n`;
  const withClaims = results.filter(r => r.contextIncluded.independentClaimsFound > 0);
  const truncated = results.filter(r => r.contextIncluded.claimsTruncated);
  const complexClaims = results.filter(r => r.contextIncluded.independentClaimsFound >= 4);
  md += `- Patents with claims loaded: ${withClaims.length}/${results.length}\n`;
  md += `- Patents with claims truncated: ${truncated.length} (${truncated.map(r => r.patentId).join(', ') || 'none'})\n`;
  md += `- Patents with complex claims (4+ independent): ${complexClaims.length} (${complexClaims.map(r => `${r.patentId}:${r.contextIncluded.independentClaimsFound}`).join(', ') || 'none'})\n`;
  md += `- Dependent claims never included (current approach uses independent_only)\n\n`;

  const superSectors = Array.from(new Set(results.map(r => r.superSector)));
  const sectors = Array.from(new Set(results.map(r => r.sector)));
  const subSectors = results.filter(r => r.subSector).map(r => r.subSector!);
  md += `## Coverage Summary\n\n`;
  md += `- **Super-sectors:** ${superSectors.length} (${superSectors.join(', ')})\n`;
  md += `- **Sectors:** ${sectors.length} distinct sector templates\n`;
  md += `- **Sub-sectors:** ${subSectors.length} (${subSectors.join(', ') || 'none'})\n`;
  md += `- **Independent claims range:** ${Math.min(...results.map(r => r.contextIncluded.independentClaimsFound))} to ${Math.max(...results.map(r => r.contextIncluded.independentClaimsFound))}\n\n`;

  md += `---\n\n`;

  const totalTokensIn = results.reduce((s, r) => s + r.tokenUsage.input, 0);
  const totalTokensOut = results.reduce((s, r) => s + r.tokenUsage.output, 0);
  md += `## Token Usage Summary\n\n`;
  md += `- Total input tokens: ${totalTokensIn}\n`;
  md += `- Total output tokens: ${totalTokensOut}\n`;
  md += `- Total tokens: ${totalTokensIn + totalTokensOut}\n`;
  md += `- Estimated cost: ~$${((totalTokensIn * 3 + totalTokensOut * 15) / 1_000_000).toFixed(4)}\n`;

  return md;
}

async function main() {
  console.log('LLM Scoring Sample Capture');
  console.log(`Model: ${MODEL}`);
  console.log(`Patents: ${SAMPLE_PATENTS.map(p => p.patentId).join(', ')}`);
  console.log(`Output: ${OUTPUT_DIR}\n`);

  // Ensure output directory exists
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const results: CaptureResult[] = [];

  for (const sample of SAMPLE_PATENTS) {
    try {
      const result = await capturePatent(sample);
      results.push(result);

      // Write individual capture file
      const baseFilename = `sample-${sample.patentId}-${sample.label}`;
      fs.writeFileSync(
        path.join(OUTPUT_DIR, `${baseFilename}.json`),
        JSON.stringify(result, null, 2)
      );
      // Write human-readable prompt and response text files
      fs.writeFileSync(
        path.join(OUTPUT_DIR, `${baseFilename}.prompt.txt`),
        result.fullPrompt
      );
      fs.writeFileSync(
        path.join(OUTPUT_DIR, `${baseFilename}.response.txt`),
        result.fullResponse
      );
      console.log(`  Wrote: ${baseFilename}.json, .prompt.txt, .response.txt`);
    } catch (error) {
      console.error(`\nERROR processing ${sample.patentId}:`, error);
    }

    // Small delay between API calls
    await new Promise(r => setTimeout(r, 1000));
  }

  // Write README
  fs.writeFileSync(path.join(OUTPUT_DIR, 'README.md'), generateReadme(results));
  console.log('\nWrote: README.md');

  // Write summary
  fs.writeFileSync(path.join(OUTPUT_DIR, 'summary.md'), generateSummary(results));
  console.log('Wrote: summary.md');

  // Final report
  console.log(`\n${'='.repeat(70)}`);
  console.log(`Done! ${results.length}/${SAMPLE_PATENTS.length} patents captured.`);
  console.log(`Output directory: ${OUTPUT_DIR}`);
  for (const r of results) {
    console.log(`  ${r.patentId}: composite=${r.compositeScore}, questions=${r.questionCount}, tokens=${r.tokenUsage.input + r.tokenUsage.output}`);
  }
  console.log('='.repeat(70));

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('Fatal error:', err);
  await prisma.$disconnect();
  process.exit(1);
});
