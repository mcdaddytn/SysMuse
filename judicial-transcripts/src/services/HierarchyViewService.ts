import { PrismaClient, MarkerSection, MarkerSectionType, MarkerSource } from '@prisma/client';
import { Logger } from '../utils/logger';

const logger = new Logger('HierarchyViewService');

export type ViewType = 'session' | 'standard' | 'objections' | 'interactions' | 'all';

export interface HierarchyNode {
  section: MarkerSection;
  children: HierarchyNode[];
  stats?: {
    eventCount?: number;
    confidence?: number;
    speakerCount?: number;
    wordCount?: number;
  };
}

export interface HierarchyViewOptions {
  trialId: number;
  view: ViewType;
  includeTranscript?: boolean;
  maxDepth?: number;
}

export interface HierarchyViewResult {
  trialId: number;
  trialName: string;
  view: ViewType;
  hierarchy: HierarchyNode[];
  metadata: {
    generatedAt: Date;
    nodeCount: number;
    maxDepth: number;
  };
}

export class HierarchyViewService {
  constructor(private prisma: PrismaClient) {}

  /**
   * Get hierarchy view for a trial
   */
  async getHierarchyView(options: HierarchyViewOptions): Promise<HierarchyViewResult> {
    const trial = await this.prisma.trial.findUnique({
      where: { id: options.trialId }
    });

    if (!trial) {
      throw new Error(`Trial ${options.trialId} not found`);
    }

    logger.info(`Generating ${options.view} view for: ${trial.name || trial.caseNumber}`);

    const hierarchy = await this.getHierarchyByType(options.trialId, options.view);
    
    // Calculate metadata
    const { nodeCount, maxDepth } = this.calculateHierarchyMetadata(hierarchy);

    return {
      trialId: options.trialId,
      trialName: trial.name || trial.caseNumber,
      view: options.view,
      hierarchy,
      metadata: {
        generatedAt: new Date(),
        nodeCount,
        maxDepth
      }
    };
  }

  /**
   * Get all hierarchy views for a trial
   */
  async getAllHierarchyViews(trialId: number): Promise<Record<string, HierarchyNode[]>> {
    const views: ViewType[] = ['session', 'standard', 'objections', 'interactions'];
    const results: Record<string, HierarchyNode[]> = {};

    for (const view of views) {
      results[view] = await this.getHierarchyByType(trialId, view);
    }

    return results;
  }

  /**
   * Get hierarchy based on view type
   */
  private async getHierarchyByType(trialId: number, viewType: ViewType): Promise<HierarchyNode[]> {
    switch (viewType) {
      case 'session':
        return this.getSessionHierarchy(trialId);
      case 'standard':
        return this.getStandardSequenceHierarchy(trialId);
      case 'objections':
        return this.getObjectionSequences(trialId);
      case 'interactions':
        return this.getJudgeAttorneyInteractions(trialId);
      case 'all':
        // Return all views combined
        const all: HierarchyNode[] = [];
        all.push(...await this.getSessionHierarchy(trialId));
        all.push(...await this.getStandardSequenceHierarchy(trialId));
        all.push(...await this.getObjectionSequences(trialId));
        all.push(...await this.getJudgeAttorneyInteractions(trialId));
        return all;
      default:
        throw new Error(`Unknown view type: ${viewType}`);
    }
  }

  /**
   * Get Session hierarchy (Trial → Sessions)
   */
  private async getSessionHierarchy(trialId: number): Promise<HierarchyNode[]> {
    const trialSection = await this.prisma.markerSection.findFirst({
      where: {
        trialId,
        markerSectionType: MarkerSectionType.TRIAL
      }
    });

    if (!trialSection) {
      return [];
    }

    const sessions = await this.prisma.markerSection.findMany({
      where: {
        trialId,
        markerSectionType: MarkerSectionType.SESSION,
        parentSectionId: trialSection.id
      },
      orderBy: { startEventId: 'asc' }
    });

    const trialNode: HierarchyNode = {
      section: trialSection,
      children: [],
      stats: await this.getSectionStats(trialSection)
    };

    for (const session of sessions) {
      // Get the actual Session record to get sessionHandle
      let enhancedSession = { ...session };
      if (session.metadata && typeof session.metadata === 'object' && 'sessionId' in session.metadata) {
        const sessionId = (session.metadata as any).sessionId;
        const sessionRecord = await this.prisma.session.findUnique({
          where: { id: sessionId }
        });
        
        if (sessionRecord) {
          // Update the name to use sessionHandle
          enhancedSession = {
            ...session,
            name: sessionRecord.sessionHandle
          };
        }
      }
      
      trialNode.children.push({
        section: enhancedSession,
        children: [],
        stats: await this.getSectionStats(enhancedSession)
      });
    }

    return [trialNode];
  }

  /**
   * Get Standard Trial Sequence hierarchy
   */
  private async getStandardSequenceHierarchy(trialId: number): Promise<HierarchyNode[]> {
    const trialSection = await this.prisma.markerSection.findFirst({
      where: {
        trialId,
        markerSectionType: MarkerSectionType.TRIAL
      }
    });

    if (!trialSection) {
      return [];
    }

    // Get all sections for this trial EXCEPT sessions
    const allSections = await this.prisma.markerSection.findMany({
      where: { 
        trialId,
        markerSectionType: {
          not: MarkerSectionType.SESSION
        }
      },
      orderBy: { startEventId: 'asc' }
    });

    // Build hierarchy map
    const sectionMap = new Map<number, HierarchyNode>();
    const rootNodes: HierarchyNode[] = [];

    // Create nodes
    for (const section of allSections) {
      const node: HierarchyNode = {
        section,
        children: [],
        stats: await this.getSectionStats(section)
      };
      sectionMap.set(section.id, node);
    }

    // Build parent-child relationships
    for (const section of allSections) {
      const node = sectionMap.get(section.id)!;
      
      if (section.parentSectionId === null) {
        rootNodes.push(node);
      } else {
        const parent = sectionMap.get(section.parentSectionId);
        if (parent) {
          parent.children.push(node);
        }
      }
    }

    // Sort children by startEventId
    const sortChildren = (node: HierarchyNode) => {
      node.children.sort((a, b) => 
        (a.section.startEventId || 0) - (b.section.startEventId || 0)
      );
      node.children.forEach(sortChildren);
    };

    rootNodes.forEach(sortChildren);

    return rootNodes;
  }

  /**
   * Get Objection Sequences
   */
  private async getObjectionSequences(trialId: number): Promise<HierarchyNode[]> {
    // Get objection results from accumulators (more reliable than markers)
    const objectionResults = await this.prisma.accumulatorResult.findMany({
      where: {
        trialId,
        accumulator: {
          name: {
            in: ['objection_sustained', 'objection_overruled']
          }
        }
      },
      include: {
        accumulator: true
      },
      orderBy: { startEventId: 'asc' }
    });
    
    logger.info(`Found ${objectionResults.length} objection accumulator results`);

    // Filter overlapping results first
    const significantObjections: typeof objectionResults = [];
    let lastEndEventId = 0;
    
    for (const result of objectionResults) {
      // Skip if this overlaps with the previous
      if (result.startEventId <= lastEndEventId) {
        continue;
      }
      significantObjections.push(result);
      lastEndEventId = result.endEventId;
    }
    
    logger.info(`Filtered to ${significantObjections.length} non-overlapping objections`);
    
    // Group objections into sequences (within 10 events gap)
    const sequences: HierarchyNode[] = [];
    let currentSequence: typeof objectionResults = [];
    let lastSequenceEnd = 0;

    for (const objection of significantObjections) {
      if (currentSequence.length === 0) {
        currentSequence = [objection];
        lastSequenceEnd = objection.endEventId;
      } else {
        const gap = objection.startEventId - lastSequenceEnd;
        if (gap <= 10) {
          // Add to current sequence
          currentSequence.push(objection);
          lastSequenceEnd = objection.endEventId;
        } else {
          // Start new sequence
          if (currentSequence.length > 1) {
            sequences.push(await this.createObjectionSequenceNodeFromResults(currentSequence, sequences.length + 1));
          }
          currentSequence = [objection];
          lastSequenceEnd = objection.endEventId;
        }
      }
    }

    // Handle last sequence
    if (currentSequence.length > 1) {
      sequences.push(await this.createObjectionSequenceNodeFromResults(currentSequence, sequences.length + 1));
    }

    // If no sequences found, show individual objections
    if (sequences.length === 0 && significantObjections.length > 0) {
      logger.info(`Found ${significantObjections.length} individual objections (no sequences)`);
      
      // Show first 20 individual objections
      for (const objection of significantObjections.slice(0, 20)) {
        const type = objection.accumulator.name === 'objection_sustained' ? 'SUSTAINED' : 'OVERRULED';
        
        // Get transcript excerpt for individual objection
        const transcriptExcerpt = await this.getTranscriptExcerpt(
          objection.trialId,
          objection.startEventId,
          objection.endEventId,
          5 // Fewer lines for individual objections
        );
        
        const pseudoSection: MarkerSection = {
          id: -objection.id,
          trialId: objection.trialId,
          markerSectionType: MarkerSectionType.CUSTOM,
          name: `Objection ${type}`,
          description: `Events ${objection.startEventId}-${objection.endEventId}`,
          startEventId: objection.startEventId,
          endEventId: objection.endEventId,
          confidence: objection.floatResult,
          source: MarkerSource.PHASE3_DISCOVERY,
          parentSectionId: null,
          startMarkerId: null,
          endMarkerId: null,
          startTime: null,
          endTime: null,
          metadata: objection.metadata,
          text: transcriptExcerpt,
          textTemplate: null,
          elasticSearchId: null,
          llmProvider: null,
          llmModel: null,
          createdAt: objection.createdAt,
          updatedAt: new Date()
        };

        sequences.push({
          section: pseudoSection,
          children: [],
          stats: {
            eventCount: objection.endEventId - objection.startEventId + 1,
            confidence: objection.floatResult || undefined
          }
        });
      }
    }

    return sequences;
  }

  /**
   * Get Judge-Attorney Interactions
   */
  private async getJudgeAttorneyInteractions(trialId: number): Promise<HierarchyNode[]> {
    // Find judge-attorney interaction markers from accumulators
    const allResults = await this.prisma.accumulatorResult.findMany({
      where: {
        trialId,
        accumulator: {
          name: {
            in: ['judge_attorney_interaction', 'opposing_counsel_interaction']
          }
        }
      },
      include: {
        accumulator: true
      },
      orderBy: { startEventId: 'asc' }
    });
    
    // Filter out overlapping windows - only keep non-overlapping significant interactions
    const significantResults: typeof allResults = [];
    let lastEndEventId = 0;
    
    for (const result of allResults) {
      // Skip if this overlaps with the previous significant result
      if (result.startEventId <= lastEndEventId) {
        continue;
      }
      
      // Add this as a significant result
      significantResults.push(result);
      lastEndEventId = result.endEventId;
    }
    
    logger.info(`Filtered ${allResults.length} interactions down to ${significantResults.length} non-overlapping interactions`);

    const nodes: HierarchyNode[] = [];

    for (const result of significantResults) {
      // Get more context about the interaction
      const events = await this.prisma.trialEvent.findMany({
        where: {
          trialId,
          id: {
            gte: result.startEventId,
            lte: result.endEventId
          },
          eventType: 'STATEMENT'
        },
        include: {
          statement: {
            include: {
              speaker: true
            }
          }
        },
        take: 10
      });

      // Identify participants
      const speakers = new Set<string>();
      let hasJudge = false;
      let hasAttorney = false;

      for (const event of events) {
        if (event.statement?.speaker) {
          const speakerType = event.statement.speaker.speakerType;
          const handle = event.statement.speaker.speakerHandle;
          
          speakers.add(handle);
          
          if (speakerType === 'JUDGE') hasJudge = true;
          if (speakerType === 'ATTORNEY') hasAttorney = true;
        }
      }

      const interactionType = result.accumulator.name === 'judge_attorney_interaction'
        ? 'Judge-Attorney'
        : 'Opposing Counsel';

      // Get transcript excerpt for the interaction
      const transcriptExcerpt = await this.getTranscriptExcerpt(
        result.trialId,
        result.startEventId,
        result.endEventId,
        8 // Show 8 lines for interactions
      );

      const pseudoSection: MarkerSection = {
        id: -result.id,
        trialId: result.trialId,
        markerSectionType: MarkerSectionType.CUSTOM,
        name: `${interactionType} Interaction`,
        description: `${speakers.size} participants: ${Array.from(speakers).join(', ')}`,
        startEventId: result.startEventId,
        endEventId: result.endEventId,
        confidence: result.floatResult || 0.8,
        source: MarkerSource.PHASE3_DISCOVERY,
        parentSectionId: null,
        startMarkerId: null,
        endMarkerId: null,
        startTime: null,
        endTime: null,
        metadata: result.metadata,
        text: transcriptExcerpt,
        textTemplate: null,
        elasticSearchId: null,
        llmProvider: null,
        llmModel: null,
        createdAt: result.createdAt,
        updatedAt: new Date()
      };

      nodes.push({
        section: pseudoSection,
        children: [],
        stats: {
          eventCount: result.endEventId - result.startEventId + 1,
          confidence: result.floatResult || 0.8,
          speakerCount: speakers.size
        }
      });
    }

    return nodes;
  }

  /**
   * Create a node for an objection sequence from AccumulatorResults
   */
  private async createObjectionSequenceNodeFromResults(
    objections: any[], 
    sequenceNum: number
  ): Promise<HierarchyNode> {
    const firstObj = objections[0];
    const lastObj = objections[objections.length - 1];

    // Count rulings
    const sustainedCount = objections.filter(o => 
      o.accumulator.name === 'objection_sustained'
    ).length;
    const overruledCount = objections.filter(o => 
      o.accumulator.name === 'objection_overruled'
    ).length;

    // Get transcript excerpt
    const transcriptExcerpt = await this.getTranscriptExcerpt(
      firstObj.trialId,
      firstObj.startEventId,
      lastObj.endEventId,
      15 // Get up to 15 lines
    );

    const pseudoSection: MarkerSection = {
      id: -sequenceNum,
      trialId: firstObj.trialId,
      markerSectionType: MarkerSectionType.CUSTOM,
      name: `Objection Sequence ${sequenceNum}`,
      description: `${objections.length} objections (SUSTAINED: ${sustainedCount}, OVERRULED: ${overruledCount})`,
      startEventId: firstObj.startEventId,
      endEventId: lastObj.endEventId,
      confidence: 0.9,
      source: MarkerSource.PHASE3_DISCOVERY,
      parentSectionId: null,
      startMarkerId: null,
      endMarkerId: null,
      startTime: null,
      endTime: null,
      metadata: {
        objectionCount: objections.length,
        sustained: sustainedCount,
        overruled: overruledCount
      },
      text: transcriptExcerpt,
      textTemplate: null,
      elasticSearchId: null,
      llmProvider: null,
      llmModel: null,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    return {
      section: pseudoSection,
      children: [],
      stats: {
        eventCount: lastObj.endEventId - firstObj.startEventId + 1,
        confidence: 0.9
      }
    };
  }

  /**
   * Get transcript text for an event range
   */
  private async getTranscriptExcerpt(
    trialId: number, 
    startEventId: number, 
    endEventId: number,
    maxLines: number = 10
  ): Promise<string> {
    const events = await this.prisma.trialEvent.findMany({
      where: {
        trialId,
        id: {
          gte: startEventId,
          lte: endEventId
        },
        eventType: 'STATEMENT'
      },
      include: {
        statement: {
          include: {
            speaker: true
          }
        }
      },
      orderBy: { ordinal: 'asc' },
      take: maxLines
    });
    
    const lines: string[] = [];
    for (const event of events) {
      if (event.statement?.speaker && event.statement?.text) {
        const speaker = event.statement.speaker.speakerHandle || 'UNKNOWN';
        const text = event.statement.text;
        lines.push(`${speaker}: ${text}`);
      }
    }
    
    if (lines.length === 0) {
      return '[No transcript available]';
    }
    
    const excerpt = lines.join('\n');
    const eventCount = endEventId - startEventId + 1;
    const summary = `\n...\n[${eventCount} events total]`;
    
    return excerpt + (lines.length < eventCount ? summary : '');
  }

  /**
   * Get statistics for a section
   */
  private async getSectionStats(section: MarkerSection): Promise<any> {
    if (!section.startEventId || !section.endEventId) {
      return {};
    }

    const eventCount = await this.prisma.trialEvent.count({
      where: {
        trialId: section.trialId,
        id: {
          gte: section.startEventId,
          lte: section.endEventId
        }
      }
    });

    // Get speaker count
    const speakers = await this.prisma.trialEvent.findMany({
      where: {
        trialId: section.trialId,
        id: {
          gte: section.startEventId,
          lte: section.endEventId
        },
        eventType: 'STATEMENT'
      },
      include: {
        statement: {
          select: {
            speakerId: true
          }
        }
      }
    });

    const uniqueSpeakers = new Set(
      speakers
        .map(s => s.statement?.speakerId)
        .filter((id): id is number => id !== null && id !== undefined)
    );

    return {
      eventCount,
      confidence: section.confidence,
      speakerCount: uniqueSpeakers.size
    };
  }

  /**
   * Calculate hierarchy metadata
   */
  private calculateHierarchyMetadata(nodes: HierarchyNode[]): { nodeCount: number; maxDepth: number } {
    let nodeCount = 0;
    let maxDepth = 0;

    const traverse = (node: HierarchyNode, depth: number) => {
      nodeCount++;
      maxDepth = Math.max(maxDepth, depth);
      for (const child of node.children) {
        traverse(child, depth + 1);
      }
    };

    for (const node of nodes) {
      traverse(node, 1);
    }

    return { nodeCount, maxDepth };
  }
}