import { PrismaClient } from '@prisma/client';
import { Logger } from '../utils/logger';
import { AccumulatorEngine } from './AccumulatorEngine';
import { WitnessMarkerDiscovery } from './WitnessMarkerDiscovery';
import { ActivityMarkerDiscovery } from './ActivityMarkerDiscovery';
import { ElasticsearchLifecycleService } from '../services/ElasticsearchLifecycleService';
import { indexTrialMarkerSections, cleanupTrialElasticsearch } from '../scripts/syncElasticsearchLifecycle';

export class Phase3Processor {
  private logger = new Logger('Phase3Processor');
  private accumulatorEngine: AccumulatorEngine;
  private witnessMarkerDiscovery: WitnessMarkerDiscovery;
  private activityMarkerDiscovery: ActivityMarkerDiscovery;

  constructor(private prisma: PrismaClient) {
    this.accumulatorEngine = new AccumulatorEngine(prisma);
    this.witnessMarkerDiscovery = new WitnessMarkerDiscovery(prisma);
    this.activityMarkerDiscovery = new ActivityMarkerDiscovery(prisma);
  }

  /**
   * Main entry point for Phase 3 processing
   */
  async process(trialId: number, options?: { cleanupAfter?: boolean; preserveMarkers?: boolean }): Promise<void> {
    this.logger.info(`Starting Phase 3 processing for trial ${trialId}`);

    try {
      // Update processing status
      await this.prisma.trialProcessingStatus.upsert({
        where: { trialId },
        update: { phase3StartedAt: new Date() },
        create: { trialId, phase3StartedAt: new Date() }
      });

      // Step 1: Evaluate ElasticSearch expressions
      this.logger.info('Step 1: Evaluating ElasticSearch expressions');
      await this.accumulatorEngine.evaluateESExpressions(trialId);

      // Step 2: Evaluate accumulators
      this.logger.info('Step 2: Evaluating accumulators');
      await this.accumulatorEngine.evaluateTrialAccumulators(trialId);

      // Step 3: Discover witness markers
      this.logger.info('Step 3: Discovering witness markers');
      await this.witnessMarkerDiscovery.discoverWitnessMarkers(trialId);

      // Step 4: Discover activity markers using accumulator results
      this.logger.info('Step 4: Discovering activity markers');
      await this.activityMarkerDiscovery.discoverActivityMarkers(trialId);

      // Step 5: Generate summary statistics
      const stats = await this.generateSummaryStatistics(trialId);

      // Step 6: Index marker sections to permanent Elasticsearch index
      if (options?.preserveMarkers !== false) {
        this.logger.info('Step 6: Indexing marker sections to permanent Elasticsearch');
        await indexTrialMarkerSections(trialId);
      }

      // Step 7: Clean up Phase 2 Elasticsearch data if requested
      if (options?.cleanupAfter) {
        this.logger.info('Step 7: Cleaning up Phase 2 Elasticsearch data');
        await cleanupTrialElasticsearch(trialId);
      }

      // Update processing status
      await this.prisma.trialProcessingStatus.update({
        where: { trialId },
        data: {
          phase3CompletedAt: new Date(),
          phase3MarkerCount: stats.markers,
          phase3SectionCount: stats.markerSections
        }
      });

      this.logger.info(`Completed Phase 3 processing for trial ${trialId}`);
    } catch (error) {
      this.logger.error(`Error in Phase 3 processing: ${error}`);
      throw error;
    }
  }

  /**
   * Process all trials in the database
   */
  async processAllTrials(): Promise<void> {
    const trials = await this.prisma.trial.findMany({
      select: { id: true, name: true, caseNumber: true }
    });

    this.logger.info(`Processing ${trials.length} trials`);

    for (const trial of trials) {
      this.logger.info(`Processing trial: ${trial.name} (${trial.caseNumber})`);
      await this.process(trial.id);
    }

    this.logger.info('Completed Phase 3 processing for all trials');
  }

  /**
   * Generate summary statistics for markers
   */
  private async generateSummaryStatistics(trialId: number): Promise<{ markers: number; markerSections: number; accumulatorResults: number }> {
    const markers = await this.prisma.marker.count({
      where: { trialId }
    });

    const markerSections = await this.prisma.markerSection.count({
      where: { trialId }
    });

    const accumulatorResults = await this.prisma.accumulatorResult.count({
      where: { trialId }
    });

    this.logger.info(`Phase 3 Summary for trial ${trialId}:`);
    this.logger.info(`  - Markers created: ${markers}`);
    this.logger.info(`  - Marker sections created: ${markerSections}`);
    this.logger.info(`  - Accumulator results: ${accumulatorResults}`);

    return { markers, markerSections, accumulatorResults };
  }

  /**
   * Clean up existing markers for a trial (useful for re-running)
   */
  async cleanupTrialMarkers(trialId: number): Promise<void> {
    this.logger.info(`Cleaning up existing markers for trial ${trialId}`);

    // Delete marker sections first (due to foreign keys)
    await this.prisma.markerSection.deleteMany({
      where: { trialId }
    });

    // Delete markers
    await this.prisma.marker.deleteMany({
      where: { trialId }
    });

    // Delete accumulator results
    await this.prisma.accumulatorResult.deleteMany({
      where: { trialId }
    });

    // Delete ES results
    await this.prisma.elasticSearchResult.deleteMany({
      where: { trialId }
    });

    this.logger.info('Cleanup completed');
  }
}