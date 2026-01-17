/**
 * Run Top 250 Enrichment
 *
 * Runs all enrichment jobs on patents in the top 250 that are missing data.
 * Can run individual jobs or all jobs.
 *
 * Usage:
 *   npx tsx scripts/run-top250-enrichment.ts --all       # Run all enrichment
 *   npx tsx scripts/run-top250-enrichment.ts --ipr       # Run IPR only
 *   npx tsx scripts/run-top250-enrichment.ts --pros      # Run prosecution only
 *   npx tsx scripts/run-top250-enrichment.ts --llm       # Run LLM only
 *   npx tsx scripts/run-top250-enrichment.ts --status    # Check status
 */

import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';

const timestamp = '2026-01-17';

function loadPatentList(filename: string): string[] {
  const filepath = `./output/${filename}`;
  if (!fs.existsSync(filepath)) {
    console.error(`File not found: ${filepath}`);
    return [];
  }
  return JSON.parse(fs.readFileSync(filepath, 'utf-8'));
}

function savePatentList(patents: string[], name: string): string {
  const filepath = `./output/enrichment-${name}-${timestamp}.json`;
  fs.writeFileSync(filepath, JSON.stringify(patents, null, 2));
  return filepath;
}

async function runCommand(command: string, args: string[], logFile: string): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log(`Running: ${command} ${args.join(' ')}`);
    console.log(`Log: ${logFile}`);

    const logStream = fs.createWriteStream(logFile);
    const proc = spawn(command, args, {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    proc.stdout.pipe(logStream);
    proc.stderr.pipe(logStream);

    proc.on('close', (code) => {
      logStream.close();
      if (code === 0) {
        console.log(`✓ Completed successfully`);
        resolve();
      } else {
        console.log(`✗ Exited with code ${code}`);
        resolve();  // Don't reject, continue with other jobs
      }
    });

    proc.on('error', (err) => {
      console.error(`Error: ${err.message}`);
      resolve();
    });
  });
}

function checkStatus() {
  console.log('='.repeat(60));
  console.log('Top 250 Enrichment Status');
  console.log('='.repeat(60));

  // Check what data exists
  const iprFile = `./output/ipr/ipr-risk-check-${timestamp}.json`;
  const prosFile = `./output/prosecution/prosecution-history-${timestamp}.json`;
  const llmV3File = `./output/llm-analysis-v3/combined-v3-${timestamp}.json`;
  const unifiedFile = `./output/unified-top250-${timestamp}.json`;

  if (fs.existsSync(iprFile)) {
    const data = JSON.parse(fs.readFileSync(iprFile, 'utf-8'));
    console.log(`IPR data: ${data.results?.length || 0} patents`);
  }

  if (fs.existsSync(prosFile)) {
    const data = JSON.parse(fs.readFileSync(prosFile, 'utf-8'));
    console.log(`Prosecution data: ${data.results?.length || 0} patents`);
  }

  if (fs.existsSync(llmV3File)) {
    const data = JSON.parse(fs.readFileSync(llmV3File, 'utf-8'));
    console.log(`LLM V3 data: ${data.analyses?.length || 0} patents`);
  }

  if (fs.existsSync(unifiedFile)) {
    const data = JSON.parse(fs.readFileSync(unifiedFile, 'utf-8'));
    console.log(`\nUnified Top 250 statistics:`);
    console.log(JSON.stringify(data.statistics, null, 2));
  }

  // Check enrichment lists
  const needsLLM = loadPatentList(`top250-needs-llm-${timestamp}.json`);
  const needsIPR = loadPatentList(`top250-needs-ipr-${timestamp}.json`);
  const needsPros = loadPatentList(`top250-needs-pros-${timestamp}.json`);

  console.log(`\nPatents needing enrichment:`);
  console.log(`  LLM: ${needsLLM.length}`);
  console.log(`  IPR: ${needsIPR.length}`);
  console.log(`  Prosecution: ${needsPros.length}`);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--status')) {
    checkStatus();
    return;
  }

  const runAll = args.includes('--all');
  const runIPR = runAll || args.includes('--ipr');
  const runPros = runAll || args.includes('--pros');
  const runLLM = runAll || args.includes('--llm');

  if (!runIPR && !runPros && !runLLM) {
    console.log('Usage:');
    console.log('  npx tsx scripts/run-top250-enrichment.ts --all');
    console.log('  npx tsx scripts/run-top250-enrichment.ts --ipr');
    console.log('  npx tsx scripts/run-top250-enrichment.ts --pros');
    console.log('  npx tsx scripts/run-top250-enrichment.ts --llm');
    console.log('  npx tsx scripts/run-top250-enrichment.ts --status');
    return;
  }

  console.log('='.repeat(60));
  console.log('Top 250 Enrichment Runner');
  console.log('='.repeat(60));
  console.log('');

  // Load patent lists
  const needsLLM = loadPatentList(`top250-needs-llm-${timestamp}.json`);
  const needsIPR = loadPatentList(`top250-needs-ipr-${timestamp}.json`);
  const needsPros = loadPatentList(`top250-needs-pros-${timestamp}.json`);

  console.log(`Patents needing enrichment:`);
  console.log(`  LLM: ${needsLLM.length}`);
  console.log(`  IPR: ${needsIPR.length}`);
  console.log(`  Prosecution: ${needsPros.length}`);
  console.log('');

  // Create input files for scripts
  const llmInputFile = savePatentList(needsLLM, 'llm-input');
  const iprInputFile = savePatentList(needsIPR, 'ipr-input');
  const prosInputFile = savePatentList(needsPros, 'pros-input');

  // Run IPR check
  if (runIPR && needsIPR.length > 0) {
    console.log('\n--- Running IPR Risk Check ---');
    await runCommand('npx', ['tsx', 'scripts/check-ipr-risk.ts', iprInputFile],
      `./output/ipr/enrichment-ipr-${timestamp}.log`);
  }

  // Run Prosecution check
  if (runPros && needsPros.length > 0) {
    console.log('\n--- Running Prosecution History Check ---');
    await runCommand('npx', ['tsx', 'scripts/check-prosecution-history.ts', prosInputFile],
      `./output/prosecution/enrichment-pros-${timestamp}.log`);
  }

  // Run LLM V3 analysis
  if (runLLM && needsLLM.length > 0) {
    console.log('\n--- Running LLM V3 Analysis ---');
    await runCommand('npx', ['tsx', 'scripts/run-llm-analysis-v3.ts', llmInputFile],
      `./output/llm-analysis-v3/enrichment-llm-${timestamp}.log`);
  }

  console.log('\n' + '='.repeat(60));
  console.log('Enrichment jobs started');
  console.log('Check progress with: npx tsx scripts/run-top250-enrichment.ts --status');
  console.log('='.repeat(60));
}

main().catch(console.error);
