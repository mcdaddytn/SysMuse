// src/parsers/phase3/Phase3Processor.ts
// src/parsers/Phase3Processor.ts
import { PrismaClient } from '@prisma/client';
import { TranscriptConfig } from '../../types/config.types';
import { ElasticSearchService } from '../../services/ElasticSearchService';
import logger from '../../utils/logger';

export class Phase3Processor {
  private prisma: PrismaClient;
  private config: TranscriptConfig;
  private elasticSearch: ElasticSearchService;
  
  constructor(config: TranscriptConfig) {
    this.prisma = new PrismaClient();
    this.config = config;
    this.elasticSearch = new ElasticSearchService(config.elasticsearchOptions);
  }
  
  async process(): Promise<void> {
    logger.info('Starting Phase 3: Creating section groups and markers');
    
    try {
      // Get all trials
      const trials = await this.prisma.trial.findMany({
        include: {
          sessions: {
            orderBy: [
              { sessionDate: 'asc' },
              { sessionType: 'asc' }
            ]
          },
          trialEvents: {
            orderBy: { startTime: 'asc' }
          }
        }
      });
      
      for (const trial of trials) {
        logger.info(`Processing markers for trial: ${trial.caseNumber}`);
        
        // Create trial-level markers
        await this.createTrialMarkers(trial);
        
        // Create session markers
        await this.createSessionMarkers(trial);
        
        // Create parsed markers from court directives
        await this.createParsedMarkers(trial);
        
        // Create ElasticSearch markers (objections, etc.)
        await this.createElasticSearchMarkers(trial);
        
        // Generate marker text
        await this.generateMarkerText(trial);
      }
      
      logger.info('Phase 3 processing completed');
    } catch (error) {
      logger.error('Error during Phase 3 processing:', error);
      throw error;
    } finally {
      await this.prisma.$disconnect();
    }
  }
  
  private async createTrialMarkers(trial: any): Promise<void> {
    // Create trial start marker
    const firstEvent = trial.trialEvents[0];
    const lastEvent = trial.trialEvents[trial.trialEvents.length - 1];
    
    if (firstEvent && lastEvent) {
      await this.prisma.marker.create({
        data: {
          trialId: trial.id,
          markerType: 'TRIAL_START',
          markerCategory: 'PARSED',
          startEventId: firstEvent.id,
          startTime: firstEvent.startTime,
          name: 'Trial Start',
          isResolved: true
        }
      });
      
      await this.prisma.marker.create({
        data: {
          trialId: trial.id,
          markerType: 'TRIAL_END',
          markerCategory: 'PARSED',
          endEventId: lastEvent.id,
          endTime: lastEvent.endTime,
          name: 'Trial End',
          isResolved: true
        }
      });
    }
  }
  
  private async createSessionMarkers(trial: any): Promise<void> {
    for (const session of trial.sessions) {
      // Get first and last events for this session
      const sessionEvents = await this.prisma.trialEvent.findMany({
        where: { sessionId: session.id },
        orderBy: { startTime: 'asc' }
      });
      
      if (sessionEvents.length === 0) continue;
      
      const firstEvent = sessionEvents[0];
      const lastEvent = sessionEvents[sessionEvents.length - 1];
      
      // Create session start marker
      await this.prisma.marker.create({
        data: {
          trialId: trial.id,
          markerType: 'SESSION_START',
          markerCategory: 'PARSED',
          startEventId: firstEvent.id,
          startTime: firstEvent.startTime,
          name: `${session.sessionType} Session Start - ${session.sessionDate}`,
          isResolved: true
        }
      });
      
      // Create session end marker
      await this.prisma.marker.create({
        data: {
          trialId: trial.id,
          markerType: 'SESSION_END',
          markerCategory: 'PARSED',
          endEventId: lastEvent.id,
          endTime: lastEvent.endTime,
          name: `${session.sessionType} Session End - ${session.sessionDate}`,
          isResolved: true
        }
      });
    }
  }
  
  private async createParsedMarkers(trial: any): Promise<void> {
    // Get all court directive events
    const directiveEvents = await this.prisma.trialEvent.findMany({
      where: {
        trialId: trial.id,
        eventType: 'COURT_DIRECTIVE'
      },
      include: {
        courtDirective: {
          include: {
            directiveType: true
          }
        }
      },
      orderBy: { startTime: 'asc' }
    });
    
    // Track paired directives
    const openDirectives = new Map<string, any>();
    
    for (const event of directiveEvents) {
      const directive = event.courtDirective?.directiveType;
      if (!directive) continue;
      
      if (directive.isPaired) {
        if (directive.isStart) {
          // Store open directive
          openDirectives.set(directive.name, event);
        } else {
          // Find matching start directive
          const pairKey = this.findPairKey(openDirectives, directive.pairMateId);
          const startEvent = pairKey ? openDirectives.get(pairKey) : null;
          
          if (startEvent) {
            // Create paired marker
            await this.createPairedMarker(trial.id, startEvent, event, directive.name);
            openDirectives.delete(pairKey!);
          } else {
            logger.warn(`Unmatched end directive: ${directive.name}`);
          }
        }
      } else {
        // Create single marker for unpaired directive
        await this.createSingleMarker(trial.id, event, directive.name);
      }
    }
    
    // Log any unclosed directives
    for (const [name, event] of openDirectives) {
      logger.warn(`Unclosed directive: ${name} at ${event.startTime}`);
    }
    
    // Create witness testimony markers
    await this.createWitnessTestimonyMarkers(trial);
  }
  
  private findPairKey(openDirectives: Map<string, any>, pairMateId?: number): string | null {
    if (!pairMateId) return null;
    
    for (const [key, value] of openDirectives) {
      const directive = value.courtDirective?.directiveType;
      if (directive && directive.id === pairMateId) {
        return key;
      }
    }
    return null;
  }
  
  private async createPairedMarker(
    trialId: number,
    startEvent: any,
    endEvent: any,
    name: string
  ): Promise<void> {
    const markerType = this.getMarkerTypeFromDirective(name);
    
    await this.prisma.marker.create({
      data: {
        trialId,
        markerType,
        markerCategory: 'PARSED',
        startEventId: startEvent.id,
        endEventId: endEvent.id,
        startTime: startEvent.startTime,
        endTime: endEvent.endTime,
        name,
        isResolved: true
      }
    });
  }
  
  private async createSingleMarker(
    trialId: number,
    event: any,
    name: string
  ): Promise<void> {
    const markerType = this.getMarkerTypeFromDirective(name);
    
    await this.prisma.marker.create({
      data: {
        trialId,
        markerType,
        markerCategory: 'PARSED',
        startEventId: event.id,
        startTime: event.startTime,
        name,
        isResolved: true
      }
    });
  }
  
  private getMarkerTypeFromDirective(name: string): any {
    if (name.match(/recess/i)) return 'RECESS';
    if (name.match(/sealed/i)) return 'SEALED_PORTION';
    if (name.match(/video|clip/i)) return 'VIDEO_PLAYBACK';
    if (name.match(/sidebar/i)) return 'SIDEBAR';
    return 'OTHER';
  }
  
  private async createWitnessTestimonyMarkers(trial: any): Promise<void> {
    // Get witness called events
    const witnessEvents = await this.prisma.trialEvent.findMany({
      where: {
        trialId: trial.id,
        eventType: 'WITNESS_CALLED'
      },
      include: {
        witnessCalled: {
          include: {
            witness: true
          }
        }
      },
      orderBy: { startTime: 'asc' }
    });
    
    for (let i = 0; i < witnessEvents.length; i++) {
      const startEvent = witnessEvents[i];
      const endEvent = witnessEvents[i + 1] || null;
      
      const witness = startEvent.witnessCalled?.witness;
      const examType = startEvent.witnessCalled?.examinationType;
      
      if (witness) {
        await this.prisma.marker.create({
          data: {
            trialId: trial.id,
            markerType: 'WITNESS_TESTIMONY',
            markerCategory: 'PARSED',
            startEventId: startEvent.id,
            endEventId: endEvent?.id,
            startTime: startEvent.startTime,
            endTime: endEvent?.startTime,
            name: `${witness.name} - ${examType}`,
            isResolved: !!endEvent
          }
        });
      }
    }
  }
  
  private async createElasticSearchMarkers(trial: any): Promise<void> {
    // Get search patterns for objections
    const objectionPatterns = await this.prisma.searchPattern.findMany({
      where: {
        category: 'objection',
        isActive: true
      }
    });
    
    // Search for objection starts and ends in trial events
    const events = await this.prisma.trialEvent.findMany({
      where: {
        trialId: trial.id,
        eventType: 'STATEMENT'
      },
      orderBy: { startTime: 'asc' }
    });
    
    const objectionStarts: any[] = [];
    const objectionEnds: any[] = [];
    
    for (const event of events) {
      if (!event.text) continue;
      
      // Check for objection patterns
      for (const pattern of objectionPatterns) {
        const regex = new RegExp(pattern.pattern, 'i');
        if (regex.test(event.text)) {
          if (pattern.patternType === 'objection_start') {
            objectionStarts.push(event);
          } else if (pattern.patternType === 'objection_end') {
            objectionEnds.push({
              event,
              result: (pattern.metadata as any)?.result
            });
          }
        }
      }
    }
    
    // Match objection starts with ends
    for (const start of objectionStarts) {
      // Find next objection end after this start
      const end = objectionEnds.find(e => 
        e.event.startTime > start.startTime
      );
      
      if (end) {
        await this.prisma.marker.create({
          data: {
            trialId: trial.id,
            markerType: 'OBJECTION',
            markerCategory: 'ELASTIC_SEARCH',
            startEventId: start.id,
            endEventId: end.event.id,
            startTime: start.startTime,
            endTime: end.event.startTime,
            name: `Objection - ${end.result || 'Resolved'}`,
            description: end.result,
            isResolved: true
          }
        });
        
        // Remove from ends array to avoid duplicate matching
        const index = objectionEnds.indexOf(end);
        objectionEnds.splice(index, 1);
      } else {
        // Unresolved objection
        await this.prisma.marker.create({
          data: {
            trialId: trial.id,
            markerType: 'OBJECTION',
            markerCategory: 'ELASTIC_SEARCH',
            startEventId: start.id,
            startTime: start.startTime,
            name: 'Objection - Unresolved',
            isResolved: false
          }
        });
      }
    }
  }
  
  private async generateMarkerText(trial: any): Promise<void> {
    // Get all resolved markers with both start and end
    const markers = await this.prisma.marker.findMany({
      where: {
        trialId: trial.id,
        isResolved: true,
        startEventId: { not: null },
        endEventId: { not: null }
      }
    });
    
    for (const marker of markers) {
      // Get all events between start and end
      const events = await this.prisma.trialEvent.findMany({
        where: {
          trialId: trial.id,
          AND: [
            { startTime: { gte: marker.startTime || '' } },
            { startTime: { lte: marker.endTime || '' } }
          ]
        },
        orderBy: { startTime: 'asc' }
      });
      
      // Combine text from all events
      const fullText = events
        .map(e => e.text)
        .filter(t => t)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      
      if (fullText) {
        // Create original text record
        const markerText = await this.prisma.markerText.create({
          data: {
            markerId: marker.id,
            textRenderMode: 'ORIGINAL',
            text: fullText
          }
        });
        
        // Index in ElasticSearch
        await this.elasticSearch.indexMarkerText(
          markerText.id.toString(),
          marker,
          fullText
        );
        
        // Create placeholder text
        await this.prisma.markerText.create({
          data: {
            markerId: marker.id,
            textRenderMode: 'PLACEHOLDER',
            text: `[${marker.name}]`
          }
        });
      }
    }
  }
}
