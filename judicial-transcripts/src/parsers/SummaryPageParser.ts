
import { TrialSummaryInfo, AttorneyInfo, AddressInfo } from '../types/config.types';
import logger from '../utils/logger';

export class SummaryPageParser {
  parse(pages: string[][]): TrialSummaryInfo | null {
    // Remove the page count requirement since we'll handle it differently
    if (pages.length < 1) {
      logger.warn('No pages provided for summary parsing');
      return null;
    }
    
    const allLines = pages.flat();
    const text = allLines.join('\n');
    
    // Debug logging
    logger.info('SummaryPageParser: Starting parse');
    logger.info('SummaryPageParser: Text length:', text.length);
    logger.info('SummaryPageParser: First 200 chars:', text.substring(0, 200));
    
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
    
    // Extract case number first - this is most reliable
    const caseNumberPattern = /CIVIL ACTION NO\.\s*\)\(\s*([\d:\-CV\-cv]+)/;
    const caseNumberMatch = text.match(caseNumberPattern);
    if (caseNumberMatch) {
      info.caseNumber = caseNumberMatch[1];
      logger.info('✓ Extracted case number:', info.caseNumber);
    } else {
      // Fallback pattern without the )( formatting
      const fallbackCasePattern = /(?:CIVIL ACTION NO\.|Case No\.|Cause No\.)\s*([\d:\-CV\-cv]+)/;
      const fallbackMatch = text.match(fallbackCasePattern);
      if (fallbackMatch) {
        info.caseNumber = fallbackMatch[1];
        logger.info('✓ Extracted case number (fallback):', info.caseNumber);
      }
    }
    
    // Extract trial name - handle the )( format
    const trialNamePattern = /^([A-Z\s,\.&]+?),?\s*\)\(\s*PLAINTIFF.*?VS\.\s*\)\(.*?\)\(.*?([A-Z\s,\.&]+?),?\s*\)\(.*?DEFENDANTS?\./ms;
    const trialNameMatch = text.match(trialNamePattern);
    if (trialNameMatch) {
      info.trialName = `${trialNameMatch[1].trim()} VS. ${trialNameMatch[2].trim()}`;
      logger.info('✓ Extracted trial name:', info.trialName);
    } else {
      // Simpler fallback that should work with your format
      const plaintiffMatch = text.match(/^([A-Z\s,\.&]+),\s*\)\(\s*PLAINTIFF/m);
      const defendantMatch = text.match(/([A-Z\s,\.&]+),?\s*\)\(.*?DEFENDANTS?\./m);
      
      if (plaintiffMatch && defendantMatch) {
        info.trialName = `${plaintiffMatch[1].trim()} VS. ${defendantMatch[1].trim()}`;
        logger.info('✓ Extracted trial name (fallback):', info.trialName);
      }
    }
    
    // Extract court
    const courtPattern = /IN THE UNITED STATES DISTRICT COURT\s*FOR THE\s*([A-Z\s]+)/;
    const courtMatch = text.match(courtPattern);
    if (courtMatch) {
      info.court = `UNITED STATES DISTRICT COURT FOR THE ${courtMatch[1].trim()}`;
      logger.info('✓ Extracted court:', info.court);
    }
    
    // Extract court division
    const divisionPattern = /([A-Z]+)\s+DIVISION/;
    const divisionMatch = text.match(divisionPattern);
    if (divisionMatch) {
      info.courtDivision = `${divisionMatch[1]} DIVISION`;
      logger.info('✓ Extracted division:', info.courtDivision);
    }
    
    // Extract judge
    const judgePattern = /BEFORE THE (HONORABLE\s+)?JUDGE\s+([A-Z\s\.]+)/;
    const judgeMatch = text.match(judgePattern);
    if (judgeMatch) {
      info.judge = {
        name: judgeMatch[2].trim(),
        title: undefined,
        honorific: judgeMatch[1] ? 'HONORABLE' : undefined
      };
      
      // Look for judge title
      const titlePattern = /UNITED STATES ([A-Z\s]+) JUDGE/;
      const titleMatch = text.match(titlePattern);
      if (titleMatch) {
        info.judge.title = `UNITED STATES ${titleMatch[1].trim()} JUDGE`;
      }
      
      logger.info('✓ Extracted judge:', info.judge);
    }
    
    // Extract attorneys
    info.plaintiffAttorneys = this.extractAttorneys(text, 'PLAINTIFF');
    info.defendantAttorneys = this.extractAttorneys(text, 'DEFENDANT');
    
    logger.info(`✓ Extracted ${info.plaintiffAttorneys.length} plaintiff attorneys`);
    logger.info(`✓ Extracted ${info.defendantAttorneys.length} defendant attorneys`);
    
    // Extract court reporter
    const reporterPattern = /COURT REPORTER:\s*([^\n]+)/;
    const reporterMatch = text.match(reporterPattern);
    if (reporterMatch) {
      const reporterInfo = this.parseCourtReporter(text, reporterMatch.index!);
      if (reporterInfo) {
        info.courtReporter = reporterInfo;
        logger.info('✓ Extracted court reporter:', reporterInfo.name);
      }
    }
    
    // Validate that we extracted essential information
    if (!info.caseNumber) {
      logger.error('✗ Failed to extract case number');
      logger.error('Available text sample:', text.substring(0, 500));
      return null;
    }
    
    if (!info.trialName) {
      logger.warn('⚠ Failed to extract trial name, using fallback');
      info.trialName = `Case ${info.caseNumber}`;
    }
    
    logger.info('✓ Summary parsing completed successfully');
    return info;
  }
  
  // Updated attorney extraction with better debugging
  private extractAttorneys(text: string, side: 'PLAINTIFF' | 'DEFENDANT'): AttorneyInfo[] {
    const attorneys: AttorneyInfo[] = [];
    const sectionRegex = new RegExp(`FOR THE ${side}[S]?:([\\s\\S]+?)(?:FOR THE|COURT REPORTER|TRANSCRIPT OF|Case \\d+|$)`, 'i');
    const sectionMatch = text.match(sectionRegex);
    
    if (!sectionMatch) {
      logger.warn(`No section found for ${side}`);
      return attorneys;
    }
    
    const section = sectionMatch[1];
    logger.info(`${side} section found, length:`, section.length);
    
    const lines = section.split('\n');
    let currentAttorneys: string[] = [];
    let currentFirm: { name: string; address: AddressInfo } | null = null;
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      
      // Check if it's an attorney name (starts with MR./MS./MRS./DR.)
      if (/^(MR\.|MS\.|MRS\.|DR\.)\s+[A-Z]/.test(trimmed)) {
        currentAttorneys.push(trimmed);
        logger.info(`Found attorney: ${trimmed}`);
      }
      // Check if it's a law firm name
      else if (/[A-Z\s&,]+(?:LLP|LLC|P\.C\.|PC|P\.A\.|PLLC|FIRM)/.test(trimmed)) {
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
        logger.info(`Found law firm: ${trimmed}`);
        currentAttorneys = [];
      }
      // Check if it's an address line
      else if (currentFirm && (/\d/.test(trimmed) || /Suite|Floor|Street|Avenue|Road|Drive|Boulevard/.test(trimmed))) {
        if (/^\d+\s+/.test(trimmed) || /Suite|Floor/.test(trimmed)) {
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
    
    logger.info(`Extracted ${attorneys.length} attorneys for ${side}`);
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
    
    // Parse name and credentials from first line after "COURT REPORTER:"
    const firstLine = lines[0].replace('COURT REPORTER:', '').trim();
    const credMatch = firstLine.match(/([^,]+),?\s*([A-Z,\s]+)?/);
    if (credMatch) {
      reporter.name = credMatch[1].trim();
      if (credMatch[2]) {
        reporter.credentials = credMatch[2].trim();
      }
    }
    
    // Look for phone number in any line
    const phoneMatch = lines.join(' ').match(/\(?\d{3}\)?[\s\-]?\d{3}[\s\-]?\d{4}/);
    if (phoneMatch) {
      reporter.phone = phoneMatch[0];
    }
    
    // Parse address from subsequent lines
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
          if (stateZip[1]) address.zipCode = stateZip[1];
        }
      }
    }
    
    if (Object.keys(address).length > 0) {
      reporter.address = address;
    }
    
    return reporter;
  }
}