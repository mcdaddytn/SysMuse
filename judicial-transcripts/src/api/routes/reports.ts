import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { HierarchyViewService, ViewType } from '../../services/HierarchyViewService';
import { Logger } from '../../utils/logger';

const router = Router();
const prisma = new PrismaClient();
const hierarchyService = new HierarchyViewService(prisma);
const logger = new Logger('ReportsAPI');

/**
 * GET /api/reports/hierarchy/:trialId
 * Get hierarchy view for a specific trial
 */
router.get('/hierarchy/:trialId', async (req: Request, res: Response): Promise<Response> => {
  try {
    const trialId = parseInt(req.params.trialId);
    const view = (req.query.view as ViewType) || 'standard';
    const includeTranscript = req.query.includeTranscript === 'true';
    const maxDepth = req.query.maxDepth ? parseInt(req.query.maxDepth as string) : undefined;

    // Validate view type
    const validViews: ViewType[] = ['session', 'standard', 'objections', 'interactions', 'all'];
    if (!validViews.includes(view)) {
      return res.status(400).json({ 
        error: `Invalid view type. Must be one of: ${validViews.join(', ')}` 
      });
    }

    const result = await hierarchyService.getHierarchyView({
      trialId,
      view,
      includeTranscript,
      maxDepth
    });

    return res.json(result);
  } catch (error) {
    logger.error('Error generating hierarchy view:', error);
    return res.status(500).json({ 
      error: 'Failed to generate hierarchy view',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/reports/phase3/:trialId
 * Get Phase3 statistics and results
 */
router.get('/phase3/:trialId', async (req: Request, res: Response) => {
  try {
    const trialId = parseInt(req.params.trialId);
    const includeMarkers = req.query.includeMarkers === 'true';
    const includeAccumulators = req.query.includeAccumulators === 'true';

    // Get workflow state
    const workflowState = await prisma.trialWorkflowState.findUnique({
      where: { trialId }
    });

    // Get statistics (reusing logic from phase3.ts stats command)
    const [markers, markerSections, accumulatorResults, elasticSearchResults] = await Promise.all([
      prisma.marker.count({ where: { trialId } }),
      prisma.markerSection.count({ where: { trialId } }),
      prisma.accumulatorResult.count({ where: { trialId } }),
      prisma.elasticSearchResult.count({ where: { trialId } })
    ]);

    // Get markers by type
    const markersByType = await prisma.marker.groupBy({
      by: ['markerType'],
      where: { trialId },
      _count: true
    });

    const markerTypesSummary: Record<string, number> = {};
    for (const marker of markersByType) {
      markerTypesSummary[marker.markerType] = marker._count;
    }

    // Get accumulator summary
    const accumulatorSummary = await prisma.accumulatorResult.groupBy({
      by: ['accumulatorId'],
      where: { trialId },
      _count: true
    });

    // Get accumulator names for the summary
    const accumulatorNames: Record<string, number> = {};
    for (const acc of accumulatorSummary) {
      const accumulator = await prisma.accumulatorExpression.findUnique({
        where: { id: acc.accumulatorId },
        select: { name: true }
      });
      if (accumulator) {
        accumulatorNames[accumulator.name] = acc._count;
      }
    }

    const response: any = {
      trialId,
      phase3Status: {
        completed: workflowState?.phase3Completed || false,
        completedAt: workflowState?.phase3CompletedAt || null,
        markersIndexed: workflowState?.phase3IndexCompleted || false
      },
      statistics: {
        markers,
        markerSections,
        accumulatorResults,
        elasticSearchResults
      },
      markersByType: markerTypesSummary,
      accumulatorSummary: accumulatorNames
    };

    // Include detailed markers if requested
    if (includeMarkers) {
      const detailedMarkers = await prisma.marker.findMany({
        where: { trialId },
        orderBy: { eventId: 'asc' },
        take: 100,
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

      response.markers = detailedMarkers.map(marker => ({
        id: marker.id,
        type: marker.markerType,
        eventId: marker.eventId,
        description: marker.description,
        confidence: marker.confidence,
        speaker: marker.event?.statement?.speaker?.speakerHandle,
        text: marker.event?.statement?.text?.substring(0, 100)
      }));
    }

    // Include accumulator results if requested
    if (includeAccumulators) {
      const detailedAccumulators = await prisma.accumulatorResult.findMany({
        where: { trialId },
        orderBy: { startEventId: 'asc' },
        take: 50,
        include: {
          accumulator: {
            select: {
              name: true,
              description: true
            }
          }
        }
      });

      response.accumulatorResults = detailedAccumulators.map(result => ({
        id: result.id,
        accumulator: result.accumulator.name,
        description: result.accumulator.description,
        eventRange: [result.startEventId, result.endEventId],
        confidence: result.floatResult,
        metadata: result.metadata
      }));
    }

    res.json(response);
  } catch (error) {
    logger.error('Error generating Phase3 report:', error);
    res.status(500).json({ 
      error: 'Failed to generate Phase3 report',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/reports/status
 * Get overall system and report status
 */
router.get('/status', async (req: Request, res: Response) => {
  try {
    // Get system statistics
    const [totalTrials, phase3Completed, indexedTrials] = await Promise.all([
      prisma.trial.count(),
      prisma.trialWorkflowState.count({ where: { phase3Completed: true } }),
      prisma.trialWorkflowState.count({ where: { phase3IndexCompleted: true } })
    ]);

    // Get global statistics
    const [totalMarkers, totalMarkerSections, totalAccumulatorResults] = await Promise.all([
      prisma.marker.count(),
      prisma.markerSection.count(),
      prisma.accumulatorResult.count()
    ]);

    res.json({
      availableReports: [
        {
          type: 'hierarchy',
          views: ['standard', 'session', 'objections', 'interactions'],
          description: 'Hierarchical trial structure views'
        },
        {
          type: 'phase3',
          description: 'Phase 3 processing statistics and marker analysis'
        },
        {
          type: 'export',
          formats: ['txt', 'json', 'csv'],
          description: 'Full transcript export with annotations'
        }
      ],
      systemStatus: {
        totalTrials,
        phase3Completed,
        indexedTrials
      },
      globalStatistics: {
        markers: totalMarkers,
        markerSections: totalMarkerSections,
        accumulatorResults: totalAccumulatorResults
      }
    });
  } catch (error) {
    logger.error('Error getting report status:', error);
    res.status(500).json({ 
      error: 'Failed to get report status',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/reports/phase3/monitor/:trialId
 * Get detailed Phase3 monitoring information (from phase3-monitor.ts logic)
 */
router.get('/phase3/monitor/:trialId', async (req: Request, res: Response) => {
  try {
    const trialId = parseInt(req.params.trialId);
    const where = { trialId };

    // ElasticSearch Expression Processing
    const totalExpressions = await prisma.elasticSearchExpression.count();
    const totalStatements = await prisma.statementEvent.count({
      where: { event: { trialId } }
    });
    const expectedESResults = totalExpressions * totalStatements;
    const actualESResults = await prisma.elasticSearchResult.count({ where });
    const matchedESResults = await prisma.elasticSearchResult.count({ 
      where: { ...where, matched: true } 
    });

    // Top matching expressions
    const topMatches = await prisma.elasticSearchResult.groupBy({
      by: ['expressionId'],
      where: { ...where, matched: true },
      _count: { matched: true },
      orderBy: { _count: { matched: 'desc' } },
      take: 5
    });

    const topMatchingExpressions = await Promise.all(
      topMatches.map(async (match) => {
        const expr = await prisma.elasticSearchExpression.findUnique({
          where: { id: match.expressionId }
        });
        return {
          name: expr?.name || 'Unknown',
          matches: match._count.matched
        };
      })
    );

    // Accumulator Processing
    const totalAccumulators = await prisma.accumulatorExpression.count();
    const accumulatorResults = await prisma.accumulatorResult.count({ where });
    const matchedAccumResults = await prisma.accumulatorResult.count({
      where: { ...where, booleanResult: true }
    });

    // Marker Discovery
    const markers = await prisma.marker.count({ where });
    const markerSections = await prisma.markerSection.count({ where });
    
    // Marker type breakdown
    const markerTypes = await prisma.marker.groupBy({
      by: ['markerType'],
      where,
      _count: { markerType: true }
    });

    const markerTypeBreakdown: Record<string, number> = {};
    for (const type of markerTypes) {
      markerTypeBreakdown[type.markerType] = type._count.markerType;
    }

    // Witness Processing
    const witnessEvents = await prisma.witnessCalledEvent.count({
      where: { event: { trialId } }
    });
    const witnesses = await prisma.witness.count({ where: { trialId } });

    res.json({
      trialId,
      elasticSearch: {
        expressions: totalExpressions,
        statements: totalStatements,
        expectedResults: expectedESResults,
        actualResults: actualESResults,
        progress: ((actualESResults / expectedESResults) * 100).toFixed(1),
        matched: matchedESResults,
        matchedPercentage: ((matchedESResults / actualESResults) * 100).toFixed(2),
        topMatchingExpressions
      },
      accumulators: {
        total: totalAccumulators,
        results: accumulatorResults,
        matched: matchedAccumResults
      },
      markers: {
        total: markers,
        sections: markerSections,
        typeBreakdown: markerTypeBreakdown
      },
      witnesses: {
        total: witnesses,
        calledEvents: witnessEvents,
        averageExaminationsPerWitness: witnesses > 0 ? (witnessEvents / witnesses).toFixed(1) : 0
      }
    });
  } catch (error) {
    logger.error('Error generating Phase3 monitor report:', error);
    res.status(500).json({ 
      error: 'Failed to generate Phase3 monitor report',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;