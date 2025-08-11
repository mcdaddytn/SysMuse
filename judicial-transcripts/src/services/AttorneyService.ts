// src/services/AttorneyService.ts
import { PrismaClient } from '@prisma/client';
import { AttorneyInfo, AddressInfo } from '../types/config.types';
import logger from '../utils/logger';

export class AttorneyService {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
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
   */
  async createOrUpdateAttorney(
    trialId: number,
    attorneyInfo: AttorneyInfo,
    role: 'PLAINTIFF' | 'DEFENDANT' | 'THIRD_PARTY'
  ): Promise<number> {
    try {
      // Parse attorney name for components
      const parsed = this.parseAttorneyName(attorneyInfo.name);
      const { title, firstName, lastName, suffix, speakerPrefix, speakerHandle } = parsed;
      
      // Use provided speakerPrefix if available, otherwise use parsed
      const finalSpeakerPrefix = attorneyInfo.speakerPrefix || speakerPrefix || attorneyInfo.name.toUpperCase();
      const finalSpeakerHandle = speakerHandle || `ATTORNEY_${attorneyInfo.name.replace(/[^A-Z0-9]/gi, '_').toUpperCase()}`;
      
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

      // Find or create attorney
      let attorney = await this.prisma.attorney.findFirst({
        where: { 
          name: attorneyInfo.name,
          speakerId: speaker.id
        }
      });
      
      if (!attorney) {
        attorney = await this.prisma.attorney.create({
          data: { 
            name: attorneyInfo.name,
            title: title || attorneyInfo.title,
            firstName: firstName || attorneyInfo.firstName,
            middleInitial: attorneyInfo.middleInitial,
            lastName: lastName || attorneyInfo.lastName,
            suffix: suffix || attorneyInfo.suffix,
            speakerPrefix: finalSpeakerPrefix,
            barNumber: attorneyInfo.barNumber,
            speakerId: speaker.id
          }
        });
        logger.info(`Created attorney: ${attorneyInfo.name} with speaker prefix: ${finalSpeakerPrefix}`);
      } else {
        // Update attorney if we have new information
        attorney = await this.prisma.attorney.update({
          where: { id: attorney.id },
          data: {
            title: title || attorney.title,
            firstName: firstName || attorney.firstName,
            middleInitial: attorneyInfo.middleInitial || attorney.middleInitial,
            lastName: lastName || attorney.lastName,
            suffix: suffix || attorney.suffix,
            speakerPrefix: finalSpeakerPrefix,
            barNumber: attorneyInfo.barNumber || attorney.barNumber
          }
        });
      }
      
      // Handle law firm and office if provided
      let lawFirmId: number | null = null;
      let lawFirmOfficeId: number | null = null;
      
      if (attorneyInfo.lawFirm) {
        const { lawFirm, office } = await this.createOrUpdateLawFirm(
          attorneyInfo.lawFirm.name,
          attorneyInfo.lawFirm.office
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
        // Create address if provided
        let addressId: number | null = null;
        if (officeInfo.address) {
          const address = await this.prisma.address.create({
            data: {
              ...officeInfo.address,
              country: officeInfo.address.country || 'USA'
            }
          });
          addressId = address.id;
        }
        
        // Find or create office
        office = await this.prisma.lawFirmOffice.findFirst({
          where: {
            lawFirmId: lawFirm.id,
            name: officeInfo.name
          }
        });
        
        if (!office) {
          office = await this.prisma.lawFirmOffice.create({
            data: {
              lawFirmId: lawFirm.id,
              name: officeInfo.name,
              addressId: addressId!
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
    
    if (speaker?.attorney) return speaker.attorney;
    
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
