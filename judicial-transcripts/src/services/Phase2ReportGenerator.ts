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
   * Format a table row with aligned columns
   */
  private formatTableRow(columns: Array<{ value: string; width: number; align?: 'left' | 'right' }>): string {
    return columns.map(col => {
      const { value, width, align = 'left' } = col;
      if (align === 'right') {
        return value.padStart(width);
      }
      return value.padEnd(width);
    }).join(' ');
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

      const baseFilename = `${trial.caseHandle || `trial_${trial.id}`}_speaker_distribution`;
      
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

      // Write CSV file
      const csvFilepath = path.join(this.outputDir, `${baseFilename}.csv`);
      await fs.writeFile(csvFilepath, csvLines.join('\n'));
      console.log(`Generated: ${baseFilename}.csv`);

      // Generate formatted text version
      const textLines: string[] = [];
      textLines.push(`Speaker Distribution Report: ${trial.name || trial.caseNumber}`);
      textLines.push('=' .repeat(100));
      textLines.push('');
      
      // Format header
      textLines.push(this.formatTableRow([
        { value: 'Speaker', width: 25 },
        { value: 'Type', width: 10 },
        { value: 'Statements', width: 10, align: 'right' },
        { value: 'Lines', width: 15, align: 'right' },
        { value: 'Words', width: 15, align: 'right' },
        { value: 'Avg Lines', width: 10, align: 'right' },
        { value: 'Avg Words', width: 10, align: 'right' }
      ]));
      textLines.push('-'.repeat(100));

      // Sort results by total statements descending
      const sortedResults = [...results].sort((a, b) => b.totalStatements - a.totalStatements);

      for (const result of sortedResults) {
        textLines.push(this.formatTableRow([
          { value: result.speakerAlias, width: 25 },
          { value: result.speakerType, width: 10 },
          { value: result.totalStatements.toString(), width: 10, align: 'right' },
          { value: (result.lineCount?.total || 0).toString(), width: 15, align: 'right' },
          { value: (result.wordCount?.total || 0).toString(), width: 15, align: 'right' },
          { value: (result.lineCount?.mean || 0).toFixed(1), width: 10, align: 'right' },
          { value: (result.wordCount?.mean || 0).toFixed(1), width: 10, align: 'right' }
        ]));
      }

      textLines.push('');
      textLines.push('-'.repeat(100));
      textLines.push('Summary Statistics:');
      textLines.push(`  Total Speakers: ${results.length}`);
      textLines.push(`  Total Statements: ${results.reduce((sum, r) => sum + r.totalStatements, 0)}`);
      textLines.push(`  Total Lines: ${results.reduce((sum, r) => sum + (r.lineCount?.total || 0), 0)}`);
      textLines.push(`  Total Words: ${results.reduce((sum, r) => sum + (r.wordCount?.total || 0), 0)}`);

      // Write text file
      const textFilepath = path.join(this.outputDir, `${baseFilename}.txt`);
      await fs.writeFile(textFilepath, textLines.join('\n'));
      console.log(`Generated: ${baseFilename}.txt`);
    }
  }

  /**
   * Generate StatementEvent Distribution by Speaker Type Reports
   */
  async generateStatementEventBySpeakerTypeReports(trialId?: number): Promise<void> {
    const query = new Phase2Queries.StatementEventBySpeakerType();
    const results = await query.execute(this.prisma, { trialId });

    await fs.ensureDir(this.outputDir);

    // Also create trial-level aggregation
    const trialGroups = new Map<string, any[]>();
    
    // Group results by session and trial
    const sessionGroups = new Map<string, any[]>();
    for (const result of results) {
      const session = result.session;
      const date = new Date(session.sessionDate);
      const sessionDate = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      const sessionType = session.sessionType.toLowerCase();
      const sessionKey = `${result.trial.caseHandle || `trial_${result.trial.id}`}_${sessionDate}_${sessionType}`;
      const trialKey = result.trial.caseHandle || `trial_${result.trial.id}`;
      
      if (!sessionGroups.has(sessionKey)) {
        sessionGroups.set(sessionKey, []);
      }
      sessionGroups.get(sessionKey)!.push(result);
      
      if (!trialGroups.has(trialKey)) {
        trialGroups.set(trialKey, []);
      }
      trialGroups.get(trialKey)!.push(result);
    }

    // Generate session-level files
    for (const [sessionKey, sessionResults] of sessionGroups) {
      const baseFilename = `${sessionKey}_speaker_type_distribution`;

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

      // Write CSV file
      const csvFilepath = path.join(this.outputDir, `${baseFilename}.csv`);
      await fs.writeFile(csvFilepath, csvLines.join('\n'));
      console.log(`Generated: ${baseFilename}.csv`);

      // Generate formatted text version
      const textLines: string[] = [];
      const sessionInfo = sessionKey.split('_');
      textLines.push(`Speaker Type Distribution Report: Session ${sessionInfo.slice(-2).join(' ')}`);
      textLines.push('=' .repeat(100));
      textLines.push('');
      
      // Format header
      textLines.push(this.formatTableRow([
        { value: 'Speaker Type', width: 15 },
        { value: 'Speakers', width: 10, align: 'right' },
        { value: 'Statements', width: 12, align: 'right' },
        { value: 'Lines', width: 15, align: 'right' },
        { value: 'Words', width: 15, align: 'right' },
        { value: 'Avg Lines', width: 12, align: 'right' },
        { value: 'Avg Words', width: 12, align: 'right' }
      ]));
      textLines.push('-'.repeat(100));

      // Sort results by total statements descending
      const sortedResults = [...sessionResults].sort((a, b) => b.totalStatements - a.totalStatements);

      for (const result of sortedResults) {
        textLines.push(this.formatTableRow([
          { value: result.speakerType, width: 15 },
          { value: (result.uniqueSpeakers || 0).toString(), width: 10, align: 'right' },
          { value: result.totalStatements.toString(), width: 12, align: 'right' },
          { value: (result.lineCount?.total || 0).toString(), width: 15, align: 'right' },
          { value: (result.wordCount?.total || 0).toString(), width: 15, align: 'right' },
          { value: (result.lineCount?.mean || 0).toFixed(1), width: 12, align: 'right' },
          { value: (result.wordCount?.mean || 0).toFixed(1), width: 12, align: 'right' }
        ]));
      }

      // Write text file
      const textFilepath = path.join(this.outputDir, `${baseFilename}.txt`);
      await fs.writeFile(textFilepath, textLines.join('\n'));
      console.log(`Generated: ${baseFilename}.txt`);
    }

    // Generate trial-level aggregation files
    for (const [trialKey, trialResults] of trialGroups) {
      const baseFilename = `${trialKey}_speaker_type_summary`;
      
      // Aggregate data by speaker type across all sessions
      const typeAggregates = new Map<string, any>();
      
      for (const result of trialResults) {
        const type = result.speakerType;
        if (!typeAggregates.has(type)) {
          typeAggregates.set(type, {
            speakerType: type,
            uniqueSpeakers: new Set(),
            totalStatements: 0,
            lineTotal: 0,
            wordTotal: 0,
            lineCounts: [],
            wordCounts: []
          });
        }
        
        const agg = typeAggregates.get(type);
        agg.totalStatements += result.totalStatements;
        agg.lineTotal += result.lineCount?.total || 0;
        agg.wordTotal += result.wordCount?.total || 0;
        
        // Track unique speakers (would need speaker IDs from original query)
        if (result.uniqueSpeakers) {
          agg.uniqueSpeakers.add(result.session.id + '_' + type);
        }
      }

      // Generate CSV content
      const csvLines = [
        'Speaker Type,Total Statements,Total Lines,Total Words,Avg Lines/Statement,Avg Words/Statement'
      ];

      const aggregatedResults = Array.from(typeAggregates.values());
      for (const agg of aggregatedResults) {
        const avgLines = agg.totalStatements > 0 ? (agg.lineTotal / agg.totalStatements).toFixed(2) : '0';
        const avgWords = agg.totalStatements > 0 ? (agg.wordTotal / agg.totalStatements).toFixed(2) : '0';
        
        const line = [
          agg.speakerType,
          agg.totalStatements,
          agg.lineTotal,
          agg.wordTotal,
          avgLines,
          avgWords
        ].join(',');
        csvLines.push(line);
      }

      // Write CSV file
      const csvFilepath = path.join(this.outputDir, `${baseFilename}.csv`);
      await fs.writeFile(csvFilepath, csvLines.join('\n'));
      console.log(`Generated: ${baseFilename}.csv`);

      // Generate formatted text version
      const textLines: string[] = [];
      const trialName = trialResults[0]?.trial?.name || trialResults[0]?.trial?.caseNumber || trialKey;
      textLines.push(`Speaker Type Summary Report: ${trialName}`);
      textLines.push('=' .repeat(100));
      textLines.push('');
      
      // Format header
      textLines.push(this.formatTableRow([
        { value: 'Speaker Type', width: 15 },
        { value: 'Statements', width: 15, align: 'right' },
        { value: 'Lines', width: 15, align: 'right' },
        { value: 'Words', width: 15, align: 'right' },
        { value: 'Avg Lines', width: 15, align: 'right' },
        { value: 'Avg Words', width: 15, align: 'right' }
      ]));
      textLines.push('-'.repeat(100));

      // Sort results by total statements descending
      const sortedAggregates = aggregatedResults.sort((a, b) => b.totalStatements - a.totalStatements);

      for (const agg of sortedAggregates) {
        const avgLines = agg.totalStatements > 0 ? (agg.lineTotal / agg.totalStatements).toFixed(1) : '0';
        const avgWords = agg.totalStatements > 0 ? (agg.wordTotal / agg.totalStatements).toFixed(1) : '0';
        
        textLines.push(this.formatTableRow([
          { value: agg.speakerType, width: 15 },
          { value: agg.totalStatements.toString(), width: 15, align: 'right' },
          { value: agg.lineTotal.toString(), width: 15, align: 'right' },
          { value: agg.wordTotal.toString(), width: 15, align: 'right' },
          { value: avgLines, width: 15, align: 'right' },
          { value: avgWords, width: 15, align: 'right' }
        ]));
      }

      textLines.push('');
      textLines.push('-'.repeat(100));
      textLines.push('Summary Statistics:');
      textLines.push(`  Total Statement Events: ${aggregatedResults.reduce((sum, r) => sum + r.totalStatements, 0)}`);
      textLines.push(`  Total Lines: ${aggregatedResults.reduce((sum, r) => sum + r.lineTotal, 0)}`);
      textLines.push(`  Total Words: ${aggregatedResults.reduce((sum, r) => sum + r.wordTotal, 0)}`);

      // Write text file
      const textFilepath = path.join(this.outputDir, `${baseFilename}.txt`);
      await fs.writeFile(textFilepath, textLines.join('\n'));
      console.log(`Generated: ${baseFilename}.txt`);
    }
  }

  /**
   * Generate All Trials Speaker Type Distribution Report
   */
  async generateAllTrialsSpeakerTypeDistribution(): Promise<void> {
    // Get all trials with speaker type distribution data
    const query = new Phase2Queries.StatementEventBySpeakerType();
    const results = await query.execute(this.prisma, {}); // No trialId filter - get all

    await fs.ensureDir(this.outputDir);

    // Group results by trial and speaker type
    const trialData = new Map<number, {
      trial: any,
      speakerTypes: Map<string, {
        type: string,
        totalStatements: number,
        lineTotal: number,
        wordTotal: number,
        uniqueSpeakers: Set<string>
      }>
    }>();

    for (const result of results) {
      const trialId = result.trial.id;
      
      if (!trialData.has(trialId)) {
        trialData.set(trialId, {
          trial: result.trial,
          speakerTypes: new Map()
        });
      }

      const trialEntry = trialData.get(trialId)!;
      const type = result.speakerType;

      if (!trialEntry.speakerTypes.has(type)) {
        trialEntry.speakerTypes.set(type, {
          type,
          totalStatements: 0,
          lineTotal: 0,
          wordTotal: 0,
          uniqueSpeakers: new Set()
        });
      }

      const typeData = trialEntry.speakerTypes.get(type)!;
      typeData.totalStatements += result.totalStatements || 0;
      typeData.lineTotal += result.lineCount?.total || 0;
      typeData.wordTotal += result.wordCount?.total || 0;
      
      // Track unique speakers per type
      if (result.uniqueSpeakers) {
        typeData.uniqueSpeakers.add(`${result.session.id}_${type}`);
      }
    }

    // Generate CSV with all trials
    const csvLines = [
      'Trial Short Name,Case Number,Speaker Type,Total Statements,Total Lines,Total Words,Avg Lines/Statement,Avg Words/Statement'
    ];

    const textLines: string[] = [];
    textLines.push('All Trials Speaker Type Distribution Report');
    textLines.push('=' .repeat(120));
    textLines.push('');

    // Sort trials by shortName or id
    const sortedTrials = Array.from(trialData.entries())
      .sort((a, b) => {
        const aName = a[1].trial.shortName || a[1].trial.name || `Trial ${a[0]}`;
        const bName = b[1].trial.shortName || b[1].trial.name || `Trial ${b[0]}`;
        return aName.localeCompare(bName);
      });

    for (const [trialId, data] of sortedTrials) {
      const trial = data.trial;
      const shortName = trial.shortName || trial.name || `Trial ${trialId}`;
      const caseNumber = trial.caseNumber || 'N/A';

      // Add to text report
      textLines.push(`Trial: ${shortName} (${caseNumber})`);
      textLines.push('-'.repeat(80));
      
      // Sort speaker types alphabetically
      const sortedTypes = Array.from(data.speakerTypes.values())
        .sort((a, b) => a.type.localeCompare(b.type));

      for (const typeData of sortedTypes) {
        const avgLines = typeData.totalStatements > 0 
          ? (typeData.lineTotal / typeData.totalStatements).toFixed(2) 
          : '0';
        const avgWords = typeData.totalStatements > 0 
          ? (typeData.wordTotal / typeData.totalStatements).toFixed(2) 
          : '0';

        // Add CSV row
        csvLines.push([
          `"${shortName}"`,
          `"${caseNumber}"`,
          typeData.type,
          typeData.totalStatements,
          typeData.lineTotal,
          typeData.wordTotal,
          avgLines,
          avgWords
        ].join(','));

        // Add text row
        textLines.push(`  ${typeData.type.padEnd(20)} - Statements: ${String(typeData.totalStatements).padStart(6)} | Lines: ${String(typeData.lineTotal).padStart(8)} | Words: ${String(typeData.wordTotal).padStart(10)}`);
      }
      
      textLines.push('');
    }

    // Write CSV file
    const csvFilepath = path.join(this.outputDir, 'speaker_type_distribution_all_trials.csv');
    await fs.writeFile(csvFilepath, csvLines.join('\n'));
    console.log(`Generated: speaker_type_distribution_all_trials.csv`);

    // Write text file
    const textFilepath = path.join(this.outputDir, 'speaker_type_distribution_all_trials.txt');
    await fs.writeFile(textFilepath, textLines.join('\n'));
    console.log(`Generated: speaker_type_distribution_all_trials.txt`);

    // Generate summary statistics
    const summaryLines: string[] = [];
    summaryLines.push('');
    summaryLines.push('SUMMARY STATISTICS');
    summaryLines.push('=' .repeat(80));
    summaryLines.push(`Total Trials: ${trialData.size}`);
    
    // Aggregate totals across all trials
    let grandTotalStatements = 0;
    let grandTotalLines = 0;
    let grandTotalWords = 0;
    const speakerTypeGrandTotals = new Map<string, number>();

    for (const [_, data] of trialData) {
      for (const typeData of data.speakerTypes.values()) {
        grandTotalStatements += typeData.totalStatements;
        grandTotalLines += typeData.lineTotal;
        grandTotalWords += typeData.wordTotal;
        
        const current = speakerTypeGrandTotals.get(typeData.type) || 0;
        speakerTypeGrandTotals.set(typeData.type, current + typeData.totalStatements);
      }
    }

    summaryLines.push(`Total Statements: ${grandTotalStatements.toLocaleString()}`);
    summaryLines.push(`Total Lines: ${grandTotalLines.toLocaleString()}`);
    summaryLines.push(`Total Words: ${grandTotalWords.toLocaleString()}`);
    summaryLines.push('');
    summaryLines.push('Statements by Speaker Type (All Trials):');
    
    const sortedGrandTotals = Array.from(speakerTypeGrandTotals.entries())
      .sort((a, b) => b[1] - a[1]); // Sort by count descending
    
    for (const [type, count] of sortedGrandTotals) {
      const percentage = ((count / grandTotalStatements) * 100).toFixed(1);
      summaryLines.push(`  ${type.padEnd(20)} - ${String(count).padStart(8)} (${percentage}%)`);
    }

    // Append summary to text file
    await fs.appendFile(textFilepath, '\n' + summaryLines.join('\n'));
    console.log('Added summary statistics to text report');
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