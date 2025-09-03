import { PrismaClient } from '@prisma/client';
import * as fs from 'fs-extra';
import * as path from 'path';
import { Phase2Queries } from './Phase2ReportQueries';
import { generateFileToken } from '../utils/fileTokenGenerator';

export class Phase2ReportGenerator {
  private prisma: PrismaClient;
  private outputDir: string;

  constructor(prisma: PrismaClient, outputDir: string = './output/phase2') {
    this.prisma = prisma;
    this.outputDir = outputDir;
  }

  /**
   * Generate all Phase 2 reports
   */
  async generateAll(trialId?: number): Promise<void> {
    console.log('Generating Phase 2 reports...');
    
    await this.generateStatementEventBySpeakerReports(trialId);
    await this.generateStatementEventBySpeakerTypeReports(trialId);
    await this.generateEventTimelineReports(trialId);
    await this.generateExaminationReports(trialId);
    
    console.log('Phase 2 report generation complete!');
  }

  /**
   * Generate StatementEvent Distribution by Speaker (Trial-Level) Reports
   */
  async generateStatementEventBySpeakerReports(trialId?: number): Promise<void> {
    const query = new Phase2Queries.StatementEventBySpeaker();
    const trials = trialId 
      ? await this.prisma.trial.findMany({ where: { id: trialId } })
      : await this.prisma.trial.findMany();

    await fs.ensureDir(this.outputDir);

    for (const trial of trials) {
      const results = await query.execute(this.prisma, { trialId: trial.id });
      
      if (results.length === 0) {
        console.log(`No statement events found for trial ${trial.id}`);
        continue;
      }

      const filename = `${trial.caseHandle || `trial_${trial.id}`}_speaker_distribution.csv`;
      const filepath = path.join(this.outputDir, filename);

      // Generate CSV content
      const csvLines = [
        'Speaker,Type,Total Statements,Line Max,Line Min,Line Mean,Line Median,Line Total,Word Max,Word Min,Word Mean,Word Median,Word Total'
      ];

      for (const result of results) {
        const line = [
          result.speakerAlias,
          result.speakerType,
          result.totalStatements,
          result.lineCount?.max || 0,
          result.lineCount?.min || 0,
          (result.lineCount?.mean || 0).toFixed(2),
          result.lineCount?.median || 0,
          result.lineCount?.total || 0,
          result.wordCount?.max || 0,
          result.wordCount?.min || 0,
          (result.wordCount?.mean || 0).toFixed(2),
          result.wordCount?.median || 0,
          result.wordCount?.total || 0
        ].join(',');
        csvLines.push(line);
      }

      await fs.writeFile(filepath, csvLines.join('\n'));
      console.log(`Generated: ${filename}`);
    }
  }

  /**
   * Generate StatementEvent Distribution by Speaker Type (Session-Level) Reports
   */
  async generateStatementEventBySpeakerTypeReports(trialId?: number): Promise<void> {
    const query = new Phase2Queries.StatementEventBySpeakerType();
    const results = await query.execute(this.prisma, { trialId });

    await fs.ensureDir(this.outputDir);

    // Group results by session
    const sessionGroups = new Map<string, any[]>();
    for (const result of results) {
      const session = result.session;
      const date = new Date(session.sessionDate);
      const sessionDate = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      const sessionType = session.sessionType.toLowerCase();
      const key = `${result.trial.caseHandle || `trial_${result.trial.id}`}_${sessionDate}_${sessionType}`;
      
      if (!sessionGroups.has(key)) {
        sessionGroups.set(key, []);
      }
      sessionGroups.get(key)!.push(result);
    }

    // Generate a file for each session
    for (const [sessionKey, sessionResults] of sessionGroups) {
      const filename = `${sessionKey}_speaker_type_distribution.csv`;
      const filepath = path.join(this.outputDir, filename);

      // Generate CSV content
      const csvLines = [
        'Speaker Type,Unique Speakers,Total Statements,Line Max,Line Min,Line Mean,Line Median,Line Total,Word Max,Word Min,Word Mean,Word Median,Word Total'
      ];

      for (const result of sessionResults) {
        const line = [
          result.speakerType,
          result.uniqueSpeakers || 0,
          result.totalStatements,
          result.lineCount?.max || 0,
          result.lineCount?.min || 0,
          (result.lineCount?.mean || 0).toFixed(2),
          result.lineCount?.median || 0,
          result.lineCount?.total || 0,
          result.wordCount?.max || 0,
          result.wordCount?.min || 0,
          (result.wordCount?.mean || 0).toFixed(2),
          result.wordCount?.median || 0,
          result.wordCount?.total || 0
        ].join(',');
        csvLines.push(line);
      }

      await fs.writeFile(filepath, csvLines.join('\n'));
      console.log(`Generated: ${filename}`);
    }
  }

  /**
   * Generate Event Timeline Reports
   */
  async generateEventTimelineReports(trialId?: number): Promise<void> {
    const query = new Phase2Queries.EventTimeline();
    const trials = trialId 
      ? await this.prisma.trial.findMany({ where: { id: trialId } })
      : await this.prisma.trial.findMany();

    await fs.ensureDir(this.outputDir);

    for (const trial of trials) {
      const results = await query.execute(this.prisma, { trialId: trial.id });
      
      if (results.length === 0) {
        console.log(`No events found for trial ${trial.id}`);
        continue;
      }

      const filename = `${trial.caseHandle || `trial_${trial.id}`}_event_timeline.txt`;
      const filepath = path.join(this.outputDir, filename);

      // Generate timeline content
      const lines: string[] = [];
      lines.push(`Event Timeline: ${trial.name || trial.caseNumber}`);
      lines.push('=' .repeat(80));
      lines.push('');

      let currentSession: any = null;
      for (const event of results) {
        if (event.session && event.session.id !== currentSession?.id) {
          currentSession = event.session;
          const date = new Date(currentSession.sessionDate);
          lines.push('');
          lines.push(`Session: ${date.toLocaleDateString()} - ${currentSession.sessionType}`);
          lines.push('-'.repeat(60));
        }

        lines.push(`[${event.sequenceNumber}] ${event.eventType} - ${event.speakerInfo}`);
        if (event.eventContent) {
          const content = event.eventContent.substring(0, 200);
          lines.push(`    ${content}${event.eventContent.length > 200 ? '...' : ''}`);
        }
      }

      await fs.writeFile(filepath, lines.join('\n'));
      console.log(`Generated: ${filename}`);
    }
  }

  /**
   * Generate Examination Reports
   */
  async generateExaminationReports(trialId?: number): Promise<void> {
    const query = new Phase2Queries.ExaminationReport();
    const results = await query.execute(this.prisma, { trialId });

    if (results.length === 0) {
      console.log('No examination data found');
      return;
    }

    await fs.ensureDir(this.outputDir);

    // Group by trial
    const trialGroups = new Map<string, any[]>();
    for (const result of results) {
      const trial = result.witness.trial;
      const key = trial.caseHandle || `trial_${trial.id}`;
      if (!trialGroups.has(key)) {
        trialGroups.set(key, []);
      }
      trialGroups.get(key)!.push(result);
    }

    for (const [trialKey, witnesses] of trialGroups) {
      const filename = `${trialKey}_examinations.txt`;
      const filepath = path.join(this.outputDir, filename);

      // Generate examination report content
      const lines: string[] = [];
      lines.push(`Witness Examination Report`);
      lines.push('=' .repeat(80));
      lines.push('');

      for (const witnessData of witnesses) {
        const witness = witnessData.witness;
        lines.push(`Witness: ${witness.displayName || witness.name || 'Unknown'}`);
        lines.push(`Total Examinations: ${witnessData.totalExaminations}`);
        lines.push(`  Direct: ${witnessData.examinationTypes.direct}`);
        lines.push(`  Cross: ${witnessData.examinationTypes.cross}`);
        lines.push(`  Redirect: ${witnessData.examinationTypes.redirect}`);
        lines.push(`  Recross: ${witnessData.examinationTypes.recross}`);
        lines.push('');

        // Group examinations by date for better readability
        const examsByDate = new Map<string, any[]>();
        for (const exam of witnessData.examinations) {
          const date = exam.sessionDate ? new Date(exam.sessionDate).toLocaleDateString() : 'Unknown';
          if (!examsByDate.has(date)) {
            examsByDate.set(date, []);
          }
          examsByDate.get(date)!.push(exam);
        }

        // Output examinations grouped by date
        for (const [date, exams] of examsByDate) {
          for (const exam of exams) {
            const sessionType = exam.sessionType ? ` (${exam.sessionType})` : '';
            const attorney = exam.examiningAttorney !== 'Unknown' ? ` by ${exam.examiningAttorney}` : '';
            const examType = exam.examinationType.replace('_', ' ');
            lines.push(`  ${examType} on ${date}${sessionType}${attorney}`);
          }
        }
        lines.push('');
        lines.push('-'.repeat(60));
        lines.push('');
      }

      await fs.writeFile(filepath, lines.join('\n'));
      console.log(`Generated: ${filename}`);
    }
  }
}