import { PrismaClient, Speaker, Attorney, SpeakerType } from '@prisma/client';
import { TrialStyleConfig } from '../types/config.types';
import logger from '../utils/logger';

export interface GenericSpeakers {
  plaintiffAttorney: Speaker;
  defenseAttorney: Speaker;
}

export interface GenericAttribution {
  speakerId: number;
  originalSpeakerId?: number;
  isGeneric: boolean;
  side: 'plaintiff' | 'defense';
  confidence: number;
}

export class GenericSpeakerService {
  private prisma: PrismaClient;
  private genericSpeakers: Map<number, GenericSpeakers> = new Map();
  
  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }
  
  async createGenericSpeakers(
    trialId: number,
    config?: TrialStyleConfig
  ): Promise<GenericSpeakers> {
    // Check if we already have generic speakers for this trial
    const cached = this.genericSpeakers.get(trialId);
    if (cached) {
      return cached;
    }
    
    const plaintiffName = config?.genericFallbackConfig?.plaintiffGenericName || 'PLAINTIFF COUNSEL';
    const defenseName = config?.genericFallbackConfig?.defenseGenericName || 'DEFENSE COUNSEL';
    
    // Create generic plaintiff attorney
    const plaintiffAttorney = await this.prisma.speaker.create({
      data: {
        trialId,
        speakerPrefix: plaintiffName,
        speakerHandle: plaintiffName,
        speakerType: SpeakerType.ATTORNEY,
        isGeneric: true
      }
    });
    
    // Create generic defense attorney
    const defenseAttorney = await this.prisma.speaker.create({
      data: {
        trialId,
        speakerPrefix: defenseName,
        speakerHandle: defenseName,
        speakerType: SpeakerType.ATTORNEY,
        isGeneric: true
      }
    });
    
    // Also create Attorney records for them (without speakerId - that's now on TrialAttorney)
    await this.prisma.attorney.createMany({
      data: [
        {
          name: plaintiffName,
          attorneyFingerprint: `GENERIC_PLAINTIFF_${trialId}`
        },
        {
          name: defenseName,
          attorneyFingerprint: `GENERIC_DEFENSE_${trialId}`
        }
      ]
    });
    
    const result: GenericSpeakers = {
      plaintiffAttorney,
      defenseAttorney
    };
    
    this.genericSpeakers.set(trialId, result);
    
    logger.info(`Created generic speakers for trial ${trialId}: ${plaintiffName}, ${defenseName}`);
    
    return result;
  }
  
  async getGenericSpeakers(trialId: number): Promise<GenericSpeakers | null> {
    // Check cache first
    const cached = this.genericSpeakers.get(trialId);
    if (cached) {
      return cached;
    }
    
    // Query from database
    const speakers = await this.prisma.speaker.findMany({
      where: {
        trialId,
        isGeneric: true
      }
    });
    
    if (speakers.length !== 2) {
      return null;
    }
    
    // Find plaintiff and defense based on speakerHandle
    const plaintiffAttorney = speakers.find(s => 
      s.speakerHandle.includes('PLAINTIFF')
    );
    const defenseAttorney = speakers.find(s => 
      s.speakerHandle.includes('DEFENSE')
    );
    
    if (!plaintiffAttorney || !defenseAttorney) {
      return null;
    }
    
    const result: GenericSpeakers = {
      plaintiffAttorney,
      defenseAttorney
    };
    
    this.genericSpeakers.set(trialId, result);
    
    return result;
  }
  
  async attributeToGeneric(
    trialId: number,
    side: 'plaintiff' | 'defense',
    originalSpeakerId?: number
  ): Promise<GenericAttribution> {
    const genericSpeakers = await this.getGenericSpeakers(trialId);
    
    if (!genericSpeakers) {
      throw new Error(`No generic speakers found for trial ${trialId}`);
    }
    
    const speaker = side === 'plaintiff' 
      ? genericSpeakers.plaintiffAttorney 
      : genericSpeakers.defenseAttorney;
    
    return {
      speakerId: speaker.id,
      originalSpeakerId,
      isGeneric: true,
      side,
      confidence: 0.7 // Lower confidence for generic attribution
    };
  }
  
  async markStatementAsGeneric(
    statementEventId: number,
    genericAttribution: GenericAttribution
  ): Promise<void> {
    await this.prisma.statementEvent.update({
      where: { id: statementEventId },
      data: {
        speakerId: genericAttribution.speakerId
      }
    });
  }
  
  async getGenericAttributionStats(trialId: number): Promise<{
    totalGenericAttributions: number;
    plaintiffAttributions: number;
    defenseAttributions: number;
    byExaminationType: Record<string, number>;
  }> {
    const genericSpeakers = await this.getGenericSpeakers(trialId);
    
    if (!genericSpeakers) {
      return {
        totalGenericAttributions: 0,
        plaintiffAttributions: 0,
        defenseAttributions: 0,
        byExaminationType: {}
      };
    }
    
    const statements = await this.prisma.statementEvent.findMany({
      where: {
        speakerId: {
          in: [genericSpeakers.plaintiffAttorney.id, genericSpeakers.defenseAttorney.id]
        }
      },
      include: {
        event: {
          include: {
            session: true
          }
        }
      }
    });
    
    const plaintiffCount = statements.filter(s => 
      s.speakerId === genericSpeakers.plaintiffAttorney.id
    ).length;
    
    const defenseCount = statements.filter(s => 
      s.speakerId === genericSpeakers.defenseAttorney.id
    ).length;
    
    // Group by examination type (would need to track this in metadata)
    const byExaminationType: Record<string, number> = {};
    
    return {
      totalGenericAttributions: statements.length,
      plaintiffAttributions: plaintiffCount,
      defenseAttributions: defenseCount,
      byExaminationType
    };
  }
  
  async cleanupGenericSpeakers(trialId: number): Promise<void> {
    // Remove from cache
    this.genericSpeakers.delete(trialId);
    
    // Delete from database if needed (usually kept for audit trail)
    logger.info(`Cleaned up generic speakers cache for trial ${trialId}`);
  }
}