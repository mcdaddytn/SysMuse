#!/usr/bin/env ts-node
import * as fs from 'fs';
import * as path from 'path';
import { CombinedSearchService } from '../services/CombinedSearchService';
import logger from '../utils/logger';

async function executeTestQueries() {
  const configDir = path.resolve('./config/queries');
  const outputDir = path.resolve('./output');
  
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  const queryFiles = fs.readdirSync(configDir)
    .filter(file => file.startsWith('query-') && file.endsWith('.json'));
  
  logger.info('='.repeat(60));
  logger.info('EXECUTING TEST QUERIES');
  logger.info('='.repeat(60));
  logger.info(`Found ${queryFiles.length} test query files\n`);
  
  const searchService = new CombinedSearchService();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
  const testOutputDir = path.join(outputDir, `test-results-${timestamp}`);
  fs.mkdirSync(testOutputDir, { recursive: true });
  
  const summary: any[] = [];
  let totalQueries = 0;
  let successfulQueries = 0;
  
  for (const queryFile of queryFiles) {
    const queryPath = path.join(configDir, queryFile);
    logger.info(`\n${'='.repeat(40)}`);
    logger.info(`Query: ${queryFile}`);
    logger.info('='.repeat(40));
    
    try {
      const queryInput = JSON.parse(fs.readFileSync(queryPath, 'utf-8'));
      logger.info('Filters:');
      
      if (queryInput.trialName) {
        logger.info(`  Trial: ${queryInput.trialName}`);
      }
      if (queryInput.sessionDate) {
        logger.info(`  Session Date: ${JSON.stringify(queryInput.sessionDate)}`);
      }
      if (queryInput.sessionType) {
        logger.info(`  Session Type: ${JSON.stringify(queryInput.sessionType)}`);
      }
      if (queryInput.speakerType) {
        logger.info(`  Speaker Type: ${JSON.stringify(queryInput.speakerType)}`);
      }
      if (queryInput.speakerPrefix) {
        logger.info(`  Speaker Prefix: ${JSON.stringify(queryInput.speakerPrefix)}`);
      }
      
      if (queryInput.elasticSearchQueries) {
        logger.info(`\nElasticsearch Queries: ${queryInput.elasticSearchQueries.length}`);
        for (const esQuery of queryInput.elasticSearchQueries) {
          logger.info(`  - ${esQuery.name}: "${esQuery.query}" (${esQuery.type || 'match'})`);
        }
      }
      
      logger.info('\nExecuting search...');
      const results = await searchService.executeSearch(queryInput);
      
      logger.info('\nResults:');
      logger.info(`  Total statements found: ${results.totalStatements}`);
      logger.info(`  Matched statements: ${results.matchedStatements}`);
      
      if (results.elasticSearchSummary) {
        logger.info('\nElasticsearch matches:');
        for (const [queryName, stats] of Object.entries(results.elasticSearchSummary)) {
          logger.info(`  ${queryName}: ${stats.matched} matches (${stats.percentage}%)`);
        }
      }
      
      const outputFileName = queryFile.replace('.json', '-results.json');
      const outputPath = path.join(testOutputDir, outputFileName);
      
      const outputData = {
        queryFile,
        timestamp: new Date().toISOString(),
        input: queryInput,
        results: {
          totalStatements: results.totalStatements,
          matchedStatements: results.matchedStatements,
          elasticSearchSummary: results.elasticSearchSummary,
          sampleResults: results.results.slice(0, 10)
        }
      };
      
      fs.writeFileSync(outputPath, JSON.stringify(outputData, null, 2));
      logger.info(`\n✅ Results saved to: ${outputFileName}`);
      
      summary.push({
        queryFile,
        status: 'success',
        totalStatements: results.totalStatements,
        matchedStatements: results.matchedStatements,
        elasticSearchSummary: results.elasticSearchSummary
      });
      
      totalQueries++;
      successfulQueries++;
      
    } catch (error) {
      logger.error(`\n❌ Error processing ${queryFile}:`, error);
      summary.push({
        queryFile,
        status: 'error',
        error: String(error)
      });
      totalQueries++;
    }
  }
  
  const summaryPath = path.join(testOutputDir, 'test-summary.json');
  fs.writeFileSync(summaryPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    totalQueries,
    successfulQueries,
    failedQueries: totalQueries - successfulQueries,
    queries: summary
  }, null, 2));
  
  logger.info('\n' + '='.repeat(60));
  logger.info('TEST EXECUTION COMPLETE');
  logger.info('='.repeat(60));
  logger.info(`Total queries executed: ${totalQueries}`);
  logger.info(`Successful: ${successfulQueries}`);
  logger.info(`Failed: ${totalQueries - successfulQueries}`);
  logger.info(`\nSummary saved to: ${summaryPath}`);
  logger.info(`Results saved to: ${testOutputDir}`);
  
  await searchService.disconnect();
}

if (require.main === module) {
  executeTestQueries().catch(error => {
    logger.error('Test execution failed:', error);
    process.exit(1);
  });
}

export { executeTestQueries };