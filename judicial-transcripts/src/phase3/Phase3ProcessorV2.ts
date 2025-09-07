import { PrismaClient } from '@prisma/client';
import { Logger } from '../utils/logger';
import { AccumulatorEngineV2 } from './AccumulatorEngineV2';
import { WitnessMarkerDiscovery } from './WitnessMarkerDiscovery';
import { ActivityMarkerDiscovery } from './ActivityMarkerDiscovery';
import { TranscriptConfig } from '../types/config.types';

export class Phase3ProcessorV2 {
  private logger = new Logger('Phase3ProcessorV2');
  private accumulatorEngine: AccumulatorEngineV2;
  private witnessMarkerDiscovery: WitnessMarkerDiscovery;
  private activityMarkerDiscovery: ActivityMarkerDiscovery;

  constructor(
    private prisma: PrismaClient,
    private config: TranscriptConfig
  ) {
    this.accumulatorEngine = new AccumulatorEngineV2(prisma, config);
    this.witnessMarkerDiscovery = new WitnessMarkerDiscovery(prisma);
    this.activityMarkerDiscovery = new ActivityMarkerDiscovery(prisma);
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

      // Update completion status
      await this.prisma.trialProcessingStatus.update({
        where: { trialId },
        data: { phase3CompletedAt: new Date() }
      });

      this.logger.info(`Completed Phase 3 processing for trial ${trialId}`);

    } catch (error) {
      this.logger.error(`Error in Phase 3 processing for trial ${trialId}:`, error);
      
      // Update error status
      await this.prisma.trialProcessingStatus.update({
        where: { trialId },
        data: { 
          phase3Error: error instanceof Error ? error.message : String(error),
          phase3ErrorAt: new Date()
        }
      });

      throw error;
    }
  }

  /**
   * Process all trials
   */
  async processAllTrials(): Promise<void> {
    const trials = await this.prisma.trial.findMany({
      where: { isActive: true },
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
   * Clear existing Phase 3 results for a trial
   */
  private async clearTrialResults(trialId: number): Promise<void> {
    this.logger.info(`Clearing existing Phase 3 results for trial ${trialId}`);

    // Clear accumulator results
    await this.prisma.accumulatorResult.deleteMany({
      where: { trialId }
    });

    // Clear witness markers
    await this.prisma.witnessMarker.deleteMany({
      where: { trialId }
    });

    // Clear activity markers
    await this.prisma.activityMarker.deleteMany({
      where: { trialId }
    });

    // Reset processing status
    await this.prisma.trialProcessingStatus.update({
      where: { trialId },
      data: {
        phase3StartedAt: null,
        phase3CompletedAt: null,
        phase3Error: null,
        phase3ErrorAt: null
      }
    });
  }
}