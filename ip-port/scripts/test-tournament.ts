/**
 * Tournament Integration Test
 *
 * Tests the full tournament workflow pipeline:
 * 1. Create workflow scoped to a sector
 * 2. Plan tournament (create DAG of jobs)
 * 3. Execute workflow (run LLM calls)
 * 4. Monitor and report results
 *
 * Usage:
 *   npx tsx scripts/test-tournament.ts              # Plan only (dry run)
 *   npx tsx scripts/test-tournament.ts --execute     # Plan + execute
 *   npx tsx scripts/test-tournament.ts --execute --limit 48  # Limit patent count
 */

import { PrismaClient } from '@prisma/client';
import {
  createWorkflow,
  getWorkflow,
  planTournament,
  executeWorkflow,
  getReadyJobs,
} from '../src/api/services/workflow-engine-service.js';
import type { TournamentConfig } from '../src/api/services/workflow-engine-service.js';

const prisma = new PrismaClient();

const SECTOR = 'video-broadcast';
const CLUSTER_EVAL_TEMPLATE = 'tmpl_tournament_cluster_eval';
const ROUND_SYNTHESIS_TEMPLATE = 'tmpl_tournament_round_synthesis';
const FINAL_SYNTHESIS_TEMPLATE = 'tmpl_tournament_final_synthesis';

async function main() {
  const args = process.argv.slice(2);
  const shouldExecute = args.includes('--execute');
  const limitIdx = args.indexOf('--limit');
  const patentLimit = limitIdx >= 0 ? parseInt(args[limitIdx + 1]) : 0;

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  Tournament Integration Test');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Sector:    ${SECTOR}`);
  console.log(`  Execute:   ${shouldExecute}`);
  console.log(`  Limit:     ${patentLimit || 'none (full sector)'}`);
  console.log('');

  // Verify templates exist
  const templates = await prisma.promptTemplate.findMany({
    where: {
      id: { in: [CLUSTER_EVAL_TEMPLATE, ROUND_SYNTHESIS_TEMPLATE, FINAL_SYNTHESIS_TEMPLATE] },
    },
    select: { id: true, name: true },
  });
  console.log(`Templates found: ${templates.length}/3`);
  for (const t of templates) {
    console.log(`  ✓ ${t.name} (${t.id})`);
  }
  if (templates.length < 3) {
    console.error('Missing templates. Run: npx tsx scripts/seed-tournament-templates.ts');
    process.exit(1);
  }

  // Step 1: Create workflow
  console.log('\n── Step 1: Create Workflow ──');
  const workflow = await createWorkflow({
    name: `Tournament: ${SECTOR} (test)`,
    description: `Tournament analysis of ${SECTOR} sector patents`,
    workflowType: 'tournament',
    scopeType: 'sector',
    scopeId: SECTOR,
    config: { testRun: true, patentLimit: patentLimit || undefined },
  });
  console.log(`Created workflow: ${workflow.id}`);

  // Step 2: Plan tournament
  console.log('\n── Step 2: Plan Tournament ──');
  const tournamentConfig: TournamentConfig = {
    rounds: [
      {
        templateId: CLUSTER_EVAL_TEMPLATE,
        topN: 4,
        sortScoreField: 'cluster_quality',
      },
      {
        templateId: ROUND_SYNTHESIS_TEMPLATE,
        topN: 4,
        sortScoreField: 'round_quality',
      },
    ],
    initialClusterStrategy: 'score',
    clusterSizeTarget: patentLimit ? Math.min(16, Math.ceil(patentLimit / 3)) : undefined,
    synthesisTemplateId: FINAL_SYNTHESIS_TEMPLATE,
    maxPatents: patentLimit || undefined,
  };

  const jobIds = await planTournament(workflow.id, tournamentConfig);
  console.log(`Planned ${jobIds.length} jobs`);

  // Step 3: Show plan details
  console.log('\n── Step 3: Tournament Plan ──');
  const detail = await getWorkflow(workflow.id);
  const config = detail.config as Record<string, unknown>;
  const tournamentMeta = config?.tournament as Record<string, unknown>;

  if (tournamentMeta) {
    console.log(`  Patents:     ${tournamentMeta.patentCount}`);
    console.log(`  Cluster size: ${tournamentMeta.clusterSize}`);
    console.log(`  Total rounds: ${tournamentMeta.totalRounds}`);
    console.log(`  Total jobs:   ${tournamentMeta.totalJobs}`);
  }

  // Group jobs by round
  const byRound = new Map<number, typeof detail.jobs>();
  for (const job of detail.jobs) {
    const round = job.roundNumber || 0;
    if (!byRound.has(round)) byRound.set(round, []);
    byRound.get(round)!.push(job);
  }

  for (const [round, jobs] of [...byRound.entries()].sort((a, b) => a[0] - b[0])) {
    const targetTypes = [...new Set(jobs.map(j => j.targetType))].join(', ');
    const totalTargets = jobs.reduce((sum, j) => sum + j.targetIds.length, 0);
    const deps = jobs.reduce((sum, j) => sum + j.dependsOnIds.length, 0);
    console.log(`\n  Round ${round}: ${jobs.length} job(s) [${targetTypes}]`);
    console.log(`    Target IDs: ${totalTargets} total`);
    console.log(`    Dependencies: ${deps} upstream edges`);
    for (const job of jobs.slice(0, 5)) {
      console.log(`    - Job ${job.id.slice(-8)} cluster=${job.clusterIndex} targets=${job.targetIds.length} deps=${job.dependsOnIds.length}`);
    }
    if (jobs.length > 5) console.log(`    ... and ${jobs.length - 5} more`);
  }

  // Show ready jobs
  const ready = await getReadyJobs(workflow.id);
  console.log(`\n  Ready to execute: ${ready.length} job(s)`);

  console.log(`\n  Progress: ${JSON.stringify(detail.progress)}`);

  if (!shouldExecute) {
    console.log('\n── Dry run complete ──');
    console.log(`To execute: npx tsx scripts/test-tournament.ts --execute${patentLimit ? ` --limit ${patentLimit}` : ''}`);
    console.log(`Workflow ID: ${workflow.id}`);
    console.log('\nCleaning up test workflow...');
    await prisma.llmWorkflow.delete({ where: { id: workflow.id } });
    console.log('Deleted test workflow.');
    return;
  }

  // Step 4: Execute
  console.log('\n── Step 4: Execute Tournament ──');
  console.log('Starting execution (this may take several minutes)...');

  const startTime = Date.now();
  await executeWorkflow(workflow.id);
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  // Step 5: Report results
  console.log(`\n── Step 5: Results (${elapsed}s) ──`);
  const finalDetail = await getWorkflow(workflow.id);
  console.log(`  Status: ${finalDetail.status}`);
  console.log(`  Progress: ${JSON.stringify(finalDetail.progress)}`);

  // Token usage
  const totalTokens = await prisma.llmJob.aggregate({
    where: { workflowId: workflow.id },
    _sum: { tokensUsed: true },
  });
  console.log(`  Total tokens: ${totalTokens._sum.tokensUsed || 0}`);

  // Show results per round
  for (const [round, jobs] of [...byRound.entries()].sort((a, b) => a[0] - b[0])) {
    const completedJobs = await prisma.llmJob.findMany({
      where: { workflowId: workflow.id, roundNumber: round, status: 'COMPLETE' },
      select: { id: true, clusterIndex: true, sortScore: true, tokensUsed: true, result: true },
      orderBy: { clusterIndex: 'asc' },
    });

    console.log(`\n  Round ${round}: ${completedJobs.length}/${jobs.length} completed`);
    for (const job of completedJobs.slice(0, 3)) {
      const result = job.result as Record<string, unknown> | null;
      const response = result?.response as Record<string, unknown> | null;
      const summary = response?.cluster_summary || response?.round_summary || response?.tournament_summary || '(no summary)';
      console.log(`    Job ${job.id.slice(-8)} score=${job.sortScore} tokens=${job.tokensUsed}`);
      console.log(`      Summary: ${String(summary).slice(0, 120)}`);
    }
    if (completedJobs.length > 3) console.log(`    ... and ${completedJobs.length - 3} more`);
  }

  // Show final result
  if (finalDetail.finalResult) {
    console.log('\n  Final Result:');
    const terminalJobs = (finalDetail.finalResult as Record<string, unknown>).terminalJobs as Array<Record<string, unknown>>;
    if (terminalJobs) {
      for (const tj of terminalJobs) {
        const result = tj.result as Record<string, unknown> | null;
        const response = result?.response as Record<string, unknown> | null;
        if (response?.tournament_summary) {
          console.log(`    ${String(response.tournament_summary).slice(0, 200)}`);
        }
        if (response?.definitive_rankings) {
          const rankings = response.definitive_rankings as Array<Record<string, unknown>>;
          console.log(`    Top ${Math.min(5, rankings.length)} patents:`);
          for (const r of rankings.slice(0, 5)) {
            console.log(`      #${r.rank} ${r.patent_id} (${r.final_score}/10) - ${String(r.key_strength).slice(0, 80)}`);
          }
        }
      }
    }
  }

  // Entity analysis results
  const entityResults = await prisma.entityAnalysisResult.count({
    where: { entityType: 'sector', entityId: SECTOR },
  });
  console.log(`\n  Entity analysis results stored: ${entityResults}`);

  console.log(`\n  Workflow ID: ${workflow.id}`);
}

main()
  .then(() => {
    console.log('\nDone.');
    process.exit(0);
  })
  .catch((err) => {
    console.error('\nError:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
