import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import { Logger } from '../utils/logger';

interface MatchedStatement {
  windowId: number;
  statementOrder: number;
  eventId: number;
  statementId: number;
  speaker: string;
  text: string;
}

class JudgeAttorneyMatchExporter {
  private logger = new Logger('JudgeAttorneyMatchExporter');
  private prisma: PrismaClient;

  constructor() {
    this.prisma = new PrismaClient();
  }

  async exportMatches(trialId: number): Promise<void> {
    this.logger.info(`Exporting judge_attorney_interaction matches for trial ${trialId}`);

    // Load the judge_attorney_interaction accumulator
    const accumulator = await this.prisma.accumulatorExpression.findFirst({
      where: { name: 'judge_attorney_interaction' }
    });

    if (!accumulator) {
      throw new Error('judge_attorney_interaction accumulator not found');
    }

    // Load all statement events in order
    const statementEvents = await this.prisma.trialEvent.findMany({
      where: { 
        trialId,
        eventType: 'STATEMENT',
        statement: {
          isNot: null
        }
      },
      orderBy: { id: 'asc' },  // Use ID for chronological order
      include: {
        statement: {
          include: {
            speaker: true
          }
        }
      }
    });

    this.logger.info(`Found ${statementEvents.length} statement events`);

    // Process windows and find matches
    const matchedStatements: MatchedStatement[] = [];
    const windowSize = accumulator.windowSize;
    let windowId = 0;
    let lastMatchIndex = -1;

    for (let i = 0; i <= statementEvents.length - windowSize; i++) {
      // Skip if too close to last match
      if (lastMatchIndex >= 0 && i < lastMatchIndex + windowSize) {
        continue;
      }

      // Get window
      const window = statementEvents.slice(i, i + windowSize);
      
      // Check if this window matches
      if (this.windowMatches(window)) {
        windowId++;
        lastMatchIndex = i;
        
        // Add all statements in this window to output
        for (let j = 0; j < window.length; j++) {
          const event = window[j];
          matchedStatements.push({
            windowId,
            statementOrder: j + 1,
            eventId: event.id,
            statementId: event.statement!.id,
            speaker: event.statement!.speaker?.speakerHandle || 'UNKNOWN',
            text: (event.rawText || event.statement!.text || '').substring(0, 100).replace(/\n/g, ' ')
          });
        }
      }
    }

    // Write to CSV
    await this.writeCSV(matchedStatements);
    
    this.logger.info(`Exported ${windowId} matching windows (${matchedStatements.length} total statements)`);
  }

  private windowMatches(window: any[]): boolean {
    // Count speakers by type
    const speakerTypes = new Map<string, Set<number>>();
    
    for (const event of window) {
      if (event.statement?.speaker) {
        const type = event.statement.speaker.speakerType;
        const speakerId = event.statement.speakerId;
        
        if (!speakerTypes.has(type)) {
          speakerTypes.set(type, new Set());
        }
        speakerTypes.get(type)!.add(speakerId);
      }
    }
    
    // Check requirements
    const hasJudge = speakerTypes.has('JUDGE') && speakerTypes.get('JUDGE')!.size >= 1;
    const attorneyCount = 
      (speakerTypes.get('ATTORNEY')?.size || 0) + 
      (speakerTypes.get('DEFENSE_COUNSEL')?.size || 0) + 
      (speakerTypes.get('PROSECUTOR')?.size || 0);
    
    return hasJudge && attorneyCount >= 2;
  }

  private async writeCSV(statements: MatchedStatement[]): Promise<void> {
    // Create output directory if it doesn't exist
    const outputDir = path.join(process.cwd(), 'output', 'csv');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Build CSV content
    const headers = ['window_id', 'statement_order', 'event_id', 'statement_id', 'speaker', 'text'];
    let csvContent = headers.join(',') + '\n';
    
    for (const stmt of statements) {
      const row = [
        stmt.windowId,
        stmt.statementOrder,
        stmt.eventId,
        stmt.statementId,
        `"${stmt.speaker.replace(/"/g, '""')}"`,
        `"${stmt.text.replace(/"/g, '""')}"`
      ];
      csvContent += row.join(',') + '\n';
    }

    // Write file
    const filePath = path.join(outputDir, 'judge_attorney_matches.csv');
    fs.writeFileSync(filePath, csvContent);
    
    this.logger.info(`CSV file written to: ${filePath}`);
  }

  async close(): Promise<void> {
    await this.prisma.$disconnect();
  }
}

// Main execution
async function main() {
  const exporter = new JudgeAttorneyMatchExporter();
  
  try {
    const trialId = process.argv[2] ? parseInt(process.argv[2]) : 1;
    
    console.log(`Exporting judge_attorney_interaction matches for trial ${trialId}...`);
    await exporter.exportMatches(trialId);
    console.log('Export complete! Check output/csv/judge_attorney_matches.csv');
    
  } catch (error) {
    console.error('Error exporting matches:', error);
  } finally {
    await exporter.close();
  }
}

// Run if executed directly
if (require.main === module) {
  main();
}

export { JudgeAttorneyMatchExporter };