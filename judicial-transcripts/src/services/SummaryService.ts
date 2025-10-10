import { PrismaClient, MarkerSection } from '@prisma/client';
import { Logger } from '../utils/logger';
import * as fs from 'fs';
import * as path from 'path';

const logger = new Logger('SummaryService');

export class SummaryService {
  constructor(private prisma: PrismaClient) {}

  /**
   * Get list of available summary types for a section
   */
  async getAvailableSummaries(sectionId: number): Promise<string[]> {
    const available: string[] = ['abridged', 'abridged2', 'fulltext', 'llmsummary1'];

    // Check if any pre-generated LLM summaries exist
    const section = await this.prisma.markerSection.findUnique({
      where: { id: sectionId }
    });

    if (section) {
      // Check for additional LLM summaries in the database or filesystem
      const llmSummariesPath = path.join('output', 'llm-summaries', `section_${sectionId}`);
      if (fs.existsSync(llmSummariesPath)) {
        try {
          const files = fs.readdirSync(llmSummariesPath);
          files.forEach(file => {
            if (file.endsWith('.txt')) {
              const summaryType = file.replace('.txt', '');
              if (!available.includes(summaryType)) {
                available.push(summaryType);
              }
            }
          });
        } catch (error) {
          logger.warn(`Could not read LLM summaries directory: ${error}`);
        }
      }
    }

    return available;
  }

  /**
   * Get summary content for a section
   */
  async getSummary(
    sectionId: number,
    summaryType: string = 'abridged',
    maxLength?: number
  ): Promise<string> {
    const section = await this.prisma.markerSection.findUnique({
      where: { id: sectionId }
    });

    if (!section) {
      throw new Error(`Section ${sectionId} not found`);
    }

    let content = '';

    switch (summaryType) {
      case 'abridged':
        content = await this.getAbridgedSummary(section);
        break;
      case 'abridged2':
        content = await this.getAbridged2Summary(section);
        break;
      case 'fulltext':
        content = await this.getFullText(section);
        break;
      case 'llmsummary1':
        content = await this.getLLMSummary1(section);
        break;
      default:
        // Check for pre-generated LLM summary
        content = await this.getLLMSummary(section, summaryType);
        if (!content) {
          // Fall back to abridged if summary type not found
          logger.warn(`Summary type ${summaryType} not found for section ${sectionId}, falling back to abridged`);
          content = await this.getAbridgedSummary(section);
        }
    }

    // Apply max length if specified
    if (maxLength && content.length > maxLength) {
      content = content.substring(0, maxLength) + '...';
    }

    return content;
  }

  /**
   * Get abridged summary (from MarkerSection.text or Abridged1 file)
   */
  private async getAbridgedSummary(section: MarkerSection): Promise<string> {
    // First try to load from Abridged1 file
    const trial = await this.prisma.trial.findUnique({
      where: { id: section.trialId },
      select: { shortName: true }
    });

    if (trial?.shortName && section.name) {
      const fileName = this.generateConciseFileName(section.name, false);
      const abridged1Path = path.join('output', 'markersections', trial.shortName, 'Abridged1', `${fileName}.txt`);

      if (fs.existsSync(abridged1Path)) {
        logger.debug(`Loading Abridged1 from file: ${abridged1Path}`);
        return fs.readFileSync(abridged1Path, 'utf-8');
      }
    }

    // Fall back to MarkerSection.text if file not found
    if (section.text) {
      return section.text;
    }

    // Otherwise check if we have pre-generated summary
    const summaryPath = path.join('output', 'markersummary1', `section_${section.id}.txt`);
    if (fs.existsSync(summaryPath)) {
      return fs.readFileSync(summaryPath, 'utf-8');
    }

    // Generate summary on the fly if not pre-generated
    const events = await this.getTranscriptEvents(section);
    const stats = await this.getSectionStats(section);

    let summary = '';

    // Add initial excerpt (first 5 statements)
    const excerptEvents = events.slice(0, 5);
    for (const event of excerptEvents) {
      if (event.statement?.speaker && event.statement?.text) {
        const speaker = event.statement.speaker.speakerHandle || 'UNKNOWN';
        const text = event.statement.text;
        summary += `${speaker}: ${text}\n`;
      }
    }

    // Add statistics
    summary += `\n[${stats.eventCount} events, ${stats.wordCount.toLocaleString()} words`;
    if (stats.duration) {
      summary += `, ${stats.duration}`;
    }
    summary += `]`;

    return summary;
  }

  /**
   * Get abridged2 summary (from Abridged2 file or MarkerSection.text)
   */
  private async getAbridged2Summary(section: MarkerSection): Promise<string> {
    // First try to load from Abridged2 file
    const trial = await this.prisma.trial.findUnique({
      where: { id: section.trialId },
      select: { shortName: true }
    });

    if (trial?.shortName && section.name) {
      const fileName = this.generateConciseFileName(section.name, false);
      const abridged2Path = path.join('output', 'markersections', trial.shortName, 'Abridged2', `${fileName}.txt`);

      if (fs.existsSync(abridged2Path)) {
        logger.debug(`Loading Abridged2 from file: ${abridged2Path}`);
        return fs.readFileSync(abridged2Path, 'utf-8');
      }
    }

    // Fall back to MarkerSection.text if file not found
    if (section.text) {
      return section.text;
    }

    // Fallback to abridged summary generation
    return this.getAbridgedSummary(section);
  }

  /**
   * Get full text of the section
   */
  private async getFullText(section: MarkerSection): Promise<string> {
    // Get the trial information to construct the file path
    const trial = await this.prisma.trial.findUnique({
      where: { id: section.trialId },
      select: { shortName: true }
    });

    if (trial?.shortName && section.name) {
      // Try new structure first: output/markersections/[shortName]/FullText/[conciseName].txt
      const fileName = this.generateConciseFileName(section.name, false);
      const fullTextPath = path.join('output', 'markersections', trial.shortName, 'FullText', `${fileName}.txt`);

      if (fs.existsSync(fullTextPath)) {
        logger.info(`Loading full text from file: ${fullTextPath}`);
        return fs.readFileSync(fullTextPath, 'utf-8');
      } else {
        // Try old structure as fallback
        const oldFileName = `${trial.shortName}_${section.name.replace(/\s+/g, '_')}.txt`;
        const oldPath = path.join('output', 'markersections', trial.shortName, oldFileName);

        if (fs.existsSync(oldPath)) {
          logger.info(`Loading full text from old path: ${oldPath}`);
          return fs.readFileSync(oldPath, 'utf-8');
        } else {
          logger.warn(`Full text file not found: ${fullTextPath}`);
        }
      }
    }

    // If we have text stored in the database, use that as fallback
    if (section.text) {
      return section.text;
    }

    // Generate full text on the fly as last resort
    const events = await this.getTranscriptEvents(section);
    let fullText = '';

    for (const event of events) {
      if (event.statement?.speaker && event.statement?.text) {
        const speaker = event.statement.speaker.speakerHandle || 'UNKNOWN';
        const text = event.statement.text;
        fullText += `${speaker}: ${text}\n`;
      }
    }

    return fullText || '[No transcript available]';
  }

  /**
   * Get pre-generated LLM summary if available
   */
  private async getLLMSummary(section: MarkerSection, summaryType: string): Promise<string> {
    const summaryPath = path.join('output', 'llm-summaries', `section_${section.id}`, `${summaryType}.txt`);

    if (fs.existsSync(summaryPath)) {
      return fs.readFileSync(summaryPath, 'utf-8');
    }

    return '';
  }

  /**
   * Get LLMSummary1 with fallback to abridged summary
   */
  private async getLLMSummary1(section: MarkerSection): Promise<string> {
    // First check if LLMSummary1 exists for this section
    const trial = await this.prisma.trial.findUnique({
      where: { id: section.trialId },
      select: { shortName: true }
    });

    if (trial?.shortName && section.name) {
      // Map section type to LLMSummary1 file name format
      let llmFileName = '';
      if (section.markerSectionType === 'OPENING_STATEMENT_PLAINTIFF') {
        llmFileName = 'Plaintiff_Opening_Statement.txt';
      } else if (section.markerSectionType === 'OPENING_STATEMENT_DEFENSE') {
        llmFileName = 'Defense_Opening_Statement.txt';
      } else if (section.markerSectionType === 'CLOSING_STATEMENT_PLAINTIFF') {
        llmFileName = 'Plaintiff_Closing_Statement.txt';
      } else if (section.markerSectionType === 'CLOSING_STATEMENT_DEFENSE') {
        llmFileName = 'Defense_Closing_Statement.txt';
      } else if (section.markerSectionType === 'CLOSING_REBUTTAL_PLAINTIFF') {
        llmFileName = 'Plaintiff_Rebuttal.txt';
      }

      if (llmFileName) {
        const llmPath = path.join('output', 'markersections', trial.shortName, 'LLMSummary1', llmFileName);
        if (fs.existsSync(llmPath)) {
          logger.debug(`Loading LLMSummary1 from: ${llmPath}`);
          return fs.readFileSync(llmPath, 'utf-8');
        }
      }
    }

    // If LLMSummary1 not available, return abridged with a note
    logger.info(`LLMSummary1 not available for section ${section.id}, using fallback`);
    const fallbackContent = await this.getAbridgedSummary(section);
    return `[LLM Summary not available - showing Abridged summary]\n[Request generation to create LLM summary]\n\n${fallbackContent}`;
  }

  /**
   * Get transcript events for a section
   */
  private async getTranscriptEvents(section: MarkerSection): Promise<any[]> {
    if (!section.startEventId || !section.endEventId) {
      return [];
    }

    return await this.prisma.trialEvent.findMany({
      where: {
        trialId: section.trialId,
        id: {
          gte: section.startEventId,
          lte: section.endEventId
        },
        eventType: 'STATEMENT'
      },
      include: {
        statement: {
          include: {
            speaker: true
          }
        }
      },
      orderBy: { ordinal: 'asc' }
    });
  }

  /**
   * Get statistics for a section
   */
  private async getSectionStats(section: MarkerSection): Promise<any> {
    if (!section.startEventId || !section.endEventId) {
      return {
        eventCount: 0,
        wordCount: 0,
        duration: null
      };
    }

    const eventCount = section.endEventId - section.startEventId + 1;

    // Calculate word count
    const statements = await this.prisma.trialEvent.findMany({
      where: {
        trialId: section.trialId,
        id: {
          gte: section.startEventId,
          lte: section.endEventId
        },
        eventType: 'STATEMENT'
      },
      include: {
        statement: {
          select: {
            text: true
          }
        }
      }
    });

    let wordCount = 0;
    for (const event of statements) {
      if (event.statement?.text) {
        const words = event.statement.text.trim().split(/\s+/).filter(word => word.length > 0);
        wordCount += words.length;
      }
    }

    // Calculate duration if we have time information
    let duration = null;
    if (section.startTime && section.endTime) {
      const durationMs = new Date(section.endTime).getTime() - new Date(section.startTime).getTime();
      const minutes = Math.round(durationMs / 60000);
      if (minutes < 60) {
        duration = `${minutes} minutes`;
      } else {
        const hours = Math.floor(minutes / 60);
        const remainingMinutes = minutes % 60;
        duration = `${hours}h ${remainingMinutes}m`;
      }
    }

    return {
      eventCount,
      wordCount,
      duration
    };
  }

  /**
   * Generate concise file name for MarkerSection (matching TranscriptRenderer)
   */
  private generateConciseFileName(name: string, includeTrialPrefix: boolean = false): string {
    let fileName = name || 'unnamed';

    // Apply abbreviations
    fileName = fileName
      .replace(/WitnessExamination/g, 'WitExam')
      .replace(/WITNESS_EXAMINATION/g, 'WitExam')
      .replace(/REDIRECT_EXAMINATION/g, 'Redir')
      .replace(/RECROSS_EXAMINATION/g, 'Recross')
      .replace(/DIRECT_EXAMINATION/g, 'Direct')
      .replace(/CROSS_EXAMINATION/g, 'Cross')
      .replace(/OPENING_STATEMENT/g, 'Opening')
      .replace(/CLOSING_STATEMENT/g, 'Closing')
      .replace(/WITNESS_TESTIMONY/g, 'WitTest')
      .replace(/\s+/g, '_')
      .replace(/[^a-zA-Z0-9_-]/g, '');

    return fileName;
  }

  /**
   * Pre-generate all standard summaries for a trial
   * This can be called during processing to prepare summaries in advance
   */
  async preGenerateSummaries(trialId: number): Promise<void> {
    logger.info(`Pre-generating summaries for trial ${trialId}`);

    const sections = await this.prisma.markerSection.findMany({
      where: { trialId }
    });

    // Create output directories if they don't exist
    const dirs = [
      path.join('output', 'markersummary1'),
      path.join('output', 'markersummary2'),
      path.join('output', 'markersections')
    ];

    for (const dir of dirs) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }

    // Generate summaries for each section
    for (const section of sections) {
      try {
        // Generate and save abridged summary
        const abridged = await this.getAbridgedSummary(section);
        fs.writeFileSync(
          path.join('output', 'markersummary1', `section_${section.id}.txt`),
          abridged
        );

        // Generate and save abridged2 summary
        const abridged2 = await this.getAbridged2Summary(section);
        fs.writeFileSync(
          path.join('output', 'markersummary2', `section_${section.id}.txt`),
          abridged2
        );

        // Generate and save full text
        const fullText = await this.getFullText(section);
        fs.writeFileSync(
          path.join('output', 'markersections', `section_${section.id}.txt`),
          fullText
        );

        logger.info(`Generated summaries for section ${section.id} (${section.name})`);
      } catch (error) {
        logger.error(`Failed to generate summaries for section ${section.id}: ${error}`);
      }
    }

    logger.info(`Completed pre-generating summaries for trial ${trialId}`);
  }
}