import { PrismaClient } from '@prisma/client';
import { AccumulatorEngine } from './AccumulatorEngine';
import * as fs from 'fs';
import * as path from 'path';
import { Logger } from '../utils/logger';

interface AccumulatorDebugRow {
  eventId: number;
  eventType: string;
  eventTime: string;
  rawText: string;
  speakerName: string;
  [key: string]: any; // Dynamic columns for accumulator values
}

class AccumulatorDebugger {
  private logger = new Logger('AccumulatorDebugger');
  private prisma: PrismaClient;
  private engine: AccumulatorEngine;

  constructor() {
    this.prisma = new PrismaClient();
    this.engine = new AccumulatorEngine(this.prisma);
  }

  async debugAccumulators(trialId: number): Promise<void> {
    this.logger.info(`Starting accumulator debug for trial ${trialId}`);

    // Load ALL accumulators (including inactive ones for debugging)
    const accumulators = await this.prisma.accumulatorExpression.findMany({
      include: {
        components: true,
        esExpressions: true
      },
      orderBy: { name: 'asc' }
    });

    this.logger.info(`Found ${accumulators.length} total accumulators (active and inactive)`);

    // Load trial events with related data
    const trialEvents = await this.prisma.trialEvent.findMany({
      where: { trialId },
      orderBy: { id: 'asc' },  // Use ID for chronological order
      include: {
        statement: {
          include: {
            speaker: true,
            esResults: {
              include: {
                expression: true
              }
            }
          }
        },
        courtDirective: true,
        witnessCalled: true
      }
    });

    this.logger.info(`Loaded ${trialEvents.length} trial events`);
    
    // Filter to just statement events for sliding window
    const statementEvents = trialEvents.filter(e => e.eventType === 'STATEMENT' && e.statement);
    this.logger.info(`Found ${statementEvents.length} statement events`);

    // Prepare CSV data
    const csvRows: AccumulatorDebugRow[] = [];
    
    // Track last match position for each accumulator to implement window skip
    const lastMatchIndex: Map<string, number> = new Map();
    
    // We'll iterate through ALL events for the CSV, but track statement index separately
    let statementIndex = -1;
    
    // Process each event
    for (let eventIndex = 0; eventIndex < trialEvents.length; eventIndex++) {
      const event = trialEvents[eventIndex];
      
      // Track which statement index we're at
      if (event.eventType === 'STATEMENT' && event.statement) {
        statementIndex++;
      }
      
      let eventTimeStr = '';
      try {
        if (event.startTime) {
          const date = new Date(event.startTime);
          if (!isNaN(date.getTime())) {
            eventTimeStr = date.toISOString();
          }
        }
      } catch (e) {
        // Keep empty string if date is invalid
      }

      const row: AccumulatorDebugRow = {
        eventId: event.id,
        eventType: event.eventType,
        eventTime: eventTimeStr,
        rawText: (event.rawText || '').substring(0, 100), // Truncate to first 100 chars
        speakerName: event.statement?.speaker?.speakerHandle || ''
      };

      // For each accumulator, calculate its value at this event
      for (const accumulator of accumulators) {
        const columnPrefix = accumulator.name.replace(/\s+/g, '_');
        
        // Only evaluate for STATEMENT events
        if (event.eventType !== 'STATEMENT' || !event.statement) {
          row[`${columnPrefix}_score`] = '';
          row[`${columnPrefix}_confidence`] = '';
          row[`${columnPrefix}_matched`] = '';
          row[`${columnPrefix}_active`] = accumulator.isActive;
          continue;
        }
        
        // Check if we should skip this evaluation due to recent match
        const lastMatch = lastMatchIndex.get(accumulator.name);
        if (lastMatch !== undefined && statementIndex < lastMatch + accumulator.windowSize) {
          // Skip evaluation - too close to last match
          row[`${columnPrefix}_score`] = 'SKIP';
          row[`${columnPrefix}_confidence`] = 'SKIP';
          row[`${columnPrefix}_matched`] = 'SKIP';
          row[`${columnPrefix}_active`] = accumulator.isActive;
          continue;
        }
        
        // Get window of STATEMENT events for this accumulator
        const windowSize = accumulator.windowSize;
        const windowStart = Math.max(0, statementIndex - windowSize + 1);
        const windowEnd = statementIndex + 1;
        
        if (windowEnd - windowStart === windowSize) {
          // Get the actual statement events for this window
          const windowStatements = statementEvents.slice(windowStart, windowEnd);
          
          if (windowStatements.length === windowSize) {
            // Create window and evaluate
            const window = this.createWindow(windowStatements);
            const evaluation = await this.evaluateWindow(accumulator, window);
            
            // Add columns for this accumulator
            row[`${columnPrefix}_score`] = evaluation.score.toFixed(4);
            row[`${columnPrefix}_confidence`] = evaluation.confidence;
            row[`${columnPrefix}_matched`] = evaluation.matched;
            row[`${columnPrefix}_active`] = accumulator.isActive;
            
            // Track match for window skip (using statement index, not event index)
            if (evaluation.matched) {
              lastMatchIndex.set(accumulator.name, statementIndex);
            }
            
            // Add metadata details if matched
            if (evaluation.matched || evaluation.score > 0) {
              row[`${columnPrefix}_details`] = JSON.stringify(evaluation.metadata);
            }
          } else {
            // Not enough statements in window
            row[`${columnPrefix}_score`] = 'N/A';
            row[`${columnPrefix}_confidence`] = 'N/A';
            row[`${columnPrefix}_matched`] = 'N/A';
            row[`${columnPrefix}_active`] = accumulator.isActive;
          }
        } else {
          // Window not complete yet
          row[`${columnPrefix}_score`] = '';
          row[`${columnPrefix}_confidence`] = '';
          row[`${columnPrefix}_matched`] = '';
          row[`${columnPrefix}_active`] = accumulator.isActive;
        }
      }

      csvRows.push(row);
    }

    // Write to CSV
    await this.writeCSV(csvRows, accumulators);
    
    this.logger.info(`Debug output written to output/csv/accumulator_debug.csv`);
  }

  private createWindow(events: any[]): any {
    const statements = events.map(e => e.statement).filter(Boolean);
    const esResults = new Map();

    for (const statement of statements) {
      if (statement.esResults && statement.esResults.length > 0) {
        esResults.set(statement.id, statement.esResults);
      }
    }

    return {
      startEvent: events[0],
      endEvent: events[events.length - 1],
      events,
      statements,
      esResults
    };
  }

  private async evaluateWindow(accumulator: any, window: any): Promise<any> {
    const metadata = accumulator.metadata || {};
    let scores: number[] = [];
    let matchDetails: any[] = [];

    // Special handling for judge_attorney_interaction type accumulators
    if (accumulator.name === 'judge_attorney_interaction' || 
        (metadata.requiredSpeakers && metadata.minAttorneys)) {
      
      // Count speakers by type
      const speakerTypeCounts = new Map<string, Set<number>>();
      
      for (const statement of window.statements) {
        if (statement.speaker && statement.speakerId) {
          const type = statement.speaker.speakerType;
          if (!speakerTypeCounts.has(type)) {
            speakerTypeCounts.set(type, new Set());
          }
          speakerTypeCounts.get(type)!.add(statement.speakerId);
        }
      }
      
      // Check if we have judge
      const hasJudge = speakerTypeCounts.has('JUDGE') && speakerTypeCounts.get('JUDGE')!.size >= 1;
      
      // Count distinct attorneys
      const attorneyCount = (speakerTypeCounts.get('ATTORNEY')?.size || 0) + 
                           (speakerTypeCounts.get('DEFENSE_COUNSEL')?.size || 0) + 
                           (speakerTypeCounts.get('PROSECUTOR')?.size || 0);
      
      const meetsRequirements = hasJudge && attorneyCount >= (metadata.minAttorneys || 2);
      
      matchDetails.push({
        type: 'judge_attorney_check',
        hasJudge,
        attorneyCount,
        requiredAttorneys: metadata.minAttorneys || 2,
        speakerBreakdown: Array.from(speakerTypeCounts.entries()).map(([type, ids]) => 
          `${type}:${ids.size}`
        ).join(', ')
      });
      
      // For boolean accumulators, this is the only check
      if (accumulator.expressionType === 'BOOLEAN') {
        scores.push(meetsRequirements ? 1.0 : 0.0);
      } else {
        // For other types, add to scores array
        if (meetsRequirements) scores.push(1.0);
      }
      
    } else {
      // Original logic for other accumulators
      
      // Check ES expression matches
      if (accumulator.esExpressions && accumulator.esExpressions.length > 0) {
        for (const esExpr of accumulator.esExpressions) {
          const matchCount = this.countESMatches(window, esExpr.id);
          if (matchCount > 0) {
            scores.push(1.0);
            matchDetails.push({
              type: 'es_expression',
              expression: esExpr.name,
              matches: matchCount
            });
          }
        }
      }

      // Check speaker requirements
      if (metadata.requiredSpeakers) {
        const speakerTypes = new Set(
          window.statements
            .filter((s: any) => s.speaker?.speakerType)
            .map((s: any) => s.speaker.speakerType)
        );

        for (const required of metadata.requiredSpeakers) {
          if (speakerTypes.has(required)) {
            scores.push(1.0);
            matchDetails.push({
              type: 'speaker',
              speakerType: required
            });
          }
        }
      }

      // Check minimum distinct speakers
      if (metadata.minDistinctSpeakers) {
        const distinctSpeakers = new Set(
          window.statements
            .filter((s: any) => s.speakerId)
            .map((s: any) => s.speakerId)
        );

        if (distinctSpeakers.size >= metadata.minDistinctSpeakers) {
          scores.push(1.0);
          matchDetails.push({
            type: 'distinct_speakers',
            count: distinctSpeakers.size
          });
        } else {
          scores.push(0.0);
          matchDetails.push({
            type: 'distinct_speakers',
            count: distinctSpeakers.size,
            required: metadata.minDistinctSpeakers
          });
        }
      }
    }

    // Calculate final score
    const finalScore = this.combineScores(scores, accumulator.combinationType);
    const isBoolean = accumulator.expressionType === 'BOOLEAN';
    const confidence = this.calculateConfidence(finalScore, isBoolean);
    const matched = this.evaluateThreshold(
      finalScore,
      accumulator.thresholdValue,
      confidence,
      accumulator.minConfidenceLevel
    );

    return {
      matched,
      confidence,
      score: finalScore,
      metadata: {
        windowSize: window.events.length,
        startTime: window.startEvent.startTime,
        endTime: window.endEvent.endTime,
        matches: matchDetails,
        scoresDetail: scores
      }
    };
  }

  private countESMatches(window: any, expressionId: number): number {
    let count = 0;
    for (const [, results] of window.esResults) {
      count += results.filter((r: any) => r.expressionId === expressionId && r.matched).length;
    }
    return count;
  }

  private combineScores(scores: number[], combinationType?: string | null): number {
    if (scores.length === 0) return 0;

    switch (combinationType) {
      case 'ADD':
        return scores.reduce((a, b) => a + b, 0);
      case 'MULTIPLY':
        return scores.reduce((a, b) => a * b, 1);
      case 'OR':
        return Math.max(...scores);
      case 'AND':
        return Math.min(...scores);
      default:
        return scores.reduce((a, b) => a + b, 0) / scores.length;
    }
  }

  private calculateConfidence(score: number, isBoolean: boolean = false): string {
    // For boolean accumulators, only use HIGH or NONE
    if (isBoolean) {
      return score >= 1.0 ? 'HIGH' : 'NONE';
    }
    
    // For other accumulators, use graduated scale
    if (score >= 0.8) return 'HIGH';
    if (score >= 0.5) return 'MEDIUM';
    if (score >= 0.3) return 'LOW';
    return 'NONE';
  }

  private evaluateThreshold(
    score: number,
    threshold?: number | null,
    confidence?: string,
    minConfidence?: string | null
  ): boolean {
    if (threshold !== null && threshold !== undefined) {
      if (score < threshold) return false;
    }

    if (minConfidence && confidence) {
      const confidenceLevels = ['NONE', 'LOW', 'MEDIUM', 'HIGH'];
      const currentLevel = confidenceLevels.indexOf(confidence);
      const minLevel = confidenceLevels.indexOf(minConfidence);
      if (currentLevel < minLevel) return false;
    }

    return true;
  }

  private async writeCSV(rows: AccumulatorDebugRow[], accumulators: any[]): Promise<void> {
    // Create output directory if it doesn't exist
    const outputDir = path.join(process.cwd(), 'output', 'csv');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Build header
    const headers = ['eventId', 'eventType', 'eventTime', 'rawText', 'speakerName'];
    
    // Add columns for each accumulator
    for (const acc of accumulators) {
      const prefix = acc.name.replace(/\s+/g, '_');
      headers.push(
        `${prefix}_score`,
        `${prefix}_confidence`,
        `${prefix}_matched`,
        `${prefix}_active`,
        `${prefix}_details`
      );
    }

    // Build CSV content
    let csvContent = headers.join(',') + '\n';
    
    for (const row of rows) {
      const values = headers.map(header => {
        const value = row[header];
        if (value === undefined || value === null) return '';
        if (typeof value === 'string' && (value.includes(',') || value.includes('"') || value.includes('\n'))) {
          return `"${value.replace(/"/g, '""')}"`;
        }
        return value.toString();
      });
      csvContent += values.join(',') + '\n';
    }

    // Write file
    const filePath = path.join(outputDir, 'accumulator_debug.csv');
    fs.writeFileSync(filePath, csvContent);
    
    this.logger.info(`CSV file written with ${rows.length} rows and ${headers.length} columns`);
  }

  async close(): Promise<void> {
    await this.prisma.$disconnect();
  }
}

// Main execution
async function main() {
  const accDebugger = new AccumulatorDebugger();
  
  try {
    // Get trial ID from command line or use default
    const trialId = process.argv[2] ? parseInt(process.argv[2]) : 1;
    
    console.log(`Running accumulator debug for trial ${trialId}...`);
    await accDebugger.debugAccumulators(trialId);
    console.log('Debug complete! Check output/csv/accumulator_debug.csv');
    
  } catch (error) {
    console.error('Error running accumulator debug:', error);
  } finally {
    await accDebugger.close();
  }
}

// Run if executed directly
if (require.main === module) {
  main();
}

export { AccumulatorDebugger };