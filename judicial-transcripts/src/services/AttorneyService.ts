// src/services/AttorneyService.ts
import { PrismaClient } from '@prisma/client';
import { AttorneyInfo, AddressInfo } from '../types/config.types';
import { AddressService } from './AddressService';
import logger from '../utils/logger';
import * as fs from 'fs';
import * as path from 'path';

interface AttorneyMetadata {
  name: string;
  title?: string;
  firstName?: string;
  middleInitial?: string;
  lastName?: string;
  suffix?: string;
  speakerPrefix?: string;
  barNumber?: string;
  attorneyFingerprint?: string;
  lawFirm?: {
    name: string;
    lawFirmFingerprint?: string;
    office?: {
      name: string;
      address?: any;
    };
  };
  role?: string;
  trialName: string;
  sourceTrial: string;
}

export class AttorneyService {
  private prisma: PrismaClient;
  private addressService: AddressService;
  private attorneyMetadata: Map<string, AttorneyMetadata[]> = new Map();
  private metadataLoaded: boolean = false;
  private useMetadata: boolean = false;

  constructor(prisma: PrismaClient, config?: any) {
    this.prisma = prisma;
    this.addressService = new AddressService(prisma);
    
    // Check if metadata loading is enabled in config
    if (config?.useAttorneyMetadata !== false) { // Default to true if not specified
      this.useMetadata = true;
      const metadataFile = config?.attorneyMetadataFile || './output/multi-trial/attorney-metadata.json';
      this.loadMetadata(metadataFile);
    } else {
      logger.info('Attorney metadata loading is disabled by configuration');
    }
  }

  /**
   * Load attorney metadata from the saved JSON file
   * This metadata is used to enhance attorneys during Phase 1 parsing
   */
  private loadMetadata(metadataFile: string): void {
    try {
      if (fs.existsSync(metadataFile)) {
        const data = JSON.parse(fs.readFileSync(metadataFile, 'utf-8'));
        
        // Group metadata by multiple keys for better matching
        for (const attorney of data) {
          // Store by fingerprint
          const fingerprintKey = `${attorney.sourceTrial}:fingerprint:${attorney.attorneyFingerprint}`;
          if (!this.attorneyMetadata.has(fingerprintKey)) {
            this.attorneyMetadata.set(fingerprintKey, []);
          }
          this.attorneyMetadata.get(fingerprintKey)!.push(attorney);
          
          // Also store by speakerPrefix for fallback matching
          if (attorney.speakerPrefix) {
            const prefixKey = `${attorney.sourceTrial}:prefix:${attorney.speakerPrefix}`;
            if (!this.attorneyMetadata.has(prefixKey)) {
              this.attorneyMetadata.set(prefixKey, []);
            }
            this.attorneyMetadata.get(prefixKey)!.push(attorney);
          }
        }
        
        this.metadataLoaded = true;
        logger.info(`Loaded attorney metadata for ${data.length} attorneys`);
      } else {
        logger.info(`Attorney metadata file not found: ${metadataFile}`);
      }
    } catch (error) {
      logger.warn('Could not load attorney metadata file:', error);
    }
  }

  /**
   * Generate a fingerprint for attorney matching across trials
   * Uses lastName, firstName initial, and suffix for matching
   */
  private generateFingerprint(attorneyInfo: {
    lastName?: string;
    firstName?: string;
    middleInitial?: string;
    suffix?: string;
  }): string {
    const parts: string[] = [];
    
    // Always include last name (normalized)
    if (attorneyInfo.lastName) {
      parts.push(attorneyInfo.lastName.toUpperCase().replace(/[^A-Z]/g, ''));
    }
    
    // Include first initial if available
    if (attorneyInfo.firstName) {
      parts.push(attorneyInfo.firstName.charAt(0).toUpperCase());
    }
    
    // Include suffix if present (important for Jr., III, etc.)
    if (attorneyInfo.suffix) {
      parts.push(attorneyInfo.suffix.toUpperCase().replace(/[^A-Z]/g, ''));
    }
    
    return parts.join('_');
  }

  /**
   * Parse attorney name to extract title, last name, and handle suffixes
   */
  private parseAttorneyName(fullName: string): { 
    title?: string; 
    firstName?: string;
    lastName?: string; 
    suffix?: string;
    speakerPrefix?: string;
    speakerHandle?: string;
  } {
    // Handle suffixes like Jr., Sr., III, IV, etc.
    // First check for comma-separated suffix (e.g., "RUBINO, III")
    let suffix: string | undefined;
    let nameWithoutSuffix = fullName;
    
    // Check for comma-separated suffix first
    const commaMatch = fullName.match(/^(.+?),\s*([IVX]+|Jr\.?|Sr\.?|ESQ\.?|Ph\.?D\.?|M\.?D\.?)$/i);
    if (commaMatch) {
      nameWithoutSuffix = commaMatch[1].trim();
      suffix = commaMatch[2].trim();
    } else {
      // If no comma, check for space-separated suffix
      const suffixPattern = /\s+(JR\.?|SR\.?|III|IV|II|ESQ\.?)$/i;
      const suffixMatch = fullName.match(suffixPattern);
      if (suffixMatch) {
        suffix = suffixMatch[1];
        nameWithoutSuffix = fullName.replace(suffixPattern, '').trim();
      }
    }
    
    // Parse title and name
    const titleMatch = nameWithoutSuffix.match(/^(MR\.|MS\.|MRS\.|DR\.)\s+(.+)$/i);
    
    if (titleMatch) {
      const title = titleMatch[1].toUpperCase();
      const namePart = titleMatch[2];
      
      // Extract last name (last word that's not a suffix)
      const nameParts = namePart.trim().split(/\s+/);
      const lastName = nameParts[nameParts.length - 1].toUpperCase();
      const firstName = nameParts.length > 1 ? nameParts.slice(0, -1).join(' ') : undefined;
      
      // Speaker prefix is title + last name (not suffix)
      const speakerPrefix = `${title} ${lastName}`;
      const speakerHandle = `ATTORNEY_${lastName.replace(/[^A-Z0-9]/gi, '_')}_${title.replace(/\./g, '')}`;
      
      return {
        title,
        firstName,
        lastName,
        suffix,
        speakerPrefix,
        speakerHandle
      };
    }
    
    // If no title found, try to extract last name anyway
    const nameParts = nameWithoutSuffix.trim().split(/\s+/);
    const lastName = nameParts[nameParts.length - 1].toUpperCase();
    const firstName = nameParts.length > 1 ? nameParts.slice(0, -1).join(' ') : undefined;
    const speakerHandle = `ATTORNEY_${lastName.replace(/[^A-Z0-9]/gi, '_')}`;
    
    return {
      firstName,
      lastName,
      suffix,
      speakerPrefix: lastName,
      speakerHandle
    };
  }

  /**
   * Create or update attorney with associated speaker and law firm
   * Now checks for existing attorneys across trials using fingerprint
   * Enhanced with metadata from LLM generation if available
   */
  async createOrUpdateAttorney(
    trialId: number,
    attorneyInfo: AttorneyInfo,
    role: 'PLAINTIFF' | 'DEFENDANT' | 'THIRD_PARTY'
  ): Promise<number> {
    try {
      // Get trial info to match with metadata
      const trial = await this.prisma.trial.findUnique({
        where: { id: trialId },
        select: { shortName: true }
      });
      
      // Parse attorney name for components
      const parsed = this.parseAttorneyName(attorneyInfo.name);
      const { title, firstName, lastName, suffix, speakerPrefix, speakerHandle } = parsed;
      
      // Generate fingerprint for cross-trial matching
      const fingerprint = this.generateFingerprint({
        lastName: lastName || attorneyInfo.lastName,
        firstName: firstName || attorneyInfo.firstName,
        middleInitial: attorneyInfo.middleInitial,
        suffix: suffix || attorneyInfo.suffix
      });
      
      // Check if we have metadata for this attorney
      let enhancedInfo = { ...attorneyInfo };
      let metadataFound = false;
      let enhancedFingerprint = fingerprint;
      
      if (this.metadataLoaded && trial) {
        // Try to find metadata by fingerprint first
        const fingerprintKey = `${trial.shortName}:fingerprint:${fingerprint}`;
        let metadata = this.attorneyMetadata.get(fingerprintKey);
        
        // If not found by fingerprint, try by speakerPrefix
        if (!metadata || metadata.length === 0) {
          const prefixToCheck = attorneyInfo.speakerPrefix || speakerPrefix || attorneyInfo.name.toUpperCase();
          const prefixKey = `${trial.shortName}:prefix:${prefixToCheck}`;
          metadata = this.attorneyMetadata.get(prefixKey);
          
          if (metadata && metadata.length > 0) {
            logger.info(`Found metadata for attorney by speaker prefix: ${prefixToCheck}`);
          }
        }
        
        if (metadata && metadata.length > 0) {
          const attorneyMeta = metadata[0]; // Use first match
          metadataFound = true;
          logger.info(`Found metadata for attorney ${attorneyInfo.name} - will use enhanced fingerprint: ${attorneyMeta.attorneyFingerprint}`);
          
          // Use the fingerprint from metadata for better matching
          enhancedFingerprint = attorneyMeta.attorneyFingerprint || fingerprint;
          
          // Enhance with metadata
          enhancedInfo = {
            ...attorneyInfo,
            title: attorneyMeta.title || attorneyInfo.title || title,
            firstName: attorneyMeta.firstName || attorneyInfo.firstName || firstName,
            middleInitial: attorneyMeta.middleInitial || attorneyInfo.middleInitial,
            lastName: attorneyMeta.lastName || attorneyInfo.lastName || lastName,
            suffix: attorneyMeta.suffix || attorneyInfo.suffix || suffix,
            barNumber: attorneyMeta.barNumber || attorneyInfo.barNumber,
            lawFirm: attorneyMeta.lawFirm || attorneyInfo.lawFirm,
            speakerPrefix: attorneyMeta.speakerPrefix || attorneyInfo.speakerPrefix
          };
        }
      }
      
      // Use enhanced info for speaker generation
      const finalSpeakerPrefix = enhancedInfo.speakerPrefix || speakerPrefix || enhancedInfo.name.toUpperCase();
      const finalSpeakerHandle = speakerHandle || `ATTORNEY_${enhancedInfo.name.replace(/[^A-Z0-9]/gi, '_').toUpperCase()}`;
      
      // First, find or create the speaker record using handle
      let speaker = await this.prisma.speaker.findFirst({
        where: {
          trialId,
          speakerHandle: finalSpeakerHandle
        }
      });

      if (!speaker) {
        speaker = await this.prisma.speaker.create({
          data: {
            trialId,
            speakerPrefix: finalSpeakerPrefix,
            speakerHandle: finalSpeakerHandle,
            speakerType: 'ATTORNEY'
          }
        });
        logger.info(`Created speaker for attorney: ${finalSpeakerPrefix} with handle: ${finalSpeakerHandle}`);
      }

      // If we have metadata, try to find existing attorney with the enhanced fingerprint
      let attorney = null;
      
      if (metadataFound && enhancedFingerprint) {
        // First try to find by enhanced fingerprint from metadata
        attorney = await this.prisma.attorney.findFirst({
          where: {
            attorneyFingerprint: enhancedFingerprint
          }
        });
        
        if (attorney) {
          logger.info(`Found existing attorney by enhanced fingerprint: ${enhancedFingerprint}`);
        }
      }
      
      // If not found by enhanced fingerprint, try original fingerprint
      if (!attorney && fingerprint) {
        attorney = await this.prisma.attorney.findFirst({
          where: {
            attorneyFingerprint: fingerprint
          }
        });
        
        if (attorney) {
          logger.info(`Found existing attorney by original fingerprint: ${fingerprint}`);
        }
      }
      
      // If still not found, check by speaker (last resort)
      if (!attorney) {
        attorney = await this.prisma.attorney.findFirst({
          where: { 
            speakerId: speaker.id
          }
        });
        
        if (attorney) {
          logger.info(`Found existing attorney by speaker ID`);
        }
      }
      
      if (!attorney) {
        // Only create new attorney if we don't have metadata OR if metadata says to create
        if (!metadataFound) {
          logger.info(`No metadata found for attorney ${attorneyInfo.name} - creating from transcript`);
        }
        
        // Create new attorney with enhanced fingerprint from metadata (if available)
        attorney = await this.prisma.attorney.create({
          data: { 
            name: enhancedInfo.name,
            title: enhancedInfo.title || title,
            firstName: enhancedInfo.firstName || firstName,
            middleInitial: enhancedInfo.middleInitial,
            lastName: enhancedInfo.lastName || lastName,
            suffix: enhancedInfo.suffix || suffix,
            speakerPrefix: finalSpeakerPrefix,
            barNumber: enhancedInfo.barNumber,
            attorneyFingerprint: enhancedFingerprint || fingerprint,
            speakerId: speaker.id
          }
        });
        logger.info(`Created attorney: ${enhancedInfo.name} with fingerprint: ${enhancedFingerprint || fingerprint}`);
      } else if (!attorney.attorneyFingerprint || (metadataFound && attorney.attorneyFingerprint !== enhancedFingerprint)) {
        // Update existing attorney to add/fix fingerprint and enhance with metadata
        attorney = await this.prisma.attorney.update({
          where: { id: attorney.id },
          data: {
            title: enhancedInfo.title || attorney.title,
            firstName: enhancedInfo.firstName || attorney.firstName,
            middleInitial: enhancedInfo.middleInitial || attorney.middleInitial,
            lastName: enhancedInfo.lastName || attorney.lastName,
            suffix: enhancedInfo.suffix || attorney.suffix,
            speakerPrefix: finalSpeakerPrefix,
            barNumber: enhancedInfo.barNumber || attorney.barNumber,
            attorneyFingerprint: enhancedFingerprint || fingerprint
          }
        });
        logger.info(`Updated attorney ${attorney.name} with enhanced fingerprint: ${enhancedFingerprint || fingerprint}`);
      } else {
        logger.info(`Found existing attorney ${attorney.name} with fingerprint: ${fingerprint}`);
      }
      
      // Handle law firm and office if provided (use enhanced info)
      let lawFirmId: number | null = null;
      let lawFirmOfficeId: number | null = null;
      
      if (enhancedInfo.lawFirm) {
        const { lawFirm, office } = await this.createOrUpdateLawFirm(
          enhancedInfo.lawFirm.name,
          enhancedInfo.lawFirm.office
        );
        lawFirmId = lawFirm.id;
        lawFirmOfficeId = office?.id || null;
      }
      
      // Create or update trial attorney association
      await this.prisma.trialAttorney.upsert({
        where: {
          trialId_attorneyId: {
            trialId,
            attorneyId: attorney.id
          }
        },
        update: {
          role,
          lawFirmId,
          lawFirmOfficeId
        },
        create: {
          trialId,
          attorneyId: attorney.id,
          role,
          lawFirmId,
          lawFirmOfficeId
        }
      });
      
      logger.info(`Associated attorney ${attorney.name} with trial as ${role}`);
      return attorney.id;
      
    } catch (error) {
      logger.error(`Error creating/updating attorney: ${error}`);
      throw error;
    }
  }

  /**
   * Create or update law firm with office
   */
  private async createOrUpdateLawFirm(
    firmName: string,
    officeInfo?: { name: string; address?: AddressInfo }
  ): Promise<{ lawFirm: any; office?: any }> {
    try {
      // Find or create law firm
      let lawFirm = await this.prisma.lawFirm.findFirst({
        where: { name: firmName }
      });
      
      if (!lawFirm) {
        lawFirm = await this.prisma.lawFirm.create({
          data: { name: firmName }
        });
        logger.info(`Created law firm: ${firmName}`);
      }
      
      // Handle office if provided
      let office = null;
      if (officeInfo) {
        // Create address if provided using AddressService
        let addressId: number | null = null;
        if (officeInfo.address) {
          addressId = await this.addressService.createOrFindAddress(officeInfo.address);
        }
        
        // Find or create office
        office = await this.prisma.lawFirmOffice.findFirst({
          where: {
            lawFirmId: lawFirm.id,
            name: officeInfo.name
          }
        });
        
        if (!office) {
          // Only create office if we have an address (addressId can be null)
          office = await this.prisma.lawFirmOffice.create({
            data: {
              lawFirmId: lawFirm.id,
              name: officeInfo.name,
              addressId: addressId
            }
          });
          logger.info(`Created law firm office: ${officeInfo.name}`);
        }
      }
      
      return { lawFirm, office };
      
    } catch (error) {
      logger.error(`Error creating/updating law firm: ${error}`);
      throw error;
    }
  }

  /**
   * Get all attorneys for a trial
   */
  async getAttorneysForTrial(trialId: number): Promise<any[]> {
    return await this.prisma.attorney.findMany({
      where: {
        trialAttorneys: {
          some: {
            trialId
          }
        }
      },
      include: {
        speaker: true,
        trialAttorneys: {
          where: { trialId },
          include: {
            lawFirm: true,
            lawFirmOffice: true
          }
        }
      }
    });
  }

  /**
   * Find all instances of an attorney across trials
   */
  async findAttorneyAcrossTrials(attorneyId: number): Promise<any[]> {
    const attorney = await this.prisma.attorney.findUnique({
      where: { id: attorneyId },
      include: {
        trialAttorneys: {
          include: {
            trial: true,
            lawFirm: true,
            lawFirmOffice: true
          }
        }
      }
    });
    
    if (!attorney || !attorney.attorneyFingerprint) {
      return attorney ? [attorney] : [];
    }
    
    // Find all attorneys with same fingerprint
    const relatedAttorneys = await this.prisma.attorney.findMany({
      where: {
        attorneyFingerprint: attorney.attorneyFingerprint
      },
      include: {
        speaker: true,
        trialAttorneys: {
          include: {
            trial: true,
            lawFirm: true,
            lawFirmOffice: true
          }
        }
      }
    });
    
    return relatedAttorneys;
  }
  
  /**
   * Get cross-trial statement events for an attorney
   */
  async getAttorneyStatementsAcrossTrials(
    attorneyFingerprint: string,
    filters?: {
      trialIds?: number[];
      statementTypes?: string[];
      searchText?: string;
    }
  ): Promise<any[]> {
    // Find all attorney records with this fingerprint
    const attorneys = await this.prisma.attorney.findMany({
      where: {
        attorneyFingerprint: attorneyFingerprint,
        trialAttorneys: filters?.trialIds ? {
          some: {
            trialId: {
              in: filters.trialIds
            }
          }
        } : undefined
      },
      select: {
        speakerId: true
      }
    });
    
    const speakerIds = attorneys.map(a => a.speakerId);
    
    // Get all statements from these speakers
    const statements = await this.prisma.statementEvent.findMany({
      where: {
        speakerId: {
          in: speakerIds
        },
        text: filters?.searchText ? {
          contains: filters.searchText,
          mode: 'insensitive'
        } : undefined
      },
      include: {
        event: {
          include: {
            session: {
              include: {
                trial: true
              }
            }
          }
        },
        speaker: {
          include: {
            attorney: {
              include: {
                trialAttorneys: {
                  include: {
                    trial: true,
                    lawFirm: true
                  }
                }
              }
            }
          }
        }
      },
      orderBy: [
        { eventId: 'asc' }
      ]
    });
    
    return statements;
  }
  
  /**
   * Find attorney by speaker prefix
   */
  async findAttorneyBySpeakerPrefix(trialId: number, speakerPrefix: string): Promise<any> {
    // First try exact match on speakerPrefix
    let attorney = await this.prisma.attorney.findFirst({
      where: {
        speakerPrefix: speakerPrefix,
        trialAttorneys: {
          some: { trialId }
        }
      },
      include: { 
        speaker: true,
        trialAttorneys: {
          where: { trialId }
        }
      }
    });
    
    if (attorney) return attorney;
    
    // Try finding by speaker handle
    const speaker = await this.prisma.speaker.findFirst({
      where: {
        trialId,
        speakerPrefix: speakerPrefix,
        speakerType: 'ATTORNEY'
      },
      include: {
        attorney: {
          include: {
            trialAttorneys: {
              where: { trialId }
            }
          }
        }
      }
    });
    
    if (speaker?.attorney) {
      // Return attorney with speaker relation included
      return { ...speaker.attorney, speaker };
    }
    
    // NEW: Try to match by lastName for attorneys without titles
    // Parse the speakerPrefix to extract title and lastName
    const prefixMatch = speakerPrefix.match(/^(MR\.|MS\.|MRS\.|DR\.)\s+([A-Z]+)$/);
    if (prefixMatch) {
      const title = prefixMatch[1];
      const lastName = prefixMatch[2];
      
      // Look for attorney with matching lastName but no title or placeholder title
      attorney = await this.prisma.attorney.findFirst({
        where: {
          lastName: lastName,
          OR: [
            { title: null },
            { title: '' },
            { speakerPrefix: `??? ${lastName}` }
          ],
          trialAttorneys: {
            some: { trialId }
          }
        },
        include: { 
          speaker: true,
          trialAttorneys: {
            where: { trialId }
          }
        }
      });
      
      if (attorney) {
        // Update the attorney with the discovered title
        logger.info(`Discovered title for attorney ${attorney.name}: ${title}`);
        
        // Update attorney record with the title
        const updatedAttorney = await this.prisma.attorney.update({
          where: { id: attorney.id },
          data: {
            title: title,
            speakerPrefix: speakerPrefix,
            name: attorney.name.startsWith(title) ? attorney.name : `${title} ${attorney.name}`
          },
          include: { 
            speaker: true,
            trialAttorneys: {
              where: { trialId }
            }
          }
        });
        
        // Update the speaker record as well
        await this.prisma.speaker.update({
          where: { id: attorney.speakerId },
          data: {
            speakerPrefix: speakerPrefix
          }
        });
        
        logger.info(`Updated attorney ${updatedAttorney.name} with speaker prefix: ${speakerPrefix}`);
        return updatedAttorney;
      }
    }
    
    return null;
  }
}
