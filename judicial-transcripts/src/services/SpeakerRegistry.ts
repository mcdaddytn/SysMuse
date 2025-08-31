import { PrismaClient, Speaker, Attorney, Witness, Judge, Juror, SpeakerType } from '@prisma/client';
import logger from '../utils/logger';

export interface SpeakerWithRelations extends Speaker {
  attorney?: Attorney | null;
  witness?: Witness | null;
  judge?: Judge | null;
  juror?: Juror | null;
}

export class SpeakerRegistry {
  private trialId: number;
  private speakers: Map<string, SpeakerWithRelations> = new Map();
  private attorneysByName: Map<string, Attorney> = new Map();
  private attorneysByLastName: Map<string, Attorney> = new Map();
  private contextualSpeakers: Map<string, SpeakerWithRelations> = new Map();
  private theCourt: SpeakerWithRelations | null = null;
  private currentWitness: SpeakerWithRelations | null = null;

  constructor(
    private prisma: PrismaClient,
    trialId: number
  ) {
    this.trialId = trialId;
  }

  async initialize(): Promise<void> {
    logger.info(`Initializing SpeakerRegistry for trial ${this.trialId}`);
    
    // Load all speakers for this trial
    const speakers = await this.prisma.speaker.findMany({
      where: { trialId: this.trialId },
      include: {
        attorney: true,
        witness: true,
        judge: true,
        juror: true
      }
    });
    
    // Build lookup maps
    for (const speaker of speakers) {
      // Add to main speaker map
      this.speakers.set(speaker.speakerPrefix, speaker);
      this.speakers.set(speaker.speakerHandle, speaker);
      
      // Special handling for THE COURT
      if (speaker.speakerType === 'JUDGE' || speaker.speakerPrefix === 'THE COURT') {
        this.theCourt = speaker;
        this.contextualSpeakers.set('THE COURT', speaker);
      }
      
      // Build attorney lookup maps
      if (speaker.attorney) {
        const attorney = speaker.attorney;
        
        // Full name lookup
        this.attorneysByName.set(attorney.name.toUpperCase(), attorney);
        
        // Last name lookup
        if (attorney.lastName) {
          this.attorneysByLastName.set(attorney.lastName.toUpperCase(), attorney);
        } else {
          // Try to extract last name from full name
          const lastName = this.extractLastName(attorney.name);
          if (lastName) {
            this.attorneysByLastName.set(lastName.toUpperCase(), attorney);
          }
        }
        
        // Add speaker prefix variations
        if (attorney.speakerPrefix) {
          this.speakers.set(attorney.speakerPrefix, speaker);
        }
      }
      
      // Build witness lookup
      if (speaker.witness) {
        // We'll set current witness during examination
        if (speaker.witness.displayName) {
          this.speakers.set(speaker.witness.displayName, speaker);
        }
      }
      
      // Build juror lookup
      if (speaker.juror) {
        const juror = speaker.juror;
        if (juror.jurorNumber) {
          this.speakers.set(`JUROR NO. ${juror.jurorNumber}`, speaker);
          this.speakers.set(`JUROR ${juror.jurorNumber}`, speaker);
        }
      }
    }
    
    logger.info(`SpeakerRegistry initialized with ${speakers.length} speakers`);
  }

  async findOrCreateSpeaker(
    prefix: string,
    type: SpeakerType = 'UNKNOWN'
  ): Promise<SpeakerWithRelations> {
    const normalizedPrefix = prefix.trim();
    
    // Check cache first
    if (this.speakers.has(normalizedPrefix)) {
      return this.speakers.get(normalizedPrefix)!;
    }
    
    // Check contextual speakers
    if (this.contextualSpeakers.has(normalizedPrefix)) {
      return this.contextualSpeakers.get(normalizedPrefix)!;
    }
    
    // Try to find in database
    let speaker = await this.prisma.speaker.findFirst({
      where: {
        trialId: this.trialId,
        OR: [
          { speakerPrefix: normalizedPrefix },
          { speakerHandle: this.normalizeHandle(normalizedPrefix) }
        ]
      },
      include: {
        attorney: true,
        witness: true,
        judge: true,
        juror: true
      }
    }) as SpeakerWithRelations | null;
    
    if (!speaker) {
      // Infer type if not provided
      if (type === 'UNKNOWN') {
        type = this.inferSpeakerType(normalizedPrefix);
      }
      
      // Create new speaker
      speaker = await this.createSpeaker(normalizedPrefix, type);
    }
    
    // Cache the speaker
    this.speakers.set(normalizedPrefix, speaker);
    return speaker;
  }

  async findAttorneyByName(name: string): Promise<Attorney | null> {
    const upperName = name.toUpperCase();
    
    // Try full name first
    if (this.attorneysByName.has(upperName)) {
      return this.attorneysByName.get(upperName)!;
    }
    
    // Try last name
    if (this.attorneysByLastName.has(upperName)) {
      return this.attorneysByLastName.get(upperName)!;
    }
    
    // Try database lookup
    const attorney = await this.prisma.attorney.findFirst({
      where: {
        trialAttorneys: {
          some: { trialId: this.trialId }
        },
        OR: [
          { name: { contains: name, mode: 'insensitive' } },
          { lastName: { equals: name, mode: 'insensitive' } }
        ]
      }
    });
    
    if (attorney) {
      // Cache for future lookups
      this.attorneysByName.set(attorney.name.toUpperCase(), attorney);
      if (attorney.lastName) {
        this.attorneysByLastName.set(attorney.lastName.toUpperCase(), attorney);
      }
    }
    
    return attorney;
  }

  async findSpeakerByAttorneyName(name: string): Promise<SpeakerWithRelations | null> {
    const attorney = await this.findAttorneyByName(name);
    if (!attorney) return null;
    
    // Find the speaker associated with this attorney
    const speaker = await this.prisma.speaker.findFirst({
      where: {
        trialId: this.trialId,
        attorney: { id: attorney.id }
      },
      include: {
        attorney: true,
        witness: true,
        judge: true,
        juror: true
      }
    });
    
    return speaker as SpeakerWithRelations | null;
  }

  setCurrentWitness(witness: SpeakerWithRelations | null): void {
    if (witness) {
      this.currentWitness = witness;
      this.contextualSpeakers.set('THE WITNESS', witness);
      this.contextualSpeakers.set('A', witness);
      this.contextualSpeakers.set('A.', witness);
      this.contextualSpeakers.set('ANSWER', witness);
      this.contextualSpeakers.set('THE DEPONENT', witness);
    } else {
      this.currentWitness = null;
    }
  }

  getCurrentWitness(): SpeakerWithRelations | null {
    return this.currentWitness;
  }

  setExaminingAttorney(attorney: SpeakerWithRelations | null): void {
    if (attorney) {
      this.contextualSpeakers.set('Q', attorney);
      this.contextualSpeakers.set('Q.', attorney);
      this.contextualSpeakers.set('QUESTION', attorney);
    }
  }

  setOpposingAttorney(attorney: SpeakerWithRelations | null): void {
    if (attorney) {
      this.contextualSpeakers.set('THE ATTORNEY', attorney);
    }
  }

  resolveContextualSpeaker(prefix: string): SpeakerWithRelations | null {
    const normalized = prefix.trim().toUpperCase();
    
    // Check Q&A formats
    if (normalized === 'Q' || normalized === 'Q.' || normalized === 'QUESTION:' || normalized === 'QUESTION') {
      return this.contextualSpeakers.get('Q') || null;
    }
    
    if (normalized === 'A' || normalized === 'A.' || normalized === 'ANSWER:' || normalized === 'ANSWER') {
      return this.contextualSpeakers.get('A') || null;
    }
    
    // Check other contextual speakers
    return this.contextualSpeakers.get(normalized) || null;
  }

  getTheCourt(): SpeakerWithRelations | null {
    return this.theCourt;
  }

  private async createSpeaker(
    prefix: string,
    type: SpeakerType
  ): Promise<SpeakerWithRelations> {
    const handle = this.normalizeHandle(prefix);
    
    logger.info(`Creating new speaker: ${prefix} (${type}) for trial ${this.trialId}`);
    
    const speaker = await this.prisma.speaker.create({
      data: {
        trialId: this.trialId,
        speakerPrefix: prefix,
        speakerHandle: handle,
        speakerType: type
      },
      include: {
        attorney: true,
        witness: true,
        judge: true,
        juror: true
      }
    });
    
    // Create associated record based on type
    if (type === 'ANONYMOUS' || type === 'UNKNOWN') {
      await this.prisma.anonymousSpeaker.create({
        data: {
          trialId: this.trialId,
          speakerId: speaker.id,
          role: prefix,
          description: `Unidentified speaker: ${prefix}`
        }
      });
    }
    
    return speaker;
  }

  private normalizeHandle(prefix: string): string {
    return prefix
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '');
  }

  private inferSpeakerType(prefix: string): SpeakerType {
    const upper = prefix.toUpperCase();
    
    if (upper === 'THE COURT') return 'JUDGE';
    if (upper.includes('JUDGE')) return 'JUDGE';
    if (upper.includes('JUROR')) return 'JUROR';
    if (upper === 'THE WITNESS' || upper === 'THE DEPONENT') return 'WITNESS';
    if (upper === 'THE CLERK' || upper === 'THE BAILIFF') return 'COURT_STAFF';
    if (upper.match(/^(MR\.|MS\.|MRS\.|DR\.)/)) return 'ATTORNEY';
    if (upper === 'Q' || upper === 'Q.' || upper === 'QUESTION') return 'ATTORNEY';
    if (upper === 'A' || upper === 'A.' || upper === 'ANSWER') return 'WITNESS';
    
    return 'UNKNOWN';
  }

  private extractLastName(fullName: string): string | null {
    const parts = fullName.trim().split(/\s+/);
    if (parts.length === 0) return null;
    
    // Remove common suffixes
    const lastPart = parts[parts.length - 1];
    if (['JR', 'JR.', 'SR', 'SR.', 'III', 'II', 'IV'].includes(lastPart.toUpperCase())) {
      return parts.length > 1 ? parts[parts.length - 2] : null;
    }
    
    return lastPart;
  }

  // Get statistics about speakers in registry
  getStatistics(): {
    total: number;
    byType: Record<string, number>;
    unmatched: string[];
  } {
    const stats = {
      total: this.speakers.size,
      byType: {} as Record<string, number>,
      unmatched: [] as string[]
    };
    
    for (const speaker of this.speakers.values()) {
      const type = speaker.speakerType;
      stats.byType[type] = (stats.byType[type] || 0) + 1;
      
      if (type === 'UNKNOWN' || type === 'ANONYMOUS') {
        stats.unmatched.push(speaker.speakerPrefix);
      }
    }
    
    return stats;
  }
}