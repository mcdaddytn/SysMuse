import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { HierarchyViewService } from '../../services/HierarchyViewService';
import { SummaryService } from '../../services/SummaryService';
import { EventOverlayService } from '../../services/EventOverlayService';
import { Logger } from '../../utils/logger';

const router = Router();
const prisma = new PrismaClient();
const logger = new Logger('HierarchyAPI');
const hierarchyService = new HierarchyViewService(prisma);
const summaryService = new SummaryService(prisma);
const eventOverlayService = new EventOverlayService(prisma);

/**
 * GET /api/hierarchy/trials
 * Returns list of all trials for dropdown selection
 */
router.get('/trials', async (req: Request, res: Response) => {
  try {
    const trials = await prisma.trial.findMany({
      select: {
        id: true,
        shortName: true,
        shortNameHandle: true,
        name: true,
        caseNumber: true,
        createdAt: true,
        updatedAt: true
      },
      orderBy: { shortName: 'asc' }
    });

    // Add session count and date range
    const trialsWithMetadata = await Promise.all(
      trials.map(async (trial) => {
        const sessions = await prisma.session.findMany({
          where: { trialId: trial.id },
          select: {
            sessionDate: true
          }
        });

        const dates = sessions
          .map(s => s.sessionDate)
          .filter(d => d !== null) as Date[];

        return {
          ...trial,
          sessionCount: sessions.length,
          startDate: dates.length > 0 ? Math.min(...dates.map(d => d.getTime())) : null,
          endDate: dates.length > 0 ? Math.max(...dates.map(d => d.getTime())) : null
        };
      })
    );

    res.json({ trials: trialsWithMetadata });
  } catch (error) {
    logger.error('Error fetching trials:', error);
    res.status(500).json({
      error: {
        code: 'FETCH_TRIALS_ERROR',
        message: 'Failed to fetch trials',
        details: error
      }
    });
  }
});

/**
 * GET /api/hierarchy/trials/:trialId
 * Returns detailed trial information
 */
router.get('/trials/:trialId', async (req: Request, res: Response) => {
  try {
    const trialId = parseInt(req.params.trialId);

    const trial = await prisma.trial.findUnique({
      where: { id: trialId },
      include: {
        judge: true,
        courtReporter: true,
        sessions: {
          select: {
            id: true,
            sessionDate: true,
            sessionType: true
          }
        }
      }
    });

    if (!trial) {
      res.status(404).json({
        error: {
          code: 'TRIAL_NOT_FOUND',
          message: `Trial with ID ${trialId} not found`
        }
      });
      return;
    }

    // Get verdict and other metadata if available
    const metadata: any = {
      judge: trial.judge?.name || 'Unknown',
      court: 'Unknown', // TODO: Add court location to Trial model
      sessionCount: trial.sessions.length
    };

    // Try to get verdict from trial metadata or markers
    const verdictMarker = await prisma.marker.findFirst({
      where: {
        trialId,
        markerType: 'OTHER' as any // Using OTHER as VERDICT might not be in MarkerType enum
      }
    });

    if (verdictMarker) {
      metadata.verdict = verdictMarker.description;
    }

    res.json({
      trial: {
        id: trial.id,
        shortName: trial.shortName,
        shortNameHandle: trial.shortNameHandle,
        name: trial.name,
        caseNumber: trial.caseNumber,
        description: trial.name || '', // TODO: Add description field to Trial model
        metadata
      }
    });
  } catch (error) {
    logger.error('Error fetching trial details:', error);
    res.status(500).json({
      error: {
        code: 'FETCH_TRIAL_ERROR',
        message: 'Failed to fetch trial details',
        details: error
      }
    });
  }
});

/**
 * GET /api/hierarchy/views/:trialId/:viewType
 * Returns hierarchical structure for specified view type
 */
router.get('/views/:trialId/:viewType', async (req: Request, res: Response) => {
  try {
    const trialId = parseInt(req.params.trialId);
    const viewType = req.params.viewType as 'standard' | 'session' | 'objections' | 'interactions';

    // Validate view type
    if (!['standard', 'session', 'objections', 'interactions'].includes(viewType)) {
      res.status(400).json({
        error: {
          code: 'INVALID_VIEW_TYPE',
          message: `Invalid view type: ${viewType}`,
          details: {
            validTypes: ['standard', 'session', 'objections', 'interactions']
          }
        }
      });
      return;
    }

    const includeStats = req.query.includeStats !== 'false';
    const includeTranscript = req.query.includeTranscript === 'true';
    const maxDepth = req.query.maxDepth ? parseInt(req.query.maxDepth as string) : undefined;

    const result = await hierarchyService.getHierarchyView({
      trialId,
      view: viewType,
      includeTranscript,
      maxDepth
    });

    // Transform hierarchy to API format
    const transformNode = (node: any): any => {
      const transformed: any = {
        id: node.section.id,
        type: node.section.markerSectionType,
        name: node.section.name,
        label: node.section.name,
        description: node.section.description,
        startEventId: node.section.startEventId,
        endEventId: node.section.endEventId
      };

      if (includeStats && node.stats) {
        transformed.stats = {
          eventCount: node.stats.eventCount,
          wordCount: node.stats.wordCount,
          speakerCount: node.stats.speakerCount
        };

        // Add duration if we have session dates
        if (node.section.startTime && node.section.endTime) {
          const duration = new Date(node.section.endTime).getTime() -
                          new Date(node.section.startTime).getTime();
          transformed.stats.duration = `${Math.round(duration / 60000)} minutes`;
        }
      }

      if (includeTranscript && node.section.text) {
        transformed.transcript = node.section.text;
      }

      if (node.children && node.children.length > 0) {
        transformed.children = node.children.map(transformNode);
      } else {
        transformed.children = [];
      }

      return transformed;
    };

    res.json({
      trialId,
      viewType,
      hierarchy: result.hierarchy.map(transformNode)
    });
  } catch (error) {
    logger.error('Error fetching hierarchy view:', error);
    res.status(500).json({
      error: {
        code: 'FETCH_HIERARCHY_ERROR',
        message: 'Failed to fetch hierarchy view',
        details: error
      }
    });
  }
});

/**
 * GET /api/hierarchy/summaries/:sectionId
 * Returns available summaries for a hierarchy section
 */
router.get('/summaries/:sectionId', async (req: Request, res: Response) => {
  try {
    const sectionId = parseInt(req.params.sectionId);

    // Check if sectionId is valid
    if (isNaN(sectionId)) {
      res.status(400).json({
        error: {
          code: 'INVALID_SECTION_ID',
          message: 'Invalid section ID provided'
        }
      });
      return;
    }

    const summaryType = req.query.summaryType as string || 'abridged';
    const maxLength = req.query.maxLength ? parseInt(req.query.maxLength as string) : undefined;

    const section = await prisma.markerSection.findUnique({
      where: { id: sectionId }
    });

    if (!section) {
      res.status(404).json({
        error: {
          code: 'SECTION_NOT_FOUND',
          message: `Section with ID ${sectionId} not found`
        }
      });
      return;
    }

    // Get available summaries for this section
    const availableSummaries = await summaryService.getAvailableSummaries(sectionId);

    // Get the requested summary content
    const content = await summaryService.getSummary(sectionId, summaryType, maxLength);

    // Get metadata about the speaker if this is a testimony/statement section
    let metadata: any = {};
    if (section.markerSectionType === 'WITNESS_TESTIMONY' ||
        section.markerSectionType === 'OPENING_STATEMENT_PLAINTIFF' ||
        section.markerSectionType === 'OPENING_STATEMENT_DEFENSE' ||
        section.markerSectionType === 'CLOSING_STATEMENT_PLAINTIFF' ||
        section.markerSectionType === 'CLOSING_STATEMENT_DEFENSE') {

      // Try to get speaker information from the first event in the section
      if (section.startEventId) {
        const firstEvent = await prisma.trialEvent.findFirst({
          where: {
            trialId: section.trialId,
            id: section.startEventId
          },
          include: {
            statement: {
              include: {
                speaker: true
              }
            }
          }
        });

        if (firstEvent?.statement?.speaker) {
          const speaker = firstEvent.statement.speaker;
          metadata.speaker = speaker.speakerHandle;
          metadata.role = speaker.speakerType;

          // Get law firm if attorney
          if (speaker.speakerType === 'ATTORNEY') {
            const attorneyTrial = await prisma.trialAttorney.findFirst({
              where: {
                trialId: section.trialId,
                attorneyId: speaker.id
              },
              include: {
                lawFirm: true
              }
            });

            if (attorneyTrial?.lawFirm) {
              metadata.lawFirm = attorneyTrial.lawFirm.name;
            }
          }
        }
      }

      // Add timing information if available
      if (section.startTime && section.endTime) {
        metadata.startTime = new Date(section.startTime).toLocaleTimeString();
        metadata.endTime = new Date(section.endTime).toLocaleTimeString();
      }
    }

    res.json({
      sectionId,
      availableSummaries,
      selectedSummary: summaryType,
      content: {
        type: summaryType,
        text: content,
        metadata
      }
    });
  } catch (error) {
    logger.error('Error fetching summary:', error);
    res.status(500).json({
      error: {
        code: 'FETCH_SUMMARY_ERROR',
        message: 'Failed to fetch summary',
        details: error
      }
    });
  }
});

/**
 * GET /api/hierarchy/events/:sectionId/:eventType
 * Returns events overlapping with selected section
 */
router.get('/events/:sectionId/:eventType', async (req: Request, res: Response) => {
  try {
    const sectionId = parseInt(req.params.sectionId);
    const eventType = req.params.eventType as 'objections' | 'interactions';

    // Check if sectionId is valid
    if (isNaN(sectionId)) {
      res.status(400).json({
        error: {
          code: 'INVALID_SECTION_ID',
          message: 'Invalid section ID provided'
        }
      });
      return;
    }

    // Validate event type
    if (!['objections', 'interactions'].includes(eventType)) {
      res.status(400).json({
        error: {
          code: 'INVALID_EVENT_TYPE',
          message: `Invalid event type: ${eventType}`,
          details: {
            validTypes: ['objections', 'interactions']
          }
        }
      });
      return;
    }

    const minConfidence = req.query.minConfidence ? parseFloat(req.query.minConfidence as string) : 0.0;
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 100;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : 0;

    const section = await prisma.markerSection.findUnique({
      where: { id: sectionId }
    });

    if (!section) {
      res.status(404).json({
        error: {
          code: 'SECTION_NOT_FOUND',
          message: `Section with ID ${sectionId} not found`
        }
      });
      return;
    }

    // Get overlapping events
    const events = await eventOverlayService.getOverlappingEvents(
      section,
      eventType,
      minConfidence,
      limit,
      offset
    );

    // Get summary statistics
    const summary = await eventOverlayService.getEventSummary(section, eventType);

    res.json({
      sectionId,
      eventType,
      parentSection: {
        name: section.name,
        startEventId: section.startEventId,
        endEventId: section.endEventId
      },
      events,
      summary
    });
  } catch (error) {
    logger.error('Error fetching events:', error);
    res.status(500).json({
      error: {
        code: 'FETCH_EVENTS_ERROR',
        message: 'Failed to fetch events',
        details: error
      }
    });
  }
});

/**
 * GET /api/hierarchy/export/:trialId
 * Export hierarchy data in various formats
 */
router.get('/export/:trialId', async (req: Request, res: Response) => {
  try {
    const trialId = parseInt(req.params.trialId);
    const format = req.query.format as string || 'json';
    const viewType = req.query.viewType as string || 'standard';
    const includeSummaries = req.query.includeSummaries === 'true';
    const includeEvents = req.query.includeEvents === 'true';

    // Validate format
    if (!['json', 'csv'].includes(format)) {
      res.status(400).json({
        error: {
          code: 'INVALID_FORMAT',
          message: `Invalid export format: ${format}`,
          details: {
            validFormats: ['json', 'csv']
          }
        }
      });
      return;
    }

    // Get hierarchy data
    const hierarchy = await hierarchyService.getHierarchyView({
      trialId,
      view: viewType as any,
      includeTranscript: includeSummaries
    });

    if (format === 'json') {
      // Set headers for file download
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="trial_${trialId}_${viewType}.json"`);

      res.json({
        trial: hierarchy.trialName,
        trialId,
        viewType,
        exportDate: new Date().toISOString(),
        hierarchy: hierarchy.hierarchy
      });
    } else if (format === 'csv') {
      // Convert hierarchy to CSV format
      const csvData = await convertHierarchyToCSV(hierarchy.hierarchy);

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="trial_${trialId}_${viewType}.csv"`);

      res.send(csvData);
    }
  } catch (error) {
    logger.error('Error exporting hierarchy:', error);
    res.status(500).json({
      error: {
        code: 'EXPORT_ERROR',
        message: 'Failed to export hierarchy',
        details: error
      }
    });
  }
});

/**
 * Helper function to convert hierarchy to CSV
 */
async function convertHierarchyToCSV(hierarchy: any[]): Promise<string> {
  const rows: string[] = [];
  rows.push('Level,Type,Name,Start Event,End Event,Event Count,Word Count,Speaker Count');

  const processNode = (node: any, level: number = 0) => {
    const row = [
      level.toString(),
      node.section.markerSectionType,
      `"${node.section.name?.replace(/"/g, '""') || ''}"`,
      node.section.startEventId || '',
      node.section.endEventId || '',
      node.stats?.eventCount || '',
      node.stats?.wordCount || '',
      node.stats?.speakerCount || ''
    ];
    rows.push(row.join(','));

    if (node.children) {
      node.children.forEach((child: any) => processNode(child, level + 1));
    }
  };

  hierarchy.forEach(node => processNode(node));
  return rows.join('\n');
}

export default router;