import { Client } from '@elastic/elasticsearch';
import { PrismaClient } from '@prisma/client';
import logger from '../utils/logger';
import { program } from 'commander';

async function resetElasticsearch(options: { resync?: boolean, force?: boolean }) {
  const elasticClient = new Client({
    node: process.env.ELASTICSEARCH_URL || 'http://localhost:9200'
  });
  
  const indexName = 'judicial_statements';
  
  try {
    logger.info('===================================================');
    logger.info('ELASTICSEARCH INDEX RESET UTILITY');
    logger.info('===================================================\n');
    
    // Check if index exists
    const indexExists = await elasticClient.indices.exists({ index: indexName });
    
    if (indexExists) {
      // Get document count before deletion
      const countResponse = await elasticClient.count({ index: indexName });
      const docCount = countResponse.count;
      
      logger.info(`Current index '${indexName}' contains ${docCount} documents`);
      
      if (!options.force) {
        logger.warn('⚠️  WARNING: This will permanently delete all data in the Elasticsearch index!');
        logger.warn('Use --force flag to confirm deletion');
        process.exit(1);
      }
      
      // Delete the index
      logger.info(`Deleting index '${indexName}'...`);
      await elasticClient.indices.delete({ index: indexName });
      logger.info('✅ Index deleted successfully');
    } else {
      logger.info(`Index '${indexName}' does not exist`);
    }
    
    // Recreate the index with proper mappings
    logger.info(`Creating new index '${indexName}' with mappings...`);
    await elasticClient.indices.create({
      index: indexName,
      body: {
        mappings: {
          properties: {
            text: {
              type: 'text',
              analyzer: 'standard'
            },
            trialId: {
              type: 'integer'
            },
            sessionId: {
              type: 'integer'
            },
            speakerId: {
              type: 'integer'
            },
            speakerType: {
              type: 'keyword'
            },
            speakerPrefix: {
              type: 'keyword'
            },
            speakerHandle: {
              type: 'keyword'
            },
            startLineNumber: {
              type: 'integer'
            },
            endLineNumber: {
              type: 'integer'
            },
            startTime: {
              type: 'text'
            },
            endTime: {
              type: 'text'
            },
            sessionDate: {
              type: 'date'
            },
            sessionType: {
              type: 'keyword'
            },
            caseNumber: {
              type: 'keyword'
            },
            trialName: {
              type: 'text'
            }
          }
        },
        settings: {
          number_of_shards: 1,
          number_of_replicas: 0,
          analysis: {
            analyzer: {
              standard: {
                type: 'standard',
                stopwords: '_none_'
              }
            }
          }
        }
      }
    });
    logger.info('✅ Index created successfully with mappings');
    
    // Verify the new index
    const health = await elasticClient.cluster.health({ index: indexName });
    logger.info(`Index health status: ${health.status}`);
    
    // Resync data from database if requested
    if (options.resync) {
      logger.info('\n---------------------------------------------------');
      logger.info('RESYNCING DATA FROM DATABASE');
      logger.info('---------------------------------------------------');
      
      const prisma = new PrismaClient();
      
      try {
        // Get all statements with their related data
        const statements = await prisma.statementEvent.findMany({
          include: {
            event: {
              include: {
                trial: true,
                session: true
              }
            },
            speaker: true
          }
        });
        
        logger.info(`Found ${statements.length} statements in database to sync`);
        
        if (statements.length > 0) {
          // Prepare bulk indexing
          const bulkBody: any[] = [];
          let indexedCount = 0;
          
          for (const statement of statements) {
            if (statement.elasticSearchId) {
              const esDocument = {
                text: statement.text,
                trialId: statement.event.trialId,
                sessionId: statement.event.sessionId,
                speakerId: statement.speakerId,
                speakerType: statement.speaker?.speakerType || null,
                speakerPrefix: statement.speaker?.speakerPrefix || null,
                speakerHandle: statement.speaker?.speakerHandle || null,
                startLineNumber: statement.event.startLineNumber,
                endLineNumber: statement.event.endLineNumber,
                startTime: statement.event.startTime,
                endTime: statement.event.endTime,
                sessionDate: statement.event.session?.sessionDate || null,
                sessionType: statement.event.session?.sessionType || null,
                caseNumber: statement.event.trial.caseNumber,
                trialName: statement.event.trial.name
              };
              
              bulkBody.push(
                { index: { _index: indexName, _id: statement.elasticSearchId } },
                esDocument
              );
              
              // Send in batches of 500
              if (bulkBody.length >= 1000) { // 500 documents * 2 (action + doc)
                const result = await elasticClient.bulk({ body: bulkBody });
                
                if (!result.errors) {
                  indexedCount += bulkBody.length / 2;
                  logger.info(`  Indexed ${indexedCount} documents...`);
                } else {
                  logger.error('Bulk indexing errors:', result.items.filter((item: any) => item.index?.error));
                }
                
                bulkBody.length = 0; // Clear the array
              }
            }
          }
          
          // Index remaining documents
          if (bulkBody.length > 0) {
            const result = await elasticClient.bulk({ body: bulkBody });
            
            if (!result.errors) {
              indexedCount += bulkBody.length / 2;
            } else {
              logger.error('Bulk indexing errors:', result.items.filter((item: any) => item.index?.error));
            }
          }
          
          logger.info(`✅ Successfully indexed ${indexedCount} documents`);
          
          // Refresh the index to make documents searchable
          await elasticClient.indices.refresh({ index: indexName });
          logger.info('✅ Index refreshed and ready for searching');
          
          // Verify the sync
          const finalCount = await elasticClient.count({ index: indexName });
          logger.info(`\nFinal document count in Elasticsearch: ${finalCount.count}`);
        }
        
      } finally {
        await prisma.$disconnect();
      }
    }
    
    logger.info('\n===================================================');
    logger.info('ELASTICSEARCH RESET COMPLETE');
    logger.info('===================================================');
    
  } catch (error) {
    logger.error('Error resetting Elasticsearch:', error);
    process.exit(1);
  }
}

// CLI setup
program
  .name('reset-elasticsearch')
  .description('Reset Elasticsearch index by deleting all data and optionally resyncing from database')
  .option('-f, --force', 'Force deletion without confirmation')
  .option('-r, --resync', 'Resync data from database after reset')
  .action(async (options) => {
    await resetElasticsearch(options);
    process.exit(0);
  });

program.parse(process.argv);