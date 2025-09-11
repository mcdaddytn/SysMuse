// src/parsers/Phase2Processor.ts
import { PrismaClient, AttorneyRole } from '@prisma/client';
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
import { SpeakerRegistry } from '../services/SpeakerRegistry';
import { ExaminationContextManager } from '../services/ExaminationContextManager';
import { syncTrialStatementEvents } from '../scripts/syncElasticsearchLifecycle';
import logger from '../utils/logger';

interface ProcessingState {
  currentEvent: EventInfo | null;
  eventLines: any[];
  currentSpeaker: SpeakerInfo | null;
  currentWitness: WitnessInfo | null;
  currentExaminationType: ExaminationType | null;
  lastQSpeaker: SpeakerInfo | null;
  contextualSpeakers: Map<string, SpeakerInfo>;
  previousLine: any | null;  // Store previous line for lookback
  allLines: any[];  // Store all lines for access
  currentLineIndex: number;  // Current line index
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
  private speakerRegistry: SpeakerRegistry | null = null;
  private examinationContext: ExaminationContextManager | null = null;
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
    
    // Enhanced witness name patterns to handle all variations found in database
    // Handles: PLAINTIFF'S, PLAINTIFFS', PLAINTIFFS, DEFENDANT'S, DEFENDANTS', DEFENDANTS, DEFENSE
    // Case-sensitive match for structural WITNESS markers only
    witnessName: /^([A-Z][A-Z\s,'"\.\-]+?),?\s+(PLAINTIFF'?S?'?|DEFENDANT'?S?'?|DEFENSE)\s+WITNESS(?:ES)?(?:\s|,|$)/,
    witnessNameAlternate: /^([A-Z][A-Z\s,'"\.\-]+?)\s*,\s*(PLAINTIFF'?S?'?|DEFENDANT'?S?'?|DEFENSE)\s+WITNESS(?:ES)?(?:\s|,|$)/,
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
    // Enable Prisma query logging to debug filtering issues
    this.prisma = new PrismaClient({
      log: [
        { level: 'query', emit: 'event' },
        { level: 'warn', emit: 'event' },
        { level: 'error', emit: 'event' }
      ]
    });
    
    // Log all SQL queries for debugging
    (this.prisma as any).$on('query', (e: any) => {
      // Only log session and event queries to reduce noise
      if (e.query.includes('Session') || e.query.includes('TrialEvent')) {
        logger.debug(`[PRISMA SQL] ${e.query}`);
        logger.debug(`[PRISMA PARAMS] ${e.params}`);
      }
    });
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
      logger.info(`Setting context.trialId = ${trialId}`);
      
      // Load existing entities
      await this.loadExistingEntities(trialId);
      
      // Get all sessions for this trial
      // Sessions are already properly ordered by their IDs, which reflects
      // the order they were created during phase 1 parsing
      // Phase 1 respects the trialstyle.json ordering, so we just sort by ID
      logger.info(`Querying sessions with trialId = ${trialId}`);
      
      const sessions = await this.prisma.session.findMany({
        where: { trialId },
        orderBy: { id: 'asc' }  // Simple ID ordering - preserves phase 1 order
      });
      
      logger.info(`Found ${sessions.length} sessions for trialId ${trialId}`);
      logger.debug(`Session IDs: ${sessions.map(s => s.id).join(', ')}`);
      logger.debug(`Session trialIds: ${sessions.map(s => s.trialId).join(', ')}`);
      
      // Process each session
      for (const session of sessions) {
        logger.info(`Processing session ${session.id} of ${sessions.length}`);
        this.context.currentSession = session;
        await this.processSession(session);
      }
      
      // Log statistics
      this.logStatistics();
      
      // Sync statement events to Elasticsearch if enabled
      if (this.config.enableElasticSearch !== false) {
        logger.info('============================================================');
        logger.info('SYNCING STATEMENT EVENTS TO ELASTICSEARCH');
        logger.info('============================================================');
        try {
          await syncTrialStatementEvents(this.context.trialId);
          logger.info(`Elasticsearch sync completed successfully for trial ${this.context.trialId}`);
        } catch (syncError) {
          logger.error('Elasticsearch sync failed:', syncError);
          logger.warn('Continuing without Elasticsearch - search functionality may be limited');
        }
      } else {
        logger.info('Elasticsearch sync skipped (disabled in config)');
      }
      
    } catch (error) {
      logger.error(`Phase 2 processing failed: ${error}`);
      throw error;
    } finally {
      await this.prisma.$disconnect();
    }
  }

  /**
   * Load participants (attorneys, judge) from SessionSection metadata
   */
  private async loadParticipantsFromSessionSections(trialId: number): Promise<void> {
    logger.info('Loading participants from SessionSection metadata...');
    
    // Load JUDGE_INFO sections
    const judgeSections = await this.prisma.sessionSection.findMany({
      where: { 
        trialId,
        sectionType: 'JUDGE_INFO',
        metadata: { not: {} }
      }
    });
    
    // Find the first non-empty judge info
    for (const section of judgeSections) {
      const metadata = section.metadata as any;
      if (metadata?.name) {
        // Check if judge already exists
        let judge = await this.prisma.judge.findFirst({
          where: { trialId }
        });
        
        if (!judge) {
          // Create speaker for judge
          const judgeSpeaker = await this.prisma.speaker.create({
            data: {
              trialId,
              speakerPrefix: 'THE COURT',
              speakerHandle: 'JUDGE',
              speakerType: 'JUDGE'
            }
          });
          
          // Create judge record
          judge = await this.prisma.judge.create({
            data: {
              trialId,
              name: metadata.name,
              title: metadata.title || 'UNITED STATES DISTRICT JUDGE',
              honorific: metadata.honorific || 'HONORABLE',
              speakerId: judgeSpeaker.id
            }
          });
          
          logger.info(`Created judge: ${judge.name}`);
        }
        break; // Only need one judge
      }
    }
    
    // Load APPEARANCES sections for attorneys
    const appearancesSections = await this.prisma.sessionSection.findMany({
      where: { 
        trialId,
        sectionType: 'APPEARANCES',
        metadata: { not: {} }
      }
    });
    
    // Process attorneys from appearances
    for (const section of appearancesSections) {
      const metadata = section.metadata as any;
      
      // Process plaintiff attorneys
      if (metadata?.plaintiffAttorneys && Array.isArray(metadata.plaintiffAttorneys)) {
        for (const attorneyData of metadata.plaintiffAttorneys) {
          if (attorneyData.name && !attorneyData.name.includes('L.L.P') && !attorneyData.name.includes('LLP')) {
            await this.createAttorneyFromMetadata(trialId, attorneyData, 'PLAINTIFF');
          }
        }
      }
      
      // Process defendant attorneys
      if (metadata?.defendantAttorneys && Array.isArray(metadata.defendantAttorneys)) {
        for (const attorneyData of metadata.defendantAttorneys) {
          if (attorneyData.name && !attorneyData.name.includes('L.L.P') && !attorneyData.name.includes('LLP')) {
            await this.createAttorneyFromMetadata(trialId, attorneyData, 'DEFENDANT');
          }
        }
      }
    }
  }
  
  /**
   * Create attorney from SessionSection metadata
   */
  private async createAttorneyFromMetadata(
    trialId: number, 
    attorneyData: any, 
    side: 'PLAINTIFF' | 'DEFENDANT'
  ): Promise<void> {
    // Generate speaker prefix from name
    const speakerPrefix = this.generateSpeakerPrefix(attorneyData.name);
    const lastName = this.extractLastName(attorneyData.name);
    const attorneyFingerprint = this.generateAttorneyFingerprint(attorneyData.name);
    
    // First, check if attorney already exists by speaker prefix
    let attorney = await this.prisma.attorney.findFirst({
      where: { 
        speakerPrefix: speakerPrefix 
      }
    });
    
    // If not found by prefix, try fingerprint
    if (!attorney) {
      attorney = await this.prisma.attorney.findFirst({
        where: { 
          attorneyFingerprint: attorneyFingerprint 
        }
      });
    }
    
    // Create speaker for this trial
    const speakerHandle = `ATTORNEY_${lastName}`;
    let speaker = await this.prisma.speaker.findFirst({
      where: {
        trialId,
        speakerHandle
      }
    });
    
    if (!speaker) {
      speaker = await this.prisma.speaker.create({
        data: {
          trialId,
          speakerPrefix,
          speakerHandle,
          speakerType: 'ATTORNEY',
          isGeneric: false
        }
      });
    }
    
    if (attorney) {
      logger.info(`Matched existing attorney: ${attorney.name} with prefix: ${speakerPrefix}`);
    } else {
      // Create new attorney WITHOUT speaker (speaker is now on TrialAttorney)
      attorney = await this.prisma.attorney.create({
        data: {
          name: attorneyData.name,
          speakerPrefix,
          lastName,
          attorneyFingerprint
        }
      });
      logger.info(`Created new attorney: ${attorney.name} with prefix: ${speakerPrefix}`);
    }
    
    // Always create or update TrialAttorney association
    const existingAssoc = await this.prisma.trialAttorney.findFirst({
      where: {
        trialId,
        attorneyId: attorney.id
      }
    });
    
    if (!existingAssoc) {
      await this.prisma.trialAttorney.create({
        data: {
          trialId,
          attorneyId: attorney.id,
          speakerId: speaker.id,  // Associate speaker with TrialAttorney
          role: side,
          lawFirmId: attorneyData.lawFirmId || null
        }
      });
      logger.info(`Created TrialAttorney association for ${attorney.name} as ${side} with speaker`);
    } else if (!existingAssoc.speakerId) {
      // Update existing association to add speaker if missing
      await this.prisma.trialAttorney.update({
        where: { id: existingAssoc.id },
        data: { speakerId: speaker.id }
      });
      logger.info(`Updated TrialAttorney association with speaker for ${attorney.name}`);
    }
  }

  /**
   * Load existing entities into context
   */
  private async loadExistingEntities(trialId: number): Promise<void> {
    // DISABLED: We now use trial-metadata.json for attorney information
    // Phase2 should not create attorneys from parsing transcript headers
    // as it incorrectly treats law firm names as attorney names
    // await this.loadParticipantsFromSessionSections(trialId);
    
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
    logger.debug(`Session ID ${session.id}, Trial ID ${session.trialId}`);
    
    // Initialize speaker services for this trial if not done yet
    if (!this.speakerRegistry) {
      this.speakerRegistry = new SpeakerRegistry(this.prisma, this.context.trialId);
      await this.speakerRegistry.initialize();
      this.examinationContext = new ExaminationContextManager(this.speakerRegistry);
    }
    
    // Set current session in context
    this.context.currentSession = session;
    
    // Get all lines for this session in order
    logger.debug(`Fetching pages for sessionId = ${session.id}`);
    
    const pages = await this.prisma.page.findMany({
      where: { 
        sessionId: session.id
      },
      orderBy: { pageNumber: 'asc' },
      include: {
        lines: {
          where: { documentSection: 'PROCEEDINGS' },
          orderBy: { lineNumber: 'asc' }
        }
      }
    });
    
    logger.debug(`Found ${pages.length} pages for session ${session.id}`);
    logger.debug(`Page IDs: ${pages.map(p => p.id).join(', ')}`)
    
    // Flatten all lines from all pages
    const allLines: any[] = [];
    let totalLinesFromPages = 0;
    for (const page of pages) {
      const pageLineCount = page.lines.length;
      totalLinesFromPages += pageLineCount;
      allLines.push(...page.lines);
    }
    logger.debug(`Total lines collected: ${allLines.length}`)
    
    // Initialize state with current witness context
    const state: ProcessingState = {
      currentEvent: null,
      eventLines: [],
      currentSpeaker: null,
      currentWitness: this.witnessJurorService.getCurrentWitness(),
      currentExaminationType: null,
      lastQSpeaker: null,
      contextualSpeakers: new Map(),
      previousLine: null,
      allLines: allLines,
      currentLineIndex: 0
    };
    
    // Log initial witness context
    if (state.currentWitness) {
      logger.debug(`Starting session with witness context: ${state.currentWitness.name}`);
    }
    
    // Process lines sequentially
    for (let i = 0; i < allLines.length; i++) {
      state.currentLineIndex = i;
      state.previousLine = i > 0 ? allLines[i - 1] : null;
      await this.processLine(session.id, allLines[i], state);
    }
    
    // Save any remaining event
    if (state.currentEvent) {
      await this.saveEvent(this.context.trialId, session.id, state.currentEvent, state.eventLines);
    }
    
    // Persist witness state for next session
    if (state.currentWitness) {
      this.witnessJurorService.setCurrentWitness(state.currentWitness);
      logger.debug(`Persisting witness context for next session: ${state.currentWitness.name}`);
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
    
    // Check for examination type change BEFORE witness check
    // This is important because examination lines should be processed as witness events
    if (await this.checkExaminationChange(sessionId, line, lineText, state)) {
      return;
    }
    
    // Check for "BY MR./MS." pattern in line text to set examining attorney
    // This typically follows examination type lines
    logger.debug(`[BY LINE DEBUG] Checking line ${line.lineNumber}: "${lineText.substring(0, 30)}..."`);
    if (await this.checkExaminingAttorney(sessionId, line, lineText, state)) {
      logger.debug(`BY line ${line.lineNumber} was handled`);
      return;
    }
    
    // Check for witness being called
    if (await this.checkWitnessCalled(sessionId, line, lineText, state)) {
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
   * Check for "BY MR./MS." pattern in line text to set examining attorney context
   * This handles lines like "BY MR. FABRICANT:" that indicate who is conducting the examination
   */
  private async checkExaminingAttorney(
    sessionId: number,
    line: any,
    lineText: string,
    state: ProcessingState
  ): Promise<boolean> {
    // Check the text for BY pattern
    // Note: BY lines DO have speakerPrefix from Phase 1, so we check the text not the prefix
    const trimmed = lineText.trim();
    
    // Check for "BY MR./MS./MRS./DR. LASTNAME:" or "BY MR./MS./MRS./DR. FIRSTNAME LASTNAME:" pattern
    const byMatch = trimmed.match(/^BY\s+(MR\.|MS\.|MRS\.|DR\.)\s+([A-Z]+(?:\s+[A-Z]+)*):?$/);
    logger.debug(`[BY LINE DEBUG] checkExaminingAttorney: trimmed="${trimmed}", match=${byMatch ? 'YES' : 'NO'}`);
    if (!byMatch) {
      return false;
    }
    
    const attorneyPrefix = `${byMatch[1]} ${byMatch[2]}`;
    logger.debug(`Found examining attorney indicator: ${trimmed}`);
    
    // Find the attorney (with speaker relation through TrialAttorney)
    const attorney = await this.attorneyService.findAttorneyBySpeakerPrefix(
      this.context.trialId,
      attorneyPrefix
    );
    
    let speaker: SpeakerInfo | null = null;
    
    try {
      if (attorney) {
        // Get the TrialAttorney association to find the speaker
        let trialAttorney = await this.prisma.trialAttorney.findFirst({
          where: {
            trialId: this.context.trialId,
            attorneyId: attorney.id
          },
          include: {
            speaker: true
          }
        });
        
        // If no TrialAttorney exists (attorney from metadata import), create it now
        if (!trialAttorney) {
          logger.info(`Creating TrialAttorney association for imported attorney: ${attorney.name}`);
          
          // Create speaker for this attorney
          const speakerHandle = `ATTORNEY_${attorney.lastName?.replace(/[^A-Z0-9]/gi, '_') || attorney.name.replace(/[^A-Z0-9]/gi, '_')}`;
          const dbSpeaker = await this.prisma.speaker.create({
            data: {
              trialId: this.context.trialId,
              speakerPrefix: attorneyPrefix,
              speakerHandle,
              speakerType: 'ATTORNEY'
            }
          });
          
          // Determine role based on witness context if available
          let attorneyRole: 'PLAINTIFF' | 'DEFENDANT' | 'UNKNOWN' = 'UNKNOWN';
          if (state.currentWitness?.witnessCaller) {
            const witnessCaller = state.currentWitness.witnessCaller;
            if (state.currentExaminationType === ExaminationType.DIRECT_EXAMINATION ||
                state.currentExaminationType === ExaminationType.REDIRECT_EXAMINATION) {
              attorneyRole = witnessCaller as 'PLAINTIFF' | 'DEFENDANT';
            } else if (state.currentExaminationType === ExaminationType.CROSS_EXAMINATION ||
                       state.currentExaminationType === ExaminationType.RECROSS_EXAMINATION) {
              attorneyRole = witnessCaller === 'PLAINTIFF' ? 'DEFENDANT' : 'PLAINTIFF';
            }
          }
          
          // Create TrialAttorney association
          trialAttorney = await this.prisma.trialAttorney.create({
            data: {
              trialId: this.context.trialId,
              attorneyId: attorney.id,
              speakerId: dbSpeaker.id,
              role: attorneyRole
            },
            include: {
              speaker: true
            }
          });
          
          logger.info(`Created TrialAttorney association for ${attorney.name} with role ${attorneyRole}`);
        } else if (!trialAttorney.speaker) {
          // TrialAttorney exists but has no speaker (from metadata import) - create speaker and update
          logger.info(`TrialAttorney exists but has no speaker for attorney: ${attorney.name} - creating speaker`);
          
          // Create speaker for this attorney
          const speakerHandle = `ATTORNEY_${attorney.lastName?.replace(/[^A-Z0-9]/gi, '_') || attorney.name.replace(/[^A-Z0-9]/gi, '_')}`;
          const dbSpeaker = await this.prisma.speaker.create({
            data: {
              trialId: this.context.trialId,
              speakerPrefix: attorneyPrefix,
              speakerHandle,
              speakerType: 'ATTORNEY'
            }
          });
          
          // Update the existing TrialAttorney with the speaker
          trialAttorney = await this.prisma.trialAttorney.update({
            where: {
              id: trialAttorney.id
            },
            data: {
              speakerId: dbSpeaker.id
            },
            include: {
              speaker: true
            }
          });
          
          logger.info(`Updated TrialAttorney with speaker for ${attorney.name}`);
        }
        
        if (!trialAttorney?.speaker) {
          logger.error(`Attorney ${attorney.name} has no speaker record for trial ${this.context.trialId}!`);
          return false;
        }
        
        // Create speaker info for this attorney using the TrialAttorney's speaker
        speaker = {
          id: trialAttorney.speaker.id,
          speakerPrefix: trialAttorney.speaker.speakerPrefix,
          speakerHandle: trialAttorney.speaker.speakerHandle,
          speakerType: SpeakerType.ATTORNEY,
          attorneyId: attorney.id,
          name: attorney.name
        };
        logger.debug(`Found existing attorney: ${attorney.name}`);
      } else {
      // Attorney not found - create dynamically
      logger.warn(`Attorney not found for: ${attorneyPrefix} - creating dynamically`);
      
      // Parse the attorney prefix
      const titleMatch = attorneyPrefix.match(/^(MR\.|MS\.|MRS\.|DR\.)\s+(.+)$/);
      if (titleMatch) {
        const title = titleMatch[1];
        const lastName = titleMatch[2];
        const speakerHandle = `ATTORNEY_${lastName}_${title.replace(/\./g, '')}`;
        
        // Check if speaker handle already exists
        let dbSpeaker = await this.prisma.speaker.findFirst({
          where: {
            trialId: this.context.trialId,
            speakerHandle
          }
        });
        
        // Create speaker if it doesn't exist
        if (!dbSpeaker) {
          dbSpeaker = await this.prisma.speaker.create({
            data: {
              trialId: this.context.trialId,
              speakerPrefix: attorneyPrefix,
              speakerHandle,
              speakerType: 'ATTORNEY'
            }
          });
          logger.info(`Created speaker for dynamically created attorney: ${attorneyPrefix}`);
        }
        
        // Check if attorney already exists with this fingerprint
        const attorneyFingerprint = `${lastName.toLowerCase().replace(/[^a-z]/g, '_')}_${title.charAt(0).toLowerCase()}`;
        let newAttorney = await this.prisma.attorney.findFirst({
          where: {
            attorneyFingerprint: attorneyFingerprint
          }
        });
        
        if (!newAttorney) {
          // Create attorney record WITHOUT speaker (speaker is on TrialAttorney)
          newAttorney = await this.prisma.attorney.create({
            data: {
              name: attorneyPrefix,
              title,
              lastName,
              speakerPrefix: attorneyPrefix,
              attorneyFingerprint: attorneyFingerprint
            }
          });
        } else {
          logger.debug(`Found existing attorney with fingerprint ${attorneyFingerprint}`);
        }
        
        // Determine role based on witness context if available
        let attorneyRole: 'PLAINTIFF' | 'DEFENDANT' | 'UNKNOWN' = 'UNKNOWN';
        if (state.currentWitness?.witnessCaller) {
          // If we're in a witness context and the witness is called by PLAINTIFF/DEFENDANT,
          // the examining attorney is typically from the same side for DIRECT examination
          // and opposite side for CROSS examination
          const witnessCaller = state.currentWitness.witnessCaller;
          if (state.currentExaminationType === ExaminationType.DIRECT_EXAMINATION ||
              state.currentExaminationType === ExaminationType.REDIRECT_EXAMINATION) {
            // Direct/Redirect - attorney is same side as witness caller
            attorneyRole = witnessCaller as 'PLAINTIFF' | 'DEFENDANT';
          } else if (state.currentExaminationType === ExaminationType.CROSS_EXAMINATION ||
                     state.currentExaminationType === ExaminationType.RECROSS_EXAMINATION) {
            // Cross/Recross - attorney is opposite side
            attorneyRole = witnessCaller === 'PLAINTIFF' ? 'DEFENDANT' : 'PLAINTIFF';
          }
          logger.info(`Determined attorney role as ${attorneyRole} based on witness caller ${witnessCaller} and exam type ${state.currentExaminationType}`);
        }
        
        // Create or update trial attorney association with speaker
        const trialAttorney = await this.prisma.trialAttorney.upsert({
          where: {
            trialId_attorneyId: {
              trialId: this.context.trialId,
              attorneyId: newAttorney.id
            }
          },
          update: {
            speakerId: dbSpeaker.id,  // Associate speaker with TrialAttorney
            // Update role if we determined it and it's currently UNKNOWN
            role: attorneyRole !== 'UNKNOWN' ? attorneyRole : undefined
          },
          create: {
            trialId: this.context.trialId,
            attorneyId: newAttorney.id,
            speakerId: dbSpeaker.id,  // Associate speaker with TrialAttorney
            role: attorneyRole
          },
          include: {
            speaker: true
          }
        });
        
        if (newAttorney && trialAttorney.speaker) {
          logger.info(`Created attorney dynamically: ${attorneyPrefix} with ID ${newAttorney.id} and role ${attorneyRole}`);
          
          // Create speaker info using the speaker from TrialAttorney
          speaker = {
            id: trialAttorney.speaker.id,
            speakerPrefix: trialAttorney.speaker.speakerPrefix,
            speakerHandle: trialAttorney.speaker.speakerHandle,
            speakerType: SpeakerType.ATTORNEY,
            attorneyId: newAttorney.id,
            name: attorneyPrefix
          };
        } else {
          logger.error(`Failed to create attorney for ${attorneyPrefix} - newAttorney or speaker is null`);
        }
      }
    }
    } catch (error) {
      logger.error(`Error in checkExaminingAttorney for ${attorneyPrefix}: ${error}`);
      if (error instanceof Error) {
        logger.error(`Stack trace: ${error.stack}`);
      }
      return false;
    }
    
    if (speaker) {
      // Set as the examining attorney (Q. context)
      state.lastQSpeaker = speaker;
      state.contextualSpeakers.set('Q.', speaker);
      
      // IMPORTANT: Also update the ExaminationContextManager
      if (this.examinationContext) {
        this.examinationContext.setExaminingAttorneyFromSpeaker(speaker);
      }
      
      logger.debug(`Set examining attorney context: ${speaker.name} will be Q.`);
      
      // Add this line to the current event if we have one (usually witness called event)
      if (state.currentEvent) {
        state.eventLines.push(line);
        state.currentEvent.endLineNumber = line.lineNumber;
        if (line.timestamp) {
          state.currentEvent.endTime = line.timestamp;
        }
      }
      
      return true; // We handled this line
    } else {
      logger.warn(`Could not create attorney for: ${attorneyPrefix}`);
    }
    
    return false;
  }

  /**
   * Parse witness line by removing known components and extracting the name
   * ALWAYS returns a witness if we detect witness indicators - NEVER fails due to name pattern
   */
  private parseWitnessLine(lineText: string): {
    witnessName: string;
    witnessCaller: 'PLAINTIFF' | 'DEFENDANT';
    swornStatus: SwornStatus;
  } | null {
    // Check if this line contains the key witness indicators
    if (!lineText.includes('WITNESS')) {
      return null;
    }
    
    // Check for PLAINTIFF'S WITNESS or DEFENDANT'S WITNESS (with variations)
    let witnessCaller: 'PLAINTIFF' | 'DEFENDANT' | null = null;
    let workingText = lineText;
    
    // Check for plaintiff patterns
    if (workingText.match(/PLAINTIFF'?S?'?\s+WITNESS/i)) {
      witnessCaller = 'PLAINTIFF';
      // Remove the pattern from the text
      workingText = workingText.replace(/PLAINTIFF'?S?'?\s+WITNESS(?:ES)?/gi, '');
    }
    // Check for defendant patterns (including DEFENSE)
    else if (workingText.match(/DEFENDANT'?S?'?\s+WITNESS/i) || workingText.match(/DEFENSE\s+WITNESS/i)) {
      witnessCaller = 'DEFENDANT';
      // Remove the pattern from the text
      workingText = workingText.replace(/DEFENDANT'?S?'?\s+WITNESS(?:ES)?/gi, '');
      workingText = workingText.replace(/DEFENSE\s+WITNESS(?:ES)?/gi, '');
    }
    
    if (!witnessCaller) {
      // No valid witness caller found
      return null;
    }
    
    // Determine sworn status and remove it from the text
    let swornStatus: SwornStatus = SwornStatus.NOT_SWORN;
    if (workingText.match(/PREVIOUSLY\s+SWORN/i)) {
      swornStatus = SwornStatus.PREVIOUSLY_SWORN;
      workingText = workingText.replace(/PREVIOUSLY\s+SWORN/gi, '');
    } else if (workingText.match(/\bSWORN\b/i)) {
      swornStatus = SwornStatus.SWORN;
      workingText = workingText.replace(/\bSWORN\b/gi, '');
    } else if (workingText.match(/\bPREVIOUSLY\b/i)) {
      // Handle case where "PREVIOUSLY" appears alone (likely "PREVIOUSLY SWORN" split across lines)
      swornStatus = SwornStatus.PREVIOUSLY_SWORN;
      workingText = workingText.replace(/\bPREVIOUSLY\b/gi, '');
    }
    
    // Remove common patterns that aren't part of the name
    workingText = workingText.replace(/EXAMINATION\s*(CONTINUED)?/gi, '');
    workingText = workingText.replace(/DIRECT|CROSS|REDIRECT|RECROSS/gi, '');
    workingText = workingText.replace(/PRESENTED\s+BY\s+VIDEO/gi, '');
    workingText = workingText.replace(/VIDEO\s+DEPOSITION/gi, '');
    workingText = workingText.replace(/DEPOSITION/gi, '');
    workingText = workingText.replace(/\(CONTINUED\)/gi, '');
    
    // Normalize the witness name
    workingText = this.normalizeWitnessName(workingText);
    
    // IMPORTANT: Even if the name seems empty or unusual, use what we have
    // Better to have a witness record than to miss one
    if (!workingText || workingText.length < 2) {
      // Use a placeholder if we really can't find a name
      workingText = "UNKNOWN WITNESS";
      logger.warn(`Could not extract witness name from line, using placeholder: ${lineText}`);
    }
    
    logger.info(`Successfully parsed witness: name="${workingText}", caller=${witnessCaller}, sworn=${swornStatus} from: "${lineText}"`);
    
    return {
      witnessName: workingText,
      witnessCaller: witnessCaller,
      swornStatus: swornStatus
    };
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
    // Skip if this line appears to be in the middle of a sentence
    // (e.g., "we'll be back to continue with the next Plaintiff's witness")
    const lowerText = lineText.toLowerCase();
    if (lowerText.includes("next plaintiff's witness") || 
        lowerText.includes("next defendant's witness") ||
        lowerText.includes("continue with") ||
        lowerText.includes("we'll be back") ||
        lowerText.includes("will be back")) {
      return false;
    }
    
    // Use the new simplified parsing approach
    const parsedWitness = this.parseWitnessLine(lineText);
    if (!parsedWitness) {
      return false;
    }
    
    // We have a witness! Extract the components
    const { witnessName, witnessCaller, swornStatus } = parsedWitness;
    const displayName = witnessName; // Keep for display
    
    // Save current event if exists
    if (state.currentEvent) {
      await this.saveEvent(this.context.trialId, sessionId, state.currentEvent, state.eventLines);
      state.currentEvent = null;
      state.eventLines = [];
    }
    
    logger.info(`Witness called detected: ${displayName} (${witnessCaller})`);
    
    // Create unique speaker handle for this witness
    // Replace non-alphanumeric with underscore, then collapse multiple underscores
    const cleanedName = witnessName.replace(/[^A-Z0-9]/gi, '_').replace(/_+/g, '_').toUpperCase();
    const speakerHandle = `WITNESS_${cleanedName}`;
    
    // Create proper speaker prefix for witness (not "A.")
    const witnessSpeakerPrefix = `WITNESS ${witnessName.toUpperCase()}`;
    
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
          speakerPrefix: witnessSpeakerPrefix,  // Use witness name, not "A."
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
      // Parse the witness name into components
      const parsedName = this.parseWitnessName(witnessName);
      
      // Check if witness with this fingerprint exists in ANY trial
      const existingWitness = await this.prisma.witness.findFirst({
        where: {
          witnessFingerprint: parsedName.fingerprint
        }
      });
      
      if (existingWitness) {
        // If witness exists in another trial, create with modified fingerprint for this trial
        logger.warn(`Witness with fingerprint ${parsedName.fingerprint} already exists in trial ${existingWitness.trialId}, creating with trial-specific fingerprint`);
        
        witness = await this.prisma.witness.create({
          data: {
            trialId: this.context.trialId,
            name: witnessName,
            displayName: displayName,
            firstName: parsedName.firstName,
            middleInitial: parsedName.middleInitial,
            lastName: parsedName.lastName,
            suffix: parsedName.suffix,
            witnessFingerprint: `${parsedName.fingerprint}_trial${this.context.trialId}`,
            witnessCaller: witnessCaller,
            speakerId: speaker.id,
            swornStatus: 'NOT_SWORN'
          },
          include: {
            speaker: true
          }
        });
      } else {
        witness = await this.prisma.witness.create({
          data: {
            trialId: this.context.trialId,
            name: witnessName,
            displayName: displayName,
            firstName: parsedName.firstName,
            middleInitial: parsedName.middleInitial,
            lastName: parsedName.lastName,
            suffix: parsedName.suffix,
            witnessFingerprint: parsedName.fingerprint,
            witnessCaller: witnessCaller,
            speakerId: speaker.id,
            swornStatus: 'NOT_SWORN'
          },
          include: {
            speaker: true
          }
        });
      }
      
      logger.info(`Created witness: ${displayName} with handle: ${speakerHandle}, fingerprint: ${witness.witnessFingerprint}`);
    }
    
    // Update state with current witness IMMEDIATELY
    // Use the swornStatus we already parsed
    state.currentWitness = {
      id: witness.id,
      name: witness.name || undefined,
      displayName: witness.displayName || undefined,
      witnessType: witness.witnessType || undefined,
      witnessCaller: witness.witnessCaller || undefined,
      speakerId: witness.speaker?.id,
      swornStatus: swornStatus  // Use the parsed sworn status
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
    
    // IMPORTANT: Also update the SpeakerRegistry and ExaminationContextManager
    // This ensures the ExaminationContextManager can resolve A. properly
    if (this.speakerRegistry) {
      // The speaker from the database already has all relations
      const speakerWithRelations = await this.prisma.speaker.findUnique({
        where: { id: speaker.id },
        include: {
          trialAttorneys: {
            include: {
              attorney: true
            }
          },
          witness: true,
          judge: true,
          juror: true
        }
      });
      if (speakerWithRelations) {
        this.speakerRegistry.setCurrentWitness(speakerWithRelations as any);
        logger.debug(`Updated SpeakerRegistry with current witness: ${displayName}`);
        
        // IMPORTANT: Also update the ExaminationContextManager
        if (this.examinationContext) {
          this.examinationContext.setCurrentWitnessFromSpeaker(
            speakerWithRelations,
            displayName,
            witnessCaller
          );
          logger.debug(`Updated ExaminationContextManager with current witness: ${displayName}`);
        }
      }
    }
    
    logger.info(`Set current witness context: ${displayName}, A. will now resolve to this witness`);
    
    // Determine initial examination type based on context or default to DIRECT
    let initialExaminationType: ExaminationType = ExaminationType.DIRECT_EXAMINATION;
    
    // Check if the line contains examination type
    const examMatch = lineText.match(this.PATTERNS.examinationType);
    if (examMatch) {
      const examType = examMatch[1].toUpperCase();
      switch (examType) {
        case 'DIRECT':
          initialExaminationType = ExaminationType.DIRECT_EXAMINATION;
          break;
        case 'CROSS':
          initialExaminationType = ExaminationType.CROSS_EXAMINATION;
          break;
        case 'REDIRECT':
          initialExaminationType = ExaminationType.REDIRECT_EXAMINATION;
          break;
        case 'RECROSS':
          initialExaminationType = ExaminationType.RECROSS_EXAMINATION;
          break;
      }
    }
    
    // Don't create the event yet - just buffer the witness line
    // The next line should be the examination type or VIDEO DEPOSITION
    // We'll create the complete event when we see that line in checkExaminationChange
    
    // Store the witness line for when we create the event
    state.eventLines = [line];
    
    // Return true to indicate we handled this line
    // The witness context is already set up above
    return true;
  }

  /**
   * Check for examination type change - SIMPLIFIED VERSION for Feature 02D
   */
  private async checkExaminationChange(
    sessionId: number,
    line: any,
    lineText: string,
    state: ProcessingState
  ): Promise<boolean> {
    // Simple string matching for examination types
    const trimmed = lineText.trim();
    
    // Check for exact examination types as specified in feature-02D.md
    let isExamination = false;
    let isVideo = false;
    let examType = '';
    let continued = false;
    
    // Check for video deposition FIRST (most specific)
    if (trimmed === 'PRESENTED BY VIDEO DEPOSITION' || trimmed === 'VIDEO DEPOSITION') {
      isVideo = true;
      examType = 'VIDEO';
    }
    // Check for examination types
    else if (trimmed === 'DIRECT EXAMINATION' || trimmed === 'DIRECT EXAMINATION CONTINUED') {
      isExamination = true;
      examType = 'DIRECT';
      continued = trimmed.includes('CONTINUED');
    }
    else if (trimmed === 'CROSS-EXAMINATION' || trimmed === 'CROSS-EXAMINATION CONTINUED') {
      isExamination = true;
      examType = 'CROSS';
      continued = trimmed.includes('CONTINUED');
    }
    else if (trimmed === 'REDIRECT EXAMINATION' || trimmed === 'REDIRECT EXAMINATION CONTINUED') {
      isExamination = true;
      examType = 'REDIRECT';
      continued = trimmed.includes('CONTINUED');
    }
    else if (trimmed === 'RECROSS-EXAMINATION' || trimmed === 'RECROSS-EXAMINATION CONTINUED') {
      isExamination = true;
      examType = 'RECROSS';
      continued = trimmed.includes('CONTINUED');
    }
    
    if (!isExamination && !isVideo) return false;
    
    logger.debug(`Examination line detected: ${lineText} (type: ${examType}, continued: ${continued}`);
    
    // Save current event if exists
    if (state.currentEvent) {
      await this.saveEvent(this.context.trialId, sessionId, state.currentEvent, state.eventLines);
      state.currentEvent = null;
      state.eventLines = [];
    }
    
    // For CONTINUED or DIRECT EXAMINATION or VIDEO DEPOSITION, look at previous line for witness info
    let needsWitnessLookup = continued || examType === 'DIRECT' || examType === 'VIDEO';
    let witnessInfo = null;
    let swornStatus: SwornStatus = SwornStatus.NOT_SWORN;
    
    if (needsWitnessLookup && state.previousLine) {
      const prevText = state.previousLine.text?.trim() || '';
      logger.debug(`Looking at previous line for witness info: ${prevText}`);
      
      // Check if previous line contains witness information
      const witnessMatch = prevText.match(/^([A-Z][A-Z\s,'"\.\-]+?),?\s+(PLAINTIFF'?S?'?|DEFENDANT'?S?'?|DEFENSE)\s+WITNESS/);
      if (witnessMatch) {
        let witnessName = witnessMatch[1].trim();
        // Normalize the witness name
        witnessName = this.normalizeWitnessName(witnessName);
        const displayName = witnessName;
        const callerText = witnessMatch[2].toUpperCase();
        const witnessCaller = callerText.includes('PLAINTIFF') ? 'PLAINTIFF' : 'DEFENDANT';
        
        // Check for sworn status in previous line
        if (prevText.match(/\bPREVIOUSLY\s+SWORN\b/i)) {
          swornStatus = SwornStatus.PREVIOUSLY_SWORN as SwornStatus;
        } else if (prevText.match(/\bSWORN\b/i)) {
          swornStatus = SwornStatus.SWORN as SwornStatus;
        }
        
        logger.info(`Found witness in previous line: ${displayName} (${witnessCaller}), sworn: ${swornStatus}`);
        
        // Find or create witness
        const cleanedName = witnessName.replace(/[^A-Z0-9]/gi, '_').replace(/_+/g, '_').toUpperCase();
        const speakerHandle = `WITNESS_${cleanedName}`;
        
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
          // Create speaker first
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
                speakerPrefix: `WITNESS ${witnessName.toUpperCase()}`,
                speakerHandle: speakerHandle,
                speakerType: 'WITNESS'
              }
            });
          } else {
            // If speaker exists, check if there's already a witness with this speaker
            witness = await this.prisma.witness.findFirst({
              where: {
                speakerId: speaker.id
              },
              include: {
                speaker: true
              }
            });
            
            if (witness) {
              logger.info(`Found existing witness for speaker ${speakerHandle}: ${witness.name}`);
            }
          }
          
          // Only create witness if we don't have one yet
          if (!witness) {
            // Parse the witness name into components
            const parsedName = this.parseWitnessName(witnessName);
            
            witness = await this.prisma.witness.create({
            data: {
              trialId: this.context.trialId,
              name: witnessName,
              displayName: displayName,
              firstName: parsedName.firstName,
              middleInitial: parsedName.middleInitial,
              lastName: parsedName.lastName,
              suffix: parsedName.suffix,
              witnessFingerprint: parsedName.fingerprint,
              witnessCaller: witnessCaller,
              speakerId: speaker.id,
              swornStatus: swornStatus
            },
            include: {
              speaker: true
            }
          });
          
          logger.info(`Created witness: ${displayName}, fingerprint: ${parsedName.fingerprint}`);
          }
        } else if (witness.swornStatus !== swornStatus) {
          // Update sworn status if changed
          witness = await this.prisma.witness.update({
            where: { id: witness.id },
            data: { swornStatus },
            include: { speaker: true }
          });
          logger.info(`Updated witness sworn status to: ${swornStatus}`);
        }
        
        // Update state with witness info
        witnessInfo = {
          id: witness.id,
          name: witness.name || undefined,
          displayName: witness.displayName || undefined,
          witnessType: witness.witnessType || undefined,
          witnessCaller: witness.witnessCaller || undefined,
          speakerId: witness.speaker?.id,
          swornStatus: swornStatus
        };
        
        // Update current witness in state
        state.currentWitness = witnessInfo;
        
        // Update contextual speakers
        if (witness.speaker) {
          const witnessSpeakerInfo: SpeakerInfo = {
            id: witness.speaker.id,
            speakerPrefix: witness.speaker.speakerPrefix,
            speakerHandle: witness.speaker.speakerHandle,
            speakerType: SpeakerType.WITNESS,
            witnessId: witness.id,
            name: displayName
          };
          
          state.contextualSpeakers.set('A.', witnessSpeakerInfo);
          state.contextualSpeakers.set('THE WITNESS', witnessSpeakerInfo);
          state.contextualSpeakers.set('WITNESS', witnessSpeakerInfo);
        }
        
        // Update service context
        this.witnessJurorService.setCurrentWitness(state.currentWitness);
        
        // IMPORTANT: Also update the SpeakerRegistry if available
        // This ensures the ExaminationContextManager can resolve A. properly
        if (this.speakerRegistry && witness.speaker) {
          // The witness.speaker already has the relations we need
          this.speakerRegistry.setCurrentWitness(witness.speaker as any);
          logger.debug(`Updated SpeakerRegistry with current witness: ${witness.displayName}`);
        }
      }
    }
    
    // If we didn't find witness info and need it, use current witness if available
    if (!witnessInfo && state.currentWitness) {
      witnessInfo = state.currentWitness;
      // Keep the sworn status from the current witness state
      // The sworn status should carry through examination stages (CROSS, REDIRECT, RECROSS)
      // It only changes to PREVIOUSLY_SWORN when explicitly stated in the transcript
    }
    
    if (!witnessInfo) {
      logger.warn(`No witness context for examination type: ${examType}`);
      return false;
    }
    
    // Map examination type to enum
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
    
    // Update current examination type
    state.currentExaminationType = examinationType;
    
    // IMPORTANT: Also update the ExaminationContextManager
    // Convert to ExaminationContextManager's type format
    if (this.examinationContext) {
      let contextExamType: 'DIRECT' | 'CROSS' | 'REDIRECT' | 'RECROSS' | 'VOIR_DIRE' | 'CONTINUED' | null = null;
      switch (examinationType) {
        case ExaminationType.DIRECT_EXAMINATION:
          contextExamType = 'DIRECT';
          break;
        case ExaminationType.CROSS_EXAMINATION:
          contextExamType = 'CROSS';
          break;
        case ExaminationType.REDIRECT_EXAMINATION:
          contextExamType = 'REDIRECT';
          break;
        case ExaminationType.RECROSS_EXAMINATION:
          contextExamType = 'RECROSS';
          break;
        case ExaminationType.VIDEO_DEPOSITION:
          // Video depositions don't have a direct equivalent, use null or DIRECT
          contextExamType = 'DIRECT';
          break;
      }
      this.examinationContext.setExaminationType(contextExamType);
      logger.debug(`Updated ExaminationContextManager with examination type: ${contextExamType}`);
    }
    
    // Determine the correct sworn status
    let eventSwornStatus: SwornStatus;
    
    // For video depositions, always use NOT_SWORN (witness sworn on video, not in court)
    if (isVideo) {
      eventSwornStatus = SwornStatus.NOT_SWORN;
    } else {
      // For in-court examinations:
      // - If witness has NOT_SWORN status (from a video deposition), they still need to be SWORN in court
      // - If witness has SWORN status, use it
      // - If witness has PREVIOUSLY_SWORN status, use it
      // - Default to SWORN for new in-court witnesses
      if (witnessInfo.swornStatus === SwornStatus.NOT_SWORN) {
        // This witness was previously shown by video, but now appearing in court
        // They need to be sworn for in-court testimony
        eventSwornStatus = SwornStatus.SWORN;
      } else if (witnessInfo.swornStatus) {
        // Use the witness's existing sworn status (SWORN or PREVIOUSLY_SWORN)
        eventSwornStatus = witnessInfo.swornStatus;
      } else {
        // Default for new witnesses appearing in court
        eventSwornStatus = SwornStatus.SWORN;
      }
    }
    
    // Check if we already have witness lines buffered (from checkWitnessCalled)
    // If so, we're completing a multi-line witness introduction
    const hasBufferedWitnessLine = state.eventLines.length > 0 && 
                                    !state.currentEvent;
    
    // Get attorney ID from examination context if available
    let attorneyId = null;
    if (this.examinationContext) {
      const examiningAttorney = this.examinationContext.getExaminingAttorney();
      // The attorney ID might be on the speaker object or we need to look it up
      if (examiningAttorney?.speaker) {
        // Check if it's a SpeakerInfo object with attorneyId
        if ('attorneyId' in examiningAttorney.speaker && examiningAttorney.speaker.attorneyId) {
          attorneyId = examiningAttorney.speaker.attorneyId;
          logger.debug(`Found attorneyId ${attorneyId} from SpeakerInfo for ${examiningAttorney.speaker.speakerPrefix}`);
        }
        // Otherwise, check if it's a SpeakerWithRelations from Prisma with trialAttorneys
        else if ('trialAttorneys' in examiningAttorney.speaker) {
          const speakerWithRelations = examiningAttorney.speaker as any;
          if (speakerWithRelations.trialAttorneys && speakerWithRelations.trialAttorneys.length > 0) {
            attorneyId = speakerWithRelations.trialAttorneys[0].attorneyId;
            logger.debug(`Found attorneyId ${attorneyId} from trialAttorneys relation for ${examiningAttorney.speaker.speakerPrefix}`);
          } else {
            logger.warn(`No trialAttorneys found for examining attorney speaker: ${examiningAttorney.speaker.speakerPrefix}`);
          }
        } else {
          logger.warn(`Unable to extract attorneyId from examining attorney speaker: ${JSON.stringify({
            speakerPrefix: examiningAttorney.speaker.speakerPrefix,
            speakerHandle: examiningAttorney.speaker.speakerHandle,
            hasAttorneyId: 'attorneyId' in examiningAttorney.speaker,
            hasTrialAttorneys: 'trialAttorneys' in examiningAttorney.speaker
          })}`);
        }
      } else if (examiningAttorney) {
        logger.warn(`Examining attorney found but has no speaker: ${JSON.stringify({
          title: examiningAttorney.title,
          lastName: examiningAttorney.lastName,
          fullName: examiningAttorney.fullName
        })}`);
      } else {
        logger.warn(`No examining attorney in context for witness examination at line ${line.lineNumber}`);
      }
    } else {
      logger.warn(`No examination context available for witness examination at line ${line.lineNumber}`);
    }
    
    // Log warning if we couldn't find attorney ID
    if (!attorneyId && witnessInfo) {
      logger.warn(`Unable to find attorneyId for witness examination. Context: ${JSON.stringify({
        witnessName: witnessInfo.name,
        witnessCaller: witnessInfo.witnessCaller,
        examinationType: examType,
        lineNumber: line.lineNumber,
        lineText: lineText.substring(0, 100),
        hasExaminationContext: !!this.examinationContext,
        currentExaminingAttorney: this.examinationContext?.getExaminingAttorney()?.lastName || 'none'
      })}`);
    }
    
    // Create witness called event
    if (hasBufferedWitnessLine) {
      // Use the buffered witness line as the start
      const witnessLine = state.eventLines[0];
      state.currentEvent = {
        type: EventType.WITNESS_CALLED,
        startTime: witnessLine.timestamp,
        startLineNumber: witnessLine.lineNumber,
        endLineNumber: line.lineNumber,
        metadata: {
          witnessId: witnessInfo.id,
          witnessName: witnessInfo.name,
          displayName: witnessInfo.displayName,
          examinationType,
          swornStatus: eventSwornStatus,
          continued: continued,
          presentedByVideo: isVideo,
          witnessCaller: witnessInfo.witnessCaller,
          attorneyId: attorneyId
        }
      };
      // Add the examination line to the buffered lines
      state.eventLines.push(line);
    } else {
      // Standalone examination line (no witness line before it)
      state.currentEvent = {
        type: EventType.WITNESS_CALLED,
        startTime: line.timestamp,
        startLineNumber: line.lineNumber,
        endLineNumber: line.lineNumber,
        metadata: {
          witnessId: witnessInfo.id,
          witnessName: witnessInfo.name,
          displayName: witnessInfo.displayName,
          examinationType,
          swornStatus: eventSwornStatus,
          continued: continued,
          presentedByVideo: isVideo,
          witnessCaller: witnessInfo.witnessCaller,
          attorneyId: attorneyId
        }
      };
      state.eventLines = [line];
    }
    
    // Include previous line if it has witness info
    // BUT only if we don't already have buffered witness lines
    if (needsWitnessLookup && state.previousLine && !hasBufferedWitnessLine) {
      const prevText = state.previousLine.text?.trim() || '';
      if (prevText.match(/WITNESS/i)) {
        state.eventLines.unshift(state.previousLine);
        state.currentEvent.startLineNumber = state.previousLine.lineNumber;
        if (state.previousLine.timestamp) {
          state.currentEvent.startTime = state.previousLine.timestamp;
        }
      }
    }
    
    // Don't save immediately - let the normal state management handle it
    // This prevents duplicates when multiple lines match
    
    return true;
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
    
    // IMPORTANT: Skip "BY MR./MS." lines - these are attorney indicators, not speakers
    // They should be handled by checkExaminingAttorney, not create speaker statements
    if (line.speakerPrefix.match(/^BY\s+(MR\.|MS\.|MRS\.|DR\.)/)) {
      logger.debug(`Skipping BY MR./MS. line as speaker statement: ${line.speakerPrefix}`);
      return false;
    }
    
    // Save current event if it's different
    if (state.currentEvent && 
        (state.currentEvent.type !== EventType.STATEMENT || 
         state.currentSpeaker?.speakerPrefix !== line.speakerPrefix)) {
      await this.saveEvent(this.context.trialId, sessionId, state.currentEvent, state.eventLines);
      state.currentEvent = null;
      state.eventLines = [];
    }
    
    // Find or create speaker
    const speaker = await this.findOrCreateSpeaker(line.speakerPrefix, lineText, state, line.lineNumber);
    
    if (!speaker) {
      logger.warn(`Could not resolve speaker. Details: ${JSON.stringify({
        speakerPrefix: line.speakerPrefix,
        lineNumber: line.lineNumber,
        lineText: lineText.substring(0, 100),
        currentWitness: state.currentWitness?.name || 'none',
        currentExaminationType: state.currentExaminationType || 'none',
        lastQSpeaker: state.lastQSpeaker?.name || 'none',
        currentEvent: state.currentEvent?.type || 'none',
        contextualSpeakers: Array.from(state.contextualSpeakers.keys()).join(', ')
      })}`);
      this.stats.unmatchedSpeakers.push(line.speakerPrefix);
      return false;
    }
    
    // Remove speaker prefix from text if it's still there
    let cleanText = lineText;
    if (line.speakerPrefix && lineText.startsWith(line.speakerPrefix)) {
      // Remove the speaker prefix and any following colon and whitespace
      cleanText = lineText.substring(line.speakerPrefix.length).replace(/^:\s*/, '').trim();
    }
    
    // Start new statement event or continue existing
    if (!state.currentEvent) {
      state.currentEvent = {
        type: EventType.STATEMENT,
        startTime: line.timestamp,
        startLineNumber: line.lineNumber,
        endLineNumber: line.lineNumber,
        speakerId: speaker.id,
        text: cleanText,
        metadata: {
          speakerAlias: line.speakerPrefix  // Save original speaker prefix
        }
      };
      state.eventLines = [line];
      state.currentSpeaker = speaker;
    } else {
      // Continue existing statement
      state.eventLines.push(line);
      state.currentEvent.endTime = line.timestamp;
      state.currentEvent.endLineNumber = line.lineNumber;
      state.currentEvent.text = (state.currentEvent.text || '') + '\n' + cleanText;
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
    state: ProcessingState,
    lineNumber?: number
  ): Promise<SpeakerInfo | null> {
    const upperPrefix = speakerPrefix.toUpperCase();
    
    // First, try to resolve through the new speaker registry if available
    if (this.speakerRegistry && this.examinationContext) {
      // Update examination context with the line
      await this.examinationContext.updateFromLine({ text: lineText, speakerPrefix });
      
      // Try contextual resolution first (Q, A, etc.)
      const resolved = await this.examinationContext.resolveSpeaker({ text: lineText, speakerPrefix });
      if (resolved) {
        return {
          id: resolved.id,
          speakerPrefix: resolved.speakerPrefix,
          speakerHandle: resolved.speakerHandle,
          speakerType: resolved.speakerType as SpeakerType,
          attorneyId: resolved.trialAttorneys?.[0]?.attorney?.id,
          witnessId: resolved.witness?.id,
          jurorId: resolved.juror?.id,
          name: resolved.trialAttorneys?.[0]?.attorney?.name || resolved.witness?.displayName || resolved.judge?.name
        };
      }
      
      // Try direct lookup in registry
      const speaker = await this.speakerRegistry.findOrCreateSpeaker(speakerPrefix, this.inferSpeakerType(speakerPrefix));
      if (speaker) {
        return {
          id: speaker.id,
          speakerPrefix: speaker.speakerPrefix,
          speakerHandle: speaker.speakerHandle,
          speakerType: speaker.speakerType as SpeakerType,
          attorneyId: speaker.trialAttorneys?.[0]?.attorney?.id,
          witnessId: speaker.witness?.id,
          jurorId: speaker.juror?.id,
          name: speaker.trialAttorneys?.[0]?.attorney?.name || speaker.witness?.displayName || speaker.judge?.name
        };
      }
    }
    
    // Fallback to legacy contextual speakers (for backward compatibility)
    const contextual = state.contextualSpeakers.get(upperPrefix);
    if (contextual) {
      logger.debug(`Found ${upperPrefix} in legacy contextual speakers: ${contextual.name}`);
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
      logger.warn(`${upperPrefix} found but no current witness in context. Details: ${JSON.stringify({
        lineNumber: lineNumber,
        lineText: lineText.substring(0, 100),
        speakerPrefix: upperPrefix,
        currentWitness: state.currentWitness?.name || 'none',
        currentExaminationType: state.currentExaminationType || 'none',
        lastQSpeaker: state.lastQSpeaker?.name || 'none',
        hasEventInProgress: !!state.currentEvent,
        eventType: state.currentEvent?.type || 'none'
      })}`);
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
      logger.info(`[ATTORNEY MATCH - BY PATTERN] Found 'BY' pattern, searching for attorney: ${attorneyPrefix}`);
      
      const attorney = await this.attorneyService.findAttorneyBySpeakerPrefix(
        this.context.trialId, 
        attorneyPrefix
      );
      
      if (attorney) {
        logger.info(`[ATTORNEY MATCH - BY PATTERN] Successfully matched attorney: ${attorney.name} (id=${attorney.id})`);
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
      } else {
        logger.warn(`[ATTORNEY MATCH - BY PATTERN] No attorney found for prefix: ${attorneyPrefix}`);
      }
    }
    
    // Check for attorney by full prefix (MR. LASTNAME)
    const attorneyMatch = upperPrefix.match(/^(MR\.|MS\.|MRS\.|DR\.)\s+([A-Z]+)/);
    if (attorneyMatch) {
      logger.info(`[ATTORNEY MATCH - DIRECT] Searching for attorney with prefix: ${upperPrefix}`);
      
      // First check if there's a pre-existing TrialAttorney association
      const trialAttorneyCount = await this.prisma.trialAttorney.count({
        where: {
          trialId: this.context.trialId,
          attorney: {
            speakerPrefix: upperPrefix
          }
        }
      });
      
      logger.info(`[ATTORNEY MATCH - DIRECT] Found ${trialAttorneyCount} TrialAttorney associations for prefix ${upperPrefix}`);
      
      const attorney = await this.attorneyService.findAttorneyBySpeakerPrefix(
        this.context.trialId,
        upperPrefix
      );
      
      if (attorney) {
        logger.info(`[ATTORNEY MATCH - DIRECT] Successfully matched: ${attorney.name} (id=${attorney.id}, speakerPrefix=${attorney.speakerPrefix})`);
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
      } else {
        // Check if attorney exists but not associated with this trial
        const globalAttorney = await this.prisma.attorney.findFirst({
          where: { speakerPrefix: upperPrefix }
        });
        
        if (globalAttorney) {
          logger.warn(`[ATTORNEY MATCH - DIRECT] Attorney exists globally but not associated with trial ${this.context.trialId}: ${globalAttorney.name} (id=${globalAttorney.id})`);
        } else {
          logger.info(`[ATTORNEY MATCH - DIRECT] No attorney exists with prefix: ${upperPrefix}`);
        }
      }
      
      // Not found as attorney - try juror alias match
      logger.debug(`[ATTORNEY MATCH] Moving to juror alias matching for: ${upperPrefix}`);
      
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
    
    // Check for JUROR prefix or THE FOREPERSON
    if (upperPrefix.match(/^JUROR\s+/) || upperPrefix === 'THE FOREPERSON') {
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
    
    // Check for known anonymous speakers (limited to actual court personnel)
    const knownAnonymousSpeakers = [
      'COURT SECURITY OFFICER', 
      'COURTROOM DEPUTY',
      'BAILIFF', 
      'COURT REPORTER', 
      'INTERPRETER',
      'THE CLERK',
      'CLERK'
    ];
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
    
    // Log unmatched speaker and return null instead of creating anonymous
    logger.warn(`Unmatched speaker prefix: ${upperPrefix} - not creating anonymous speaker. Context: ${JSON.stringify({
      lineText: lineText.substring(0, 100),
      currentWitness: state.currentWitness?.name || 'none',
      currentExaminationType: state.currentExaminationType || 'none',
      lastQSpeaker: state.lastQSpeaker?.name || 'none',
      availableContextualSpeakers: Array.from(state.contextualSpeakers.keys()).join(', ')
    })}`);
    this.stats.unmatchedSpeakers.push(upperPrefix);
    
    // Return null - we don't want to create anonymous speakers for unrecognized prefixes
    // This will prevent statements from being created for unmatched speakers
    return null;
  }

  /**
   * Infer speaker type from prefix
   */
  private inferSpeakerType(prefix: string): SpeakerType {
    const upper = prefix.toUpperCase();
    
    if (upper === 'THE COURT') return SpeakerType.JUDGE;
    if (upper.includes('JUDGE')) return SpeakerType.JUDGE;
    if (upper.includes('JUROR')) return SpeakerType.JUROR;
    if (upper === 'THE FOREPERSON') return SpeakerType.JUROR;
    if (upper === 'THE PANEL MEMBER') return SpeakerType.JUROR;
    if (upper === 'THE WITNESS' || upper === 'THE DEPONENT') return SpeakerType.WITNESS;
    if (upper === 'THE CLERK' || upper === 'THE BAILIFF') return SpeakerType.ANONYMOUS;
    if (upper.match(/^(MR\.|MS\.|MRS\.|DR\.)/)) return SpeakerType.ATTORNEY;
    if (upper === 'Q' || upper === 'Q.' || upper === 'QUESTION') return SpeakerType.ATTORNEY;
    if (upper === 'A' || upper === 'A.' || upper === 'ANSWER') return SpeakerType.WITNESS;
    
    return SpeakerType.ANONYMOUS;
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
   * Calculate word and character counts for event text
   */
  private calculateTextMetrics(eventInfo: EventInfo, lines: any[]): { wordCount: number; characterCount: number } {
    let text = '';
    
    // Get text based on event type
    if (eventInfo.text) {
      text = eventInfo.text;
    } else if (eventInfo.rawText) {
      text = eventInfo.rawText;
    } else if (lines.length > 0) {
      // Combine text from all lines
      text = lines.map(line => line.text || '').join(' ');
    }
    
    // Calculate word count (split by whitespace and filter empty strings)
    const wordCount = text.split(/\s+/).filter(word => word.length > 0).length;
    
    // Calculate character count (including spaces)
    const characterCount = text.length;
    
    return { wordCount, characterCount };
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
    logger.debug(`saveEvent called with trialId=${trialId}, sessionId=${sessionId}, eventType=${eventInfo.type}`);
    try {
      // Calculate duration if we have timestamps
      // For single-line events or events without endTime, set endTime = startTime
      const effectiveEndTime = eventInfo.endTime || eventInfo.startTime;
      
      // Calculate duration - 0 for single-line/point events
      let duration: number = 0;
      if (eventInfo.startTime && effectiveEndTime && eventInfo.startTime !== effectiveEndTime) {
        duration = this.calculateDuration(eventInfo.startTime, effectiveEndTime);
      }
      
      // Calculate word and character counts
      const { wordCount, characterCount } = this.calculateTextMetrics(eventInfo, lines);
      
      // Get raw text for the event (truncated to 255 chars)
      let rawText: string | undefined;
      if (eventInfo.rawText) {
        rawText = eventInfo.rawText.substring(0, 255);
      } else if (eventInfo.text) {
        rawText = eventInfo.text.substring(0, 255);
      } else if (lines.length > 0) {
        const combinedText = lines.map(line => line.text || '').join(' ');
        rawText = combinedText.substring(0, 255);
      }
      
      // Calculate ordinal for this trial event
      const eventCount = await this.prisma.trialEvent.count({
        where: { trialId }
      });
      const ordinal = eventCount + 1;
      
      // Get the start and end lines to extract all line number types
      let startSessLineNum: number | undefined;
      let endSessLineNum: number | undefined;
      let startTrialLineNum: number | undefined;
      let endTrialLineNum: number | undefined;
      
      if (eventInfo.startLineNumber && lines.length > 0) {
        // Get the first line
        const startLine = lines[0];
        if (startLine) {
          startSessLineNum = startLine.sessionLineNumber || undefined;
          startTrialLineNum = startLine.trialLineNumber || undefined;
        }
        
        // Get the last line
        const endLine = lines[lines.length - 1];
        if (endLine) {
          endSessLineNum = endLine.sessionLineNumber || undefined;
          endTrialLineNum = endLine.trialLineNumber || undefined;
        }
      }
      
      // Create trial event
      logger.debug(`Creating TrialEvent with trialId=${trialId}, sessionId=${sessionId}, startLine=${eventInfo.startLineNumber}, endLine=${eventInfo.endLineNumber}, type=${eventInfo.type}, ordinal=${ordinal}`);
      const event = await this.prisma.trialEvent.create({
        data: {
          trialId,
          sessionId,
          ordinal,
          startTime: eventInfo.startTime,
          endTime: effectiveEndTime,
          duration,
          startLineNumber: eventInfo.startLineNumber,
          endLineNumber: eventInfo.endLineNumber,
          startSessLineNum,
          endSessLineNum,
          startTrialLineNum,
          endTrialLineNum,
          lineCount: lines.length,
          wordCount,
          characterCount,
          eventType: eventInfo.type,
          rawText
        }
      });
      
      this.stats.totalEvents++;
      logger.debug(`Event saved. Total events so far: ${this.stats.totalEvents}`);
      
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
    
    // Get the speakerAlias from metadata or use the first line's speakerPrefix
    const speakerAlias = eventInfo.metadata?.speakerAlias || 
                        (lines.length > 0 && lines[0].speakerPrefix) || 
                        undefined;
    
    await this.prisma.statementEvent.create({
      data: {
        eventId,
        speakerId: eventInfo.speakerId,
        speakerAlias,  // Save the original speaker prefix
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
    const attorneyId = eventInfo.metadata?.attorneyId || null;
    
    if (witnessId && examinationType) {
      await this.prisma.witnessCalledEvent.create({
        data: {
          eventId,
          witnessId,
          examinationType,
          swornStatus,
          continued,
          presentedByVideo,
          attorneyId
        }
      });
      
      logger.debug(`Created witness called event for witness ${witnessId}, exam type: ${examinationType}`);
    } else {
      logger.warn(`Missing witness or examination type for witness called event`);
    }
  }

  /**
   * Normalize witness name by removing punctuation and standardizing format
   */
  private normalizeWitnessName(name: string): string {
    if (!name) return '';
    
    // Remove all punctuation characters (periods, commas, colons, semicolons, parentheses, quotes, etc.)
    let normalized = name.replace(/[.,;:()'"!?]/g, ' ');
    
    // Replace multiple spaces with single space
    normalized = normalized.replace(/\s+/g, ' ');
    
    // Trim whitespace from beginning and end
    normalized = normalized.trim();
    
    // Convert to uppercase (standardize capitalization)
    normalized = normalized.toUpperCase();
    
    return normalized;
  }

  /**
   * Parse witness name into components
   */
  private parseWitnessName(fullName: string): {
    firstName?: string;
    middleInitial?: string;
    lastName?: string;
    suffix?: string;
    fingerprint: string;
  } {
    if (!fullName) {
      return { fingerprint: '' };
    }
    
    // Simple token-based parsing as requested
    // Split on spaces, handling extra spaces
    const tokens = fullName.trim().split(/\s+/).filter(t => t.length > 0);
    
    if (tokens.length === 0) {
      return { fingerprint: '' };
    }
    
    let firstName: string | undefined;
    let middleInitial: string | undefined;
    let lastName: string | undefined;
    let suffix: string | undefined;
    
    // Check if there's a comma - everything after it is a suffix
    const fullStr = tokens.join(' ');
    const commaIndex = fullStr.indexOf(',');
    
    if (commaIndex !== -1) {
      // Has a comma - split on it
      const beforeComma = fullStr.substring(0, commaIndex).trim();
      suffix = fullStr.substring(commaIndex + 1).trim();
      
      // Re-tokenize the part before the comma
      const nameTokens = beforeComma.split(/\s+/).filter(t => t.length > 0);
      
      if (nameTokens.length === 0) {
        return { fingerprint: '' };
      } else if (nameTokens.length === 1) {
        // Just last name before comma
        lastName = nameTokens[0];
      } else {
        // First token is first name
        firstName = nameTokens[0];
        // Last token (before comma) is last name
        lastName = nameTokens[nameTokens.length - 1];
        // Everything in between is middle name/initial
        if (nameTokens.length > 2) {
          middleInitial = nameTokens.slice(1, -1).join(' ');
        }
      }
    } else {
      // No comma - simple token parsing
      if (tokens.length === 1) {
        // Single name
        lastName = tokens[0];
      } else if (tokens.length === 2) {
        // First Last
        firstName = tokens[0];
        lastName = tokens[1];
      } else {
        // First [Middle...] Last
        firstName = tokens[0];
        lastName = tokens[tokens.length - 1];
        // Everything in between is middle name/initial
        middleInitial = tokens.slice(1, -1).join(' ');
      }
    }
    
    // Generate fingerprint using underscores to connect parts
    // Replace spaces within parts with underscores too
    const fingerprintParts = [];
    if (firstName) fingerprintParts.push(firstName.toUpperCase().replace(/\s+/g, '_'));
    if (middleInitial) fingerprintParts.push(middleInitial.toUpperCase().replace(/\s+/g, '_'));
    if (lastName) fingerprintParts.push(lastName.toUpperCase().replace(/\s+/g, '_'));
    if (suffix) fingerprintParts.push(suffix.toUpperCase().replace(/\s+/g, '_'));
    const fingerprint = fingerprintParts.filter(p => p.length > 0).join('_');
    
    return {
      firstName,
      middleInitial,
      lastName,
      suffix,
      fingerprint
    };
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
    logger.debug(`Final trialId in context: ${this.context.trialId}`);
    
    if (this.stats.unmatchedSpeakers.length > 0) {
      logger.warn(`Unmatched Speakers: ${[...new Set(this.stats.unmatchedSpeakers)].join(', ')}`);
    }
    
    if (this.stats.errors > 0) {
      logger.error(`Errors: ${this.stats.errors}`);
    }
    
    logger.info('============================================================');
  }

  /**
   * Generate speaker prefix from attorney name
   */
  private generateSpeakerPrefix(name: string): string {
    const parts = name.trim().split(/\s+/);
    let title = '';
    let lastName = '';
    
    // Check for common titles
    if (parts[0].match(/^(Mr\.?|Ms\.?|Mrs\.?|Dr\.?|Judge)/i)) {
      title = parts[0].toUpperCase().replace(/\./g, '');
      if (!title.includes('.')) {
        title = title.replace(/^(MR|MS|MRS|DR)$/, '$1.');
      }
      lastName = parts[parts.length - 1].toUpperCase();
    } else {
      // No title found, assume MR. for males, MS. for females
      // This is a simplification - could be improved with name database
      title = 'MR.';
      lastName = parts[parts.length - 1].toUpperCase();
    }
    
    return `${title} ${lastName}`;
  }

  /**
   * Extract last name from full name
   */
  private extractLastName(name: string): string {
    const parts = name.trim().split(/\s+/);
    return parts[parts.length - 1].toUpperCase();
  }

  /**
   * Generate attorney fingerprint for matching
   */
  private generateAttorneyFingerprint(name: string): string {
    const parts = name.trim().split(/\s+/);
    let firstName = '';
    let lastName = '';
    
    // Skip title if present
    let startIdx = 0;
    if (parts[0].match(/^(Mr\.?|Ms\.?|Mrs\.?|Dr\.?|Judge)/i)) {
      startIdx = 1;
    }
    
    if (parts.length > startIdx) {
      firstName = parts[startIdx].toLowerCase().replace(/[^a-z]/g, '');
      lastName = parts[parts.length - 1].toLowerCase().replace(/[^a-z]/g, '');
    }
    
    return `${lastName}_${firstName}`;
  }

  /**
   * Create anonymous speaker for unmatched prefix
   */
  private async createAnonymousSpeaker(
    trialId: number,
    speakerPrefix: string,
    context: string
  ): Promise<any> {
    const speakerHandle = `ANONYMOUS_${speakerPrefix.replace(/[^A-Z]/g, '_')}`;
    
    const speaker = await this.prisma.speaker.create({
      data: {
        trialId,
        speakerPrefix,
        speakerHandle,
        speakerType: 'ANONYMOUS',
        isGeneric: false
      }
    });
    
    await this.prisma.anonymousSpeaker.create({
      data: {
        speakerId: speaker.id,
        trialId,
        role: 'UNKNOWN',
        description: `${speakerPrefix} - ${context}`
      }
    });
    
    logger.warn(`Created AnonymousSpeaker for unmatched prefix: ${speakerPrefix} (${context})`);
    return speaker;
  }
}