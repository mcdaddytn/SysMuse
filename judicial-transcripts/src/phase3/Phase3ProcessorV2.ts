import { PrismaClient } from '@prisma/client';
import { Logger } from '../utils/logger';
import { AccumulatorEngineV2 } from './AccumulatorEngineV2';
import { WitnessMarkerDiscovery } from './WitnessMarkerDiscovery';
import { ActivityMarkerDiscovery } from './ActivityMarkerDiscovery';
import { StandardTrialHierarchyBuilder } from './StandardTrialHierarchyBuilder';
import { TranscriptConfig } from '../types/config.types';

export class Phase3ProcessorV2 {
  private logger = new Logger('Phase3ProcessorV2');
  private accumulatorEngine: AccumulatorEngineV2;
  private witnessMarkerDiscovery: WitnessMarkerDiscovery;
  private activityMarkerDiscovery: ActivityMarkerDiscovery;
  private hierarchyBuilder: StandardTrialHierarchyBuilder;

  constructor(
    private prisma: PrismaClient,
    private config: TranscriptConfig
  ) {
    this.accumulatorEngine = new AccumulatorEngineV2(prisma, config);
    this.witnessMarkerDiscovery = new WitnessMarkerDiscovery(prisma);
    this.activityMarkerDiscovery = new ActivityMarkerDiscovery(prisma);
    this.hierarchyBuilder = new StandardTrialHierarchyBuilder(prisma);
  }

  /**
   * Main entry point for Phase 3 processing
   */
  async process(trialId: number): Promise<void> {
    this.logger.info(`Starting Phase 3 processing for trial ${trialId}`);
    this.logger.info(`Using ${this.config.enableElasticSearch ? 'ElasticSearch' : 'in-memory'} search strategy`);

    try {
      // Update processing status
      await this.prisma.trialProcessingStatus.upsert({
        where: { trialId },
        update: { phase3StartedAt: new Date() },
        create: { trialId, phase3StartedAt: new Date() }
      });

      // Initialize accumulator engine
      await this.accumulatorEngine.initialize();

      // Step 1: Evaluate accumulators (now includes search)
      this.logger.info('Step 1: Evaluating accumulators with integrated search');
      await this.accumulatorEngine.evaluateTrialAccumulators(trialId);

      // Step 2: Discover witness markers
      this.logger.info('Step 2: Discovering witness markers');
      await this.witnessMarkerDiscovery.discoverWitnessMarkers(trialId);

      // Step 3: Discover activity markers using accumulator results
      this.logger.info('Step 3: Discovering activity markers');
      await this.activityMarkerDiscovery.discoverActivityMarkers(trialId);

      // Step 4: Build Standard Trial Hierarchy
      this.logger.info('Step 4: Building Standard Trial Hierarchy');
      await this.hierarchyBuilder.buildStandardHierarchy(trialId);

      // Update completion status
      await this.prisma.trialProcessingStatus.update({
        where: { trialId },
        data: { phase3CompletedAt: new Date() }
      });

      this.logger.info(`Completed Phase 3 processing for trial ${trialId}`);

    } catch (error) {
      this.logger.error(`Error in Phase 3 processing for trial ${trialId}:`, error);
      
      // Log error (remove database update for now)
      this.logger.error(`Phase 3 error details:`, error);

      throw error;
    }
  }

  /**
   * Process all trials
   */
  async processAllTrials(): Promise<void> {
    const trials = await this.prisma.trial.findMany({
      orderBy: { id: 'asc' }
    });

    this.logger.info(`Processing ${trials.length} active trials`);

    for (const trial of trials) {
      try {
        await this.process(trial.id);
      } catch (error) {
        this.logger.error(`Failed to process trial ${trial.id} (${trial.name}):`, error);
        // Continue with next trial
      }
    }
  }

  /**
   * Reprocess a specific trial
   */
  async reprocessTrial(trialId: number): Promise<void> {
    this.logger.info(`Reprocessing trial ${trialId}`);

    // Clear existing results
    await this.clearTrialResults(trialId);

    // Process again
    await this.process(trialId);
  }

  /**
   * Clean up trial markers (public method for CLI)
   */
  async cleanupTrialMarkers(trialId: number): Promise<void> {
    await this.clearTrialResults(trialId);
  }

  /**
   * Clear existing Phase 3 results for a trial
   */
  private async clearTrialResults(trialId: number): Promise<void> {
    this.logger.info(`Clearing existing Phase 3 results for trial ${trialId}`);

    // Clear accumulator results
    await this.prisma.accumulatorResult.deleteMany({
      where: { trialId }
    });

    // Clear markers
    await this.prisma.marker.deleteMany({
      where: { trialId }
    });
    
    // Clear marker sections
    await this.prisma.markerSection.deleteMany({
      where: { trialId }
    });

    // Reset processing status (use upsert in case it doesn't exist)
    await this.prisma.trialProcessingStatus.upsert({
      where: { trialId },
      create: {
        trialId,
        phase3StartedAt: null,
        phase3CompletedAt: null
      },
      update: {
        phase3StartedAt: null,
        phase3CompletedAt: null
      }
    });
  }
}