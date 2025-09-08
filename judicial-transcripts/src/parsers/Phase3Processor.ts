// src/parsers/phase3/Phase3Processor.ts
// src/parsers/Phase3Processor.ts
import { PrismaClient } from '@prisma/client';
//import { TranscriptConfig } from '../../types/config.types';
//import { ElasticSearchService } from '../../services/ElasticSearchService';
//import logger from '../../utils/logger';
import { TranscriptConfig } from '../types/config.types';
import { ElasticSearchService } from '../services/ElasticSearchService';
import logger from '../utils/logger';

export class Phase3Processor {
  private prisma: PrismaClient;
  private config: TranscriptConfig;
  private elasticSearch: ElasticSearchService;
  
  constructor(config: TranscriptConfig) {
    this.prisma = new PrismaClient();
    this.config = config;
    this.elasticSearch = new ElasticSearchService({
      url: process.env.ELASTICSEARCH_URL || 'http://localhost:9200',
      index: 'judicial_statements'
    });
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
        // COMMENTED OUT: createTrialMarkers method needs enum values that don't exist
        // await this.createTrialMarkers(trial);
        
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
  
  // COMMENTED OUT: Method uses MarkerType enum values that no longer exist
  /*
  private async createTrialMarkers(trial: any): Promise<void> {
    // Create trial start marker
    const firstEvent = trial.trialEvents[0];
    const lastEvent = trial.trialEvents[trial.trialEvents.length - 1];
    
    if (firstEvent && lastEvent) {
      await this.prisma.marker.create({
        data: {
          trialId: trial.id,
          markerType: 'OPENING_STATEMENT', // This enum value doesn't exist
          markerCategory: 'PROCEDURAL',
          startEventId: firstEvent.id,
          startTime: firstEvent.startTime,
          name: 'Trial Start'
        }
      });
      
      await this.prisma.marker.create({
        data: {
          trialId: trial.id,
          markerType: 'CLOSING_ARGUMENT', // This enum value doesn't exist
          markerCategory: 'PROCEDURAL',
          endEventId: lastEvent.id,
          endTime: lastEvent.endTime,
          name: 'Trial End'
        }
      });
    }
  }
  */
  
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
          markerType: 'SECTION_START',
          sectionType: 'SESSION',
          eventId: firstEvent.id,
          name: `${session.sessionType} Session Start - ${session.sessionDate}`,
          source: 'AUTO_EVENT'
        }
      });
      
      // Create session end marker
      await this.prisma.marker.create({
        data: {
          trialId: trial.id,
          markerType: 'SECTION_END',
          sectionType: 'SESSION',
          eventId: lastEvent.id,
          name: `${session.sessionType} Session End - ${session.sessionDate}`,
          source: 'AUTO_EVENT'
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
          //const pairKey = this.findPairKey(openDirectives, directive.pairMateId);
          //gm: workaround
          const pairKey = directive.pairMateId ? this.findPairKey(openDirectives, directive.pairMateId) : null;
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
    
    // For paired directives, create a MarkerSection instead of two Markers
    // First create start marker
    const startMarker = await this.prisma.marker.create({
      data: {
        trialId,
        markerType: 'SECTION_START',
        sectionType: 'ACTIVITY',
        eventId: startEvent.id,
        name: `${name} - Start`,
        source: 'AUTO_PATTERN'
      }
    });
    
    // Then create end marker
    const endMarker = await this.prisma.marker.create({
      data: {
        trialId,
        markerType: 'SECTION_END',
        sectionType: 'ACTIVITY',
        eventId: endEvent.id,
        name: `${name} - End`,
        source: 'AUTO_PATTERN'
      }
    });
    
    // Create a MarkerSection to link them
    await this.prisma.markerSection.create({
      data: {
        trialId,
        markerSectionType: 'ACTIVITY',
        startMarkerId: startMarker.id,
        endMarkerId: endMarker.id,
        startEventId: startEvent.id,
        endEventId: endEvent.id,
        startTime: startEvent.startTime,
        endTime: endEvent.endTime,
        name
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
        eventId: event.id, // Changed from startEventId
        name
      }
    });
  }
  
  private getMarkerTypeFromDirective(name: string): any {
    // Map directives to new MarkerType enum values  
    // All directive-based markers are now SEARCH_LOCATOR or CUSTOM
    // They can be promoted to SECTION_START/END later if needed
    if (name.match(/start|begin|end|finish|conclude/i)) {
      return 'SEARCH_LOCATOR';
    }
    // Default to CUSTOM for unmatched types
    return 'CUSTOM';
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
        // Create start marker for witness testimony
        const startMarker = await this.prisma.marker.create({
          data: {
            trialId: trial.id,
            markerType: 'SECTION_START',
            sectionType: 'WITNESS_TESTIMONY',
            eventId: startEvent.id,
            name: `${witness.name} - ${examType} Start`,
            source: 'AUTO_EVENT'
          }
        });
        
        // If there's an end event, create end marker and section
        if (endEvent) {
          const endMarker = await this.prisma.marker.create({
            data: {
              trialId: trial.id,
              markerType: 'SECTION_END',
              sectionType: 'WITNESS_TESTIMONY',
              eventId: endEvent.id,
              name: `${witness.name} - ${examType} End`,
              source: 'AUTO_EVENT'
            }
          });
          
          // Create MarkerSection for complete witness testimony
          await this.prisma.markerSection.create({
            data: {
              trialId: trial.id,
              markerSectionType: 'WITNESS_TESTIMONY',
              startMarkerId: startMarker.id,
              endMarkerId: endMarker.id,
              startEventId: startEvent.id,
              endEventId: endEvent.id,
              startTime: startEvent.startTime,
              endTime: endEvent.startTime,
              name: `${witness.name} - ${examType}`
            }
          });
        }
      }
    }
  }
  
  private async createElasticSearchMarkers(trial: any): Promise<void> {
    // DISABLED: searchPattern table doesn't exist in current schema
    return;
    /*
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
            markerType: 'OBJECTION_SUSTAINED',
            markerCategory: 'EVIDENTIARY',
            startEventId: start.id,
            endEventId: end.event.id,
            startTime: start.startTime,
            endTime: end.event.startTime,
            name: `Objection - ${end.result || 'Resolved'}`,
            description: end.result
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
            markerType: 'OBJECTION_SUSTAINED',
            markerCategory: 'EVIDENTIARY',
            startEventId: start.id,
            startTime: start.startTime,
            name: 'Objection - Unresolved'
          }
        });
      }
    }
    */
  }
  
  private async generateMarkerText(trial: any): Promise<void> {
    // DISABLED: markerText table doesn't exist in current schema
    return;
    /*
    // Get all resolved markers with both start and end
    const markers = await this.prisma.marker.findMany({
      where: {
        trialId: trial.id,
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
    */
  }
}
