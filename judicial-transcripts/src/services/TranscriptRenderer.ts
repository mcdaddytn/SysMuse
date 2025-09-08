import { PrismaClient, MarkerSection, TrialEvent } from '@prisma/client';
import * as Mustache from 'mustache';
import * as fs from 'fs';
import * as path from 'path';
import { Logger } from '../utils/logger';

export interface RenderedSection {
  sectionId: number;
  sectionType: string;
  sectionName: string;
  startEventId: number | null;
  endEventId: number | null;
  eventCount: number;
  renderedText: string;
  summary?: string;
}

export class TranscriptRenderer {
  private logger = new Logger('TranscriptRenderer');
  private defaultTemplate: string;

  constructor(private prisma: PrismaClient) {
    // Load default template
    const templatePath = path.join(__dirname, '../../templates/default-transcript.mustache');
    try {
      this.defaultTemplate = fs.readFileSync(templatePath, 'utf-8');
      this.logger.debug('Loaded default transcript template');
    } catch (error) {
      this.logger.warn('Could not load template file, using inline default');
      // Fallback inline template
      this.defaultTemplate = `{{#events}}{{#statement}}{{speaker.speakerHandle}}: {{text}}

{{/statement}}{{/events}}`;
    }
  }

  /**
   * Render a single marker section
   */
  async renderSection(sectionId: number): Promise<RenderedSection | null> {
    const section = await this.prisma.markerSection.findUnique({
      where: { id: sectionId }
    });

    if (!section) {
      this.logger.error(`Section ${sectionId} not found`);
      return null;
    }

    return this.renderMarkerSection(section);
  }

  /**
   * Render a marker section with its events
   */
  async renderMarkerSection(section: MarkerSection): Promise<RenderedSection> {
    this.logger.debug(`Rendering section ${section.id}: ${section.name}`);

    // Get events within the section bounds
    let events: any[] = [];
    let eventCount = 0;

    if (section.startEventId && section.endEventId) {
      events = await this.prisma.trialEvent.findMany({
        where: {
          trialId: section.trialId,
          id: {
            gte: section.startEventId,
            lte: section.endEventId
          },
          eventType: 'STATEMENT' // Focus on statements
        },
        include: {
          statement: {
            include: {
              speaker: true
            }
          }
        },
        orderBy: { ordinal: 'asc' },
        take: 1000 // Limit for performance
      });

      eventCount = await this.prisma.trialEvent.count({
        where: {
          trialId: section.trialId,
          id: {
            gte: section.startEventId,
            lte: section.endEventId
          }
        }
      });
    }

    // Prepare data for Mustache
    const templateData = {
      section: {
        id: section.id,
        name: section.name,
        type: section.markerSectionType,
        description: section.description
      },
      events: events.map(e => ({
        id: e.id,
        ordinal: e.ordinal,
        statement: e.statement ? {
          text: e.statement.text,
          speaker: {
            speakerHandle: this.formatSpeakerHandle(e.statement.speaker?.speakerHandle),
            speakerType: e.statement.speaker?.speakerType
          }
        } : null
      }))
    };

    // Render with Mustache
    const renderedText = Mustache.render(this.defaultTemplate, templateData);
    
    // Generate auto-summary
    const summary = this.generateAutoSummary(renderedText, eventCount);

    return {
      sectionId: section.id,
      sectionType: section.markerSectionType,
      sectionName: section.name || 'Unnamed Section',
      startEventId: section.startEventId,
      endEventId: section.endEventId,
      eventCount,
      renderedText,
      summary
    };
  }

  /**
   * Render all sections for a trial
   */
  async renderTrialSections(trialId: number, sectionTypes?: string[]): Promise<RenderedSection[]> {
    const whereClause: any = { trialId };
    if (sectionTypes && sectionTypes.length > 0) {
      whereClause.markerSectionType = { in: sectionTypes };
    }

    const sections = await this.prisma.markerSection.findMany({
      where: whereClause,
      orderBy: { startEventId: 'asc' }
    });

    this.logger.info(`Rendering ${sections.length} sections for trial ${trialId}`);

    const rendered: RenderedSection[] = [];
    for (const section of sections) {
      const result = await this.renderMarkerSection(section);
      rendered.push(result);
    }

    return rendered;
  }

  /**
   * Render a specific section type (e.g., opening statements)
   */
  async renderSectionByType(trialId: number, sectionType: string): Promise<RenderedSection | null> {
    const section = await this.prisma.markerSection.findFirst({
      where: {
        trialId,
        markerSectionType: sectionType as any
      }
    });

    if (!section) {
      this.logger.warn(`No section of type ${sectionType} found for trial ${trialId}`);
      return null;
    }

    return this.renderMarkerSection(section);
  }

  /**
   * Format speaker handle for display
   */
  private formatSpeakerHandle(handle?: string | null): string {
    if (!handle) return 'UNKNOWN';
    
    // Clean up underscores and format nicely
    return handle
      .replace(/_/g, ' ')
      .replace(/^(MR|MS|MRS|DR|ATTORNEY|WITNESS|JUROR)\.?\s+/i, (match) => {
        // Capitalize titles properly
        const title = match.trim().replace('.', '');
        return title.charAt(0).toUpperCase() + title.slice(1).toLowerCase() + '. ';
      })
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Generate auto-summary from rendered text
   */
  private generateAutoSummary(renderedText: string, eventCount: number): string {
    const lines = renderedText.split('\n').filter(l => l.trim());
    const wordCount = renderedText.split(/\s+/).filter(w => w.trim()).length;
    const charCount = renderedText.length;
    
    // Get first few meaningful lines (skip empty lines)
    const excerptLines = lines.slice(0, 5);
    const excerpt = excerptLines.join('\n');
    
    // Create summary with excerpt and statistics
    const summary = `${excerpt}${excerptLines.length < lines.length ? '\n...' : ''}

[Summary: ${eventCount} events, ${lines.length} lines, ${wordCount} words, ${charCount} characters]`;
    
    return summary;
  }

  /**
   * Save auto-summary to MarkerSection.text field
   */
  async saveAutoSummary(sectionId: number, summary: string): Promise<void> {
    await this.prisma.markerSection.update({
      where: { id: sectionId },
      data: { text: summary }
    });
    this.logger.debug(`Saved auto-summary for section ${sectionId}`);
  }

  /**
   * Render section and save auto-summary to database
   */
  async renderAndSaveSummary(sectionId: number): Promise<RenderedSection | null> {
    const rendered = await this.renderSection(sectionId);
    
    if (rendered && rendered.summary) {
      await this.saveAutoSummary(sectionId, rendered.summary);
    }
    
    return rendered;
  }

  /**
   * Save rendered section to file
   */
  async saveRenderedSection(
    rendered: RenderedSection, 
    outputPath: string
  ): Promise<void> {
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const header = `
================================================================================
Section: ${rendered.sectionName}
Type: ${rendered.sectionType}
Events: ${rendered.startEventId} - ${rendered.endEventId} (${rendered.eventCount} total)
================================================================================

`;

    fs.writeFileSync(outputPath, header + rendered.renderedText);
    this.logger.info(`Saved rendered section to ${outputPath}`);
  }
}