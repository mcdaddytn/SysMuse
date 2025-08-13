#!/usr/bin/env ts-node

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
const OUTPUT_BASE_DIR = path.join(__dirname, '../output');
const OUTPUT_DIR = path.join(OUTPUT_BASE_DIR, `batch-results-${TIMESTAMP}`);

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

async function main() {
  console.log('========================================');
  console.log('    JUDICIAL TRANSCRIPT QUERY RUNNER    ');
  console.log('========================================');
  console.log(`Timestamp: ${TIMESTAMP}`);
  console.log(`Output Directory: ${OUTPUT_DIR}`);
  console.log('');
  
  try {
    // Run the batch command
    console.log('Running batch query processing...\n');
    const command = `npx ts-node src/cli/enhanced-search.ts batch -d ./config/queries -o ${OUTPUT_DIR}`;
    
    execSync(command, { 
      encoding: 'utf-8',
      stdio: 'inherit'
    });
    
    // Now process the results to generate our enhanced reports
    console.log('\nGenerating enhanced reports...\n');
    
    // Read the batch summary that was created
    const batchSummaryPath = path.join(OUTPUT_DIR, 'batch-summary.json');
    if (!fs.existsSync(batchSummaryPath)) {
      console.error('Batch summary not found. Processing may have failed.');
      process.exit(1);
    }
    
    const batchSummary = JSON.parse(fs.readFileSync(batchSummaryPath, 'utf-8'));
    
    // Process each query result to get file sizes
    const results: any[] = [];
    let totalOutputSizeKB = 0;
    
    for (const query of batchSummary.queries) {
      const queryName = path.basename(query.queryFile, '.json');
      const queryOutputDir = path.join(OUTPUT_DIR, queryName);
      
      const outputFiles = getDirectoryFiles(queryOutputDir);
      
      const result = {
        queryFile: query.queryFile,
        success: query.status === 'success',
        stats: {
          totalStatements: query.totalStatements,
          matchedStatements: query.matchedStatements,
          elasticSearchSummary: query.elasticSearchSummary
        },
        outputFiles: outputFiles
      };
      
      results.push(result);
      
      for (const file of outputFiles) {
        totalOutputSizeKB += file.sizeKB;
      }
    }
    
    // Categorize queries
    const queriesWithMatches = results.filter(r => 
      r.success && r.stats && r.stats.matchedStatements > 0
    );
    const queriesWithNoMatches = results.filter(r => 
      r.success && r.stats && r.stats.matchedStatements === 0
    );
    const failedQueries = results.filter(r => !r.success);
    
    // Generate enhanced summary report
    const summaryPath = path.join(OUTPUT_DIR, 'query-run-summary.json');
    const summaryData = {
      timestamp: TIMESTAMP,
      totalQueries: results.length,
      successful: results.filter(r => r.success).length,
      failed: failedQueries.length,
      queriesWithMatches: queriesWithMatches.length,
      queriesWithNoMatches: queriesWithNoMatches.length,
      totalOutputSizeMB: Math.round(totalOutputSizeKB / 1024 * 10) / 10,
      outputDirectory: OUTPUT_DIR,
      results: results,
      categories: {
        withMatches: queriesWithMatches.map(q => q.queryFile),
        noMatches: queriesWithNoMatches.map(q => q.queryFile),
        failed: failedQueries.map(q => q.queryFile)
      }
    };
    
    fs.writeFileSync(summaryPath, JSON.stringify(summaryData, null, 2));
    
    // Create category files
    const categoriesDir = path.join(OUTPUT_DIR, 'query-categories');
    if (!fs.existsSync(categoriesDir)) {
      fs.mkdirSync(categoriesDir, { recursive: true });
    }
    
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
    reportContent += `**Total Queries:** ${results.length}\n`;
    reportContent += `**Successful:** ${results.filter(r => r.success).length}\n`;
    reportContent += `**Failed:** ${failedQueries.length}\n\n`;
    
    reportContent += `## Summary Statistics\n\n`;
    reportContent += `- Queries with matches: ${queriesWithMatches.length}\n`;
    reportContent += `- Queries with no matches: ${queriesWithNoMatches.length}\n`;
    reportContent += `- Failed queries: ${failedQueries.length}\n`;
    reportContent += `- **Total Output Size:** ${Math.round(totalOutputSizeKB / 1024 * 10) / 10} MB\n\n`;
    
    if (queriesWithNoMatches.length > 0) {
      reportContent += `## Queries with No Matches\n\n`;
      for (const query of queriesWithNoMatches) {
        reportContent += `- ${query.queryFile}\n`;
      }
      reportContent += `\n`;
    }
    
    reportContent += `## Detailed Results\n\n`;
    for (const result of results) {
      reportContent += `### ${result.queryFile}\n`;
      reportContent += `- **Status:** ${result.success ? '✓ Success' : '✗ Failed'}\n`;
      if (result.stats) {
        reportContent += `- **Matched:** ${result.stats.matchedStatements}/${result.stats.totalStatements} statements`;
        if (result.stats.totalStatements > 0) {
          const percentage = Math.round((result.stats.matchedStatements / result.stats.totalStatements) * 100);
          reportContent += ` (${percentage}%)`;
        }
        reportContent += `\n`;
        
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
    
    // Print summary
    console.log('========================================');
    console.log('              SUMMARY                   ');
    console.log('========================================');
    console.log(`Total Queries: ${results.length}`);
    console.log(`Successful: ${results.filter(r => r.success).length}`);
    console.log(`  - With matches: ${queriesWithMatches.length}`);
    console.log(`  - No matches: ${queriesWithNoMatches.length}`);
    console.log(`Failed: ${failedQueries.length}`);
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
    
  } catch (error) {
    console.error('Error during batch processing:', error);
    process.exit(1);
  }
}

// Run the main function
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});