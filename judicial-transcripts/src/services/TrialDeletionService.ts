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

      // Start transaction for actual deletion
      const result = await this.prisma.$transaction(async (tx) => {
        // Delete in order that respects referential integrity
        // Most relationships have CASCADE delete, but we'll be explicit for clarity and counting
        
        // Delete search and accumulator results first
        const elasticSearchResultsDeleted = await tx.elasticSearchResult.deleteMany({
          where: { trialId: trial.id }
        });
        
        const accumulatorResultsDeleted = await tx.accumulatorResult.deleteMany({
          where: { trialId: trial.id }
        });
        
        // Delete event-specific types (they reference TrialEvent)
        const courtDirectiveEventsDeleted = await tx.courtDirectiveEvent.deleteMany({
          where: { event: { trialId: trial.id } }
        });
        
        const statementEventsDeleted = await tx.statementEvent.deleteMany({
          where: { event: { trialId: trial.id } }
        });
        
        const witnessCalledEventsDeleted = await tx.witnessCalledEvent.deleteMany({
          where: { event: { trialId: trial.id } }
        });
        
        // Delete marker-related data
        const markerTimelineDeleted = await tx.markerTimeline.deleteMany({
          where: { trialId: trial.id }
        });
        
        const markerDeleted = await tx.marker.deleteMany({
          where: { trialId: trial.id }
        });
        
        const markerSectionDeleted = await tx.markerSection.deleteMany({
          where: { trialId: trial.id }
        });

        // Delete trial events (after event-specific types)
        const trialEventsDeleted = await tx.trialEvent.deleteMany({
          where: { trialId: trial.id }
        });
        
        // Delete lines (before pages)
        const linesDeleted = await tx.line.deleteMany({
          where: { page: { session: { trialId: trial.id } } }
        });
        
        // Delete pages (before sessions)
        const pagesDeleted = await tx.page.deleteMany({
          where: { session: { trialId: trial.id } }
        });
        
        // Delete session sections
        const sessionSectionDeleted = await tx.sessionSection.deleteMany({
          where: { trialId: trial.id }
        });
        
        // Delete sessions
        const sessionsDeleted = await tx.session.deleteMany({
          where: { trialId: trial.id }
        });

        // Delete people-related data
        const speakersDeleted = await tx.speaker.deleteMany({
          where: { trialId: trial.id }
        });
        
        const witnessesDeleted = await tx.witness.deleteMany({
          where: { trialId: trial.id }
        });

        const anonymousSpeakersDeleted = await tx.anonymousSpeaker.deleteMany({
          where: { trialId: trial.id }
        });

        const trialAttorneysDeleted = await tx.trialAttorney.deleteMany({
          where: { trialId: trial.id }
        });
        
        const jurorsDeleted = await tx.juror.deleteMany({
          where: { trialId: trial.id }
        });

        const judgeDeleted = await tx.judge.deleteMany({
          where: { trialId: trial.id }
        });

        const courtReporterDeleted = await tx.courtReporter.deleteMany({
          where: { trialId: trial.id }
        });

        // Delete status records
        const processingStatusDeleted = await tx.trialProcessingStatus.deleteMany({
          where: { trialId: trial.id }
        });

        const workflowStateDeleted = await tx.trialWorkflowState.deleteMany({
          where: { trialId: trial.id }
        });

        // Finally, delete the trial itself
        const deletedTrial = await tx.trial.delete({
          where: { id: trial.id }
        });

        return {
          trial: deletedTrial,
          deletionCounts: {
            // Core trial data
            trial: 1,
            sessions: sessionsDeleted.count,
            pages: pagesDeleted.count,
            lines: linesDeleted.count,
            
            // Events
            trialEvents: trialEventsDeleted.count,
            courtDirectiveEvents: courtDirectiveEventsDeleted.count,
            statementEvents: statementEventsDeleted.count,
            witnessCalledEvents: witnessCalledEventsDeleted.count,
            
            // Markers
            markers: markerDeleted.count,
            markerSections: markerSectionDeleted.count,
            markerTimelines: markerTimelineDeleted.count,
            
            // People
            speakers: speakersDeleted.count,
            witnesses: witnessesDeleted.count,
            anonymousSpeakers: anonymousSpeakersDeleted.count,
            trialAttorneys: trialAttorneysDeleted.count,
            jurors: jurorsDeleted.count,
            judge: judgeDeleted.count,
            courtReporter: courtReporterDeleted.count,
            
            // Sections
            sessionSections: sessionSectionDeleted.count,
            
            // Search and accumulator
            elasticSearchResults: elasticSearchResultsDeleted.count,
            accumulatorResults: accumulatorResultsDeleted.count,
            
            // Status
            processingStatus: processingStatusDeleted.count,
            workflowState: workflowStateDeleted.count
          }
        };
      });

      logger.info(`Successfully deleted trial ${trial.name} and all associated data`);
      logger.info('Deletion counts:', result.deletionCounts);

      return {
        success: true,
        dryRun: false,
        trial: {
          id: trial.id,
          name: trial.name,
          caseNumber: trial.caseNumber,
          shortName: trial.shortName
        },
        statistics: result.deletionCounts,
        message: `Successfully deleted trial ${trial.name} and all associated data`
      };

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