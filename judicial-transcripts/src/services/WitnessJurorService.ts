// src/services/WitnessJurorService.ts
import { PrismaClient } from '@prisma/client';
import { WitnessInfo, JurorInfo } from '../types/config.types';
import logger from '../utils/logger';

export class WitnessJurorService {
  private prisma: PrismaClient;
  private currentWitness: WitnessInfo | null = null;
  private jurorAliasMap: Map<string, number> = new Map();

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  /**
   * Parse witness called text to extract details
   */
  parseWitnessCalledText(rawText: string): {
    name?: string;
    witnessCaller?: 'PLAINTIFF' | 'DEFENDANT';
    witnessType?: any;
    swornStatus: any;
    continued: boolean;
    presentedByVideo: boolean;
    examinationType?: any;
  } {
    let name: string | undefined;
    let witnessCaller: 'PLAINTIFF' | 'DEFENDANT' | undefined;
    let witnessType: any = null;
    let swornStatus: any = 'NOT_SWORN';
    let continued = false;
    let presentedByVideo = false;
    let examinationType: any = null;
    
    // Split into lines for processing
    const lines = rawText.split('\n').map(l => l.trim()).filter(l => l);
    
    for (const line of lines) {
      // Parse witness name and caller
      const nameMatch = line.match(/^([A-Z][A-Z\s,'"\.\-]+?),?\s+(PLAINTIFF'S?|DEFENDANT'S?)\s+WITNESS/i);
      if (nameMatch) {
        name = nameMatch[1].trim();
        witnessCaller = nameMatch[2].toUpperCase().includes('PLAINTIFF') ? 'PLAINTIFF' : 'DEFENDANT';
        
        // Check for expert witness
        if (line.includes('PH.D.') || line.includes('DR.')) {
          witnessType = 'EXPERT_WITNESS';
        }
      }
      
      // Parse sworn status
      if (line.match(/\bPREVIOUSLY\s+SWORN\b/i)) {
        swornStatus = 'PREVIOUSLY_SWORN';
      } else if (line.match(/\bSWORN\b/i) && !line.match(/\bPREVIOUSLY\s+SWORN\b/i)) {
        swornStatus = 'SWORN';
      }
      
      // Parse examination type
      if (line.match(/DIRECT[\s\-]?EXAMINATION/i)) {
        examinationType = 'DIRECT_EXAMINATION';
      } else if (line.match(/CROSS[\s\-]?EXAMINATION/i)) {
        examinationType = 'CROSS_EXAMINATION';
      } else if (line.match(/REDIRECT[\s\-]?EXAMINATION/i)) {
        examinationType = 'REDIRECT_EXAMINATION';
      } else if (line.match(/RECROSS[\s\-]?EXAMINATION/i)) {
        examinationType = 'RECROSS_EXAMINATION';
      } else if (line.match(/VIDEO\s+DEPOSITION/i)) {
        examinationType = 'VIDEO_DEPOSITION';
        presentedByVideo = true;
      }
      
      // Check for continued
      if (line.match(/\bCONTINUED\b/i)) {
        continued = true;
      }
      
      // Check for video presentation
      if (line.match(/PRESENTED\s+BY\s+VIDEO/i)) {
        presentedByVideo = true;
      }
    }
    
    return {
      name,
      witnessCaller,
      witnessType,
      swornStatus,
      continued,
      presentedByVideo,
      examinationType
    };
  }

  /**
   * Create or find witness and create witness called event
   */
  async createWitnessCalledEvent(
    trialId: number,
    eventId: number,
    rawText: string
  ): Promise<void> {
    try {
      const parsed = this.parseWitnessCalledText(rawText);
      
      let witness: any;
      
      // If continuing examination and no name provided, use current witness
      if (!parsed.name && parsed.continued && this.currentWitness) {
        witness = await this.prisma.witness.findUnique({
          where: { id: this.currentWitness.id }
        });
        logger.info(`Continuing examination for witness: ${this.currentWitness.name}`);
      } else if (parsed.name) {
        // Create speaker for witness with handle
        const speakerPrefix = 'A.'; // Witnesses typically respond with "A."
        const speakerHandle = `WITNESS_${parsed.name.replace(/[^A-Z0-9]/gi, '_').toUpperCase()}`;
        
        let speaker = await this.prisma.speaker.findFirst({
          where: {
            trialId,
            speakerHandle  // Use handle for uniqueness
          }
        });
        
        if (!speaker) {
          speaker = await this.prisma.speaker.create({
            data: {
              trialId,
              speakerPrefix,
              speakerHandle,  // Add the required speakerHandle
              speakerType: 'WITNESS'
            }
          });
        }
        
        // Find or create witness
        witness = await this.prisma.witness.findFirst({
          where: {
            trialId,
            name: parsed.name
          }
        });
        
        if (!witness) {
          witness = await this.prisma.witness.create({
            data: {
              trialId,
              name: parsed.name,
              witnessType: parsed.witnessType,
              witnessCaller: parsed.witnessCaller,
              speakerId: speaker.id
            }
          });
          logger.info(`Created witness: ${parsed.name}`);
        }
        
        // Update current witness context
        this.currentWitness = {
          id: witness.id,
          name: witness.name,
          witnessType: witness.witnessType,
          witnessCaller: witness.witnessCaller,
          speakerId: witness.speakerId
        };
      }
      
      // Create witness called event
      if (witness && parsed.examinationType) {
        await this.prisma.witnessCalledEvent.create({
          data: {
            eventId,
            witnessId: witness.id,
            examinationType: parsed.examinationType,
            swornStatus: parsed.swornStatus,
            continued: parsed.continued,
            presentedByVideo: parsed.presentedByVideo
          }
        });
        
        logger.info(`Created witness called event: ${witness.name} - ${parsed.examinationType}`);
      } else {
        logger.warn(`Could not create witness called event - missing witness or examination type`);
      }
      
    } catch (error) {
      logger.error(`Error creating witness called event: ${error}`);
      throw error;
    }
  }

  /**
   * Create or find juror
   */
  async createOrFindJuror(
    trialId: number,
    speakerPrefix: string,
    fullText?: string
  ): Promise<JurorInfo> {
    try {
      logger.info(`createOrFindJuror called with trialId=${trialId}, speakerPrefix="${speakerPrefix}"`);
      
      // Parse juror information from speaker prefix
      let name: string | undefined;
      let lastName: string | undefined;
      let jurorNumber: number | undefined;
      
      // Special handling for THE FOREPERSON
      if (speakerPrefix.toUpperCase() === 'THE FOREPERSON') {
        name = 'THE';
        lastName = 'FOREPERSON';
        // No juror number for foreperson
      } else {
        // Match patterns like "JUROR RAGSDALE" or "JUROR 40"
        const jurorMatch = speakerPrefix.match(/^JUROR\s+(.+)$/i);
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
      }
      
      // Try to extract more info from full text if available
      if (fullText && lastName) {
        // Look for full name in the text
        const nameMatch = fullText.match(new RegExp(`(\\w+\\s+)?${lastName}`, 'i'));
        if (nameMatch && nameMatch[1]) {
          name = `${nameMatch[1].trim()} ${lastName}`;
        }
      }
      
      // Create speaker for juror with handle
      const speakerHandle = `JUROR_${(lastName || jurorNumber || 'UNKNOWN').toString().replace(/[^A-Z0-9]/gi, '_').toUpperCase()}`;
      
      let speaker = await this.prisma.speaker.findFirst({
        where: {
          trialId,
          speakerHandle  // Use handle for uniqueness
        }
      });
      
      if (!speaker) {
        speaker = await this.prisma.speaker.create({
          data: {
            trialId,
            speakerPrefix: speakerPrefix.toUpperCase(),
            speakerHandle,  // Add the required speakerHandle
            speakerType: 'JUROR'
          }
        });
      }
      
      // Find or create juror
      let juror = await this.prisma.juror.findFirst({
        where: {
          trialId,
          OR: [
            { speakerId: speaker.id },
            { lastName: lastName || undefined },
            { jurorNumber: jurorNumber || undefined }
          ]
        }
      });
      
      if (juror) {
        logger.info(`Found existing juror with id=${juror.id} for ${speakerPrefix}`);
      }
      
      if (!juror) {
        // Set alias based on speaker type
        let alias: string | undefined;
        if (speakerPrefix.toUpperCase() === 'THE FOREPERSON') {
          alias = 'THE FOREPERSON';
        } else if (lastName) {
          alias = `MR. ${lastName}`;
        }
        
        logger.info(`Creating new Juror record for ${speakerPrefix} with speakerId=${speaker.id}, name=${name}, lastName=${lastName}, jurorNumber=${jurorNumber}`);
        juror = await this.prisma.juror.create({
          data: {
            trialId,
            speakerId: speaker.id,
            name,
            lastName,
            jurorNumber,
            alias
          }
        });
        
        logger.info(`Successfully created juror: ${speakerPrefix} with id=${juror.id}`);
        
        // Add to alias map if we have a last name
        if (lastName) {
          this.jurorAliasMap.set(`MR. ${lastName}`, juror.id);
          this.jurorAliasMap.set(`MS. ${lastName}`, juror.id);
          this.jurorAliasMap.set(`MRS. ${lastName}`, juror.id);
        }
      }
      
      return {
        id: juror.id,
        name: juror.name || undefined,
        lastName: juror.lastName || undefined,
        jurorNumber: juror.jurorNumber || undefined,
        speakerPrefix: speakerPrefix.toUpperCase(),
        speakerId: speaker.id,  // Include speakerId
        alias: juror.alias || undefined
      };
      
    } catch (error) {
      logger.error(`Error creating/finding juror: ${error}`);
      throw error;
    }
  }

  /**
   * Try to match a speaker prefix to a juror using the alias workaround
   */
  async matchJurorByAlias(
    trialId: number,
    speakerPrefix: string
  ): Promise<JurorInfo | null> {
    // Check if this matches a known juror alias
    const jurorId = this.jurorAliasMap.get(speakerPrefix.toUpperCase());
    
    if (jurorId) {
      const juror = await this.prisma.juror.findUnique({
        where: { id: jurorId },
        include: { speaker: true }
      });
      
      if (juror) {
        logger.info(`Matched speaker ${speakerPrefix} to juror ${juror.name || juror.lastName}`);
        return {
          id: juror.id,
          name: juror.name || undefined,
          lastName: juror.lastName || undefined,
          jurorNumber: juror.jurorNumber || undefined,
          speakerPrefix: speakerPrefix.toUpperCase(),
          speakerId: juror.speaker?.id,
          alias: juror.alias || undefined
        };
      }
    }
    
    // Try database lookup as fallback
    const lastNameMatch = speakerPrefix.match(/^(?:MR\.|MS\.|MRS\.)\s+([A-Z]+)$/i);
    if (lastNameMatch) {
      const lastName = lastNameMatch[1].toUpperCase();
      
      const juror = await this.prisma.juror.findFirst({
        where: {
          trialId,
          lastName
        },
        include: { speaker: true }
      });
      
      if (juror) {
        // Add to alias map for future lookups
        this.jurorAliasMap.set(speakerPrefix.toUpperCase(), juror.id);
        
        logger.info(`Matched speaker ${speakerPrefix} to juror ${juror.name || juror.lastName} by last name`);
        return {
          id: juror.id,
          name: juror.name || undefined,
          lastName: juror.lastName || undefined,
          jurorNumber: juror.jurorNumber || undefined,
          speakerPrefix: speakerPrefix.toUpperCase(),
          speakerId: juror.speaker?.id,
          alias: juror.alias || undefined
        };
      }
    }
    
    return null;
  }

  /**
   * Get current witness
   */
  getCurrentWitness(): WitnessInfo | null {
    return this.currentWitness;
  }

  /**
   * Set current witness (for context tracking)
   */
  setCurrentWitness(witness: WitnessInfo | null): void {
    this.currentWitness = witness;
    if (witness) {
      logger.debug(`Set current witness: ${witness.name}`);
    }
  }

  /**
   * Create anonymous speaker
   */
  async createAnonymousSpeaker(
    trialId: number,
    speakerPrefix: string,
    role?: string
  ): Promise<number> {
    // Create handle for anonymous speaker
    const speakerHandle = `ANONYMOUS_${speakerPrefix.replace(/[^A-Z0-9]/gi, '_').toUpperCase()}`;
    
    // First check if speaker already exists using handle
    let speaker = await this.prisma.speaker.findFirst({
      where: {
        trialId,
        speakerHandle  // Use handle for lookup
      }
    });
    
    if (speaker) {
      // Speaker already exists, return its ID
      logger.debug(`Anonymous speaker already exists: ${speakerPrefix}`);
      return speaker.id;
    }
    
    // Create new speaker with handle
    speaker = await this.prisma.speaker.create({
      data: {
        trialId,
        speakerPrefix: speakerPrefix.toUpperCase(),
        speakerHandle,  // Add the required speakerHandle
        speakerType: 'ANONYMOUS'
      }
    });
    
    // Check if anonymous speaker record exists
    let anonymous = await this.prisma.anonymousSpeaker.findFirst({
      where: {
        trialId,
        speakerId: speaker.id
      }
    });
    
    if (!anonymous) {
      anonymous = await this.prisma.anonymousSpeaker.create({
        data: {
          trialId,
          speakerId: speaker.id,
          role: role || speakerPrefix,
          description: `Anonymous speaker with prefix: ${speakerPrefix}`
        }
      });
      
      logger.info(`Created anonymous speaker: ${speakerPrefix}`);
    }
    
    return speaker.id;
  }
}