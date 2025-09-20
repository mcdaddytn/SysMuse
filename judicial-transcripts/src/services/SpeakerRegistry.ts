import { PrismaClient, Speaker, Attorney, Witness, Judge, Juror, SpeakerType } from '@prisma/client';
import logger from '../utils/logger';

export interface SpeakerWithRelations extends Speaker {
  trialAttorneys?: ({
    attorney: Attorney;
  })[];
  witness?: Witness | null;
  judge?: Judge | null;
  juror?: Juror | null;
}

export class SpeakerRegistry {
  private trialId: number;
  private speakers: Map<string, SpeakerWithRelations> = new Map();
  private attorneysByName: Map<string, Attorney> = new Map();
  private attorneysByLastName: Map<string, Attorney> = new Map();
  private attorneysByHandle: Map<string, SpeakerWithRelations> = new Map();
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
    
    logger.debug(`[SPEAKER_REGISTRY_INIT] Loading ${speakers.length} speakers for trial ${this.trialId}`);
    
    // Build lookup maps
    for (const speaker of speakers) {
      // Add to main speaker map
      this.speakers.set(speaker.speakerPrefix, speaker);
      this.speakers.set(speaker.speakerHandle, speaker);
      
      logger.debug(`[SPEAKER_REGISTRY_INIT]   Speaker ID=${speaker.id}: Prefix="${speaker.speakerPrefix}", Handle="${speaker.speakerHandle}", Type=${speaker.speakerType}`);
      
      // Special handling for THE COURT
      if (speaker.speakerType === 'JUDGE' || speaker.speakerPrefix === 'THE COURT') {
        this.theCourt = speaker;
        this.contextualSpeakers.set('THE COURT', speaker);
      }
      
      // Build attorney lookup maps
      if (speaker.trialAttorneys && speaker.trialAttorneys.length > 0) {
        // Get the attorney from the TrialAttorney relation
        const attorney = speaker.trialAttorneys[0].attorney;
        
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
          this.attorneysByHandle.set(attorney.speakerPrefix.toUpperCase(), speaker);
        }
        
        // Also register common handle formats
        if (attorney.title && attorney.lastName) {
          const handle = `${attorney.title} ${attorney.lastName}`.toUpperCase();
          this.attorneysByHandle.set(handle, speaker);
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
    
    logger.debug(`[SPEAKER_REGISTRY] findOrCreateSpeaker called with prefix: "${prefix}" (normalized: "${normalizedPrefix}"), type: ${type}`);
    
    // Check cache first
    if (this.speakers.has(normalizedPrefix)) {
      const cached = this.speakers.get(normalizedPrefix)!;
      logger.debug(`[SPEAKER_REGISTRY]   Found in cache: ID=${cached.id}, Handle="${cached.speakerHandle}"`);
      return cached;
    }
    
    // Check contextual speakers
    if (this.contextualSpeakers.has(normalizedPrefix)) {
      const contextual = this.contextualSpeakers.get(normalizedPrefix)!;
      logger.debug(`[SPEAKER_REGISTRY]   Found in contextual speakers: ID=${contextual.id}, Handle="${contextual.speakerHandle}"`);
      return contextual;
    }
    
    logger.debug(`[SPEAKER_REGISTRY]   Not in cache, searching database for trialId=${this.trialId}, prefix="${normalizedPrefix}" OR handle="${this.normalizeHandle(normalizedPrefix)}"`);
    
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
        trialAttorneys: {
          include: {
            attorney: true
          }
        },
        witness: true,
        judge: true,
        juror: true
      }
    }) as SpeakerWithRelations | null;
    
    if (speaker) {
      logger.debug(`[SPEAKER_REGISTRY]   Found existing speaker in DB: ID=${speaker.id}, Prefix="${speaker.speakerPrefix}", Handle="${speaker.speakerHandle}", Type=${speaker.speakerType}`);
    } else {
      logger.debug(`[SPEAKER_REGISTRY]   NOT FOUND in database - will create new speaker`);
      
      // Infer type if not provided
      if (type === 'UNKNOWN') {
        type = this.inferSpeakerType(normalizedPrefix);
        logger.debug(`[SPEAKER_REGISTRY]   Inferred type: ${type}`);
      }
      
      // Create new speaker
      speaker = await this.createSpeaker(normalizedPrefix, type);
      logger.debug(`[SPEAKER_REGISTRY]   Created new speaker: ID=${speaker.id}, Handle="${speaker.speakerHandle}"`);
    }
    
    // Cache the speaker
    this.speakers.set(normalizedPrefix, speaker);
    logger.debug(`[SPEAKER_REGISTRY]   Added to cache with key: "${normalizedPrefix}"`);
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
        trialAttorneys: {
          some: {
            attorneyId: attorney.id
          }
        }
      },
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
    
    return speaker as SpeakerWithRelations | null;
  }

  setCurrentWitness(witness: SpeakerWithRelations | null): void {
    logger.debug(`[SPEAKER_DIAGNOSTIC] SpeakerRegistry.setCurrentWitness called`);
    if (witness) {
      logger.debug(`[SPEAKER_DIAGNOSTIC]   Setting witness: ${witness.speakerHandle} (ID: ${witness.id})`);
      logger.debug(`[SPEAKER_DIAGNOSTIC]   Witness details: ${witness.witness?.displayName || witness.witness?.name || 'NO_WITNESS_RECORD'}`);
      this.currentWitness = witness;
      this.contextualSpeakers.set('THE WITNESS', witness);
      this.contextualSpeakers.set('A', witness);
      this.contextualSpeakers.set('A.', witness);
      this.contextualSpeakers.set('ANSWER', witness);
      this.contextualSpeakers.set('THE DEPONENT', witness);
      logger.debug(`[SPEAKER_DIAGNOSTIC]   Updated contextual speakers: A, A., THE WITNESS, ANSWER, THE DEPONENT now map to witness ${witness.id}`);
    } else {
      logger.debug(`[SPEAKER_DIAGNOSTIC]   Clearing witness context (setting to null)`);
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
    
    // DIAGNOSTIC: Log what's in the contextual map
    logger.debug(`[SPEAKER_DIAGNOSTIC] resolveContextualSpeaker called with prefix: "${prefix}" (normalized: "${normalized}")`);
    logger.debug(`[SPEAKER_DIAGNOSTIC]   Contextual speakers map contains:`);
    for (const [key, value] of this.contextualSpeakers.entries()) {
      logger.debug(`[SPEAKER_DIAGNOSTIC]     "${key}" => ${value.speakerHandle} (ID: ${value.id}, Type: ${value.speakerType})`);
    }
    
    // Check Q&A formats
    if (normalized === 'Q' || normalized === 'Q.' || normalized === 'QUESTION:' || normalized === 'QUESTION') {
      const speaker = this.contextualSpeakers.get('Q') || null;
      if (speaker) {
        logger.debug(`[SPEAKER_DIAGNOSTIC]   Resolved Q to: ${speaker.speakerHandle} (ID: ${speaker.id})`);
      }
      return speaker;
    }
    
    if (normalized === 'A' || normalized === 'A.' || normalized === 'ANSWER:' || normalized === 'ANSWER') {
      const speaker = this.contextualSpeakers.get('A') || null;
      if (speaker) {
        logger.debug(`[SPEAKER_DIAGNOSTIC]   Resolved A to: ${speaker.speakerHandle} (ID: ${speaker.id})`);
      }
      return speaker;
    }
    
    // Check other contextual speakers
    const speaker = this.contextualSpeakers.get(normalized);
    if (speaker) {
      logger.debug(`[SPEAKER_DIAGNOSTIC]   Found "${normalized}" in contextual map => ${speaker.speakerHandle} (ID: ${speaker.id}, Type: ${speaker.speakerType})`);
    } else {
      logger.debug(`[SPEAKER_DIAGNOSTIC]   "${normalized}" NOT found in contextual speakers map`);
    }
    return speaker || null;
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
    } else if (type === 'JUROR') {
      // Parse juror information from speaker prefix
      let lastName: string | undefined;
      let name: string | undefined;
      let jurorNumber: number | undefined;
      
      // Match patterns like "JUROR BANKS" or "JUROR 40"
      const jurorMatch = prefix.match(/^JUROR\s+(.+)$/i);
      if (jurorMatch) {
        const identifier = jurorMatch[1];
        
        // Check if it's a number
        const numberMatch = identifier.match(/^\d+$/);
        if (numberMatch) {
          jurorNumber = parseInt(numberMatch[0]);
        } else {
          // It's a name
          lastName = identifier.toUpperCase();
          name = identifier;
        }
      }
      
      // Create the Juror record
      await this.prisma.juror.create({
        data: {
          trialId: this.trialId,
          speakerId: speaker.id,
          name,
          lastName,
          jurorNumber,
          alias: lastName ? `MR. ${lastName}` : undefined
        }
      });
      
      logger.info(`Created Juror record for ${prefix} with speakerId=${speaker.id}`);
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
  // Register an attorney handle for strict matching
  async registerAttorney(handle: string, fullName: string): Promise<void> {
    const upperHandle = handle.toUpperCase();
    const attorney = await this.findAttorneyByName(fullName);
    
    if (attorney) {
      const speaker = await this.findSpeakerByAttorneyName(fullName);
      if (speaker) {
        this.attorneysByHandle.set(upperHandle, speaker);
        this.speakers.set(upperHandle, speaker);
      }
    }
  }
  
  // Find attorney by exact handle match (e.g., "MR. SMITH")
  findAttorneyByHandle(handle: string): SpeakerWithRelations | null {
    const upperHandle = handle.toUpperCase();
    return this.attorneysByHandle.get(upperHandle) || null;
  }
  
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