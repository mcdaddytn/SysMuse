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
    const available: string[] = ['abridged', 'abridged2', 'fulltext'];

    // Check if any pre-generated LLM summaries exist
    const section = await this.prisma.markerSection.findUnique({
      where: { id: sectionId }
    });

    if (section) {
      // Check for LLM summaries in the database or filesystem
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
   * Get abridged summary (initial excerpt + stats)
   */
  private async getAbridgedSummary(section: MarkerSection): Promise<string> {
    // First check if we have pre-generated summary
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
   * Get abridged2 summary (beginning and end excerpts + stats)
   */
  private async getAbridged2Summary(section: MarkerSection): Promise<string> {
    // First check if we have pre-generated summary
    const summaryPath = path.join('output', 'markersummary2', `section_${section.id}.txt`);
    if (fs.existsSync(summaryPath)) {
      return fs.readFileSync(summaryPath, 'utf-8');
    }

    // Generate summary on the fly if not pre-generated
    const events = await this.getTranscriptEvents(section);
    const stats = await this.getSectionStats(section);

    let summary = '';

    // Add beginning excerpt (first 3 statements)
    const beginningEvents = events.slice(0, 3);
    for (const event of beginningEvents) {
      if (event.statement?.speaker && event.statement?.text) {
        const speaker = event.statement.speaker.speakerHandle || 'UNKNOWN';
        const text = event.statement.text;
        summary += `${speaker}: ${text}\n`;
      }
    }

    summary += '\n...\n\n';

    // Add ending excerpt (last 3 statements)
    const endingEvents = events.slice(-3);
    for (const event of endingEvents) {
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
   * Get full text of the section
   */
  private async getFullText(section: MarkerSection): Promise<string> {
    // First check if we have pre-generated full text
    const fullTextPath = path.join('output', 'markersections', `section_${section.id}.txt`);
    if (fs.existsSync(fullTextPath)) {
      return fs.readFileSync(fullTextPath, 'utf-8');
    }

    // If we have text stored in the database, use that
    if (section.text) {
      return section.text;
    }

    // Generate full text on the fly
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