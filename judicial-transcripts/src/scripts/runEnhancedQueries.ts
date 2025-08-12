import { EnhancedSearchService } from '../services/EnhancedSearchService';
import { CombinedSearchService } from '../services/CombinedSearchService';
import logger from '../utils/logger';
import * as fs from 'fs';
import * as path from 'path';

async function runEnhancedQueries() {
  try {
    logger.info('===================================================');
    logger.info('RUNNING ENHANCED QUERY TESTS WITH TEXT OUTPUT');
    logger.info('Demonstrating deduplication and surrounding statements');
    logger.info('===================================================\n');
    
    const enhancedService = new EnhancedSearchService();
    const combinedService = new CombinedSearchService();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
    const outputDir = path.join(process.cwd(), 'output', `enhanced-queries-${timestamp}`);
    fs.mkdirSync(outputDir, { recursive: true });
    
    // Load and run all enhanced query configurations
    const configDir = path.join(process.cwd(), 'config', 'queries');
    const enhancedQueries = fs.readdirSync(configDir)
      .filter(f => f.startsWith('query-enhanced-') && f.endsWith('.json'))
      .sort();
    
    logger.info(`Found ${enhancedQueries.length} enhanced query configurations\n`);
    
    const results: any[] = [];
    
    for (const queryFile of enhancedQueries) {
      const queryPath = path.join(configDir, queryFile);
      const queryName = queryFile.replace('.json', '');
      
      logger.info(`\n${'='.repeat(60)}`);
      logger.info(`Running: ${queryName}`);
      logger.info('='.repeat(60));
      
      try {
        // Load query configuration
        const queryConfig = JSON.parse(fs.readFileSync(queryPath, 'utf-8'));
        
        // Add enhanced search parameters if not present
        if (!queryConfig.maxResults) queryConfig.maxResults = 20;
        if (!queryConfig.surroundingStatements) queryConfig.surroundingStatements = 5;
        
        // Set up output templates based on query type
        if (queryName.includes('judge')) {
          queryConfig.outputFileNameTemplate = `${queryName}-{Session.sessionDate}.txt`;
          queryConfig.outputFileTemplate = 'courtroom-dialogue.txt';
        } else if (queryName.includes('witness')) {
          queryConfig.outputFileNameTemplate = `${queryName}-{Session.sessionDate}.txt`;
          queryConfig.outputFileTemplate = 'witness-testimony.txt';
        } else if (queryName.includes('attorney')) {
          queryConfig.outputFileNameTemplate = `${queryName}-{Session.sessionDate}.txt`;
          queryConfig.outputFileTemplate = 'default.txt';
        } else {
          queryConfig.outputFileNameTemplate = `${queryName}.txt`;
          queryConfig.outputFileTemplate = 'courtroom-dialogue.txt';
        }
        
        logger.info('Configuration:');
        if (queryConfig.speakerType) logger.info(`  Speaker Type: ${queryConfig.speakerType}`);
        if (queryConfig.speakerPrefix) logger.info(`  Speaker Prefix: ${queryConfig.speakerPrefix}`);
        logger.info(`  Max Results: ${queryConfig.maxResults}`);
        logger.info(`  Surrounding Statements: ${queryConfig.surroundingStatements}`);
        
        // Execute the enhanced search
        const searchResults = await enhancedService.executeSearch(queryConfig);
        
        // Export to text files
        const textFiles = await enhancedService.exportResults(
          searchResults,
          queryConfig,
          outputDir
        );
        
        // Also save JSON
        const jsonPath = path.join(outputDir, `${queryName}.json`);
        fs.writeFileSync(jsonPath, JSON.stringify(searchResults, null, 2));
        
        // Report results
        logger.info(`\nResults:`);
        logger.info(`  Total statements: ${searchResults.totalStatements}`);
        logger.info(`  Matched statements: ${searchResults.matchedStatements}`);
        logger.info(`  Text files generated: ${textFiles.length}`);
        logger.info(`  JSON saved: ${path.basename(jsonPath)}`);
        
        // For query-enhanced-judge specifically, show sample output
        if (queryName === 'query-enhanced-judge' && textFiles.length > 0) {
          const sampleFile = textFiles[0];
          if (fs.existsSync(sampleFile)) {
            const content = fs.readFileSync(sampleFile, 'utf-8');
            const lines = content.split('\n');
            
            // Find a section with "sustained" or "overruled" to show context
            let sustainedIndex = -1;
            for (let i = 0; i < lines.length; i++) {
              if (lines[i].toLowerCase().includes('sustained') || 
                  lines[i].toLowerCase().includes('overruled')) {
                sustainedIndex = i;
                break;
              }
            }
            
            if (sustainedIndex >= 0) {
              logger.info('\n📍 SAMPLE OUTPUT showing surrounding context:');
              logger.info('  (Notice how objection → ruling sequence is preserved)');
              logger.info('  ' + '='.repeat(60));
              
              // Show 20 lines around the sustained/overruled ruling
              const startIdx = Math.max(0, sustainedIndex - 10);
              const endIdx = Math.min(lines.length, sustainedIndex + 10);
              
              for (let i = startIdx; i < endIdx; i++) {
                const prefix = i === sustainedIndex ? '  >>> ' : '      ';
                logger.info(prefix + lines[i]);
              }
              logger.info('  ' + '='.repeat(60));
            }
          }
        }
        
        // Check for duplicates in the output
        if (textFiles.length > 0) {
          const firstFile = textFiles[0];
          const content = fs.readFileSync(firstFile, 'utf-8');
          const lines = content.split('\n');
          
          // Extract line numbers
          const lineNumbers: number[] = [];
          const linePattern = /\[Lines (\d+)-(\d+)\]/;
          
          for (const line of lines) {
            const match = line.match(linePattern);
            if (match) {
              const startLine = parseInt(match[1]);
              lineNumbers.push(startLine);
            }
          }
          
          const uniqueLines = new Set(lineNumbers);
          const hasDuplicates = lineNumbers.length > uniqueLines.size;
          
          if (hasDuplicates) {
            logger.warn(`  ⚠️  Duplicates found: ${lineNumbers.length - uniqueLines.size} duplicate line references`);
          } else {
            logger.info(`  ✅ No duplicates: All ${uniqueLines.size} line references are unique`);
          }
        }
        
        results.push({
          query: queryName,
          totalStatements: searchResults.totalStatements,
          matchedStatements: searchResults.matchedStatements,
          textFiles: textFiles.length,
          files: textFiles.map(f => path.basename(f))
        });
        
      } catch (error: any) {
        logger.error(`Error running ${queryName}:`, error.message);
        results.push({
          query: queryName,
          error: error.message
        });
      }
    }
    
    // Generate final summary
    logger.info('\n' + '='.repeat(60));
    logger.info('FINAL SUMMARY');
    logger.info('='.repeat(60) + '\n');
    
    const successfulTests = results.filter(r => !r.error);
    const failedTests = results.filter(r => r.error);
    
    logger.info(`Tests run: ${results.length}`);
    logger.info(`Successful: ${successfulTests.length}`);
    logger.info(`Failed: ${failedTests.length}\n`);
    
    logger.info('Successful tests:');
    for (const test of successfulTests) {
      logger.info(`  ✅ ${test.query}: ${test.matchedStatements} matches, ${test.textFiles} files`);
      if (test.files && test.files.length > 0) {
        test.files.forEach((f: string) => logger.info(`     - ${f}`));
      }
    }
    
    if (failedTests.length > 0) {
      logger.info('\nFailed tests:');
      for (const test of failedTests) {
        logger.info(`  ❌ ${test.query}: ${test.error}`);
      }
    }
    
    // Count total files
    const allFiles = fs.readdirSync(outputDir);
    const textFiles = allFiles.filter(f => f.endsWith('.txt'));
    const jsonFiles = allFiles.filter(f => f.endsWith('.json'));
    
    logger.info(`\nTotal files generated:`);
    logger.info(`  Text files: ${textFiles.length}`);
    logger.info(`  JSON files: ${jsonFiles.length}`);
    logger.info(`  Output directory: ${outputDir}`);
    
    // Save summary
    const summaryPath = path.join(outputDir, 'test-summary.json');
    fs.writeFileSync(summaryPath, JSON.stringify({
      timestamp,
      outputDirectory: outputDir,
      testsRun: results.length,
      successful: successfulTests.length,
      failed: failedTests.length,
      results,
      deduplicationEnabled: true,
      surroundingStatementsFeature: true
    }, null, 2));
    
    logger.info(`\n✅ Enhanced query tests completed!`);
    logger.info(`Summary saved to: ${summaryPath}`);
    
  } catch (error) {
    logger.error('Error running enhanced queries:', error);
    throw error;
  }
}

runEnhancedQueries().catch(console.error);