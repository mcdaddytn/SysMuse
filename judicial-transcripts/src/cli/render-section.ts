#!/usr/bin/env node
import { Command } from 'commander';
import { PrismaClient } from '@prisma/client';
import { TranscriptRenderer } from '../services/TranscriptRenderer';
import { Logger } from '../utils/logger';

const prisma = new PrismaClient();
const logger = new Logger('RenderSectionCLI');

const program = new Command();

program
  .name('render-section')
  .description('Render transcript sections using Mustache templates')
  .version('1.0.0');

program
  .command('section')
  .description('Render a specific section by ID')
  .requiredOption('-s, --section <id>', 'Section ID to render')
  .option('-o, --output <path>', 'Output file path')
  .option('--preview <lines>', 'Preview first N lines', '50')
  .action(async (options) => {
    try {
      const renderer = new TranscriptRenderer(prisma);
      const sectionId = parseInt(options.section);
      
      const rendered = await renderer.renderSection(sectionId);
      
      if (!rendered) {
        logger.error('Failed to render section');
        process.exit(1);
      }
      
      if (options.output) {
        await renderer.saveRenderedSection(rendered, options.output);
      } else {
        // Preview mode
        const lines = rendered.renderedText.split('\n');
        const previewLines = parseInt(options.preview);
        
        console.log('\n' + '='.repeat(80));
        console.log(`Section: ${rendered.sectionName}`);
        console.log(`Type: ${rendered.sectionType}`);
        console.log(`Events: ${rendered.startEventId} - ${rendered.endEventId} (${rendered.eventCount} total)`);
        console.log('='.repeat(80) + '\n');
        
        const preview = lines.slice(0, previewLines).join('\n');
        console.log(preview);
        
        if (lines.length > previewLines) {
          console.log(`\n... (${lines.length - previewLines} more lines)`);
        }
      }
      
    } catch (error) {
      logger.error('Error rendering section:', error);
      process.exit(1);
    } finally {
      await prisma.$disconnect();
    }
  });

program
  .command('type')
  .description('Render sections by type')
  .requiredOption('-t, --trial <id>', 'Trial ID')
  .requiredOption('-y, --type <type>', 'Section type (e.g., OPENING_STATEMENT_PLAINTIFF)')
  .option('-o, --output <path>', 'Output file path')
  .action(async (options) => {
    try {
      const renderer = new TranscriptRenderer(prisma);
      const trialId = parseInt(options.trial);
      
      const rendered = await renderer.renderSectionByType(trialId, options.type);
      
      if (!rendered) {
        logger.error(`No section of type ${options.type} found`);
        process.exit(1);
      }
      
      if (options.output) {
        await renderer.saveRenderedSection(rendered, options.output);
      } else {
        // Show preview
        const lines = rendered.renderedText.split('\n');
        
        console.log('\n' + '='.repeat(80));
        console.log(`Section: ${rendered.sectionName}`);
        console.log(`Type: ${rendered.sectionType}`);
        console.log(`Events: ${rendered.startEventId} - ${rendered.endEventId} (${rendered.eventCount} total)`);
        console.log('='.repeat(80) + '\n');
        
        const preview = lines.slice(0, 50).join('\n');
        console.log(preview);
        
        if (lines.length > 50) {
          console.log(`\n... (${lines.length - 50} more lines)`);
        }
      }
      
    } catch (error) {
      logger.error('Error rendering section:', error);
      process.exit(1);
    } finally {
      await prisma.$disconnect();
    }
  });

program
  .command('trial')
  .description('Render all sections for a trial')
  .requiredOption('-t, --trial <id>', 'Trial ID')
  .option('-o, --output-dir <path>', 'Output directory')
  .option('--types <types...>', 'Filter by section types')
  .action(async (options) => {
    try {
      const renderer = new TranscriptRenderer(prisma);
      const trialId = parseInt(options.trial);
      
      const sections = await renderer.renderTrialSections(trialId, options.types);
      
      logger.info(`Rendered ${sections.length} sections`);
      
      if (options.outputDir) {
        // Save each section to a file
        for (const section of sections) {
          const filename = `${section.sectionType}_${section.sectionId}.txt`;
          const filepath = `${options.outputDir}/${filename}`;
          await renderer.saveRenderedSection(section, filepath);
        }
      } else {
        // List sections with stats
        console.log('\n' + '='.repeat(80));
        console.log('RENDERED SECTIONS');
        console.log('='.repeat(80) + '\n');
        
        sections.forEach(s => {
          const textLength = s.renderedText.length;
          const lineCount = s.renderedText.split('\n').length;
          console.log(`${s.sectionType}: ${s.sectionName}`);
          console.log(`  Events: ${s.startEventId}-${s.endEventId} (${s.eventCount} total)`);
          console.log(`  Rendered: ${textLength} chars, ${lineCount} lines\n`);
        });
      }
      
    } catch (error) {
      logger.error('Error rendering trial sections:', error);
      process.exit(1);
    } finally {
      await prisma.$disconnect();
    }
  });

program.parse(process.argv);