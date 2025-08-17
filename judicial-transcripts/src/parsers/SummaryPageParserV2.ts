// src/parsers/SummaryPageParserV2.ts
import { SummaryInfo, AttorneyInfo, AddressInfo } from '../types/config.types';
import { ParserManager } from './ParserManager';
import logger from '../utils/logger';
import { PrismaClient } from '@prisma/client';

export class SummaryPageParserV2 {
  private parserManager: ParserManager;

  constructor(prisma: PrismaClient) {
    this.parserManager = new ParserManager(prisma);
  }

  parse(pages: string[][]): SummaryInfo | null {
    if (pages.length < 1) {
      logger.warn('No pages provided for summary parsing');
      return null;
    }
    
    const allLines = pages.flat();
    const text = allLines.join('\n');
    
    logger.info('SummaryPageParserV2: Starting parse');
    logger.info('SummaryPageParserV2: Text length:', text.length);
    
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
    // Use configured parser for court
    const courtParser = this.parserManager.getParser('court');
    if (courtParser) {
      const result = courtParser.parse(text);
      if (result.matched && result.captures?.courtName) {
        info.caseInfo.court = result.captures.courtName;
        logger.info('✓ Extracted court:', info.caseInfo.court);
      }
    }
    
    // Try division parsers
    const divisionParser = this.parserManager.getParser('courtDivision');
    if (divisionParser) {
      const result = divisionParser.parse(text);
      if (result.matched && result.captures?.divisionName) {
        info.caseInfo.courtDivision = result.captures.divisionName;
        logger.info('✓ Extracted court division:', info.caseInfo.courtDivision);
      }
    }
    
    // Try alternate division parser if no match
    if (!info.caseInfo.courtDivision) {
      const altDivisionParser = this.parserManager.getParser('courtDivisionAlternate');
      if (altDivisionParser) {
        const result = altDivisionParser.parse(text);
        if (result.matched && result.captures?.divisionName && 
            result.captures.divisionName.includes('MARSHALL')) {
          info.caseInfo.courtDivision = result.captures.divisionName.replace(',', '');
          logger.info('✓ Extracted court division (alternate):', info.caseInfo.courtDivision);
        }
      }
    }
    
    // District parser
    const districtParser = this.parserManager.getParser('courtDistrict');
    if (districtParser) {
      const result = districtParser.parse(text);
      if (result.matched && result.captures?.districtName) {
        info.caseInfo.courtDistrict = result.captures.districtName;
        logger.info('✓ Extracted court district:', info.caseInfo.courtDistrict);
      }
    }
  }
  
  private extractCaseNumber(text: string, info: SummaryInfo): void {
    const caseNumberParser = this.parserManager.getParser('caseNumber');
    if (caseNumberParser) {
      const result = caseNumberParser.parse(text);
      if (result.matched && result.captures?.caseNumber) {
        info.caseInfo.caseNumber = result.captures.caseNumber;
        logger.info('✓ Extracted case number:', info.caseInfo.caseNumber);
      }
    }
  }
  
  private extractTrialName(text: string, info: SummaryInfo): void {
    // Parse the trial name from the )( format lines
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
    const judgeParser = this.parserManager.getParser('judge');
    if (judgeParser && info.judge) {
      const result = judgeParser.parse(text);
      if (result.matched && result.captures) {
        info.judge.honorific = result.captures.honorific;
        info.judge.name = result.captures.judgeName?.trim();
        
        // Look for title
        const titleParser = this.parserManager.getParser('judgeTitle');
        if (titleParser) {
          const titleResult = titleParser.parse(text);
          if (titleResult.matched && titleResult.captures?.title) {
            info.judge.title = titleResult.captures.title.trim();
          } else {
            info.judge.title = 'UNITED STATES DISTRICT JUDGE'; // Common default
          }
        }
        
        logger.info('✓ Extracted judge:', `${info.judge.honorific} ${info.judge.name}, ${info.judge.title}`);
      }
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
    
    const attorneyParser = this.parserManager.getParser('attorneyTitle');
    const lawFirmParser = this.parserManager.getParser('lawFirmIndicators');
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      
      // Skip section headers
      if (line.includes('FOR THE') || line === side + ':') continue;
      
      // Check if this is an attorney name
      if (attorneyParser) {
        const attorneyResult = attorneyParser.parse(line);
        if (attorneyResult.matched) {
          // If we're collecting address, save the previous firm first
          if (collectingAddress && currentFirm && addressLines.length > 0) {
            this.parseAddress(addressLines, currentFirm.address);
            addressLines = [];
            collectingAddress = false;
          }
          
          currentAttorneys.push(line);
          continue;
        }
      }
      
      // Check if this is a law firm name
      if (lawFirmParser) {
        const firmResult = lawFirmParser.parse(line);
        if (firmResult.matched) {
          // Save previous attorneys with their firm
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
          continue;
        }
      }
      
      // Collect address lines
      if (collectingAddress && currentFirm) {
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
  
  private parseAddress(lines: string[], address: AddressInfo): void {
    if (!lines || lines.length === 0) return;
    
    // First line is usually street address
    if (lines.length > 0) {
      address.street1 = lines[0];
    }
    
    // Look for city, state, zip using parser
    const addressParser = this.parserManager.getParser('address');
    if (addressParser) {
      for (let i = lines.length - 1; i >= 0; i--) {
        const result = addressParser.parse(lines[i]);
        if (result.matched && result.captures) {
          address.city = result.captures.city;
          address.state = result.captures.state;
          address.zipCode = result.captures.zipCode;
          
          // If there are lines between street1 and city/state/zip, it might be street2
          if (i > 0 && i < lines.length - 1) {
            address.street2 = lines.slice(1, i).join(', ');
          }
          
          break;
        }
      }
    }
  }
  
  private extractCourtReporter(text: string, info: SummaryInfo): void {
    const reporterParser = this.parserManager.getParser('courtReporter');
    if (!reporterParser) return;
    
    const result = reporterParser.parse(text);
    if (!result.matched || !result.captures?.reporterInfo) return;
    
    const reporterSection = text.substring(text.indexOf('COURT REPORTER:'));
    const lines = reporterSection.split('\n').slice(0, 10);
    
    let name = result.captures.reporterInfo.trim();
    let credentials: string | undefined;
    let stateNumber: string | undefined;
    let expirationDate: string | undefined;
    const address: AddressInfo = {};
    
    // Extract credentials and state number
    const credMatch = name.match(/,\s*([A-Z]{3,}(?:[-,\s]+[A-Z]{3,})*)/);
    if (credMatch) {
      credentials = credMatch[1];
      name = name.substring(0, credMatch.index).trim();
    }
    
    // Look for state number and expiration in following lines
    for (const line of lines) {
      const cleanLine = line.replace(/^\s*\d+\s*/, '').trim();
      
      if (cleanLine.includes('CSR No.') || cleanLine.includes('State No.')) {
        const numberMatch = cleanLine.match(/(?:CSR|State)\s*No\.\s*(\d+)/i);
        if (numberMatch) {
          stateNumber = numberMatch[1];
        }
        
        const expMatch = cleanLine.match(/Expires?\s*(?:on\s*)?(\d{1,2}[-/]\d{1,2}[-/]\d{2,4})/i);
        if (expMatch) {
          expirationDate = new Date(expMatch[1]);
        }
      }
    }
    
    // Extract address (similar to attorney address parsing)
    const addressLines: string[] = [];
    let collectingAddress = false;
    
    for (let i = 1; i < lines.length; i++) {
      const cleanLine = lines[i].replace(/^\s*\d+\s*/, '').trim();
      if (!cleanLine) continue;
      
      // Start collecting after name/credentials
      if (!collectingAddress && !cleanLine.includes('CSR No.') && !cleanLine.includes('State No.')) {
        collectingAddress = true;
      }
      
      if (collectingAddress) {
        addressLines.push(cleanLine);
        
        // Stop at city, state, zip
        if (/[A-Z]{2}\s+\d{5}/.test(cleanLine)) {
          this.parseAddress(addressLines, address);
          break;
        }
      }
    }
    
    info.courtReporter = {
      name,
      credentials,
      stateNumber,
      expirationDate,
      address: Object.keys(address).length > 0 ? address : undefined
    };
    
    logger.info('✓ Extracted court reporter:', name);
  }
}