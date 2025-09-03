import { PrismaClient } from '@prisma/client';
import * as fs from 'fs-extra';
import * as path from 'path';
import logger from '../utils/logger';
import { QueryRegistry } from './QueryRegistry';
import { 
  TrialSessionSectionQuery, 
  TrialSessionPageLineQuery,
  SummaryLinesQuery,
  SessionStatisticsQuery
} from './Phase1ReportQueries';

export class Phase1ReportGenerator {
  private prisma: PrismaClient;
  private outputDir: string;

  constructor(prisma: PrismaClient, outputDir: string = './output/phase1') {
    this.prisma = prisma;
    this.outputDir = outputDir;
    
    // Register Phase 1 queries
    this.registerQueries();
  }

  private registerQueries(): void {
    QueryRegistry.register(new TrialSessionSectionQuery());
    QueryRegistry.register(new TrialSessionPageLineQuery());
    QueryRegistry.register(new SummaryLinesQuery());
    QueryRegistry.register(new SessionStatisticsQuery());
  }

  /**
   * Report 1: Export SessionSections for each Trial/Session
   * Creates a unique file for each Trial/Session combination
   */
  async generateSessionSectionReports(trialId?: number): Promise<void> {
    logger.info('Generating SessionSection reports...');
    
    const params = trialId ? { trialId } : undefined;
    const results = await QueryRegistry.execute('TrialSessionSection', this.prisma, params);
    
    // Ensure output directory exists
    await fs.ensureDir(this.outputDir);
    
    for (const result of results) {
      const trial = result.trial as any;
      const session = result.session as any;
      const sections = result.sessionSections as any[];
      
      // Create unique filename in flat structure
      const fileName = this.createSessionFileName(trial, session, 'sections.txt');
      const filePath = path.join(this.outputDir, fileName);
      
      // Create report content
      const lines: string[] = [];
      lines.push(`Trial: ${trial.name} (${trial.caseNumber})`);
      lines.push(`Session: ${session.sessionDate} - ${session.sessionType}`);
      lines.push(`File: ${session.fileName}`);
      lines.push('=' .repeat(80));
      lines.push('');
      
      for (const section of sections) {
        lines.push(`Section Type: ${section.sectionType}`);
        lines.push('-'.repeat(40));
        lines.push(section.sectionText);
        lines.push('');
        lines.push('=' .repeat(80));
        lines.push('');
      }
      
      // Write to file (overwrites if exists)
      await fs.writeFile(filePath, lines.join('\n'), 'utf-8');
      logger.info(`Created report: ${filePath}`);
    }
    
    logger.info('SessionSection reports completed');
  }

  /**
   * Report 2: Export Summary lines for each Trial/Session
   * Creates clean text output without artifacts
   */
  async generateSummaryLineReports(trialId?: number): Promise<void> {
    logger.info('Generating Summary Line reports...');
    
    const params = trialId ? { trialId } : undefined;
    const results = await QueryRegistry.execute('SummaryLines', this.prisma, params);
    
    // Ensure output directory exists
    await fs.ensureDir(this.outputDir);
    
    for (const result of results) {
      const trial = result.trial as any;
      const session = result.session as any;
      const summaryLines = result.summaryText as string[];
      
      if (!summaryLines || summaryLines.length === 0) {
        logger.info(`No summary lines for ${trial.name} - ${session.sessionDate}`);
        continue;
      }
      
      // Create unique filename in flat structure
      const fileName = this.createSessionFileName(trial, session, 'summary.txt');
      const filePath = path.join(this.outputDir, fileName);
      
      // Write clean text directly (overwrites if exists)
      await fs.writeFile(filePath, summaryLines.join('\n'), 'utf-8');
      logger.info(`Created summary report: ${filePath}`);
    }
    
    logger.info('Summary Line reports completed');
  }

  /**
   * Generate all Lines with document sections for analysis
   */
  async generateFullLineReports(trialId?: number, documentSection?: string): Promise<void> {
    logger.info('Generating Full Line reports...');
    
    const params: any = trialId ? { trialId } : {};
    if (documentSection) {
      params.documentSection = documentSection;
    }
    
    const results = await QueryRegistry.execute('TrialSessionPageLine', this.prisma, params);
    
    // Ensure output directory exists
    await fs.ensureDir(this.outputDir);
    
    for (const result of results) {
      const trial = result.trial as any;
      const session = result.session as any;
      const pages = result.pages as any[];
      
      // Create unique filename in flat structure
      const suffix = documentSection ? `${documentSection.toLowerCase()}_lines.txt` : 'all_lines.txt';
      const fileName = this.createSessionFileName(trial, session, suffix);
      const filePath = path.join(this.outputDir, fileName);
      
      // Create report content
      const lines: string[] = [];
      lines.push(`Trial: ${trial.name} (${trial.caseNumber})`);
      lines.push(`Session: ${session.sessionDate} - ${session.sessionType}`);
      if (documentSection) {
        lines.push(`Document Section: ${documentSection}`);
      }
      lines.push('=' .repeat(80));
      lines.push('');
      
      for (const page of pages) {
        lines.push(`Page ${page.pageNumber}`);
        lines.push('-'.repeat(40));
        
        for (const line of page.lines) {
          // Include line metadata for debugging
          const metadata = [];
          if (line.documentSection) metadata.push(`[${line.documentSection}]`);
          if (line.linePrefix) metadata.push(`<${line.linePrefix}>`);
          if (line.isBlank) metadata.push('[BLANK]');
          
          const metaStr = metadata.length > 0 ? ` ${metadata.join(' ')}` : '';
          lines.push(`${line.lineNumber.toString().padStart(4)}: ${line.text || ''}${metaStr}`);
        }
        
        lines.push('');
      }
      
      // Write to file (overwrites if exists)
      await fs.writeFile(filePath, lines.join('\n'), 'utf-8');
      logger.info(`Created line report: ${filePath}`);
    }
    
    logger.info('Full Line reports completed');
  }

  /**
   * Generate session statistics report
   */
  async generateSessionStatistics(trialId?: number): Promise<void> {
    logger.info('Generating Session Statistics...');
    
    const params = trialId ? { trialId } : undefined;
    const results = await QueryRegistry.execute('SessionStatistics', this.prisma, params);
    
    // Ensure output directory exists
    await fs.ensureDir(this.outputDir);
    
    // Group by trial
    const trialGroups = new Map<string, any[]>();
    for (const result of results) {
      const trial = result.trial as any;
      const key = `${trial.id}_${trial.name}`;
      if (!trialGroups.has(key)) {
        trialGroups.set(key, []);
      }
      trialGroups.get(key)!.push(result);
    }
    
    // Create report for each trial
    for (const [key, sessions] of trialGroups) {
      const trial = sessions[0].trial;
      const caseHandle = (trial as any).caseHandle || `trial_${trial.id}`;
      const fileName = `${caseHandle}_statistics.md`;
      const filePath = path.join(this.outputDir, fileName);
      
      const lines: string[] = [];
      lines.push(`# Trial Statistics: ${trial.name}`);
      lines.push(`Case Number: ${trial.caseNumber}`);
      lines.push('');
      lines.push('## Session Summary');
      lines.push('');
      lines.push('| Date | Type | Pages | Lines | Events | Sections |');
      lines.push('|------|------|-------|-------|--------|----------|');
      
      let totalPages = 0;
      let totalLines = 0;
      let totalEvents = 0;
      
      for (const sessionData of sessions) {
        const session = sessionData.session as any;
        const stats = sessionData.statistics as any;
        
        totalPages += stats.pageCount;
        totalLines += stats.lineCount;
        totalEvents += stats.eventCount || 0;
        
        // Format date properly
        const date = new Date(session.sessionDate);
        const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
        
        lines.push(
          `| ${dateStr} | ${session.sessionType} | ` +
          `${stats.pageCount} | ${stats.lineCount} | ` +
          `${stats.eventCount || 0} | ` +
          `${stats.sectionTypes.length} |`
        );
      }
      
      lines.push('');
      lines.push('## Totals');
      lines.push(`- Sessions: ${sessions.length}`);
      lines.push(`- Total Pages: ${totalPages}`);
      lines.push(`- Total Lines: ${totalLines}`);
      lines.push(`- Total Events: ${totalEvents}`);
      lines.push(`- Average Lines/Page: ${totalPages > 0 ? Math.round(totalLines / totalPages) : 0}`);
      
      // Write to file (overwrites if exists)
      await fs.writeFile(filePath, lines.join('\n'), 'utf-8');
      logger.info(`Created statistics report: ${filePath}`);
    }
    
    logger.info('Session Statistics completed');
  }

  /**
   * Generate trial overview report
   */
  async generateTrialOverview(): Promise<void> {
    logger.info('Generating Trial Overview...');
    
    const trials = await this.prisma.trial.findMany({
      include: {
        _count: {
          select: {
            sessions: true
          }
        },
        sessions: {
          include: {
            _count: {
              select: {
                pages: true
              }
            }
          }
        }
      },
      orderBy: { name: 'asc' }
    });
    
    // Ensure output directory exists
    await fs.ensureDir(this.outputDir);
    
    const filePath = path.join(this.outputDir, 'trials_overview.md');
    const lines: string[] = [];
    
    lines.push('# Trials Overview');
    lines.push(`Generated: ${new Date().toISOString()}`);
    lines.push('');
    lines.push('| ID | Name | Case Number | Sessions | Total Pages |');
    lines.push('|----|------|-------------|----------|-------------|');
    
    for (const trial of trials) {
      const totalPages = trial.sessions.reduce((sum, s) => sum + s._count.pages, 0);
      const shortName = trial.shortName || trial.name.substring(0, 50);
      
      lines.push(
        `| ${trial.id} | ${shortName} | ${trial.caseNumber} | ` +
        `${trial._count.sessions} | ${totalPages} |`
      );
    }
    
    lines.push('');
    lines.push(`Total Trials: ${trials.length}`);
    
    await fs.writeFile(filePath, lines.join('\n'), 'utf-8');
    logger.info(`Created overview report: ${filePath}`);
    
    logger.info('Trial Overview completed');
  }

  /**
   * Generate all reports for a trial
   */
  async generateAllReports(trialId?: number): Promise<void> {
    logger.info('Generating all Phase 1 reports...');
    
    // Clear and recreate output directory for fresh export
    await fs.emptyDir(this.outputDir);
    await fs.ensureDir(this.outputDir);
    
    await this.generateTrialOverview();
    await this.generateSessionSectionReports(trialId);
    await this.generateSummaryLineReports(trialId);
    await this.generateFullLineReports(trialId, 'SUMMARY');
    await this.generateFullLineReports(trialId, 'PROCEEDINGS');
    await this.generateSessionStatistics(trialId);
    
    logger.info('All Phase 1 reports completed');
  }

  /**
   * Create a standardized session filename
   */
  private createSessionFileName(trial: any, session: any, suffix: string): string {
    // Use caseHandle for unique identification
    const trialIdentifier = trial.caseHandle || `trial_${trial.id}`;
    
    // Convert Date object to string format
    const date = new Date(session.sessionDate);
    const sessionDate = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const sessionType = session.sessionType.toLowerCase();
    
    // Create unique filename: CaseHandle_Date_SessionType_suffix
    return `${trialIdentifier}_${sessionDate}_${sessionType}_${suffix}`;
  }

  /**
   * Sanitize filename for filesystem
   */
  private sanitizeFileName(name: string): string {
    return name.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 100);
  }
}