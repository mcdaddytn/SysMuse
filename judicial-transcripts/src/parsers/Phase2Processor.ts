// src/parsers/phase2/Phase2Processor.ts
// src/parsers/Phase2Processor.ts
import { PrismaClient } from '@prisma/client';
import { TranscriptConfig, ParsingContext } from '../../types/config.types';
import logger from '../../utils/logger';

export class Phase2Processor {
  private prisma: PrismaClient;
  private config: TranscriptConfig;
  private context: ParsingContext;
  
  constructor(config: TranscriptConfig) {
    this.prisma = new PrismaClient();
    this.config = config;
    this.context = {
      attorneys: new Map(),
      witnesses: new Map()
    };
  }
  
  async process(): Promise<void> {
    logger.info('Starting Phase 2: Processing line groups into trial events');
    
    try {
      // Get all trials (for now, process all - could be filtered by config)
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
      logger.error('Error during Phase 2 processing:', error);
      throw error;
    } finally {
      await this.prisma.$disconnect();
    }
  }
  
  private async processTrial(trial: any): Promise<void> {
    // Load attorneys and witnesses for context
    await this.loadTrialContext(trial.id);
    
    // Process each session in chronological order
    for (const session of trial.sessions) {
      await this.processSession(trial.id, session);
    }
  }
  
  private async loadTrialContext(trialId: number): Promise<void> {
    // Load attorneys
    const trialAttorneys = await this.prisma.trialAttorney.findMany({
      where: { trialId },
      include: { attorney: true }
    });
    
    for (const ta of trialAttorneys) {
      this.context.attorneys.set(ta.attorney.name, ta.attorney.id);
    }
    
    // Load witnesses
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
    
    // Get all pages and lines for this session
    const pages = await this.prisma.page.findMany({
      where: { sessionId: session.id },
      orderBy: { pageNumber: 'asc' },
      include: {
        lines: {
          orderBy: { lineNumber: 'asc' }
        }
      }
    });
    
    // Process lines to group into events
    await this.groupLinesIntoEvents(trialId, pages);
  }
  
  private async groupLinesIntoEvents(trialId: number, pages: any[]): Promise<void> {
    let currentEvent: any = null;
    let eventLines: any[] = [];
    
    for (const page of pages) {
      for (const line of page.lines) {
        if (line.isBlank) continue;
        
        // Check if this starts a new event
        if (this.isEventStart(line)) {
          // Save previous event if exists
          if (currentEvent && eventLines.length > 0) {
            await this.saveEvent(trialId, currentEvent, eventLines);
          }
          
          // Start new event
          currentEvent = this.createEventFromLine(line);
          eventLines = [line];
        } else if (currentEvent) {
          // Continue current event
          eventLines.push(line);
        }
      }
    }
    
    // Save last event
    if (currentEvent && eventLines.length > 0) {
      await this.saveEvent(trialId, currentEvent, eventLines);
    }
  }
  
  private isEventStart(line: any): boolean {
    // New event starts with:
    // - Timestamp
    // - Speaker change
    // - Court directive
    // - Witness examination type
    
    return !!(line.timestamp || line.speakerPrefix || 
              (line.text && line.text.match(/^\([^)]+\)$/)) ||
              (line.text && line.text.match(/EXAMINATION/i)));
  }
  
  private createEventFromLine(line: any): any {
    const event: any = {
      startTime: line.timestamp,
      startLineNumber: line.lineNumber,
      type: 'STATEMENT' // default
    };
    
    // Determine event type
    if (line.text && line.text.match(/^\([^)]+\)$/)) {
      event.type = 'COURT_DIRECTIVE';
      event.directiveText = line.text.replace(/[()]/g, '').trim();
    } else if (line.speakerPrefix) {
      event.type = 'STATEMENT';
      event.speaker = line.speakerPrefix;
    } else if (line.text && line.text.match(/EXAMINATION/i)) {
      event.type = 'WITNESS_CALLED';
    }
    
    return event;
  }
  
  private async saveEvent(trialId: number, eventInfo: any, lines: any[]): Promise<void> {
    // Calculate event details
    const startLine = lines[0];
    const endLine = lines[lines.length - 1];
    
    // Combine text from all lines
    const fullText = lines
      .map(l => l.text)
      .filter(t => t)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    
    // Create base trial event
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
    
    // Create specific event type record
    if (eventInfo.type === 'COURT_DIRECTIVE') {
      await this.createCourtDirectiveEvent(event.id, eventInfo.directiveText);
    } else if (eventInfo.type === 'STATEMENT') {
      await this.createStatementEvent(event.id, eventInfo.speaker, fullText);
    } else if (eventInfo.type === 'WITNESS_CALLED') {
      await this.createWitnessCalledEvent(event.id, fullText);
    }
  }
  
  private async createCourtDirectiveEvent(eventId: number, directiveText: string): Promise<void> {
    // Look up directive type
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
      // Create non-standard directive
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
  
  private async createStatementEvent(eventId: number, speaker: string, text: string): Promise<void> {
    // Determine speaker type
    let speakerType: any = 'OTHER';
    let speakerName = speaker;
    
    if (speaker.includes('THE COURT')) {
      speakerType = 'JUDGE';
    } else if (speaker === 'Q.') {
      speakerType = this.context.currentExaminationType?.includes('CROSS') ? 
        'DEFENDANT_ATTORNEY' : 'PLAINTIFF_ATTORNEY';
    } else if (speaker === 'A.') {
      speakerType = this.context.currentWitness?.type === 'PLAINTIFF_WITNESS' ?
        'PLAINTIFF_WITNESS' : 'DEFENDANT_WITNESS';
    } else if (speaker.match(/^(MR\.|MS\.|MRS\.)/)) {
      // Look up attorney
      const attorneyId = this.context.attorneys.get(speaker);
      if (attorneyId) {
        const trialAttorney = await this.prisma.trialAttorney.findFirst({
          where: { 
            attorneyId,
            trialId: this.context.currentSession?.id 
          }
        });
        speakerType = trialAttorney?.role === 'PLAINTIFF' ? 
          'PLAINTIFF_ATTORNEY' : 'DEFENDANT_ATTORNEY';
      }
    }
    
    // Create statement event
    const statement = await this.prisma.statementEvent.create({
      data: {
        eventId,
        speakerType,
        speakerName
      }
    });
    
    // Create specific statement type
    if (speakerType === 'JUDGE') {
      await this.prisma.courtStatementEvent.create({
        data: {
          statementId: statement.id,
          statementType: this.determineCourtStatementType(text)
        }
      });
    } else if (speakerType.includes('ATTORNEY')) {
      const attorneyId = this.context.attorneys.get(speakerName);
      await this.prisma.attorneyStatementEvent.create({
        data: {
          statementId: statement.id,
          attorneyId
        }
      });
    } else if (speakerType.includes('WITNESS')) {
      await this.prisma.witnessStatementEvent.create({
        data: {
          statementId: statement.id,
          witnessId: this.context.currentWitness?.id,
          examinationType: this.context.currentExaminationType as any
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
    // Parse witness information from text
    const witnessInfo = this.parseWitnessCall(text);
    
    if (!witnessInfo) return;
    
    // Find or create witness
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
      
      // Update context
      this.context.witnesses.set(witnessInfo.name, witness.id);
    }
    
    // Update current witness context
    if (witness) {
      this.context.currentWitness = {
        id: witness.id,
        name: witness.name || '',
        type: witness.witnessType
      };
    }
    
    // Update examination type context
    this.context.currentExaminationType = witnessInfo.examinationType;
    
    // Create witness called event
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
    
    // Extract witness name (usually in caps before comma)
    const nameMatch = text.match(/^([A-Z\s,\.]+?)(?:,|\s+(?:PLAINTIFF|DEFENDANT))/);
    if (nameMatch) {
      info.name = nameMatch[1].trim();
    }
    
    // Determine witness type
    if (text.includes("PLAINTIFF'S WITNESS")) {
      info.type = 'PLAINTIFF_WITNESS';
    } else if (text.includes("DEFENDANT'S WITNESS")) {
      info.type = 'DEFENDANT_WITNESS';
    }
    
    // Check if previously sworn
    if (text.includes('PREVIOUSLY SWORN')) {
      info.previouslySworn = true;
    }
    
    // Determine examination type
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