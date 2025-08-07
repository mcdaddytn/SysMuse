// src/parsers/SummaryPageParser.ts
import { TrialSummaryInfo, AttorneyInfo, AddressInfo } from '../types/config.types';
import logger from '../utils/logger';

export class SummaryPageParser {
  parse(pages: string[][]): TrialSummaryInfo | null {
    if (pages.length < 2) {
      logger.warn('Not enough pages for summary parsing');
      return null;
    }
    
    const allLines = pages.flat();
    const text = allLines.join('\n');
    
    // Debug logging
    logger.info('SummaryPageParser: Parsing text with length:', text.length);
    logger.info('SummaryPageParser: First 500 characters:', text.substring(0, 500));
    
    const info: TrialSummaryInfo = {
      trialName: '',
      caseNumber: '',
      court: '',
      courtDivision: undefined,
      judge: {
        name: '',
        title: undefined,
        honorific: undefined
      },
      plaintiffAttorneys: [],
      defendantAttorneys: []
    };
    
    // Extract trial name - Updated pattern for your format
    const trialNamePattern = /^([A-Z\s,\.&]+?),?\s*\)\(\s*PLAINTIFF,?\s*\)\([^)]*\)\([^)]*\)\(\s*VS\.\s*\)\([^)]*\)\([^)]*\)\(\s*([A-Z\s,\.&]+?),?\s*\)\([^)]*\)\(\s*DEFENDANTS?\./m;
    const trialNameMatch = text.match(trialNamePattern);
    if (trialNameMatch) {
      info.trialName = `${trialNameMatch[1].trim()} VS. ${trialNameMatch[2].trim()}`;
      logger.info('SummaryPageParser: Extracted trial name:', info.trialName);
    } else {
      // Fallback simpler pattern
      const simpleTrialPattern = /^([A-Z\s,\.&]+),\s*PLAINTIFF.*?VS\.\s*([A-Z\s,\.&]+),\s*DEFENDANTS?\./m;
      const simpleMatch = text.match(simpleTrialPattern);
      if (simpleMatch) {
        info.trialName = `${simpleMatch[1].trim()} VS. ${simpleMatch[2].trim()}`;
        logger.info('SummaryPageParser: Extracted trial name (fallback):', info.trialName);
      }
    }
    
    // Extract case number - Updated pattern
    const caseNumberPattern = /CIVIL ACTION NO\.\s*\)\(\s*([\d:\-CV\-cv]+)/;
    const caseNumberMatch = text.match(caseNumberPattern);
    if (caseNumberMatch) {
      info.caseNumber = caseNumberMatch[1];
      logger.info('SummaryPageParser: Extracted case number:', info.caseNumber);
    }
    
    // Extract court - Updated pattern
    const courtPattern = /IN THE UNITED STATES DISTRICT COURT\s+FOR THE ([A-Z\s]+)/;
    const courtMatch = text.match(courtPattern);
    if (courtMatch) {
      info.court = `UNITED STATES DISTRICT COURT FOR THE ${courtMatch[1].trim()}`;
      logger.info('SummaryPageParser: Extracted court:', info.court);
    }
    
    // Extract court division
    const divisionPattern = /([A-Z]+)\s+DIVISION/;
    const divisionMatch = text.match(divisionPattern);
    if (divisionMatch) {
      info.courtDivision = `${divisionMatch[1]} DIVISION`;
      logger.info('SummaryPageParser: Extracted division:', info.courtDivision);
    }
    
    // Extract judge - Updated pattern
    const judgePattern = /BEFORE THE (HONORABLE\s+)?JUDGE\s+([A-Z\s\.]+)/;
    const judgeMatch = text.match(judgePattern);
    if (judgeMatch) {
      info.judge = {
        name: judgeMatch[2].trim(),
        title: undefined,
        honorific: judgeMatch[1] ? 'HONORABLE' : undefined
      };
      
      // Look for judge title on next lines
      const titlePattern = /UNITED STATES ([A-Z\s]+) JUDGE/;
      const titleMatch = text.match(titlePattern);
      if (titleMatch) {
        info.judge.title = `UNITED STATES ${titleMatch[1].trim()} JUDGE`;
      }
      
      logger.info('SummaryPageParser: Extracted judge:', info.judge);
    }
    
    // Extract attorneys
    info.plaintiffAttorneys = this.extractAttorneys(text, 'PLAINTIFF');
    info.defendantAttorneys = this.extractAttorneys(text, 'DEFENDANT');
    
    logger.info('SummaryPageParser: Extracted plaintiff attorneys:', info.plaintiffAttorneys.length);
    logger.info('SummaryPageParser: Extracted defendant attorneys:', info.defendantAttorneys.length);
    
    // Extract court reporter
    const reporterPattern = /COURT REPORTER:\s*([^\n]+)/;
    const reporterMatch = text.match(reporterPattern);
    if (reporterMatch) {
      const reporterInfo = this.parseCourtReporter(text, reporterMatch.index!);
      if (reporterInfo) {
        info.courtReporter = reporterInfo;
        logger.info('SummaryPageParser: Extracted court reporter:', reporterInfo.name);
      }
    }
    
    // Validate that we extracted essential information
    if (!info.caseNumber || !info.trialName) {
      logger.error('SummaryPageParser: Failed to extract essential trial information');
      logger.error('SummaryPageParser: Case number:', info.caseNumber);
      logger.error('SummaryPageParser: Trial name:', info.trialName);
      return null;
    }
    
    logger.info('SummaryPageParser: Successfully parsed summary info');
    return info;
  }
  
  // Rest of the methods remain the same...
  private extractAttorneys(text: string, side: 'PLAINTIFF' | 'DEFENDANT'): AttorneyInfo[] {
    const attorneys: AttorneyInfo[] = [];
    const sectionRegex = new RegExp(`FOR THE ${side}[S]?:([\\s\\S]+?)(?:FOR THE|COURT REPORTER|TRANSCRIPT OF|$)`, 'i');
    const sectionMatch = text.match(sectionRegex);
    
    if (!sectionMatch) {
      logger.warn(`SummaryPageParser: No section found for ${side}`);
      return attorneys;
    }
    
    const section = sectionMatch[1];
    const lines = section.split('\n');
    
    let currentAttorneys: string[] = [];
    let currentFirm: { name: string; address: AddressInfo } | null = null;
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      
      // Check if it's an attorney name (starts with MR./MS./MRS./DR.)
      if (/^(MR\.|MS\.|MRS\.|DR\.)\s+[A-Z]/.test(trimmed)) {
        currentAttorneys.push(trimmed);
      }
      // Check if it's a law firm name (all caps, ends with LLP/LLC/P.C./etc)
      else if (/[A-Z\s&,]+(?:LLP|LLC|P\.C\.|PC|P\.A\.|PLLC)/.test(trimmed)) {
        // Save previous attorneys if any
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
          name: trimmed,
          address: {}
        };
        currentAttorneys = [];
      }
      // Check if it's an address line
      else if (currentFirm && /\d/.test(trimmed)) {
        if (/^\d+\s+[A-Z]/.test(trimmed) || /Suite|Floor|Street|Avenue|Road|Drive|Boulevard/.test(trimmed)) {
          if (!currentFirm.address.street1) {
            currentFirm.address.street1 = trimmed;
          } else if (!currentFirm.address.street2) {
            currentFirm.address.street2 = trimmed;
          }
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
    
    logger.info(`SummaryPageParser: Extracted ${attorneys.length} attorneys for ${side}`);
    return attorneys;
  }
  
  private parseCourtReporter(text: string, startIndex: number): any {
    const lines = text.substring(startIndex).split('\n').slice(0, 10);
    
    const reporter: any = {
      name: '',
      credentials: undefined,
      phone: undefined,
      address: undefined
    };
    
    // First line should have name and credentials
    const firstLine = lines[0].replace('COURT REPORTER:', '').trim();
    const credMatch = firstLine.match(/([^,]+),?\s*([A-Z,\s]+)?/);
    if (credMatch) {
      reporter.name = credMatch[1].trim();
      reporter.credentials = credMatch[2]?.trim();
    }
    
    // Look for phone number
    const phoneMatch = lines.join(' ').match(/\(?\d{3}\)?[\s\-]?\d{3}[\s\-]?\d{4}/);
    if (phoneMatch) {
      reporter.phone = phoneMatch[0];
    }
    
    // Parse address
    const address: AddressInfo = {};
    for (const line of lines.slice(1)) {
      const trimmed = line.trim();
      if (/^\d+\s+[A-Z]/.test(trimmed)) {
        address.street1 = trimmed;
      } else if (/^[A-Z][a-z]+.*,\s*[A-Z]{2}/.test(trimmed)) {
        const parts = trimmed.split(',');
        if (parts[0]) address.city = parts[0].trim();
        if (parts[1]) {
          const stateZip = parts[1].trim().split(/\s+/);
          address.state = stateZip[0];
          address.zipCode = stateZip[1];
        }
      }
    }
    
    if (Object.keys(address).length > 0) {
      reporter.address = address;
    }
    
    return reporter;
  }
}
