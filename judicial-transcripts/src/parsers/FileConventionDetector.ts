import * as fs from 'fs';
import * as path from 'path';
import { FileConvention, FileSortingMode, TrialStyleConfig } from '../types/config.types';
import { QAPatternDetector } from '../services/QAPatternDetector';
import { caseNumberExtractor } from '../utils/CaseNumberExtractor';
import { logger } from '../utils/logger';

interface ParsedFileName {
  convention: FileConvention;
  date?: Date;
  session?: string;
  documentId?: string;
  plaintiff?: string;
  defendant?: string;
  metadata?: {
    [key: string]: any;
  };
}

export class FileConventionDetector {
  // Patterns for different file naming conventions
  private readonly patterns = {
    // DATEAMPM: e.g., "Genband_January 11, 2016 AM.txt" or "Optis Apple August 3 2020 AM.txt"
    // Updated to handle both comma and no comma after day, and 4-digit years
    DATEAMPM: /^(.+?)[\s_]+([A-Z][a-z]+\s+\d{1,2}(?:,)?\s+\d{4})\s+(AM|PM|AM\s+and\s+PM)(?:\d+)?\.txt$/i,
    
    // DATETRIAL: e.g., "Koninklijke August 22, 2022 Trial.txt" - indicates full day transcript
    // Similar to DATEAMPM but with "Trial" suffix instead of AM/PM
    DATETRIAL: /^(.+?)[\s_]+([A-Z][a-z]+\s+\d{1,2}(?:,)?\s+\d{4})\s+Trial\.txt$/i,
    
    // DATEMORNAFT: e.g., "NOTICE OF FILING OF OFFICIAL TRANSCRIPT of Proceedings held on 10_1_20 (Trial Transcript - Afternoon.txt"
    // Updated to handle truncated Morning/Afternoon (e.g., "Morning S" for "Morning Session")
    DATEMORNAFT: /.*held on (\d{1,2}_\d{1,2}_\d{2,4}).*\(.*?(Morning|Afternoon|Day).*?\)?\.txt$/i,
    
    // DOCID: e.g., "US_DIS_TXED_2_16cv230_d74990699e16592_NOTICE_OF_FILING_OF_OFFICIAL_TRANSCRIPT_of_Proceed.txt"
    DOCID: /^([^_]+_[^_]+_[^_]+)_([^_]+)_([^_]+)_(.+)\.txt$/i
  };

  detectConvention(files: string[]): FileConvention {
    const conventions: Map<FileConvention, number> = new Map();
    
    // Sample up to 5 files to detect convention
    const samplesToCheck = Math.min(5, files.length);
    
    for (let i = 0; i < samplesToCheck; i++) {
      const file = files[i];
      
      if (this.patterns.DATEAMPM.test(file)) {
        conventions.set('DATEAMPM', (conventions.get('DATEAMPM') || 0) + 1);
      } else if (this.patterns.DATETRIAL.test(file)) {
        // Check for Trial suffix pattern - treat as same convention as DATEAMPM
        conventions.set('DATEAMPM', (conventions.get('DATEAMPM') || 0) + 1);
      } else if (this.patterns.DATEMORNAFT.test(file)) {
        conventions.set('DATEMORNAFT', (conventions.get('DATEMORNAFT') || 0) + 1);
      } else if (this.patterns.DOCID.test(file)) {
        conventions.set('DOCID', (conventions.get('DOCID') || 0) + 1);
      }
    }
    
    // Find convention with most matches (need at least 2 matches)
    let bestConvention: FileConvention = 'AUTO';
    let maxMatches = 1;
    
    conventions.forEach((count, convention) => {
      if (count > maxMatches) {
        maxMatches = count;
        bestConvention = convention;
      }
    });
    
    logger.info(`Detected file convention: ${bestConvention} (${maxMatches}/${samplesToCheck} matches)`);
    return bestConvention;
  }

  parseFileName(fileName: string, convention: FileConvention): ParsedFileName | null {
    if (convention === 'AUTO') {
      // Try each pattern, checking DATETRIAL before DATEAMPM
      if (this.patterns.DATETRIAL.test(fileName)) {
        return this.parseDateTrial(fileName);
      }
      for (const [conv, pattern] of Object.entries(this.patterns)) {
        if (pattern.test(fileName)) {
          convention = conv as FileConvention;
          break;
        }
      }
    }
    
    // Check if it's actually a DATETRIAL pattern and parse accordingly
    if ((convention === 'DATEAMPM' || convention === 'AUTO') && this.patterns.DATETRIAL.test(fileName)) {
      return this.parseDateTrial(fileName);
    }
    
    switch (convention) {
      case 'DATEAMPM':
        return this.parseDateAMPM(fileName);
      case 'DATEMORNAFT':
        return this.parseDateMornAft(fileName);
      case 'DOCID':
        return this.parseDocId(fileName);
      default:
        return null;
    }
  }

  private parseDateTrial(fileName: string): ParsedFileName | null {
    const match = fileName.match(this.patterns.DATETRIAL);
    if (!match) return null;
    
    const [, caseInfo, dateStr] = match;
    
    // Parse plaintiff/defendant from case info
    let plaintiff: string | undefined;
    let defendant: string | undefined;
    
    // Handle variations like "Plaintiff v Defendant" or just "Plaintiff"
    const vsMatch = caseInfo.match(/(.+?)\s+[Vv]\.?\s+(.+)/);
    if (vsMatch) {
      plaintiff = vsMatch[1].trim();
      defendant = vsMatch[2].trim();
    } else {
      plaintiff = caseInfo.trim();
    }
    
    // Parse date
    const date = this.parseDate(dateStr);
    
    return {
      convention: 'DATEAMPM',  // Treat as DATEAMPM convention
      date,
      session: 'TRIAL',  // Use TRIAL as the session indicator for full day transcripts
      plaintiff,
      defendant,
      metadata: {
        originalFileName: fileName,
        caseInfo,
        dateStr,
        sessionRaw: 'Trial',
        isFullDay: true
      }
    };
  }

  private parseDateAMPM(fileName: string): ParsedFileName | null {
    const match = fileName.match(this.patterns.DATEAMPM);
    if (!match) return null;
    
    const [, caseInfo, dateStr, session] = match;
    
    // Parse plaintiff/defendant from case info
    let plaintiff: string | undefined;
    let defendant: string | undefined;
    
    // Handle variations like "Plaintiff v Defendant" or just "Plaintiff"
    const vsMatch = caseInfo.match(/(.+?)\s+[Vv]\.?\s+(.+)/);
    if (vsMatch) {
      plaintiff = vsMatch[1].trim();
      defendant = vsMatch[2].trim();
    } else {
      plaintiff = caseInfo.trim();
    }
    
    // Parse date
    const date = this.parseDate(dateStr);
    
    // Normalize session
    const normalizedSession = session.replace(/\s+and\s+/i, ' and ').toUpperCase();
    
    return {
      convention: 'DATEAMPM',
      date,
      session: normalizedSession,
      plaintiff,
      defendant,
      metadata: {
        originalFileName: fileName,
        caseInfo,
        dateStr,
        sessionRaw: session
      }
    };
  }

  private parseDateMornAft(fileName: string): ParsedFileName | null {
    const match = fileName.match(this.patterns.DATEMORNAFT);
    if (!match) return null;
    
    const [, dateStr, session] = match;
    
    // Parse date from format like "10_1_20"
    const dateParts = dateStr.split('_');
    const month = parseInt(dateParts[0]);
    const day = parseInt(dateParts[1]);
    let year = parseInt(dateParts[2]);
    
    // Handle 2-digit year
    if (year < 100) {
      year = year < 50 ? 2000 + year : 1900 + year;
    }
    
    const date = new Date(year, month - 1, day);
    
    return {
      convention: 'DATEMORNAFT',
      date,
      session: session ? session.toUpperCase() : 'UNKNOWN',
      metadata: {
        originalFileName: fileName,
        dateStr
      }
    };
  }

  private parseDocId(fileName: string): ParsedFileName | null {
    const match = fileName.match(this.patterns.DOCID);
    if (!match) return null;
    
    const [, district, caseNumber, documentId, description] = match;
    
    return {
      convention: 'DOCID',
      documentId,
      metadata: {
        originalFileName: fileName,
        district,
        caseNumber: caseNumber.replace(/_/g, ':'),
        documentId,
        description
      }
    };
  }

  private parseDate(dateStr: string): Date {
    // Parse dates like "January 11, 2016" or "August 3 2020"
    const months: { [key: string]: number } = {
      'january': 0, 'february': 1, 'march': 2, 'april': 3,
      'may': 4, 'june': 5, 'july': 6, 'august': 7,
      'september': 8, 'october': 9, 'november': 10, 'december': 11
    };
    
    // Try with comma first
    let match = dateStr.match(/([A-Z][a-z]+)\s+(\d{1,2}),\s+(\d{4})/i);
    if (!match) {
      // Try without comma
      match = dateStr.match(/([A-Z][a-z]+)\s+(\d{1,2})\s+(\d{4})/i);
    }
    
    if (match) {
      const [, monthName, day, year] = match;
      const month = months[monthName.toLowerCase()];
      if (month !== undefined) {
        return new Date(parseInt(year), month, parseInt(day));
      }
    }
    
    return new Date();
  }

  sortFiles(files: string[], convention: FileConvention, sortingMode: FileSortingMode): {
    orderedFiles: string[];
    unidentifiedFiles: string[];
  } {
    const parsedFiles: Array<{ fileName: string; parsed: ParsedFileName | null }> = [];
    const unidentifiedFiles: string[] = [];
    
    // Parse all files
    for (const file of files) {
      const parsed = this.parseFileName(file, convention);
      if (parsed) {
        parsedFiles.push({ fileName: file, parsed });
      } else {
        unidentifiedFiles.push(file);
      }
    }
    
    // Sort based on sorting mode
    if (sortingMode === 'dateAndSession' || (sortingMode === 'AUTO' && convention !== 'DOCID')) {
      parsedFiles.sort((a, b) => {
        // First sort by date
        if (a.parsed!.date && b.parsed!.date) {
          const dateDiff = a.parsed!.date.getTime() - b.parsed!.date.getTime();
          if (dateDiff !== 0) return dateDiff;
        }
        
        // Then sort by session (AM before PM, etc.)
        const sessionOrder: { [key: string]: number } = {
          'AM': 1,
          'MORNING': 1,
          'PM': 2,
          'AFTERNOON': 2,
          'AM AND PM': 3,
          'TRIAL': 3,  // Full day trial transcript, same priority as AM AND PM
          'ALLDAY': 3,
          'EVENING': 4,
          'PM1': 5,
          'AM1': 6
        };
        
        const aOrder = sessionOrder[a.parsed!.session || ''] || 99;
        const bOrder = sessionOrder[b.parsed!.session || ''] || 99;
        
        return aOrder - bOrder;
      });
    } else if (sortingMode === 'documentNumber' || (sortingMode === 'AUTO' && convention === 'DOCID')) {
      parsedFiles.sort((a, b) => {
        // Sort by document ID
        const aId = a.parsed!.documentId || '';
        const bId = b.parsed!.documentId || '';
        return aId.localeCompare(bId);
      });
    }
    
    return {
      orderedFiles: parsedFiles.map(p => p.fileName),
      unidentifiedFiles
    };
  }

  async generateTrialStyleConfig(
    outputDir: string,
    files: string[],
    defaultConfig?: Partial<TrialStyleConfig>
  ): Promise<TrialStyleConfig> {
    const txtFiles = files.filter(f => f.toLowerCase().endsWith('.txt'));
    
    // Feature 03C: Extract folder name
    const folderName = path.basename(outputDir);
    
    // Detect convention
    const convention = defaultConfig?.fileConvention === 'AUTO' ? 
      this.detectConvention(txtFiles) : 
      (defaultConfig?.fileConvention || 'AUTO');
    
    // Sort files
    const sortingMode = defaultConfig?.fileSortingMode || 'AUTO';
    const { orderedFiles, unidentifiedFiles } = this.sortFiles(txtFiles, convention, sortingMode);
    
    // Extract metadata from first valid file
    let metadata: any = {};
    if (orderedFiles.length > 0) {
      const parsed = this.parseFileName(orderedFiles[0], convention);
      if (parsed) {
        metadata = {
          detectedConvention: convention,
          plaintiff: parsed.plaintiff,
          defendant: parsed.defendant,
          ...parsed.metadata
        };
      }
    }
    
    // Feature 03C: Extract case number from first file
    let extractedCaseNumber: string | undefined;
    
    // Detect Q&A patterns from first file if available
    let detectedPatterns: Partial<TrialStyleConfig> = {};
    if (orderedFiles.length > 0) {
      const firstFilePath = path.join(outputDir, orderedFiles[0]);
      if (fs.existsSync(firstFilePath)) {
        try {
          const content = fs.readFileSync(firstFilePath, 'utf-8');
          
          // Feature 03C: Try to extract case number from page header
          const caseNumberInfo = caseNumberExtractor.extractFromTranscript(content);
          if (caseNumberInfo) {
            extractedCaseNumber = caseNumberInfo.caseNumber;
            logger.info(`Extracted case number: ${extractedCaseNumber} from ${path.basename(firstFilePath)}`);
          }
          
          const lines = content.split('\n').slice(0, 500); // Sample first 500 lines
          
          // Use a temporary detector to analyze patterns
          const tempConfig: TrialStyleConfig = {
            fileConvention: 'AUTO',
            fileSortingMode: 'AUTO',
            pageHeaderLines: 2,
            statementAppendMode: 'space',
            summaryCenterDelimiter: 'AUTO',
            ...defaultConfig
          };
          const tempDetector = new QAPatternDetector(tempConfig);
          detectedPatterns = tempDetector.suggestPatternsForTrial(lines);
          
          logger.info(`Detected patterns for ${path.basename(outputDir)}:`);
          if (detectedPatterns.questionPatterns) {
            logger.info(`  Question patterns: ${detectedPatterns.questionPatterns.join(', ')}`);
          }
          if (detectedPatterns.answerPatterns) {
            logger.info(`  Answer patterns: ${detectedPatterns.answerPatterns.join(', ')}`);
          }
        } catch (err) {
          logger.warn(`Could not detect Q&A patterns: ${err}`);
        }
      }
    }
    
    const config: TrialStyleConfig = {
      fileConvention: convention === 'AUTO' ? 'DATEAMPM' : convention,
      fileSortingMode: sortingMode === 'AUTO' ? 'dateAndSession' : sortingMode,
      pageHeaderLines: defaultConfig?.pageHeaderLines || 2,
      statementAppendMode: defaultConfig?.statementAppendMode || 'space',
      summaryCenterDelimiter: defaultConfig?.summaryCenterDelimiter || 'AUTO',
      orderedFiles,
      unidentifiedFiles,
      folderName,  // Feature 03C: Store folder name
      extractedCaseNumber,  // Feature 03C: Store extracted case number
      metadata: {
        ...metadata,
        extractedCaseNumber  // Also store in metadata for backward compatibility
      },
      // Add Q&A pattern configuration (Feature 02P)
      questionPatterns: detectedPatterns.questionPatterns || defaultConfig?.questionPatterns || ['Q.', 'Q:', 'Q'],
      answerPatterns: detectedPatterns.answerPatterns || defaultConfig?.answerPatterns || ['A.', 'A:', 'A'],
      attorneyIndicatorPatterns: detectedPatterns.attorneyIndicatorPatterns || defaultConfig?.attorneyIndicatorPatterns || [
        'BY MR\\. ([A-Z]+)',
        'BY MS\\. ([A-Z]+)',
        'BY MRS\\. ([A-Z]+)',
        'BY DR\\. ([A-Z]+)'
      ],
      enableGenericFallback: defaultConfig?.enableGenericFallback || false,
      genericFallbackConfig: defaultConfig?.genericFallbackConfig || {
        plaintiffGenericName: 'PLAINTIFF COUNSEL',
        defenseGenericName: 'DEFENSE COUNSEL',
        assumeExaminerFromContext: true
      }
    };
    
    // Write config to output directory
    const configPath = path.join(outputDir, 'trialstyle.json');
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
    logger.info(`Generated trialstyle.json in ${outputDir}`);
    
    return config;
  }
}