import { PrismaClient } from '@prisma/client';
import { Client } from '@elastic/elasticsearch';
import { ElasticsearchLifecycleService } from '../services/ElasticsearchLifecycleService';
import logger from '../utils/logger';

const prisma = new PrismaClient();

/**
 * Sync statement events for a specific trial to its dedicated Phase 2 index
 */
export async function syncTrialStatementEvents(
  trialId: number,
  lifecycleService?: ElasticsearchLifecycleService
): Promise<void> {
  const service = lifecycleService || new ElasticsearchLifecycleService();
  
  try {
    // Prepare the trial-specific index
    const indexName = await service.preparePhase2Index(trialId);
    logger.info(`Using index ${indexName} for trial ${trialId}`);
    
    const elasticClient = new Client({
      node: process.env.ELASTICSEARCH_URL || 'http://localhost:9200',
      auth: process.env.ELASTICSEARCH_API_KEY ? {
        apiKey: process.env.ELASTICSEARCH_API_KEY
      } : undefined
    });
    
    // Get all statement events for this trial
    const statements = await prisma.statementEvent.findMany({
      where: {
        event: {
          trialId
        }
      },
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
    
    logger.info(`Found ${statements.length} statement events for trial ${trialId}`);
    
    if (statements.length === 0) {
      logger.warn(`No statement events found for trial ${trialId}`);
      return;
    }
    
    const batchSize = 100;
    let synced = 0;
    let updated = 0;
    
    for (let i = 0; i < statements.length; i += batchSize) {
      const batch = statements.slice(i, i + batchSize);
      const bulkOperations: any[] = [];
      
      for (const statement of batch) {
        const documentId = `statement_${statement.id}`;
        
        const document = {
          statementEventId: statement.id,
          trialId: statement.event.trialId,
          trialName: statement.event.trial.name,
          sessionId: statement.event.sessionId,
          sessionDate: statement.event.session?.sessionDate,
          sessionType: statement.event.session?.sessionType,
          speakerId: statement.speakerId,
          speakerType: statement.speaker?.speakerType,
          speakerPrefix: statement.speaker?.speakerPrefix,
          speakerHandle: statement.speaker?.speakerHandle,
          text: statement.text,
          startTime: statement.event.startTime,
          endTime: statement.event.endTime,
          startLineNumber: statement.event.startLineNumber,
          endLineNumber: statement.event.endLineNumber,
          createdAt: statement.event.createdAt
        };
        
        bulkOperations.push(
          { index: { _index: indexName, _id: documentId } },
          document
        );
      }
      
      if (bulkOperations.length > 0) {
        const bulkResponse = await elasticClient.bulk({
          body: bulkOperations
        });
        
        if (bulkResponse.errors) {
          logger.error('Bulk indexing errors:', bulkResponse.items.filter((item: any) => item.index?.error));
        }
        
        // Update statement events with ES IDs
        for (const item of batch) {
          if (!item.elasticSearchId) {
            await prisma.statementEvent.update({
              where: { id: item.id },
              data: { elasticSearchId: `statement_${item.id}` }
            });
            updated++;
          }
        }
        
        synced += batch.length;
        logger.info(`Synced ${synced}/${statements.length} statements for trial ${trialId}`);
      }
    }
    
    // Update processing status
    await prisma.trialProcessingStatus.upsert({
      where: { trialId },
      update: {
        phase2DocumentCount: synced,
        phase2CompletedAt: new Date()
      },
      create: {
        trialId,
        phase2DocumentCount: synced,
        phase2CompletedAt: new Date()
      }
    });
    
    logger.info(`✅ Successfully synced ${synced} statement events for trial ${trialId}`);
    logger.info(`✅ Updated ${updated} StatementEvent records with elasticSearchId`);
    
  } catch (error) {
    logger.error(`Error syncing statement events for trial ${trialId}:`, error);
    throw error;
  } finally {
    if (!lifecycleService) {
      await service.disconnect();
    }
  }
}

/**
 * Clean up Phase 2 Elasticsearch data after Phase 3 completion
 */
export async function cleanupTrialElasticsearch(
  trialId: number,
  lifecycleService?: ElasticsearchLifecycleService
): Promise<void> {
  const service = lifecycleService || new ElasticsearchLifecycleService();
  
  try {
    logger.info(`Starting Elasticsearch cleanup for trial ${trialId}`);
    await service.cleanupPhase2Data(trialId);
    logger.info(`✅ Completed Elasticsearch cleanup for trial ${trialId}`);
  } catch (error) {
    logger.error(`Error cleaning up Elasticsearch for trial ${trialId}:`, error);
    throw error;
  } finally {
    if (!lifecycleService) {
      await service.disconnect();
    }
  }
}

/**
 * Index Phase 3 marker sections to permanent index
 */
export async function indexTrialMarkerSections(
  trialId: number,
  lifecycleService?: ElasticsearchLifecycleService
): Promise<void> {
  const service = lifecycleService || new ElasticsearchLifecycleService();
  
  try {
    logger.info(`Starting Phase 3 marker section indexing for trial ${trialId}`);
    await service.indexPhase3MarkerSections(trialId);
    logger.info(`✅ Completed Phase 3 indexing for trial ${trialId}`);
  } catch (error) {
    logger.error(`Error indexing Phase 3 data for trial ${trialId}:`, error);
    throw error;
  } finally {
    if (!lifecycleService) {
      await service.disconnect();
    }
  }
}

// For backward compatibility - sync all trials (not recommended for production)
export async function syncStatementEvents(): Promise<void> {
  logger.warn('⚠️  Using legacy syncStatementEvents - consider using syncTrialStatementEvents for better resource management');
  
  const trials = await prisma.trial.findMany({
    select: { id: true, name: true }
  });
  
  for (const trial of trials) {
    logger.info(`Syncing trial ${trial.id}: ${trial.name}`);
    await syncTrialStatementEvents(trial.id);
  }
}

// CLI entry point
if (require.main === module) {
  const args = process.argv.slice(2);
  const trialId = args[0] ? parseInt(args[0]) : null;
  
  if (!trialId) {
    console.error('Usage: npx ts-node src/scripts/syncElasticsearchLifecycle.ts <trialId>');
    process.exit(1);
  }
  
  syncTrialStatementEvents(trialId)
    .then(() => {
      logger.info('Sync completed');
      process.exit(0);
    })
    .catch((error) => {
      logger.error('Sync failed:', error);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}