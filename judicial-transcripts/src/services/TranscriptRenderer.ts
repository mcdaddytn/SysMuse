import { PrismaClient, MarkerSection, TrialEvent } from '@prisma/client';
import * as Mustache from 'mustache';
import * as fs from 'fs';
import * as path from 'path';
import { Logger } from '../utils/logger';

export type SummaryMode = 'SUMMARYABRIDGED1' | 'SUMMARYABRIDGED2';

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
  private summaryMode: SummaryMode = 'SUMMARYABRIDGED2';
  private markerAppendMode: string = 'space';
  private markerCleanMode: string = 'REMOVEEXTRASPACE';
  private trialStyleConfig: any;

  constructor(private prisma: PrismaClient, config?: any) {
    // Store configuration for later use
    this.trialStyleConfig = config;

    // Load configuration options
    if (config) {
      this.summaryMode = config.markerSummaryMode || 'SUMMARYABRIDGED2';
      this.markerAppendMode = config.markerAppendMode || 'space';
      this.markerCleanMode = config.markerCleanMode || 'REMOVEEXTRASPACE';
    }
    
    // Load default template
    const templatePath = path.join(__dirname, '../../templates/default-transcript.mustache');
    try {
      this.defaultTemplate = fs.readFileSync(templatePath, 'utf-8');
      this.logger.debug('Loaded default transcript template');
    } catch (error) {
      this.logger.warn('Could not load template file, using inline default');
      // Fallback inline template with HTML entity encoding disabled
      this.defaultTemplate = `{{#events}}{{#statement}}{{{speaker.speakerHandle}}}: {{{text}}}

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

    // Render with Mustache (disable HTML escaping)
    const renderedText = Mustache.render(this.defaultTemplate, templateData, {}, {
      escape: (text: string) => text // Don't escape HTML entities
    });
    
    // Generate auto-summary based on configured mode
    const summary = this.generateAutoSummary(renderedText, eventCount, this.summaryMode);

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
  private generateAutoSummary(renderedText: string, eventCount: number, mode: SummaryMode = 'SUMMARYABRIDGED1'): string {
    const lines = renderedText.split('\n').filter(l => l.trim());
    const wordCount = renderedText.split(/\s+/).filter(w => w.trim()).length;
    const charCount = renderedText.length;
    const speakers = new Set<string>();
    
    // Extract speaker information
    lines.forEach(line => {
      const match = line.match(/^([A-Z][A-Z .]+?):\s/);
      if (match) {
        speakers.add(match[1]);
      }
    });
    
    if (mode === 'SUMMARYABRIDGED1') {
      // Original mode: excerpt from beginning + summary
      const excerptLines = lines.slice(0, 5);
      const excerpt = this.applyTextCleaning(excerptLines.join('\n'));
      
      const summary = `${excerpt}${excerptLines.length < lines.length ? '\n...' : ''}

[Summary: ${eventCount} events, ${lines.length} lines, ${wordCount} words, ${speakers.size} speakers, ${charCount} characters]`;
      
      return summary;
    } else {
      // SUMMARYABRIDGED2: excerpt from beginning + excerpt from end + summary
      const beginExcerptLines = lines.slice(0, 3);
      const endExcerptLines = lines.slice(-3);
      
      const beginExcerpt = this.applyTextCleaning(beginExcerptLines.join('\n'));
      const endExcerpt = this.applyTextCleaning(endExcerptLines.join('\n'));
      
      let summary = beginExcerpt;
      if (lines.length > 6) {
        summary += '\n...\n' + endExcerpt;
      }
      
      summary += `\n\n[Summary: ${eventCount} events, ${lines.length} lines, ${wordCount} words, ${speakers.size} speakers, ${charCount} characters]`;
      
      return summary;
    }
  }
  
  /**
   * Apply text cleaning based on markerCleanMode
   */
  private applyTextCleaning(text: string): string {
    if (this.markerCleanMode === 'REMOVEEXTRASPACE') {
      // Remove extra whitespace while preserving line breaks
      return text.split('\n')
        .map(line => line.replace(/\s+/g, ' ').trim())
        .join('\n');
    }
    return text;
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
  async renderAndSaveSummary(sectionId: number, saveToFile: boolean = false): Promise<RenderedSection | null> {
    const rendered = await this.renderSection(sectionId);
    
    if (rendered && rendered.summary) {
      await this.saveAutoSummary(sectionId, rendered.summary);
      
      // Optionally save full text to file
      if (saveToFile) {
        // Save full text
        await this.saveMarkerSectionToFile(sectionId, rendered.renderedText, 'FullText');

        // Save truncated summaries
        if (rendered.summary && rendered.summary !== rendered.renderedText) {
          // Get section for statistics
          const section = await this.prisma.markerSection.findUnique({
            where: { id: sectionId }
          });

          // Save Abridged1 (truncated to ~2500 chars)
          const maxLengthAbridged1 = 2500;
          const abridged1 = this.truncateToLength(rendered.summary, maxLengthAbridged1);
          await this.saveMarkerSectionToFile(sectionId, abridged1, 'Abridged1');

          // Generate and save Abridged2 (beginning + end with stats)
          const maxLengthAbridged2 = 2500;
          const alternateSummary = this.generateAlternateTruncatedSummary(rendered.renderedText, maxLengthAbridged2, section);
          if (alternateSummary) {
            await this.saveMarkerSectionToFile(sectionId, alternateSummary, 'Abridged2');
          }
        }
      }
    }
    
    return rendered;
  }
  
  /**
   * Save MarkerSection full text to file
   */
  async saveMarkerSectionToFile(sectionId: number, text: string, summaryType: string = 'FullText'): Promise<void> {
    const section = await this.prisma.markerSection.findUnique({
      where: { id: sectionId },
      include: {
        trial: true
      }
    });

    if (!section) {
      this.logger.warn(`Cannot save to file: Section ${sectionId} not found`);
      return;
    }

    // Create output directory with summary type subdirectory
    const trialDir = section.trial.shortName || `trial_${section.trialId}`;
    const outputDir = path.join('./output/markersections', trialDir, summaryType);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Generate filename from section name (without trial prefix)
    const fileName = this.generateConciseFileName(section, false);
    const filePath = path.join(outputDir, `${fileName}.txt`);

    // Write text to file
    fs.writeFileSync(filePath, text);
    this.logger.debug(`Saved MarkerSection ${sectionId} to ${filePath}`);
  }
  
  /**
   * Generate concise file name for MarkerSection
   */
  private generateConciseFileName(section: any, includeTrialPrefix: boolean = true): string {
    let name = section.name || 'unnamed';

    // Apply abbreviations
    name = name
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

    // Only add trial short name if requested (for backward compatibility)
    if (includeTrialPrefix && section.trial?.shortName) {
      name = `${section.trial.shortName}_${name}`;
    }

    return name;
  }

  /**
   * Generate alternate truncated summary with excerpts from beginning and end
   */
  private generateAlternateTruncatedSummary(fullText: string, maxLength: number, section?: any): string | null {
    if (fullText.length <= maxLength) {
      return null; // No need to truncate
    }

    // Calculate statistics
    const lines = fullText.split('\n').filter(l => l.trim());
    const wordCount = fullText.split(/\s+/).filter(w => w.trim()).length;
    const charCount = fullText.length;
    const speakers = new Set<string>();

    // Extract speaker information
    lines.forEach(line => {
      const match = line.match(/^([A-Z][A-Z .]+?):\s/);
      if (match) {
        speakers.add(match[1]);
      }
    });

    // Count events if section provided
    let eventCount = 0;
    if (section && section.startEventId && section.endEventId) {
      eventCount = section.endEventId - section.startEventId + 1;
    }

    // Create summary statistics string
    const summaryStats = `\n\n[Abridged2: Summary: ${eventCount} events, ${lines.length} lines, ${wordCount} words, ${speakers.size} speakers, ${charCount} characters]`;
    const summaryStatsLength = summaryStats.length;

    const ellipsis = '\n\n[... middle section omitted ...]\n\n';
    const ellipsisLength = ellipsis.length;
    const availableLength = maxLength - ellipsisLength - summaryStatsLength;
    const halfLength = Math.floor(availableLength / 2);

    // Get beginning and end portions
    const beginning = fullText.substring(0, halfLength);
    const end = fullText.substring(fullText.length - halfLength);

    return beginning + ellipsis + end + summaryStats;
  }

  /**
   * Truncate text to specified length
   */
  private truncateToLength(text: string, maxLength: number): string {
    if (text.length <= maxLength) {
      return text;
    }
    return text.substring(0, maxLength) + '\n\n[... truncated ...]';
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