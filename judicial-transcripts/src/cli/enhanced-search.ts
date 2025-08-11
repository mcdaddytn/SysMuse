import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { EnhancedSearchService, EnhancedSearchInput } from '../services/EnhancedSearchService';
import logger from '../utils/logger';

const program = new Command();

program
  .name('enhanced-search')
  .description('Enhanced CLI for searching judicial transcripts with templates and hierarchical output')
  .version('1.0.0');

program
  .command('query')
  .description('Execute an enhanced search query from JSON file')
  .option('-f, --file <path>', 'Path to JSON query file', './config/queries/query.json')
  .option('-o, --output <path>', 'Output directory for results', './output')
  .option('--json', 'Also save raw JSON results', false)
  .action(async (options) => {
    try {
      const queryPath = path.resolve(options.file);
      
      if (!fs.existsSync(queryPath)) {
        logger.error(`Query file not found: ${queryPath}`);
        process.exit(1);
      }
      
      const queryInput: EnhancedSearchInput = JSON.parse(
        fs.readFileSync(queryPath, 'utf-8')
      );
      
      logger.info(`Loaded query from ${queryPath}`);
      logger.info('Query parameters:', {
        trial: queryInput.trialName || queryInput.caseNumber,
        maxResults: queryInput.maxResults,
        surroundingStatements: queryInput.surroundingStatements,
        outputTemplate: queryInput.outputFileTemplate,
        outputFileNameTemplate: queryInput.outputFileNameTemplate
      });
      
      const searchService = new EnhancedSearchService();
      
      logger.info('Executing enhanced search...');
      const results = await searchService.executeSearch(queryInput);
      
      logger.info(`Search completed:`);
      logger.info(`  Total statements found: ${results.totalStatements}`);
      logger.info(`  Matched statements: ${results.matchedStatements}`);
      
      if (results.elasticSearchSummary) {
        logger.info('Elasticsearch query results:');
        for (const [queryName, summary] of Object.entries(results.elasticSearchSummary)) {
          logger.info(`  ${queryName}: ${summary.matched} matches (${summary.percentage}%)`);
        }
      }
      
      const timestamp = results.customParameters?.runTimeStamp || 
        new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
      const outputDir = path.join(path.resolve(options.output), `results-${timestamp}`);
      
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }
      
      const outputFiles = await searchService.exportResults(results, queryInput, outputDir);
      
      logger.info(`Output files created:`);
      outputFiles.forEach(file => {
        logger.info(`  ${file}`);
      });
      
      if (options.json) {
        const jsonPath = path.join(outputDir, 'raw-results.json');
        fs.writeFileSync(jsonPath, JSON.stringify(results, null, 2));
        logger.info(`  ${jsonPath} (JSON)`);
      }
      
      await searchService.disconnect();
    } catch (error) {
      logger.error('Query execution failed:', error);
      process.exit(1);
    }
  });

program
  .command('batch')
  .description('Execute multiple enhanced search queries')
  .option('-d, --directory <path>', 'Directory containing query JSON files', './config/queries')
  .option('-o, --output <path>', 'Output directory for results', './output')
  .option('--pattern <glob>', 'File pattern to match', '*.json')
  .action(async (options) => {
    try {
      const queryDir = path.resolve(options.directory);
      const outputBaseDir = path.resolve(options.output);
      
      if (!fs.existsSync(queryDir)) {
        logger.error(`Query directory not found: ${queryDir}`);
        process.exit(1);
      }
      
      const queryFiles = fs.readdirSync(queryDir)
        .filter(file => file.endsWith('.json'));
      
      logger.info(`Found ${queryFiles.length} query files`);
      
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
      const batchOutputDir = path.join(outputBaseDir, `batch-${timestamp}`);
      
      if (!fs.existsSync(batchOutputDir)) {
        fs.mkdirSync(batchOutputDir, { recursive: true });
      }
      
      const searchService = new EnhancedSearchService();
      const results: any[] = [];
      
      for (const queryFile of queryFiles) {
        const queryPath = path.join(queryDir, queryFile);
        const queryName = path.basename(queryFile, '.json');
        
        try {
          logger.info(`\nProcessing: ${queryFile}`);
          
          const queryInput: EnhancedSearchInput = JSON.parse(
            fs.readFileSync(queryPath, 'utf-8')
          );
          
          const searchResults = await searchService.executeSearch(queryInput);
          
          const queryOutputDir = path.join(batchOutputDir, queryName);
          if (!fs.existsSync(queryOutputDir)) {
            fs.mkdirSync(queryOutputDir, { recursive: true });
          }
          
          const outputFiles = await searchService.exportResults(
            searchResults,
            queryInput,
            queryOutputDir
          );
          
          results.push({
            queryFile: queryFile,
            status: 'success',
            totalStatements: searchResults.totalStatements,
            matchedStatements: searchResults.matchedStatements,
            outputFiles: outputFiles,
            elasticSearchSummary: searchResults.elasticSearchSummary
          });
          
          logger.info(`  Success: ${searchResults.matchedStatements}/${searchResults.totalStatements} matches`);
          logger.info(`  Output: ${outputFiles.length} file(s) created`);
        } catch (error) {
          logger.error(`  Failed: ${error}`);
          results.push({
            queryFile: queryFile,
            status: 'error',
            error: String(error)
          });
        }
      }
      
      const summaryPath = path.join(batchOutputDir, 'batch-summary.json');
      fs.writeFileSync(summaryPath, JSON.stringify({
        timestamp: new Date().toISOString(),
        totalQueries: queryFiles.length,
        successfulQueries: results.filter(r => r.status === 'success').length,
        failedQueries: results.filter(r => r.status === 'error').length,
        queries: results
      }, null, 2));
      
      logger.info(`\nBatch processing complete`);
      logger.info(`Summary saved to: ${summaryPath}`);
      
      await searchService.disconnect();
    } catch (error) {
      logger.error('Batch execution failed:', error);
      process.exit(1);
    }
  });

program
  .command('example')
  .description('Generate example query configuration files')
  .option('-o, --output <path>', 'Output directory for examples', './config/queries')
  .action(async (options) => {
    try {
      const outputDir = path.resolve(options.output);
      
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }
      
      const examples = [
        {
          name: 'query-enhanced-judge.json',
          config: {
            caseNumber: '2:19-CV-00123-JRG',
            speakerType: 'JUDGE',
            maxResults: 50,
            surroundingStatements: 2,
            outputFileNameTemplate: 'judge-statements-{caseHandle}.txt',
            outputFileTemplate: 'judge-statements.txt',
            resultSeparator: '\n\n---\n\n',
            elasticSearchQueries: [
              {
                name: 'sustained',
                query: 'sustained',
                type: 'match'
              },
              {
                name: 'overruled',
                query: 'overruled',
                type: 'match'
              }
            ]
          }
        },
        {
          name: 'query-enhanced-objections.json',
          config: {
            trialName: 'VOCALIFE LLC, PLAINTIFF, VS. AMAZON.COM, INC. and AMAZON.COM LLC, DEFENDANTS.',
            speakerType: 'ATTORNEY',
            maxResults: 100,
            surroundingStatements: 3,
            outputFileNameTemplate: 'objections-{Speaker.speakerPrefix}.txt',
            outputFileTemplate: 'objection-context.txt',
            elasticSearchQueries: [
              {
                name: 'objection',
                query: 'objection',
                type: 'match'
              }
            ]
          }
        },
        {
          name: 'query-enhanced-witness.json',
          config: {
            caseNumber: '2:19-CV-00123-JRG',
            speakerType: 'WITNESS',
            speakerPrefix: ['ALAN RATLIFF', 'JOSEPH C. MCALEXANDER, III'],
            maxResults: 50,
            surroundingStatements: 1,
            outputFileNameTemplate: 'witness-{Speaker.speakerPrefix}-testimony.txt',
            outputFileTemplate: 'witness-testimony.txt',
            resultSeparator: '\n\n=========\n\n',
            elasticSearchQueries: [
              {
                name: 'yes_no',
                query: 'yes no',
                type: 'match'
              }
            ]
          }
        }
      ];
      
      for (const example of examples) {
        const filePath = path.join(outputDir, example.name);
        fs.writeFileSync(filePath, JSON.stringify(example.config, null, 2));
        logger.info(`Created example: ${filePath}`);
      }
      
      logger.info('\nExample query files created successfully');
      logger.info('These examples demonstrate:');
      logger.info('  - Using caseNumber instead of trialName');
      logger.info('  - maxResults to limit output');
      logger.info('  - surroundingStatements for context');
      logger.info('  - Dynamic file naming with templates');
      logger.info('  - Custom output templates');
      logger.info('  - Custom result separators');
    } catch (error) {
      logger.error('Failed to create examples:', error);
      process.exit(1);
    }
  });

program.parse(process.argv);