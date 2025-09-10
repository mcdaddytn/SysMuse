import { SpeakerWithRelations, SpeakerRegistry } from './SpeakerRegistry';
import { GenericSpeakerService, GenericSpeakers } from './GenericSpeakerService';
import { QAPatternDetector } from './QAPatternDetector';
import { TrialStyleConfig } from '../types/config.types';
import logger from '../utils/logger';

export type ExaminationType = 'DIRECT' | 'CROSS' | 'REDIRECT' | 'RECROSS' | 'VOIR_DIRE' | 'CONTINUED';
export type WitnessCaller = 'PLAINTIFF' | 'DEFENDANT' | 'COURT' | 'UNKNOWN';

export interface ParsedLine {
  text?: string | null;
  speakerPrefix?: string | null;
  lineNumber?: number;
  timestamp?: string | null;
}

export interface WitnessInfo {
  name: string;
  caller: WitnessCaller;
  speaker?: SpeakerWithRelations;
  swornStatus?: 'SWORN' | 'PREVIOUSLY_SWORN' | 'NOT_SWORN';
}

export interface AttorneyInfo {
  title?: string;
  lastName: string;
  fullName?: string;
  speaker?: SpeakerWithRelations;
}

export interface ExaminationState {
  currentWitness: WitnessInfo | null;
  currentExaminer: AttorneyInfo | null;
  examinationType: ExaminationType | null;
  witnessCalledBy: 'plaintiff' | 'defense' | null;
  lastSpecificAttorney: AttorneyInfo | null;
  usingGenericFallback: boolean;
}

export class ExaminationContextManager {
  private currentWitness: WitnessInfo | null = null;
  private examiningAttorney: AttorneyInfo | null = null;
  private opposingAttorney: AttorneyInfo | null = null;
  private examinationType: ExaminationType | null = null;
  private isVideoDeposition: boolean = false;
  private lastQSpeaker: SpeakerWithRelations | null = null;
  private speakerRegistry: SpeakerRegistry;
  private currentLine: ParsedLine | null = null;  // For logging context
  
  // Generic speaker tracking (Feature 02P)
  private genericSpeakerService: GenericSpeakerService | null = null;
  private qaPatternDetector: QAPatternDetector | null = null;
  private genericSpeakers: GenericSpeakers | null = null;
  private lastSpecificAttorney: AttorneyInfo | null = null;
  private usingGenericFallback: boolean = false;
  private trialStyleConfig: TrialStyleConfig | null = null;
  private witnessCalledBy: 'plaintiff' | 'defense' | null = null;

  // Pattern definitions
  private readonly PATTERNS = {
    // Witness patterns
    witnessCall: /^([A-Z][A-Z\s,'"\.\-]+?),?\s+(PLAINTIFF'S?|DEFENDANT'S?)\s+WITNESS/i,
    witnessWithNickname: /^([A-Z]+)\s+["']([A-Z]+)["']\s+([A-Z]+)/i,
    swornStatus: /(PREVIOUSLY\s+)?SWORN/i,
    
    // Examination patterns
    directExam: /DIRECT\s+EXAMINATION/i,
    crossExam: /CROSS[\s-]EXAMINATION/i,
    redirectExam: /REDIRECT\s+EXAMINATION/i,
    recrossExam: /RECROSS\s+EXAMINATION/i,
    voirDire: /VOIR\s+DIRE/i,
    examContinued: /EXAMINATION\s+CONTINUED/i,
    
    // Attorney patterns
    byAttorney: /^BY\s+(MR\.|MS\.|MRS\.|DR\.)\s+([A-Z][A-Z\s'-]+?):\s*/i,
    
    // Q&A patterns
    qShort: /^Q\.?\s*/i,
    aShort: /^A\.?\s*/i,
    questionLong: /^QUESTION:?\s*/i,
    answerLong: /^ANSWER:?\s*/i,
    
    // Deposition patterns
    videoDeposition: /VIDEO\s+DEPOSITION|PRESENTED\s+BY\s+VIDEO/i,
    theAttorney: /^THE ATTORNEY:\s*/i,
    theWitness: /^THE WITNESS:\s*/i,
    theDeponent: /^THE DEPONENT:\s*/i
  };

  constructor(
    speakerRegistry: SpeakerRegistry,
    genericSpeakerService?: GenericSpeakerService,
    trialStyleConfig?: TrialStyleConfig
  ) {
    this.speakerRegistry = speakerRegistry;
    this.genericSpeakerService = genericSpeakerService || null;
    this.trialStyleConfig = trialStyleConfig || null;
    
    if (trialStyleConfig) {
      this.qaPatternDetector = new QAPatternDetector(trialStyleConfig);
    }
  }
  
  async initializeGenericSpeakers(trialId: number): Promise<void> {
    if (this.genericSpeakerService && this.trialStyleConfig?.enableGenericFallback) {
      this.genericSpeakers = await this.genericSpeakerService.createGenericSpeakers(
        trialId,
        this.trialStyleConfig
      );
      logger.info(`Initialized generic speakers for trial ${trialId}`);
    }
  }

  async updateFromLine(line: ParsedLine): Promise<void> {
    if (!line.text) return;
    
    const text = line.text.trim();
    
    // Check for witness being called
    const witnessMatch = text.match(this.PATTERNS.witnessCall);
    if (witnessMatch) {
      await this.handleWitnessCall(witnessMatch[1], witnessMatch[2]);
      return;
    }
    
    // Check for examination type changes
    if (this.PATTERNS.directExam.test(text)) {
      this.examinationType = 'DIRECT';
      logger.debug(`Examination type changed to DIRECT at line ${line.lineNumber}`);
    } else if (this.PATTERNS.crossExam.test(text)) {
      this.examinationType = 'CROSS';
      logger.debug(`Examination type changed to CROSS at line ${line.lineNumber}`);
    } else if (this.PATTERNS.redirectExam.test(text)) {
      this.examinationType = 'REDIRECT';
      logger.debug(`Examination type changed to REDIRECT at line ${line.lineNumber}`);
    } else if (this.PATTERNS.recrossExam.test(text)) {
      this.examinationType = 'RECROSS';
      logger.debug(`Examination type changed to RECROSS at line ${line.lineNumber}`);
    } else if (this.PATTERNS.voirDire.test(text)) {
      this.examinationType = 'VOIR_DIRE';
      logger.debug(`Examination type changed to VOIR_DIRE at line ${line.lineNumber}`);
    } else if (this.PATTERNS.examContinued.test(text)) {
      this.examinationType = 'CONTINUED';
      logger.debug(`Examination continued at line ${line.lineNumber}`);
    }
    
    // Check for BY attorney (sets examining attorney)
    const byMatch = text.match(this.PATTERNS.byAttorney);
    if (byMatch) {
      await this.handleByAttorney(byMatch[1], byMatch[2]);
      return;
    }
    
    // Check for video deposition markers
    if (this.PATTERNS.videoDeposition.test(text)) {
      this.isVideoDeposition = true;
      logger.debug(`Video deposition detected at line ${line.lineNumber}`);
    }
    
    // Check for sworn status
    if (this.currentWitness && this.PATTERNS.swornStatus.test(text)) {
      this.currentWitness.swornStatus = text.includes('PREVIOUSLY') ? 
        'PREVIOUSLY_SWORN' : 'SWORN';
    }
  }

  async resolveSpeaker(line: ParsedLine): Promise<SpeakerWithRelations | null> {
    if (!line.text) return null;
    
    const text = line.text.trim();
    this.currentLine = line;  // Store for logging context
    
    // Check Q&A formats first
    if (this.PATTERNS.qShort.test(text) || this.PATTERNS.questionLong.test(text)) {
      return this.resolveQSpeaker();
    }
    
    if (this.PATTERNS.aShort.test(text) || this.PATTERNS.answerLong.test(text)) {
      return this.resolveASpeaker();
    }
    
    // Check for THE ATTORNEY (in video depositions)
    if (this.isVideoDeposition && this.PATTERNS.theAttorney.test(text)) {
      return this.resolveTheAttorney();
    }
    
    // Check for THE WITNESS or THE DEPONENT
    if (this.PATTERNS.theWitness.test(text) || this.PATTERNS.theDeponent.test(text)) {
      return this.resolveASpeaker();
    }
    
    // Check contextual speakers in registry
    const contextualSpeaker = this.speakerRegistry.resolveContextualSpeaker(
      line.speakerPrefix || text.split(':')[0]
    );
    if (contextualSpeaker) {
      return contextualSpeaker;
    }
    
    return null;
  }

  resolveQSpeaker(): SpeakerWithRelations | null {
    // In video deposition, Q refers to the examining attorney
    // In regular examination, Q refers to the current examining attorney
    
    if (this.examiningAttorney?.speaker) {
      this.lastQSpeaker = this.examiningAttorney.speaker;
      this.lastSpecificAttorney = this.examiningAttorney;
      this.usingGenericFallback = false;
      return this.examiningAttorney.speaker;
    }
    
    // Fallback to last Q speaker if we have one
    if (this.lastQSpeaker) {
      return this.lastQSpeaker;
    }
    
    // Use generic fallback if enabled
    if (this.trialStyleConfig?.enableGenericFallback && this.genericSpeakers) {
      const side = this.determineExaminerSide();
      if (side) {
        this.usingGenericFallback = true;
        logger.debug(`Using generic ${side} attorney for Q speaker`);
        return side === 'plaintiff' 
          ? this.genericSpeakers.plaintiffAttorney as any
          : this.genericSpeakers.defenseAttorney as any;
      }
    }
    
    logger.warn(`Unable to resolve Q speaker - no examining attorney set. Context: ${JSON.stringify({
      lineNumber: this.currentLine?.lineNumber,
      lineText: this.currentLine?.text?.substring(0, 100),
      examinationType: this.examinationType,
      currentWitness: this.currentWitness?.name || 'none',
      isVideoDeposition: this.isVideoDeposition,
      hasGenericSpeakers: !!this.genericSpeakers,
      lastQSpeaker: this.lastQSpeaker ? (this.lastQSpeaker as any).speakerPrefix || 'none' : 'none'
    })}`);
    return null;
  }
  
  private determineExaminerSide(): 'plaintiff' | 'defense' | null {
    if (!this.currentWitness || !this.witnessCalledBy) {
      return null;
    }
    
    // During direct examination, examiner is from the side that called the witness
    if (this.examinationType === 'DIRECT' || this.examinationType === 'REDIRECT') {
      return this.witnessCalledBy;
    }
    
    // During cross examination, examiner is from the opposite side
    if (this.examinationType === 'CROSS' || this.examinationType === 'RECROSS') {
      return this.witnessCalledBy === 'plaintiff' ? 'defense' : 'plaintiff';
    }
    
    // Default based on who called the witness
    return this.witnessCalledBy;
  }

  resolveASpeaker(): SpeakerWithRelations | null {
    if (this.currentWitness?.speaker) {
      return this.currentWitness.speaker;
    }
    
    // Try to get from registry
    const witnessFromRegistry = this.speakerRegistry.getCurrentWitness();
    if (witnessFromRegistry) {
      return witnessFromRegistry;
    }
    
    // No witness found - log warning with context
    logger.warn(`Unable to resolve A speaker - no current witness. Context: ${JSON.stringify({
      lineNumber: this.currentLine?.lineNumber,
      lineText: this.currentLine?.text?.substring(0, 100),
      speakerPrefix: this.currentLine?.speakerPrefix,
      examinationType: this.examinationType,
      examiningAttorney: this.examiningAttorney?.lastName || 'none',
      isVideoDeposition: this.isVideoDeposition,
      hasCurrentWitness: !!this.currentWitness,
      lastQSpeaker: this.lastQSpeaker ? (this.lastQSpeaker as any).speakerPrefix || 'none' : 'none'
    })}`);
    return null;
  }

  resolveTheAttorney(): SpeakerWithRelations | null {
    // In video depositions, "THE ATTORNEY" typically refers to opposing counsel
    // (not the one asking questions)
    
    if (this.opposingAttorney?.speaker) {
      return this.opposingAttorney.speaker;
    }
    
    // If we don't have a specific opposing attorney, we might need to
    // create a generic one or look for context clues
    logger.warn('Unable to resolve THE ATTORNEY - no opposing attorney set');
    return null;
  }
  
  // Check if we're currently in witness examination context
  isInExamination(): boolean {
    // We're in examination if:
    // 1. We have a current witness being examined
    // 2. We have an examination type set
    // 3. We have an examining attorney
    return this.currentWitness !== null && 
           this.examinationType !== null &&
           this.examiningAttorney !== null;
  }

  private async handleWitnessCall(
    witnessName: string,
    callerText: string
  ): Promise<void> {
    const caller: WitnessCaller = callerText.includes('PLAINTIFF') ? 
      'PLAINTIFF' : 'DEFENDANT';
    
    // Track who called the witness for generic attribution
    this.witnessCalledBy = caller === 'PLAINTIFF' ? 'plaintiff' : 'defense';
    
    // Clean up witness name
    const cleanName = witnessName
      .replace(/\s+/g, ' ')
      .trim();
    
    logger.info(`Witness called: ${cleanName} (${caller}'s witness)`);
    
    // Try to find existing witness speaker
    const witnessSpeaker = await this.speakerRegistry.findOrCreateSpeaker(
      cleanName,
      'WITNESS'
    );
    
    this.currentWitness = {
      name: cleanName,
      caller: caller,
      speaker: witnessSpeaker,
      swornStatus: 'NOT_SWORN'
    };
    
    // Update registry
    this.speakerRegistry.setCurrentWitness(witnessSpeaker);
  }

  private async handleByAttorney(
    title: string,
    lastName: string
  ): Promise<void> {
    const cleanLastName = lastName.trim().replace(/:\s*$/, '');
    
    logger.info(`Examining attorney set: ${title} ${cleanLastName}`);
    
    // Try to find attorney by name
    const attorneySpeaker = await this.speakerRegistry.findSpeakerByAttorneyName(cleanLastName);
    
    if (!attorneySpeaker) {
      // Create new attorney speaker if not found
      const speakerPrefix = `${title} ${cleanLastName}`;
      const newSpeaker = await this.speakerRegistry.findOrCreateSpeaker(
        speakerPrefix,
        'ATTORNEY'
      );
      
      this.examiningAttorney = {
        title: title,
        lastName: cleanLastName,
        fullName: speakerPrefix,
        speaker: newSpeaker
      };
    } else {
      this.examiningAttorney = {
        title: title,
        lastName: cleanLastName,
        speaker: attorneySpeaker || undefined
      };
    }
    
    // Update registry
    if (this.examiningAttorney.speaker) {
      this.speakerRegistry.setExaminingAttorney(this.examiningAttorney.speaker);
    }
    
    // In cross-examination, the examining attorney might be from the opposing side
    if (this.examinationType === 'CROSS' && this.currentWitness) {
      // The cross-examining attorney is from the opposite side
      const isOpposing = this.currentWitness.caller === 'DEFENDANT';
      
      if (isOpposing && this.opposingAttorney?.speaker !== this.examiningAttorney.speaker) {
        this.opposingAttorney = this.examiningAttorney;
        if (this.opposingAttorney.speaker) {
          this.speakerRegistry.setOpposingAttorney(this.opposingAttorney.speaker);
        }
      }
    }
  }

  // Getters for current context
  getCurrentWitness(): WitnessInfo | null {
    return this.currentWitness;
  }

  getExaminingAttorney(): AttorneyInfo | null {
    return this.examiningAttorney;
  }

  /**
   * Set examining attorney directly (used when BY MR./MS. line is detected)
   */
  setExaminingAttorneyFromSpeaker(speaker: any): void {
    logger.debug(`Setting examining attorney from speaker: ${speaker.speakerPrefix}`);
    
    // Extract attorney info from speaker
    const match = speaker.speakerPrefix.match(/^(MR\.|MS\.|MRS\.|DR\.)\s+(.+)$/);
    if (match) {
      this.examiningAttorney = {
        title: match[1],
        lastName: match[2],
        speaker: speaker
      };
      
      // Also update the lastQSpeaker
      this.lastQSpeaker = speaker;
      
      // Update registry
      if (speaker) {
        this.speakerRegistry.setExaminingAttorney(speaker);
      }
      
      logger.debug(`Examining attorney set to: ${speaker.speakerPrefix}`);
    }
  }

  /**
   * Set current witness directly (used when witness is identified in Phase2)
   */
  setCurrentWitnessFromSpeaker(speaker: any, witnessName: string, caller: 'PLAINTIFF' | 'DEFENDANT'): void {
    logger.debug(`Setting current witness from speaker: ${speaker.speakerPrefix}, name: ${witnessName}`);
    
    this.currentWitness = {
      name: witnessName,
      caller: caller === 'PLAINTIFF' ? 'PLAINTIFF' : 'DEFENDANT',
      speaker: speaker,
      swornStatus: 'NOT_SWORN'
    };
    
    // Also update the witness caller for examiner side determination
    this.witnessCalledBy = caller.toLowerCase() as 'plaintiff' | 'defense';
    
    // Update registry
    if (speaker) {
      this.speakerRegistry.setCurrentWitness(speaker);
    }
    
    logger.debug(`Current witness set to: ${witnessName}`);
  }

  getOpposingAttorney(): AttorneyInfo | null {
    return this.opposingAttorney;
  }

  getExaminationType(): ExaminationType | null {
    return this.examinationType;
  }
  
  /**
   * Set examination type directly (used when examination type is identified in Phase2)
   */
  setExaminationType(type: ExaminationType | null): void {
    this.examinationType = type;
    logger.debug(`Examination type set to: ${type}`);
  }

  isInVideoDeposition(): boolean {
    return this.isVideoDeposition;
  }

  // Reset context (e.g., at session boundaries)
  reset(): void {
    this.currentWitness = null;
    this.examiningAttorney = null;
    this.opposingAttorney = null;
    this.examinationType = null;
    this.isVideoDeposition = false;
    this.lastQSpeaker = null;
    
    logger.debug('Examination context reset');
  }

  // Get context summary for debugging
  getContextSummary(): string {
    return JSON.stringify({
      witness: this.currentWitness?.name || 'none',
      examiningAttorney: this.examiningAttorney?.fullName || 'none',
      opposingAttorney: this.opposingAttorney?.fullName || 'none',
      examinationType: this.examinationType || 'none',
      isVideoDeposition: this.isVideoDeposition,
      witnessCalledBy: this.witnessCalledBy || 'none',
      usingGenericFallback: this.usingGenericFallback,
      lastSpecificAttorney: this.lastSpecificAttorney?.fullName || 'none'
    });
  }
  
  // Get current examination state (Feature 02P)
  getExaminationState(): ExaminationState {
    return {
      currentWitness: this.currentWitness,
      currentExaminer: this.examiningAttorney,
      examinationType: this.examinationType,
      witnessCalledBy: this.witnessCalledBy,
      lastSpecificAttorney: this.lastSpecificAttorney,
      usingGenericFallback: this.usingGenericFallback
    };
  }
  
  isUsingGenericFallback(): boolean {
    return this.usingGenericFallback;
  }
}