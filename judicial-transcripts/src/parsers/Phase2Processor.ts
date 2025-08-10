// src/parsers/Phase2Processor.ts
import { PrismaClient } from '@prisma/client';
import { 
  TranscriptConfig, 
  Phase2Context,
  SpeakerInfo,
  SpeakerType,
  EventType,
  ExaminationType,
  SwornStatus,
  WitnessInfo,
  JurorInfo
} from '../types/config.types';
import { AttorneyService } from '../services/AttorneyService';
import { WitnessJurorService } from '../services/WitnessJurorService';
import logger from '../utils/logger';

interface ProcessingState {
  currentEvent: EventInfo | null;
  eventLines: any[];
  currentSpeaker: SpeakerInfo | null;
  currentWitness: WitnessInfo | null;
  currentExaminationType: ExaminationType | null;
  lastQSpeaker: SpeakerInfo | null; // Track who asked the last question
  contextualSpeakers: Map<string, SpeakerInfo>; // Map contextual prefixes like Q., A., THE WITNESS
}

interface EventInfo {
  type: EventType;
  startTime?: string;
  endTime?: string;
  startLineNumber?: number;
  endLineNumber?: number;
  speakerId?: number;
  text?: string;
  rawText?: string;
  metadata?: any;
}

export class Phase2Processor {
  private prisma: PrismaClient;
  private config: TranscriptConfig;
  private attorneyService: AttorneyService;
  private witnessJurorService: WitnessJurorService;
  private context: Phase2Context;
  private stats: {
    totalEvents: number;
    statementEvents: number;
    witnessEvents: number;
    directiveEvents: number;
    jurorStatements: number;
    anonymousSpeakers: number;
    unmatchedSpeakers: string[];
    errors: number;
  };

  // Enhanced patterns for event detection
  private readonly PATTERNS = {
    // Court directives - parenthetical content
    courtDirective: /^\s*\(([^)]+)\)\s*$/,
    courtDirectiveMultiline: /^\s*\(([^)]+)$/,
    
    // Speaker patterns
    speakerWithColon: /^([A-Z][A-Z\s\.,'-]+?):\s*/,
    contextualSpeaker: /^(Q\.|A\.|THE WITNESS|THE COURT)\s*/i,
    byAttorney: /^BY\s+(MR\.|MS\.|MRS\.|DR\.)\s+([A-Z]+)/i,
    jurorSpeaker: /^(JUROR\s+[A-Z0-9]+)/i,
    
    // Witness calling patterns
    witnessName: /^([A-Z][A-Z\s,\.]+?),?\s+(PLAINTIFF'S?|DEFENDANTS?')\s+WITNESS/i,
    witnessSworn: /\b(PREVIOUSLY\s+)?SWORN\b/i,
    
    // Examination types
    examinationType: /(DIRECT|CROSS|REDIRECT|RECROSS)[\s\-]?EXAMINATION/i,
    examinationContinued: /\bCONTINUED\b/i,
    videoDeposition: /PRESENTED\s+BY\s+VIDEO\s+DEPOSITION/i,
    
    // Special patterns
    blankLine: /^\s*$/,
    timestamp: /^\d{2}:\d{2}:\d{2}/
  };

  constructor(config: TranscriptConfig) {
    this.config = config;
    this.prisma = new PrismaClient();
    this.attorneyService = new AttorneyService(this.prisma);
    this.witnessJurorService = new WitnessJurorService(this.prisma);
    
    this.context = {
      trialId: 0,
      speakers: new Map(),
      attorneys: new Map(),
      witnesses: new Map(),
      jurors: new Map(),
      lineBuffer: [],
      eventBuffer: []
    };
    
    this.stats = {
      totalEvents: 0,
      statementEvents: 0,
      witnessEvents: 0,
      directiveEvents: 0,
      jurorStatements: 0,
      anonymousSpeakers: 0,
      unmatchedSpeakers: [],
      errors: 0
    };
  }

  /**
   * Process Phase 2 for a trial
   */
  async processTrial(trialId: number): Promise<void> {
    logger.info('='.repeat(60));
    logger.info('STARTING PHASE 2 PROCESSING');
    logger.info(`Trial ID: ${trialId}`);
    logger.info('='.repeat(60));
    
    this.context.trialId = trialId;
    
    try {
      // Load trial context (attorneys, judge, etc.)
      await this.loadTrialContext(trialId);
      
      // Process sessions in order
      const sessions = await this.prisma.session.findMany({
        where: { trialId },
        orderBy: { sessionDate: 'asc' }
      });
      
      for (const session of sessions) {
        await this.processSession(session);
      }
      
      // Log statistics
      this.logStatistics();
      
    } catch (error) {
      logger.error(`Phase 2 processing failed: ${error}`);
      throw error;
    }
  }

  /**
   * Load trial context including speakers
   */
  private async loadTrialContext(trialId: number): Promise<void> {
    // Load attorneys and their speakers
    this.context.attorneys = await this.attorneyService.getTrialAttorneys(trialId);
    logger.info(`Loaded ${this.context.attorneys.size} attorneys`);
    
    // Load judge speaker
    const judge = await this.prisma.judge.findFirst({
      where: { trialId },
      include: { speaker: true }
    });
    
    if (judge && judge.speaker) {
      const judgeInfo: SpeakerInfo = {
        id: judge.speaker.id,
        speakerPrefix: judge.speaker.speakerPrefix,
        speakerType: SpeakerType.JUDGE,
        name: judge.name,
        judgeId: judge.id
      };
      this.context.speakers.set('THE COURT', judgeInfo);
      this.context.speakers.set('COURT', judgeInfo);
      logger.info(`Loaded judge: ${judge.name}`);
    }
    
    // Load existing witnesses
    const witnesses = await this.prisma.witness.findMany({
      where: { trialId },
      include: { speaker: true }
    });
    
    for (const witness of witnesses) {
      if (witness.name) {
        this.context.witnesses.set(witness.name.toUpperCase(), witness.id);
      }
    }
    logger.info(`Loaded ${witnesses.length} witnesses`);
    
    // Load existing jurors
    const jurors = await this.prisma.juror.findMany({
      where: { trialId },
      include: { speaker: true }
    });
    
    for (const juror of jurors) {
      const jurorInfo: JurorInfo = {
        id: juror.id,
        name: juror.name || undefined,
        lastName: juror.lastName || undefined,
        jurorNumber: juror.jurorNumber || undefined,
        speakerPrefix: juror.speaker?.speakerPrefix || '',
        alias: juror.alias || undefined
      };
      
      if (juror.speaker) {
        this.context.jurors.set(juror.speaker.speakerPrefix, jurorInfo);
      }
      if (juror.alias) {
        this.context.jurors.set(juror.alias, jurorInfo);
      }
    }
    logger.info(`Loaded ${jurors.length} jurors`);
  }

  /**
   * Process a session
   */
  private async processSession(session: any): Promise<void> {
    logger.info(`Processing session: ${session.sessionDate} - ${session.sessionType}`);
    
    // Get all lines for this session in order
    const pages = await this.prisma.page.findMany({
      where: { 
        sessionId: session.id,
        documentSection: 'PROCEEDINGS'
      },
      orderBy: { pageNumber: 'asc' },
      include: {
        lines: {
          orderBy: { lineNumber: 'asc' }
        }
      }
    });
    
    const state: ProcessingState = {
      currentEvent: null,
      eventLines: [],
      currentSpeaker: null,
      currentWitness: this.witnessJurorService.getCurrentWitness(),
      currentExaminationType: null,
      lastQSpeaker: null,
      contextualSpeakers: new Map()
    };
    
    // Process lines sequentially
    for (const page of pages) {
      for (const line of page.lines) {
        await this.processLine(session.id, line, state);
      }
    }
    
    // Save any remaining event
    if (state.currentEvent) {
      await this.saveEvent(this.context.trialId, session.id, state.currentEvent, state.eventLines);
    }
  }

  /**
   * Process a single line
   */
  private async processLine(
    sessionId: number,
    line: any,
    state: ProcessingState
  ): Promise<void> {
    // Skip blank lines
    if (line.isBlank || (!line.text?.trim() && !line.speakerPrefix)) {
      return;
    }
    
    const lineText = line.text?.trim() || '';
    
    // Debug log for lines with speakers
    if (line.speakerPrefix) {
      logger.debug(`Line ${line.lineNumber} has speaker: ${line.speakerPrefix}, text: ${lineText.substring(0, 50)}`);
    }
    
    // Check for court directive
    if (await this.checkCourtDirective(sessionId, line, lineText, state)) {
      return;
    }
    
    // Check for witness being called
    if (await this.checkWitnessCalled(sessionId, line, lineText, state)) {
      return;
    }
    
    // Check for examination type change
    if (await this.checkExaminationChange(sessionId, line, lineText, state)) {
      return;
    }
    
    // Check for speaker statement
    if (await this.checkSpeakerStatement(sessionId, line, lineText, state)) {
      return;
    }
    
    // If we have a current event, add this line to it
    if (state.currentEvent) {
      state.eventLines.push(line);
      
      // Update end time and line number
      if (line.timestamp) {
        state.currentEvent.endTime = line.timestamp;
      }
      state.currentEvent.endLineNumber = line.lineNumber;
    }
  }

  /**
   * Check for court directive
   */
  private async checkCourtDirective(
    sessionId: number,
    line: any,
    lineText: string,
    state: ProcessingState
  ): Promise<boolean> {
    const match = lineText.match(this.PATTERNS.courtDirective);
    if (!match) return false;
    
    // Save current event if exists
    if (state.currentEvent) {
      await this.saveEvent(this.context.trialId, sessionId, state.currentEvent, state.eventLines);
    }
    
    // Create court directive event
    state.currentEvent = {
      type: EventType.COURT_DIRECTIVE,
      startTime: line.timestamp,
      startLineNumber: line.lineNumber,
      endLineNumber: line.lineNumber,
      rawText: match[1],
      metadata: {
        directiveText: match[1]
      }
    };
    state.eventLines = [line];
    
    // Save immediately (court directives are usually single line)
    await this.saveEvent(this.context.trialId, sessionId, state.currentEvent, state.eventLines);
    state.currentEvent = null;
    state.eventLines = [];
    
    return true;
  }

  /**
   * Check for witness being called
   */
  private async checkWitnessCalled(
    sessionId: number,
    line: any,
    lineText: string,
    state: ProcessingState
  ): Promise<boolean> {
    const nameMatch = lineText.match(this.PATTERNS.witnessName);
    if (!nameMatch) return false;
    
    // Save current event if exists
    if (state.currentEvent) {
      await this.saveEvent(this.context.trialId, sessionId, state.currentEvent, state.eventLines);
    }
    
    // Start witness called event
    state.currentEvent = {
      type: EventType.WITNESS_CALLED,
      startTime: line.timestamp,
      startLineNumber: line.lineNumber,
      endLineNumber: line.lineNumber,
      rawText: lineText,
      metadata: {
        witnessName: nameMatch[1],
        witnessCaller: nameMatch[2].toUpperCase().includes('PLAINTIFF') ? 'PLAINTIFF' : 'DEFENDANT'
      }
    };
    state.eventLines = [line];
    
    logger.info(`Witness called detected: ${nameMatch[1]}`);
    return true;
  }

  /**
   * Check for examination type change
   */
  private async checkExaminationChange(
    sessionId: number,
    line: any,
    lineText: string,
    state: ProcessingState
  ): Promise<boolean> {
    const examMatch = lineText.match(this.PATTERNS.examinationType);
    if (!examMatch) return false;
    
    // If we're in a witness event, add to it
    if (state.currentEvent?.type === EventType.WITNESS_CALLED) {
      state.eventLines.push(line);
      state.currentEvent.endLineNumber = line.lineNumber;
      
      // Extract examination type
      const examType = examMatch[1].toUpperCase();
      const continued = !!lineText.match(this.PATTERNS.examinationContinued);
      
      state.currentEvent.metadata = {
        ...state.currentEvent.metadata,
        examinationType: `${examType}_EXAMINATION`,
        continued
      };
      
      // Check for sworn status
      if (state.eventLines.some(l => l.text?.match(this.PATTERNS.witnessSworn))) {
        const previouslySworn = state.eventLines.some(l => l.text?.match(/PREVIOUSLY\s+SWORN/i));
        state.currentEvent.metadata.swornStatus = previouslySworn ? 'PREVIOUSLY_SWORN' : 'SWORN';
      }
      
      return true;
    }
    
    // If current witness exists, create examination change event
    if (state.currentWitness) {
      // Save current event
      if (state.currentEvent) {
        await this.saveEvent(this.context.trialId, sessionId, state.currentEvent, state.eventLines);
      }
      
      // Create new witness event for examination change
      state.currentEvent = {
        type: EventType.WITNESS_CALLED,
        startTime: line.timestamp,
        startLineNumber: line.lineNumber,
        endLineNumber: line.lineNumber,
        rawText: lineText,
        metadata: {
          witnessId: state.currentWitness.id,
          examinationType: `${examMatch[1].toUpperCase()}_EXAMINATION`,
          continued: !!lineText.match(this.PATTERNS.examinationContinued)
        }
      };
      state.eventLines = [line];
      
      // Update current examination type
      state.currentExaminationType = state.currentEvent.metadata.examinationType;
    }
    
    return false;
  }

  /**
   * Check for speaker statement
   */
  private async checkSpeakerStatement(
    sessionId: number,
    line: any,
    lineText: string,
    state: ProcessingState
  ): Promise<boolean> {
    // Check if line has a speaker prefix (from Phase 1 parsing)
    if (!line.speakerPrefix) return false;
    
    // Save current event if it's different
    if (state.currentEvent && 
        (state.currentEvent.type !== EventType.STATEMENT || 
         state.currentSpeaker?.speakerPrefix !== line.speakerPrefix)) {
      await this.saveEvent(this.context.trialId, sessionId, state.currentEvent, state.eventLines);
      state.currentEvent = null;
      state.eventLines = [];
    }
    
    // Find or create speaker
    const speaker = await this.findOrCreateSpeaker(line.speakerPrefix, lineText, state);
    
    if (!speaker) {
      logger.warn(`Could not resolve speaker: ${line.speakerPrefix}`);
      this.stats.unmatchedSpeakers.push(line.speakerPrefix);
      return false;
    }
    
    // Start new statement event or continue existing
    if (!state.currentEvent) {
      state.currentEvent = {
        type: EventType.STATEMENT,
        startTime: line.timestamp,
        startLineNumber: line.lineNumber,
        endLineNumber: line.lineNumber,
        speakerId: speaker.id,
        text: lineText
      };
      state.eventLines = [line];
      state.currentSpeaker = speaker;
    } else {
      // Continue existing statement
      state.eventLines.push(line);
      state.currentEvent.endTime = line.timestamp;
      state.currentEvent.endLineNumber = line.lineNumber;
      state.currentEvent.text = (state.currentEvent.text || '') + '\n' + lineText;
    }
    
    // Handle contextual speaker updates
    this.updateContextualSpeakers(line.speakerPrefix, speaker, state);
    
    return true;
  }

  /**
   * Find or create speaker based on prefix
   */
  private async findOrCreateSpeaker(
    speakerPrefix: string,
    lineText: string,
    state: ProcessingState
  ): Promise<SpeakerInfo | null> {
    const upperPrefix = speakerPrefix.toUpperCase();
    
    // Handle contextual speakers Q., A., THE WITNESS
    if (upperPrefix === 'Q.') {
      // Q. is the current examining attorney
      if (state.lastQSpeaker) {
        logger.debug(`Q. resolved to: ${state.lastQSpeaker.name || state.lastQSpeaker.speakerPrefix}`);
        return state.lastQSpeaker;
      }
      logger.warn(`Q. speaker found but no examining attorney in context`);
      return null;
    }
    
    if (upperPrefix === 'A.' || upperPrefix === 'THE WITNESS') {
      // A. or THE WITNESS is the current witness
      if (state.currentWitness?.speakerId) {
        const speaker = await this.prisma.speaker.findUnique({
          where: { id: state.currentWitness.speakerId }
        });
        if (speaker) {
          logger.debug(`${upperPrefix} resolved to witness: ${state.currentWitness.name}`);
          return {
            id: speaker.id,
            speakerPrefix: speaker.speakerPrefix,
            speakerType: SpeakerType.WITNESS,
            witnessId: state.currentWitness.id
          };
        }
      }
      logger.warn(`${upperPrefix} found but no current witness in context`);
      return null;
    }
    
    // Check for THE COURT
    if (upperPrefix === 'THE COURT' || upperPrefix === 'COURT') {
      return this.context.speakers.get('THE COURT') || null;
    }
    
    // Check for BY MR./MS. pattern (attorney taking over questioning)
    const byMatch = upperPrefix.match(/BY\s+(MR\.|MS\.|MRS\.|DR\.)\s+([A-Z]+)/);
    if (byMatch) {
      const attorneyPrefix = `${byMatch[1]} ${byMatch[2]}`;
      const attorney = await this.attorneyService.findAttorneyBySpeakerPrefix(
        this.context.trialId, 
        attorneyPrefix
      );
      
      if (attorney) {
        const speaker: SpeakerInfo = {
          id: attorney.speaker.id,
          speakerPrefix: attorney.speaker.speakerPrefix,
          speakerType: SpeakerType.ATTORNEY,
          attorneyId: attorney.id,
          name: attorney.name
        };
        // Update the Q. context - this attorney is now asking questions
        state.lastQSpeaker = speaker;
        logger.info(`Updated Q. context to: ${attorney.name}`);
        return speaker;
      }
    }
    
    // Check for attorney by full prefix (MR. LASTNAME)
    const attorneyMatch = upperPrefix.match(/^(MR\.|MS\.|MRS\.|DR\.)\s+([A-Z]+)/);
    if (attorneyMatch) {
      const attorney = await this.attorneyService.findAttorneyBySpeakerPrefix(
        this.context.trialId,
        upperPrefix
      );
      
      if (attorney) {
        const speaker: SpeakerInfo = {
          id: attorney.speaker.id,
          speakerPrefix: attorney.speaker.speakerPrefix,
          speakerType: SpeakerType.ATTORNEY,
          attorneyId: attorney.id,
          name: attorney.name
        };
        
        // If this attorney is speaking in a witness context, they might be the Q. speaker
        if (state.currentWitness) {
          state.lastQSpeaker = speaker;
          logger.debug(`Set Q. context to: ${attorney.name} (during witness examination)`);
        }
        
        return speaker;
      }
      
      // If not found as attorney, could be a juror (handled below)
      logger.warn(`Could not find attorney with prefix: ${upperPrefix}`);
    }
    
    // Check for juror
    if (upperPrefix.match(/^JUROR\s+/)) {
      const juror = await this.witnessJurorService.createOrFindJuror(
        this.context.trialId,
        upperPrefix,
        lineText
      );
      
      this.stats.jurorStatements++;
      
      return {
        id: juror.id,
        speakerPrefix: upperPrefix,
        speakerType: SpeakerType.JUROR,
        jurorId: juror.id
      };
    }
    
    // Try juror alias match (MR./MS. LASTNAME pattern when not an attorney)
    if (attorneyMatch) {
      const jurorAlias = await this.witnessJurorService.matchJurorByAlias(
        this.context.trialId,
        upperPrefix
      );
      
      if (jurorAlias) {
        this.stats.jurorStatements++;
        return {
          id: jurorAlias.id,
          speakerPrefix: upperPrefix,
          speakerType: SpeakerType.JUROR,
          jurorId: jurorAlias.id
        };
      }
    }
    
    // Create anonymous speaker as last resort
    logger.info(`Creating anonymous speaker for: ${upperPrefix}`);
    const speakerId = await this.witnessJurorService.createAnonymousSpeaker(
      this.context.trialId,
      upperPrefix
    );
    
    this.stats.anonymousSpeakers++;
    
    return {
      id: speakerId,
      speakerPrefix: upperPrefix,
      speakerType: SpeakerType.ANONYMOUS
    };
  }

  /**
   * Update contextual speaker mappings
   */
  private updateContextualSpeakers(
    speakerPrefix: string,
    speaker: SpeakerInfo,
    state: ProcessingState
  ): void {
    const upperPrefix = speakerPrefix.toUpperCase();
    
    // If attorney speaks, they might be the Q. speaker
    if (speaker.speakerType === SpeakerType.ATTORNEY && 
        !['Q.', 'A.', 'THE WITNESS'].includes(upperPrefix)) {
      state.lastQSpeaker = speaker;
      state.contextualSpeakers.set('Q.', speaker);
    }
    
    // If witness speaks, update A. mapping
    if (speaker.speakerType === SpeakerType.WITNESS) {
      state.contextualSpeakers.set('A.', speaker);
      state.contextualSpeakers.set('THE WITNESS', speaker);
    }
  }

  /**
   * Save event to database
   */
  private async saveEvent(
    trialId: number,
    sessionId: number,
    eventInfo: EventInfo,
    lines: any[]
  ): Promise<void> {
    try {
      // Calculate duration if we have timestamps
      let duration: number | undefined;
      if (eventInfo.startTime && eventInfo.endTime) {
        duration = this.calculateDuration(eventInfo.startTime, eventInfo.endTime);
      }
      
      // Create trial event
      const event = await this.prisma.trialEvent.create({
        data: {
          trialId,
          sessionId,
          startTime: eventInfo.startTime,
          endTime: eventInfo.endTime,
          duration,
          startLineNumber: eventInfo.startLineNumber,
          endLineNumber: eventInfo.endLineNumber,
          lineCount: lines.length,
          eventType: eventInfo.type
        }
      });
      
      this.stats.totalEvents++;
      
      // Create specific event type
      switch (eventInfo.type) {
        case EventType.COURT_DIRECTIVE:
          await this.createCourtDirective(event.id, eventInfo);
          this.stats.directiveEvents++;
          break;
          
        case EventType.STATEMENT:
          await this.createStatement(event.id, eventInfo, lines);
          this.stats.statementEvents++;
          break;
          
        case EventType.WITNESS_CALLED:
          await this.createWitnessCalled(event.id, eventInfo, lines);
          this.stats.witnessEvents++;
          break;
      }
      
    } catch (error) {
      logger.error(`Error saving event: ${error}`);
      this.stats.errors++;
      throw error;
    }
  }

  /**
   * Create court directive event
   */
  private async createCourtDirective(eventId: number, eventInfo: EventInfo): Promise<void> {
    const directiveText = eventInfo.metadata?.directiveText || eventInfo.rawText || '';
    
    // Find or create directive type
    let directiveType = await this.prisma.courtDirectiveType.findFirst({
      where: {
        OR: [
          { name: directiveText },
          { aliases: { has: directiveText } }
        ]
      }
    });
    
    if (!directiveType) {
      // Create new directive type
      directiveType = await this.prisma.courtDirectiveType.create({
        data: {
          name: directiveText,
          description: `Auto-detected: ${directiveText}`,
          isPaired: false,
          aliases: []
        }
      });
      
      logger.info(`Created new directive type: ${directiveText}`);
    }
    
    await this.prisma.courtDirectiveEvent.create({
      data: {
        eventId,
        directiveTypeId: directiveType.id,
        rawText: directiveText.substring(0, 255),
        isStandard: false
      }
    });
  }

  /**
   * Create statement event
   */
  private async createStatement(eventId: number, eventInfo: EventInfo, lines: any[]): Promise<void> {
    // Combine all line text
    const fullText = lines
      .map(l => l.text || '')
      .join('\n')
      .trim();
    
    await this.prisma.statementEvent.create({
      data: {
        eventId,
        speakerId: eventInfo.speakerId,
        text: fullText
      }
    });
  }

  /**
   * Create witness called event
   */
  private async createWitnessCalled(eventId: number, eventInfo: EventInfo, lines: any[]): Promise<void> {
    // Combine all lines for parsing
    const fullText = lines
      .map(l => l.text || '')
      .join('\n')
      .trim();
    
    // Parse witness information
    const parsed = this.witnessJurorService.parseWitnessCalledText(fullText);
    
    // Create or find witness
    let witnessId: number | undefined;
    
    if (eventInfo.metadata?.witnessId) {
      witnessId = eventInfo.metadata.witnessId;
    } else if (parsed.name || eventInfo.metadata?.witnessName) {
      const witnessName = parsed.name || eventInfo.metadata?.witnessName;
      
      // Create speaker for witness
      let speaker = await this.prisma.speaker.findFirst({
        where: {
          trialId: this.context.trialId,
          speakerPrefix: 'A.',
          speakerType: 'WITNESS'
        }
      });
      
      if (!speaker) {
        speaker = await this.prisma.speaker.create({
          data: {
            trialId: this.context.trialId,
            speakerPrefix: 'A.',
            speakerType: 'WITNESS'
          }
        });
      }
      
      // Find or create witness
      let witness = await this.prisma.witness.findFirst({
        where: {
          trialId: this.context.trialId,
          name: witnessName
        }
      });
      
      if (!witness) {
        witness = await this.prisma.witness.create({
          data: {
            trialId: this.context.trialId,
            name: witnessName,
            witnessType: parsed.witnessType,
            witnessCaller: parsed.witnessCaller || eventInfo.metadata?.witnessCaller,
            speakerId: speaker.id
          }
        });
        
        logger.info(`Created witness: ${witnessName}`);
      }
      
      witnessId = witness.id;
      
      // Update current witness context
      this.witnessJurorService.setCurrentWitness({
        id: witness.id,
        name: witness.name || undefined,
        witnessType: witness.witnessType || undefined,
        witnessCaller: witness.witnessCaller || undefined,
        speakerId: witness.speakerId
      });
    }
    
    // Create witness called event
    if (witnessId && (parsed.examinationType || eventInfo.metadata?.examinationType)) {
      await this.prisma.witnessCalledEvent.create({
        data: {
          eventId,
          witnessId,
          examinationType: parsed.examinationType || eventInfo.metadata?.examinationType,
          swornStatus: parsed.swornStatus || eventInfo.metadata?.swornStatus || 'NOT_SWORN',
          continued: parsed.continued || eventInfo.metadata?.continued || false,
          presentedByVideo: parsed.presentedByVideo || false,
          rawText: fullText.substring(0, 255)
        }
      });
    }
  }

  /**
   * Calculate duration between two timestamps
   */
  private calculateDuration(startTime: string, endTime: string): number {
    const [sh, sm, ss] = startTime.split(':').map(Number);
    const [eh, em, es] = endTime.split(':').map(Number);
    
    const startSeconds = sh * 3600 + sm * 60 + ss;
    const endSeconds = eh * 3600 + em * 60 + es;
    
    return endSeconds - startSeconds;
  }

  /**
   * Log processing statistics
   */
  private logStatistics(): void {
    logger.info('\n' + '='.repeat(60));
    logger.info('📊 PHASE 2 PROCESSING COMPLETED');
    logger.info('='.repeat(60));
    logger.info(`✅ Total events created: ${this.stats.totalEvents}`);
    logger.info(`💬 Statement events: ${this.stats.statementEvents}`);
    logger.info(`👤 Witness events: ${this.stats.witnessEvents}`);
    logger.info(`📋 Directive events: ${this.stats.directiveEvents}`);
    logger.info(`👥 Juror statements: ${this.stats.jurorStatements}`);
    logger.info(`❓ Anonymous speakers: ${this.stats.anonymousSpeakers}`);
    
    if (this.stats.unmatchedSpeakers.length > 0) {
      logger.warn(`⚠️  Unmatched speakers: ${this.stats.unmatchedSpeakers.length}`);
      const unique = [...new Set(this.stats.unmatchedSpeakers)];
      unique.slice(0, 10).forEach(s => logger.warn(`   - ${s}`));
      if (unique.length > 10) {
        logger.warn(`   ... and ${unique.length - 10} more`);
      }
    }
    
    if (this.stats.errors > 0) {
      logger.error(`❌ Errors encountered: ${this.stats.errors}`);
    }
    
    logger.info('='.repeat(60));
  }
}