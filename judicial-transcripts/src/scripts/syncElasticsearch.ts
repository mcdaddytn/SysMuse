import { PrismaClient } from '@prisma/client';
import { Client } from '@elastic/elasticsearch';
import logger from '../utils/logger';

const prisma = new PrismaClient();

const elasticClient = new Client({
  node: process.env.ELASTICSEARCH_URL || 'http://localhost:9200',
  auth: process.env.ELASTICSEARCH_API_KEY ? {
    apiKey: process.env.ELASTICSEARCH_API_KEY
  } : undefined
});

const indexName = 'judicial_statements';

async function createIndex() {
  try {
    const indexExists = await elasticClient.indices.exists({
      index: indexName
    });

    if (!indexExists) {
      await elasticClient.indices.create({
        index: indexName,
        body: {
          mappings: {
            properties: {
              statementEventId: { type: 'integer' },
              trialId: { type: 'integer' },
              trialName: { type: 'keyword' },
              sessionId: { type: 'integer' },
              sessionDate: { type: 'date' },
              sessionType: { type: 'keyword' },
              speakerId: { type: 'integer' },
              speakerType: { type: 'keyword' },
              speakerPrefix: { type: 'keyword' },
              speakerHandle: { type: 'keyword' },
              text: { 
                type: 'text',
                analyzer: 'standard',
                fields: {
                  keyword: { type: 'keyword' }
                }
              },
              startTime: { type: 'text' },
              endTime: { type: 'text' },
              startLineNumber: { type: 'integer' },
              endLineNumber: { type: 'integer' },
              createdAt: { type: 'date' }
            }
          }
        }
      });
      logger.info(`Created Elasticsearch index: ${indexName}`);
    } else {
      logger.info(`Elasticsearch index ${indexName} already exists`);
    }
  } catch (error) {
    logger.error('Error creating index:', error);
    throw error;
  }
}

async function syncStatementEvents() {
  try {
    await createIndex();

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

    logger.info(`Found ${statements.length} statement events to sync`);

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
        logger.info(`Synced ${synced}/${statements.length} statements`);
      }
    }

    logger.info(`✅ Successfully synced ${synced} statement events to Elasticsearch`);
    logger.info(`✅ Updated ${updated} StatementEvent records with elasticSearchId`);

  } catch (error) {
    logger.error('Error syncing statement events:', error);
    throw error;
  }
}

async function main() {
  try {
    logger.info('Starting Elasticsearch sync...');
    await syncStatementEvents();
    logger.info('Elasticsearch sync completed successfully');
  } catch (error) {
    logger.error('Sync failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main();
}

export { syncStatementEvents };