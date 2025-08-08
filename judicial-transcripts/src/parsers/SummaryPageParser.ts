// src/parsers/SummaryPageParser.ts
import { TrialSummaryInfo, AttorneyInfo, AddressInfo } from '../types/config.types';
import logger from '../utils/logger';

export class SummaryPageParser {
  parse(pages: string[][]): TrialSummaryInfo | null {
    if (pages.length < 1) {
      logger.warn('No pages provided for summary parsing');
      return null;
    }
    
    const allLines = pages.flat();
    const text = allLines.join('\n');
    
    logger.info('SummaryPageParser: Starting parse');
    logger.info('SummaryPageParser: Text length:', text.length);
    
    const info: TrialSummaryInfo = {
      trialName: '',
      caseNumber: '',
      court: '',
      courtDivision: undefined,
      courtDistrict: undefined,
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
  
  private extractCourtInfo(text: string, info: TrialSummaryInfo): void {
    // Look for court information in the first few lines
    // Pattern: "IN THE UNITED STATES DISTRICT COURT"
    const courtMatch = text.match(/IN THE ([A-Z\s]+COURT)/i);
    if (courtMatch) {
      info.court = courtMatch[1];
      logger.info('✓ Extracted court:', info.court);
    }
    
    // Pattern: "FOR THE EASTERN DISTRICT OF TEXAS"
    const divisionMatch = text.match(/FOR THE ([A-Z\s]+DISTRICT[A-Z\s]*)/i);
    if (divisionMatch) {
      info.courtDivision = divisionMatch[1];
      logger.info('✓ Extracted court division:', info.courtDivision);
    }
    
    // Pattern: "MARSHALL DIVISION"
    const districtMatch = text.match(/([A-Z]+\s+DIVISION)/);
    if (districtMatch) {
      info.courtDistrict = districtMatch[1];
      logger.info('✓ Extracted court district:', info.courtDistrict);
    }
  }
  
  private extractCaseNumber(text: string, info: TrialSummaryInfo): void {
    // Multiple patterns for case numbers
    const patterns = [
      /CIVIL ACTION NO\.\s*\)\(\s*([\d:\-CV\-cv]+)/,
      /(?:CIVIL ACTION NO\.|Case No\.|Cause No\.)\s*([\d:\-CV\-cv]+)/,
      /No\.\s*([\d:\-cv]+)/i
    ];
    
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        info.caseNumber = match[1];
        logger.info('✓ Extracted case number:', info.caseNumber);
        break;
      }
    }
  }
  
  private extractTrialName(text: string, info: TrialSummaryInfo): void {
    // Handle the )( format in trial names
    const trialNamePattern = /^([A-Z\s,\.&]+?),?\s*\)\(\s*PLAINTIFF.*?VS\.\s*\)\(.*?\)\(.*?([A-Z\s,\.&]+?),?\s*\)\(.*?DEFENDANTS?\./ms;
    const trialNameMatch = text.match(trialNamePattern);
    if (trialNameMatch) {
      info.trialName = `${trialNameMatch[1].trim()} VS. ${trialNameMatch[2].trim()}`;
      logger.info('✓ Extracted trial name:', info.trialName);
    } else {
      // Fallback patterns
      const plaintiffMatch = text.match(/^([A-Z\s,\.&]+),\s*\)\(\s*PLAINTIFF/m);
      const defendantMatch = text.match(/([A-Z\s,\.&]+),?\s*\)\(.*?DEFENDANTS?\./m);
      
      if (plaintiffMatch && defendantMatch) {
        info.trialName = `${plaintiffMatch[1].trim()} VS. ${defendantMatch[1].trim()}`;
        logger.info('✓ Extracted trial name (fallback):', info.trialName);
      }
    }
  }
  
  private extractJudgeInfo(text: string, info: TrialSummaryInfo): void {
    // Pattern for judge: "HONORABLE RODNEY GILSTRAP"
    const judgeMatch = text.match(/(HONORABLE)\s+([A-Z\s]+?)(?:\s*\)\(|$)/m);
    if (judgeMatch) {
      info.judge.honorific = judgeMatch[1];
      info.judge.name = judgeMatch[2].trim();
      info.judge.title = 'UNITED STATES DISTRICT JUDGE'; // Common default
      logger.info('✓ Extracted judge:', `${info.judge.honorific} ${info.judge.name}`);
    }
  }
  
  private extractAttorneys(text: string, info: TrialSummaryInfo): void {
    // Extract plaintiff attorneys
    const plaintiffSection = this.extractSection(text, 'PLAINTIFF', 'DEFENDANT');
    if (plaintiffSection) {
      info.plaintiffAttorneys = this.parseAttorneys(plaintiffSection, 'PLAINTIFF');
    }
    
    // Extract defendant attorneys
    const defendantSection = this.extractSection(text, 'DEFENDANT', 'HONORABLE');
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
    const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    
    let currentAttorneys: string[] = [];
    let currentFirm: { name: string; address: AddressInfo } | null = null;
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      
      // Skip section headers
      if (trimmed.includes(side) || trimmed.includes('ATTORNEYS FOR')) continue;
      
      // Check if this is an attorney name (all caps, likely person name)
      if (/^[A-Z\s\.]+$/.test(trimmed) && trimmed.length < 50 && 
          !trimmed.includes('STREET') && !trimmed.includes('AVENUE') && 
          !trimmed.includes('DRIVE') && !/\d/.test(trimmed)) {
        currentAttorneys.push(trimmed);
      }
      // Check if this is a law firm name
      else if (trimmed.includes('LAW') || trimmed.includes('ATTORNEYS') || 
               trimmed.includes('LLP') || trimmed.includes('PLLC') ||
               trimmed.includes('PC') || trimmed.includes('P.C.')) {
        // Save previous attorneys with their firm
        if (currentAttorneys.length > 0 && currentFirm) {
          for (const attorneyName of currentAttorneys) {
            attorneys.push({
              name: attorneyName,
              lawFirm: currentFirm
            });
          }
          currentAttorneys = [];
        }
        
        currentFirm = {
          name: trimmed,
          address: {}
        };
      }
      // Check if this is address information
      else if (currentFirm) {
        if (/^\d+\s+/.test(trimmed)) {
          currentFirm.address.street1 = trimmed;
        } else if (/^[A-Z][a-z]+.*,\s*[A-Z]{2}\s+\d{5}/.test(trimmed)) {
          const cityStateZip = trimmed.match(/^([^,]+),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)/);
          if (cityStateZip) {
            currentFirm.address.city = cityStateZip[1];
            currentFirm.address.state = cityStateZip[2];
            currentFirm.address.zipCode = cityStateZip[3];
          }
        }
      }
    }
    
    // Save last set of attorneys
    if (currentAttorneys.length > 0) {
      for (const attorneyName of currentAttorneys) {
        attorneys.push({
          name: attorneyName,
          lawFirm: currentFirm || undefined
        });
      }
    }
    
    logger.info(`✓ Extracted ${attorneys.length} attorneys for ${side}`);
    return attorneys;
  }
  
  private extractCourtReporter(text: string, info: TrialSummaryInfo): void {
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
    
    // Look for phone number
    const phoneMatch = reporterSection.match(/\(?\d{3}\)?[\s\-]?\d{3}[\s\-]?\d{4}/);
    if (phoneMatch) {
      reporter.phone = phoneMatch[0];
    }
    
    if (reporter.name) {
      info.courtReporter = reporter;
      logger.info('✓ Extracted court reporter:', reporter.name);
    }
  }
}