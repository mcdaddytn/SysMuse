/**
 * Seed Tournament Prompt Templates
 *
 * Creates reusable prompt templates for multi-round tournament workflows:
 * 1. Cluster Evaluation — evaluates and ranks patents within a cluster
 * 2. Round Synthesis — aggregates and re-ranks results from previous round
 * 3. Final Synthesis — produces the final tournament summary
 *
 * Usage: npx tsx scripts/seed-tournament-templates.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding tournament prompt templates...\n');

  // ─────────────────────────────────────────────────────────────────────────
  // Template 1: Cluster Evaluation (Round 1)
  // Used for evaluating patent_group targets. Receives patent data via
  // <<focusArea.patentData>> and produces per-patent rankings.
  // ─────────────────────────────────────────────────────────────────────────

  const clusterEval = await prisma.promptTemplate.upsert({
    where: { id: 'tmpl_tournament_cluster_eval' },
    update: {
      name: 'Tournament Cluster Evaluation',
      description: 'Evaluates and ranks patents within a tournament cluster. Produces per-patent scores for relevance, claim strength, and licensing potential.',
      templateType: 'FREE_FORM',
      objectType: 'patent',
      executionMode: 'COLLECTIVE',
      promptText: `You are evaluating a cluster of patents in a tournament-style analysis.

Analyze each patent in the following group and evaluate it for:
1. Technology Relevance (1-5): How relevant is this patent to modern technology applications?
2. Claim Strength (1-5): How strong and enforceable are the patent claims?
3. Licensing Potential (1-5): How valuable is this patent for licensing?
4. Overall Score (1-5): Weighted average considering all factors.

Patents in this cluster:
<<focusArea.patentData>>

Return valid JSON with this exact structure:
{
  "cluster_summary": "Brief 1-2 sentence summary of the technology themes in this cluster",
  "patent_count": <number>,
  "rankings": [
    {
      "patent_id": "<id>",
      "patent_title": "<title>",
      "technology_relevance": <1-5>,
      "claim_strength": <1-5>,
      "licensing_potential": <1-5>,
      "overall_score": <1-5>,
      "brief_rationale": "<1-2 sentences>"
    }
  ],
  "top_themes": ["<theme1>", "<theme2>"],
  "cluster_quality": <1-5 average quality of patents in this cluster>
}

Sort rankings by overall_score descending. Include ALL patents from the input.`,
      contextFields: ['patent_id', 'patent_title', 'abstract', 'cpc_codes', 'forward_citations', 'remaining_years', 'assignee'],
      llmModel: 'claude-sonnet-4-20250514',
      delimiterStart: '<<',
      delimiterEnd: '>>',
      status: 'DRAFT',
    },
    create: {
      id: 'tmpl_tournament_cluster_eval',
      name: 'Tournament Cluster Evaluation',
      description: 'Evaluates and ranks patents within a tournament cluster. Produces per-patent scores for relevance, claim strength, and licensing potential.',
      templateType: 'FREE_FORM',
      objectType: 'patent',
      executionMode: 'COLLECTIVE',
      promptText: `You are evaluating a cluster of patents in a tournament-style analysis.

Analyze each patent in the following group and evaluate it for:
1. Technology Relevance (1-5): How relevant is this patent to modern technology applications?
2. Claim Strength (1-5): How strong and enforceable are the patent claims?
3. Licensing Potential (1-5): How valuable is this patent for licensing?
4. Overall Score (1-5): Weighted average considering all factors.

Patents in this cluster:
<<focusArea.patentData>>

Return valid JSON with this exact structure:
{
  "cluster_summary": "Brief 1-2 sentence summary of the technology themes in this cluster",
  "patent_count": <number>,
  "rankings": [
    {
      "patent_id": "<id>",
      "patent_title": "<title>",
      "technology_relevance": <1-5>,
      "claim_strength": <1-5>,
      "licensing_potential": <1-5>,
      "overall_score": <1-5>,
      "brief_rationale": "<1-2 sentences>"
    }
  ],
  "top_themes": ["<theme1>", "<theme2>"],
  "cluster_quality": <1-5 average quality of patents in this cluster>
}

Sort rankings by overall_score descending. Include ALL patents from the input.`,
      contextFields: ['patent_id', 'patent_title', 'abstract', 'cpc_codes', 'forward_citations', 'remaining_years', 'assignee'],
      llmModel: 'claude-sonnet-4-20250514',
      delimiterStart: '<<',
      delimiterEnd: '>>',
      status: 'DRAFT',
    },
  });

  console.log(`  Created: ${clusterEval.name} (${clusterEval.id})`);

  // ─────────────────────────────────────────────────────────────────────────
  // Template 2: Round Synthesis (Rounds 2+)
  // Used for summary_group targets. Receives upstream results via
  // <<upstream.data>> and re-ranks across clusters.
  // ─────────────────────────────────────────────────────────────────────────

  const roundSynthesis = await prisma.promptTemplate.upsert({
    where: { id: 'tmpl_tournament_round_synthesis' },
    update: {
      name: 'Tournament Round Synthesis',
      description: 'Synthesizes results from previous tournament round. Re-ranks patents across clusters and selects top candidates for advancement.',
      templateType: 'FREE_FORM',
      objectType: 'patent',
      executionMode: 'COLLECTIVE',
      promptText: `You are synthesizing results from a previous round of tournament-style patent analysis.

You are receiving results from <<upstream.count>> previous evaluation clusters. Each cluster contains ranked patents with scores.

Previous round results:
<<upstream.data>>

Your task:
1. Review all patent rankings from the previous round clusters
2. Identify the top patents across ALL clusters based on their overall scores and rationale
3. Re-rank them in a unified list
4. Identify emerging themes and the strongest patent candidates

Return valid JSON:
{
  "round_summary": "Summary of findings across all clusters from the previous round",
  "total_patents_reviewed": <number>,
  "unified_rankings": [
    {
      "patent_id": "<id>",
      "patent_title": "<title>",
      "original_cluster_score": <1-5>,
      "cross_cluster_score": <1-5 re-evaluated in broader context>,
      "advancement_rationale": "<why this patent stands out across clusters>"
    }
  ],
  "top_themes": ["<theme1>", "<theme2>", "<theme3>"],
  "cluster_quality_comparison": "Brief comparison of which clusters had stronger patents",
  "round_quality": <1-5 overall quality of the advancing patents>
}

Sort unified_rankings by cross_cluster_score descending. Include the top 50% of patents.`,
      contextFields: [],
      llmModel: 'claude-sonnet-4-20250514',
      delimiterStart: '<<',
      delimiterEnd: '>>',
      status: 'DRAFT',
    },
    create: {
      id: 'tmpl_tournament_round_synthesis',
      name: 'Tournament Round Synthesis',
      description: 'Synthesizes results from previous tournament round. Re-ranks patents across clusters and selects top candidates for advancement.',
      templateType: 'FREE_FORM',
      objectType: 'patent',
      executionMode: 'COLLECTIVE',
      promptText: `You are synthesizing results from a previous round of tournament-style patent analysis.

You are receiving results from <<upstream.count>> previous evaluation clusters. Each cluster contains ranked patents with scores.

Previous round results:
<<upstream.data>>

Your task:
1. Review all patent rankings from the previous round clusters
2. Identify the top patents across ALL clusters based on their overall scores and rationale
3. Re-rank them in a unified list
4. Identify emerging themes and the strongest patent candidates

Return valid JSON:
{
  "round_summary": "Summary of findings across all clusters from the previous round",
  "total_patents_reviewed": <number>,
  "unified_rankings": [
    {
      "patent_id": "<id>",
      "patent_title": "<title>",
      "original_cluster_score": <1-5>,
      "cross_cluster_score": <1-5 re-evaluated in broader context>,
      "advancement_rationale": "<why this patent stands out across clusters>"
    }
  ],
  "top_themes": ["<theme1>", "<theme2>", "<theme3>"],
  "cluster_quality_comparison": "Brief comparison of which clusters had stronger patents",
  "round_quality": <1-5 overall quality of the advancing patents>
}

Sort unified_rankings by cross_cluster_score descending. Include the top 50% of patents.`,
      contextFields: [],
      llmModel: 'claude-sonnet-4-20250514',
      delimiterStart: '<<',
      delimiterEnd: '>>',
      status: 'DRAFT',
    },
  });

  console.log(`  Created: ${roundSynthesis.name} (${roundSynthesis.id})`);

  // ─────────────────────────────────────────────────────────────────────────
  // Template 3: Final Tournament Summary
  // Used as the optional synthesis job at the end of a tournament.
  // ─────────────────────────────────────────────────────────────────────────

  const finalSynthesis = await prisma.promptTemplate.upsert({
    where: { id: 'tmpl_tournament_final_synthesis' },
    update: {
      name: 'Tournament Final Synthesis',
      description: 'Final tournament synthesis — produces the definitive ranking and strategic summary from the last tournament round.',
      templateType: 'FREE_FORM',
      objectType: 'patent',
      executionMode: 'COLLECTIVE',
      promptText: `You are producing the final synthesis of a multi-round tournament-style patent analysis.

Through multiple rounds of evaluation, patents have been progressively filtered and re-ranked. You are receiving the final round results.

Final round results:
<<upstream.data>>

Produce a comprehensive final report:

1. DEFINITIVE TOP PATENTS: The absolute best patents from the entire tournament
2. STRATEGIC THEMES: Major technology themes that emerged
3. PORTFOLIO INSIGHTS: Strategic observations about the patent collection
4. LICENSING RECOMMENDATIONS: Which patents are most promising for licensing

Return valid JSON:
{
  "tournament_summary": "Executive summary of the entire tournament analysis",
  "definitive_rankings": [
    {
      "rank": <1-N>,
      "patent_id": "<id>",
      "patent_title": "<title>",
      "final_score": <1-10>,
      "key_strength": "<primary value proposition>",
      "licensing_recommendation": "<specific licensing strategy>"
    }
  ],
  "strategic_themes": [
    {
      "theme": "<technology theme>",
      "patent_ids": ["<id1>", "<id2>"],
      "market_relevance": "<why this theme matters>"
    }
  ],
  "portfolio_insights": [
    "<insight 1>",
    "<insight 2>",
    "<insight 3>"
  ],
  "overall_portfolio_strength": <1-10>,
  "top_licensing_targets": ["<patent_id1>", "<patent_id2>", "<patent_id3>"]
}`,
      contextFields: [],
      llmModel: 'claude-sonnet-4-20250514',
      delimiterStart: '<<',
      delimiterEnd: '>>',
      status: 'DRAFT',
    },
    create: {
      id: 'tmpl_tournament_final_synthesis',
      name: 'Tournament Final Synthesis',
      description: 'Final tournament synthesis — produces the definitive ranking and strategic summary from the last tournament round.',
      templateType: 'FREE_FORM',
      objectType: 'patent',
      executionMode: 'COLLECTIVE',
      promptText: `You are producing the final synthesis of a multi-round tournament-style patent analysis.

Through multiple rounds of evaluation, patents have been progressively filtered and re-ranked. You are receiving the final round results.

Final round results:
<<upstream.data>>

Produce a comprehensive final report:

1. DEFINITIVE TOP PATENTS: The absolute best patents from the entire tournament
2. STRATEGIC THEMES: Major technology themes that emerged
3. PORTFOLIO INSIGHTS: Strategic observations about the patent collection
4. LICENSING RECOMMENDATIONS: Which patents are most promising for licensing

Return valid JSON:
{
  "tournament_summary": "Executive summary of the entire tournament analysis",
  "definitive_rankings": [
    {
      "rank": <1-N>,
      "patent_id": "<id>",
      "patent_title": "<title>",
      "final_score": <1-10>,
      "key_strength": "<primary value proposition>",
      "licensing_recommendation": "<specific licensing strategy>"
    }
  ],
  "strategic_themes": [
    {
      "theme": "<technology theme>",
      "patent_ids": ["<id1>", "<id2>"],
      "market_relevance": "<why this theme matters>"
    }
  ],
  "portfolio_insights": [
    "<insight 1>",
    "<insight 2>",
    "<insight 3>"
  ],
  "overall_portfolio_strength": <1-10>,
  "top_licensing_targets": ["<patent_id1>", "<patent_id2>", "<patent_id3>"]
}`,
      contextFields: [],
      llmModel: 'claude-sonnet-4-20250514',
      delimiterStart: '<<',
      delimiterEnd: '>>',
      status: 'DRAFT',
    },
  });

  console.log(`  Created: ${finalSynthesis.name} (${finalSynthesis.id})`);

  // Summary
  const total = await prisma.promptTemplate.count();
  console.log(`\n=== Summary ===`);
  console.log(`Total prompt templates: ${total}`);
  console.log(`Tournament templates: 3`);
  console.log(`  - Cluster Evaluation:  ${clusterEval.id}`);
  console.log(`  - Round Synthesis:     ${roundSynthesis.id}`);
  console.log(`  - Final Synthesis:     ${finalSynthesis.id}`);
}

main()
  .then(() => {
    console.log('\nDone.');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Error seeding tournament templates:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
