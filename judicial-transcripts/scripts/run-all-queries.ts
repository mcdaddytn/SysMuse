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
}

async function runQuery(queryFile: string): Promise<QueryResult> {
  const queryPath = path.join(QUERIES_DIR, queryFile);
  const queryName = path.basename(queryFile, '.json');
  
  try {
    logger.info(`Running query: ${queryFile}`);
    
    const command = `npx ts-node src/cli/enhanced-search.ts query -f ${queryPath} -o ${OUTPUT_DIR} --json`;
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
    
    return {
      queryFile,
      success: true,
      outputDir: OUTPUT_DIR,
      stats
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
    .filter(file => file.endsWith('.json'))
    .sort();
  
  console.log(`Found ${queryFiles.length} query files to process`);
  console.log('');
  
  const results: QueryResult[] = [];
  let successCount = 0;
  let failureCount = 0;
  
  // Run queries sequentially to avoid overwhelming the system
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
            console.log(`  - ${query}: ${summary.matched} matches (${summary.percentage}%)`);
          }
        }
      }
    } else {
      failureCount++;
      console.log(`✗ ${queryFile}: ${result.error}`);
    }
    console.log('');
  }
  
  // Generate summary report
  const summaryPath = path.join(OUTPUT_DIR, 'query-run-summary.json');
  const summaryData = {
    timestamp: TIMESTAMP,
    totalQueries: queryFiles.length,
    successful: successCount,
    failed: failureCount,
    outputDirectory: OUTPUT_DIR,
    results: results
  };
  
  fs.writeFileSync(summaryPath, JSON.stringify(summaryData, null, 2));
  
  // Generate markdown report
  const reportPath = path.join(OUTPUT_DIR, 'query-run-report.md');
  let reportContent = `# Query Run Report\n\n`;
  reportContent += `**Date:** ${new Date().toISOString()}\n`;
  reportContent += `**Total Queries:** ${queryFiles.length}\n`;
  reportContent += `**Successful:** ${successCount}\n`;
  reportContent += `**Failed:** ${failureCount}\n\n`;
  
  reportContent += `## Results\n\n`;
  for (const result of results) {
    reportContent += `### ${result.queryFile}\n`;
    reportContent += `- **Status:** ${result.success ? '✓ Success' : '✗ Failed'}\n`;
    if (result.stats) {
      reportContent += `- **Matched:** ${result.stats.matchedStatements}/${result.stats.totalStatements} statements\n`;
      if (result.stats.elasticSearchSummary) {
        reportContent += `- **Search Terms:**\n`;
        for (const [query, summary] of Object.entries(result.stats.elasticSearchSummary as any)) {
          reportContent += `  - ${query}: ${summary.matched} matches (${summary.percentage}%)\n`;
        }
      }
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
  console.log(`Failed: ${failureCount}`);
  console.log('');
  console.log(`Output saved to: ${OUTPUT_DIR}`);
  console.log(`Summary report: ${summaryPath}`);
  console.log(`Markdown report: ${reportPath}`);
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