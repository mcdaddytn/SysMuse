import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { CombinedSearchService, SearchQueryInput } from '../services/CombinedSearchService';
import { syncStatementEvents } from '../scripts/syncElasticsearch';
import logger from '../utils/logger';

const program = new Command();

program
  .name('transcript-search')
  .description('CLI for searching judicial transcripts with SQL and Elasticsearch')
  .version('1.0.0');

program
  .command('sync')
  .description('Sync all statement events to Elasticsearch')
  .action(async () => {
    try {
      logger.info('Starting Elasticsearch sync...');
      await syncStatementEvents();
      logger.info('Sync completed successfully');
    } catch (error) {
      logger.error('Sync failed:', error);
      process.exit(1);
    }
  });

program
  .command('query')
  .description('Execute a search query from JSON file')
  .option('-f, --file <path>', 'Path to JSON query file', './config/queries/query.json')
  .option('-o, --output <path>', 'Output directory for results', './output')
  .option('--format <type>', 'Output format (json, csv)', 'json')
  .action(async (options) => {
    try {
      const queryPath = path.resolve(options.file);
      
      if (!fs.existsSync(queryPath)) {
        logger.error(`Query file not found: ${queryPath}`);
        process.exit(1);
      }
      
      const queryInput: SearchQueryInput = JSON.parse(
        fs.readFileSync(queryPath, 'utf-8')
      );
      
      logger.info(`Loaded query from ${queryPath}`);
      logger.info('Query parameters:', queryInput);
      
      const searchService = new CombinedSearchService();
      
      logger.info('Executing search...');
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
      
      const outputDir = path.resolve(options.output);
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }
      
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const outputFileName = `search-results-${timestamp}.json`;
      const outputPath = path.join(outputDir, outputFileName);
      
      fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
      logger.info(`Results saved to: ${outputPath}`);
      
      await searchService.disconnect();
    } catch (error) {
      logger.error('Query execution failed:', error);
      process.exit(1);
    }
  });

program
  .command('batch')
  .description('Execute multiple search queries from a directory')
  .option('-d, --directory <path>', 'Directory containing query JSON files', './config/queries')
  .option('-o, --output <path>', 'Output directory for results', './output')
  .action(async (options) => {
    try {
      const queryDir = path.resolve(options.directory);
      const outputDir = path.resolve(options.output);
      
      if (!fs.existsSync(queryDir)) {
        logger.error(`Query directory not found: ${queryDir}`);
        process.exit(1);
      }
      
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }
      
      const queryFiles = fs.readdirSync(queryDir)
        .filter(file => file.endsWith('.json') && file.includes('query'));
      
      logger.info(`Found ${queryFiles.length} query files to execute`);
      
      const searchService = new CombinedSearchService();
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const batchOutputDir = path.join(outputDir, `batch-${timestamp}`);
      fs.mkdirSync(batchOutputDir, { recursive: true });
      
      const batchSummary: any[] = [];
      
      for (const queryFile of queryFiles) {
        const queryPath = path.join(queryDir, queryFile);
        logger.info(`\nProcessing query: ${queryFile}`);
        
        try {
          const queryInput: SearchQueryInput = JSON.parse(
            fs.readFileSync(queryPath, 'utf-8')
          );
          
          const results = await searchService.executeSearch(queryInput);
          
          const summary = {
            queryFile,
            totalStatements: results.totalStatements,
            matchedStatements: results.matchedStatements,
            elasticSearchSummary: results.elasticSearchSummary
          };
          
          batchSummary.push(summary);
          
          logger.info(`  Total statements: ${results.totalStatements}`);
          logger.info(`  Matched statements: ${results.matchedStatements}`);
          
          const outputFileName = queryFile.replace('.json', `-results-${timestamp}.json`);
          const outputPath = path.join(batchOutputDir, outputFileName);
          
          fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
          logger.info(`  Results saved to: ${outputFileName}`);
          
        } catch (error) {
          logger.error(`  Error processing ${queryFile}:`, error);
          batchSummary.push({
            queryFile,
            error: String(error)
          });
        }
      }
      
      const summaryPath = path.join(batchOutputDir, 'batch-summary.json');
      fs.writeFileSync(summaryPath, JSON.stringify(batchSummary, null, 2));
      logger.info(`\nBatch summary saved to: ${summaryPath}`);
      
      await searchService.disconnect();
    } catch (error) {
      logger.error('Batch execution failed:', error);
      process.exit(1);
    }
  });

program
  .command('example')
  .description('Generate example query JSON files')
  .option('-o, --output <path>', 'Output directory for example files', './config/queries')
  .action((options) => {
    try {
      const outputDir = path.resolve(options.output);
      
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }
      
      const examples = [
        {
          filename: 'query-example-basic.json',
          content: {
            trialName: "Example Trial Name",
            speakerType: "JUDGE",
            elasticSearchQueries: [
              {
                name: "objection_search",
                query: "objection",
                type: "match"
              }
            ]
          }
        },
        {
          filename: 'query-example-filters.json',
          content: {
            trialName: "Example Trial Name",
            sessionDate: ["2024-01-15", "2024-01-16"],
            sessionType: ["MORNING", "AFTERNOON"],
            speakerType: ["ATTORNEY", "WITNESS"],
            speakerPrefix: ["MR. SMITH", "MS. JONES"]
          }
        },
        {
          filename: 'query-example-elasticsearch.json',
          content: {
            trialName: "Example Trial Name",
            elasticSearchQueries: [
              {
                name: "sustained_objection",
                query: "objection sustained",
                type: "match_phrase",
                proximity: 3
              },
              {
                name: "overruled_objection",
                query: "objection overruled",
                type: "match_phrase",
                proximity: 3
              },
              {
                name: "hearsay",
                query: "hearsay",
                type: "match"
              }
            ]
          }
        }
      ];
      
      for (const example of examples) {
        const filePath = path.join(outputDir, example.filename);
        fs.writeFileSync(filePath, JSON.stringify(example.content, null, 2));
        logger.info(`Created example: ${example.filename}`);
      }
      
      logger.info(`\n✅ Example query files created in ${outputDir}`);
    } catch (error) {
      logger.error('Failed to create examples:', error);
      process.exit(1);
    }
  });

program.parse(process.argv);