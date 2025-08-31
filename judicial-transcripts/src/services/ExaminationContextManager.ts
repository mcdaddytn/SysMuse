import { SpeakerWithRelations, SpeakerRegistry } from './SpeakerRegistry';
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

export class ExaminationContextManager {
  private currentWitness: WitnessInfo | null = null;
  private examiningAttorney: AttorneyInfo | null = null;
  private opposingAttorney: AttorneyInfo | null = null;
  private examinationType: ExaminationType | null = null;
  private isVideoDeposition: boolean = false;
  private lastQSpeaker: SpeakerWithRelations | null = null;
  private speakerRegistry: SpeakerRegistry;

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

  constructor(speakerRegistry: SpeakerRegistry) {
    this.speakerRegistry = speakerRegistry;
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
      return this.examiningAttorney.speaker;
    }
    
    // Fallback to last Q speaker if we have one
    if (this.lastQSpeaker) {
      return this.lastQSpeaker;
    }
    
    logger.warn('Unable to resolve Q speaker - no examining attorney set');
    return null;
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
    
    logger.warn('Unable to resolve A speaker - no current witness');
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

  private async handleWitnessCall(
    witnessName: string,
    callerText: string
  ): Promise<void> {
    const caller: WitnessCaller = callerText.includes('PLAINTIFF') ? 
      'PLAINTIFF' : 'DEFENDANT';
    
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

  getOpposingAttorney(): AttorneyInfo | null {
    return this.opposingAttorney;
  }

  getExaminationType(): ExaminationType | null {
    return this.examinationType;
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
      isVideoDeposition: this.isVideoDeposition
    });
  }
}