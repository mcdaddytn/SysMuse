// src/cli/parse.ts
import { Command } from 'commander';
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import { TranscriptParser } from '../parsers/TranscriptParser';
import { Phase2Processor } from '../parsers/Phase2Processor';
import { MultiPassTranscriptParser } from '../parsers/MultiPassTranscriptParser';
import { TranscriptConfig, TrialStyleConfig } from '../types/config.types';
import { caseNumberExtractor } from '../utils/CaseNumberExtractor';
import logger from '../utils/logger';

const program = new Command();

// Default configuration
const defaultConfig: TranscriptConfig = {
  inputDir: './transcripts',
  outputDir: './output',
  logLevel: 'info',
  batchSize: 100,
  enableElasticSearch: false
};

// Apply overrides from trialstyle.json
async function applyTrialOverrides(
  trialId: number,
  overrides: any,
  prisma: PrismaClient,
  logger: any
): Promise<void> {
  try {
    // Apply trial-level overrides
    if (overrides.trial) {
      const trialUpdates: any = {};
      
      if (overrides.trial.plaintiff) trialUpdates.plaintiff = overrides.trial.plaintiff;
      if (overrides.trial.defendant) trialUpdates.defendant = overrides.trial.defendant;
      if (overrides.trial.name) trialUpdates.name = overrides.trial.name;
      if (overrides.trial.court) trialUpdates.court = overrides.trial.court;
      
      if (Object.keys(trialUpdates).length > 0) {
        await prisma.trial.update({
          where: { id: trialId },
          data: trialUpdates
        });
        logger.info(`Applied trial overrides: ${Object.keys(trialUpdates).join(', ')}`);
      }
    }
    
    // Apply session-level overrides
    if (overrides.sessions && Array.isArray(overrides.sessions)) {
      for (const sessionOverride of overrides.sessions) {
        const sessionUpdates: any = {};
        
        // Find session by fileName or other criteria
        let session = null;
        if (sessionOverride.fileName) {
          session = await prisma.session.findFirst({
            where: {
              trialId,
              fileName: sessionOverride.fileName
            }
          });
        } else if (sessionOverride.sessionId) {
          session = await prisma.session.findUnique({
            where: { id: sessionOverride.sessionId }
          });
        }
        
        if (session) {
          if (sessionOverride.sessionDate) {
            sessionUpdates.sessionDate = new Date(sessionOverride.sessionDate);
          }
          if (sessionOverride.startTime) {
            sessionUpdates.startTime = sessionOverride.startTime;
          }
          if (sessionOverride.documentNumber) {
            sessionUpdates.documentNumber = sessionOverride.documentNumber;
          }
          
          if (Object.keys(sessionUpdates).length > 0) {
            await prisma.session.update({
              where: { id: session.id },
              data: sessionUpdates
            });
            logger.info(`Applied overrides to session ${session.fileName}: ${Object.keys(sessionUpdates).join(', ')}`);
          }
        }
      }
    }
    
    // Apply page-level overrides if needed
    if (overrides.pages && Array.isArray(overrides.pages)) {
      for (const pageOverride of overrides.pages) {
        if (pageOverride.sessionFileName && pageOverride.pageNumber && pageOverride.pageId) {
          const session = await prisma.session.findFirst({
            where: {
              trialId,
              fileName: pageOverride.sessionFileName
            }
          });
          
          if (session) {
            await prisma.page.updateMany({
              where: {
                sessionId: session.id,
                pageNumber: pageOverride.pageNumber
              },
              data: {
                pageId: pageOverride.pageId
              }
            });
            logger.info(`Applied pageId override to page ${pageOverride.pageNumber} in ${pageOverride.sessionFileName}`);
          }
        }
      }
    }
  } catch (error) {
    logger.error(`Error applying overrides: ${error}`);
  }
}

program
  .name('transcript-parser')
  .description('CLI for parsing judicial transcripts')
  .version('2.0.0');

program
  .command('parse')
  .description('Parse transcript files')
  .option('-c, --config <path>', 'Path to configuration file')
  .option('-d, --directory <path>', 'Directory containing transcript files')
  .option('-o, --output <path>', 'Output directory for parsed data')
  .option('--phase1', 'Run only Phase 1 (line parsing)')
  .option('--phase2', 'Run only Phase 2 (event processing)')
  .option('--trial-id <id>', 'Trial ID for Phase 2 processing', parseInt)
  .option('--log-level <level>', 'Log level (debug, info, warn, error)', 'info')
  .option('--parser-mode <mode>', 'Parser mode: legacy or multi-pass', 'legacy')
  .option('--debug-output', 'Enable debug output for multi-pass parser')
  .action(async (options) => {
    try {
      // Load configuration
      let config: TranscriptConfig = { ...defaultConfig };
      
      if (options.config) {
        const configPath = path.resolve(options.config);
        if (fs.existsSync(configPath)) {
          const fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
          config = { ...config, ...fileConfig };
          logger.info(`Loaded configuration from ${configPath}`);
        } else {
          logger.error(`Configuration file not found: ${configPath}`);
          process.exit(1);
        }
      }
      
      // Override with command line options
      if (options.directory) {
        config.inputDir = path.resolve(options.directory);
      }
      if (options.output) {
        config.outputDir = path.resolve(options.output);
      }
      if (options.logLevel) {
        config.logLevel = options.logLevel as 'debug' | 'info' | 'warn' | 'error';
      }
      
      // Set runPhase2 flag based on command line options
      if (options.phase1 && !options.phase2) {
        config.runPhase2 = false;
      }
      
      // Validate input directory
      if (!fs.existsSync(config.inputDir)) {
        logger.error(`Input directory not found: ${config.inputDir}`);
        process.exit(1);
      }
      
      // Create output directory if needed
      if (!fs.existsSync(config.outputDir)) {
        fs.mkdirSync(config.outputDir, { recursive: true });
        logger.info(`Created output directory: ${config.outputDir}`);
      }
      
      // Determine which phases to run
      const runPhase1 = !options.phase2 || options.phase1;
      const runPhase2 = !options.phase1 || options.phase2;
      
      logger.info('='.repeat(60));
      logger.info('JUDICIAL TRANSCRIPT PARSER');
      logger.info('='.repeat(60));
      logger.info(`Input Directory: ${config.inputDir}`);
      logger.info(`Output Directory: ${config.outputDir}`);
      logger.info(`Log Level: ${config.logLevel}`);
      logger.info(`Parser Mode: ${options.parserMode}`);
      logger.info(`Phases to run: ${runPhase1 ? 'Phase 1' : ''}${runPhase1 && runPhase2 ? ' + ' : ''}${runPhase2 ? 'Phase 2' : ''}`);
      logger.info('='.repeat(60));
      
      const prisma = new PrismaClient();
      
      try {
        if (runPhase1) {
          logger.info('\n📚 Starting Phase 1: Line Parsing');
          logger.info('-'.repeat(40));
          
          if (options.parserMode === 'multi-pass') {
            logger.info('Using Multi-Pass Parser');
            
            // Load trialstyle.json FIRST to get file ordering and trial info
            let trialStyleConfig: TrialStyleConfig | null = null;
            const trialStylePath = path.join(config.inputDir, 'trialstyle.json');
            
            if (fs.existsSync(trialStylePath)) {
              try {
                trialStyleConfig = JSON.parse(fs.readFileSync(trialStylePath, 'utf-8'));
                logger.info(`Loaded trialstyle.json from ${config.inputDir}`);
              } catch (error) {
                logger.warn(`Failed to parse trialstyle.json: ${error}`);
              }
            } else {
              logger.info(`No trialstyle.json found in ${config.inputDir}`);
            }
            
            const multiPassConfig = {
              mode: 'multi-pass' as const,
              loadInMemory: true,
              validatePasses: true,
              debugOutput: options.debugOutput || false,
              batchSize: config.batchSize || 1000,
              pageHeaderLines: trialStyleConfig?.pageHeaderLines || 2
            };
            
            const multiPassParser = new MultiPassTranscriptParser(prisma, logger as any, multiPassConfig);
            
            // Process subdirectories if configured
            let actualInputDir = config.inputDir;
            
            // Check if we should process subdirectories
            if (config.processSubDirs) {
              // When processing subdirectories after PDF conversion, look in the output directory
              // for the text files, not the input PDF directory
              let searchDir = config.inputDir;
              
              // Check if this is a PDF directory that's been converted
              const isPdfDir = config.inputDir.includes('/pdf');
              if (isPdfDir && config.outputDir) {
                // Look for text files in the output directory instead
                searchDir = config.outputDir;
                logger.info(`Looking for converted text files in output directory: ${searchDir}`);
              }
              
              // Get list of subdirectories
              const subdirs = fs.readdirSync(searchDir, { withFileTypes: true })
                .filter(dirent => dirent.isDirectory())
                .map(dirent => dirent.name);
              
              // Filter by includedTrials if specified
              const includedTrials = (config as any).includedTrials || [];
              const activeTrials = (config as any).activeTrials || [];
              const trialsToProcess = includedTrials.length > 0 ? includedTrials : activeTrials;
              
              if (trialsToProcess.length > 0) {
                // Process each trial in the list
                logger.info(`Processing ${trialsToProcess.length} trials: ${trialsToProcess.join(', ')}`);
                
                for (const trialDirName of trialsToProcess) {
                  // Find exact matching subdirectory (no partial matches)
                  const matchingDir = subdirs.find(dir => dir === trialDirName);
                
                  if (!matchingDir) {
                    logger.warn(`No matching trial directory found for: ${trialDirName}`);
                    continue;
                  }
                  actualInputDir = path.join(searchDir, matchingDir);
                  logger.info(`\n${'='.repeat(60)}`);
                  logger.info(`Processing trial: ${matchingDir}`);
                  logger.info(`${'='.repeat(60)}`);
                  
                  // Reset trialStyleConfig for each trial
                  trialStyleConfig = null;
                  
                  // Load trialstyle.json from the subdirectory
                  const subDirTrialStylePath = path.join(actualInputDir, 'trialstyle.json');
                  if (fs.existsSync(subDirTrialStylePath)) {
                    try {
                      trialStyleConfig = JSON.parse(fs.readFileSync(subDirTrialStylePath, 'utf-8'));
                      logger.info(`Loaded trialstyle.json from ${actualInputDir}`);
                    } catch (error) {
                      logger.warn(`Failed to parse trialstyle.json: ${error}`);
                    }
                  }
                  
                  // Continue processing this trial directory below...
            
            // ALWAYS use orderedFiles from trialstyle.json if available
            let files: string[];
            if (trialStyleConfig?.orderedFiles && trialStyleConfig.orderedFiles.length > 0) {
              // Always use the orderedFiles from trialstyle.json
              files = trialStyleConfig.orderedFiles.filter(f => {
                const fullPath = path.join(actualInputDir, f);
                return fs.existsSync(fullPath) && f.endsWith('.txt');
              });
              logger.info(`Using orderedFiles from trialstyle.json (${files.length} files)`);
            } else {
              // Fall back to directory listing with sorting only if no trialstyle.json
              files = fs.readdirSync(actualInputDir)
                .filter(f => f.endsWith('.txt'));
              
              // Only apply custom sorting if no orderedFiles available
              if (true) {
              // TODO: Implement proper file convention parsing to handle different naming patterns
              // This is a temporary solution that works for the current test data format
              // Sort files properly: by date, then morning before afternoon
              files.sort((a, b) => {
              const getDateAndType = (filename: string) => {
                const dateMatch = filename.match(/held on (\d+)_(\d+)_(\d+)/);
                let date = '';
                if (dateMatch) {
                  const month = dateMatch[1].padStart(2, '0');
                  const day = dateMatch[2].padStart(2, '0');
                  const year = '20' + dateMatch[3];
                  date = `${year}-${month}-${day}`;
                }
                
                // Determine session order based on content, not alphabetical
                let sessionOrder = 5; // default for unknown
                const lowerFile = filename.toLowerCase();
                if (lowerFile.includes('morning')) {
                  sessionOrder = 1; // Morning comes first
                } else if (lowerFile.includes('afternoon')) {
                  sessionOrder = 2; // Afternoon comes second
                } else if (lowerFile.includes('bench')) {
                  sessionOrder = 3; // Special sessions come after regular ones
                } else if (lowerFile.includes('verdict')) {
                  sessionOrder = 4;
                }
                
                return { date, sessionOrder };
              };
              
              const aInfo = getDateAndType(a);
              const bInfo = getDateAndType(b);
              
              // First sort by date
              if (aInfo.date !== bInfo.date) {
                return aInfo.date.localeCompare(bInfo.date);
              }
              
              // Then sort by session order (morning=1, afternoon=2, etc.)
              return aInfo.sessionOrder - bInfo.sessionOrder;
            });
            }
            }
            
            // Skip if no files to process
            if (files.length === 0) {
              logger.warn(`No transcript files found in ${actualInputDir}`);
              logger.info('✅ Phase 1 completed successfully');
              return;
            }
            
            // Feature 03C: Extract case number from various sources
            let caseNumber: string | undefined;
            let trialName: string;
            
            // Priority 1: Use extractedCaseNumber from trialstyle.json
            if (trialStyleConfig?.extractedCaseNumber) {
              caseNumber = trialStyleConfig.extractedCaseNumber;
              logger.info(`Using case number from trialstyle.json: ${caseNumber}`);
            }
            
            // Priority 2: Try to extract from first transcript file
            if (!caseNumber && files.length > 0) {
              const firstFilePath = path.join(actualInputDir, files[0]);
              if (fs.existsSync(firstFilePath)) {
                const firstContent = fs.readFileSync(firstFilePath, 'utf-8').substring(0, 1000);
                const extracted = caseNumberExtractor.extractFromTranscript(firstContent);
                if (extracted) {
                  caseNumber = extracted.caseNumber;
                  logger.info(`Extracted case number from transcript: ${caseNumber}`);
                }
              }
            }
            
            // Priority 3: Use config trial.caseNumber if provided
            if (!caseNumber && config.trial?.caseNumber) {
              caseNumber = config.trial.caseNumber;
              logger.info(`Using case number from config: ${caseNumber}`);
            }
            
            // Priority 4: Generate unique identifier from folder name
            if (!caseNumber) {
              const folderName = trialStyleConfig?.folderName || path.basename(actualInputDir);
              // Create a unique identifier based on folder name and timestamp
              const timestamp = new Date().toISOString().split('T')[0];
              caseNumber = `UNKNOWN-${folderName.replace(/[^a-zA-Z0-9]/g, '-')}-${timestamp}`;
              logger.warn(`No case number found, using identifier: ${caseNumber}`);
            }
            
            // Determine trial name from folder or config
            const folderName = trialStyleConfig?.folderName || path.basename(actualInputDir);
            if (config.trial?.name) {
              trialName = config.trial.name;
            } else {
              trialName = folderName;
            }
            
            // Normalize case number for comparison
            const normalizeCaseNumber = (caseNo: string): string => {
              return caseNo.replace(/[^0-9a-zA-Z]/g, '').toLowerCase();
            };
            
            const shortName = trialStyleConfig?.folderName || path.basename(actualInputDir);
            
            // Create or get trial - check both caseNumber and shortName
            let trial = await prisma.trial.findFirst({
              where: {
                OR: [
                  { caseNumber },
                  { shortName },
                  // Also check normalized case number
                  { 
                    caseNumber: {
                      contains: normalizeCaseNumber(caseNumber)
                    }
                  }
                ]
              }
            });
            
            if (!trial) {
              trial = await prisma.trial.create({
                data: {
                  name: trialName,
                  shortName,
                  caseNumber,
                  court: config.trial?.court || 'UNKNOWN COURT',
                  plaintiff: trialStyleConfig?.metadata?.plaintiff || 'Unknown Plaintiff',
                  defendant: trialStyleConfig?.metadata?.defendant || 'Unknown Defendant'
                }
              });
              logger.info(`Created new trial: ${trialName} (${caseNumber})`);
            } else {
              logger.info(`Using existing trial: ${trial.name} (${caseNumber})`);
              
              // Update trial if we have better metadata
              const updateData: any = {};
              if (trial.name === 'Unknown Trial' && trialName !== 'Unknown Trial') {
                updateData.name = trialName;
              }
              if (!trial.shortName && shortName) {
                updateData.shortName = shortName;
              }
              if (trial.plaintiff === 'Unknown Plaintiff' && trialStyleConfig?.metadata?.plaintiff) {
                updateData.plaintiff = trialStyleConfig.metadata.plaintiff;
              }
              if (trial.defendant === 'Unknown Defendant' && trialStyleConfig?.metadata?.defendant) {
                updateData.defendant = trialStyleConfig.metadata.defendant;
              }
              
              if (Object.keys(updateData).length > 0) {
                trial = await prisma.trial.update({
                  where: { id: trial.id },
                  data: updateData
                });
                logger.info('Updated trial with better metadata');
              }
            }
            
            // Process files using multi-pass parser
            for (const file of files) {
              const filePath = path.join(actualInputDir, file);
              logger.info(`Processing: ${file}`);
              
              // Extract session date from filename - handle multiple simple patterns
              let sessionDate = new Date();
              let dateFound = false;
              
              // Pattern 1: "held on MM_DD_YY" (e.g., "held on 10_1_20")
              if (file.includes('held on')) {
                const parts = file.split('held on ')[1];
                if (parts) {
                  const datePart = parts.split(' ')[0]; // Get "10_1_20"
                  const pieces = datePart.split('_');
                  if (pieces.length === 3) {
                    const month = parseInt(pieces[0]) - 1; // JS months are 0-indexed
                    const day = parseInt(pieces[1]);
                    const year = 2000 + parseInt(pieces[2]); // All our trials are 2000+
                    sessionDate = new Date(year, month, day);
                    dateFound = true;
                    logger.info(`Extracted date from 'held on' pattern: ${sessionDate.toISOString().split('T')[0]}`);
                  }
                }
              }
              
              // Pattern 2: "Month DD, YYYY" (e.g., "January 11, 2016" or "SEPTEMBER 14, 2015")
              if (!dateFound) {
                const months: { [key: string]: number } = {
                  'january': 0, 'february': 1, 'march': 2, 'april': 3,
                  'may': 4, 'june': 5, 'july': 6, 'august': 7,
                  'september': 8, 'october': 9, 'november': 10, 'december': 11
                };
                
                for (const [monthName, monthNum] of Object.entries(months)) {
                  if (file.toLowerCase().includes(monthName)) {
                    // Find the month name and what follows it
                    const upperFile = file.toUpperCase();
                    const upperMonth = monthName.toUpperCase();
                    const monthIndex = upperFile.indexOf(upperMonth);
                    if (monthIndex !== -1) {
                      const afterMonth = file.substring(monthIndex + upperMonth.length).trim();
                      // Look for "DD, YYYY" or "DD YYYY"
                      const numbers = afterMonth.match(/(\d{1,2}),?\s+(\d{4})/);
                      if (numbers) {
                        const day = parseInt(numbers[1]);
                        const year = parseInt(numbers[2]);
                        sessionDate = new Date(year, monthNum, day);
                        dateFound = true;
                        logger.info(`Extracted date from month name pattern: ${sessionDate.toISOString().split('T')[0]}`);
                        break;
                      }
                    }
                  }
                }
              }
              
              // Pattern 3: "Month D YYYY" without comma (e.g., "August 3 2020")
              if (!dateFound) {
                const months: { [key: string]: number } = {
                  'january': 0, 'february': 1, 'march': 2, 'april': 3,
                  'may': 4, 'june': 5, 'july': 6, 'august': 7,
                  'september': 8, 'october': 9, 'november': 10, 'december': 11
                };
                
                for (const [monthName, monthNum] of Object.entries(months)) {
                  if (file.toLowerCase().includes(monthName)) {
                    const words = file.split(' ');
                    for (let i = 0; i < words.length; i++) {
                      if (words[i].toLowerCase() === monthName) {
                        if (i + 2 < words.length) {
                          const day = parseInt(words[i + 1]);
                          const year = parseInt(words[i + 2]);
                          if (!isNaN(day) && !isNaN(year) && year > 1900 && year < 2100) {
                            sessionDate = new Date(year, monthNum, day);
                            dateFound = true;
                            logger.info(`Extracted date from simple month pattern: ${sessionDate.toISOString().split('T')[0]}`);
                            break;
                          }
                        }
                      }
                    }
                    if (dateFound) break;
                  }
                }
              }
              
              // Collect all extracted metadata for debugging
              const extractedMetadata: any = {
                originalFileName: file,
                dateFound: dateFound,
                extractedDate: dateFound ? sessionDate.toISOString().split('T')[0] : null,
                datePattern: null,
                extractedMonth: null,
                extractedDay: null,
                extractedYear: null,
                sessionTypeIndicators: []
              };
              
              // Store what pattern matched for date extraction
              if (dateFound) {
                if (file.includes('held on')) {
                  extractedMetadata.datePattern = 'held_on_MM_DD_YY';
                } else if (file.toLowerCase().includes('january') || file.toLowerCase().includes('february') || 
                          file.toLowerCase().includes('march') || file.toLowerCase().includes('april') ||
                          file.toLowerCase().includes('may') || file.toLowerCase().includes('june') ||
                          file.toLowerCase().includes('july') || file.toLowerCase().includes('august') ||
                          file.toLowerCase().includes('september') || file.toLowerCase().includes('october') ||
                          file.toLowerCase().includes('november') || file.toLowerCase().includes('december')) {
                  extractedMetadata.datePattern = 'month_name_pattern';
                }
                extractedMetadata.extractedMonth = sessionDate.getMonth() + 1;
                extractedMetadata.extractedDay = sessionDate.getDate();
                extractedMetadata.extractedYear = sessionDate.getFullYear();
              }
              
              // FALLBACK: If no date found in filename, try to extract from transcript content
              if (!dateFound) {
                logger.warn(`Could not extract date from filename: ${file} - attempting to parse from transcript`);
                
                // Read first 5000 characters of the file to find date
                try {
                  const content = fs.readFileSync(filePath, 'utf-8').substring(0, 5000);
                  
                  // Look for patterns like "TRIAL DATE: Month DD, YYYY" or similar
                  const lines = content.split('\n');
                  for (const line of lines) {
                    const upperLine = line.toUpperCase();
                    
                    // Check for TRIAL DATE pattern
                    if (upperLine.includes('TRIAL DATE') || upperLine.includes('DATE OF TRIAL') || 
                        upperLine.includes('PROCEEDINGS') || upperLine.includes('TRANSCRIPT DATE')) {
                      // Try to extract date from this line or next few lines
                      const months: { [key: string]: number } = {
                        'january': 0, 'february': 1, 'march': 2, 'april': 3,
                        'may': 4, 'june': 5, 'july': 6, 'august': 7,
                        'september': 8, 'october': 9, 'november': 10, 'december': 11
                      };
                      
                      for (const [monthName, monthNum] of Object.entries(months)) {
                        if (line.toLowerCase().includes(monthName)) {
                          const dateMatch = line.match(/(\d{1,2}),?\s+(\d{4})/);
                          if (dateMatch) {
                            const day = parseInt(dateMatch[1]);
                            const year = parseInt(dateMatch[2]);
                            sessionDate = new Date(year, monthNum, day);
                            dateFound = true;
                            extractedMetadata.datePattern = 'transcript_content';
                            extractedMetadata.dateFound = true;
                            extractedMetadata.extractedDate = sessionDate.toISOString().split('T')[0];
                            extractedMetadata.extractedMonth = monthNum + 1;
                            extractedMetadata.extractedDay = day;
                            extractedMetadata.extractedYear = year;
                            logger.info(`Extracted date from transcript content: ${sessionDate.toISOString().split('T')[0]}`);
                            break;
                          }
                        }
                      }
                      if (dateFound) break;
                    }
                  }
                } catch (err) {
                  logger.error(`Could not read file for date extraction: ${err}`);
                }
                
                if (!dateFound) {
                  // NEVER use current date - use a placeholder that's obviously wrong
                  sessionDate = new Date(1900, 0, 1); // Jan 1, 1900 - clearly a placeholder
                  logger.error(`CRITICAL: No date found for ${file} - using placeholder 1900-01-01`);
                  extractedMetadata.dateError = 'NO_DATE_FOUND';
                  extractedMetadata.needsManualOverride = true;
                }
              }
              
              // Determine session type using SessionType enum
              let sessionType: 'MORNING' | 'AFTERNOON' | 'ALLDAY' | 'EVENING' | 'SPECIAL' = 'MORNING';
              const lowerFile = file.toLowerCase();
              
              // Store all indicators found
              if (lowerFile.includes('afternoon')) extractedMetadata.sessionTypeIndicators.push('afternoon');
              if (lowerFile.includes(' pm')) extractedMetadata.sessionTypeIndicators.push('pm');
              if (lowerFile.includes(' am')) extractedMetadata.sessionTypeIndicators.push('am');
              if (lowerFile.includes('morning')) extractedMetadata.sessionTypeIndicators.push('morning');
              if (lowerFile.includes('verdict')) extractedMetadata.sessionTypeIndicators.push('verdict');
              if (lowerFile.includes('bench')) extractedMetadata.sessionTypeIndicators.push('bench');
              if (lowerFile.includes('am and pm')) extractedMetadata.sessionTypeIndicators.push('am_and_pm');
              
              if (lowerFile.includes('afternoon') || lowerFile.includes(' pm')) {
                sessionType = 'AFTERNOON';
              } else if (lowerFile.includes(' am')) {
                sessionType = 'MORNING';
              } else if (lowerFile.includes('am and pm') || lowerFile.includes('all day')) {
                sessionType = 'ALLDAY';
              } else if (lowerFile.includes('verdict') || lowerFile.includes('bench')) {
                sessionType = 'SPECIAL';  // Use SPECIAL for verdict and bench sessions
              }
              
              extractedMetadata.determinedSessionType = sessionType;
              
              // Create or find session - use fileName as part of uniqueness check
              // This prevents duplicate sessions when dates are missing (e.g., Packet trial)
              let session = await prisma.session.findFirst({
                where: {
                  trialId: trial.id,
                  fileName: file  // fileName is the unique identifier
                }
              });
              
              if (!session) {
                session = await prisma.session.create({
                  data: {
                    trialId: trial.id,
                    sessionDate,
                    sessionType,
                    shortName: sessionType.charAt(0).toUpperCase() + sessionType.slice(1).toLowerCase(),
                    fileName: file,
                    metadata: extractedMetadata
                  }
                });
                logger.info(`Created session with metadata: ${JSON.stringify(extractedMetadata)}`);
              } else {
                // Update sessionDate, sessionType, and metadata
                const shortName = sessionType.charAt(0).toUpperCase() + sessionType.slice(1).toLowerCase();
                session = await prisma.session.update({
                  where: { id: session.id },
                  data: { 
                    sessionDate,  // Update date in case it was extracted better this time
                    sessionType,  // Update type in case it was determined better
                    shortName: shortName,
                    metadata: extractedMetadata
                  }
                });
                logger.info(`Updated session with metadata: ${JSON.stringify(extractedMetadata)}`);
              }
              
              const success = await multiPassParser.parseTranscript(filePath, session.id, trial.id);
              
              if (!success) {
                logger.error(`Failed to parse ${file}`);
              }
            }
            
            // Apply overrides if specified in trialstyle.json
            if (trialStyleConfig?.overrides) {
              logger.info('\n📝 Applying data overrides from trialstyle.json...');
              await applyTrialOverrides(trial.id, trialStyleConfig.overrides, prisma, logger);
            }
            } // End of for loop over trialsToProcess
            
            // All trials have been processed
            logger.info('\n' + '='.repeat(60));
            logger.info('✅ All trials processed successfully');
            logger.info('='.repeat(60));
            } // End of if (trialsToProcess.length > 0)
            } // End of if (config.processSubDirs)
          } else {
            logger.info('Using Legacy Parser');
            const parser = new TranscriptParser(config);
            await parser.parseDirectory();
          }
          
          logger.info('✅ Phase 1 completed successfully');
        }
        
        if (runPhase2) {
          logger.info('\n🔄 Starting Phase 2: Event Processing');
          logger.info('-'.repeat(40));
          
          let trialId = options.trialId;
          
          // If no trial ID provided, try to find the most recent trial
          if (!trialId) {
            const latestTrial = await prisma.trial.findFirst({
              orderBy: { createdAt: 'desc' }
            });
            
            if (latestTrial) {
              trialId = latestTrial.id;
              logger.info(`Using latest trial: ${latestTrial.caseNumber} (ID: ${trialId})`);
            } else {
              logger.error('No trial found in database. Please run Phase 1 first.');
              process.exit(1);
            }
          }
          
          const processor = new Phase2Processor(config);
          await processor.processTrial(trialId);
          
          logger.info('✅ Phase 2 completed successfully');
        }
        
        logger.info('\n' + '='.repeat(60));
        logger.info('✨ PROCESSING COMPLETED SUCCESSFULLY');
        logger.info('='.repeat(60));
        
      } finally {
        await prisma.$disconnect();
      }
      
    } catch (error) {
      logger.error(`Processing failed: ${error}`);
      process.exit(1);
    }
  });

program
  .command('stats')
  .description('Display database statistics')
  .action(async () => {
    const prisma = new PrismaClient();
    
    try {
      const stats = await getDbStats(prisma);
      
      console.log('\n' + '='.repeat(60));
      console.log('📊 DATABASE STATISTICS');
      console.log('='.repeat(60));
      console.log(`Trials:          ${stats.trials.toLocaleString()}`);
      console.log(`Sessions:        ${stats.sessions.toLocaleString()}`);
      console.log(`Pages:           ${stats.pages.toLocaleString()}`);
      console.log(`Lines:           ${stats.lines.toLocaleString()}`);
      console.log(`Events:          ${stats.events.toLocaleString()}`);
      console.log(`Speakers:        ${stats.speakers.toLocaleString()}`);
      console.log(`  - Attorneys:   ${stats.attorneys.toLocaleString()}`);
      console.log(`  - Witnesses:   ${stats.witnesses.toLocaleString()}`);
      console.log(`  - Jurors:      ${stats.jurors.toLocaleString()}`);
      console.log(`  - Anonymous:   ${stats.anonymous.toLocaleString()}`);
      console.log(`Statements:      ${stats.statements.toLocaleString()}`);
      console.log(`Witness Events:  ${stats.witnessEvents.toLocaleString()}`);
      console.log(`Directives:      ${stats.directives.toLocaleString()}`);
      console.log('='.repeat(60));
      
    } finally {
      await prisma.$disconnect();
    }
  });

program
  .command('search')
  .description('Search transcripts with SQL and Elasticsearch')
  .option('-f, --file <path>', 'Path to JSON query file')
  .option('-o, --output <path>', 'Output directory for results', './output')
  .action(async (options) => {
    const { execSync } = require('child_process');
    const searchCmd = `ts-node src/cli/search.ts query -f ${options.file || './config/queries/query.json'} -o ${options.output}`;
    execSync(searchCmd, { stdio: 'inherit' });
  });

program
  .command('search-batch')
  .description('Execute multiple search queries')
  .option('-d, --directory <path>', 'Directory containing query files', './config/queries')
  .option('-o, --output <path>', 'Output directory for results', './output')
  .action(async (options) => {
    const { execSync } = require('child_process');
    const searchCmd = `ts-node src/cli/search.ts batch -d ${options.directory} -o ${options.output}`;
    execSync(searchCmd, { stdio: 'inherit' });
  });

program
  .command('sync-elasticsearch')
  .description('Sync all statement events to Elasticsearch')
  .action(async () => {
    const { execSync } = require('child_process');
    execSync('ts-node src/cli/search.ts sync', { stdio: 'inherit' });
  });

program
  .command('enhanced-search <subcommand>')
  .description('Enhanced search with templates and hierarchical output')
  .allowUnknownOption()
  .action((subcommand, command) => {
    const { execSync } = require('child_process');
    const args = process.argv.slice(process.argv.indexOf(subcommand) + 1);
    let enhancedCmd = `ts-node src/cli/enhanced-search.ts ${subcommand} ${args.join(' ')}`;
    
    execSync(enhancedCmd, { stdio: 'inherit' });
  });

program
  .command('reset')
  .description('Reset the database')
  .option('--confirm', 'Skip confirmation prompt')
  .action(async (options) => {
    if (!options.confirm) {
      console.log('⚠️  WARNING: This will delete all data in the database!');
      console.log('Use --confirm flag to proceed without prompt.');
      process.exit(0);
    }
    
    const prisma = new PrismaClient();
    
    try {
      logger.info('Resetting database...');
      
      // Delete all data in reverse order of dependencies
      await prisma.searchIndex.deleteMany();
      await prisma.marker.deleteMany();
      await prisma.witnessCalledEvent.deleteMany();
      await prisma.statementEvent.deleteMany();
      await prisma.courtDirectiveEvent.deleteMany();
      await prisma.trialEvent.deleteMany();
      await prisma.line.deleteMany();
      await prisma.page.deleteMany();
      await prisma.session.deleteMany();
      await prisma.anonymousSpeaker.deleteMany();
      await prisma.juror.deleteMany();
      await prisma.witness.deleteMany();
      await prisma.judge.deleteMany();
      await prisma.trialAttorney.deleteMany();
      await prisma.attorney.deleteMany();
      await prisma.speaker.deleteMany();
      await prisma.lawFirmOffice.deleteMany();
      await prisma.lawFirm.deleteMany();
      await prisma.courtReporter.deleteMany();
      await prisma.address.deleteMany();
      await prisma.courtDirectiveType.deleteMany();
      await prisma.trial.deleteMany();
      
      logger.info('✅ Database reset successfully');
      
    } finally {
      await prisma.$disconnect();
    }
  });

async function getDbStats(prisma: PrismaClient) {
  const [
    trials,
    sessions,
    pages,
    lines,
    events,
    speakers,
    attorneys,
    witnesses,
    jurors,
    anonymous,
    statements,
    witnessEvents,
    directives
  ] = await Promise.all([
    prisma.trial.count(),
    prisma.session.count(),
    prisma.page.count(),
    prisma.line.count(),
    prisma.trialEvent.count(),
    prisma.speaker.count(),
    prisma.attorney.count(),
    prisma.witness.count(),
    prisma.juror.count(),
    prisma.anonymousSpeaker.count(),
    prisma.statementEvent.count(),
    prisma.witnessCalledEvent.count(),
    prisma.courtDirectiveEvent.count()
  ]);
  
  return {
    trials,
    sessions,
    pages,
    lines,
    events,
    speakers,
    attorneys,
    witnesses,
    jurors,
    anonymous,
    statements,
    witnessEvents,
    directives
  };
}

// Parse command line arguments
program.parse(process.argv);