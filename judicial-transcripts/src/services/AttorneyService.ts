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
   * Parse attorney name to extract title and last name
   */
  private parseAttorneyName(fullName: string): { title?: string; lastName?: string; speakerPrefix?: string } {
    const titleMatch = fullName.match(/^(MR\.|MS\.|MRS\.|DR\.)\s+(.+)$/i);
    
    if (titleMatch) {
      const title = titleMatch[1].toUpperCase();
      const namePart = titleMatch[2];
      
      // Extract last name (assume last word is last name for now)
      const nameParts = namePart.trim().split(/\s+/);
      const lastName = nameParts[nameParts.length - 1].toUpperCase();
      
      return {
        title,
        lastName,
        speakerPrefix: `${title} ${lastName}`
      };
    }
    
    // If no title found, try to extract last name anyway
    const nameParts = fullName.trim().split(/\s+/);
    const lastName = nameParts[nameParts.length - 1].toUpperCase();
    
    return {
      lastName,
      speakerPrefix: lastName
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
      // Parse attorney name for title and last name
      const { title, lastName, speakerPrefix } = this.parseAttorneyName(attorneyInfo.name);
      
      // First, find or create the speaker record
      let speaker = await this.prisma.speaker.findFirst({
        where: {
          trialId,
          speakerPrefix: speakerPrefix || attorneyInfo.name.toUpperCase()
        }
      });

      if (!speaker) {
        speaker = await this.prisma.speaker.create({
          data: {
            trialId,
            speakerPrefix: speakerPrefix || attorneyInfo.name.toUpperCase(),
            speakerType: 'ATTORNEY'
          }
        });
        logger.info(`Created speaker for attorney: ${speakerPrefix}`);
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
            title,
            lastName,
            speakerPrefix,
            barNumber: attorneyInfo.barNumber,
            speakerId: speaker.id
          }
        });
        logger.info(`Created attorney: ${attorneyInfo.name} with speaker prefix: ${speakerPrefix}`);
      } else {
        // Update attorney if we have new information
        attorney = await this.prisma.attorney.update({
          where: { id: attorney.id },
          data: {
            title: title || attorney.title,
            lastName: lastName || attorney.lastName,
            speakerPrefix: speakerPrefix || attorney.speakerPrefix,
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
    
    // Handle office if we have address information
    let office = null;
    
    // If we have address info, use city as office name, otherwise use "Main Office"
    const officeName = officeInfo?.name || 
                      officeInfo?.address?.city || 
                      'Main Office';
    
    if (officeInfo?.address || officeName !== 'Main Office') {
      // First check if office already exists
      office = await this.prisma.lawFirmOffice.findFirst({
        where: {
          lawFirmId: lawFirm.id,
          name: officeName
        }
      });
      
      if (!office) {
        // Create address only if office doesn't exist
        let addressId: number;
        
        if (officeInfo?.address) {
          // Check if similar address already exists
          const existingAddress = await this.prisma.address.findFirst({
            where: {
              street1: officeInfo.address.street1,
              city: officeInfo.address.city,
              state: officeInfo.address.state,
              zipCode: officeInfo.address.zipCode
            }
          });
          
          if (existingAddress) {
            addressId = existingAddress.id;
          } else {
            const address = await this.prisma.address.create({
              data: {
                street1: officeInfo.address.street1,
                street2: officeInfo.address.street2,
                city: officeInfo.address.city,
                state: officeInfo.address.state,
                zipCode: officeInfo.address.zipCode,
                country: officeInfo.address.country || 'USA'
              }
            });
            addressId = address.id;
            logger.info(`Created address for ${firmName} ${officeName} office`);
          }
        } else {
          // Create minimal address with just country
          const address = await this.prisma.address.create({
            data: {
              country: 'USA'
            }
          });
          addressId = address.id;
        }
        
        // Create office
        office = await this.prisma.lawFirmOffice.create({
          data: {
            lawFirmId: lawFirm.id,
            name: officeName,
            addressId
          }
        });
        logger.info(`Created office: ${officeName} for ${firmName}`);
      }
    }
    
    return { lawFirm, office };
  }

  /**
   * Find attorney by speaker prefix (for matching during transcript parsing)
   */
  async findAttorneyBySpeakerPrefix(trialId: number, speakerPrefix: string): Promise<any> {
    // First try exact match
    let attorney = await this.prisma.attorney.findFirst({
      where: {
        speakerPrefix: speakerPrefix.toUpperCase(),
        trialAttorneys: {
          some: { trialId }
        }
      },
      include: {
        speaker: true
      }
    });
    
    if (attorney) return attorney;
    
    // Try matching by last name only (for cases like "MR. SMITH" vs "SMITH")
    const lastNameMatch = speakerPrefix.match(/(?:MR\.|MS\.|MRS\.|DR\.)?\s*([A-Z]+)$/i);
    if (lastNameMatch) {
      const lastName = lastNameMatch[1].toUpperCase();
      attorney = await this.prisma.attorney.findFirst({
        where: {
          lastName,
          trialAttorneys: {
            some: { trialId }
          }
        },
        include: {
          speaker: true
        }
      });
    }
    
    return attorney;
  }

  /**
   * Get all attorneys for a trial
   */
  async getTrialAttorneys(trialId: number): Promise<Map<string, number>> {
    const attorneys = await this.prisma.trialAttorney.findMany({
      where: { trialId },
      include: {
        attorney: {
          include: {
            speaker: true
          }
        }
      }
    });
    
    const attorneyMap = new Map<string, number>();
    
    for (const ta of attorneys) {
      if (ta.attorney.speakerPrefix) {
        attorneyMap.set(ta.attorney.speakerPrefix, ta.attorney.id);
      }
      // Also add mapping for last name only
      if (ta.attorney.lastName) {
        attorneyMap.set(ta.attorney.lastName, ta.attorney.id);
      }
      // Add mapping for speaker ID
      if (ta.attorney.speaker) {
        attorneyMap.set(`SPEAKER_${ta.attorney.speaker.id}`, ta.attorney.id);
      }
    }
    
    return attorneyMap;
  }
}