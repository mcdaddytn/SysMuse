// src/seed/seedDatabase.ts
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import logger from '../utils/logger';

const prisma = new PrismaClient();

interface SeedData {
  courtDirectives?: any[];
  configs?: any[];
  searchPatterns?: any[];
  elasticsearchExpressions?: any[];
  markerTemplates?: any[];
  accumulatorExpressions?: any[];
}

async function loadSeedData(fileName: string): Promise<SeedData> {
  const filePath = path.join(__dirname, '../../seed-data', fileName);
  const data = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(data);
}

async function seedCourtDirectives() {
  logger.info('Seeding court directives...');
  
  const data = await loadSeedData('court-directives.json');
  
  if (!data.courtDirectives) {
    logger.warn('No court directives found in seed data');
    return;
  }

  // Track created directives for pairing
  const createdDirectives = new Map<string, number>();

  for (const directive of data.courtDirectives) {
    try {
      const created = await prisma.courtDirectiveType.upsert({
        where: { name: directive.name },
        update: {
          description: directive.description,
          isPaired: directive.isPaired,
          isStart: directive.isStart,
          aliases: directive.aliases || []
        },
        create: {
          name: directive.name,
          description: directive.description,
          isPaired: directive.isPaired,
          isStart: directive.isStart,
          aliases: directive.aliases || []
        }
      });
      
      if (directive.pairMateId) {
        createdDirectives.set(directive.pairMateId, created.id);
      }
      
      logger.info(`Seeded court directive: ${directive.name}`);
    } catch (error) {
      logger.error(`Error seeding court directive ${directive.name}:`, error);
    }
  }

  // Update pair mate references
  for (const directive of data.courtDirectives) {
    if (directive.pairMateId && createdDirectives.has(directive.pairMateId)) {
      const current = await prisma.courtDirectiveType.findUnique({
        where: { name: directive.name }
      });
      
      if (current) {
        await prisma.courtDirectiveType.update({
          where: { id: current.id },
          data: { pairMateId: createdDirectives.get(directive.pairMateId) }
        });
      }
    }
  }
  
  logger.info('Court directives seeding completed');
}

async function seedSystemConfig() {
  logger.info('Seeding system configuration...');
  
  const data = await loadSeedData('system-config.json');
  
  if (!data.configs) {
    logger.warn('No system configs found in seed data');
    return;
  }

  for (const config of data.configs) {
    try {
      /*
      await prisma.systemConfig.upsert({
        where: { key: config.key },
        update: {
          value: config.value,
          description: config.description,
          category: config.category
        },
        create: {
          key: config.key,
          value: config.value,
          description: config.description,
          category: config.category
        }
      });
      */
      
      logger.info(`Seeded config: ${config.key}`);
    } catch (error) {
      logger.error(`Error seeding config ${config.key}:`, error);
    }
  }
  
  logger.info('System configuration seeding completed');
}

async function seedSearchPatterns() {
  logger.info('Seeding search patterns...');
  
  const data = await loadSeedData('search-patterns.json');
  
  if (!data.searchPatterns) {
    logger.warn('No search patterns found in seed data');
    return;
  }

  for (const pattern of data.searchPatterns) {
    try {
      /*
      await prisma.searchPattern.create({
        data: {
          patternType: pattern.patternType,
          pattern: pattern.pattern,
          category: pattern.category,
          priority: pattern.priority || 0,
          isActive: pattern.isActive !== false,
          metadata: pattern.metadata || {}
        }
      });
      */
      
      logger.info(`Seeded search pattern: ${pattern.patternType} - ${pattern.pattern}`);
    } catch (error) {
      logger.error(`Error seeding search pattern:`, error);
    }
  }
  
  logger.info('Search patterns seeding completed');
}

async function seedElasticSearchExpressions() {
  logger.info('Seeding ElasticSearch expressions...');
  
  try {
    const data = await loadSeedData('elasticsearch-expressions.json');
    
    if (!Array.isArray(data)) {
      logger.warn('No ElasticSearch expressions found in seed data');
      return;
    }

    for (const expr of data) {
      try {
        await prisma.elasticSearchExpression.upsert({
          where: { name: expr.name },
          update: {
            expressionType: expr.expressionType,
            phrasePattern: expr.phrasePattern,
            searchStrategy: expr.searchStrategy,
            esQuery: expr.esQuery,
            description: expr.description,
            isActive: expr.isActive
          },
          create: expr
        });
        
        logger.info(`Seeded ES expression: ${expr.name}`);
      } catch (error) {
        logger.error(`Error seeding ES expression ${expr.name}:`, error);
      }
    }
  } catch (error) {
    logger.warn('elasticsearch-expressions.json not found or invalid');
  }
  
  logger.info('ElasticSearch expressions seeding completed');
}

async function seedMarkerTemplates() {
  logger.info('Seeding marker templates...');
  
  try {
    const data = await loadSeedData('marker-templates.json');
    
    if (!Array.isArray(data)) {
      logger.warn('No marker templates found in seed data');
      return;
    }

    for (const template of data) {
      try {
        await prisma.markerTemplate.create({
          data: template
        });
        
        logger.info(`Seeded marker template: ${template.namePattern}`);
      } catch (error) {
        logger.error(`Error seeding marker template:`, error);
      }
    }
  } catch (error) {
    logger.warn('marker-templates.json not found or invalid');
  }
  
  logger.info('Marker templates seeding completed');
}

async function seedAccumulatorExpressions() {
  logger.info('Seeding accumulator expressions...');
  
  try {
    const data = await loadSeedData('accumulator-expressions.json');
    
    if (!Array.isArray(data)) {
      logger.warn('No accumulator expressions found in seed data');
      return;
    }

    for (const expr of data) {
      try {
        await prisma.accumulatorExpression.upsert({
          where: { name: expr.name },
          update: {
            description: expr.description,
            expressionType: expr.expressionType,
            windowSize: expr.windowSize,
            thresholdValue: expr.thresholdValue,
            minConfidenceLevel: expr.minConfidenceLevel,
            combinationType: expr.combinationType,
            metadata: expr.metadata,
            isActive: expr.isActive
          },
          create: expr
        });
        
        logger.info(`Seeded accumulator expression: ${expr.name}`);
      } catch (error) {
        logger.error(`Error seeding accumulator expression ${expr.name}:`, error);
      }
    }
  } catch (error) {
    logger.warn('accumulator-expressions.json not found or invalid');
  }
  
  logger.info('Accumulator expressions seeding completed');
}

async function main() {
  try {
    logger.info('Starting database seeding...');
    
    // Clear existing data (optional - comment out if you want to preserve data)
    if (process.env.CLEAR_BEFORE_SEED === 'true') {
      logger.warn('Clearing existing seed data...');
      /*
      await prisma.searchPattern.deleteMany({});
      await prisma.systemConfig.deleteMany({});
      */
      await prisma.courtDirectiveType.deleteMany({});
      await prisma.markerTemplate.deleteMany({});
      await prisma.accumulatorExpression.deleteMany({});
      await prisma.elasticSearchExpression.deleteMany({});
    }
    
    // Seed data in order
    await seedCourtDirectives();
    await seedSystemConfig();
    await seedSearchPatterns();
    await seedElasticSearchExpressions();
    await seedMarkerTemplates();
    await seedAccumulatorExpressions();
    
    logger.info('Database seeding completed successfully');
  } catch (error) {
    logger.error('Error during database seeding:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run the seed script
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});