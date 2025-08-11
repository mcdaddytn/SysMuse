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
  lastQSpeaker: SpeakerInfo | null;
  contextualSpeakers: Map<string, SpeakerInfo>;
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
    
    // Enhanced witness name patterns to handle quotes and nicknames
    witnessName: /^([A-Z][A-Z\s,'"\.\-]+?),?\s+(PLAINTIFF'S?|DEFENDANT'S?)\s+WITNESS/i,
    witnessNameAlternate: /^([A-Z\s,'"\.\-]+?)\s*,\s*(PLAINTIFF'S?|DEFENDANT'S?)\s+WITNESS/i,
    witnessWithNickname: /^([A-Z]+)\s+["']([A-Z]+)["']\s+([A-Z]+)/i,
    
    // Examination patterns
    examinationType: /(DIRECT|CROSS|REDIRECT|RECROSS)[\s\-]?EXAMINATION/i,
    examinationContinued: /EXAMINATION\s+CONTINUED/i,
    
    // Sworn status patterns
    swornStatus: /(PREVIOUSLY\s+)?SWORN/i,
    videoDeposition: /PRESENTED\s+BY\s+VIDEO|VIDEO\s+DEPOSITION/i
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
      witnesses: new Map(),  // Will store WitnessInfo objects
      jurors: new Map(),
      judge: null,  // Initialize as null
      currentSession: null,  // Initialize as null
      currentExaminationType: null,
      currentWitness: null  // Allow null
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
   * Main processing method
   */
  // async process(trialId: number): Promise<void> {
  async processTrial(trialId: number): Promise<void> {
    logger.info('============================================================');
    logger.info('STARTING PHASE 2 PROCESSING');
    logger.info(`Trial ID: ${trialId}`);
    logger.info('============================================================');
    
    try {
      this.context.trialId = trialId;
      
      // Load existing entities
      await this.loadExistingEntities(trialId);
      
      // Get all sessions for this trial
      const sessions = await this.prisma.session.findMany({
        where: { trialId },
        orderBy: [
          { sessionDate: 'asc' },
          { sessionType: 'asc' }
        ]
      });
      
      logger.info(`Found ${sessions.length} sessions to process`);
      
      // Process each session
      for (const session of sessions) {
        this.context.currentSession = session;
        await this.processSession(session);
      }
      
      // Log statistics
      this.logStatistics();
      
    } catch (error) {
      logger.error(`Phase 2 processing failed: ${error}`);
      throw error;
    } finally {
      await this.prisma.$disconnect();
    }
  }

  /**
   * Load existing entities into context
   */
  private async loadExistingEntities(trialId: number): Promise<void> {
    // Load attorneys
    const attorneys = await this.attorneyService.getAttorneysForTrial(trialId);
    for (const attorney of attorneys) {
      this.context.attorneys.set(attorney.speakerPrefix || '', attorney.id);
      
      if (attorney.speaker) {
        const speakerInfo: SpeakerInfo = {
          id: attorney.speaker.id,
          speakerPrefix: attorney.speaker.speakerPrefix,
          speakerHandle: attorney.speaker.speakerHandle,
          speakerType: SpeakerType.ATTORNEY,
          attorneyId: attorney.id,
          name: attorney.name
        };
        this.context.speakers.set(attorney.speaker.speakerPrefix, speakerInfo);
      }
    }
    logger.info(`Loaded ${attorneys.length} attorneys`);
    
    // Load judge
    const judge = await this.prisma.judge.findFirst({
      where: { trialId },
      include: { speaker: true }
    });
    
    if (judge) {
      this.context.judge = judge;  // Store judge in context
      
      if (judge.speaker) {
        const speakerInfo: SpeakerInfo = {
          id: judge.speaker.id,
          speakerPrefix: judge.speaker.speakerPrefix,
          speakerHandle: judge.speaker.speakerHandle,
          speakerType: SpeakerType.JUDGE,
          name: judge.name
        };
        this.context.speakers.set('THE COURT', speakerInfo);
        this.context.speakers.set('COURT', speakerInfo);
      }
      logger.info(`Loaded judge: ${judge.name}`);
    }
    
    // Load existing witnesses - FIXED to store WitnessInfo objects
    const witnesses = await this.prisma.witness.findMany({
      where: { trialId },
      include: { speaker: true }
    });
    
    for (const witness of witnesses) {
      const witnessInfo: WitnessInfo = {
        id: witness.id,
        name: witness.name || undefined,
        displayName: witness.displayName || undefined,
        witnessType: witness.witnessType || undefined,
        witnessCaller: witness.witnessCaller || undefined,
        speakerId: witness.speakerId || undefined,
        swornStatus: witness.swornStatus || 'NOT_SWORN'
      };
      
      if (witness.name) {
        this.context.witnesses.set(witness.name, witnessInfo);  // Store WitnessInfo object
      }
    }
    
    // Set initial witness context if exists
    if (witnesses.length > 0) {
      const firstWitness = witnesses[0];
      this.witnessJurorService.setCurrentWitness({
        id: firstWitness.id,
        name: firstWitness.name || undefined,
        displayName: firstWitness.displayName || undefined,
        witnessType: firstWitness.witnessType || undefined,
        witnessCaller: firstWitness.witnessCaller || undefined,
        speakerId: firstWitness.speakerId || undefined,
        swornStatus: firstWitness.swornStatus || 'NOT_SWORN'
      });
      logger.debug(`Set initial witness context to: ${firstWitness.name}`);
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
        speakerId: juror.speaker?.id,  // Add speakerId
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
    
    // Set current session in context
    this.context.currentSession = session;
    
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
    
    // Initialize state with current witness context
    const state: ProcessingState = {
      currentEvent: null,
      eventLines: [],
      currentSpeaker: null,
      currentWitness: this.witnessJurorService.getCurrentWitness(),
      currentExaminationType: null,
      lastQSpeaker: null,
      contextualSpeakers: new Map()
    };
    
    // Log initial witness context
    if (state.currentWitness) {
      logger.debug(`Starting session with witness context: ${state.currentWitness.name}`);
    }
    
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
      
      // Append text
      if (lineText) {
        state.currentEvent.text = (state.currentEvent.text || '') + '\n' + lineText;
      }
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
    const directiveMatch = lineText.match(this.PATTERNS.courtDirective);
    if (!directiveMatch) return false;
    
    // Save current event if different type
    if (state.currentEvent && state.currentEvent.type !== EventType.COURT_DIRECTIVE) {
      await this.saveEvent(this.context.trialId, sessionId, state.currentEvent, state.eventLines);
      state.currentEvent = null;
      state.eventLines = [];
    }
    
    // Create court directive event
    state.currentEvent = {
      type: EventType.COURT_DIRECTIVE,
      startTime: line.timestamp,
      startLineNumber: line.lineNumber,
      endLineNumber: line.lineNumber,
      metadata: {
        directiveText: directiveMatch[1]
      },
      rawText: lineText
    };
    state.eventLines = [line];
    
    // Save immediately (directives are usually single line)
    await this.saveEvent(this.context.trialId, sessionId, state.currentEvent, state.eventLines);
    state.currentEvent = null;
    state.eventLines = [];
    
    return true;
  }

  /**
   * Check for witness being called - FIXED VERSION
   */
  private async checkWitnessCalled(
    sessionId: number,
    line: any,
    lineText: string,
    state: ProcessingState
  ): Promise<boolean> {
    // Check multiple patterns for witness
    let nameMatch = lineText.match(this.PATTERNS.witnessName);
    if (!nameMatch) {
      nameMatch = lineText.match(this.PATTERNS.witnessNameAlternate);
    }
    
    // Special handling for nicknames like QI "PETER" LI
    if (!nameMatch) {
      const nicknameMatch = lineText.match(this.PATTERNS.witnessWithNickname);
      if (nicknameMatch) {
        const fullName = `${nicknameMatch[1]} "${nicknameMatch[2]}" ${nicknameMatch[3]}`;
        const witnessLineMatch = lineText.match(/(PLAINTIFF'S?|DEFENDANT'S?)\s+WITNESS/i);
        if (witnessLineMatch) {
          nameMatch = [lineText, fullName, witnessLineMatch[1]];
        }
      }
    }
    
    if (!nameMatch) return false;
    
    // Save current event if exists
    if (state.currentEvent) {
      await this.saveEvent(this.context.trialId, sessionId, state.currentEvent, state.eventLines);
      state.currentEvent = null;
      state.eventLines = [];
    }
    
    // Extract and normalize witness name
    let witnessName = nameMatch[1].trim();
    const displayName = witnessName; // Keep original for display
    witnessName = witnessName.replace(/['"]/g, ''); // Remove quotes for storage
    
    const witnessCaller = nameMatch[2].toUpperCase().includes('PLAINTIFF') ? 'PLAINTIFF' : 'DEFENDANT';
    
    logger.info(`Witness called detected: ${displayName} (${witnessCaller})`);
    
    // Create unique speaker handle for this witness
    const speakerHandle = `WITNESS_${witnessName.replace(/[^A-Z0-9]/gi, '_').toUpperCase()}`;
    
    // Find or create speaker
    let speaker = await this.prisma.speaker.findFirst({
      where: {
        trialId: this.context.trialId,
        speakerHandle: speakerHandle
      }
    });
    
    if (!speaker) {
      speaker = await this.prisma.speaker.create({
        data: {
          trialId: this.context.trialId,
          speakerPrefix: 'A.',  // Display prefix for witnesses
          speakerHandle: speakerHandle,  // Unique handle
          speakerType: 'WITNESS'
        }
      });
    }
    
    // Find or create witness
    let witness = await this.prisma.witness.findFirst({
      where: {
        trialId: this.context.trialId,
        name: witnessName
      },
      include: {
        speaker: true
      }
    });
    
    if (!witness) {
      witness = await this.prisma.witness.create({
        data: {
          trialId: this.context.trialId,
          name: witnessName,
          displayName: displayName,
          witnessCaller: witnessCaller,
          speakerId: speaker.id,
          swornStatus: 'NOT_SWORN'
        },
        include: {
          speaker: true
        }
      });
      
      logger.info(`Created witness: ${displayName} with handle: ${speakerHandle}`);
    }
    
    // Detect sworn status from the text
    let witnessSwornStatus: any = SwornStatus.NOT_SWORN;
    if (lineText.match(/\bPREVIOUSLY\s+SWORN\b/i)) {
      witnessSwornStatus = SwornStatus.PREVIOUSLY_SWORN;
    } else if (lineText.match(/\bSWORN\b/i)) {
      witnessSwornStatus = SwornStatus.SWORN;
    }
    
    // Update state with current witness IMMEDIATELY
    state.currentWitness = {
      id: witness.id,
      name: witness.name || undefined,
      displayName: witness.displayName || undefined,
      witnessType: witness.witnessType || undefined,
      witnessCaller: witness.witnessCaller || undefined,
      speakerId: witness.speaker?.id,
      swornStatus: witnessSwornStatus
    };
    
    // Create speaker info for contextual mapping
    const witnessSpeakerInfo: SpeakerInfo = {
      id: speaker.id,
      speakerPrefix: speaker.speakerPrefix,
      speakerHandle: speaker.speakerHandle,
      speakerType: SpeakerType.WITNESS,
      witnessId: witness.id,
      name: displayName
    };
    
    // Update contextual speakers for A. and THE WITNESS
    state.contextualSpeakers.set('A.', witnessSpeakerInfo);
    state.contextualSpeakers.set('THE WITNESS', witnessSpeakerInfo);
    state.contextualSpeakers.set('WITNESS', witnessSpeakerInfo);
    
    // Update service context
    this.witnessJurorService.setCurrentWitness(state.currentWitness);
    
    logger.info(`Set current witness context: ${displayName}, A. will now resolve to this witness`);
    
    // Start witness called event (use swornStatus from currentWitness)
    state.currentEvent = {
      type: EventType.WITNESS_CALLED,
      startTime: line.timestamp,
      startLineNumber: line.lineNumber,
      endLineNumber: line.lineNumber,
      metadata: {
        witnessId: witness.id,
        witnessName: witnessName,
        displayName: displayName,
        witnessCaller: witnessCaller,
        swornStatus: witnessSwornStatus
      }
    };
    state.eventLines = [line];
    
    return true;
  }

  /**
   * Check for examination type change - FIXED VERSION
   */
  private async checkExaminationChange(
    sessionId: number,
    line: any,
    lineText: string,
    state: ProcessingState
  ): Promise<boolean> {
    const examMatch = lineText.match(this.PATTERNS.examinationType);
    const videoMatch = lineText.match(this.PATTERNS.videoDeposition);
    
    if (!examMatch && !videoMatch) return false;
    
    // Check if we're changing examination for current witness
    if (state.currentWitness) {
      const examType = examMatch ? examMatch[1].toUpperCase() : 'VIDEO';
      const continued = lineText.includes('CONTINUED');
      
      // Check for sworn status in this line
      let swornStatus = state.currentWitness.swornStatus || SwornStatus.NOT_SWORN;
      if (lineText.match(/\bPREVIOUSLY\s+SWORN\b/i)) {
        swornStatus = SwornStatus.PREVIOUSLY_SWORN;
      } else if (lineText.match(/\bSWORN\b/i) && !lineText.match(/\bPREVIOUSLY/i)) {
        swornStatus = SwornStatus.SWORN;
      }
      
      // Update witness sworn status in database if changed
      if (swornStatus !== state.currentWitness.swornStatus && state.currentWitness.id) {
        await this.prisma.witness.update({
          where: { id: state.currentWitness.id },
          data: { swornStatus }
        });
        
        state.currentWitness.swornStatus = swornStatus;
        logger.info(`Updated witness sworn status to: ${swornStatus}`);
      }
    }
    
    // If we're in a witness event, add to it
    if (state.currentEvent?.type === EventType.WITNESS_CALLED) {
      state.eventLines.push(line);
      state.currentEvent.endLineNumber = line.lineNumber;
      
      // Extract examination type
      const examType = examMatch ? examMatch[1].toUpperCase() : 'VIDEO';
      const continued = !lineText.match(this.PATTERNS.examinationContinued);
      
      // Map to enum value - USE THE CONST VALUES
      let examinationType: ExaminationType;
      switch (examType) {
        case 'DIRECT':
          examinationType = ExaminationType.DIRECT_EXAMINATION;
          break;
        case 'CROSS':
          examinationType = ExaminationType.CROSS_EXAMINATION;
          break;
        case 'REDIRECT':
          examinationType = ExaminationType.REDIRECT_EXAMINATION;
          break;
        case 'RECROSS':
          examinationType = ExaminationType.RECROSS_EXAMINATION;
          break;
        case 'VIDEO':
          examinationType = ExaminationType.VIDEO_DEPOSITION;
          break;
        default:
          examinationType = ExaminationType.DIRECT_EXAMINATION;
      }
      
      // Update metadata
      state.currentEvent.metadata = {
        ...state.currentEvent.metadata,
        examinationType,
        continued
      };
      
      // Update current examination type
      state.currentExaminationType = examinationType;
      
      return true;
    }
    
    // Check if this is a standalone examination change (witness already on stand)
    if (state.currentWitness && !state.currentEvent) {
      const examType = examMatch ? examMatch[1].toUpperCase() : 'VIDEO';
      
      // Map to enum - USE THE CONST VALUES
      let examinationType: ExaminationType;
      switch (examType) {
        case 'DIRECT':
          examinationType = ExaminationType.DIRECT_EXAMINATION;
          break;
        case 'CROSS':
          examinationType = ExaminationType.CROSS_EXAMINATION;
          break;
        case 'REDIRECT':
          examinationType = ExaminationType.REDIRECT_EXAMINATION;
          break;
        case 'RECROSS':
          examinationType = ExaminationType.RECROSS_EXAMINATION;
          break;
        case 'VIDEO':
          examinationType = ExaminationType.VIDEO_DEPOSITION;
          break;
        default:
          examinationType = ExaminationType.DIRECT_EXAMINATION;
      }
      
      state.currentExaminationType = examinationType;
      
      // Create witness called event for examination change
      state.currentEvent = {
        type: EventType.WITNESS_CALLED,
        startTime: line.timestamp,
        startLineNumber: line.lineNumber,
        endLineNumber: line.lineNumber,
        metadata: {
          witnessId: state.currentWitness.id,
          witnessName: state.currentWitness.name,
          displayName: state.currentWitness.displayName,
          examinationType,
          swornStatus: state.currentWitness.swornStatus || SwornStatus.PREVIOUSLY_SWORN,
          continued: lineText.includes('CONTINUED'),
          witnessCaller: state.currentWitness.witnessCaller
        }
      };
      state.eventLines = [line];
      
      return true;
    }
    
    return false;
  }

  /**
   * Check for speaker statement - FIXED VERSION
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
   * Find or create speaker based on prefix - FIXED VERSION
   */
  private async findOrCreateSpeaker(
    speakerPrefix: string,
    lineText: string,
    state: ProcessingState
  ): Promise<SpeakerInfo | null> {
    const upperPrefix = speakerPrefix.toUpperCase();
    
    // Check contextual speakers first (most common case)
    const contextual = state.contextualSpeakers.get(upperPrefix);
    if (contextual) {
      logger.debug(`Found ${upperPrefix} in contextual speakers: ${contextual.name}`);
      return contextual;
    }
    
    // Handle Q. - should be the examining attorney
    if (upperPrefix === 'Q.' || upperPrefix === 'ATTORNEY') {
      if (state.lastQSpeaker) {
        logger.debug(`${upperPrefix} resolved to: ${state.lastQSpeaker.name || state.lastQSpeaker.speakerPrefix}`);
        return state.lastQSpeaker;
      }
      logger.warn(`${upperPrefix} found but no examining attorney in context, line: ${lineText.substring(0, 50)}`);
      return null;
    }
    
    // Handle A., THE WITNESS - should be current witness
    if (upperPrefix === 'A.' || upperPrefix === 'THE WITNESS' || upperPrefix === 'WITNESS') {
      if (state.currentWitness?.speakerId) {
        const speaker = await this.prisma.speaker.findUnique({
          where: { id: state.currentWitness.speakerId }
        });
        if (speaker) {
          const speakerInfo: SpeakerInfo = {
            id: speaker.id,
            speakerPrefix: speaker.speakerPrefix,
            speakerHandle: speaker.speakerHandle,
            speakerType: SpeakerType.WITNESS,
            witnessId: state.currentWitness.id,
            name: state.currentWitness.displayName || state.currentWitness.name
          };
          logger.debug(`${upperPrefix} resolved to witness: ${speakerInfo.name}`);
          return speakerInfo;
        }
      }
      logger.warn(`${upperPrefix} found but no current witness in context, lineText: ${lineText.substring(0, 50)}`);
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
          speakerHandle: attorney.speaker.speakerHandle,
          speakerType: SpeakerType.ATTORNEY,
          attorneyId: attorney.id,
          name: attorney.name
        };
        // Update the Q. context - this attorney is now asking questions
        state.lastQSpeaker = speaker;
        state.contextualSpeakers.set('Q.', speaker);
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
          speakerHandle: attorney.speaker.speakerHandle,
          speakerType: SpeakerType.ATTORNEY,
          attorneyId: attorney.id,
          name: attorney.name
        };
        
        // If this attorney is speaking in a witness context, they might be the Q. speaker
        if (state.currentWitness) {
          state.lastQSpeaker = speaker;
          state.contextualSpeakers.set('Q.', speaker);
          logger.debug(`Set Q. context to: ${attorney.name} (during witness examination)`);
        }
        
        return speaker;
      }
      
      // Not found as attorney - try juror alias match
      logger.debug(`Could not find attorney with prefix: ${upperPrefix}, trying juror match`);
      
      const jurorAlias = await this.witnessJurorService.matchJurorByAlias(
        this.context.trialId,
        upperPrefix
      );
      
      if (jurorAlias) {
        this.stats.jurorStatements++;
        logger.info(`Matched speaker ${upperPrefix} to juror ${jurorAlias.name || jurorAlias.lastName}`);
        return {
          id: jurorAlias.id,
          speakerPrefix: upperPrefix,
          speakerHandle: `JUROR_${jurorAlias.id}`,
          speakerType: SpeakerType.JUROR,
          jurorId: jurorAlias.id
        };
      }
    }
    
    // Check for JUROR prefix
    if (upperPrefix.match(/^JUROR\s+/)) {
      const juror = await this.witnessJurorService.createOrFindJuror(
        this.context.trialId,
        upperPrefix,
        lineText
      );
      
      this.stats.jurorStatements++;
      
      return {
        id: juror.speakerId || juror.id,  // Use speakerId if available, otherwise id
        speakerPrefix: upperPrefix,
        speakerHandle: `JUROR_${juror.id}`,
        speakerType: SpeakerType.JUROR,
        jurorId: juror.id
      };
    }
    
    // Check for known anonymous speakers
    const knownAnonymousSpeakers = ['COURT SECURITY OFFICER', 'BAILIFF', 'COURT REPORTER', 'INTERPRETER'];
    if (knownAnonymousSpeakers.includes(upperPrefix)) {
      const speakerId = await this.witnessJurorService.createAnonymousSpeaker(
        this.context.trialId,
        upperPrefix
      );
      
      this.stats.anonymousSpeakers++;
      
      return {
        id: speakerId,
        speakerPrefix: upperPrefix,
        speakerHandle: `ANONYMOUS_${upperPrefix.replace(/\s+/g, '_')}`,
        speakerType: SpeakerType.ANONYMOUS
      };
    }
    
    // Create anonymous speaker as last resort
    const speakerId = await this.witnessJurorService.createAnonymousSpeaker(
      this.context.trialId,
      upperPrefix
    );
    
    this.stats.anonymousSpeakers++;
    
    return {
      id: speakerId,
      speakerPrefix: upperPrefix,
      speakerHandle: `ANONYMOUS_${upperPrefix.replace(/\s+/g, '_')}`,
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
      logger.debug(`Updated Q. context to ${speaker.name} based on attorney speaking`);
    }
    
    // If witness speaks, update A. mapping
    if (speaker.speakerType === SpeakerType.WITNESS && 
        !['Q.', 'ATTORNEY'].includes(upperPrefix)) {
      state.contextualSpeakers.set('A.', speaker);
      state.contextualSpeakers.set('THE WITNESS', speaker);
      state.contextualSpeakers.set('WITNESS', speaker);
      logger.debug(`Updated A./THE WITNESS context to ${speaker.name}`);
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
   * Create witness called event - FIXED VERSION
   */
  private async createWitnessCalled(eventId: number, eventInfo: EventInfo, lines: any[]): Promise<void> {
    // Combine all lines for parsing
    const fullText = lines
      .map(l => l.text || '')
      .join('\n')
      .trim();
    
    // Use metadata if available, otherwise parse
    const witnessId = eventInfo.metadata?.witnessId;
    const examinationType = eventInfo.metadata?.examinationType;
    const swornStatus = eventInfo.metadata?.swornStatus || 'NOT_SWORN';
    const continued = eventInfo.metadata?.continued || false;
    const presentedByVideo = fullText.includes('VIDEO') || false;
    
    if (witnessId && examinationType) {
      await this.prisma.witnessCalledEvent.create({
        data: {
          eventId,
          witnessId,
          examinationType,
          swornStatus,
          continued,
          presentedByVideo,
          rawText: fullText.substring(0, 255)
        }
      });
      
      logger.info(`Created witness called event for witness ${witnessId}, exam type: ${examinationType}`);
    } else {
      logger.warn(`Missing witness or examination type for witness called event`);
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
    logger.info('============================================================');
    logger.info('PHASE 2 PROCESSING COMPLETE');
    logger.info('============================================================');
    logger.info(`Total Events: ${this.stats.totalEvents}`);
    logger.info(`Statement Events: ${this.stats.statementEvents}`);
    logger.info(`Witness Events: ${this.stats.witnessEvents}`);
    logger.info(`Directive Events: ${this.stats.directiveEvents}`);
    logger.info(`Juror Statements: ${this.stats.jurorStatements}`);
    logger.info(`Anonymous Speakers: ${this.stats.anonymousSpeakers}`);
    
    if (this.stats.unmatchedSpeakers.length > 0) {
      logger.warn(`Unmatched Speakers: ${[...new Set(this.stats.unmatchedSpeakers)].join(', ')}`);
    }
    
    if (this.stats.errors > 0) {
      logger.error(`Errors: ${this.stats.errors}`);
    }
    
    logger.info('============================================================');
  }
}