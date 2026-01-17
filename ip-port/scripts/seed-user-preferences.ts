/**
 * Seed User Preferences to PostgreSQL
 *
 * Reads config/user-preferences-seed.json and populates:
 * - UserWeightProfile
 * - UserSector
 * - SearchTerm
 * - DiscoveryStrategy
 *
 * Usage: npx tsx scripts/seed-user-preferences.ts [--clear]
 *
 * Options:
 *   --clear  Clear existing data before seeding
 */

import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

interface SeedData {
  weightProfiles: Array<{
    name: string;
    description?: string;
    isDefault: boolean;
    weights: Record<string, number>;
  }>;
  sectors: Array<{
    name: string;
    description?: string;
    sectorType: string;
    sourceClusterId?: number;
    keyTerms: string[];
    cpcCodes: string[];
  }>;
  searchTerms: Array<{
    term: string;
    category: string;
    weight: number;
    source?: string;
    description?: string;
  }>;
  discoveryStrategies: Array<{
    strategyId: string;
    name: string;
    strategyType: string;
    description?: string;
    parameters?: Record<string, any>;
  }>;
}

/**
 * Load seed data from JSON
 */
function loadSeedData(): SeedData {
  const seedPath = path.join(process.cwd(), 'config/user-preferences-seed.json');

  if (!fs.existsSync(seedPath)) {
    throw new Error(`Seed file not found: ${seedPath}`);
  }

  return JSON.parse(fs.readFileSync(seedPath, 'utf-8'));
}

/**
 * Seed weight profiles
 */
async function seedWeightProfiles(profiles: SeedData['weightProfiles'], clear: boolean): Promise<number> {
  if (clear) {
    await prisma.userWeightProfile.deleteMany({});
    console.log('  Cleared existing weight profiles');
  }

  let count = 0;
  for (const profile of profiles) {
    try {
      await prisma.userWeightProfile.upsert({
        where: { name: profile.name },
        update: {
          description: profile.description,
          weights: profile.weights,
          isDefault: profile.isDefault,
          isActive: true,
          createdBy: 'seed-script'
        },
        create: {
          name: profile.name,
          description: profile.description,
          weights: profile.weights,
          isDefault: profile.isDefault,
          isActive: true,
          createdBy: 'seed-script'
        }
      });
      count++;
    } catch (error: any) {
      console.error(`  Error seeding profile "${profile.name}": ${error.message}`);
    }
  }

  return count;
}

/**
 * Seed sectors
 */
async function seedSectors(sectors: SeedData['sectors'], clear: boolean): Promise<number> {
  if (clear) {
    await prisma.userSectorPatent.deleteMany({});
    await prisma.userSector.deleteMany({});
    console.log('  Cleared existing sectors');
  }

  let count = 0;
  for (const sector of sectors) {
    try {
      await prisma.userSector.upsert({
        where: { name: sector.name },
        update: {
          description: sector.description,
          sectorType: sector.sectorType,
          sourceClusterId: sector.sourceClusterId,
          keyTerms: sector.keyTerms,
          cpcCodes: sector.cpcCodes,
          isActive: true,
          createdBy: 'seed-script'
        },
        create: {
          name: sector.name,
          description: sector.description,
          sectorType: sector.sectorType,
          sourceClusterId: sector.sourceClusterId,
          keyTerms: sector.keyTerms,
          cpcCodes: sector.cpcCodes,
          isActive: true,
          createdBy: 'seed-script'
        }
      });
      count++;
    } catch (error: any) {
      console.error(`  Error seeding sector "${sector.name}": ${error.message}`);
    }
  }

  return count;
}

/**
 * Seed search terms
 */
async function seedSearchTerms(terms: SeedData['searchTerms'], clear: boolean): Promise<number> {
  if (clear) {
    await prisma.searchTermHit.deleteMany({});
    await prisma.searchTerm.deleteMany({});
    console.log('  Cleared existing search terms');
  }

  let count = 0;
  for (const term of terms) {
    try {
      await prisma.searchTerm.upsert({
        where: {
          term_category: {
            term: term.term,
            category: term.category
          }
        },
        update: {
          weight: term.weight,
          source: term.source,
          description: term.description,
          isActive: true,
          createdBy: 'seed-script'
        },
        create: {
          term: term.term,
          category: term.category,
          weight: term.weight,
          source: term.source,
          description: term.description,
          isActive: true,
          createdBy: 'seed-script'
        }
      });
      count++;
    } catch (error: any) {
      console.error(`  Error seeding term "${term.term}": ${error.message}`);
    }
  }

  return count;
}

/**
 * Seed discovery strategies
 */
async function seedDiscoveryStrategies(strategies: SeedData['discoveryStrategies'], clear: boolean): Promise<number> {
  if (clear) {
    await prisma.discoveryStrategy.deleteMany({});
    console.log('  Cleared existing discovery strategies');
  }

  let count = 0;
  for (const strategy of strategies) {
    try {
      await prisma.discoveryStrategy.upsert({
        where: { strategyId: strategy.strategyId },
        update: {
          name: strategy.name,
          strategyType: strategy.strategyType,
          description: strategy.description,
          parameters: strategy.parameters || null,
          isActive: true
        },
        create: {
          strategyId: strategy.strategyId,
          name: strategy.name,
          strategyType: strategy.strategyType,
          description: strategy.description,
          parameters: strategy.parameters || null,
          isActive: true
        }
      });
      count++;
    } catch (error: any) {
      console.error(`  Error seeding strategy "${strategy.strategyId}": ${error.message}`);
    }
  }

  return count;
}

/**
 * Main seeding function
 */
async function main() {
  const args = process.argv.slice(2);
  const clear = args.includes('--clear');

  console.log('='.repeat(60));
  console.log('Seed User Preferences to PostgreSQL');
  console.log('='.repeat(60));

  if (clear) {
    console.log('\nWARNING: --clear flag set, existing data will be deleted\n');
  }

  // Load seed data
  console.log('Loading seed data from config/user-preferences-seed.json...');
  const seedData = loadSeedData();

  console.log(`  Weight profiles: ${seedData.weightProfiles?.length || 0}`);
  console.log(`  Sectors: ${seedData.sectors?.length || 0}`);
  console.log(`  Search terms: ${seedData.searchTerms?.length || 0}`);
  console.log(`  Discovery strategies: ${seedData.discoveryStrategies?.length || 0}`);

  // Test connection
  console.log('\nConnecting to PostgreSQL...');
  try {
    await prisma.$connect();
    console.log('  Connected successfully');
  } catch (error: any) {
    console.error(`  Connection failed: ${error.message}`);
    console.log('\nMake sure Docker is running and database is migrated:');
    console.log('  docker-compose up -d');
    console.log('  npx prisma db push');
    process.exit(1);
  }

  // Seed data
  console.log('\nSeeding weight profiles...');
  const profileCount = await seedWeightProfiles(seedData.weightProfiles || [], clear);
  console.log(`  Seeded ${profileCount} profiles`);

  console.log('\nSeeding sectors...');
  const sectorCount = await seedSectors(seedData.sectors || [], clear);
  console.log(`  Seeded ${sectorCount} sectors`);

  console.log('\nSeeding search terms...');
  const termCount = await seedSearchTerms(seedData.searchTerms || [], clear);
  console.log(`  Seeded ${termCount} search terms`);

  console.log('\nSeeding discovery strategies...');
  const strategyCount = await seedDiscoveryStrategies(seedData.discoveryStrategies || [], clear);
  console.log(`  Seeded ${strategyCount} strategies`);

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('SEEDING COMPLETE');
  console.log('='.repeat(60));
  console.log(`  Weight profiles: ${profileCount}`);
  console.log(`  Sectors: ${sectorCount}`);
  console.log(`  Search terms: ${termCount}`);
  console.log(`  Discovery strategies: ${strategyCount}`);
  console.log('\nTo modify preferences:');
  console.log('  1. Edit config/user-preferences-seed.json');
  console.log('  2. Run: npx tsx scripts/seed-user-preferences.ts');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
