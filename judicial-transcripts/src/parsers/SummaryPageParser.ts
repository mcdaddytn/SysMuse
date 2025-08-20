// src/parsers/SummaryPageParser.ts
import { SummaryInfo, AttorneyInfo, AddressInfo } from '../types/config.types';
import logger from '../utils/logger';

export class SummaryPageParser {
  parse(pages: string[][]): SummaryInfo | null {
    if (pages.length < 1) {
      logger.warn('No pages provided for summary parsing');
      return null;
    }
    
    const allLines = pages.flat();
    const text = allLines.join('\n');
    
    logger.info('SummaryPageParser: Starting parse');
    logger.info('SummaryPageParser: Text length:', text.length);
    
    const info: SummaryInfo = {
      caseInfo: {
        name: '',
        caseNumber: '',
        court: '',
        courtDivision: undefined,
        courtDistrict: undefined
      },
      judge: {
        name: '',
        title: undefined,
        honorific: undefined
      },
      plaintiffAttorneys: [],
      defendantAttorneys: []
    };
    
    // Extract court information from header lines
    this.extractCourtInfo(text, info);
    
    // Extract case number
    this.extractCaseNumber(text, info);
    
    // Extract trial name
    this.extractTrialName(text, info);
    
    // Extract judge information
    this.extractJudgeInfo(text, info);
    
    // Extract attorneys
    this.extractAttorneys(text, info);
    
    // Extract court reporter
    this.extractCourtReporter(text, info);
    
    return info;
  }
  
  private extractCourtInfo(text: string, info: SummaryInfo): void {
    // Look for court information in the first few lines
    // Pattern: "IN THE UNITED STATES DISTRICT COURT"
    const courtMatch = text.match(/IN THE ([A-Z\s]+COURT)/i);
    if (courtMatch) {
      info.caseInfo.court = courtMatch[1];
      logger.info('✓ Extracted court:', info.caseInfo.court);
    }
    
    // Pattern: "MARSHALL DIVISION" -> courtDivision (swapped)
    const divisionMatch = text.match(/([A-Z]+\s+DIVISION)/);
    if (divisionMatch) {
      info.caseInfo.courtDivision = divisionMatch[1];
      logger.info('✓ Extracted court division:', info.caseInfo.courtDivision);
    } else {
      // Try to extract from right side of )( format
      const rightSideMatch = text.match(/\)\(\s*([A-Z]+,?\s*[A-Z]*)/);
      if (rightSideMatch && rightSideMatch[1].includes('MARSHALL')) {
        info.caseInfo.courtDivision = rightSideMatch[1].replace(',', '');
        logger.info('✓ Extracted court division (right side):', info.caseInfo.courtDivision);
      }
    }
    
    // Pattern: "FOR THE EASTERN DISTRICT OF TEXAS" -> courtDistrict (swapped)
    const districtMatch = text.match(/FOR THE ([A-Z\s]+DISTRICT[A-Z\s]*)/i);
    if (districtMatch) {
      info.caseInfo.courtDistrict = districtMatch[1];
      logger.info('✓ Extracted court district:', info.caseInfo.courtDistrict);
    }
  }
  
  private extractCaseNumber(text: string, info: SummaryInfo): void {
    // Multiple patterns for case numbers
    const patterns = [
      /CIVIL ACTION NO\.\s*\)\(\s*([\d:\-CV\-cv]+)/,
      /(?:CIVIL ACTION NO\.|Case No\.|Cause No\.)\s*([\d:\-CV\-cv]+)/,
      /No\.\s*([\d:\-cv]+)/i
    ];
    
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        info.caseInfo.caseNumber = match[1];
        logger.info('✓ Extracted case number:', info.caseInfo.caseNumber);
        break;
      }
    }
  }
  
  private extractTrialName(text: string, info: SummaryInfo): void {
    // Parse the trial name from the )( format lines
    // Look for the pattern with plaintiff and defendant information
    
    const lines = text.split('\n');
    const leftSideTexts: string[] = [];
    
    for (const line of lines) {
      // Look for lines with )( format
      if (line.includes(')(')) {
        const leftSide = line.split(')(')[0].trim();
        
        // Skip empty lines and lines that are just numbers
        if (leftSide && !/^\d+$/.test(leftSide) && leftSide.length > 2) {
          // Remove leading line numbers (digits followed by whitespace)
          const cleanedText = leftSide.replace(/^\d+\s*/, '').trim();
          
          if (cleanedText && cleanedText.length > 2) {
            leftSideTexts.push(cleanedText);
          }
        }
      }
    }
    
    // Join the left side texts and clean up
    if (leftSideTexts.length > 0) {
      let trialName = leftSideTexts.join(' ').trim();
      
      // Clean up extra whitespace and format properly
      trialName = trialName.replace(/\s+/g, ' ');
      
      // Ensure proper formatting with commas
      trialName = trialName.replace(/\s*,\s*/g, ', ');
      
      info.caseInfo.name = trialName;
      logger.info('✓ Extracted trial name:', info.caseInfo.name);
    } else {
      // Fallback to simpler pattern matching
      const plaintiffMatch = text.match(/([A-Z\s,\.&]+),\s*\)\(\s*PLAINTIFF/m);
      const defendantMatch = text.match(/([A-Z\s,\.&]+),?\s*\)\(.*?DEFENDANTS?\./m);
      
      if (plaintiffMatch && defendantMatch) {
        info.caseInfo.name = `${plaintiffMatch[1].trim()}, PLAINTIFF, VS. ${defendantMatch[1].trim()}, DEFENDANTS.`;
        logger.info('✓ Extracted trial name (fallback):', info.caseInfo.name);
      }
    }
  }
  
  private extractJudgeInfo(text: string, info: SummaryInfo): void {
    // Pattern for judge: "BEFORE THE HONORABLE JUDGE RODNEY GILSTRAP"
    const judgeMatch = text.match(/BEFORE THE (HONORABLE)\s+(?:JUDGE\s+)?([A-Z\s]+?)(?:\n|\s+UNITED)/m);
    if (judgeMatch && info.judge) {
      info.judge.honorific = judgeMatch[1];
      info.judge.name = judgeMatch[2].trim();
      
      // Look for title on next line
      const titleMatch = text.match(/HONORABLE[^\\n]+\n\s*([A-Z\s]+(?:JUDGE|MAGISTRATE)[A-Z\s]*)/m);
      if (titleMatch) {
        info.judge.title = titleMatch[1].trim();
      } else {
        info.judge.title = 'UNITED STATES DISTRICT JUDGE'; // Common default
      }
      
      logger.info('✓ Extracted judge:', `${info.judge.honorific} ${info.judge.name}, ${info.judge.title}`);
    }
  }
  
  private extractAttorneys(text: string, info: SummaryInfo): void {
    // Extract plaintiff attorneys
    const plaintiffSection = this.extractSection(text, 'FOR THE PLAINTIFF:', 'FOR THE DEFENDANT');
    if (plaintiffSection) {
      info.plaintiffAttorneys = this.parseAttorneys(plaintiffSection, 'PLAINTIFF');
    }
    
    // Extract defendant attorneys
    const defendantSection = this.extractSection(text, 'FOR THE DEFENDANT', 'COURT REPORTER:');
    if (defendantSection) {
      info.defendantAttorneys = this.parseAttorneys(defendantSection, 'DEFENDANT');
    }
  }
  
  private extractSection(text: string, startMarker: string, endMarker: string): string | null {
    const startIndex = text.indexOf(startMarker);
    if (startIndex === -1) return null;
    
    const endIndex = text.indexOf(endMarker, startIndex + startMarker.length);
    if (endIndex === -1) return text.substring(startIndex);
    
    return text.substring(startIndex, endIndex);
  }
  
  private parseAttorneys(text: string, side: string): AttorneyInfo[] {
    const attorneys: AttorneyInfo[] = [];
    const lines = text.split('\n').map(line => {
      // Remove line numbers (digits at start of line)
      return line.replace(/^\s*\d+\s*/, '').trim();
    }).filter(line => line.length > 0);
    
    let currentAttorneys: string[] = [];
    let currentFirm: { name: string; address: AddressInfo } | null = null;
    let collectingAddress = false;
    let addressLines: string[] = [];
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      
      // Skip section headers
      if (line.includes('FOR THE') || line === side + ':') continue;
      
      // Check if this is an attorney name (starts with MR./MS./MRS./DR.)
      if (/^(MR\.|MS\.|MRS\.|DR\.)\s+[A-Z]/.test(line)) {
        // If we're collecting address, save the previous firm first
        if (collectingAddress && currentFirm && addressLines.length > 0) {
          this.parseAddress(addressLines, currentFirm.address);
          addressLines = [];
          collectingAddress = false;
        }
        
        currentAttorneys.push(line);
      }
      // Check if this is a law firm name
      else if (this.isLawFirmName(line)) {
        // Save previous attorneys with their previous firm if any
        if (currentAttorneys.length > 0 && currentFirm) {
          for (const attorneyName of currentAttorneys) {
            attorneys.push({
              name: attorneyName,
              lawFirm: currentFirm
            });
          }
        }
        
        // Start new firm
        currentFirm = {
          name: line,
          address: {}
        };
        
        // Add current attorneys to new firm
        if (currentAttorneys.length > 0) {
          for (const attorneyName of currentAttorneys) {
            attorneys.push({
              name: attorneyName,
              lawFirm: currentFirm
            });
          }
          currentAttorneys = [];
        }
        
        collectingAddress = true;
        addressLines = [];
        
        // Important: Do NOT add the law firm itself as an attorney
        // Law firms are only associated with attorneys, not attorneys themselves
      }
      // Collect address lines
      else if (collectingAddress && currentFirm) {
        addressLines.push(line);
        
        // Check if this looks like the last line of an address (contains state and zip)
        if (/[A-Z]{2}\s+\d{5}/.test(line)) {
          this.parseAddress(addressLines, currentFirm.address);
          addressLines = [];
          collectingAddress = false;
        }
      }
    }
    
    // Save any remaining attorneys
    if (currentAttorneys.length > 0) {
      for (const attorneyName of currentAttorneys) {
        attorneys.push({
          name: attorneyName,
          lawFirm: currentFirm || undefined
        });
      }
    }
    
    // Parse any remaining address
    if (collectingAddress && currentFirm && addressLines.length > 0) {
      this.parseAddress(addressLines, currentFirm.address);
    }
    
    logger.info(`✓ Extracted ${attorneys.length} attorneys for ${side}`);
    attorneys.forEach(att => {
      logger.info(`   - ${att.name}${att.lawFirm ? ' (' + att.lawFirm.name + ')' : ''}`);
    });
    
    return attorneys;
  }
  
  private isLawFirmName(line: string): boolean {
    const firmIndicators = [
      'LLP', 'L.L.P.',
      'PLLC', 'P.L.L.C.',
      'PC', 'P.C.',
      'PA', 'P.A.',
      'LLC', 'L.L.C.',
      'LAW',
      'ATTORNEYS',
      'ASSOCIATES',
      'PARTNERS',
      '& '  // Often in firm names like "Smith & Jones"
    ];
    
    return firmIndicators.some(indicator => line.includes(indicator));
  }
  
  private parseAddress(lines: string[], address: AddressInfo): void {
    if (!lines || lines.length === 0) return;
    
    // First line is usually street address
    if (lines.length > 0) {
      address.street1 = lines[0];
    }
    
    // Look for city, state, zip (usually last line or second to last)
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      const cityStateZip = line.match(/^([^,]+),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)/);
      
      if (cityStateZip) {
        address.city = cityStateZip[1];
        address.state = cityStateZip[2];
        address.zipCode = cityStateZip[3];
        
        // If there are lines between street1 and city/state/zip, it might be street2
        if (i > 0 && i < lines.length - 1) {
          address.street2 = lines.slice(1, i).join(', ');
        }
        
        break;
      }
    }
    
    // Default country
    //gm: needs to be added to data structure
    /*
    if (!address.country) {
      address.country = 'USA';
    }
    */
  }
  
  private extractCourtReporter(text: string, info: SummaryInfo): void {
    const reporterIndex = text.indexOf('COURT REPORTER:');
    if (reporterIndex === -1) return;
    
    const reporterSection = text.substring(reporterIndex, reporterIndex + 500);
    const lines = reporterSection.split('\n').slice(0, 10);
    
    const reporter: any = {
      name: '',
      credentials: undefined,
      phone: undefined,
      address: undefined
    };
    
    // Parse name and credentials from first line
    const firstLine = lines[0].replace('COURT REPORTER:', '').trim();
    const credMatch = firstLine.match(/([^,]+),?\s*([A-Z,\s]+)?/);
    if (credMatch) {
      reporter.name = credMatch[1].trim();
      if (credMatch[2]) {
        reporter.credentials = credMatch[2].trim();
      }
    }
    
    // Look for phone number in the section
    const phoneMatch = reporterSection.match(/\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/);
    if (phoneMatch) {
      reporter.phone = phoneMatch[0];
    }
    
    // Parse address (similar to attorney address parsing)
    const addressLines: string[] = [];
    let startCollecting = false;
    
    for (const line of lines) {
      const trimmed = line.trim();
      
      // Start collecting after we see a street pattern
      if (/^\d+\s+[A-Z]/.test(trimmed)) {
        startCollecting = true;
      }
      
      if (startCollecting && trimmed) {
        addressLines.push(trimmed);
        
        // Stop after city/state/zip
        if (/[A-Z]{2}\s+\d{5}/.test(trimmed)) {
          break;
        }
      }
    }
    
    if (addressLines.length > 0) {
      reporter.address = {};
      this.parseAddress(addressLines, reporter.address);
    }
    
    // Add to info object
    info.courtReporter = reporter;
    
    logger.info(`✓ Extracted court reporter: ${reporter.name}${reporter.credentials ? ', ' + reporter.credentials : ''}`);
  }
}