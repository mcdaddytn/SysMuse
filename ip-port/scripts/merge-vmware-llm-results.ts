/**
 * Merge VMware LLM Follower Results into Main LLM Data
 *
 * Combines the overnight VMware LLM analysis with existing LLM results.
 */

import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';

const VMWARE_LLM_DIR = './output/vmware-llm-analysis';
const LLM_V3_DIR = './output/llm-analysis-v3';
const BATCHES_DIR = './output/llm-analysis-v3/batches';

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('        MERGE VMWARE LLM RESULTS INTO MAIN LLM DATA');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Load existing LLM combined file
  const existingFiles = (await fs.readdir(LLM_V3_DIR))
    .filter(f => f.startsWith('combined-v3-') && f.endsWith('.json'))
    .sort();

  const latestExisting = existingFiles.pop();
  if (!latestExisting) {
    console.error('No existing combined-v3 file found');
    process.exit(1);
  }

  console.log(`Loading existing LLM data: ${latestExisting}`);
  const existingData = JSON.parse(await fs.readFile(path.join(LLM_V3_DIR, latestExisting), 'utf-8'));
  const existingAnalyses = new Map<string, any>();

  for (const analysis of existingData.analyses || []) {
    existingAnalyses.set(analysis.patent_id, analysis);
  }
  console.log(`  Existing analyses: ${existingAnalyses.size}`);

  // Load VMware LLM results
  const vmwareFiles = (await fs.readdir(VMWARE_LLM_DIR))
    .filter(f => f.startsWith('patent-') && f.endsWith('.json'));

  console.log(`\nLoading VMware LLM results: ${vmwareFiles.length} files`);

  let added = 0;
  let skipped = 0;

  for (const file of vmwareFiles) {
    try {
      const data = JSON.parse(await fs.readFile(path.join(VMWARE_LLM_DIR, file), 'utf-8'));
      const patentId = data.patent_id;

      if (existingAnalyses.has(patentId)) {
        skipped++;
        continue;
      }

      // Convert to the format expected by the main LLM system
      const analysis = {
        patent_id: patentId,
        ...data.analysis,
        // Add metadata
        source: 'vmware-llm-follower',
        analyzed_at: data.analyzed_at,
      };

      existingAnalyses.set(patentId, analysis);
      added++;

      // Also save as a batch file for compatibility
      const batchNum = Math.floor(added / 5) + 100; // Start at batch 100 to avoid conflicts
      if (added % 5 === 1) {
        // Start new batch
      }

    } catch (error) {
      console.error(`  Error reading ${file}:`, error);
    }
  }

  console.log(`\n  Added: ${added}`);
  console.log(`  Skipped (already existed): ${skipped}`);

  // Create new combined file
  const timestamp = new Date().toISOString().split('T')[0];
  const outputFile = path.join(LLM_V3_DIR, `combined-v3-${timestamp}.json`);

  const output = {
    version: 'v3-merged',
    generated_at: new Date().toISOString(),
    total_patents: existingAnalyses.size,
    sources: ['existing-v3', 'vmware-llm-follower'],
    analyses: Array.from(existingAnalyses.values()),
  };

  await fs.writeFile(outputFile, JSON.stringify(output, null, 2));
  console.log(`\nSaved: ${outputFile}`);
  console.log(`Total patents with LLM analysis: ${existingAnalyses.size}`);

  // Also create batches for the VMware patents (for compatibility with export scripts)
  console.log('\nCreating batch files for VMware LLM results...');

  const vmwareAnalyses = Array.from(existingAnalyses.values())
    .filter((a: any) => a.source === 'vmware-llm-follower');

  const batchSize = 5;
  let batchNum = 100; // Start at 100 to avoid conflicts

  for (let i = 0; i < vmwareAnalyses.length; i += batchSize) {
    const batch = vmwareAnalyses.slice(i, i + batchSize);
    const batchFile = path.join(BATCHES_DIR, `batch-v3-${String(batchNum).padStart(3, '0')}-${timestamp}.json`);

    await fs.writeFile(batchFile, JSON.stringify({
      batchNumber: batchNum,
      timestamp: new Date().toISOString(),
      source: 'vmware-llm-follower',
      patentIds: batch.map((a: any) => a.patent_id),
      analyses: batch,
    }, null, 2));

    batchNum++;
  }

  console.log(`  Created ${batchNum - 100} batch files`);

  console.log('\n' + '═'.repeat(60));
  console.log('MERGE COMPLETE');
  console.log('═'.repeat(60) + '\n');
}

main().catch(console.error);
