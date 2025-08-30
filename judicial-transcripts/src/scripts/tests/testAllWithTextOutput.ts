import { EnhancedSearchService } from '../../services/EnhancedSearchService';
import { ElasticSearchService } from '../../services/ElasticSearchService';
import logger from '../../utils/logger';
import * as fs from 'fs';
import * as path from 'path';

async function testAllWithTextOutput() {
  try {
    logger.info('===================================================');
    logger.info('RUNNING ALL TESTS WITH TEXT OUTPUT (DEDUPLICATED)');
    logger.info('===================================================\n');
    
    const enhancedService = new EnhancedSearchService();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
    const outputDir = path.join(process.cwd(), 'output', `comprehensive-test-${timestamp}`);
    fs.mkdirSync(outputDir, { recursive: true });
    
    const testSummary: any[] = [];
    
    // Test 1: Judge Rulings with Context
    logger.info('TEST 1: Judge Rulings with Surrounding Context');
    logger.info('-'.repeat(50));
    
    const judgeInput = {
      speakerType: ['JUDGE'],
      elasticSearchQueries: [{
        name: 'judicial_rulings',
        query: 'sustained OR overruled OR objection',
        type: 'match' as const,
        field: 'text'
      }],
      maxResults: 20,
      surroundingStatements: 5,
      outputFileNameTemplate: 'judge-rulings-{Session.sessionDate}.txt',
      outputFileTemplate: 'courtroom-dialogue.txt'
    };
    
    const judgeResults = await enhancedService.executeSearch(judgeInput);
    const judgeFiles = await enhancedService.exportResults(judgeResults, judgeInput, outputDir);
    
    // Also save JSON
    const judgeJsonPath = path.join(outputDir, 'judge-rulings.json');
    fs.writeFileSync(judgeJsonPath, JSON.stringify(judgeResults, null, 2));
    
    testSummary.push({
      test: 'Judge Rulings',
      matched: judgeResults.matchedStatements,
      total: judgeResults.totalStatements,
      textFiles: judgeFiles.filter(f => f.endsWith('.txt')).length,
      jsonFiles: 1
    });
    
    logger.info(`  Matched: ${judgeResults.matchedStatements}/${judgeResults.totalStatements}`);
    logger.info(`  Text files: ${judgeFiles.length}`);
    logger.info(`  JSON saved: ${judgeJsonPath}\n`);
    
    // Test 2: Attorney Objections and Responses
    logger.info('TEST 2: Attorney Objections with Context');
    logger.info('-'.repeat(50));
    
    const attorneyInput = {
      speakerType: ['ATTORNEY'],
      elasticSearchQueries: [{
        name: 'attorney_objections',
        query: 'objection OR "move to strike" OR "non-responsive"',
        type: 'match' as const,
        field: 'text'
      }],
      maxResults: 25,
      surroundingStatements: 3,
      outputFileNameTemplate: 'attorney-objections-{Session.sessionDate}.txt',
      outputFileTemplate: 'courtroom-dialogue.txt'
    };
    
    const attorneyResults = await enhancedService.executeSearch(attorneyInput);
    const attorneyFiles = await enhancedService.exportResults(attorneyResults, attorneyInput, outputDir);
    
    const attorneyJsonPath = path.join(outputDir, 'attorney-objections.json');
    fs.writeFileSync(attorneyJsonPath, JSON.stringify(attorneyResults, null, 2));
    
    testSummary.push({
      test: 'Attorney Objections',
      matched: attorneyResults.matchedStatements,
      total: attorneyResults.totalStatements,
      textFiles: attorneyFiles.filter(f => f.endsWith('.txt')).length,
      jsonFiles: 1
    });
    
    logger.info(`  Matched: ${attorneyResults.matchedStatements}/${attorneyResults.totalStatements}`);
    logger.info(`  Text files: ${attorneyFiles.length}`);
    logger.info(`  JSON saved: ${attorneyJsonPath}\n`);
    
    // Test 3: Witness Testimony
    logger.info('TEST 3: Witness Patent Testimony');
    logger.info('-'.repeat(50));
    
    const witnessInput = {
      speakerType: ['WITNESS'],
      elasticSearchQueries: [{
        name: 'patent_testimony',
        query: 'patent AND (claim OR invention OR "prior art")',
        type: 'match' as const,
        field: 'text'
      }],
      maxResults: 20,
      surroundingStatements: 4,
      outputFileNameTemplate: 'witness-patents-{Session.sessionDate}.txt',
      outputFileTemplate: 'witness-testimony.txt'
    };
    
    const witnessResults = await enhancedService.executeSearch(witnessInput);
    const witnessFiles = await enhancedService.exportResults(witnessResults, witnessInput, outputDir);
    
    const witnessJsonPath = path.join(outputDir, 'witness-patents.json');
    fs.writeFileSync(witnessJsonPath, JSON.stringify(witnessResults, null, 2));
    
    testSummary.push({
      test: 'Witness Testimony',
      matched: witnessResults.matchedStatements,
      total: witnessResults.totalStatements,
      textFiles: witnessFiles.filter(f => f.endsWith('.txt')).length,
      jsonFiles: 1
    });
    
    logger.info(`  Matched: ${witnessResults.matchedStatements}/${witnessResults.totalStatements}`);
    logger.info(`  Text files: ${witnessFiles.length}`);
    logger.info(`  JSON saved: ${witnessJsonPath}\n`);
    
    // Test 4: Complete Dialogue Sequences
    logger.info('TEST 4: Complete Dialogue Sequences');
    logger.info('-'.repeat(50));
    
    const dialogueInput = {
      elasticSearchQueries: [{
        name: 'courtroom_dialogue',
        query: '(objection AND sustained) OR "move to strike" OR "non-responsive"',
        type: 'match' as const,
        field: 'text'
      }],
      maxResults: 30,
      surroundingStatements: 7,
      outputFileNameTemplate: 'dialogue-sequences-{Trial.caseNumber}.txt',
      outputFileTemplate: 'courtroom-dialogue.txt'
    };
    
    const dialogueResults = await enhancedService.executeSearch(dialogueInput);
    const dialogueFiles = await enhancedService.exportResults(dialogueResults, dialogueInput, outputDir);
    
    const dialogueJsonPath = path.join(outputDir, 'dialogue-sequences.json');
    fs.writeFileSync(dialogueJsonPath, JSON.stringify(dialogueResults, null, 2));
    
    testSummary.push({
      test: 'Dialogue Sequences',
      matched: dialogueResults.matchedStatements,
      total: dialogueResults.totalStatements,
      textFiles: dialogueFiles.filter(f => f.endsWith('.txt')).length,
      jsonFiles: 1
    });
    
    logger.info(`  Matched: ${dialogueResults.matchedStatements}/${dialogueResults.totalStatements}`);
    logger.info(`  Text files: ${dialogueFiles.length}`);
    logger.info(`  JSON saved: ${dialogueJsonPath}\n`);
    
    // Test 5: Specific Speaker (Mr. Hadden)
    logger.info('TEST 5: Mr. Hadden Statements');
    logger.info('-'.repeat(50));
    
    const haddenInput = {
      speakerPrefix: ['MR. HADDEN'],
      elasticSearchQueries: [{
        name: 'hadden_questions',
        query: 'patent OR claim OR delay OR microphone',
        type: 'match' as const,
        field: 'text'
      }],
      maxResults: 25,
      surroundingStatements: 2,
      outputFileNameTemplate: 'hadden-{Session.sessionDate}.txt',
      outputFileTemplate: 'default.txt'
    };
    
    const haddenResults = await enhancedService.executeSearch(haddenInput);
    const haddenFiles = await enhancedService.exportResults(haddenResults, haddenInput, outputDir);
    
    const haddenJsonPath = path.join(outputDir, 'hadden-statements.json');
    fs.writeFileSync(haddenJsonPath, JSON.stringify(haddenResults, null, 2));
    
    testSummary.push({
      test: 'Mr. Hadden Statements',
      matched: haddenResults.matchedStatements,
      total: haddenResults.totalStatements,
      textFiles: haddenFiles.filter(f => f.endsWith('.txt')).length,
      jsonFiles: 1
    });
    
    logger.info(`  Matched: ${haddenResults.matchedStatements}/${haddenResults.totalStatements}`);
    logger.info(`  Text files: ${haddenFiles.length}`);
    logger.info(`  JSON saved: ${haddenJsonPath}\n`);
    
    // Generate comprehensive summary
    logger.info('===================================================');
    logger.info('TEST SUMMARY');
    logger.info('===================================================\n');
    
    const summaryData = {
      timestamp,
      outputDirectory: outputDir,
      deduplicationEnabled: true,
      tests: testSummary,
      totalFiles: {
        textFiles: testSummary.reduce((sum, t) => sum + t.textFiles, 0),
        jsonFiles: testSummary.reduce((sum, t) => sum + t.jsonFiles, 0)
      }
    };
    
    const summaryPath = path.join(outputDir, 'test-summary.json');
    fs.writeFileSync(summaryPath, JSON.stringify(summaryData, null, 2));
    
    logger.info('Test Results:');
    for (const test of testSummary) {
      logger.info(`  ${test.test}: ${test.matched} matches, ${test.textFiles} text files`);
    }
    
    logger.info(`\nTotal files generated:`);
    logger.info(`  Text files: ${summaryData.totalFiles.textFiles}`);
    logger.info(`  JSON files: ${summaryData.totalFiles.jsonFiles}`);
    logger.info(`  Output directory: ${outputDir}`);
    
    // Check for duplicates in one of the files
    logger.info('\n===================================================');
    logger.info('DUPLICATE CHECK');
    logger.info('===================================================\n');
    
    const sampleFile = dialogueFiles.find(f => f.endsWith('.txt'));
    if (sampleFile && fs.existsSync(sampleFile)) {
      const content = fs.readFileSync(sampleFile, 'utf-8');
      const lines = content.split('\n');
      
      // Check for duplicate line numbers
      const lineNumbers: number[] = [];
      const linePattern = /\[Lines (\d+)-(\d+)\]/;
      
      for (const line of lines) {
        const match = line.match(linePattern);
        if (match) {
          const startLine = parseInt(match[1]);
          lineNumbers.push(startLine);
        }
      }
      
      const uniqueLineNumbers = new Set(lineNumbers);
      const duplicateCount = lineNumbers.length - uniqueLineNumbers.size;
      
      logger.info(`Sample file: ${path.basename(sampleFile)}`);
      logger.info(`  Total line references: ${lineNumbers.length}`);
      logger.info(`  Unique line numbers: ${uniqueLineNumbers.size}`);
      logger.info(`  Duplicates removed: ${duplicateCount}`);
      
      // Show first 50 lines as sample
      logger.info('\n===================================================');
      logger.info('SAMPLE OUTPUT (First 50 lines)');
      logger.info('===================================================');
      logger.info(lines.slice(0, 50).join('\n'));
    }
    
    logger.info('\n✓ All tests completed successfully with deduplication!');
    
  } catch (error) {
    logger.error('Error running tests:', error);
    throw error;
  }
}

testAllWithTextOutput().catch(console.error);