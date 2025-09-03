import { EnhancedSearchService } from '../../services/EnhancedSearchService';
import { CombinedSearchService } from '../../services/CombinedSearchService';
import logger from '../../utils/logger';
import * as fs from 'fs';
import * as path from 'path';

async function runAllTests() {
  try {
    logger.info('===================================================');
    logger.info('RUNNING ALL TESTS WITH CORRECTED LINE NUMBERS');
    logger.info('===================================================\n');
    
    const enhancedService = new EnhancedSearchService();
    const combinedService = new CombinedSearchService();
    
    // Create timestamp for output directory
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
    const outputDir = path.join(process.cwd(), 'output', `all-tests-${timestamp}`);
    fs.mkdirSync(outputDir, { recursive: true });
    
    const testResults: any[] = [];
    
    // Test 1: Judge rulings with surrounding context
    /*
    logger.info('TEST 1: Judge Rulings with Context');
    logger.info('-'.repeat(40));
    const judgeResults = await enhancedService.executeSearch({
      speakerType: ['JUDGE'],
      elasticSearchQueries: [{
        queryName: 'judicial_rulings',
        queryString: 'sustained OR overruled OR objection',
        fieldsToSearch: ['text']
      }],
      maxResults: 15,
      surroundingStatements: 5
    });
    
    const judgeFiles = await enhancedService.exportResults(judgeResults, {
      outputFileNameTemplate: `${outputDir}/judge-rulings`,
      outputFileTemplate: 'templates/courtroom-dialogue.txt'
    });
    
    testResults.push({
      test: 'Judge Rulings',
      totalStatements: judgeResults.totalStatements,
      matchedStatements: judgeResults.matchedStatements,
      outputFiles: judgeFiles
    });

    logger.info(`  Total statements: ${judgeResults.totalStatements}`);
    logger.info(`  Matched: ${judgeResults.matchedStatements}`);
    logger.info(`  Output: ${judgeFiles.join(', ')}\n`);
    
    // Test 2: Attorney objections and responses
    logger.info('TEST 2: Attorney Objections');
    logger.info('-'.repeat(40));
    const attorneyResults = await enhancedService.executeSearch({
      speakerType: ['ATTORNEY'],
      elasticSearchQueries: [{
        queryName: 'attorney_objections',
        queryString: 'objection OR move to strike OR non-responsive',
        fieldsToSearch: ['text']
      }],
      maxResults: 20,
      surroundingStatements: 3
    });
    
    const attorneyFiles = await enhancedService.exportResults(attorneyResults, {
      outputFileNameTemplate: `${outputDir}/attorney-objections`,
      outputFileTemplate: 'templates/courtroom-dialogue.txt'
    });
    
    testResults.push({
      test: 'Attorney Objections',
      totalStatements: attorneyResults.totalStatements,
      matchedStatements: attorneyResults.matchedStatements,
      outputFiles: attorneyFiles
    });
    
    logger.info(`  Total statements: ${attorneyResults.totalStatements}`);
    logger.info(`  Matched: ${attorneyResults.matchedStatements}`);
    logger.info(`  Output: ${attorneyFiles.join(', ')}\n`);
    
    // Test 3: Witness testimony about patents
    logger.info('TEST 3: Witness Patent Testimony');
    logger.info('-'.repeat(40));
    const witnessResults = await enhancedService.executeSearch({
      speakerType: ['WITNESS'],
      elasticSearchQueries: [{
        queryName: 'patent_testimony',
        queryString: 'patent AND (claim OR invention OR prior art)',
        fieldsToSearch: ['text']
      }],
      maxResults: 15,
      surroundingStatements: 4
    });
    
    const witnessFiles = await enhancedService.exportResults(witnessResults, {
      outputFileNameTemplate: `${outputDir}/witness-patents`,
      outputFileTemplate: 'templates/witness-testimony.txt'
    });
    
    testResults.push({
      test: 'Witness Patent Testimony',
      totalStatements: witnessResults.totalStatements,
      matchedStatements: witnessResults.matchedStatements,
      outputFiles: witnessFiles
    });
    
    logger.info(`  Total statements: ${witnessResults.totalStatements}`);
    logger.info(`  Matched: ${witnessResults.matchedStatements}`);
    logger.info(`  Output: ${witnessFiles.join(', ')}\n`);
    
    // Test 4: Dialogue sequences with line number continuity
    logger.info('TEST 4: Dialogue Sequences');
    logger.info('-'.repeat(40));
    const dialogueResults = await enhancedService.executeSearch({
      elasticSearchQueries: [{
        queryName: 'courtroom_dialogue',
        queryString: '(objection AND sustained) OR (move to strike) OR (non-responsive)',
        fieldsToSearch: ['text']
      }],
      maxResults: 25,
      surroundingStatements: 7
    });
    
    const dialogueFiles = await enhancedService.exportResults(dialogueResults, {
      outputFileNameTemplate: `${outputDir}/dialogue-sequences`,
      outputFileTemplate: 'templates/courtroom-dialogue.txt'
    });
    
    testResults.push({
      test: 'Dialogue Sequences',
      totalStatements: dialogueResults.totalStatements,
      matchedStatements: dialogueResults.matchedStatements,
      outputFiles: dialogueFiles
    });
    
    logger.info(`  Total statements: ${dialogueResults.totalStatements}`);
    logger.info(`  Matched: ${dialogueResults.matchedStatements}`);
    logger.info(`  Output: ${dialogueFiles.join(', ')}\n`);
    
    // Test 5: Specific speaker search (Mr. Hadden)
    logger.info('TEST 5: Mr. Hadden Statements');
    logger.info('-'.repeat(40));
    const haddenResults = await enhancedService.executeSearch({
      speakerPrefix: ['MR. HADDEN'],
      elasticSearchQueries: [{
        queryName: 'hadden_questions',
        queryString: 'patent OR claim OR delay OR microphone',
        fieldsToSearch: ['text']
      }],
      maxResults: 20,
      surroundingStatements: 2
    });
    
    const haddenFiles = await enhancedService.exportResults(haddenResults, {
      outputFileNameTemplate: `${outputDir}/hadden-statements`,
      outputFileTemplate: 'templates/default.txt'
    });
    
    testResults.push({
      test: 'Mr. Hadden Statements',
      totalStatements: haddenResults.totalStatements,
      matchedStatements: haddenResults.matchedStatements,
      outputFiles: haddenFiles
    });
    
    logger.info(`  Total statements: ${haddenResults.totalStatements}`);
    logger.info(`  Matched: ${haddenResults.matchedStatements}`);
    logger.info(`  Output: ${haddenFiles.join(', ')}\n`);
    
    // Test 6: Combined search with SQL and Elasticsearch
    logger.info('TEST 6: Combined Search (SQL + Elasticsearch)');
    logger.info('-'.repeat(40));
    const combinedQuery = {
      trialName: 'Vocalife LLC v. Amazon.com, Inc. et al',
      sessionDate: ['2020-10-02'],
      speakerType: ['JUDGE', 'ATTORNEY'],
      elasticSearchQueries: [{
        queryName: 'judicial_control',
        queryString: 'sustained OR overruled OR proceed',
        fieldsToSearch: ['text']
      }],
      hierarchical: true
    };
    
    const combinedResults = await combinedService.search(combinedQuery);
    const combinedPath = path.join(outputDir, 'combined-search.json');
    fs.writeFileSync(combinedPath, JSON.stringify(combinedResults, null, 2));
    
    testResults.push({
      test: 'Combined Search',
      totalStatements: combinedResults.totalStatements,
      matchedStatements: combinedResults.matchedStatements,
      outputFiles: [combinedPath]
    });
    
    logger.info(`  Total statements: ${combinedResults.totalStatements}`);
    logger.info(`  Matched: ${combinedResults.matchedStatements}`);
    logger.info(`  Output: ${combinedPath}\n`);
    
    // Generate summary report
    logger.info('===================================================');
    logger.info('TEST SUMMARY');
    logger.info('===================================================');
    
    const summaryPath = path.join(outputDir, 'test-summary.json');
    fs.writeFileSync(summaryPath, JSON.stringify({
      timestamp,
      testsRun: testResults.length,
      results: testResults,
      outputDirectory: outputDir
    }, null, 2));
    
    logger.info(`\nTotal tests run: ${testResults.length}`);
    logger.info(`Output directory: ${outputDir}`);
    logger.info(`Summary saved to: ${summaryPath}`);
    
    // Count total files generated
    const allFiles = fs.readdirSync(outputDir);
    const txtFiles = allFiles.filter(f => f.endsWith('.txt'));
    const jsonFiles = allFiles.filter(f => f.endsWith('.json'));
    
    logger.info(`\nFiles generated:`);
    logger.info(`  Text files: ${txtFiles.length}`);
    logger.info(`  JSON files: ${jsonFiles.length}`);
    logger.info(`  Total: ${allFiles.length}`);
    
    // Display a sample from one of the dialogue files
    if (dialogueFiles.length > 0) {
      const sampleFile = dialogueFiles.find(f => f.endsWith('.txt'));
      if (sampleFile && fs.existsSync(sampleFile)) {
        const sampleContent = fs.readFileSync(sampleFile, 'utf-8');
        const lines = sampleContent.split('\n').slice(0, 50);
        
        logger.info('\n===================================================');
        logger.info('SAMPLE OUTPUT (First 50 lines of dialogue sequences)');
        logger.info('===================================================');
        logger.info(lines.join('\n'));
      }
    }
    
    logger.info('\n✓ All tests completed successfully!');
    
    */
    

  } catch (error) {
    logger.error('Error running tests:', error);
    throw error;
  }
}

runAllTests().catch(console.error);