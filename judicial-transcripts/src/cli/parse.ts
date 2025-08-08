// src/cli/parse.ts
import { Command } from 'commander';
import { PrismaClient } from '@prisma/client';
import { TranscriptConfig } from '../types/config.types';
import { TranscriptParser } from '../parsers/TranscriptParser';
// TODO: Implement Phase2Processor and Phase3Processor
// import { Phase2Processor } from '../parsers/Phase2Processor';
// import { Phase3Processor } from '../parsers/Phase3Processor';
import logger from '../utils/logger';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const program = new Command();
const prisma = new PrismaClient();

program
  .name('parse')
  .description('Judicial Transcripts Parser CLI')
  .version('1.0.0');

program
  .command('extract')
  .description('Parse transcript files')
  .requiredOption('-c, --config <path>', 'Configuration file path')
  .option('--phase1', 'Run Phase 1 only (raw parsing)')
  .option('--phase2', 'Run Phase 2 only (line grouping) - NOT YET IMPLEMENTED')
  .option('--phase3', 'Run Phase 3 only (section markers) - NOT YET IMPLEMENTED')
  .option('--all', 'Run all phases (currently only Phase 1)')
  .option('--debug', 'Enable debug logging')
  .action(async (options) => {
    try {
      if (options.debug) {
        process.env.LOG_LEVEL = 'debug';
      }

      const config = loadConfig(options.config);
      logger.info('📋 Configuration loaded successfully');
      
      // Determine which phases to run
      let runPhase1 = false;
      let runPhase2 = false;
      let runPhase3 = false;
      
      if (options.all) {
        runPhase1 = config.phases.phase1;
        runPhase2 = config.phases.phase2;
        runPhase3 = config.phases.phase3;
      } else {
        runPhase1 = options.phase1 && config.phases.phase1;
        runPhase2 = options.phase2 && config.phases.phase2;
        runPhase3 = options.phase3 && config.phases.phase3;
      }
      
      // Show warning for unimplemented phases
      if (runPhase2) {
        logger.warn('⚠️  Phase 2 is not yet implemented - skipping');
        runPhase2 = false;
      }
      if (runPhase3) {
        logger.warn('⚠️  Phase 3 is not yet implemented - skipping');
        runPhase3 = false;
      }
      
      logger.info(`🎯 Phases to run: ${[
        runPhase1 ? 'Phase1' : '',
        runPhase2 ? 'Phase2' : '',
        runPhase3 ? 'Phase3' : ''
      ].filter(Boolean).join(', ') || 'None'}`);
      
      if (!runPhase1 && !runPhase2 && !runPhase3) {
        logger.warn('⚠️  No phases selected or enabled in config');
        return;
      }
      
      const startTime = Date.now();
      
      // Phase 1: Raw parsing
      if (runPhase1) {
        logger.info('🚀 Starting Phase 1: Raw Parsing');
        const parser = new TranscriptParser(config, prisma);
        await parser.parseDirectory(config.transcriptPath);
        logger.info('✅ Phase 1 completed');
      }
      
      // Phase 2: Line grouping and event detection (NOT YET IMPLEMENTED)
      if (runPhase2) {
        logger.info('🚀 Starting Phase 2: Line Grouping');
        // TODO: Implement Phase2Processor
        // const processor = new Phase2Processor(config, prisma);
        // await processor.processAllTrials();
        logger.warn('⚠️  Phase 2 not yet implemented - skipping');
      }
      
      // Phase 3: Section markers and text generation (NOT YET IMPLEMENTED)
      if (runPhase3) {
        logger.info('🚀 Starting Phase 3: Section Markers');
        // TODO: Implement Phase3Processor
        // const processor = new Phase3Processor(config, prisma);
        // await processor.processAllTrials();
        logger.warn('⚠️  Phase 3 not yet implemented - skipping');
      }
      
      const totalTime = (Date.now() - startTime) / 1000;
      logger.info(`🎉 Processing completed in ${totalTime.toFixed(1)} seconds`);
      
    } catch (error) {
      logger.error('❌ Error during processing:', error);
      process.exit(1);
    } finally {
      await prisma.$disconnect();
    }
  });

program
  .command('reset')
  .description('Reset database (dangerous!)')
  .option('--confirm', 'Confirm database reset')
  .action(async (options) => {
    if (!options.confirm) {
      logger.error('❌ Database reset requires --confirm flag');
      logger.error('   This will permanently delete all data!');
      logger.error('   Usage: npm run parse reset --confirm');
      return;
    }
    
    try {
      logger.warn('🗑️  Resetting database...');
      execSync('npm run prisma:reset -- --force', { stdio: 'inherit' });
      logger.info('✅ Database reset completed');
    } catch (error) {
      logger.error('❌ Error resetting database:', error);
      process.exit(1);
    }
  });

program
  .command('seed')
  .description('Seed database with initial data')
  .option('--clear', 'Clear existing seed data first')
  .action(async (options) => {
    try {
      if (options.clear) {
        process.env.CLEAR_BEFORE_SEED = 'true';
      }
      
      logger.info('🌱 Seeding database...');
      execSync('npm run seed', { stdio: 'inherit' });
      logger.info('✅ Database seeding completed');
    } catch (error) {
      logger.error('❌ Error seeding database:', error);
      process.exit(1);
    }
  });

program
  .command('backup')
  .description('Backup database')
  .argument('[name]', 'Backup name (default: CURRENT)')
  .action(async (name = 'CURRENT') => {
    try {
      logger.info(`💾 Creating database backup: ${name}`);
      
      const isWindows = process.platform === 'win32';
      const scriptPath = isWindows ? 
        path.join(__dirname, '../../scripts/database.bat') :
        path.join(__dirname, '../../scripts/database.sh');
      
      const command = isWindows ? 
        `"${scriptPath}" BACKUP ${name}` :
        `bash "${scriptPath}" BACKUP ${name}`;
      
      execSync(command, { stdio: 'inherit' });
      logger.info('✅ Database backup completed');
    } catch (error) {
      logger.error('❌ Error creating backup:', error);
      process.exit(1);
    }
  });

program
  .command('restore')
  .description('Restore database from backup')
  .argument('[name]', 'Backup name (default: CURRENT)')
  .action(async (name = 'CURRENT') => {
    try {
      logger.info(`🔄 Restoring database from backup: ${name}`);
      
      const isWindows = process.platform === 'win32';
      const scriptPath = isWindows ? 
        path.join(__dirname, '../../scripts/database.bat') :
        path.join(__dirname, '../../scripts/database.sh');
      
      const command = isWindows ? 
        `"${scriptPath}" RESTORE ${name}` :
        `bash "${scriptPath}" RESTORE ${name}`;
      
      execSync(command, { stdio: 'inherit' });
      logger.info('✅ Database restore completed');
    } catch (error) {
      logger.error('❌ Error restoring backup:', error);
      process.exit(1);
    }
  });

program
  .command('initialize')
  .description('Initialize database from scratch')
  .option('--confirm', 'Confirm database initialization')
  .action(async (options) => {
    if (!options.confirm) {
      logger.error('❌ Database initialization requires --confirm flag');
      logger.error('   This will permanently delete all data and rebuild the database!');
      logger.error('   Usage: npm run parse initialize --confirm');
      return;
    }
    
    try {
      logger.info('🔧 Initializing database from scratch...');
      
      const isWindows = process.platform === 'win32';
      const scriptPath = isWindows ? 
        path.join(__dirname, '../../scripts/database.bat') :
        path.join(__dirname, '../../scripts/database.sh');
      
      const command = isWindows ? 
        `"${scriptPath}" INITIALIZE` :
        `bash "${scriptPath}" INITIALIZE`;
      
      execSync(command, { stdio: 'inherit' });
      logger.info('✅ Database initialization completed');
    } catch (error) {
      logger.error('❌ Error initializing database:', error);
      process.exit(1);
    }
  });

program
  .command('stats')
  .description('Show database statistics')
  .action(async () => {
    try {
      logger.info('📊 Gathering database statistics...');
      
      const [
        trialCount,
        sessionCount,
        pageCount,
        lineCount
      ] = await Promise.all([
        prisma.trial.count(),
        prisma.session.count(),
        prisma.page.count(),
        prisma.line.count()
      ]);
      
      // Get page statistics by document section
      const sectionStats = await prisma.page.groupBy({
        by: ['documentSection'],
        _count: {
          id: true
        }
      });
      
      // Get recent activity
      const recentTrials = await prisma.trial.findMany({
        take: 5,
        orderBy: { updatedAt: 'desc' },
        select: {
          name: true,
          caseNumber: true,
          updatedAt: true,
          totalPages: true,
          _count: {
            select: {
              sessions: true
            }
          }
        }
      });
      
      console.log('\n' + '='.repeat(60));
      console.log('📊 DATABASE STATISTICS');
      console.log('='.repeat(60));
      console.log(`📁 Trials: ${trialCount.toLocaleString()}`);
      console.log(`📅 Sessions: ${sessionCount.toLocaleString()}`);
      console.log(`📄 Pages: ${pageCount.toLocaleString()}`);
      console.log(`📝 Lines: ${lineCount.toLocaleString()}`);
      
      console.log('\n📋 Pages by Document Section:');
      sectionStats.forEach(stat => {
        console.log(`   ${stat.documentSection}: ${stat._count.id.toLocaleString()}`);
      });
      
      if (recentTrials.length > 0) {
        console.log('\n🕒 Recent Activity:');
        recentTrials.forEach(trial => {
          const date = trial.updatedAt.toLocaleDateString();
          console.log(`   ${trial.caseNumber} - ${trial.name} (${date})`);
          console.log(`     Sessions: ${trial._count.sessions}, Total Pages: ${trial.totalPages || 'N/A'}`);
        });
      }
      
      console.log('='.repeat(60));
      
    } catch (error) {
      logger.error('❌ Error gathering statistics:', error);
      process.exit(1);
    } finally {
      await prisma.$disconnect();
    }
  });

function loadConfig(configPath: string): TranscriptConfig {
  const fullPath = path.resolve(configPath);
  
  console.log('=== CONFIG LOADING DEBUG ===');
  console.log('Attempting to load config from:', fullPath);
  console.log('File exists:', fs.existsSync(fullPath));
  
  if (!fs.existsSync(fullPath)) {
    console.log('Available files in config directory:');
    const configDir = path.dirname(fullPath);
    if (fs.existsSync(configDir)) {
      fs.readdirSync(configDir).forEach(file => {
        console.log(' -', file);
      });
    }
    throw new Error(`Configuration file not found: ${fullPath}`);
  }
  
  const configData = fs.readFileSync(fullPath, 'utf-8');
  console.log('Config file loaded successfully');
  console.log('============================');
  
  return JSON.parse(configData);
}

// Parse command line arguments
program.parse(process.argv);