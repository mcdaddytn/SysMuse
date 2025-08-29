import { PrismaClient } from '@prisma/client';
import logger from '../utils/logger';

interface SectionMetadata {
  [key: string]: any;
}

interface SessionSection {
  sectionType: string;
  sectionText: string;
  orderIndex: number;
  metadata?: SectionMetadata;
}

export class SessionSectionParser {
  private prisma: PrismaClient;
  
  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }
  
  /**
   * Parse summary lines and create SessionSection records
   */
  async parseSummarySections(
    lines: string[], 
    sessionId: number, 
    trialId: number
  ): Promise<void> {
    const sections = this.identifySections(lines);
    
    for (const section of sections) {
      await this.prisma.sessionSection.create({
        data: {
          sessionId,
          trialId,
          sectionType: section.sectionType,
          sectionText: section.sectionText,
          orderIndex: section.orderIndex,
          metadata: section.metadata || undefined
        }
      });
    }
    
    logger.info(`Created ${sections.length} summary sections for session ${sessionId}`);
  }
  
  /**
   * Parse certification section and create SessionSection record
   */
  async parseCertificationSection(
    lines: string[], 
    startIndex: number,
    sessionId: number, 
    trialId: number
  ): Promise<void> {
    const certificationText = this.extractCertificationText(lines, startIndex);
    const metadata = this.extractCertificationMetadata(certificationText);
    
    await this.prisma.sessionSection.create({
      data: {
        sessionId,
        trialId,
        sectionType: 'CERTIFICATION',
        sectionText: certificationText,
        orderIndex: 999, // Always last
        metadata
      }
    });
    
    logger.info(`Created certification section for session ${sessionId}`);
  }
  
  /**
   * Identify and extract sections from summary lines
   */
  private identifySections(lines: string[]): SessionSection[] {
    const sections: SessionSection[] = [];
    let currentSection: SessionSection | null = null;
    let currentLines: string[] = [];
    let orderIndex = 1;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmedLine = line.trim();
      
      // Check if we've reached PROCEEDINGS section
      if (trimmedLine === 'P R O C E E D I N G S') {
        // Save any pending section
        if (currentSection && currentLines.length > 0) {
          currentSection.sectionText = currentLines.join('\n');
          sections.push(currentSection);
        }
        break;
      }
      
      // Detect header section (first few lines with case number)
      if (i < 3 && line.includes('Case ') && line.includes(' Document ')) {
        if (currentSection) {
          currentSection.sectionText = currentLines.join('\n');
          sections.push(currentSection);
          currentLines = [];
        }
        
        currentSection = {
          sectionType: 'HEADER',
          sectionText: '',
          orderIndex: orderIndex++,
          metadata: this.extractHeaderMetadata(line)
        };
        currentLines = [line];
        continue;
      }
      
      // Detect Court and Division section
      if (trimmedLine.includes('UNITED STATES DISTRICT COURT') || 
          (trimmedLine.includes('DISTRICT OF') && i < 20)) {
        if (currentSection && currentLines.length > 0) {
          currentSection.sectionText = currentLines.join('\n');
          sections.push(currentSection);
          currentLines = [];
        }
        
        currentSection = {
          sectionType: 'COURT_AND_DIVISION',
          sectionText: '',
          orderIndex: orderIndex++,
          metadata: {}
        };
        currentLines = [line];
        continue;
      }
      
      // Detect Case Title section (plaintiff vs defendant)
      if ((trimmedLine.includes('PLAINTIFF') || trimmedLine.includes('VS.') || 
           trimmedLine.includes('DEFENDANT')) && i < 50) {
        // Check if this is the start of a case title block
        const isNewSection = currentSection?.sectionType !== 'CASE_TITLE';
        
        if (isNewSection) {
          if (currentSection && currentLines.length > 0) {
            currentSection.sectionText = currentLines.join('\n');
            // Extract metadata for previous section if it was court section
            if (currentSection.sectionType === 'COURT_AND_DIVISION') {
              currentSection.metadata = this.extractCourtMetadata(currentLines);
            }
            sections.push(currentSection);
            currentLines = [];
          }
          
          currentSection = {
            sectionType: 'CASE_TITLE',
            sectionText: '',
            orderIndex: orderIndex++,
            metadata: {}
          };
        }
        currentLines.push(line);
        continue;
      }
      
      // Detect Session Info section (date and time)
      if (this.isDateLine(trimmedLine) && i > 10 && i < 80) {
        if (currentSection && currentLines.length > 0) {
          currentSection.sectionText = currentLines.join('\n');
          // Extract metadata for case title if that's what we were processing
          if (currentSection.sectionType === 'CASE_TITLE') {
            currentSection.metadata = this.extractCaseTitleMetadata(currentLines);
          }
          sections.push(currentSection);
          currentLines = [];
        }
        
        currentSection = {
          sectionType: 'SESSION_INFO',
          sectionText: '',
          orderIndex: orderIndex++,
          metadata: {}
        };
        currentLines = [line];
        continue;
      }
      
      // Detect Judge Info section
      if (trimmedLine.includes('BEFORE THE HONORABLE')) {
        if (currentSection && currentLines.length > 0) {
          currentSection.sectionText = currentLines.join('\n');
          // Extract session metadata if that's what we were processing
          if (currentSection.sectionType === 'SESSION_INFO') {
            currentSection.metadata = this.extractSessionMetadata(currentLines);
          }
          sections.push(currentSection);
          currentLines = [];
        }
        
        currentSection = {
          sectionType: 'JUDGE_INFO',
          sectionText: '',
          orderIndex: orderIndex++,
          metadata: {}
        };
        currentLines = [line];
        continue;
      }
      
      // Detect Appearances section
      if (trimmedLine.match(/FOR THE PLAINTIFF/i) || 
          trimmedLine.match(/APPEARANCES:/i)) {
        if (currentSection && currentLines.length > 0) {
          currentSection.sectionText = currentLines.join('\n');
          // Extract judge metadata if that's what we were processing
          if (currentSection.sectionType === 'JUDGE_INFO') {
            currentSection.metadata = this.extractJudgeMetadata(currentLines);
          }
          sections.push(currentSection);
          currentLines = [];
        }
        
        currentSection = {
          sectionType: 'APPEARANCES',
          sectionText: '',
          orderIndex: orderIndex++,
          metadata: {}
        };
        currentLines = [line];
        continue;
      }
      
      // Detect Court Personnel section
      if (trimmedLine.match(/COURT REPORTER|COURT CLERK|CSR|RPR/i)) {
        if (currentSection?.sectionType !== 'COURT_PERSONNEL') {
          if (currentSection && currentLines.length > 0) {
            currentSection.sectionText = currentLines.join('\n');
            // Extract appearances metadata if that's what we were processing
            if (currentSection.sectionType === 'APPEARANCES') {
              currentSection.metadata = this.extractAppearancesMetadata(currentLines);
            }
            sections.push(currentSection);
            currentLines = [];
          }
          
          currentSection = {
            sectionType: 'COURT_PERSONNEL',
            sectionText: '',
            orderIndex: orderIndex++,
            metadata: {}
          };
        }
        currentLines.push(line);
        continue;
      }
      
      // Add line to current section if we have one
      if (currentSection) {
        currentLines.push(line);
      }
    }
    
    // Save final section if exists
    if (currentSection && currentLines.length > 0) {
      currentSection.sectionText = currentLines.join('\n');
      // Extract metadata based on section type
      if (currentSection.sectionType === 'COURT_PERSONNEL') {
        currentSection.metadata = this.extractCourtPersonnelMetadata(currentLines);
      } else if (currentSection.sectionType === 'APPEARANCES') {
        currentSection.metadata = this.extractAppearancesMetadata(currentLines);
      } else if (currentSection.sectionType === 'JUDGE_INFO') {
        currentSection.metadata = this.extractJudgeMetadata(currentLines);
      }
      sections.push(currentSection);
    }
    
    return sections;
  }
  
  /**
   * Check if a line appears to be a date
   */
  private isDateLine(line: string): boolean {
    // Match patterns like "OCTOBER 1, 2020" or "January 13, 2014"
    return /^[A-Z][a-z]+\s+\d{1,2},\s+\d{4}$/i.test(line);
  }
  
  /**
   * Extract header metadata
   */
  private extractHeaderMetadata(line: string): SectionMetadata {
    const metadata: SectionMetadata = {};
    
    // Extract case number
    const caseMatch = line.match(/Case\s+([\d:\-cv\-A-Z]+)/i);
    if (caseMatch) {
      metadata.caseNumber = caseMatch[1];
    }
    
    // Extract document number
    const docMatch = line.match(/Document\s+(\d+)/);
    if (docMatch) {
      metadata.documentNumber = parseInt(docMatch[1]);
    }
    
    // Extract page info
    const pageMatch = line.match(/Page\s+(\d+)\s+of\s+(\d+)/);
    if (pageMatch) {
      metadata.pageNumber = parseInt(pageMatch[1]);
      metadata.totalPages = parseInt(pageMatch[2]);
    }
    
    // Extract PageID
    const pageIdMatch = line.match(/PageID\s*#:\s*(\d+)/);
    if (pageIdMatch) {
      metadata.pageId = pageIdMatch[1];
    }
    
    return metadata;
  }
  
  /**
   * Extract court and division metadata
   */
  private extractCourtMetadata(lines: string[]): SectionMetadata {
    const metadata: SectionMetadata = {};
    const text = lines.join(' ').replace(/\s+/g, ' ');
    
    if (text.includes('UNITED STATES DISTRICT COURT')) {
      metadata.court = 'United States District Court';
    }
    
    const districtMatch = text.match(/(?:FOR THE\s+)?([A-Z]+\s+DISTRICT OF [A-Z\s]+)/i);
    if (districtMatch) {
      metadata.district = districtMatch[1].trim();
    }
    
    const divisionMatch = text.match(/([A-Z]+\s+DIVISION)/i);
    if (divisionMatch) {
      metadata.division = divisionMatch[1].trim();
    }
    
    return metadata;
  }
  
  /**
   * Extract case title metadata
   */
  private extractCaseTitleMetadata(lines: string[]): SectionMetadata {
    const metadata: SectionMetadata = {};
    const text = lines.join(' ').replace(/\s+/g, ' ');
    
    // Extract plaintiff
    const plaintiffMatch = text.match(/^(.*?),?\s+PLAINTIFF/i);
    if (plaintiffMatch) {
      metadata.plaintiff = plaintiffMatch[1].trim();
    }
    
    // Extract defendant
    const defendantMatch = text.match(/VS\.?\s+(.*?),?\s+DEFENDANT/i);
    if (defendantMatch) {
      metadata.defendant = defendantMatch[1].trim();
    }
    
    // Check if civil action
    if (text.includes('CIVIL ACTION')) {
      metadata.civilAction = true;
      
      // Extract case number if present after CIVIL ACTION
      const caseNumMatch = text.match(/CIVIL ACTION NO\.\s*([\d:\-CV\-A-Z]+)/i);
      if (caseNumMatch) {
        metadata.caseNumber = caseNumMatch[1];
      }
    }
    
    return metadata;
  }
  
  /**
   * Extract session info metadata
   */
  private extractSessionMetadata(lines: string[]): SectionMetadata {
    const metadata: SectionMetadata = {};
    
    for (const line of lines) {
      const trimmed = line.trim();
      
      // Extract date
      const dateMatch = trimmed.match(/^([A-Z][a-z]+\s+\d{1,2},\s+\d{4})$/i);
      if (dateMatch) {
        const date = new Date(dateMatch[1]);
        metadata.date = date.toISOString().split('T')[0];
      }
      
      // Extract time
      const timeMatch = trimmed.match(/^(\d{1,2}:\d{2})\s*(A\.?M\.?|P\.?M\.?)/i);
      if (timeMatch) {
        metadata.time = this.parseTime(timeMatch[1], timeMatch[2]);
      }
      
      // Extract session type
      if (trimmed.includes('MORNING') || trimmed.includes('AM SESSION')) {
        metadata.sessionType = 'MORNING';
      } else if (trimmed.includes('AFTERNOON') || trimmed.includes('PM SESSION')) {
        metadata.sessionType = 'AFTERNOON';
      }
      
      // Extract transcript type
      if (trimmed.includes('JURY TRIAL')) {
        metadata.transcriptType = 'JURY TRIAL';
      } else if (trimmed.includes('BENCH TRIAL')) {
        metadata.transcriptType = 'BENCH TRIAL';
      } else if (trimmed.includes('JURY VERDICT')) {
        metadata.transcriptType = 'JURY VERDICT';
      }
    }
    
    return metadata;
  }
  
  /**
   * Parse time string to 24-hour format
   */
  private parseTime(time: string, period: string): string {
    const [hours, minutes] = time.split(':').map(n => parseInt(n));
    let hour24 = hours;
    
    if (period.toUpperCase().includes('P') && hours !== 12) {
      hour24 += 12;
    } else if (period.toUpperCase().includes('A') && hours === 12) {
      hour24 = 0;
    }
    
    return `${hour24.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:00`;
  }
  
  /**
   * Extract judge metadata
   */
  private extractJudgeMetadata(lines: string[]): SectionMetadata {
    const metadata: SectionMetadata = {};
    const text = lines.join(' ').replace(/\s+/g, ' ');
    
    // Extract judge name
    const judgeMatch = text.match(/BEFORE THE HONORABLE(?:\s+JUDGE)?\s+([A-Z][A-Z\s]+?)(?:\s+UNITED|\s+CHIEF|\s*$)/i);
    if (judgeMatch) {
      metadata.name = judgeMatch[1].trim().replace(/JUDGE\s*/i, '');
      metadata.honorific = 'HONORABLE';
    }
    
    // Check for title
    if (text.includes('CHIEF DISTRICT JUDGE')) {
      metadata.title = 'UNITED STATES CHIEF DISTRICT JUDGE';
    } else if (text.includes('DISTRICT JUDGE')) {
      metadata.title = 'UNITED STATES DISTRICT JUDGE';
    } else {
      metadata.title = 'JUDGE';
    }
    
    return metadata;
  }
  
  /**
   * Extract appearances metadata
   */
  private extractAppearancesMetadata(lines: string[]): SectionMetadata {
    const metadata: SectionMetadata = {
      plaintiffAttorneys: [],
      defendantAttorneys: []
    };
    
    let currentSide: 'plaintiff' | 'defendant' | null = null;
    let currentAttorney: any = null;
    
    for (const line of lines) {
      const trimmed = line.trim();
      
      // Detect side
      if (trimmed.match(/FOR THE PLAINTIFF/i)) {
        if (currentAttorney) {
          metadata[currentSide === 'plaintiff' ? 'plaintiffAttorneys' : 'defendantAttorneys'].push(currentAttorney);
          currentAttorney = null;
        }
        currentSide = 'plaintiff';
        continue;
      } else if (trimmed.match(/FOR THE DEFENDANT/i)) {
        if (currentAttorney) {
          metadata[currentSide === 'plaintiff' ? 'plaintiffAttorneys' : 'defendantAttorneys'].push(currentAttorney);
          currentAttorney = null;
        }
        currentSide = 'defendant';
        continue;
      }
      
      if (!currentSide) continue;
      
      // Check for attorney name
      const nameMatch = trimmed.match(/^(MR\.|MS\.|MRS\.|DR\.)?\s*([A-Z][A-Z\s\.,]+?)(?:\s{2,}|$)/i);
      if (nameMatch && !trimmed.includes('LLP') && !trimmed.includes('LLC')) {
        if (currentAttorney) {
          metadata[currentSide === 'plaintiff' ? 'plaintiffAttorneys' : 'defendantAttorneys'].push(currentAttorney);
        }
        currentAttorney = {
          name: trimmed
        };
      } else if (currentAttorney && (trimmed.includes('LLP') || trimmed.includes('LLC') || 
                 trimmed.includes('P.C.') || trimmed.includes('LAW'))) {
        currentAttorney.firm = trimmed;
      } else if (currentAttorney && trimmed.match(/,\s*[A-Z]{2}\s+\d{5}/)) {
        currentAttorney.location = trimmed;
      }
    }
    
    // Save last attorney
    if (currentAttorney && currentSide) {
      metadata[currentSide === 'plaintiff' ? 'plaintiffAttorneys' : 'defendantAttorneys'].push(currentAttorney);
    }
    
    return metadata;
  }
  
  /**
   * Extract court personnel metadata
   */
  private extractCourtPersonnelMetadata(lines: string[]): SectionMetadata {
    const metadata: SectionMetadata = {};
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      // Court reporter
      if (line.match(/COURT REPORTER|CSR|RPR/i)) {
        const reporterInfo: any = {};
        
        // Extract name (usually on same or next line)
        const nameMatch = line.match(/(?:COURT REPORTER:?\s*)?([A-Z][a-z]+\s+[A-Z][a-z]+)/);
        if (nameMatch) {
          reporterInfo.name = nameMatch[1];
        } else if (i + 1 < lines.length) {
          const nextLine = lines[i + 1].trim();
          if (nextLine.match(/^[A-Z][a-z]+\s+[A-Z][a-z]+/)) {
            reporterInfo.name = nextLine.split(',')[0].trim();
          }
        }
        
        // Extract credentials
        const credMatch = line.match(/(CSR|RPR|TCRR)(?:\s+[\d]+)?/gi);
        if (credMatch) {
          reporterInfo.credentials = credMatch.join(', ');
        }
        
        // Extract certification number
        const certMatch = line.match(/(?:Texas\s+)?CSR\s+([\d]+)/i);
        if (certMatch) {
          reporterInfo.certNumber = `Texas CSR ${certMatch[1]}`;
        }
        
        // Look for location in next lines
        if (i + 1 < lines.length) {
          const locationMatch = lines[i + 1].match(/([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?),\s+([A-Z][a-z]+)/);
          if (locationMatch) {
            reporterInfo.location = `${locationMatch[1]}, ${locationMatch[2]}`;
          }
        }
        
        metadata.courtReporter = reporterInfo;
      }
      
      // Court clerk
      if (line.match(/COURT CLERK/i)) {
        const clerkInfo: any = {};
        
        // Extract name
        const nameMatch = line.match(/COURT CLERK:?\s*(.+)/i);
        if (nameMatch) {
          clerkInfo.name = nameMatch[1].trim();
        } else if (i + 1 < lines.length) {
          clerkInfo.name = lines[i + 1].trim();
        }
        
        metadata.courtClerk = clerkInfo;
      }
    }
    
    return metadata;
  }
  
  /**
   * Extract certification text from lines
   */
  private extractCertificationText(lines: string[], startIndex: number): string {
    const certLines: string[] = [];
    
    for (let i = startIndex; i < lines.length; i++) {
      certLines.push(lines[i]);
    }
    
    return certLines.join('\n');
  }
  
  /**
   * Extract certification metadata
   */
  private extractCertificationMetadata(text: string): SectionMetadata {
    const metadata: SectionMetadata = {};
    
    // Extract certifying reporter name
    const certifierMatch = text.match(/I,\s+([A-Z][a-z]+\s+[A-Z][a-z]+)/);
    if (certifierMatch) {
      metadata.certifiedBy = certifierMatch[1];
    }
    
    // Extract certification date
    const dateMatch = text.match(/(?:Dated|Date):\s*([A-Z][a-z]+\s+\d{1,2},\s+\d{4})/i);
    if (dateMatch) {
      const date = new Date(dateMatch[1]);
      metadata.certificationDate = date.toISOString().split('T')[0];
    }
    
    // Extract page count
    const pageMatch = text.match(/(\d+)\s+pages?/i);
    if (pageMatch) {
      metadata.pageCount = parseInt(pageMatch[1]);
    }
    
    // Store first part of certification text
    const certTextMatch = text.match(/I (?:hereby )?certify that[^.]+\./i);
    if (certTextMatch) {
      metadata.certificationText = certTextMatch[0];
    }
    
    return metadata;
  }
}