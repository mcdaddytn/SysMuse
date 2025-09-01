// src/utils/trial-metadata-extractor.ts
import { PrismaClient } from '@prisma/client';
import logger from './logger';

interface ExtractedMetadata {
  name?: string;
  plaintiff?: string;
  defendant?: string;
  caseHandle?: string;
}

export class TrialMetadataExtractor {
  constructor(private prisma: PrismaClient) {}

  /**
   * Extract trial metadata from SessionSection CASE_TITLE records
   */
  async extractFromSessionSections(trialId: number): Promise<ExtractedMetadata> {
    const sections = await this.prisma.sessionSection.findMany({
      where: {
        trialId,
        sectionType: 'CASE_TITLE'
      },
      orderBy: {
        orderIndex: 'asc'
      }
    });

    if (sections.length === 0) {
      logger.warn(`No CASE_TITLE sections found for trial ${trialId}`);
      return {};
    }

    // Use the first CASE_TITLE section as it typically has the most complete information
    // Additional sections are usually duplicates from different days
    const primarySection = sections[0];
    
    logger.info(`Processing CASE_TITLE for trial ${trialId}, using first of ${sections.length} sections`);

    return this.extractMetadataFromText(primarySection.sectionText);
  }

  /**
   * Extract metadata from CASE_TITLE text
   */
  private extractMetadataFromText(text: string): ExtractedMetadata {
    const metadata: ExtractedMetadata = {};
    
    logger.info('Extracting metadata from text:', text.substring(0, 500));
    
    // Parse the )( format by extracting left side content
    const lines = text.split('\n');
    const leftSideContent: string[] = [];
    const rightSideContent: string[] = [];
    
    for (const line of lines) {
      if (line.includes(')(')) {
        const parts = line.split(')(');
        const left = parts[0].replace(/^\s*\d+\s*/, '').trim();
        const right = parts[1] ? parts[1].trim() : '';
        
        if (left) leftSideContent.push(left);
        if (right) rightSideContent.push(right);
      }
    }
    
    // Join left side content and look for case parties
    const leftText = leftSideContent.join(' ').replace(/\s+/g, ' ').trim();
    
    logger.info('Left side text:', leftText);
    
    // Strategy 1: Look for explicit PLAINTIFF/DEFENDANT markers
    if (leftText.includes('PLAINTIFF') && leftText.includes('DEFENDANT')) {
      const plaintiffMatch = leftText.match(/([A-Z][A-Z\s,\.&]+?)(?:,\s*)?PLAINTIFFS?/i);
      const defendantMatch = leftText.match(/(?:VS\.?\s+|V\.?\s+)([A-Z][A-Z\s,\.&]+?)(?:,\s*)?DEFENDANTS?/i);
      
      if (plaintiffMatch && defendantMatch) {
        metadata.plaintiff = this.cleanPartyName(plaintiffMatch[1]);
        metadata.defendant = this.cleanPartyName(defendantMatch[1]);
        metadata.name = `${metadata.plaintiff}, PLAINTIFF, VS. ${metadata.defendant}, DEFENDANT.`;
      }
    }
    // Strategy 2: Look for VS. pattern (like GENBAND US LLC VS. METASWITCH)
    else if (leftText.includes('VS.')) {
      // Split by VS. to get parties
      const parts = leftText.split(/\s+VS\.\s+/i);
      if (parts.length === 2) {
        const plaintiffPart = parts[0].trim();
        const defendantPart = parts[1].trim();
        
        // Clean up to get just the entity names
        // Remove any trailing metadata like dates, times, "TRANSCRIPT OF", etc.
        const plaintiff = this.extractEntityName(plaintiffPart);
        const defendant = this.extractEntityName(defendantPart);
        
        if (plaintiff && defendant) {
          metadata.plaintiff = plaintiff;
          metadata.defendant = defendant;
          metadata.name = `${plaintiff} VS. ${defendant}`;
        }
      }
    }
    // Strategy 3: Look for pattern with period separator (PACKET INTELLIGENCE LLC . NETSCOUT)
    else {
      // Look through left side content for entity names
      const entities: string[] = [];
      let currentEntity = '';
      
      for (const part of leftSideContent) {
        // Skip empty parts and single punctuation
        if (!part || part === '.' || part === 'VS' || part === 'VS.') {
          if (currentEntity) {
            entities.push(this.cleanPartyName(currentEntity));
            currentEntity = '';
          }
        }
        // Accumulate entity name parts
        else if (part.match(/[A-Z]{2,}/)) {
          // Skip dates, times, and document types
          if (!part.match(/^(JANUARY|FEBRUARY|MARCH|APRIL|MAY|JUNE|JULY|AUGUST|SEPTEMBER|OCTOBER|NOVEMBER|DECEMBER)/i) &&
              !part.match(/\d{1,2}:\d{2}/) &&
              !part.includes('TRANSCRIPT') &&
              !part.includes('CIVIL DOCKET') &&
              !part.includes('MARSHALL')) {
            currentEntity = currentEntity ? currentEntity + ' ' + part : part;
          }
        }
      }
      
      // Add last entity if exists
      if (currentEntity) {
        entities.push(this.cleanPartyName(currentEntity));
      }
      
      // Use entities if we found at least 2
      if (entities.length >= 2) {
        metadata.plaintiff = entities[0];
        metadata.defendant = entities.slice(1).join(', ');
        metadata.name = `${metadata.plaintiff} VS. ${metadata.defendant}`;
      }
    }
    
    // Create case handle from name
    if (metadata.name) {
      metadata.caseHandle = this.createCaseHandle(metadata.name);
    }
    
    logger.info('Extracted metadata:', metadata);
    
    return metadata;
  }

  /**
   * Extract entity name from text that may contain extra information
   */
  private extractEntityName(text: string): string {
    // Remove common non-entity words and clean up
    let cleaned = text
      // Remove dates
      .replace(/(JANUARY|FEBRUARY|MARCH|APRIL|MAY|JUNE|JULY|AUGUST|SEPTEMBER|OCTOBER|NOVEMBER|DECEMBER)\s+\d{1,2},?\s+\d{4}/gi, '')
      // Remove times
      .replace(/\d{1,2}:\d{2}\s*(A\.?M\.?|P\.?M\.?)?/gi, '')
      // Remove document types
      .replace(/TRANSCRIPT OF .*/i, '')
      // Remove docket numbers
      .replace(/Civil Docket No\.?.*\d+.*/i, '')
      .replace(/\d+:\d+-CV-\d+-[A-Z]+/gi, '')
      // Remove location markers
      .replace(/MARSHALL,?\s+TEXAS/gi, '')
      .trim();
    
    // Extract company names - look for patterns with business entity markers
    const entityMatch = cleaned.match(/([A-Z][A-Z\s,\.&]+(?:LLC|LLP|LTD|INC|CORP|CORPORATION|LP|COMPANY|CO\.?|PARTNERS|PARTNERSHIP|ASSOCIATES|GROUP|SYSTEMS|NETWORKS|COMMUNICATIONS|TECHNOLOGIES|TECHNOLOGY|WIRELESS|INTELLIGENCE)\b[A-Z\s,\.&]*)/i);
    
    if (entityMatch) {
      return this.cleanPartyName(entityMatch[1]);
    }
    
    // Fallback: take everything up to the first comma or period
    const parts = cleaned.split(/[,\.]/)[0].trim();
    return this.cleanPartyName(parts);
  }

  /**
   * Clean up party name
   */
  private cleanPartyName(name: string): string {
    return name
      .replace(/\s+/g, ' ')
      .replace(/\s*,\s*/g, ', ')
      .replace(/\s+(CORP|INC|LLC|LTD|LLP|L\.L\.C\.|L\.L\.P\.)\.?\s*/gi, ' $1')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/,$/, ''); // Remove trailing comma
  }

  /**
   * Create a case handle from the case name
   */
  private createCaseHandle(name: string): string {
    // Take first significant word from plaintiff and defendant
    const parts = name.split(/\s+VS\.?\s+/i);
    if (parts.length !== 2) return '';
    
    const plaintiffWord = parts[0]
      .split(/[\s,]+/)
      .find(w => w.length > 3 && !['LLC', 'INC', 'CORP', 'LTD'].includes(w.toUpperCase()));
    
    const defendantWord = parts[1]
      .split(/[\s,]+/)
      .find(w => w.length > 3 && !['LLC', 'INC', 'CORP', 'LTD'].includes(w.toUpperCase()));
    
    if (plaintiffWord && defendantWord) {
      return `${plaintiffWord}-v-${defendantWord}`.toLowerCase();
    }
    
    return '';
  }

  /**
   * Update trial metadata in database
   */
  async updateTrialMetadata(trialId: number): Promise<void> {
    try {
      const metadata = await this.extractFromSessionSections(trialId);
      
      if (Object.keys(metadata).length === 0) {
        logger.warn(`No metadata extracted for trial ${trialId}`);
        return;
      }
      
      // Only update fields that were successfully extracted
      const updateData: any = {};
      if (metadata.name && metadata.name !== 'Unknown Case') {
        updateData.name = metadata.name;
      }
      if (metadata.plaintiff) {
        updateData.plaintiff = metadata.plaintiff;
      }
      if (metadata.defendant) {
        updateData.defendant = metadata.defendant;
      }
      if (metadata.caseHandle) {
        updateData.caseHandle = metadata.caseHandle;
      }
      
      if (Object.keys(updateData).length > 0) {
        await this.prisma.trial.update({
          where: { id: trialId },
          data: updateData
        });
        
        logger.info(`Updated trial ${trialId} metadata:`, updateData);
      }
    } catch (error) {
      logger.error(`Error updating trial ${trialId} metadata:`, error);
    }
  }

  /**
   * Update metadata for all trials with "Unknown Case" name
   */
  async updateAllUnknownTrials(): Promise<void> {
    const unknownTrials = await this.prisma.trial.findMany({
      where: {
        name: 'Unknown Case'
      }
    });
    
    logger.info(`Found ${unknownTrials.length} trials with Unknown Case name`);
    
    for (const trial of unknownTrials) {
      logger.info(`Processing trial ${trial.id} (${trial.caseNumber})`);
      await this.updateTrialMetadata(trial.id);
    }
  }
}