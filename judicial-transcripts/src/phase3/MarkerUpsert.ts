import { PrismaClient, MarkerType, MarkerSectionType } from '@prisma/client';
import { Logger } from '../utils/logger';
import fs from 'fs';

interface MarkerJson {
  name: string;
  markerType: MarkerType;
  eventReference?: {
    id?: number;
    startTime?: string;
    eventType?: string;
    speakerHandle?: string;
    text?: string;
  };
  description?: string;
  metadata?: any;
}

interface MarkerSectionJson {
  name: string;
  sectionType: MarkerSectionType;
  startMarker?: string; // Name reference to marker
  endMarker?: string;   // Name reference to marker
  startEventReference?: any;
  endEventReference?: any;
  description?: string;
  metadata?: any;
}

export class MarkerUpsert {
  private logger = new Logger('MarkerUpsert');

  constructor(private prisma: PrismaClient) {}

  /**
   * Upsert markers from JSON file
   */
  async upsertMarkersFromFile(filePath: string, trialId: number): Promise<void> {
    this.logger.info(`Upserting markers from file: ${filePath}`);

    const jsonContent = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(jsonContent);

    if (data.markers) {
      await this.upsertMarkers(data.markers, trialId);
    }

    if (data.markerSections) {
      await this.upsertMarkerSections(data.markerSections, trialId);
    }

    this.logger.info('Completed marker upsert');
  }

  /**
   * Upsert individual markers
   */
  async upsertMarkers(markers: MarkerJson[], trialId: number): Promise<void> {
    for (const markerData of markers) {
      try {
        // Find the event based on reference
        const eventId = await this.findEventId(markerData.eventReference, trialId);
        
        if (!eventId) {
          this.logger.warn(`Could not find event for marker: ${markerData.name}`);
          continue;
        }

        // Upsert the marker
        await this.prisma.marker.upsert({
          where: {
            id: -1 // This will never match, forcing create or update by unique constraint
          },
          create: {
            trialId,
            markerType: markerData.markerType,
            eventId,
            name: markerData.name,
            description: markerData.description,
            metadata: markerData.metadata
          },
          update: {
            markerType: markerData.markerType,
            eventId,
            description: markerData.description,
            metadata: markerData.metadata
          }
        });

        this.logger.info(`Upserted marker: ${markerData.name}`);
      } catch (error) {
        this.logger.error(`Error upserting marker ${markerData.name}: ${error}`);
      }
    }
  }

  /**
   * Upsert marker sections
   */
  async upsertMarkerSections(sections: MarkerSectionJson[], trialId: number): Promise<void> {
    for (const sectionData of sections) {
      try {
        // Find start and end markers by name
        let startMarkerId: number | null = null;
        let endMarkerId: number | null = null;

        if (sectionData.startMarker) {
          const startMarker = await this.prisma.marker.findFirst({
            where: {
              trialId,
              name: sectionData.startMarker
            }
          });
          startMarkerId = startMarker?.id || null;
        }

        if (sectionData.endMarker) {
          const endMarker = await this.prisma.marker.findFirst({
            where: {
              trialId,
              name: sectionData.endMarker
            }
          });
          endMarkerId = endMarker?.id || null;
        }

        // Find start and end events
        const startEventId = await this.findEventId(sectionData.startEventReference, trialId);
        const endEventId = await this.findEventId(sectionData.endEventReference, trialId);

        // Get event times
        let startTime: string | null = null;
        let endTime: string | null = null;

        if (startEventId) {
          const startEvent = await this.prisma.trialEvent.findUnique({
            where: { id: startEventId }
          });
          startTime = startEvent?.startTime || null;
        }

        if (endEventId) {
          const endEvent = await this.prisma.trialEvent.findUnique({
            where: { id: endEventId }
          });
          endTime = endEvent?.endTime || null;
        }

        // Upsert the marker section
        await this.prisma.markerSection.upsert({
          where: {
            id: -1 // This will never match, forcing create or update
          },
          create: {
            trialId,
            markerSectionType: sectionData.sectionType,
            startMarkerId,
            endMarkerId,
            startEventId,
            endEventId,
            startTime,
            endTime,
            name: sectionData.name,
            description: sectionData.description,
            metadata: sectionData.metadata
          },
          update: {
            markerSectionType: sectionData.sectionType,
            startMarkerId,
            endMarkerId,
            startEventId,
            endEventId,
            startTime,
            endTime,
            description: sectionData.description,
            metadata: sectionData.metadata
          }
        });

        this.logger.info(`Upserted marker section: ${sectionData.name}`);
      } catch (error) {
        this.logger.error(`Error upserting section ${sectionData.name}: ${error}`);
      }
    }
  }

  /**
   * Find event ID based on reference criteria
   */
  private async findEventId(
    reference: any | undefined,
    trialId: number
  ): Promise<number | null> {
    if (!reference) return null;

    // If ID is provided directly, use it
    if (reference.id) {
      return reference.id;
    }

    // Build query based on available reference fields
    const where: any = { trialId };

    if (reference.startTime) {
      where.startTime = reference.startTime;
    }

    if (reference.eventType) {
      where.eventType = reference.eventType;
    }

    // If speaker handle is provided, need to join with statement
    if (reference.speakerHandle) {
      const event = await this.prisma.trialEvent.findFirst({
        where: {
          ...where,
          statement: {
            speaker: {
              speakerHandle: reference.speakerHandle
            }
          }
        }
      });
      return event?.id || null;
    }

    // If text is provided, search in statements
    if (reference.text) {
      const event = await this.prisma.trialEvent.findFirst({
        where: {
          ...where,
          statement: {
            text: {
              contains: reference.text
            }
          }
        }
      });
      return event?.id || null;
    }

    // Simple query without joins
    const event = await this.prisma.trialEvent.findFirst({ where });
    return event?.id || null;
  }

  /**
   * Export markers to JSON format
   */
  async exportMarkersToFile(trialId: number, filePath: string): Promise<void> {
    this.logger.info(`Exporting markers for trial ${trialId} to ${filePath}`);

    // Load markers
    const markers = await this.prisma.marker.findMany({
      where: { trialId },
      include: {
        event: {
          include: {
            statement: {
              include: {
                speaker: true
              }
            }
          }
        }
      }
    });

    // Load marker sections
    const markerSections = await this.prisma.markerSection.findMany({
      where: { trialId },
      include: {
        startMarker: true,
        endMarker: true,
        startEvent: true,
        endEvent: true
      }
    });

    // Format for export
    const exportData = {
      trialId,
      exportDate: new Date().toISOString(),
      markers: markers.map(m => ({
        name: m.name,
        markerType: m.markerType,
        eventReference: {
          id: m.eventId,
          startTime: m.event?.startTime,
          eventType: m.event?.eventType,
          speakerHandle: m.event?.statement?.speaker?.speakerHandle,
          text: m.event?.statement?.text?.substring(0, 100) // First 100 chars
        },
        description: m.description,
        metadata: m.metadata
      })),
      markerSections: markerSections.map(s => ({
        name: s.name,
        sectionType: s.markerSectionType,
        startMarker: s.startMarker?.name,
        endMarker: s.endMarker?.name,
        startEventReference: {
          id: s.startEventId,
          startTime: s.startTime
        },
        endEventReference: {
          id: s.endEventId,
          endTime: s.endTime
        },
        description: s.description,
        metadata: s.metadata
      }))
    };

    // Write to file
    fs.writeFileSync(filePath, JSON.stringify(exportData, null, 2), 'utf-8');
    
    this.logger.info(`Exported ${markers.length} markers and ${markerSections.length} sections`);
  }
}