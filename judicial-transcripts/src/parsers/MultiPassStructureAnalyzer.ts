import { Logger } from '../utils/logger';
import {
  ParsedMetadata,
  StructureAnalysis,
  SectionBoundary,
  DocumentSection
} from './MultiPassTypes';

export class StructureAnalyzer {
  private logger: Logger;
  
  private readonly SUMMARY_INDICATORS = [
    /APPEARANCES/i,
    /COUNSEL FOR/i,
    /ATTORNEY FOR/i,
    /REPRESENTING/i,
    /LAW FIRM/i,
    /^\s*THE COURT:/i,
    /^\s*JUDGE\s/i
  ];
  
  private readonly PROCEEDINGS_INDICATORS = [
    /PROCEEDINGS/i,
    /^\s*\d{2}:\d{2}:\d{2}/,
    /THE COURT:/,
    /THE WITNESS:/,
    /DIRECT EXAMINATION/i,
    /CROSS EXAMINATION/i,
    /REDIRECT EXAMINATION/i,
    /RECROSS EXAMINATION/i
  ];
  
  private readonly CERTIFICATION_INDICATORS = [
    /CERTIFICATION/i,
    /COURT REPORTER/i,
    /CERTIFIED/i,
    /TRANSCRIBED/i,
    /NOTARY PUBLIC/i,
    /TRUE AND CORRECT/i
  ];

  constructor(logger: Logger) {
    this.logger = logger;
  }

  async analyzeStructure(metadata: ParsedMetadata): Promise<StructureAnalysis> {
    this.logger.info('Analyzing document structure');
    
    const sections: SectionBoundary[] = [];
    const sectionMapping = new Map<number, DocumentSection>();
    
    const summaryBoundary = this.findSummarySection(metadata);
    if (summaryBoundary) {
      sections.push(summaryBoundary);
      this.mapSectionLines(summaryBoundary, sectionMapping);
    }
    
    const proceedingsBoundary = this.findProceedingsSection(metadata, summaryBoundary);
    if (proceedingsBoundary) {
      sections.push(proceedingsBoundary);
      this.mapSectionLines(proceedingsBoundary, sectionMapping);
    }
    
    const certificationBoundary = this.findCertificationSection(metadata, proceedingsBoundary);
    if (certificationBoundary) {
      sections.push(certificationBoundary);
      this.mapSectionLines(certificationBoundary, sectionMapping);
    }
    
    for (const [lineNum, line] of metadata.lines) {
      if (!sectionMapping.has(lineNum)) {
        sectionMapping.set(lineNum, DocumentSection.UNKNOWN);
      }
    }
    
    this.logger.info(`Identified ${sections.length} sections`);
    sections.forEach(section => {
      this.logger.debug(
        `${section.section}: Lines ${section.startLine}-${section.endLine}, Pages ${section.startPage}-${section.endPage}`
      );
    });
    
    return {
      sections,
      sectionMapping
    };
  }

  private findSummarySection(metadata: ParsedMetadata): SectionBoundary | null {
    let startLine = -1;
    let endLine = -1;
    let startPage = 1;
    let endPage = 1;
    let indicatorCount = 0;
    
    const linesToCheck = Math.min(150, metadata.lines.size);
    const lineEntries = Array.from(metadata.lines.entries()).slice(0, linesToCheck);
    
    for (let i = 0; i < lineEntries.length; i++) {
      const [lineNum, line] = lineEntries[i];
      const text = line.cleanText;
      
      for (const pattern of this.SUMMARY_INDICATORS) {
        if (pattern.test(text)) {
          if (startLine === -1) {
            startLine = lineNum;
            const location = metadata.fileLineMapping.get(line.fileLineNumber);
            if (location) {
              startPage = location.pageNumber;
            }
          }
          indicatorCount++;
          break;
        }
      }
      
      if (text.includes('PROCEEDINGS') && indicatorCount > 0) {
        endLine = lineNum - 1;
        const location = metadata.fileLineMapping.get(line.fileLineNumber);
        if (location) {
          endPage = location.pageNumber;
        }
        break;
      }
      
      if (/^\s*\d{2}:\d{2}:\d{2}/.test(text)) {
        if (indicatorCount > 0) {
          endLine = lineNum - 1;
          const prevLine = lineEntries[i - 1];
          if (prevLine) {
            const location = metadata.fileLineMapping.get(prevLine[1].fileLineNumber);
            if (location) {
              endPage = location.pageNumber;
            }
          }
        }
        break;
      }
    }
    
    if (startLine === -1 || indicatorCount < 2) {
      this.logger.debug('No clear SUMMARY section found');
      return null;
    }
    
    if (endLine === -1) {
      endLine = Math.min(100, metadata.lines.size - 1);
      const lastLine = lineEntries[lineEntries.length - 1];
      if (lastLine) {
        const location = metadata.fileLineMapping.get(lastLine[1].fileLineNumber);
        if (location) {
          endPage = location.pageNumber;
        }
      }
    }
    
    return {
      section: DocumentSection.SUMMARY,
      startLine,
      endLine,
      startPage,
      endPage
    };
  }

  private findProceedingsSection(
    metadata: ParsedMetadata,
    summaryBoundary: SectionBoundary | null
  ): SectionBoundary | null {
    let startLine = -1;
    let endLine = -1;
    let startPage = 1;
    let endPage = 1;
    
    const startSearchLine = summaryBoundary ? summaryBoundary.endLine + 1 : 0;
    const lineEntries = Array.from(metadata.lines.entries());
    
    for (let i = 0; i < lineEntries.length; i++) {
      const [lineNum, line] = lineEntries[i];
      
      if (lineNum < startSearchLine) continue;
      
      const text = line.cleanText;
      
      if (startLine === -1) {
        if (text.includes('PROCEEDINGS') || /^\s*\d{2}:\d{2}:\d{2}/.test(text)) {
          startLine = lineNum;
          const location = metadata.fileLineMapping.get(line.fileLineNumber);
          if (location) {
            startPage = location.pageNumber;
          }
          continue;
        }
        
        for (const pattern of this.PROCEEDINGS_INDICATORS) {
          if (pattern.test(text)) {
            startLine = lineNum;
            const location = metadata.fileLineMapping.get(line.fileLineNumber);
            if (location) {
              startPage = location.pageNumber;
            }
            break;
          }
        }
      } else {
        for (const pattern of this.CERTIFICATION_INDICATORS) {
          if (pattern.test(text)) {
            endLine = lineNum - 1;
            const prevLine = lineEntries[i - 1];
            if (prevLine) {
              const location = metadata.fileLineMapping.get(prevLine[1].fileLineNumber);
              if (location) {
                endPage = location.pageNumber;
              }
            }
            break;
          }
        }
        
        if (endLine !== -1) break;
      }
    }
    
    if (startLine === -1) {
      this.logger.debug('No PROCEEDINGS section found');
      return null;
    }
    
    if (endLine === -1) {
      endLine = metadata.lines.size - 1;
      const lastLine = lineEntries[lineEntries.length - 1];
      if (lastLine) {
        const location = metadata.fileLineMapping.get(lastLine[1].fileLineNumber);
        if (location) {
          endPage = location.pageNumber;
        }
      }
    }
    
    return {
      section: DocumentSection.PROCEEDINGS,
      startLine,
      endLine,
      startPage,
      endPage
    };
  }

  private findCertificationSection(
    metadata: ParsedMetadata,
    proceedingsBoundary: SectionBoundary | null
  ): SectionBoundary | null {
    let startLine = -1;
    let endLine = -1;
    let startPage = 1;
    let endPage = 1;
    
    const startSearchLine = proceedingsBoundary ? 
      Math.max(proceedingsBoundary.endLine - 50, 0) : 
      Math.max(metadata.lines.size - 100, 0);
    
    const lineEntries = Array.from(metadata.lines.entries());
    
    for (let i = 0; i < lineEntries.length; i++) {
      const [lineNum, line] = lineEntries[i];
      
      if (lineNum < startSearchLine) continue;
      
      const text = line.cleanText;
      
      for (const pattern of this.CERTIFICATION_INDICATORS) {
        if (pattern.test(text)) {
          if (startLine === -1) {
            startLine = lineNum;
            const location = metadata.fileLineMapping.get(line.fileLineNumber);
            if (location) {
              startPage = location.pageNumber;
            }
          }
          endLine = lineNum;
          const location = metadata.fileLineMapping.get(line.fileLineNumber);
          if (location) {
            endPage = location.pageNumber;
          }
        }
      }
    }
    
    if (startLine === -1) {
      this.logger.debug('No CERTIFICATION section found');
      return null;
    }
    
    if (endLine === -1 || endLine === startLine) {
      endLine = metadata.lines.size - 1;
      const lastLine = lineEntries[lineEntries.length - 1];
      if (lastLine) {
        const location = metadata.fileLineMapping.get(lastLine[1].fileLineNumber);
        if (location) {
          endPage = location.pageNumber;
        }
      }
    }
    
    return {
      section: DocumentSection.CERTIFICATION,
      startLine,
      endLine,
      startPage,
      endPage
    };
  }

  private mapSectionLines(boundary: SectionBoundary, sectionMapping: Map<number, DocumentSection>): void {
    for (let lineNum = boundary.startLine; lineNum <= boundary.endLine; lineNum++) {
      sectionMapping.set(lineNum, boundary.section);
    }
  }
}