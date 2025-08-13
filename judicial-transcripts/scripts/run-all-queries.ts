#!/usr/bin/env ts-node

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import logger from '../src/utils/logger';

const QUERIES_DIR = path.join(__dirname, '../config/queries');
const OUTPUT_BASE_DIR = path.join(__dirname, '../output');
const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
const OUTPUT_DIR = path.join(OUTPUT_BASE_DIR, `batch-results-${TIMESTAMP}`);

interface QueryResult {
  queryFile: string;
  success: boolean;
  outputDir?: string;
  error?: string;
  stats?: {
    totalStatements: number;
    matchedStatements: number;
    elasticSearchSummary?: any;
  };
  outputFiles?: Array<{
    file: string;
    sizeKB: number;
  }>;
}

function getFileSizeInKB(filePath: string): number {
  try {
    const stats = fs.statSync(filePath);
    return Math.round(stats.size / 1024 * 10) / 10; // Round to 1 decimal place
  } catch (error) {
    return 0;
  }
}

function getDirectoryFiles(dirPath: string): Array<{file: string; sizeKB: number}> {
  const files: Array<{file: string; sizeKB: number}> = [];
  
  try {
    const items = fs.readdirSync(dirPath);
    for (const item of items) {
      const fullPath = path.join(dirPath, item);
      const stats = fs.statSync(fullPath);
      if (stats.isFile()) {
        files.push({
          file: item,
          sizeKB: getFileSizeInKB(fullPath)
        });
      }
    }
  } catch (error) {
    // Directory doesn't exist or other error
  }
  
  return files;
}

async function runQuery(queryFile: string): Promise<QueryResult> {
  const queryPath = path.join(QUERIES_DIR, queryFile);
  const queryName = path.basename(queryFile, '.json');
  const queryOutputDir = path.join(OUTPUT_DIR, `results-${queryName}`);
  
  try {
    logger.info(`Running query: ${queryFile}`);
    
    // Run the enhanced-search command, which will create output in a timestamped folder
    const command = `npx ts-node src/cli/enhanced-search.ts query -f ${queryPath} -o ${OUTPUT_DIR}`;
    const output = execSync(command, { 
      encoding: 'utf-8',
      stdio: ['inherit', 'pipe', 'pipe']
    });
    
    // Parse output to extract statistics
    const totalMatch = output.match(/Total statements found: (\d+)/);
    const matchedMatch = output.match(/Matched statements: (\d+)/);
    
    const stats: any = {};
    if (totalMatch) stats.totalStatements = parseInt(totalMatch[1]);
    if (matchedMatch) stats.matchedStatements = parseInt(matchedMatch[1]);
    
    // Extract elasticsearch summary if present
    const esMatches = output.matchAll(/(\w+): (\d+) matches \((\d+)%\)/g);
    if (esMatches) {
      stats.elasticSearchSummary = {};
      for (const match of esMatches) {
        stats.elasticSearchSummary[match[1]] = {
          matched: parseInt(match[2]),
          percentage: parseInt(match[3])
        };
      }
    }
    
    // Find the actual output directory (it will have a timestamp)
    const dirs = fs.readdirSync(OUTPUT_DIR)
      .filter(d => d.startsWith('results-'))
      .map(d => ({
        name: d,
        time: fs.statSync(path.join(OUTPUT_DIR, d)).mtimeMs
      }))
      .sort((a, b) => b.time - a.time);
    
    let outputFiles: Array<{file: string; sizeKB: number}> = [];
    if (dirs.length > 0) {
      const actualOutputDir = path.join(OUTPUT_DIR, dirs[0].name);
      
      // Rename the directory to use query name instead of timestamp
      if (fs.existsSync(actualOutputDir) && actualOutputDir !== queryOutputDir) {
        if (fs.existsSync(queryOutputDir)) {
          fs.rmSync(queryOutputDir, { recursive: true, force: true });
        }
        fs.renameSync(actualOutputDir, queryOutputDir);
      }
      
      // Get list of output files with sizes
      outputFiles = getDirectoryFiles(queryOutputDir);
    }
    
    return {
      queryFile,
      success: true,
      outputDir: queryOutputDir,
      stats,
      outputFiles
    };
  } catch (error: any) {
    logger.error(`Failed to run query ${queryFile}:`, error.message);
    return {
      queryFile,
      success: false,
      error: error.message
    };
  }
}

async function main() {
  console.log('========================================');
  console.log('    JUDICIAL TRANSCRIPT QUERY RUNNER    ');
  console.log('========================================');
  console.log(`Timestamp: ${TIMESTAMP}`);
  console.log(`Output Directory: ${OUTPUT_DIR}`);
  console.log('');
  
  // Create output directory
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
  
  // Get all query files
  const queryFiles = fs.readdirSync(QUERIES_DIR)
    .filter(file => file.endsWith('.json') && file.startsWith('query-'));
  
  console.log(`Found ${queryFiles.length} query files to process`);
  console.log('');
  
  const results: QueryResult[] = [];
  let successCount = 0;
  let failureCount = 0;
  
  for (const queryFile of queryFiles) {
    const result = await runQuery(queryFile);
    results.push(result);
    
    if (result.success) {
      successCount++;
      console.log(`✓ ${queryFile}`);
      if (result.stats) {
        console.log(`  - Matched: ${result.stats.matchedStatements}/${result.stats.totalStatements} statements`);
        if (result.stats.elasticSearchSummary) {
          for (const [query, summary] of Object.entries(result.stats.elasticSearchSummary as any)) {
            const typedSummary = summary as { matched: number; percentage: number };
            console.log(`  - ${query}: ${typedSummary.matched} matches (${typedSummary.percentage}%)`);
          }
        }
      }
      if (result.outputFiles && result.outputFiles.length > 0) {
        console.log(`  - Output files:`);
        let totalSize = 0;
        for (const file of result.outputFiles) {
          console.log(`    • ${file.file}: ${file.sizeKB} KB`);
          totalSize += file.sizeKB;
        }
        console.log(`  - Total size: ${Math.round(totalSize * 10) / 10} KB`);
      }
    } else {
      failureCount++;
      console.log(`✗ ${queryFile}: ${result.error}`);
    }
    console.log('');
  }
  
  // Categorize queries by their results
  const queriesWithMatches = results.filter(r => 
    r.success && r.stats && r.stats.matchedStatements > 0
  );
  const queriesWithNoMatches = results.filter(r => 
    r.success && r.stats && r.stats.matchedStatements === 0
  );
  const failedQueries = results.filter(r => !r.success);
  
  // Generate summary report
  const summaryPath = path.join(OUTPUT_DIR, 'query-run-summary.json');
  const summaryData = {
    timestamp: TIMESTAMP,
    totalQueries: queryFiles.length,
    successful: successCount,
    failed: failureCount,
    queriesWithMatches: queriesWithMatches.length,
    queriesWithNoMatches: queriesWithNoMatches.length,
    outputDirectory: OUTPUT_DIR,
    results: results,
    categories: {
      withMatches: queriesWithMatches.map(q => q.queryFile),
      noMatches: queriesWithNoMatches.map(q => q.queryFile),
      failed: failedQueries.map(q => q.queryFile)
    }
  };
  
  fs.writeFileSync(summaryPath, JSON.stringify(summaryData, null, 2));
  
  // Create separate category files
  const categoriesDir = path.join(OUTPUT_DIR, 'query-categories');
  if (!fs.existsSync(categoriesDir)) {
    fs.mkdirSync(categoriesDir, { recursive: true });
  }
  
  // Save queries with matches
  if (queriesWithMatches.length > 0) {
    const withMatchesPath = path.join(categoriesDir, 'queries-with-matches.json');
    fs.writeFileSync(withMatchesPath, JSON.stringify({
      count: queriesWithMatches.length,
      queries: queriesWithMatches.map(q => ({
        file: q.queryFile,
        matched: q.stats?.matchedStatements,
        total: q.stats?.totalStatements,
        percentage: q.stats ? Math.round((q.stats.matchedStatements / q.stats.totalStatements) * 100) : 0,
        outputFiles: q.outputFiles
      }))
    }, null, 2));
  }
  
  // Save queries with no matches
  if (queriesWithNoMatches.length > 0) {
    const noMatchesPath = path.join(categoriesDir, 'queries-with-no-matches.json');
    fs.writeFileSync(noMatchesPath, JSON.stringify({
      count: queriesWithNoMatches.length,
      queries: queriesWithNoMatches.map(q => ({
        file: q.queryFile,
        totalStatements: q.stats?.totalStatements,
        outputFiles: q.outputFiles
      }))
    }, null, 2));
  }
  
  // Save failed queries
  if (failedQueries.length > 0) {
    const failedPath = path.join(categoriesDir, 'failed-queries.json');
    fs.writeFileSync(failedPath, JSON.stringify({
      count: failedQueries.length,
      queries: failedQueries.map(q => ({
        file: q.queryFile,
        error: q.error
      }))
    }, null, 2));
  }
  
  // Generate markdown report with file sizes
  const reportPath = path.join(OUTPUT_DIR, 'query-run-report.md');
  let reportContent = `# Query Run Report\n\n`;
  reportContent += `**Date:** ${new Date().toISOString()}\n`;
  reportContent += `**Total Queries:** ${queryFiles.length}\n`;
  reportContent += `**Successful:** ${successCount}\n`;
  reportContent += `**Failed:** ${failureCount}\n\n`;
  
  reportContent += `## Summary Statistics\n\n`;
  reportContent += `- Queries with matches: ${queriesWithMatches.length}\n`;
  reportContent += `- Queries with no matches: ${queriesWithNoMatches.length}\n`;
  reportContent += `- Failed queries: ${failedQueries.length}\n\n`;
  
  // Calculate total output size
  let totalOutputSizeKB = 0;
  for (const result of results) {
    if (result.outputFiles) {
      for (const file of result.outputFiles) {
        totalOutputSizeKB += file.sizeKB;
      }
    }
  }
  reportContent += `**Total Output Size:** ${Math.round(totalOutputSizeKB / 1024 * 10) / 10} MB\n\n`;
  
  reportContent += `## Results\n\n`;
  for (const result of results) {
    reportContent += `### ${result.queryFile}\n`;
    reportContent += `- **Status:** ${result.success ? '✓ Success' : '✗ Failed'}\n`;
    if (result.stats) {
      reportContent += `- **Matched:** ${result.stats.matchedStatements}/${result.stats.totalStatements} statements\n`;
      if (result.stats.elasticSearchSummary) {
        reportContent += `- **Search Terms:**\n`;
        for (const [query, summary] of Object.entries(result.stats.elasticSearchSummary as any)) {
          const typedSummary = summary as { matched: number; percentage: number };
          reportContent += `  - ${query}: ${typedSummary.matched} matches (${typedSummary.percentage}%)\n`;
        }
      }
    }
    if (result.outputFiles && result.outputFiles.length > 0) {
      reportContent += `- **Output Files:**\n`;
      let queryTotalSize = 0;
      for (const file of result.outputFiles) {
        reportContent += `  - ${file.file}: ${file.sizeKB} KB\n`;
        queryTotalSize += file.sizeKB;
      }
      reportContent += `  - **Total:** ${Math.round(queryTotalSize * 10) / 10} KB\n`;
    }
    if (result.error) {
      reportContent += `- **Error:** ${result.error}\n`;
    }
    reportContent += `\n`;
  }
  
  fs.writeFileSync(reportPath, reportContent);
  
  console.log('========================================');
  console.log('              SUMMARY                   ');
  console.log('========================================');
  console.log(`Total Queries: ${queryFiles.length}`);
  console.log(`Successful: ${successCount}`);
  console.log(`  - With matches: ${queriesWithMatches.length}`);
  console.log(`  - No matches: ${queriesWithNoMatches.length}`);
  console.log(`Failed: ${failureCount}`);
  console.log('');
  console.log(`Total Output Size: ${Math.round(totalOutputSizeKB / 1024 * 10) / 10} MB`);
  console.log('');
  
  if (queriesWithNoMatches.length > 0) {
    console.log('Queries with no matches:');
    for (const query of queriesWithNoMatches) {
      console.log(`  - ${query.queryFile}`);
    }
    console.log('');
  }
  
  console.log(`Output saved to: ${OUTPUT_DIR}`);
  console.log(`Summary report: ${summaryPath}`);
  console.log(`Markdown report: ${reportPath}`);
  console.log(`Query categories: ${categoriesDir}`);
  console.log('');
  console.log('To view the results:');
  console.log(`  cd ${OUTPUT_DIR}`);
  console.log('  ls -la');
  console.log('');
  console.log('To create a zip archive:');
  console.log(`  zip -r batch-results-${TIMESTAMP}.zip ${OUTPUT_DIR}`);
  
  process.exit(failureCount > 0 ? 1 : 0);
}

// Run the main function
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});