import { PrismaClient, AccumulatorResult, MarkerType } from '@prisma/client';
import { Logger } from '../utils/logger';

interface ActivityCluster {
  accumulatorResult: AccumulatorResult;
  startEvent: any;
  endEvent: any;
  activityType: string;
  confidence: string;
}

export class ActivityMarkerDiscovery {
  private logger = new Logger('ActivityMarkerDiscovery');

  constructor(private prisma: PrismaClient) {}

  /**
   * Discover activity markers based on accumulator results
   */
  async discoverActivityMarkers(trialId: number): Promise<void> {
    this.logger.info(`Discovering activity markers for trial ${trialId}`);

    // Load accumulator results with high confidence
    const accumulatorResults = await this.prisma.accumulatorResult.findMany({
      where: {
        trialId,
        OR: [
          { booleanResult: true },
          { confidenceLevel: { in: ['HIGH', 'MEDIUM'] } }
        ]
      },
      include: {
        accumulator: true,
        startEvent: true,
        endEvent: true
      }
    });

    if (accumulatorResults.length === 0) {
      this.logger.info('No significant accumulator results found');
      return;
    }

    // Group results by accumulator type
    const activityClusters = this.groupActivityClusters(accumulatorResults);

    // Create markers for each activity cluster
    for (const cluster of activityClusters) {
      await this.createActivityMarkers(cluster, trialId);
    }

    // Merge overlapping activity markers
    await this.mergeOverlappingActivities(trialId);

    this.logger.info(`Completed activity marker discovery for trial ${trialId}`);
  }

  /**
   * Group accumulator results into activity clusters
   */
  private groupActivityClusters(results: any[]): ActivityCluster[] {
    const clusters: ActivityCluster[] = [];

    for (const result of results) {
      const activityType = this.determineActivityType(result.accumulator.name);
      
      clusters.push({
        accumulatorResult: result,
        startEvent: result.startEvent,
        endEvent: result.endEvent,
        activityType,
        confidence: result.confidenceLevel || 'MEDIUM'
      });
    }

    return clusters;
  }

  /**
   * Determine activity type from accumulator name
   */
  private determineActivityType(accumulatorName: string): string {
    const typeMap: Record<string, string> = {
      'objection_sustained': 'OBJECTION_SUSTAINED',
      'objection_overruled': 'OBJECTION_OVERRULED',
      'sidebar_request': 'SIDEBAR',
      'judge_attorney_interaction': 'JUDICIAL_INTERACTION',
      'opposing_counsel_interaction': 'COUNSEL_INTERACTION',
      'witness_examination_transition': 'EXAMINATION_TRANSITION'
    };

    return typeMap[accumulatorName] || 'GENERAL_ACTIVITY';
  }

  /**
   * Create markers for an activity cluster
   */
  private async createActivityMarkers(
    cluster: ActivityCluster,
    trialId: number
  ): Promise<void> {
    const startEventId = cluster.startEvent.id;
    const endEventId = cluster.endEvent.id;
    const activityType = cluster.activityType;

    // Create start marker
    const startMarker = await this.prisma.marker.create({
      data: {
        trialId,
        markerType: 'ACTIVITY_START',
        eventId: startEventId,
        name: `Activity_${activityType}_${startEventId}_Start`,
        description: `Start of ${activityType} activity`,
        metadata: {
          activityType,
          confidence: cluster.confidence,
          accumulatorId: cluster.accumulatorResult.accumulatorId,
          accumulatorName: cluster.activityType
        }
      }
    });

    // Create end marker
    const endMarker = await this.prisma.marker.create({
      data: {
        trialId,
        markerType: 'ACTIVITY_END',
        eventId: endEventId,
        name: `Activity_${activityType}_${endEventId}_End`,
        description: `End of ${activityType} activity`,
        metadata: {
          activityType,
          confidence: cluster.confidence,
          accumulatorId: cluster.accumulatorResult.accumulatorId,
          accumulatorName: cluster.activityType
        }
      }
    });

    // Create marker section
    await this.prisma.markerSection.create({
      data: {
        trialId,
        markerSectionType: 'ACTIVITY',
        startMarkerId: startMarker.id,
        endMarkerId: endMarker.id,
        startEventId,
        endEventId,
        startTime: cluster.startEvent.startTime,
        endTime: cluster.endEvent.endTime,
        name: `Activity_${activityType}_${startEventId}`,
        description: `${activityType} activity`,
        metadata: {
          activityType,
          confidence: cluster.confidence,
          score: cluster.accumulatorResult.floatResult,
          accumulatorMetadata: cluster.accumulatorResult.metadata
        }
      }
    });
  }

  /**
   * Merge overlapping activity markers of the same type
   */
  private async mergeOverlappingActivities(trialId: number): Promise<void> {
    const activitySections = await this.prisma.markerSection.findMany({
      where: {
        trialId,
        markerSectionType: 'ACTIVITY'
      },
      include: {
        startEvent: true,
        endEvent: true
      },
      orderBy: {
        startTime: 'asc'
      }
    });

    // Group by activity type
    const typeGroups = new Map<string, typeof activitySections>();
    for (const section of activitySections) {
      const activityType = (section.metadata as any)?.activityType || 'GENERAL';
      if (!typeGroups.has(activityType)) {
        typeGroups.set(activityType, []);
      }
      typeGroups.get(activityType)!.push(section);
    }

    // Check for overlaps within each type
    for (const [activityType, sections] of typeGroups) {
      for (let i = 0; i < sections.length - 1; i++) {
        const current = sections[i];
        const next = sections[i + 1];

        // Check if sections overlap or are adjacent
        if (this.sectionsOverlap(current, next)) {
          await this.mergeSections(current, next, activityType);
        }
      }
    }
  }

  /**
   * Check if two sections overlap
   */
  private sectionsOverlap(section1: any, section2: any): boolean {
    if (!section1.endTime || !section2.startTime) return false;
    
    // Simple string comparison for timestamps
    return section1.endTime >= section2.startTime;
  }

  /**
   * Merge two overlapping sections
   */
  private async mergeSections(
    section1: any,
    section2: any,
    activityType: string
  ): Promise<void> {
    this.logger.info(`Merging overlapping ${activityType} sections`);

    // Update the first section to extend to the end of the second
    await this.prisma.markerSection.update({
      where: { id: section1.id },
      data: {
        endMarkerId: section2.endMarkerId,
        endEventId: section2.endEventId,
        endTime: section2.endTime,
        metadata: {
          ...(section1.metadata as any),
          merged: true,
          originalEndEventId: section1.endEventId,
          mergedWithSectionId: section2.id
        }
      }
    });

    // Delete the second section
    await this.prisma.markerSection.delete({
      where: { id: section2.id }
    });

    // Clean up orphaned markers
    await this.cleanupOrphanedMarkers(section2.startMarkerId);
  }

  /**
   * Clean up markers that are no longer referenced by sections
   */
  private async cleanupOrphanedMarkers(markerId: number | null): Promise<void> {
    if (!markerId) return;

    const sectionsUsingMarker = await this.prisma.markerSection.count({
      where: {
        OR: [
          { startMarkerId: markerId },
          { endMarkerId: markerId }
        ]
      }
    });

    if (sectionsUsingMarker === 0) {
      await this.prisma.marker.delete({
        where: { id: markerId }
      });
    }
  }
}