import { PrismaClient, AccumulatorResult, MarkerSectionType, ConfidenceLevel } from '@prisma/client';
import { Logger } from '../utils/logger';

interface ActivityCluster {
  accumulatorResult: AccumulatorResult & {
    accumulator: any;
    startEvent: any;
    endEvent: any;
  };
  activityType: string;
  sectionType: MarkerSectionType;
  confidence: number;
}

export class ActivityMarkerDiscovery {
  private logger = new Logger('ActivityMarkerDiscovery');

  constructor(private prisma: PrismaClient) {}

  /**
   * Discover activity markers based on accumulator results
   * These create SEARCH_LOCATOR markers that indicate points of interest
   * They can later be promoted to SECTION_START/END markers if boundaries are found
   */
  async discoverActivityMarkers(trialId: number): Promise<void> {
    this.logger.info(`Discovering activity markers for trial ${trialId}`);

    // TEMPORARILY DISABLED - Activity markers creating too many non-standard sections
    // Will re-enable when we have better filtering for relevant activities
    this.logger.info('Activity marker discovery is currently disabled to focus on Standard Trial Sequence');
    return;

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

    // Group results by accumulator type and create appropriate markers
    const activityClusters = this.groupActivityClusters(accumulatorResults);

    // Create search locator markers for each activity cluster
    for (const cluster of activityClusters) {
      await this.createActivityLocatorMarkers(cluster, trialId);
    }

    // Create marker sections for continuous activity regions
    await this.createActivitySections(activityClusters, trialId);

    this.logger.info(`Completed activity marker discovery for trial ${trialId}`);
  }

  /**
   * Group accumulator results into activity clusters with appropriate section types
   */
  private groupActivityClusters(results: any[]): ActivityCluster[] {
    const clusters: ActivityCluster[] = [];

    for (const result of results) {
      const { activityType, sectionType } = this.determineActivityAndSectionType(result.accumulator.name);
      
      clusters.push({
        accumulatorResult: result,
        activityType,
        sectionType,
        confidence: this.confidenceLevelToNumber(result.confidenceLevel)
      });
    }

    return clusters;
  }

  /**
   * Determine activity type and corresponding MarkerSectionType from accumulator name
   */
  private determineActivityAndSectionType(accumulatorName: string): {
    activityType: string;
    sectionType: MarkerSectionType;
  } {
    const mappings: Record<string, { activityType: string; sectionType: MarkerSectionType }> = {
      'objection_sustained': {
        activityType: 'OBJECTION_SUSTAINED',
        sectionType: 'OBJECTION_SEQUENCE'
      },
      'objection_overruled': {
        activityType: 'OBJECTION_OVERRULED',
        sectionType: 'OBJECTION_SEQUENCE'
      },
      'sidebar_request': {
        activityType: 'SIDEBAR_REQUEST',
        sectionType: 'SIDEBAR'
      },
      'judge_attorney_interaction': {
        activityType: 'JUDICIAL_INTERACTION',
        sectionType: 'BENCH_CONFERENCE'
      },
      'opposing_counsel_interaction': {
        activityType: 'COUNSEL_INTERACTION',
        sectionType: 'CUSTOM'
      },
      'witness_examination_transition': {
        activityType: 'EXAMINATION_TRANSITION',
        sectionType: 'WITNESS_EXAMINATION'
      }
    };

    return mappings[accumulatorName] || {
      activityType: 'GENERAL_ACTIVITY',
      sectionType: 'CUSTOM'
    };
  }

  /**
   * Convert confidence level enum to numeric value
   */
  private confidenceLevelToNumber(level: ConfidenceLevel | null): number {
    switch (level) {
      case 'HIGH': return 0.9;
      case 'MEDIUM': return 0.7;
      case 'LOW': return 0.5;
      default: return 0.5;
    }
  }

  /**
   * Create SEARCH_LOCATOR markers for activity points of interest
   */
  private async createActivityLocatorMarkers(
    cluster: ActivityCluster,
    trialId: number
  ): Promise<void> {
    const { accumulatorResult, activityType, sectionType, confidence } = cluster;

    // Create a search locator at the start of the activity
    if (accumulatorResult.startEvent) {
      await this.prisma.marker.create({
        data: {
          trialId,
          markerType: 'SEARCH_LOCATOR',
          eventId: accumulatorResult.startEvent.id,
          name: `${activityType}_Locator_${accumulatorResult.startEvent.id}`,
          description: `${activityType} detected by ${accumulatorResult.accumulator.name}`,
          source: 'AUTO_PATTERN',
          confidence,
          metadata: {
            activityType,
            sectionType,
            accumulatorId: accumulatorResult.accumulatorId,
            accumulatorName: accumulatorResult.accumulator.name,
            score: accumulatorResult.floatResult,
            booleanResult: accumulatorResult.booleanResult,
            confidenceLevel: accumulatorResult.confidenceLevel
          }
        }
      });
    }

    // If there's a distinct end event, create another locator
    if (accumulatorResult.endEvent && 
        accumulatorResult.endEvent.id !== accumulatorResult.startEvent?.id) {
      await this.prisma.marker.create({
        data: {
          trialId,
          markerType: 'SEARCH_LOCATOR',
          eventId: accumulatorResult.endEvent.id,
          name: `${activityType}_End_Locator_${accumulatorResult.endEvent.id}`,
          description: `End of ${activityType} detected by ${accumulatorResult.accumulator.name}`,
          source: 'AUTO_PATTERN',
          confidence,
          metadata: {
            activityType,
            sectionType,
            accumulatorId: accumulatorResult.accumulatorId,
            accumulatorName: accumulatorResult.accumulator.name,
            isEndMarker: true
          }
        }
      });
    }
  }

  /**
   * Create marker sections for significant continuous activity regions
   * This creates sections for clusters that span multiple events
   */
  private async createActivitySections(
    clusters: ActivityCluster[],
    trialId: number
  ): Promise<void> {
    // Group clusters by section type
    const sectionGroups = new Map<MarkerSectionType, ActivityCluster[]>();
    
    for (const cluster of clusters) {
      if (!sectionGroups.has(cluster.sectionType)) {
        sectionGroups.set(cluster.sectionType, []);
      }
      sectionGroups.get(cluster.sectionType)!.push(cluster);
    }

    // Create sections for each group where appropriate
    for (const [sectionType, groupClusters] of sectionGroups) {
      // Skip custom sections or those without clear boundaries
      if (sectionType === 'CUSTOM') continue;

      // Sort by start event time
      const sortedClusters = groupClusters.sort((a, b) => {
        const aTime = a.accumulatorResult.startEvent?.startTime || '';
        const bTime = b.accumulatorResult.startEvent?.startTime || '';
        return aTime.localeCompare(bTime);
      });

      // Create sections for significant continuous regions
      for (const cluster of sortedClusters) {
        if (cluster.accumulatorResult.startEvent && cluster.accumulatorResult.endEvent) {
          await this.createSectionFromCluster(cluster, trialId);
        }
      }
    }
  }

  /**
   * Create a marker section from an activity cluster
   */
  private async createSectionFromCluster(
    cluster: ActivityCluster,
    trialId: number
  ): Promise<void> {
    const { accumulatorResult, activityType, sectionType, confidence } = cluster;

    // Only create sections for high-confidence results with clear boundaries
    if (confidence < 0.7) return;
    if (!accumulatorResult.startEvent || !accumulatorResult.endEvent) return;

    // Create the section without explicit start/end markers
    // The SEARCH_LOCATOR markers already indicate the points of interest
    await this.prisma.markerSection.create({
      data: {
        trialId,
        markerSectionType: sectionType,
        startEventId: accumulatorResult.startEvent.id,
        endEventId: accumulatorResult.endEvent.id,
        startTime: accumulatorResult.startEvent.startTime,
        endTime: accumulatorResult.endEvent.endTime,
        name: `${activityType}_Section_${accumulatorResult.id}`,
        description: `${activityType} activity region`,
        source: 'AUTO_PATTERN',
        confidence,
        metadata: {
          activityType,
          accumulatorId: accumulatorResult.accumulatorId,
          accumulatorName: accumulatorResult.accumulator.name,
          score: accumulatorResult.floatResult,
          booleanResult: accumulatorResult.booleanResult,
          confidenceLevel: accumulatorResult.confidenceLevel
        }
      }
    });
  }
}