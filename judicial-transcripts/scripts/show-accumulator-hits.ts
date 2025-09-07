#!/usr/bin/env npx ts-node

import { PrismaClient } from '@prisma/client';
import { AccumulatorEngineV2 } from '../src/phase3/AccumulatorEngineV2';
import { TranscriptConfig } from '../src/types/config.types';
import { Logger } from '../src/utils/logger';
import * as fs from 'fs';
import * as path from 'path';

const logger = new Logger('AccumulatorHits');
const prisma = new PrismaClient();

interface HitDetail {
  accumulatorName: string;
  startLine: number;
  endLine: number;
  score: number;
  confidence: string;
  matched: boolean;
  windowText: string[];
  speakers: string[];
  metadata: any;
}

async function main() {
  try {
    // Load configuration
    const configPath = path.join(__dirname, '../config/multi-trial-config-mac.json');
    const config: TranscriptConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    config.enableElasticSearch = false;
    
    logger.info('=== Accumulator Hit Analysis ===\n');
    
    // Get trial
    const trialId = 7;
    const trial = await prisma.trial.findUnique({
      where: { id: trialId }
    });
    
    if (!trial) {
      logger.error(`Trial ${trialId} not found`);
      return;
    }
    
    logger.info(`Trial: ${trial.name}`);
    logger.info(`Case Number: ${trial.caseNumber}\n`);
    
    // Clear existing results for clean analysis
    logger.info('Clearing existing results for fresh analysis...');
    await prisma.accumulatorResult.deleteMany({
      where: { trialId }
    });
    
    // Get active accumulators
    const accumulators = await prisma.accumulatorExpression.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' }
    });
    
    logger.info(`Active Accumulators: ${accumulators.length}`);
    for (const acc of accumulators) {
      logger.info(`  - ${acc.name}`);
    }
    logger.info('');
    
    // Run evaluation
    const engine = new AccumulatorEngineV2(prisma, config);
    await engine.initialize();
    
    logger.info('Running accumulator evaluation...\n');
    await engine.evaluateTrialAccumulators(trialId);
    
    // Analyze results for each accumulator
    for (const accumulator of accumulators) {
      logger.info(`${'='.repeat(60)}`);
      logger.info(`ACCUMULATOR: ${accumulator.name}`);
      logger.info(`Description: ${accumulator.description}`);
      logger.info(`Window Size: ${accumulator.windowSize}, Threshold: ${accumulator.thresholdValue}`);
      logger.info(`${'='.repeat(60)}\n`);
      
      // Get results for this accumulator
      const results = await prisma.accumulatorResult.findMany({
        where: {
          trialId,
          accumulatorId: accumulator.id,
          booleanResult: true // Only show matches
        },
        include: {
          startEvent: {
            include: {
              statement: {
                include: {
                  speaker: true
                }
              }
            }
          },
          endEvent: {
            include: {
              statement: {
                include: {
                  speaker: true
                }
              }
            }
          }
        },
        orderBy: { floatResult: 'desc' },
        take: 5 // Show top 5 hits
      });
      
      if (results.length === 0) {
        logger.info('No matches found for this accumulator.\n');
        continue;
      }
      
      logger.info(`Found ${results.length} matches (showing top 5):\n`);
      
      // Show each hit
      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        const metadata = result.metadata as any || {};
        
        logger.info(`HIT #${i + 1}:`);
        logger.info(`  Score: ${result.floatResult?.toFixed(2)}, Confidence: ${result.confidenceLevel}`);
        
        // Get the window of statements
        const windowStatements = await prisma.statementEvent.findMany({
          where: {
            eventId: {
              gte: result.startEventId,
              lte: result.endEventId
            }
          },
          include: {
            speaker: true,
            event: true
          },
          orderBy: { eventId: 'asc' }
        });
        
        // Show metadata insights
        if (metadata.matches) {
          logger.info(`  Match Types: ${metadata.matches.map((m: any) => m.type).join(', ')}`);
        }
        
        // Show the actual text window
        logger.info(`  Window (${windowStatements.length} statements):`);
        for (const stmt of windowStatements.slice(0, 5)) { // Show first 5 statements
          const speakerInfo = stmt.speaker ? 
            `[${stmt.speaker.speakerType}${stmt.speaker.speakerHandle ? ` - ${stmt.speaker.speakerHandle}` : ''}]` : 
            '[UNKNOWN]';
          
          const textSnippet = stmt.text ? 
            stmt.text.substring(0, 100).replace(/\n/g, ' ') : 
            '(no text)';
          
          logger.info(`    ${speakerInfo}: "${textSnippet}${stmt.text && stmt.text.length > 100 ? '...' : ''}"`);
        }
        
        // For judge_attorney_interaction, show speaker analysis
        if (accumulator.name === 'judge_attorney_interaction') {
          const speakerTypes = new Set(windowStatements
            .filter(s => s.speaker)
            .map(s => s.speaker!.speakerType));
          
          const attorneys = windowStatements
            .filter(s => s.speaker?.speakerType === 'ATTORNEY')
            .map(s => s.speaker!.speakerHandle)
            .filter((v, i, a) => a.indexOf(v) === i);
          
          logger.info(`  Speaker Analysis:`);
          logger.info(`    - Speaker types in window: ${Array.from(speakerTypes).join(', ')}`);
          logger.info(`    - Distinct attorneys: ${attorneys.length} (${attorneys.slice(0, 3).join(', ')}${attorneys.length > 3 ? '...' : ''})`);
        }
        
        // For objection patterns, show the key phrases found
        if (accumulator.name.includes('objection')) {
          const objectionStmts = windowStatements.filter(s => 
            s.text && s.text.toLowerCase().includes('objection')
          );
          const responseStmts = windowStatements.filter(s => 
            s.text && (s.text.toLowerCase().includes('sustained') || s.text.toLowerCase().includes('overruled'))
          );
          
          if (objectionStmts.length > 0) {
            logger.info(`  Objection found: "${objectionStmts[0].text?.substring(0, 50)}..."`);
          }
          if (responseStmts.length > 0) {
            logger.info(`  Response found: "${responseStmts[0].text?.substring(0, 50)}..."`);
          }
        }
        
        logger.info('');
      }
      
      // Summary statistics
      const totalResults = await prisma.accumulatorResult.count({
        where: {
          trialId,
          accumulatorId: accumulator.id
        }
      });
      
      const matchedResults = await prisma.accumulatorResult.count({
        where: {
          trialId,
          accumulatorId: accumulator.id,
          booleanResult: true
        }
      });
      
      logger.info(`SUMMARY for ${accumulator.name}:`);
      logger.info(`  Total windows evaluated: ${totalResults}`);
      logger.info(`  Matches found: ${matchedResults} (${((matchedResults/totalResults)*100).toFixed(1)}%)`);
      
      // Score distribution
      const scoreRanges = await prisma.$queryRaw`
        SELECT 
          CASE 
            WHEN "floatResult" >= 0.9 THEN 'HIGH (0.9-1.0)'
            WHEN "floatResult" >= 0.7 THEN 'MEDIUM (0.7-0.9)'
            WHEN "floatResult" >= 0.5 THEN 'LOW (0.5-0.7)'
            ELSE 'VERY LOW (<0.5)'
          END as range,
          COUNT(*) as count
        FROM "AccumulatorResult"
        WHERE "trialId" = ${trialId} 
          AND "accumulatorId" = ${accumulator.id}
          AND "booleanResult" = true
        GROUP BY range
        ORDER BY range DESC
      ` as any[];
      
      if (scoreRanges.length > 0) {
        logger.info(`  Score distribution:`);
        for (const range of scoreRanges) {
          logger.info(`    ${range.range}: ${range.count} matches`);
        }
      }
      
      logger.info('\n');
    }
    
    // Overall summary
    logger.info(`${'='.repeat(60)}`);
    logger.info('OVERALL SUMMARY');
    logger.info(`${'='.repeat(60)}`);
    
    const totalResults = await prisma.accumulatorResult.count({
      where: { trialId }
    });
    
    const totalMatches = await prisma.accumulatorResult.count({
      where: { trialId, booleanResult: true }
    });
    
    logger.info(`Total accumulator results: ${totalResults}`);
    logger.info(`Total matches: ${totalMatches}`);
    logger.info(`Overall match rate: ${((totalMatches/totalResults)*100).toFixed(1)}%`);
    
    // Create CSV output
    const csvPath = path.join(__dirname, '../output/accumulator-hits.csv');
    await generateCSVReport(trialId, csvPath);
    logger.info(`\nDetailed CSV report saved to: ${csvPath}`);
    
  } catch (error) {
    logger.error('Analysis failed:', error);
  } finally {
    await prisma.$disconnect();
  }
}

async function generateCSVReport(trialId: number, outputPath: string) {
  const results = await prisma.accumulatorResult.findMany({
    where: { trialId, booleanResult: true },
    include: {
      accumulator: true,
      startEvent: {
        include: {
          statement: {
            include: { speaker: true }
          }
        }
      },
      endEvent: {
        include: {
          statement: {
            include: { speaker: true }
          }
        }
      }
    },
    orderBy: [
      { accumulatorId: 'asc' },
      { floatResult: 'desc' }
    ]
  });
  
  const csvLines = ['Accumulator,Score,Confidence,Start Event ID,End Event ID,Window Size,First Speaker,First Text,Metadata'];
  
  for (const result of results) {
    const metadata = result.metadata as any || {};
    const firstSpeaker = result.startEvent?.statement?.speaker?.speakerHandle || 'N/A';
    const firstText = result.startEvent?.statement?.text?.substring(0, 100).replace(/[,\n]/g, ' ') || '';
    const metadataStr = JSON.stringify(metadata.matches || []).replace(/"/g, '""');
    
    csvLines.push([
      result.accumulator.name,
      result.floatResult?.toFixed(3) || '0',
      result.confidenceLevel || 'NONE',
      result.startEventId,
      result.endEventId,
      metadata.windowSize || 0,
      firstSpeaker,
      `"${firstText}"`,
      `"${metadataStr}"`
    ].join(','));
  }
  
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  fs.writeFileSync(outputPath, csvLines.join('\n'));
}

main().catch(console.error);