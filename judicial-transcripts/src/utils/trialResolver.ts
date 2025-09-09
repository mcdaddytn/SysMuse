// src/utils/trialResolver.ts
import { PrismaClient, Trial } from '@prisma/client';
import { Logger } from './logger';

const logger = new Logger('TrialResolver');

export interface TrialResolverConfig {
  includedTrials?: string[];
  excludedTrials?: string[];
  activeTrials?: string[];
  trialSelectionMode?: 'INCLUDE' | 'EXCLUDE' | 'ACTIVE';
}

/**
 * Standard utility to resolve trial IDs from multi-trial config
 * Uses Trial.shortName to match against folder names in config
 */
export class TrialResolver {
  constructor(private prisma: PrismaClient) {}

  /**
   * Get trial IDs based on config's trial lists
   * @param config - Config containing includedTrials, excludedTrials, activeTrials
   * @returns Array of trial IDs
   */
  async getTrialIds(config: TrialResolverConfig): Promise<number[]> {
    // Determine which list to use based on selection mode
    let trialList: string[] = [];
    
    if (config.trialSelectionMode === 'ACTIVE' && config.activeTrials) {
      trialList = config.activeTrials;
      logger.info(`Using activeTrials list with ${trialList.length} entries`);
    } else if (config.trialSelectionMode === 'EXCLUDE' && config.excludedTrials) {
      // Get all trials except excluded ones
      return this.getTrialIdsExcluding(config.excludedTrials);
    } else if (config.includedTrials) {
      trialList = config.includedTrials;
      logger.info(`Using includedTrials list with ${trialList.length} entries`);
    } else if (config.activeTrials) {
      // Fallback to activeTrials if no includedTrials
      trialList = config.activeTrials;
      logger.info(`Using activeTrials list as fallback with ${trialList.length} entries`);
    }

    if (trialList.length === 0) {
      logger.warn('No trials specified in config, returning all trials');
      const allTrials = await this.prisma.trial.findMany();
      return allTrials.map(t => t.id);
    }

    return this.resolveTrialsByShortName(trialList);
  }

  /**
   * Resolve trials by their shortName (folder names like "01 Genband")
   */
  private async resolveTrialsByShortName(shortNames: string[]): Promise<number[]> {
    const trialIds: number[] = [];
    const notFound: string[] = [];

    for (const shortName of shortNames) {
      // Try exact match first
      let trial = await this.prisma.trial.findFirst({
        where: { shortName }
      });

      // If not found, try case-insensitive match
      if (!trial) {
        trial = await this.prisma.trial.findFirst({
          where: {
            shortName: {
              equals: shortName,
              mode: 'insensitive'
            }
          }
        });
      }

      // If still not found, try partial match
      if (!trial) {
        trial = await this.prisma.trial.findFirst({
          where: {
            OR: [
              { shortName: { contains: shortName } },
              { name: { contains: shortName } },
              { caseHandle: { contains: shortName } }
            ]
          }
        });
      }

      if (trial) {
        trialIds.push(trial.id);
        logger.debug(`Resolved "${shortName}" to trial ${trial.id}: ${trial.name}`);
      } else {
        notFound.push(shortName);
      }
    }

    if (notFound.length > 0) {
      logger.warn(`Could not find trials for: ${notFound.join(', ')}`);
    }

    logger.info(`Resolved ${trialIds.length} trials from ${shortNames.length} entries`);
    return trialIds;
  }

  /**
   * Get all trial IDs except the excluded ones
   */
  private async getTrialIdsExcluding(excludedShortNames: string[]): Promise<number[]> {
    const excludedIds = await this.resolveTrialsByShortName(excludedShortNames);
    
    const allTrials = await this.prisma.trial.findMany({
      where: {
        id: {
          notIn: excludedIds
        }
      }
    });

    logger.info(`Found ${allTrials.length} trials after excluding ${excludedIds.length}`);
    return allTrials.map(t => t.id);
  }

  /**
   * Get trial details for reporting
   */
  async getTrialDetails(trialId: number): Promise<Trial | null> {
    return this.prisma.trial.findUnique({
      where: { id: trialId }
    });
  }

  /**
   * Get all trials with their shortNames for reference
   */
  async listAllTrials(): Promise<Array<{ id: number; shortName: string | null; name: string }>> {
    const trials = await this.prisma.trial.findMany({
      select: {
        id: true,
        shortName: true,
        name: true
      },
      orderBy: { shortName: 'asc' }
    });

    return trials;
  }
}