// src/parsers/phase1/SummaryPageParser.ts
// src/parsers/SummaryPageParser.ts
import { TrialSummaryInfo, AttorneyInfo, AddressInfo } from '../../types/config.types';
import logger from '../../utils/logger';

export class SummaryPageParser {
  parse(pages: string[][]): TrialSummaryInfo | null {
    if (pages.length < 2) {
      logger.warn('Not enough pages for summary parsing');
      return null;
    }
    
    const allLines = pages.flat();
    const text = allLines.join('\n');
    
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
    
    // Extract trial name (PLAINTIFF vs DEFENDANT format)
    const trialNameMatch = text.match(/([A-Z\s,\.]+?),?\s+(PLAINTIFF|Plaintiff)[,\s]+(?:VS?\.?|versus)\s+([A-Z\s,\.&]+?),?\s+(DEFENDANT|Defendant)/);
    if (trialNameMatch) {
      info.trialName = `${trialNameMatch[1].trim()} VS. ${trialNameMatch[3].trim()}`;
    }
    
    // Extract case number
    const caseNumberMatch = text.match(/(?:CIVIL ACTION NO\.|Case No\.|Cause No\.)\s*([\d:\-CV\-cv]+)/);
    if (caseNumberMatch) {
      info.caseNumber = caseNumberMatch[1];
    }
    
    // Extract court
    const courtMatch = text.match(/UNITED STATES DISTRICT COURT(?:\s+FOR THE)?\s+([A-Z\s]+)/);
    if (courtMatch) {
      info.court = `UNITED STATES DISTRICT COURT FOR THE ${courtMatch[1].trim()}`;
    }
    
    // Extract court division
    const divisionMatch = text.match(/([A-Z]+)\s+DIVISION/);
    if (divisionMatch) {
      info.courtDivision = `${divisionMatch[1]} DIVISION`;
    }
    
    // Extract judge
    const judgeMatch = text.match(/(?:HONORABLE\s+)?(?:JUDGE\s+)?([A-Z\s\.]+?)(?:\s+UNITED STATES\s+([A-Z\s]+))?$/m);
    if (judgeMatch) {
      info.judge = {
        name: judgeMatch[1].trim(),
        title: judgeMatch[2] ? judgeMatch[2].trim() : undefined,
        honorific: text.includes('HONORABLE') ? 'HONORABLE' : undefined
      };
    }
    
    // Extract attorneys
    info.plaintiffAttorneys = this.extractAttorneys(text, 'PLAINTIFF');
    info.defendantAttorneys = this.extractAttorneys(text, 'DEFENDANT');
    
    // Extract court reporter
    const reporterMatch = text.match(/COURT REPORTER:\s*([^\n]+)/);
    if (reporterMatch) {
      const reporterInfo = this.parseCourtReporter(text, reporterMatch.index!);
      if (reporterInfo) {
        info.courtReporter = reporterInfo;
      }
    }
    
    return info;
  }
  
  private extractAttorneys(text: string, side: 'PLAINTIFF' | 'DEFENDANT'): AttorneyInfo[] {
    const attorneys: AttorneyInfo[] = [];
    const sectionRegex = new RegExp(`FOR THE ${side}[S]?:([\\s\\S]+?)(?:FOR THE|COURT REPORTER|$)`, 'i');
    const sectionMatch = text.match(sectionRegex);
    
    if (!sectionMatch) return attorneys;
    
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
