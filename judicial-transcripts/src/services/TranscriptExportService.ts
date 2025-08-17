// src/services/TranscriptExportService.ts
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import logger from '../utils/logger';
import { SynopsisGenerator } from './SynopsisGenerator';

export interface ExportConfig {
  trialId: number;
  outputPath: string;
  format: 'text' | 'markdown' | 'json';
  includeMetadata: boolean;
  includeTimestamps: boolean;
  includeLineNumbers: boolean;
  sections?: {
    includeOpeningArguments?: boolean;
    includeWitnessTestimony?: boolean;
    includeClosingArguments?: boolean;
    includeJudgeStatements?: boolean;
    includeObjections?: boolean;
  };
  renderMode: 'original' | 'placeholder' | 'synopsis';
  synopsisOptions?: {
    maxLength?: number;
    context?: string;
    model?: string;
  };
}

export class TranscriptExportService {
  private prisma: PrismaClient;
  private synopsisGenerator: SynopsisGenerator;
  
  constructor() {
    this.prisma = new PrismaClient();
    this.synopsisGenerator = new SynopsisGenerator();
  }
  
  async exportTranscript(config: ExportConfig): Promise<void> {
    logger.info(`Exporting transcript for trial ${config.trialId}`);
    
    try {
      // Get trial information
      const trial = await this.prisma.trial.findUnique({
        where: { id: config.trialId },
        include: {
          judge: true,
          sessions: {
            orderBy: [
              { sessionDate: 'asc' },
              { sessionType: 'asc' }
            ]
          },
          markers: {
            orderBy: { startTime: 'asc' }
          }
        }
      });
      
      if (!trial) {
        throw new Error(`Trial ${config.trialId} not found`);
      }
      
      // Filter markers based on section config
      const filteredMarkers = this.filterMarkersBySection(trial.markers, config.sections);
      
      // Generate transcript content
      let content: string;
      
      switch (config.format) {
        case 'markdown':
          content = await this.generateMarkdownTranscript(trial, filteredMarkers, config);
          break;
        case 'json':
          content = await this.generateJsonTranscript(trial, filteredMarkers, config);
          break;
        default:
          content = await this.generateTextTranscript(trial, filteredMarkers, config);
      }
      
      // Write to file
      this.writeOutput(content, config.outputPath);
      
      logger.info(`Transcript exported to ${config.outputPath}`);
    } catch (error) {
      logger.error('Error exporting transcript:', error);
      throw error;
    } finally {
      await this.prisma.$disconnect();
    }
  }
  
  private filterMarkersBySection(markers: any[], sections?: any): any[] {
    if (!sections) return markers;
    
    return markers.filter(marker => {
      switch (marker.markerType) {
        case 'OPENING_ARGUMENT':
          return sections.includeOpeningArguments !== false;
        case 'WITNESS_TESTIMONY':
          return sections.includeWitnessTestimony !== false;
        case 'CLOSING_ARGUMENT':
          return sections.includeClosingArguments !== false;
        case 'OBJECTION':
          return sections.includeObjections !== false;
        default:
          return true;
      }
    });
  }
  
  private async generateTextTranscript(
    trial: any,
    markers: any[],
    config: ExportConfig
  ): Promise<string> {
    const lines: string[] = [];
    
    // Add header
    lines.push('='.repeat(80));
    lines.push(`TRIAL TRANSCRIPT`);
    lines.push(`Case: ${trial.name}`);
    lines.push(`Case Number: ${trial.caseNumber}`);
    lines.push(`Court: ${trial.court}`);
    if (trial.judge) {
      lines.push(`Judge: ${trial.judge.honorific || ''} ${trial.judge.name}`);
    }
    lines.push('='.repeat(80));
    lines.push('');
    
    // Process each session
    for (const session of trial.sessions) {
      lines.push('');
      lines.push('-'.repeat(60));
      lines.push(`SESSION: ${session.sessionDate.toLocaleDateString()} - ${session.sessionType}`);
      lines.push('-'.repeat(60));
      lines.push('');
      
      // Get markers for this session
      const sessionMarkers = markers.filter(m => {
        const markerTime = new Date(m.startTime || '');
        const sessionDate = new Date(session.sessionDate);
        return markerTime.toDateString() === sessionDate.toDateString();
      });
      
      // Process each marker
      for (const marker of sessionMarkers) {
        // Add section header
        if (config.includeMetadata) {
          lines.push(`[${marker.name}]`);
          if (config.includeTimestamps && marker.startTime) {
            lines.push(`Time: ${marker.startTime} - ${marker.endTime || 'ongoing'}`);
          }
          lines.push('');
        }
        
        // Add content
        const text = await this.getMarkerText(marker, config);
        if (text) {
          lines.push(this.formatText(text, config));
          lines.push('');
        }
      }
    }
    
    return lines.join('\n');
  }
  
  private async generateMarkdownTranscript(
    trial: any,
    markers: any[],
    config: ExportConfig
  ): Promise<string> {
    const lines: string[] = [];
    
    // Add header
    lines.push(`# Trial Transcript`);
    lines.push('');
    lines.push(`## Case Information`);
    lines.push(`- **Case**: ${trial.name}`);
    lines.push(`- **Case Number**: ${trial.caseNumber}`);
    lines.push(`- **Court**: ${trial.court}`);
    if (trial.judge) {
      lines.push(`- **Judge**: ${trial.judge.honorific || ''} ${trial.judge.name}`);
    }
    lines.push('');
    
    // Process each session
    for (const session of trial.sessions) {
      lines.push(`## ${session.sessionDate.toLocaleDateString()} - ${session.sessionType} Session`);
      lines.push('');
      
      // Get markers for this session
      const sessionMarkers = markers.filter(m => {
        const markerTime = new Date(m.startTime || '');
        const sessionDate = new Date(session.sessionDate);
        return markerTime.toDateString() === sessionDate.toDateString();
      });
      
      // Process each marker
      for (const marker of sessionMarkers) {
        lines.push(`### ${marker.name}`);
        
        if (config.includeTimestamps && marker.startTime) {
          lines.push(`*${marker.startTime} - ${marker.endTime || 'ongoing'}*`);
        }
        lines.push('');
        
        const text = await this.getMarkerText(marker, config);
        if (text) {
          lines.push(this.formatText(text, config));
          lines.push('');
        }
      }
    }
    
    return lines.join('\n');
  }
  
  private async generateJsonTranscript(
    trial: any,
    markers: any[],
    config: ExportConfig
  ): Promise<string> {
    const transcript = {
      case: {
        name: trial.name,
        caseNumber: trial.caseNumber,
        court: trial.court,
        judge: trial.judge ? {
          name: trial.judge.name,
          title: trial.judge.title,
          honorific: trial.judge.honorific
        } : null
      },
      sessions: [] as any[]
    };
    
    // Process each session
    for (const session of trial.sessions) {
      const sessionData = {
        date: session.sessionDate,
        type: session.sessionType,
        sections: [] as any[]
      };
      
      // Get markers for this session
      const sessionMarkers = markers.filter(m => {
        const markerTime = new Date(m.startTime || '');
        const sessionDate = new Date(session.sessionDate);
        return markerTime.toDateString() === sessionDate.toDateString();
      });
      
      // Process each marker
      for (const marker of sessionMarkers) {
        const text = await this.getMarkerText(marker, config);
        
        sessionData.sections.push({
          name: marker.name,
          type: marker.markerType,
          startTime: config.includeTimestamps ? marker.startTime : undefined,
          endTime: config.includeTimestamps ? marker.endTime : undefined,
          text: text || ''
        });
      }
      
      transcript.sessions.push(sessionData);
    }
    
    return JSON.stringify(transcript, null, 2);
  }
  
  private async getMarkerText(marker: any, config: ExportConfig): Promise<string | null> {
    // Check if marker has pre-generated text
    if (marker.markerTexts && marker.markerTexts.length > 0) {
      return marker.markerTexts[0].text;
    }
    
    // If synopsis mode and no pre-generated synopsis, generate it
    if (config.renderMode === 'synopsis') {
      return await this.generateSynopsis(marker, config.synopsisOptions);
    }
    
    // If placeholder mode, return placeholder
    if (config.renderMode === 'placeholder') {
      return `[${marker.name}]`;
    }
    
    // Otherwise, get original text from events
    const events = await this.prisma.trialEvent.findMany({
      where: {
        trialId: marker.trialId,
        AND: [
          { startTime: { gte: marker.startTime || '' } },
          { startTime: { lte: marker.endTime || '' } }
        ]
      },
      orderBy: { startTime: 'asc' }
    });
    
    return events
      .map(e => e.text)
      .filter(t => t)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
  
  private async generateSynopsis(marker: any, options?: any): Promise<string> {
    const originalText = await this.getMarkerText(
      { ...marker, markerTexts: [] }, 
      { renderMode: 'original' } as any
    );
    
    if (!originalText) return `[${marker.name} - No content]`;
    
    return await this.synopsisGenerator.generate(
      originalText,
      marker.name,
      options
    );
  }
  
  private formatText(text: string, config: ExportConfig): string {
    let formatted = text;
    
    // Remove timestamps if not wanted
    if (!config.includeTimestamps) {
      formatted = formatted.replace(/\d{2}:\d{2}:\d{2}\s+/g, '');
    }
    
    // Remove line numbers if not wanted
    if (!config.includeLineNumbers) {
      formatted = formatted.replace(/^\s*\d+\s+/gm, '');
    }
    
    // Clean up spacing
    formatted = formatted.replace(/\s+/g, ' ').trim();
    
    // Add proper paragraph breaks
    formatted = formatted.replace(/([.!?])\s+([A-Z])/g, '$1\n\n$2');
    
    return formatted;
  }
  
  private writeOutput(content: string, outputPath: string): void {
    const dir = path.dirname(outputPath);
    
    // Create directory if it doesn't exist
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    fs.writeFileSync(outputPath, content, 'utf-8');
  }
}

