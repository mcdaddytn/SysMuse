/**
 * Rerun Final Synthesis for an existing tournament
 *
 * Usage: npx tsx scripts/rerun-final-synthesis.ts <tournament-id>
 */

import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import Anthropic from '@anthropic-ai/sdk';

const prisma = new PrismaClient();
const anthropic = new Anthropic();

const OUTPUT_DIR = path.join(process.cwd(), 'output', 'tournaments');

interface StructuredQuestion {
  fieldName: string;
  question: string;
  answerType: 'INTEGER' | 'TEXT' | 'ENUM' | 'TEXT_ARRAY';
  constraints?: {
    min?: number;
    max?: number;
    options?: string[];
  };
}

async function rerunFinalSynthesis(tournamentId: string) {
  const tournamentDir = path.join(OUTPUT_DIR, tournamentId);

  if (!fs.existsSync(tournamentDir)) {
    throw new Error(`Tournament not found: ${tournamentId}`);
  }

  console.log(`[Rerun] Loading tournament ${tournamentId}...`);

  // Load config
  const config = JSON.parse(fs.readFileSync(path.join(tournamentDir, 'config.json'), 'utf-8'));
  const superSector = config.config?.superSector || 'Wireless & RF';

  // Load finalists from the last round summary
  const round3Summary = JSON.parse(
    fs.readFileSync(path.join(tournamentDir, 'round-3', 'round-summary.json'), 'utf-8')
  );
  const finalistIds = round3Summary.advancingPatentIds as string[];

  console.log(`[Rerun] Found ${finalistIds.length} finalists`);

  // Load all round results
  const allRoundResults: Map<string, Record<string, unknown>>[] = [];

  for (let r = 1; r <= 3; r++) {
    const roundDir = path.join(tournamentDir, `round-${r}`);
    const roundMap = new Map<string, Record<string, unknown>>();

    const clusterFiles = fs.readdirSync(roundDir).filter(f => f.startsWith('cluster-') && f.endsWith('.json'));
    for (const file of clusterFiles) {
      const cluster = JSON.parse(fs.readFileSync(path.join(roundDir, file), 'utf-8'));
      for (const pid of cluster.patentIds) {
        const patentResult = cluster.parsedFields?.[pid];
        if (patentResult) {
          roundMap.set(pid, patentResult);
        }
      }
    }
    allRoundResults.push(roundMap);
    console.log(`[Rerun] Loaded ${roundMap.size} results from round ${r}`);
  }

  // Load the updated template
  const template = await prisma.promptTemplate.findUniqueOrThrow({
    where: { id: 'tmpl_pos_v2_final' },
  });

  const questions = template.questions as StructuredQuestion[] || [];

  // Build finalist data - just use patent IDs and round context
  const finalistData: Record<string, unknown>[] = [];
  const uniqueIds = [...new Set(finalistIds)];

  for (const pid of uniqueIds) {
    const patentInfo: Record<string, unknown> = { patent_id: pid };

    // Add context from all rounds
    for (let r = 0; r < allRoundResults.length; r++) {
      const roundResults = allRoundResults[r];
      if (roundResults.has(pid)) {
        const result = roundResults.get(pid)!;
        const prefix = `round${r + 1}_`;
        patentInfo[`${prefix}key_strength`] = result.key_strength || result.key_strength_refined;
        patentInfo[`${prefix}key_weakness`] = result.key_weakness || result.validity_concerns;
        patentInfo[`${prefix}overall_pos_potential`] = result.overall_pos_potential;
        patentInfo[`${prefix}connectivity_rank`] = result.connectivity_rank;
        patentInfo[`${prefix}pos_applicability_rank`] = result.pos_applicability_rank;
      }
    }

    finalistData.push(patentInfo);
  }

  console.log(`[Rerun] Built data for ${finalistData.length} unique finalists`);

  // Build prompt
  let promptText = template.promptText || '';

  // Replace placeholders
  promptText = promptText.replace(/\{\{super_sector\}\}/g, superSector);
  promptText = promptText.replace(/\{\{cluster\.patentData\}\}/g, JSON.stringify(finalistData, null, 2));

  // Build round results summary
  const roundResultsSummary = finalistData.map(p => ({
    patent_id: p.patent_id,
    round1_strength: p.round1_key_strength,
    round2_strength: p.round2_key_strength,
    round3_strength: p.round3_key_strength,
    round3_overall: p.round3_overall_pos_potential,
  }));
  promptText = promptText.replace(/\{\{cluster\.round1Results\}\}/g, JSON.stringify(roundResultsSummary, null, 2));

  // Build question instructions
  const questionInstructions = questions.map((q, i) => {
    let instruction = `${i + 1}. ${q.fieldName}: ${q.question}`;
    if (q.answerType === 'INTEGER' && q.constraints) {
      instruction += ` (Integer ${q.constraints.min}-${q.constraints.max})`;
    } else if (q.answerType === 'ENUM' && q.constraints?.options) {
      instruction += ` (One of: ${q.constraints.options.join(', ')})`;
    } else if (q.answerType === 'TEXT_ARRAY') {
      instruction += ` (Array of strings - use ONLY patent IDs from the data above)`;
    } else if (q.answerType === 'TEXT') {
      instruction += ` (Text)`;
    }
    return instruction;
  }).join('\n');

  const fullPrompt = `${promptText}

Provide your strategic synthesis in JSON format with the following fields:

${questionInstructions}

REMINDER: All patent IDs in your response MUST come from the finalist data above. Valid IDs include: ${uniqueIds.slice(0, 10).join(', ')}... (${uniqueIds.length} total)

Return valid JSON only, no markdown code blocks.`;

  console.log(`[Rerun] Calling LLM (prompt length: ${fullPrompt.length} chars)...`);

  // Call LLM
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 16384,
    system: 'You are an expert patent analyst. Always respond with valid JSON only, no markdown. Use ONLY patent IDs from the provided data.',
    messages: [{ role: 'user', content: fullPrompt }],
  });

  const rawText = response.content[0].type === 'text' ? response.content[0].text : '';
  const tokensUsed = (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0);

  console.log(`[Rerun] LLM response received (${tokensUsed} tokens)`);

  // Parse response
  let parsedFields: Record<string, unknown> = {};
  try {
    parsedFields = JSON.parse(rawText);
  } catch (e) {
    console.error('[Rerun] Failed to parse JSON response');
    console.log('Raw response:', rawText.substring(0, 500));
  }

  // Save new final synthesis
  const newSynthesis = {
    templateId: 'tmpl_pos_v2_final',
    finalistCount: uniqueIds.length,
    finalistIds: uniqueIds,
    llmResponse: parsedFields,
    parsedFields,
    rawResponse: rawText,
    tokensUsed,
    executedAt: new Date().toISOString(),
    rerun: true,
  };

  // Backup old synthesis
  const oldSynthesisPath = path.join(tournamentDir, 'final-synthesis.json');
  if (fs.existsSync(oldSynthesisPath)) {
    fs.renameSync(oldSynthesisPath, path.join(tournamentDir, 'final-synthesis.old.json'));
  }

  fs.writeFileSync(
    path.join(tournamentDir, 'final-synthesis.json'),
    JSON.stringify(newSynthesis, null, 2)
  );

  console.log(`[Rerun] New final synthesis saved`);

  // Show results
  console.log('\n=== RESULTS ===');
  console.log(`Tier 1 (${(parsedFields.tier1_patents as string[])?.length || 0}):`, parsedFields.tier1_patents);
  console.log(`Tier 2 (${(parsedFields.tier2_patents as string[])?.length || 0}):`, parsedFields.tier2_patents);
  console.log(`Tier 3 (${(parsedFields.tier3_patents as string[])?.length || 0}):`, parsedFields.tier3_patents);
  console.log(`Dark horse winners:`, parsedFields.dark_horse_winners);

  const total = ((parsedFields.tier1_patents as string[])?.length || 0) +
                ((parsedFields.tier2_patents as string[])?.length || 0) +
                ((parsedFields.tier3_patents as string[])?.length || 0);
  console.log(`\nTotal selected: ${total} patents`);

  return newSynthesis;
}

// Main
const tournamentId = process.argv[2];
if (!tournamentId) {
  console.error('Usage: npx tsx scripts/rerun-final-synthesis.ts <tournament-id>');
  process.exit(1);
}

rerunFinalSynthesis(tournamentId)
  .then(() => {
    console.log('\n[Rerun] Complete!');
    process.exit(0);
  })
  .catch(err => {
    console.error('[Rerun] Error:', err);
    process.exit(1);
  });
