import { PrismaClient } from '@prisma/client';
import { LineParser } from './LineParser';
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
  private lineParser: LineParser;
  
  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
    this.lineParser = new LineParser();
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
      // Section text is already cleaned in identifySections method
      
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
    const cleanedText = this.cleanSectionText(certificationText);
    const metadata = this.extractCertificationMetadata(cleanedText);
    
    await this.prisma.sessionSection.create({
      data: {
        sessionId,
        trialId,
        sectionType: 'CERTIFICATION',
        sectionText: cleanedText,
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
    
    // First pass: clean all lines by removing line prefixes
    const cleanedLines: string[] = [];
    for (const line of lines) {
      // Parse the line to remove any line number prefix
      const parsed = this.lineParser.parse(line);
      if (parsed) {
        if (parsed.isBlank) {
          cleanedLines.push('');
        } else {
          // Use the parsed text (line prefix removed)
          cleanedLines.push(parsed.text || '');
        }
      } else {
        // If LineParser couldn't parse it, just use trimmed line
        cleanedLines.push(line.trim());
      }
    }
    
    // Second pass: identify sections using CLEANED lines
    for (let i = 0; i < lines.length; i++) {
      const rawLine = lines[i];
      const cleanedLine = cleanedLines[i];
      const trimmedLine = cleanedLine.trim();
      
      // Check if we've reached PROCEEDINGS section
      if (trimmedLine === 'P R O C E E D I N G S') {
        // Save any pending section
        if (currentSection && currentLines.length > 0) {
          currentSection.sectionText = currentLines.join('\n');
          sections.push(currentSection);
        }
        break;
      }
      
      // Skip page headers - they are now properly handled in Page records
      if (rawLine.includes('Case ') && rawLine.includes(' Document ') && rawLine.includes('PageID')) {
        // Skip this line and potentially the next line if it's a page number
        if (i + 1 < lines.length) {
          const nextLine = cleanedLines[i + 1].trim();
          const pageNum = parseInt(nextLine);
          if (pageNum > 0 && nextLine === pageNum.toString()) {
            i++; // Skip the page number line too
          }
        }
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
        currentLines = [cleanedLine];
        continue;
      }
      
      // Detect Case Title section (plaintiff vs defendant)
      // Look for party names ending with LLC, INC, CORP, or followed by )(
      // Also check for PLAINTIFF, VS., DEFENDANT keywords
      // But don't switch to CASE_TITLE if we're already in APPEARANCES section
      const isCasePartyLine = (
        trimmedLine.match(/^[A-Z][A-Z\s,\.]+\s+(LLC|INC|CORP|LTD|LP|LLP|L\.L\.C\.|INC\.|CORPORATION)/i) ||
        trimmedLine.match(/^[A-Z][A-Z\s,\.]+\s*\)\s*\(/) ||
        trimmedLine.includes('PLAINTIFF') || 
        trimmedLine.includes('VS.') || 
        trimmedLine.includes('DEFENDANT')
      );
      
      // Don't create CASE_TITLE if we're already in APPEARANCES or later sections
      const skipCaseTitle = currentSection?.sectionType === 'APPEARANCES' || 
                           currentSection?.sectionType === 'COURT_PERSONNEL' ||
                           currentSection?.sectionType === 'JUDGE_INFO';
      
      if (isCasePartyLine && i < 50 && !trimmedLine.match(/FOR THE PLAINTIFF/i) && !skipCaseTitle) {
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
        currentLines.push(cleanedLine);
        continue;
      }
      
      // Detect Transcript Info section (TRANSCRIPT OF..., SESSION TYPE)
      if ((trimmedLine.includes('TRANSCRIPT OF') || 
           trimmedLine.includes('MORNING SESSION') || 
           trimmedLine.includes('AFTERNOON SESSION') ||
           trimmedLine.includes('JURY TRIAL') ||
           trimmedLine.includes('BENCH TRIAL')) && 
          i > 10 && i < 80 && 
          currentSection?.sectionType === 'CASE_TITLE') {
        // This is the transcript info part that comes after case title
        if (currentSection && currentLines.length > 0) {
          // Find where TRANSCRIPT OF starts in currentLines
          let transcriptStartIdx = -1;
          for (let j = currentLines.length - 1; j >= 0; j--) {
            if (currentLines[j].includes('TRANSCRIPT OF')) {
              transcriptStartIdx = j;
              break;
            }
          }
          
          if (transcriptStartIdx > 0) {
            // Split the current lines into case title and transcript info
            const caseTitleLines = currentLines.slice(0, transcriptStartIdx);
            const transcriptInfoLines = currentLines.slice(transcriptStartIdx);
            
            // Save the case title section
            currentSection.sectionText = caseTitleLines.join('\n');
            currentSection.metadata = this.extractCaseTitleMetadata(caseTitleLines);
            sections.push(currentSection);
            
            // Start new transcript info section with the lines we already have
            currentSection = {
              sectionType: 'TRANSCRIPT_INFO',
              sectionText: '',
              orderIndex: orderIndex++,
              metadata: {}
            };
            currentLines = [...transcriptInfoLines, cleanedLine];
          } else {
            // Just add to current lines
            currentLines.push(cleanedLine);
          }
        } else {
          currentLines.push(cleanedLine);
        }
        continue;
      }
      
      // Detect Session Info section (date and time)
      if (this.isDateLine(trimmedLine) && i > 10 && i < 80) {
        if (currentSection && currentLines.length > 0) {
          currentSection.sectionText = currentLines.join('\n');
          // Extract metadata based on section type
          if (currentSection.sectionType === 'CASE_TITLE') {
            currentSection.metadata = this.extractCaseTitleMetadata(currentLines);
          } else if (currentSection.sectionType === 'TRANSCRIPT_INFO') {
            currentSection.metadata = this.extractTranscriptInfoMetadata(currentLines);
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
        currentLines = [cleanedLine];
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
        currentLines = [cleanedLine];
        continue;
      }
      
      // Detect Appearances section
      // Now using cleaned line for detection
      if (trimmedLine.match(/FOR THE PLAINTIFF/i) || 
          trimmedLine.match(/FOR THE DEFENDANT/i) ||
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
        currentLines = [cleanedLine];
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
        currentLines.push(cleanedLine);
        continue;
      }
      
      // Add CLEANED line to current section if we have one
      // We want the cleaned version without line prefixes for section content
      if (currentSection) {
        currentLines.push(cleanedLine);
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
   * Extract transcript info metadata
   */
  private extractTranscriptInfoMetadata(lines: string[]): SectionMetadata {
    const metadata: SectionMetadata = {};
    
    for (const line of lines) {
      const trimmed = line.trim();
      
      // Extract transcript type
      if (trimmed.includes('TRANSCRIPT OF')) {
        metadata.transcriptType = trimmed.replace('TRANSCRIPT OF', '').trim();
      }
      
      // Extract session type
      if (trimmed.includes('MORNING SESSION')) {
        metadata.sessionType = 'MORNING';
      } else if (trimmed.includes('AFTERNOON SESSION')) {
        metadata.sessionType = 'AFTERNOON';
      } else if (trimmed.includes('EVENING SESSION')) {
        metadata.sessionType = 'EVENING';
      }
      
      // Extract trial type
      if (trimmed.includes('JURY TRIAL')) {
        metadata.trialType = 'JURY';
      } else if (trimmed.includes('BENCH TRIAL')) {
        metadata.trialType = 'BENCH';
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
  
  /**
   * Clean section text by removing line prefixes and page headers
   */
  private cleanSectionText(text: string): string {
    const lines = text.split('\n');
    const cleanedLines: string[] = [];
    
    for (const line of lines) {
      // Skip page headers
      if (line.includes('Case ') && line.includes(' Document ') && line.includes(' PageID')) {
        continue;
      }
      
      // IMPORTANT: Check if this is a continuation line FIRST
      // Continuation lines start with spaces and should NOT be parsed for line numbers
      if (line.match(/^\s+/)) {
        // This is a continuation line - just trim and keep it
        const trimmed = line.trim();
        if (trimmed) {
          cleanedLines.push(trimmed);
        }
        continue; // Skip to next line
      }
      
      // For lines that start at position 0, try to parse with LineParser
      const parsed = this.lineParser.parse(line);
      
      // Check if LineParser gave us a result
      if (parsed && parsed.text !== undefined) {
        // LineParser successfully parsed the line
        // Now check if the PARSED TEXT (not original line) looks like an address
        if (parsed.text && parsed.text.match(/^\d{1,4}\s+[A-Z][a-z]/)) {
          // The parsed text starts with digits followed by a capitalized word
          // This might be a street address that LineParser mistakenly cleaned
          // Examples: "230 Park Avenue", "104 East Houston", "2040 Main Street"
          // In this case, use the parsed text as-is (LineParser already removed the line number)
          cleanedLines.push(parsed.text);
        } else if (parsed.text) {
          // Normal case - trust LineParser's result
          cleanedLines.push(parsed.text);
        }
      } else if (!parsed?.isBlank) {
        // LineParser couldn't handle it, try manual prefix removal
        let cleanedLine = line;
        
        // Check for SUMMARY format (7-char numeric prefix like "17     ")
        // Must be 1-2 digits followed by at least 5 spaces
        const summaryMatch = line.match(/^(\d{1,2})\s{5,}(.*)/);
        if (summaryMatch) {
          cleanedLine = summaryMatch[2];
        } else {
          // Check for PROCEEDINGS format (13-char timestamp+number prefix)
          const proceedingsMatch = line.match(/^(\d{2}:\d{2}:\d{2}\s+\d+)\s+(.*)/);
          if (proceedingsMatch) {
            cleanedLine = proceedingsMatch[2];
          } else {
            // Check for simple line number at start (e.g., "123 " or "1 ")
            // But be careful not to match things like "230 Park Avenue"
            // Only match if followed by multiple spaces or uppercase text that looks like a label
            const simpleMatch = line.match(/^(\d{1,3})\s{2,}(.*)/);
            if (simpleMatch) {
              // Additional check: is this likely a line number or part of content?
              const afterNumber = simpleMatch[2];
              // If what follows looks like a label or name (all caps or title case), it's likely a line number
              if (afterNumber.match(/^[A-Z]/) || afterNumber.match(/^(FOR|MR\.|MS\.|DR\.)/)) {
                cleanedLine = simpleMatch[2];
              } else {
                // Likely part of content (like an address), keep the whole line
                cleanedLine = line;
              }
            } else {
              // No prefix detected, keep the line as-is
              cleanedLine = line;
            }
          }
        }
        
        // Only add non-empty cleaned lines
        const trimmed = cleanedLine.trim();
        if (trimmed) {
          cleanedLines.push(trimmed);
        }
      }
    }
    
    return cleanedLines.join('\n');
  }
}