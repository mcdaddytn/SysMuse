// SECOND FIX: Updated Phase2Processor with orphaned line logic and clean logging
import { PrismaClient } from '@prisma/client';
import { TranscriptConfig, ParsingContext } from '../types/config.types';
import logger from '../utils/logger';

export class Phase2Processor {
  private prisma: PrismaClient;
  private config: TranscriptConfig;
  private context: ParsingContext;
  
  constructor(config: TranscriptConfig) {
    this.prisma = new PrismaClient();
    this.config = config;
    this.context = {
      attorneys: new Map(),
      witnesses: new Map(),
      currentSession: undefined,
      currentPage: undefined,
      currentSpeaker: undefined,
      currentWitness: undefined,
      currentExaminationType: undefined
    };
  }
  
  async process(): Promise<void> {
    logger.info('Starting Phase 2: Processing line groups into trial events');
    
    try {
      const trials = await this.prisma.trial.findMany({
        include: {
          sessions: {
            orderBy: [
              { sessionDate: 'asc' },
              { sessionType: 'asc' }
            ]
          }
        }
      });
      
      for (const trial of trials) {
        logger.info(`Processing trial: ${trial.caseNumber}`);
        await this.processTrial(trial);
      }
      
      logger.info('Phase 2 processing completed');
    } catch (error) {
      logger.error('Error during Phase 2 processing: ' + (error as Error).message);
      throw error;
    } finally {
      await this.prisma.$disconnect();
    }
  }
  
  private async processTrial(trial: any): Promise<void> {
    await this.loadTrialContext(trial.id);
    
    for (const session of trial.sessions) {
      await this.processSession(trial.id, session);
    }
  }
  
  private async loadTrialContext(trialId: number): Promise<void> {
    const trialAttorneys = await this.prisma.trialAttorney.findMany({
      where: { trialId },
      include: { attorney: true }
    });
    
    for (const ta of trialAttorneys) {
      this.context.attorneys.set(ta.attorney.name, ta.attorney.id);
    }
    
    const witnesses = await this.prisma.witness.findMany({
      where: { trialId }
    });
    
    for (const witness of witnesses) {
      if (witness.name) {
        this.context.witnesses.set(witness.name, witness.id);
      }
    }
  }
  
  private async processSession(trialId: number, session: any): Promise<void> {
    logger.info(`Processing session: ${session.sessionDate} ${session.sessionType}`);
    
    this.context.currentSession = {
      id: session.id,
      date: session.sessionDate,
      type: session.sessionType
    };
    
    const pages = await this.prisma.page.findMany({
      where: { sessionId: session.id },
      orderBy: { pageNumber: 'asc' },
      include: {
        lines: {
          orderBy: { lineNumber: 'asc' }
        }
      }
    });
    
    await this.groupLinesIntoEvents(trialId, pages);
  }
  
  private async groupLinesIntoEvents(trialId: number, pages: any[]): Promise<void> {
    logger.info('=== GROUP LINES INTO EVENTS START ===');
    logger.info('Trial ID: ' + trialId);
    logger.info('Pages count: ' + (pages?.length || 0));
    
    if (!pages || pages.length === 0) {
      logger.warn('No pages provided to groupLinesIntoEvents');
      return;
    }
    
    let currentEvent: any = null;
    let eventLines: any[] = [];
    let totalLinesProcessed = 0;
    let orphanedLinesCount = 0;
    let summaryPageDetected = false;
    
    for (const page of pages) {
      logger.info(`Processing page ${page.pageNumber} with ${page.lines?.length || 0} lines`);
      
      // Check if this looks like a summary/header page
      const isSummaryPage = this.isSummaryPage(page);
      if (isSummaryPage) {
        summaryPageDetected = true;
        logger.info(`Page ${page.pageNumber} detected as summary/header page - skipping event processing`);
        continue;
      }
      
      if (!page.lines || page.lines.length === 0) {
        logger.warn(`Page ${page.pageNumber} has no lines, skipping`);
        continue;
      }
      
      for (const line of page.lines) {
        totalLinesProcessed++;
        
        if (totalLinesProcessed % 100 === 0) {
          logger.info(`Processed ${totalLinesProcessed} lines so far...`);
        }
        
        if (!line) {
          logger.warn('Encountered null/undefined line, skipping');
          continue;
        }
        
        if (line.isBlank) continue;
        
        // Check if this starts a new event
        if (this.isEventStart(line)) {
          // Save previous event if exists
          if (currentEvent && eventLines.length > 0) {
            logger.info(`Saving previous event with ${eventLines.length} lines`);
            try {
              await this.saveEvent(trialId, currentEvent, eventLines);
            } catch (error) {
              logger.error('Error saving previous event: ' + (error as Error).message);
              logger.error('Event info: ' + JSON.stringify(currentEvent));
              throw error;
            }
          }
          
          // Start new event
          logger.info(`Starting new event from line ${line.lineNumber}: "${this.truncateText(line.text, 50)}"`);
          currentEvent = this.createEventFromLine(line);
          
          if (!currentEvent) {
            logger.error(`ERROR: createEventFromLine returned null for line ${line.lineNumber}`);
            continue;
          }
          
          eventLines = [line];
        } else if (currentEvent) {
          // Continue current event
          eventLines.push(line);
        } else {
          // Orphaned line - check if it's expected
          if (!summaryPageDetected && this.isExpectedOrphanedLine(line)) {
            // Don't warn about expected header/summary content
            logger.debug(`Expected header/summary line ${line.lineNumber}: "${this.truncateText(line.text, 30)}"`);
          } else {
            orphanedLinesCount++;
            if (orphanedLinesCount <= 5) { // Limit warnings to avoid spam
              logger.warn(`Orphaned line ${line.lineNumber}: "${this.truncateText(line.text, 50)}"`);
            } else if (orphanedLinesCount === 6) {
              logger.warn('Additional orphaned lines detected (suppressing further warnings)...');
            }
          }
        }
      }
    }
    
    // Save last event
    if (currentEvent && eventLines.length > 0) {
      logger.info(`Saving final event with ${eventLines.length} lines`);
      try {
        await this.saveEvent(trialId, currentEvent, eventLines);
      } catch (error) {
        logger.error('Error saving final event: ' + (error as Error).message);
        throw error;
      }
    }
    
    logger.info(`=== GROUP LINES INTO EVENTS END ===`);
    logger.info(`Processed ${totalLinesProcessed} total lines`);
    if (orphanedLinesCount > 0) {
      logger.info(`Found ${orphanedLinesCount} orphaned lines (likely summary/header content)`);
    }
  }

  private isSummaryPage(page: any): boolean {
    if (!page.lines || page.lines.length === 0) return false;
    
    // Check for summary page indicators
    const pageText = page.lines.map((l: any) => l.text || '').join(' ').toLowerCase();
    
    const summaryIndicators = [
      'civil action no',
      'plaintiff',
      'defendants',
      'transcript of jury trial',
      'morning session',
      'afternoon session',
      'before the honorable',
      'united states district court',
      'for the plaintiff:',
      'for the defendant:'
    ];
    
    const indicatorCount = summaryIndicators.filter(indicator => 
      pageText.includes(indicator)
    ).length;
    
    // If 3 or more indicators are present, likely a summary page
    return indicatorCount >= 3;
  }

  private isExpectedOrphanedLine(line: any): boolean {
    if (!line.text) return false;
    
    const text = line.text.toLowerCase();
    
    // These are expected to be orphaned on summary/header pages
    const expectedOrphanedPatterns = [
      /case \d+:/,
      /document \d+/,
      /filed \d+/,
      /^[a-z\s]*plaintiff[a-z\s]*$/,
      /^[a-z\s]*defendants?[a-z\s]*$/,
      /civil action no/,
      /transcript of/,
      /morning session/,
      /afternoon session/,
      /before the honorable/,
      /united states/,
      /for the plaintiff/,
      /for the defendant/,
      /mr\./,
      /ms\./,
      /mrs\./,
      /^\d+$/, // Just page numbers
      /^\s*$/, // Whitespace only
      /marshall division/,
      /eastern district/
    ];
    
    return expectedOrphanedPatterns.some(pattern => pattern.test(text));
  }

  private truncateText(text: string | null | undefined, maxLength: number): string {
    if (!text) return 'NO TEXT';
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
  }

  private isEventStart(line: any): boolean {
    if (!line) {
      logger.warn('isEventStart: Line is null or undefined');
      return false;
    }
    
    const isStart = !!(line.timestamp || line.speakerPrefix || 
              (line.text && line.text.match(/^\([^)]+\)$/)) ||
              (line.text && line.text.match(/EXAMINATION/i)));
    
    if (isStart) {
      logger.info(`Event start detected - Line ${line.lineNumber}: "${this.truncateText(line.text, 50)}"`);
    }
    
    return isStart;
  }
  
  private createEventFromLine(line: any): any {
    logger.info('=== CREATE EVENT FROM LINE START ===');
    logger.info(`Line ${line.lineNumber}: "${this.truncateText(line.text, 100)}"`);
    logger.info(`Speaker prefix: "${line.speakerPrefix || 'NONE'}"`);
    logger.info(`Has timestamp: ${!!line.timestamp}`);
    
    if (!line) {
      logger.error('ERROR: Line is null or undefined');
      return null;
    }
    
    const event: any = {
      startTime: line.timestamp,
      startLineNumber: line.lineNumber,
      type: 'STATEMENT' // default
    };
    
    // Determine event type with enhanced null checks
    if (line.text && typeof line.text === 'string' && line.text.match(/^\([^)]+\)$/)) {
      event.type = 'COURT_DIRECTIVE';
      event.directiveText = line.text.replace(/[()]/g, '').trim();
      logger.info(`Event identified as COURT_DIRECTIVE: "${event.directiveText}"`);
    } else if (line.speakerPrefix && typeof line.speakerPrefix === 'string') {
      event.type = 'STATEMENT';
      event.speaker = line.speakerPrefix;
      logger.info(`Event identified as STATEMENT with speaker: "${event.speaker}"`);
    } else if (line.text && typeof line.text === 'string' && line.text.match(/EXAMINATION/i)) {
      event.type = 'WITNESS_CALLED';
      logger.info('Event identified as WITNESS_CALLED');
    } else {
      logger.warn('Could not determine event type, defaulting to STATEMENT with UNKNOWN_SPEAKER');
      logger.warn(`Line text: "${this.truncateText(line.text, 50)}"`);
      logger.warn(`Speaker prefix: "${line.speakerPrefix || 'NONE'}"`);
      event.speaker = 'UNKNOWN_SPEAKER';
    }
    
    logger.info(`Created event - Type: ${event.type}, Speaker: "${event.speaker || 'NONE'}"`);
    logger.info('=== CREATE EVENT FROM LINE END ===');
    
    return event;
  }

  private async saveEvent(trialId: number, eventInfo: any, lines: any[]): Promise<void> {
    logger.info('=== SAVE EVENT START ===');
    logger.info(`Event type: ${eventInfo.type}`);
    logger.info(`Event speaker: "${eventInfo.speaker || 'NONE'}"`);
    logger.info(`Lines count: ${lines?.length || 0}`);
    
    if (!eventInfo) {
      logger.error('ERROR: eventInfo is null/undefined');
      return;
    }
    
    if (!lines || lines.length === 0) {
      logger.error('ERROR: No lines provided to saveEvent');
      return;
    }
    
    const startLine = lines[0];
    const endLine = lines[lines.length - 1];
    
    if (!startLine || !endLine) {
      logger.error('ERROR: Invalid startLine or endLine');
      return;
    }
    
    const fullText = lines
      .map(l => l?.text || '')
      .filter(t => t)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    
    logger.info(`Combined text length: ${fullText.length}`);
    logger.info(`Combined text preview: "${this.truncateText(fullText, 100)}"`);
    
    try {
      const event = await this.prisma.trialEvent.create({
        data: {
          trialId,
          sessionId: this.context.currentSession?.id,
          startTime: eventInfo.startTime,
          endTime: endLine.timestamp || eventInfo.startTime,
          startLineNumber: startLine.lineNumber,
          endLineNumber: endLine.lineNumber,
          lineCount: lines.length,
          eventType: eventInfo.type,
          text: fullText
        }
      });
      
      logger.info(`Created base trial event with ID: ${event.id}`);
      
      if (eventInfo.type === 'COURT_DIRECTIVE') {
        logger.info(`Processing COURT_DIRECTIVE: "${eventInfo.directiveText}"`);
        await this.createCourtDirectiveEvent(event.id, eventInfo.directiveText);
      } else if (eventInfo.type === 'STATEMENT') {
        logger.info(`Processing STATEMENT with speaker: "${eventInfo.speaker || 'UNDEFINED'}"`);
        await this.createStatementEvent(event.id, eventInfo.speaker, fullText);
      } else if (eventInfo.type === 'WITNESS_CALLED') {
        logger.info('Processing WITNESS_CALLED');
        await this.createWitnessCalledEvent(event.id, fullText);
      } else {
        logger.warn(`Unknown event type: ${eventInfo.type}`);
      }
      
    } catch (error) {
      logger.error('ERROR in saveEvent: ' + (error as Error).message);
      logger.error(`Event speaker causing error: "${eventInfo.speaker || 'UNDEFINED'}"`);
      throw error;
    }
    
    logger.info('=== SAVE EVENT END ===');
  }

  private async createStatementEvent(eventId: number, speaker: string, text: string): Promise<void> {
    logger.info('=== CREATE STATEMENT EVENT START ===');
    logger.info(`Event ID: ${eventId}`);
    logger.info(`Speaker received: "${speaker}" (type: ${typeof speaker})`);
    logger.info(`Text length: ${text?.length || 0}`);
    
    // Comprehensive null checks for speaker
    if (speaker === null || speaker === undefined) {
      logger.error('ERROR: Speaker is null or undefined, setting to UNKNOWN_SPEAKER');
      speaker = 'UNKNOWN_SPEAKER';
    }
    
    if (typeof speaker !== 'string') {
      logger.error(`ERROR: Speaker is not a string, type: ${typeof speaker}, converting to string`);
      speaker = String(speaker || 'UNKNOWN_SPEAKER');
    }
    
    speaker = speaker.trim();
    
    if (speaker === '') {
      logger.error('ERROR: Speaker is empty string after trim, setting to UNKNOWN_SPEAKER');
      speaker = 'UNKNOWN_SPEAKER';
    }
    
    logger.info(`Speaker after validation: "${speaker}"`);
    
    // Determine speaker type
    let speakerType: any = 'OTHER';
    let speakerName = speaker;
    
    try {
      if (speaker.includes('THE COURT')) {
        logger.info('Speaker identified as THE COURT');
        speakerType = 'JUDGE';
      } else if (speaker === 'Q.') {
        logger.info(`Speaker is Q. Current examination type: "${this.context.currentExaminationType || 'NONE'}"`);
        
        const isCross = this.context.currentExaminationType && 
                       typeof this.context.currentExaminationType === 'string' &&
                       this.context.currentExaminationType.includes('CROSS');
        speakerType = isCross ? 'DEFENDANT_ATTORNEY' : 'PLAINTIFF_ATTORNEY';
        logger.info(`Q. speaker type determined as: ${speakerType} (isCross: ${isCross})`);
      } else if (speaker === 'A.') {
        logger.info(`Speaker is A. Current witness type: "${this.context.currentWitness?.type || 'NONE'}"`);
        
        speakerType = this.context.currentWitness?.type === 'PLAINTIFF_WITNESS' ?
          'PLAINTIFF_WITNESS' : 'DEFENDANT_WITNESS';
        logger.info(`A. speaker type determined as: ${speakerType}`);
      } else if (speaker.match(/^(MR\.|MS\.|MRS\.)/)) {
        logger.info(`Speaker appears to be an attorney: "${speaker}"`);
        const attorneyId = this.context.attorneys.get(speaker);
        logger.info(`Attorney ID from context: ${attorneyId}`);
        
        if (attorneyId && this.context.currentSession?.id) {
          try {
            const trialAttorney = await this.prisma.trialAttorney.findFirst({
              where: { 
                attorneyId,
                trialId: this.context.currentSession.id 
              }
            });
            
            speakerType = trialAttorney?.role === 'PLAINTIFF' ? 
              'PLAINTIFF_ATTORNEY' : 'DEFENDANT_ATTORNEY';
            logger.info(`Attorney speaker type determined as: ${speakerType}`);
          } catch (dbError) {
            logger.error('Database error looking up trial attorney: ' + (dbError as Error).message);
            speakerType = 'OTHER';
          }
        } else {
          logger.warn(`Attorney not found in context for speaker: "${speaker}"`);
          speakerType = 'OTHER';
        }
      } else {
        logger.info(`Speaker does not match known patterns, defaulting to OTHER: "${speaker}"`);
      }
    } catch (error) {
      logger.error('Error determining speaker type: ' + (error as Error).message);
      logger.error(`Speaker value that caused error: "${speaker}"`);
      speakerType = 'OTHER';
      speakerName = speaker || 'UNKNOWN_SPEAKER';
    }
    
    logger.info(`Final speaker type: ${speakerType}`);
    logger.info(`Final speaker name: "${speakerName}"`);
    
    if (!text) {
      logger.warn('Text is null/undefined, setting to empty string');
      text = '';
    }
    
    try {
      const statement = await this.prisma.statementEvent.create({
        data: {
          eventId,
          speakerType,
          speakerName
        }
      });
      
      logger.info(`Created statement event with ID: ${statement.id}`);
      
      // Create specific statement type with enhanced null checks
      if (speakerType === 'JUDGE') {
        logger.info('Creating court statement event');
        await this.prisma.courtStatementEvent.create({
          data: {
            statementId: statement.id,
            statementType: this.determineCourtStatementType(text)
          }
        });
      } else if (speakerType && typeof speakerType === 'string' && speakerType.includes('ATTORNEY')) {
        logger.info('Creating attorney statement event');
        const attorneyId = this.context.attorneys.get(speakerName);
        
        await this.prisma.attorneyStatementEvent.create({
          data: {
            statementId: statement.id,
            attorneyId: attorneyId || null
          }
        });
      } else if (speakerType && typeof speakerType === 'string' && speakerType.includes('WITNESS')) {
        logger.info('Creating witness statement event');
        
        await this.prisma.witnessStatementEvent.create({
          data: {
            statementId: statement.id,
            witnessId: this.context.currentWitness?.id || null,
            examinationType: (this.context.currentExaminationType as any) || 'DIRECT_EXAMINATION'
          }
        });
      } else {
        logger.info(`No specific statement type created for speaker type: ${speakerType}`);
      }
      
    } catch (error) {
      logger.error('Error creating statement event: ' + (error as Error).message);
      logger.error(`Event ID: ${eventId}`);
      logger.error(`Speaker Type: ${speakerType}`);
      logger.error(`Speaker Name: "${speakerName}"`);
      throw error;
    }
    
    logger.info('=== CREATE STATEMENT EVENT END ===');
  }

  // Keep existing methods for createCourtDirectiveEvent, determineCourtStatementType, 
  // createWitnessCalledEvent, and parseWitnessCall unchanged...
  
  private async createCourtDirectiveEvent(eventId: number, directiveText: string): Promise<void> {
    // Implementation unchanged
    const directiveType = await this.prisma.courtDirectiveType.findFirst({
      where: {
        OR: [
          { name: directiveText },
          { aliases: { has: directiveText } }
        ]
      }
    });
    
    if (directiveType) {
      await this.prisma.courtDirectiveEvent.create({
        data: {
          eventId,
          directiveTypeId: directiveType.id,
          isStandard: true
        }
      });
    } else {
      const newType = await this.prisma.courtDirectiveType.create({
        data: {
          name: directiveText,
          isPaired: false,
          aliases: []
        }
      });
      
      await this.prisma.courtDirectiveEvent.create({
        data: {
          eventId,
          directiveTypeId: newType.id,
          isStandard: false
        }
      });
    }
  }

  private determineCourtStatementType(text: string): any {
    if (text.match(/objection.*sustained|sustained/i)) return 'RULING';
    if (text.match(/objection.*overruled|overruled/i)) return 'RULING';
    if (text.match(/\?$/)) return 'QUESTION';
    if (text.match(/ladies and gentlemen/i)) return 'INSTRUCTION';
    if (text.match(/recess|adjourn|reconvene/i)) return 'SCHEDULING';
    return 'OTHER';
  }

  private async createWitnessCalledEvent(eventId: number, text: string): Promise<void> {
    const witnessInfo = this.parseWitnessCall(text);
    
    if (!witnessInfo) return;
    
    let witness = await this.prisma.witness.findFirst({
      where: {
        trialId: this.context.currentSession?.id || 0,
        name: witnessInfo.name
      }
    });
    
    if (!witness && witnessInfo.name) {
      witness = await this.prisma.witness.create({
        data: {
          trialId: this.context.currentSession?.id || 0,
          name: witnessInfo.name,
          witnessType: witnessInfo.type as any
        }
      });
      
      this.context.witnesses.set(witnessInfo.name, witness.id);
    }
    
    if (witness) {
      this.context.currentWitness = {
        id: witness.id,
        name: witness.name || '',
        type: witness.witnessType
      };
    }
    
    this.context.currentExaminationType = witnessInfo.examinationType;
    
    await this.prisma.witnessCalledEvent.create({
      data: {
        eventId,
        witnessId: witness?.id,
        examinationType: witnessInfo.examinationType as any,
        previouslySworn: witnessInfo.previouslySworn || false,
        presentedByVideo: witnessInfo.presentedByVideo || false
      }
    });
  }

  private parseWitnessCall(text: string): any {
    const info: any = {
      name: null,
      type: 'FACT_WITNESS',
      examinationType: 'DIRECT_EXAMINATION',
      previouslySworn: false,
      presentedByVideo: false
    };
    
    const nameMatch = text.match(/^([A-Z\s,\.]+?)(?:,|\s+(?:PLAINTIFF|DEFENDANT))/);
    if (nameMatch) {
      info.name = nameMatch[1].trim();
    }
    
    if (text.includes("PLAINTIFF'S WITNESS")) {
      info.type = 'PLAINTIFF_WITNESS';
    } else if (text.includes("DEFENDANT'S WITNESS")) {
      info.type = 'DEFENDANT_WITNESS';
    }
    
    if (text.includes('PREVIOUSLY SWORN')) {
      info.previouslySworn = true;
    }
    
    if (text.match(/DIRECT EXAMINATION/i)) {
      info.examinationType = 'DIRECT_EXAMINATION';
    } else if (text.match(/CROSS-EXAMINATION/i)) {
      info.examinationType = 'CROSS_EXAMINATION';
    } else if (text.match(/REDIRECT EXAMINATION/i)) {
      info.examinationType = 'REDIRECT_EXAMINATION';
    } else if (text.match(/RECROSS-EXAMINATION/i)) {
      info.examinationType = 'RECROSS_EXAMINATION';
    } else if (text.match(/VIDEO DEPOSITION/i)) {
      info.examinationType = 'VIDEO_DEPOSITION';
      info.presentedByVideo = true;
    }
    
    return info;
  }
}