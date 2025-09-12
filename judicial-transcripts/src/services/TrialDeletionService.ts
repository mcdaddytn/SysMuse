import { PrismaClient } from '@prisma/client';
import logger from '../utils/logger';

export class TrialDeletionService {
  private prisma: PrismaClient;

  constructor(prisma?: PrismaClient) {
    this.prisma = prisma || new PrismaClient();
  }

  /**
   * Delete a trial and all its associated data
   * @param identifier - Can be trial ID, case number, or short name
   * @param dryRun - If true, only show what would be deleted without actually deleting
   * @returns Deletion statistics
   */
  async deleteTrial(identifier: string | number, dryRun: boolean = false): Promise<DeletionResult> {
    try {
      // Find the trial
      const trial = await this.findTrial(identifier);
      
      if (!trial) {
        throw new Error(`Trial not found: ${identifier}`);
      }

      logger.info(`${dryRun ? '[DRY RUN] Would delete' : 'Deleting'} trial: ${trial.name} (ID: ${trial.id})`);

      // Get counts of related data before deletion
      const stats = await this.getTrialStatistics(trial.id);
      
      if (dryRun) {
        logger.info('[DRY RUN] Deletion statistics:', stats);
        return {
          success: true,
          dryRun: true,
          trial: {
            id: trial.id,
            name: trial.name,
            caseNumber: trial.caseNumber,
            shortName: trial.shortName
          },
          statistics: stats,
          message: 'Dry run completed. No data was deleted.'
        };
      }

      // Delete without transaction, in correct order for referential integrity
      // Each deletion is independent and can be retried if needed
      const deletionCounts: Record<string, number> = {};
      
      try {
        // Delete search and accumulator results first
        logger.info('Deleting search and accumulator results...');
        const elasticSearchResultsDeleted = await this.deleteWithRetry(
          () => this.prisma.elasticSearchResult.deleteMany({ where: { trialId: trial.id } }),
          'elasticSearchResult'
        );
        deletionCounts.elasticSearchResults = elasticSearchResultsDeleted.count;
        
        const accumulatorResultsDeleted = await this.deleteWithRetry(
          () => this.prisma.accumulatorResult.deleteMany({ where: { trialId: trial.id } }),
          'accumulatorResult'
        );
        deletionCounts.accumulatorResults = accumulatorResultsDeleted.count;
        
        // Delete event-specific types (they reference TrialEvent)
        logger.info('Deleting event-specific types...');
        const courtDirectiveEventsDeleted = await this.deleteWithRetry(
          () => this.prisma.courtDirectiveEvent.deleteMany({ where: { event: { trialId: trial.id } } }),
          'courtDirectiveEvent'
        );
        deletionCounts.courtDirectiveEvents = courtDirectiveEventsDeleted.count;
        
        const statementEventsDeleted = await this.deleteWithRetry(
          () => this.prisma.statementEvent.deleteMany({ where: { event: { trialId: trial.id } } }),
          'statementEvent'
        );
        deletionCounts.statementEvents = statementEventsDeleted.count;
        
        const witnessCalledEventsDeleted = await this.deleteWithRetry(
          () => this.prisma.witnessCalledEvent.deleteMany({ where: { event: { trialId: trial.id } } }),
          'witnessCalledEvent'
        );
        deletionCounts.witnessCalledEvents = witnessCalledEventsDeleted.count;
        
        // Delete marker-related data
        logger.info('Deleting marker data...');
        const markerTimelineDeleted = await this.deleteWithRetry(
          () => this.prisma.markerTimeline.deleteMany({ where: { trialId: trial.id } }),
          'markerTimeline'
        );
        deletionCounts.markerTimelines = markerTimelineDeleted.count;
        
        const markerDeleted = await this.deleteWithRetry(
          () => this.prisma.marker.deleteMany({ where: { trialId: trial.id } }),
          'marker'
        );
        deletionCounts.markers = markerDeleted.count;
        
        const markerSectionDeleted = await this.deleteWithRetry(
          () => this.prisma.markerSection.deleteMany({ where: { trialId: trial.id } }),
          'markerSection'
        );
        deletionCounts.markerSections = markerSectionDeleted.count;

        // Delete trial events (after event-specific types)
        logger.info('Deleting trial events...');
        const trialEventsDeleted = await this.deleteWithRetry(
          () => this.prisma.trialEvent.deleteMany({ where: { trialId: trial.id } }),
          'trialEvent'
        );
        deletionCounts.trialEvents = trialEventsDeleted.count;
        
        // Delete lines in batches (can be very large)
        logger.info('Deleting lines (this may take a while)...');
        const linesDeleted = await this.deleteLinesInBatches(trial.id);
        deletionCounts.lines = linesDeleted;
        
        // Delete pages (before sessions)
        logger.info('Deleting pages...');
        const pagesDeleted = await this.deleteWithRetry(
          () => this.prisma.page.deleteMany({ where: { session: { trialId: trial.id } } }),
          'page'
        );
        deletionCounts.pages = pagesDeleted.count;
        
        // Delete session sections
        const sessionSectionDeleted = await this.deleteWithRetry(
          () => this.prisma.sessionSection.deleteMany({ where: { trialId: trial.id } }),
          'sessionSection'
        );
        deletionCounts.sessionSections = sessionSectionDeleted.count;
        
        // Delete sessions
        logger.info('Deleting sessions...');
        const sessionsDeleted = await this.deleteWithRetry(
          () => this.prisma.session.deleteMany({ where: { trialId: trial.id } }),
          'session'
        );
        deletionCounts.sessions = sessionsDeleted.count;

        // Delete people-related data
        logger.info('Deleting people data...');
        const speakersDeleted = await this.deleteWithRetry(
          () => this.prisma.speaker.deleteMany({ where: { trialId: trial.id } }),
          'speaker'
        );
        deletionCounts.speakers = speakersDeleted.count;
        
        const witnessesDeleted = await this.deleteWithRetry(
          () => this.prisma.witness.deleteMany({ where: { trialId: trial.id } }),
          'witness'
        );
        deletionCounts.witnesses = witnessesDeleted.count;

        const anonymousSpeakersDeleted = await this.deleteWithRetry(
          () => this.prisma.anonymousSpeaker.deleteMany({ where: { trialId: trial.id } }),
          'anonymousSpeaker'
        );
        deletionCounts.anonymousSpeakers = anonymousSpeakersDeleted.count;

        const trialAttorneysDeleted = await this.deleteWithRetry(
          () => this.prisma.trialAttorney.deleteMany({ where: { trialId: trial.id } }),
          'trialAttorney'
        );
        deletionCounts.trialAttorneys = trialAttorneysDeleted.count;
        
        const jurorsDeleted = await this.deleteWithRetry(
          () => this.prisma.juror.deleteMany({ where: { trialId: trial.id } }),
          'juror'
        );
        deletionCounts.jurors = jurorsDeleted.count;

        const judgeDeleted = await this.deleteWithRetry(
          () => this.prisma.judge.deleteMany({ where: { trialId: trial.id } }),
          'judge'
        );
        deletionCounts.judge = judgeDeleted.count;

        const courtReporterDeleted = await this.deleteWithRetry(
          () => this.prisma.courtReporter.deleteMany({ where: { trialId: trial.id } }),
          'courtReporter'
        );
        deletionCounts.courtReporter = courtReporterDeleted.count;

        // Delete status records
        logger.info('Deleting status records...');
        const processingStatusDeleted = await this.deleteWithRetry(
          () => this.prisma.trialProcessingStatus.deleteMany({ where: { trialId: trial.id } }),
          'trialProcessingStatus'
        );
        deletionCounts.processingStatus = processingStatusDeleted.count;

        const workflowStateDeleted = await this.deleteWithRetry(
          () => this.prisma.trialWorkflowState.deleteMany({ where: { trialId: trial.id } }),
          'trialWorkflowState'
        );
        deletionCounts.workflowState = workflowStateDeleted.count;

        // Finally, delete the trial itself
        logger.info('Deleting trial record...');
        await this.deleteWithRetry(
          () => this.prisma.trial.delete({ where: { id: trial.id } }),
          'trial'
        );
        deletionCounts.trial = 1;
        
        logger.info(`Successfully deleted trial ${trial.name} and all associated data`);
        logger.info('Deletion counts:', deletionCounts);

        return {
          success: true,
          dryRun: false,
          trial: {
            id: trial.id,
            name: trial.name,
            caseNumber: trial.caseNumber,
            shortName: trial.shortName
          },
          statistics: deletionCounts,
          message: `Successfully deleted trial ${trial.name} and all associated data`
        };
      } catch (error) {
        logger.error('Error during deletion process:', error);
        logger.info('Partial deletion counts:', deletionCounts);
        throw new Error(`Deletion incomplete. Deleted counts: ${JSON.stringify(deletionCounts)}. Error: ${error}`);
      }

    } catch (error) {
      logger.error('Error deleting trial:', error);
      throw error;
    }
  }

  /**
   * Find a trial by ID, case number, or short name
   */
  private async findTrial(identifier: string | number) {
    // If it's a number, search by ID
    if (typeof identifier === 'number') {
      return await this.prisma.trial.findUnique({
        where: { id: identifier }
      });
    }

    // Try to parse as number (ID)
    const id = parseInt(identifier as string, 10);
    if (!isNaN(id)) {
      const trial = await this.prisma.trial.findUnique({
        where: { id }
      });
      if (trial) return trial;
    }

    // Search by case number
    const trialByCaseNumber = await this.prisma.trial.findUnique({
      where: { caseNumber: identifier as string }
    });
    if (trialByCaseNumber) return trialByCaseNumber;

    // Search by short name
    const trialByShortName = await this.prisma.trial.findUnique({
      where: { shortName: identifier as string }
    });
    if (trialByShortName) return trialByShortName;

    // Search by short name (case-insensitive)
    const trialByShortNameCI = await this.prisma.trial.findFirst({
      where: { 
        shortName: {
          equals: identifier as string,
          mode: 'insensitive'
        }
      }
    });
    
    return trialByShortNameCI;
  }

  /**
   * Get statistics about what will be deleted
   */
  private async getTrialStatistics(trialId: number) {
    const [
      // Core trial data
      sessions,
      pages,
      lines,
      
      // Events
      trialEvents,
      courtDirectiveEvents,
      statementEvents,
      witnessCalledEvents,
      
      // Markers
      markers,
      markerSections,
      markerTimelines,
      
      // People
      speakers,
      witnesses,
      anonymousSpeakers,
      trialAttorneys,
      jurors,
      judge,
      courtReporter,
      
      // Sections
      sessionSections,
      
      // Search and accumulator
      elasticSearchResults,
      accumulatorResults,
      
      // Status
      processingStatus,
      workflowState
    ] = await Promise.all([
      // Core trial data
      this.prisma.session.count({ where: { trialId } }),
      this.prisma.page.count({ where: { session: { trialId } } }),
      this.prisma.line.count({ where: { page: { session: { trialId } } } }),
      
      // Events
      this.prisma.trialEvent.count({ where: { trialId } }),
      this.prisma.courtDirectiveEvent.count({ where: { event: { trialId } } }),
      this.prisma.statementEvent.count({ where: { event: { trialId } } }),
      this.prisma.witnessCalledEvent.count({ where: { event: { trialId } } }),
      
      // Markers
      this.prisma.marker.count({ where: { trialId } }),
      this.prisma.markerSection.count({ where: { trialId } }),
      this.prisma.markerTimeline.count({ where: { trialId } }),
      
      // People
      this.prisma.speaker.count({ where: { trialId } }),
      this.prisma.witness.count({ where: { trialId } }),
      this.prisma.anonymousSpeaker.count({ where: { trialId } }),
      this.prisma.trialAttorney.count({ where: { trialId } }),
      this.prisma.juror.count({ where: { trialId } }),
      this.prisma.judge.count({ where: { trialId } }),
      this.prisma.courtReporter.count({ where: { trialId } }),
      
      // Sections
      this.prisma.sessionSection.count({ where: { trialId } }),
      
      // Search and accumulator
      this.prisma.elasticSearchResult.count({ where: { trialId } }),
      this.prisma.accumulatorResult.count({ where: { trialId } }),
      
      // Status
      this.prisma.trialProcessingStatus.count({ where: { trialId } }),
      this.prisma.trialWorkflowState.count({ where: { trialId } })
    ]);

    return {
      // Core trial data
      trial: 1, // The trial itself
      sessions,
      pages,
      lines,
      
      // Events
      trialEvents,
      courtDirectiveEvents,
      statementEvents,
      witnessCalledEvents,
      
      // Markers
      markers,
      markerSections,
      markerTimelines,
      
      // People
      speakers,
      witnesses,
      anonymousSpeakers,
      trialAttorneys,
      jurors,
      judge,
      courtReporter,
      
      // Sections
      sessionSections,
      
      // Search and accumulator
      elasticSearchResults,
      accumulatorResults,
      
      // Status
      processingStatus,
      workflowState
    };
  }

  /**
   * Delete with retry logic
   */
  private async deleteWithRetry<T>(
    deleteFunc: () => Promise<T>,
    entityName: string,
    maxRetries: number = 3
  ): Promise<T> {
    let lastError: any;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const result = await deleteFunc();
        if (attempt > 1) {
          logger.info(`Successfully deleted ${entityName} on attempt ${attempt}`);
        }
        return result;
      } catch (error) {
        lastError = error;
        logger.warn(`Attempt ${attempt}/${maxRetries} failed for ${entityName}:`, error);
        
        if (attempt < maxRetries) {
          // Wait before retrying (exponential backoff)
          const waitTime = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
          logger.info(`Waiting ${waitTime}ms before retry...`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
        }
      }
    }
    
    throw new Error(`Failed to delete ${entityName} after ${maxRetries} attempts: ${lastError}`);
  }

  /**
   * Delete lines in batches to avoid timeout
   */
  private async deleteLinesInBatches(trialId: number, batchSize: number = 1000): Promise<number> {
    let totalDeleted = 0;
    let hasMore = true;
    
    while (hasMore) {
      try {
        // Get a batch of line IDs to delete
        const linesToDelete = await this.prisma.line.findMany({
          where: { page: { session: { trialId } } },
          select: { id: true },
          take: batchSize
        });
        
        if (linesToDelete.length === 0) {
          hasMore = false;
          break;
        }
        
        // Delete this batch
        const deleted = await this.prisma.line.deleteMany({
          where: {
            id: { in: linesToDelete.map(l => l.id) }
          }
        });
        
        totalDeleted += deleted.count;
        logger.info(`Deleted ${deleted.count} lines (total: ${totalDeleted})`);
        
        // If we deleted less than batchSize, we're done
        if (deleted.count < batchSize) {
          hasMore = false;
        }
        
        // Small delay to prevent overwhelming the database
        if (hasMore) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      } catch (error) {
        logger.error(`Error deleting batch of lines: ${error}`);
        // Try to continue with smaller batch size
        if (batchSize > 100) {
          batchSize = Math.floor(batchSize / 2);
          logger.info(`Reducing batch size to ${batchSize} and retrying...`);
        } else {
          throw error;
        }
      }
    }
    
    return totalDeleted;
  }

  /**
   * List all trials in the database
   */
  async listTrials(): Promise<TrialSummary[]> {
    const trials = await this.prisma.trial.findMany({
      select: {
        id: true,
        name: true,
        caseNumber: true,
        shortName: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: {
            sessions: true,
            attorneys: true,
            trialEvents: true
          }
        }
      },
      orderBy: [
        { shortName: 'asc' },
        { name: 'asc' }
      ]
    });

    return trials.map(trial => ({
      id: trial.id,
      name: trial.name,
      caseNumber: trial.caseNumber,
      shortName: trial.shortName,
      createdAt: trial.createdAt,
      updatedAt: trial.updatedAt,
      sessionCount: trial._count.sessions,
      attorneyCount: trial._count.attorneys,
      eventCount: trial._count.trialEvents
    }));
  }

  async close() {
    await this.prisma.$disconnect();
  }
}

// Type definitions
interface DeletionResult {
  success: boolean;
  dryRun: boolean;
  trial: {
    id: number;
    name: string;
    caseNumber: string;
    shortName: string | null;
  };
  statistics: Record<string, number>;
  message: string;
}

interface TrialSummary {
  id: number;
  name: string;
  caseNumber: string;
  shortName: string | null;
  createdAt: Date;
  updatedAt: Date;
  sessionCount: number;
  attorneyCount: number;
  eventCount: number;
}

export { DeletionResult, TrialSummary };