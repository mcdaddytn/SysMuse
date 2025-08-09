// src/parsers/Phase2Processor.ts
// Enhanced Phase 2 Processor with better statement parsing and duration calculation

import { PrismaClient } from '@prisma/client';
import { TranscriptConfig, ParsingContext } from '../types/config.types';
import logger from '../utils/logger';

interface EventInfo {
  type: 'COURT_DIRECTIVE' | 'STATEMENT' | 'WITNESS_CALLED' | 'EXAMINATION_CHANGE' | 'OTHER';
  startTime: string;
  speaker?: string;
  directiveText?: string;
  witnessName?: string;
  examinationType?: string;
  previouslySworn?: boolean;
  presentedByVideo?: boolean;
  continued?: boolean;
}

interface WitnessInfo {
  id?: number;
  name: string;
  type: 'PLAINTIFF_WITNESS' | 'DEFENDANT_WITNESS' | 'EXPERT_WITNESS';
  lastExaminationType?: string;
}

interface LineGroupingState {
  currentEvent: EventInfo | null;
  eventLines: any[];
  pendingDirective: { text: string; lines: any[] } | null;
  currentSpeaker: string | null;
  currentWitness: WitnessInfo | null;
  currentExaminationType: string | null;
  isInQA: boolean;
  lastQAttorney: string | null;
  currentTrialId?: number;
}

export class Phase2Processor {
  private prisma: PrismaClient;
  private config: TranscriptConfig;
  private context: ParsingContext & { 
    currentTrialId?: number;
    currentWitnessInfo?: WitnessInfo;
  };
  private stats: {
    totalEvents: number;
    directiveEvents: number;
    statementEvents: number;
    witnessEvents: number;
    examinationChanges: number;
    multiLineDirectives: number;
    orphanedLines: number;
    errors: number;
    unknownDirectives: string[];
  };
  
  // Patterns for identifying different event types
  private readonly PATTERNS = {
    // Court directives - must be entire line(s) within parentheses
    courtDirectiveStart: /^\s*\(\s*(.+?)(?:\)|$)/,
    courtDirectiveFull: /^\s*\((.+)\)\s*$/,
    
    // Speaker patterns - CRITICAL for identifying statements
    // After timestamp and line number, look for capitalized text followed by colon
    // Examples: "THE COURT:", "MR. LAMBRIANAKOS:", "COURT SECURITY OFFICER:"
    speakerPrefix: /^\s*([A-Z][A-Z\s\.,'-]+?):\s*/,
    
    // Q/A patterns - special case for witness testimony
    qaPrefix: /^\s*(Q\.|A\.)\s+/,
    
    // Special patterns
    byAttorneyInline: /^\s*\(By\s+(Mr\.|Ms\.|Mrs\.)\s+([A-Za-z]+)\)\s*/i,
    
    // Examination types (standalone lines)
    examinationStandalone: /^\s*(DIRECT|CROSS|REDIRECT|RECROSS)[\s\-]?EXAMINATION\s*(CONTINUED)?\s*$/i,
    videoDeposition: /^\s*PRESENTED BY VIDEO DEPOSITION\s*$/i,
    
    // Witness patterns (name lines)
    witnessName: /^([A-Z][A-Z\s,\.]+?),?\s+(PLAINTIFF'S|PLAINTIFF|DEFENDANTS?'|DEFENDANTS?)\s+WITNESS/i,
    witnessSworn: /\b(PREVIOUSLY\s+)?SWORN\s*$/i,
    witnessPhD: /\bPH\.?D\.?\b/i
  };
  
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
    this.stats = {
      totalEvents: 0,
      directiveEvents: 0,
      statementEvents: 0,
      witnessEvents: 0,
      examinationChanges: 0,
      multiLineDirectives: 0,
      orphanedLines: 0,
      errors: 0,
      unknownDirectives: []
    };
  }
  
  async process(): Promise<void> {
    logger.info('=== PHASE 2 PROCESSING START ===');
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
        logger.info(`\n=== Processing trial: ${trial.caseNumber} ===`);
        await this.processTrial(trial);
      }
      
      this.printStatistics();
      logger.info('=== PHASE 2 PROCESSING COMPLETED ===');
    } catch (error) {
      logger.error('Error during Phase 2 processing: ' + (error as Error).message);
      this.stats.errors++;
      throw error;
    } finally {
      await this.prisma.$disconnect();
    }
  }
  
  private async processTrial(trial: any): Promise<void> {
    await this.loadTrialContext(trial.id);
    
    // Store trial ID in context for later use
    this.context.currentTrialId = trial.id;
    
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
      if (ta.attorney.name) {
        this.context.attorneys.set(ta.attorney.name.toUpperCase(), ta.attorney.id);
        // Also store with common prefixes
        const lastName = ta.attorney.name.split(' ').pop()?.toUpperCase();
        if (lastName) {
          this.context.attorneys.set(`MR. ${lastName}`, ta.attorney.id);
          this.context.attorneys.set(`MS. ${lastName}`, ta.attorney.id);
          this.context.attorneys.set(`MRS. ${lastName}`, ta.attorney.id);
        }
      }
    }
    
    // Load witnesses
    const witnesses = await this.prisma.witness.findMany({
      where: { trialId }
    });
    
    for (const witness of witnesses) {
      if (witness.name) {
        this.context.witnesses.set(witness.name.toUpperCase(), witness.id);
      }
    }
    
    logger.info(`Loaded context: ${this.context.attorneys.size} attorneys, ${this.context.witnesses.size} witnesses`);
  }
  
  private async processSession(trialId: number, session: any): Promise<void> {
    logger.info(`\n--- Processing session: ${session.sessionDate.toISOString().split('T')[0]} ${session.sessionType} ---`);
    
    this.context.currentSession = {
      id: session.id,
      date: session.sessionDate,
      type: session.sessionType
    };
    
    const pages = await this.prisma.page.findMany({
      where: { 
        sessionId: session.id,
        documentSection: 'PROCEEDINGS' // Focus on proceedings pages
      },
      orderBy: { pageNumber: 'asc' },
      include: {
        lines: {
          orderBy: { lineNumber: 'asc' }
        }
      }
    });
    
    if (pages.length === 0) {
      logger.warn(`No PROCEEDINGS pages found for session ${session.id}`);
      return;
    }
    
    await this.groupLinesIntoEvents(trialId, pages);
  }
  
  private async groupLinesIntoEvents(trialId: number, pages: any[]): Promise<void> {
    const state: LineGroupingState = {
      currentEvent: null,
      eventLines: [],
      pendingDirective: null,
      currentSpeaker: null,
      currentWitness: null,
      currentExaminationType: null,
      isInQA: false,
      lastQAttorney: null,
      currentTrialId: trialId
    };
    
    let totalLinesProcessed = 0;
    let linesWithSpeakers = 0;
    
    for (const page of pages) {
      logger.debug(`Processing page ${page.pageNumber} with ${page.lines?.length || 0} lines`);
      
      for (let i = 0; i < page.lines.length; i++) {
        const line = page.lines[i];
        if (!line) continue;
        
        totalLinesProcessed++;
        
        // Log first 20 lines to see what Phase 1 gave us
        if (totalLinesProcessed <= 20) {
          logger.info(`=== Line ${line.lineNumber} ===`);
          logger.info(`  Text: "${line.text}"`);
          logger.info(`  Speaker Prefix: ${line.speakerPrefix || '[none]'}`);
          logger.info(`  Timestamp: ${line.timestamp || '[none]'}`);
          logger.info(`  Is Blank: ${line.isBlank}`);
        }
        
        // Check and log speaker BEFORE processing
        if (line.speakerPrefix) {
          linesWithSpeakers++;
          if (linesWithSpeakers <= 10) {
            logger.info(`Speaker found at line ${line.lineNumber}: "${line.speakerPrefix}"`);
          }
        }
        
        // IMPORTANT: Don't skip lines with speakers even if marked as blank
        if (line.isBlank && !line.text?.trim() && !line.speakerPrefix) {
          continue;
        }
        
        const nextLine = i + 1 < page.lines.length ? page.lines[i + 1] : null;
        await this.processLine(trialId, line, state, nextLine);
      }
    }
    
    // Save any remaining event
    if (state.currentEvent && state.eventLines.length > 0) {
      await this.saveEvent(trialId, state.currentEvent, state.eventLines);
    }
    
    logger.info(`=== PHASE 2 LINE ANALYSIS ===`);
    logger.info(`Total lines processed: ${totalLinesProcessed}`);
    logger.info(`Lines with speaker prefixes from Phase 1: ${linesWithSpeakers}`);
    logger.info(`================================`);
  }
  
  // Fixed processLine method for Phase2Processor.ts
  private async processLine(trialId: number, line: any, state: LineGroupingState, nextLine: any): Promise<void> {
    const lineText = line.text || '';
    const trimmedText = lineText.trim();
    
    // Log every 50th line for debugging
    if (line.lineNumber % 50 === 0) {
      logger.debug(`Processing line ${line.lineNumber}: "${this.truncate(lineText, 60)}"`);
    }
    
    // Check for multi-line directive continuation
    if (state.pendingDirective) {
      if (this.isDirectiveContinuation(trimmedText)) {
        // Add to pending directive
        const cleanText = trimmedText.replace(/\)\s*$/, '');
        state.pendingDirective.text += ' ' + cleanText;
        state.pendingDirective.lines.push(line);
        
        if (trimmedText.includes(')')) {
          // Directive complete - save it
          const eventInfo: EventInfo = {
            type: 'COURT_DIRECTIVE',
            startTime: state.pendingDirective.lines[0].timestamp || '',
            directiveText: state.pendingDirective.text.trim()
          };
          
          await this.saveEvent(trialId, eventInfo, state.pendingDirective.lines);
          this.stats.multiLineDirectives++;
          state.pendingDirective = null;
        }
        return;
      } else {
        // Not a valid directive continuation - treat as orphaned
        logger.warn(`Invalid multi-line directive: "${state.pendingDirective.text}"`);
        state.pendingDirective = null;
      }
    }
    
    // Check for complete single-line court directive
    const fullDirectiveMatch = trimmedText.match(this.PATTERNS.courtDirectiveFull);
    if (fullDirectiveMatch) {
      await this.handleSingleLineDirective(trialId, line, fullDirectiveMatch[1], state);
      return;
    }
    
    // Check for start of multi-line court directive
    const directiveStartMatch = trimmedText.match(this.PATTERNS.courtDirectiveStart);
    if (directiveStartMatch && !trimmedText.includes(')')) {
      // Check if next line could be continuation
      if (nextLine && !nextLine.isBlank) {
        const nextText = nextLine.text?.trim() || '';
        if (!this.extractSpeaker(nextLine.text) && !nextText.match(/^\d+\s+/)) {
          // Start multi-line directive
          state.pendingDirective = {
            text: directiveStartMatch[1],
            lines: [line]
          };
          
          // Save current event if exists
          if (state.currentEvent && state.eventLines.length > 0) {
            await this.saveEvent(trialId, state.currentEvent, state.eventLines);
            state.currentEvent = null;
            state.eventLines = [];
          }
          return;
        }
      }
    }
    
    // Check for "BY MR/MS" inline clarification (parenthetical)
    const byMatch = trimmedText.match(this.PATTERNS.byAttorneyInline);
    if (byMatch) {
      // This is a speaker clarification, update attorney context
      state.lastQAttorney = `${byMatch[1]} ${byMatch[2]}`.toUpperCase();
      logger.debug(`Attorney clarification: ${state.lastQAttorney}`);
      // Add to current event if exists
      if (state.currentEvent) {
        state.eventLines.push(line);
      }
      return;
    }
    
    // CRITICAL FIX: Check for speaker from Phase 1 FIRST!
    // Phase 1 already extracted speakers and put them in line.speakerPrefix
    let speaker = null;
    
    // Priority 1: Use speaker from Phase 1 if available
    if (line.speakerPrefix) {
      speaker = line.speakerPrefix;
      logger.debug(`Using speaker from Phase 1: "${speaker}"`);
    } 
    // Priority 2: Try to extract speaker from original line text (fallback)
    // This should only happen if Phase 1 missed it somehow
    else {
      // Need to reconstruct the original line to check for speakers
      // Phase 1 might have missed complex patterns
      const fullLine = line.timestamp ? 
        `${line.timestamp} ${line.lineNumber} ${lineText}` : 
        lineText;
      
      speaker = this.extractSpeaker(fullLine);
      if (speaker) {
        logger.debug(`Extracted speaker from text: "${speaker}"`);
      }
    }
    
    // If we found a speaker, handle the statement
    if (speaker) {
      // If we're in a witness event, save it first
      if (state.currentEvent && state.currentEvent.type === 'WITNESS_CALLED') {
        logger.debug(`Ending witness event due to speaker: ${speaker}`);
        await this.saveEvent(trialId, state.currentEvent, state.eventLines);
        state.currentEvent = null;
        state.eventLines = [];
      }
      
      await this.handleSpeakerStatement(trialId, line, speaker, state);
      return;
    }
    
    // Check for witness being called (only if not in a statement)
    if (!state.currentEvent || state.currentEvent.type !== 'STATEMENT') {
      const witnessNameMatch = trimmedText.match(this.PATTERNS.witnessName);
      if (witnessNameMatch) {
        await this.handleWitnessCalled(trialId, line, trimmedText, state);
        return;
      }
    }
    
    // Check for standalone examination type
    const examMatch = trimmedText.match(this.PATTERNS.examinationStandalone);
    if (examMatch) {
      // If in witness event, add to it
      if (state.currentEvent && state.currentEvent.type === 'WITNESS_CALLED') {
        await this.handleExaminationChange(trialId, line, examMatch, state);
        return;
      }
      // Otherwise, create new examination change event
      if (state.currentWitness) {
        await this.handleExaminationChange(trialId, line, examMatch, state);
        return;
      }
    }
    
    // Check for video deposition line
    if (trimmedText.match(this.PATTERNS.videoDeposition) && 
        state.currentEvent?.type === 'WITNESS_CALLED') {
      await this.handleVideoDeposition(trialId, line, state);
      return;
    }
    
    // Continuation of current event
    if (state.currentEvent) {
      // For witness events, only continue if it's examination or video deposition
      if (state.currentEvent.type === 'WITNESS_CALLED') {
        if (examMatch || trimmedText.match(this.PATTERNS.videoDeposition) || 
            trimmedText.match(/^\s*BY\s+(MR\.|MS\.|MRS\.)/i)) {
          state.eventLines.push(line);
        } else {
          // End witness event and treat this as orphaned
          await this.saveEvent(trialId, state.currentEvent, state.eventLines);
          state.currentEvent = null;
          state.eventLines = [];
          this.stats.orphanedLines++;
        }
      } else {
        // Continue statements and other events normally
        state.eventLines.push(line);
      }
    } else {
      // Orphaned line
      this.stats.orphanedLines++;
      if (this.stats.orphanedLines <= 20) {
        logger.debug(`Orphaned line ${line.lineNumber}: "${this.truncate(trimmedText, 50)}"`);
      }
    }
  }

  private async handleSingleLineDirective(trialId: number, line: any, directiveText: string, state: LineGroupingState): Promise<void> {
    // Save previous event if exists
    if (state.currentEvent && state.eventLines.length > 0) {
      await this.saveEvent(trialId, state.currentEvent, state.eventLines);
      state.currentEvent = null;
      state.eventLines = [];
    }
    
    // Create and save directive event immediately
    const eventInfo: EventInfo = {
      type: 'COURT_DIRECTIVE',
      startTime: line.timestamp || '',
      directiveText: directiveText.trim()
    };
    
    await this.saveEvent(trialId, eventInfo, [line]);
  }
  
  private async handleWitnessCalled(trialId: number, line: any, lineText: string, state: LineGroupingState): Promise<void> {
    // Save previous event
    if (state.currentEvent && state.eventLines.length > 0) {
      await this.saveEvent(trialId, state.currentEvent, state.eventLines);
    }
    
    // Parse witness information
    const nameMatch = lineText.match(this.PATTERNS.witnessName);
    const swornMatch = lineText.match(this.PATTERNS.witnessSworn);
    
    let witnessType: 'PLAINTIFF_WITNESS' | 'DEFENDANT_WITNESS' | 'EXPERT_WITNESS' = 'FACT_WITNESS' as any;
    if (nameMatch) {
      const party = nameMatch[2].toUpperCase();
      if (party.includes('PLAINTIFF')) {
        witnessType = 'PLAINTIFF_WITNESS';
      } else if (party.includes('DEFENDANT')) {
        witnessType = 'DEFENDANT_WITNESS';
      }
    }
    
    // Check if expert (has Ph.D. or similar)
    if (lineText.match(this.PATTERNS.witnessPhD)) {
      witnessType = 'EXPERT_WITNESS';
    }
    
    const witnessName = nameMatch ? nameMatch[1].trim() : lineText.split(',')[0].trim();
    const previouslySworn = swornMatch ? !!swornMatch[1] : false;
    
    // Update witness context
    state.currentWitness = {
      name: witnessName,
      type: witnessType
    };
    state.isInQA = true;
    
    // Store in global context
    this.context.currentWitnessInfo = state.currentWitness;
    
    // Create witness called event
    state.currentEvent = {
      type: 'WITNESS_CALLED',
      startTime: line.timestamp || '',
      witnessName: witnessName,
      previouslySworn: previouslySworn
    };
    state.eventLines = [line];
    
    logger.info(`Witness called: ${witnessName} (${witnessType})`);
  }
  
  private async handleExaminationChange(trialId: number, line: any, match: RegExpMatchArray, state: LineGroupingState): Promise<void> {
    const examType = match[1].toUpperCase();
    const continued = !!match[2];
    
    // This is examination for current witness
    if (!state.currentWitness) {
      logger.warn(`Examination type found but no current witness: ${line.text}`);
      return;
    }
    
    // If part of witness event, add to it
    if (state.currentEvent && state.currentEvent.type === 'WITNESS_CALLED') {
      state.currentEvent.examinationType = `${examType}_EXAMINATION`;
      state.currentEvent.continued = continued;
      state.eventLines.push(line);
    } else {
      // Save previous event
      if (state.currentEvent && state.eventLines.length > 0) {
        await this.saveEvent(trialId, state.currentEvent, state.eventLines);
      }
      
      // Create examination change event
      state.currentEvent = {
        type: 'EXAMINATION_CHANGE',
        startTime: line.timestamp || '',
        witnessName: state.currentWitness.name,
        examinationType: `${examType}_EXAMINATION`,
        continued: continued
      };
      state.eventLines = [line];
      this.stats.examinationChanges++;
    }
    
    // Update context
    state.currentExaminationType = `${examType}_EXAMINATION`;
    state.isInQA = true;
    
    logger.debug(`Examination: ${examType} for ${state.currentWitness.name}`);
  }
  
  private async handleVideoDeposition(trialId: number, line: any, state: LineGroupingState): Promise<void> {
    if (state.currentEvent && state.currentEvent.type === 'WITNESS_CALLED') {
      // Part of witness called event
      state.currentEvent.presentedByVideo = true;
      state.currentEvent.examinationType = 'VIDEO_DEPOSITION';
      state.eventLines.push(line);
    }
  }
  
  private async handleSpeakerStatement(trialId: number, line: any, speaker: string, state: LineGroupingState): Promise<void> {
    // Clean up the speaker name
    speaker = speaker.trim();
    
    logger.info(`=== HANDLE SPEAKER STATEMENT ===`);
    logger.info(`  Line: ${line.lineNumber}`);
    logger.info(`  Speaker: "${speaker}"`);
    logger.info(`  Current Event Type: ${state.currentEvent?.type || 'none'}`);
    logger.info(`  Current Speaker: ${state.currentSpeaker || 'none'}`);
    
    // Handle special Q. and A. speakers
    if (speaker === 'Q.' || speaker === 'A.') {
      state.isInQA = true;
      await this.handleQAStatement(trialId, line, speaker, state);
      return;
    }
    
    // Handle "BY MR/MS" prefix for Q&A context
    if (speaker.match(/^BY\s+(MR\.|MS\.|MRS\.)/i)) {
      const attorneyName = speaker.replace(/^BY\s+/i, '');
      state.lastQAttorney = attorneyName;
      state.isInQA = true;
      speaker = attorneyName;
    }
    
    // Save previous event if speaker changed
    if (state.currentEvent && state.currentEvent.type === 'STATEMENT' && state.currentSpeaker !== speaker) {
      logger.info(`  Speaker changed from "${state.currentSpeaker}" to "${speaker}", saving previous statement`);
      await this.saveEvent(trialId, state.currentEvent, state.eventLines);
      state.currentEvent = null;
      state.eventLines = [];
    } else if (state.currentEvent && state.currentEvent.type !== 'STATEMENT') {
      logger.info(`  Switching from ${state.currentEvent.type} to STATEMENT`);
      await this.saveEvent(trialId, state.currentEvent, state.eventLines);
      state.currentEvent = null;
      state.eventLines = [];
    }
    
    state.currentSpeaker = speaker;
    
    // Start new statement event or continue existing one
    if (!state.currentEvent || state.currentEvent.type !== 'STATEMENT') {
      logger.info(`  Starting NEW statement from speaker: ${speaker}`);
      state.currentEvent = {
        type: 'STATEMENT',
        startTime: line.timestamp || '',
        speaker: speaker
      };
      state.eventLines = [line];
    } else {
      logger.info(`  Continuing statement for speaker: ${speaker}`);
      state.eventLines.push(line);
    }
    
    logger.info(`=== END HANDLE SPEAKER STATEMENT ===`);
  }
  
  private async handleQAStatement(trialId: number, line: any, qaType: string, state: LineGroupingState): Promise<void> {
    const isQuestion = qaType === 'Q.';
    let speaker: string;
    
    if (isQuestion) {
      speaker = state.lastQAttorney || 'ATTORNEY';
    } else {
      speaker = state.currentWitness?.name || 'WITNESS';
    }
    
    // Save previous event if Q/A type changed
    if (state.currentEvent && state.currentEvent.type === 'STATEMENT' && state.currentEvent.speaker !== speaker) {
      await this.saveEvent(trialId, state.currentEvent, state.eventLines);
      state.currentEvent = null;
      state.eventLines = [];
    }
    
    // Start or continue Q/A event
    if (!state.currentEvent || state.currentEvent.type !== 'STATEMENT') {
      state.currentEvent = {
        type: 'STATEMENT',
        startTime: line.timestamp || '',
        speaker: speaker
      };
      state.eventLines = [line];
    } else {
      state.eventLines.push(line);
    }
  }
  
  private extractSpeaker(text: string): string | null {
    // Check for any speaker pattern (caps followed by colon)
    const speakerMatch = text.match(this.PATTERNS.speakerPrefix);
    if (speakerMatch) {
      const speaker = speakerMatch[1].trim();
      
      // Filter out things that look like speakers but aren't
      if (speaker.includes('EXAMINATION') || 
          speaker.match(/^(DIRECT|CROSS|REDIRECT|RECROSS)$/) ||
          speaker === 'SWORN' ||
          speaker === 'PREVIOUSLY SWORN' ||
          speaker === 'WITNESS' || // Just "WITNESS" alone
          speaker === 'PRESENTED' ||
          speaker === 'CONTINUED') {
        return null;
      }
      
      // Valid speakers include:
      // THE COURT, COURT SECURITY OFFICER, MR./MS./MRS. names, 
      // THE WITNESS, JUROR names, etc.
      logger.debug(`Found speaker: "${speaker}"`);
      return speaker;
    }
    
    // Check for Q. or A. patterns specifically
    const qaMatch = text.match(this.PATTERNS.qaPrefix);
    if (qaMatch) {
      return qaMatch[1]; // Return "Q." or "A."
    }
    
    // Check for BY MR/MS pattern (used after Q. to clarify attorney)
    const byMatch = text.match(/^\s*BY\s+(MR\.|MS\.|MRS\.)\s+([A-Z]+):/i);
    if (byMatch) {
      return `${byMatch[1]} ${byMatch[2]}`;
    }
    
    return null;
  }
  
  private isDirectiveContinuation(text: string): boolean {
    // Check if line could be directive continuation
    // Must not have any non-whitespace outside of content that will be in parens
    // No speaker prefix, no line numbers at start
    return !this.extractSpeaker(text) && 
           !text.match(/^\d+\s+/) &&
           !text.match(/^\s*\(/) &&
           text.trim().length > 0 &&
           !text.match(/^[A-Z].*:/) && // No speaker pattern
           !text.match(this.PATTERNS.examinationStandalone); // Not examination type
  }
  
  private calculateDuration(startTime: string | null, endTime: string | null): number | null {
    if (!startTime || !endTime) return null;
    
    // Parse timestamps in format HH:MM:SS
    const parseTime = (time: string): number => {
      const parts = time.split(':').map(p => parseInt(p, 10));
      if (parts.length !== 3) return 0;
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    };
    
    try {
      const startSeconds = parseTime(startTime);
      const endSeconds = parseTime(endTime);
      const duration = endSeconds - startSeconds;
      
      // Return null for negative or unreasonable durations
      if (duration < 0 || duration > 3600) { // More than 1 hour is probably an error
        return null;
      }
      
      return duration;
    } catch (error) {
      logger.debug(`Could not calculate duration for ${startTime} to ${endTime}`);
      return null;
    }
  }
  
  private async saveEvent(trialId: number, eventInfo: EventInfo, lines: any[]): Promise<void> {
    if (!eventInfo || !lines || lines.length === 0) {
      logger.warn('saveEvent called with invalid data');
      return;
    }
    
    logger.info(`=== SAVING EVENT ===`);
    logger.info(`  Type: ${eventInfo.type}`);
    logger.info(`  Lines: ${lines.length}`);
    if (eventInfo.type === 'STATEMENT') {
      logger.info(`  Speaker: ${eventInfo.speaker}`);
    }
    
    try {
      const startLine = lines[0];
      const endLine = lines[lines.length - 1];
      
      const fullText = lines
        .map(l => l.text || '')
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      
      logger.info(`  Text preview: "${this.truncate(fullText, 100)}"`);
      
      // Calculate duration
      const duration = this.calculateDuration(startLine.timestamp, endLine.timestamp);
      
      const event = await this.prisma.trialEvent.create({
        data: {
          trialId,
          sessionId: this.context.currentSession?.id,
          startTime: eventInfo.startTime,
          endTime: endLine.timestamp || eventInfo.startTime,
          duration: duration,
          startLineNumber: startLine.lineNumber,
          endLineNumber: endLine.lineNumber,
          lineCount: lines.length,
          eventType: eventInfo.type === 'EXAMINATION_CHANGE' ? 'WITNESS_CALLED' : eventInfo.type,
          text: fullText
        }
      });
      
      logger.info(`  Created TrialEvent with ID: ${event.id}`);
      
      // Create specific event type records
      switch (eventInfo.type) {
        case 'COURT_DIRECTIVE':
          await this.createCourtDirectiveEvent(event.id, eventInfo.directiveText || fullText);
          this.stats.directiveEvents++;
          break;
          
        case 'STATEMENT':
          logger.info(`  Creating StatementEvent for speaker: ${eventInfo.speaker}`);
          await this.createStatementEvent(event.id, eventInfo.speaker || 'UNKNOWN', fullText);
          this.stats.statementEvents++;
          logger.info(`  StatementEvent created successfully`);
          break;
          
        case 'WITNESS_CALLED':
          await this.createWitnessCalledEvent(event.id, eventInfo);
          this.stats.witnessEvents++;
          break;
          
        case 'EXAMINATION_CHANGE':
          await this.createExaminationChangeEvent(event.id, eventInfo);
          this.stats.witnessEvents++;
          break;
      }
      
      this.stats.totalEvents++;
      
      if (this.stats.totalEvents % 100 === 0) {
        logger.info(`Processed ${this.stats.totalEvents} events...`);
      }
      
    } catch (error) {
      logger.error(`Error saving event: ${(error as Error).message}`);
      logger.error(`Event type: ${eventInfo.type}`);
      if (eventInfo.type === 'STATEMENT') {
        logger.error(`Speaker: ${eventInfo.speaker}`);
      }
      this.stats.errors++;
      throw error; // Re-throw to see the full error
    }
    
    logger.info(`=== EVENT SAVED ===`);
  }
  
  private async createCourtDirectiveEvent(eventId: number, directiveText: string): Promise<void> {
    // Normalize directive text
    const normalized = directiveText.trim();
    
    // Find or create directive type
    let directiveType = await this.prisma.courtDirectiveType.findFirst({
      where: {
        OR: [
          { name: normalized },
          { aliases: { has: normalized } }
        ]
      }
    });
    
    if (!directiveType) {
      // Track unknown directive
      if (!this.stats.unknownDirectives.includes(normalized)) {
        this.stats.unknownDirectives.push(normalized);
        logger.info(`New directive found: "${normalized}"`);
      }
      
      // Create new directive type
      directiveType = await this.prisma.courtDirectiveType.create({
        data: {
          name: normalized,
          description: `Auto-detected directive: ${normalized}`,
          isPaired: this.isPairedDirective(normalized),
          isStart: this.isStartDirective(normalized),
          aliases: []
        }
      });
    }
    
    await this.prisma.courtDirectiveEvent.create({
      data: {
        eventId,
        directiveTypeId: directiveType.id,
        isStandard: false // Mark as non-standard since it was auto-detected
      }
    });
  }
  
  private async createStatementEvent(eventId: number, speaker: string, text: string): Promise<void> {
    const speakerType = this.determineSpeakerType(speaker);
    
    const statementEvent = await this.prisma.statementEvent.create({
      data: {
        eventId,
        speakerType,
        speakerName: speaker
      }
    });
    
    // Create specific statement subtype
    switch (speakerType) {
      case 'COURT':
        await this.prisma.courtStatementEvent.create({
          data: {
            statementId: statementEvent.id,
            statementType: this.determineCourtStatementType(text)
          }
        });
        break;
        
      case 'ATTORNEY':
        const attorneyId = this.context.attorneys.get(speaker.toUpperCase());
        await this.prisma.attorneyStatementEvent.create({
          data: {
            statementId: statementEvent.id,
            attorneyId,
            statementType: this.determineAttorneyStatementType(text)
          }
        });
        break;
        
      case 'WITNESS':
        const witnessId = this.context.witnesses.get(speaker.toUpperCase()) || 
                         this.context.currentWitnessInfo?.id;
        await this.prisma.witnessStatementEvent.create({
          data: {
            statementId: statementEvent.id,
            witnessId,
            examinationType: this.context.currentExaminationType as any
          }
        });
        break;
    }
  }
  
  private async createWitnessCalledEvent(eventId: number, eventInfo: EventInfo): Promise<void> {
    const trialId = await this.getTrialId();
    
    // Determine witness type
    let witnessType: 'PLAINTIFF_WITNESS' | 'DEFENDANT_WITNESS' | 'EXPERT_WITNESS' = 
      this.context.currentWitnessInfo?.type || 'FACT_WITNESS' as any;
    
    // Find or create witness
    let witness = await this.prisma.witness.findFirst({
      where: {
        name: eventInfo.witnessName,
        trialId: trialId
      }
    });
    
    if (!witness) {
      witness = await this.prisma.witness.create({
        data: {
          name: eventInfo.witnessName || 'UNKNOWN',
          trialId: trialId,
          witnessType: witnessType
        }
      });
      
      // Update context
      if (this.context.currentWitnessInfo) {
        this.context.currentWitnessInfo.id = witness.id;
      }
    }
    
    // Map examination type string to enum
    let examType: any = 'DIRECT_EXAMINATION';
    if (eventInfo.examinationType) {
      if (eventInfo.examinationType === 'VIDEO_DEPOSITION') {
        examType = 'VIDEO_DEPOSITION';
      } else if (eventInfo.examinationType.includes('CROSS')) {
        examType = 'CROSS_EXAMINATION';
      } else if (eventInfo.examinationType.includes('REDIRECT')) {
        examType = 'REDIRECT_EXAMINATION';
      } else if (eventInfo.examinationType.includes('RECROSS')) {
        examType = 'RECROSS_EXAMINATION';
      }
    }
    
    await this.prisma.witnessCalledEvent.create({
      data: {
        eventId,
        witnessId: witness.id,
        examinationType: examType,
        previouslySworn: eventInfo.previouslySworn || false,
        presentedByVideo: eventInfo.presentedByVideo || false
      }
    });
  }
  
  private async createExaminationChangeEvent(eventId: number, eventInfo: EventInfo): Promise<void> {
    // This is similar to witness called but for examination changes
    await this.createWitnessCalledEvent(eventId, eventInfo);
  }
  
  private async getTrialId(): Promise<number> {
    if (this.context.currentTrialId) {
      return this.context.currentTrialId;
    }
    
    if (this.context.currentSession?.id) {
      const session = await this.prisma.session.findUnique({
        where: { id: this.context.currentSession.id },
        select: { trialId: true }
      });
      if (session) {
        this.context.currentTrialId = session.trialId;
        return session.trialId;
      }
    }
    
    const trial = await this.prisma.trial.findFirst();
    if (trial) {
      this.context.currentTrialId = trial.id;
      return trial.id;
    }
    
    throw new Error('No trial found in database');
  }
  
  private isPairedDirective(text: string): boolean {
    const pairedPatterns = [
      /jury\s+(in|out)/i,
      /courtroom\s+(sealed|unsealed)/i,
      /videoclip\s+(played|plays|starts|ends|stops)/i,
      /witness\s+(sworn|excused)/i,
      /bench\s+conference\s+(begins|ends)/i
    ];
    
    return pairedPatterns.some(p => p.test(text));
  }
  
  private isStartDirective(text: string): boolean {
    const startPatterns = [
      /jury\s+out/i,
      /courtroom\s+sealed/i,
      /videoclip\s+(played|plays|starts)/i,
      /witness\s+sworn/i,
      /bench\s+conference\s+begins/i
    ];
    
    return startPatterns.some(p => p.test(text));
  }
  
  private determineSpeakerType(speaker: string): 'ATTORNEY' | 'COURT' | 'WITNESS' | 'COURT_REPORTER' | 'BAILIFF' | 'OTHER' {
    const upperSpeaker = speaker.toUpperCase();
    
    if (upperSpeaker.includes('THE COURT')) {
      return 'COURT';
    }
    if (upperSpeaker === 'THE WITNESS' || upperSpeaker === 'WITNESS' || 
        this.context.currentWitnessInfo?.name === speaker) {
      return 'WITNESS';
    }
    if (upperSpeaker.includes('REPORTER')) {
      return 'COURT_REPORTER';
    }
    if (upperSpeaker.includes('BAILIFF') || upperSpeaker.includes('SECURITY')) {
      return 'BAILIFF';
    }
    if (upperSpeaker.match(/^(MR\.|MS\.|MRS\.)/) || 
        this.context.attorneys.has(upperSpeaker)) {
      return 'ATTORNEY';
    }
    
    return 'OTHER';
  }
  
  private determineCourtStatementType(text: string): 'INSTRUCTION' | 'RULING' | 'QUESTION' | 'CLARIFICATION' | 'ADMONISHMENT' | 'SCHEDULING' | 'OTHER' {
    const lowerText = text.toLowerCase();
    
    if (lowerText.includes('sustain') || lowerText.includes('overrul')) return 'RULING';
    if (lowerText.includes('instruct') || lowerText.includes('jury')) return 'INSTRUCTION';
    if (lowerText.includes('?')) return 'QUESTION';
    if (lowerText.includes('clarif') || lowerText.includes('explain')) return 'CLARIFICATION';
    if (lowerText.includes('admonish') || lowerText.includes('warn')) return 'ADMONISHMENT';
    if (lowerText.includes('recess') || lowerText.includes('resume') || lowerText.includes('tomorrow')) return 'SCHEDULING';
    
    return 'OTHER';
  }
  
  private determineAttorneyStatementType(text: string): 'DIRECT_EXAMINATION' | 'CROSS_EXAMINATION' | 'REDIRECT_EXAMINATION' | 'RECROSS_EXAMINATION' | 'OPENING_STATEMENT' | 'CLOSING_ARGUMENT' | 'OBJECTION' | 'OTHER' {
    const lowerText = text.toLowerCase();
    
    if (lowerText.includes('object')) return 'OBJECTION';
    if (this.context.currentExaminationType) {
      if (this.context.currentExaminationType.includes('DIRECT')) return 'DIRECT_EXAMINATION';
      if (this.context.currentExaminationType.includes('CROSS')) return 'CROSS_EXAMINATION';
      if (this.context.currentExaminationType.includes('REDIRECT')) return 'REDIRECT_EXAMINATION';
      if (this.context.currentExaminationType.includes('RECROSS')) return 'RECROSS_EXAMINATION';
    }
    
    return 'OTHER';
  }
  
  private truncate(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
  }
  
  private printStatistics(): void {
    logger.info('\n=== PHASE 2 STATISTICS ===');
    logger.info(`Total Events Created: ${this.stats.totalEvents}`);
    logger.info(`  - Court Directives: ${this.stats.directiveEvents}`);
    logger.info(`  - Statements: ${this.stats.statementEvents}`);
    logger.info(`  - Witness Events: ${this.stats.witnessEvents}`);
    logger.info(`  - Examination Changes: ${this.stats.examinationChanges}`);
    logger.info(`Multi-line Directives: ${this.stats.multiLineDirectives}`);
    logger.info(`Orphaned Lines: ${this.stats.orphanedLines}`);
    logger.info(`Errors: ${this.stats.errors}`);
    
    if (this.stats.unknownDirectives.length > 0) {
      logger.info('\n📝 New Directives Found (add to seed data):');
      this.stats.unknownDirectives.forEach(d => {
        logger.info(`  - "${d}"`);
      });
    }
    
    logger.info('========================\n');
  }
}