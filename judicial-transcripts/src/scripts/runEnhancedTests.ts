import { EnhancedSearchService } from '../services/EnhancedSearchService';
import logger from '../utils/logger';
import * as fs from 'fs';
import * as path from 'path';

async function runEnhancedTests() {
  try {
    logger.info('===================================================');
    logger.info('RUNNING ENHANCED SEARCH TESTS WITH TEXT OUTPUT');
    logger.info('===================================================\n');
    
    const service = new EnhancedSearchService();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
    const outputDir = path.join(process.cwd(), 'output', `enhanced-tests-${timestamp}`);
    fs.mkdirSync(outputDir, { recursive: true });
    
    // Test configurations that work with the actual data
    const tests = [
      {
        name: 'Judge Rulings with Context',
        config: {
          speakerType: ['JUDGE'],
          elasticSearchQueries: [{
            name: 'judicial_rulings',
            query: 'sustained OR overruled OR objection',
            type: 'match' as const,
            field: 'text'
          }],
          maxResults: 25,
          surroundingStatements: 5,
          outputFileNameTemplate: 'judge-rulings-{Session.sessionDate}.txt',
          outputFileTemplate: 'courtroom-dialogue.txt'
        }
      },
      {
        name: 'Patent Discussion',
        config: {
          elasticSearchQueries: [{
            name: 'patent_discussion',
            query: 'patent AND (claim OR invention OR "prior art")',
            type: 'match' as const,
            field: 'text'
          }],
          maxResults: 20,
          surroundingStatements: 3,
          outputFileNameTemplate: 'patent-discussion-{Trial.caseNumber}.txt',
          outputFileTemplate: 'default.txt'
        }
      },
      {
        name: 'Witness Testimony',
        config: {
          speakerType: ['WITNESS'],
          elasticSearchQueries: [{
            name: 'witness_answers',
            query: 'yes OR no OR "I don\'t know"',
            type: 'match' as const,
            field: 'text'
          }],
          maxResults: 30,
          surroundingStatements: 2,
          outputFileNameTemplate: 'witness-testimony-{Session.sessionDate}.txt',
          outputFileTemplate: 'witness-testimony.txt'
        }
      },
      {
        name: 'Attorney Objections',
        config: {
          speakerType: ['ATTORNEY'],
          speakerPrefix: ['MR. HADDEN', 'MR. RE', 'MR. FABRICANT'],
          elasticSearchQueries: [{
            name: 'objections',
            query: 'objection OR "move to strike"',
            type: 'match' as const,
            field: 'text'
          }],
          maxResults: 20,
          surroundingStatements: 4,
          outputFileNameTemplate: 'attorney-objections-{Speaker.speakerPrefix}.txt',
          outputFileTemplate: 'courtroom-dialogue.txt'
        }
      },
      {
        name: 'Court Proceedings',
        config: {
          sessionType: ['MORNING'],
          elasticSearchQueries: [{
            name: 'proceedings',
            query: 'proceed OR continue OR recess',
            type: 'match' as const,
            field: 'text'
          }],
          maxResults: 15,
          surroundingStatements: 3,
          outputFileNameTemplate: 'proceedings-{Session.sessionType}.txt',
          outputFileTemplate: 'default.txt'
        }
      }
    ];
    
    const results: any[] = [];
    
    for (const test of tests) {
      logger.info(`\nRunning test: ${test.name}`);
      logger.info('-'.repeat(40));
      
      try {
        // Execute search
        const searchResults = await service.executeSearch(test.config);
        
        // Export to text files
        const outputFiles = await service.exportResults(
          searchResults, 
          test.config,
          outputDir
        );
        
        // Also save JSON
        const jsonPath = path.join(outputDir, `${test.name.toLowerCase().replace(/ /g, '-')}.json`);
        fs.writeFileSync(jsonPath, JSON.stringify(searchResults, null, 2));
        
        logger.info(`  Total statements: ${searchResults.totalStatements}`);
        logger.info(`  Matched statements: ${searchResults.matchedStatements}`);
        logger.info(`  Text files generated: ${outputFiles.length}`);
        logger.info(`  JSON saved to: ${jsonPath}`);
        
        results.push({
          test: test.name,
          totalStatements: searchResults.totalStatements,
          matchedStatements: searchResults.matchedStatements,
          textFiles: outputFiles.length,
          files: outputFiles.map(f => path.basename(f))
        });
        
        // Show sample from first text file
        if (outputFiles.length > 0 && outputFiles[0].endsWith('.txt')) {
          const sampleContent = fs.readFileSync(outputFiles[0], 'utf-8');
          const lines = sampleContent.split('\n').slice(0, 20);
          logger.info('\n  Sample output (first 20 lines):');
          logger.info('  ' + '='.repeat(60));
          lines.forEach(line => logger.info('  ' + line));
          logger.info('  ' + '='.repeat(60));
        }
        
      } catch (error: any) {
        logger.error(`  Error in test '${test.name}':`, error.message);
        results.push({
          test: test.name,
          error: error.message
        });
      }
    }
    
    // Generate summary
    logger.info('\n===================================================');
    logger.info('TEST SUMMARY');
    logger.info('===================================================\n');
    
    const summaryPath = path.join(outputDir, 'test-summary.json');
    fs.writeFileSync(summaryPath, JSON.stringify({
      timestamp,
      outputDirectory: outputDir,
      testsRun: tests.length,
      results
    }, null, 2));
    
    // Count total files
    const allFiles = fs.readdirSync(outputDir);
    const textFiles = allFiles.filter(f => f.endsWith('.txt'));
    const jsonFiles = allFiles.filter(f => f.endsWith('.json'));
    
    logger.info('Results:');
    results.forEach(r => {
      if (r.error) {
        logger.info(`  ❌ ${r.test}: ${r.error}`);
      } else {
        logger.info(`  ✅ ${r.test}: ${r.matchedStatements} matches, ${r.textFiles} text files`);
      }
    });
    
    logger.info(`\nTotal files generated:`);
    logger.info(`  Text files: ${textFiles.length}`);
    logger.info(`  JSON files: ${jsonFiles.length}`);
    logger.info(`  Output directory: ${outputDir}`);
    
    logger.info('\n✅ Enhanced search tests completed!');
    
  } catch (error) {
    logger.error('Error running enhanced tests:', error);
    throw error;
  }
}

runEnhancedTests().catch(console.error);