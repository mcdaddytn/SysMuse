#!/usr/bin/env node

import { PrismaClient, MarkerSection, MarkerSectionType, Marker, MarkerType, MarkerSource } from '@prisma/client';
import { Logger } from '../utils/logger';
import { program } from 'commander';
import * as fs from 'fs';
import chalk from 'chalk';

const prisma = new PrismaClient();
const logger = new Logger('HierarchyView');

type ViewType = 'session' | 'standard' | 'objections' | 'interactions' | 'all';
type OutputFormat = 'text' | 'json';

interface HierarchyNode {
  section: MarkerSection;
  children: HierarchyNode[];
  stats?: {
    eventCount?: number;
    confidence?: number;
    speakerCount?: number;
    wordCount?: number;
  };
}

interface ViewOptions {
  trial: number;
  view: ViewType;
  format?: OutputFormat;
  output?: string;
  all?: boolean;
  verbose?: boolean;
}

class HierarchyViewer {
  constructor(private prisma: PrismaClient) {}

  /**
   * Main entry point for viewing hierarchies
   */
  async viewHierarchy(options: ViewOptions) {
    const trial = await this.prisma.trial.findUnique({
      where: { id: options.trial }
    });

    if (!trial) {
      throw new Error(`Trial ${options.trial} not found`);
    }

    logger.info(`Viewing hierarchy for: ${trial.name || trial.caseNumber}`);

    const views = options.all 
      ? ['session', 'standard', 'objections', 'interactions'] as ViewType[]
      : [options.view];

    const results: any = {};

    for (const view of views) {
      logger.info(`Generating ${view} view...`);
      const hierarchy = await this.getHierarchyByType(options.trial, view);
      results[view] = hierarchy;

      if (options.format === 'json') {
        // Store for JSON output
        continue;
      } else {
        // Print to console
        this.printHierarchy(hierarchy, view, trial.name || trial.caseNumber);
        console.log('\n' + '='.repeat(80) + '\n');
      }
    }

    // Handle output
    if (options.format === 'json') {
      const output = JSON.stringify(results, null, 2);
      if (options.output) {
        fs.writeFileSync(options.output, output);
        logger.info(`JSON output saved to ${options.output}`);
      } else {
        console.log(output);
      }
    } else if (options.output) {
      // Text output to file
      const originalLog = console.log;
      const output: string[] = [];
      console.log = (...args) => output.push(args.join(' '));
      
      for (const view of views) {
        this.printHierarchy(results[view], view, trial.name || trial.caseNumber);
        output.push('\n' + '='.repeat(80) + '\n');
      }
      
      console.log = originalLog;
      fs.writeFileSync(options.output, output.join('\n'));
      logger.info(`Text output saved to ${options.output}`);
    }
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
      trialNode.children.push({
        section: session,
        children: [],
        stats: await this.getSectionStats(session)
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
        const pseudoSection: MarkerSection = {
          id: -objection.id,
          trialId: objection.trialId,
          markerSectionType: MarkerSectionType.CUSTOM,
          name: `Objection ${type} at events ${objection.startEventId}-${objection.endEventId}`,
          description: null,
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
          text: type,
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

    const pseudoSection: MarkerSection = {
      id: -sequenceNum,
      trialId: firstObj.trialId,
      markerSectionType: MarkerSectionType.CUSTOM,
      name: `Objection Sequence ${sequenceNum}`,
      description: `${objections.length} objections`,
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
      text: `SUSTAINED: ${sustainedCount}, OVERRULED: ${overruledCount}`,
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
   * Create a node for an objection sequence (OLD - for Marker based)
   */
  private async createObjectionSequenceNode(objections: Marker[], sequenceNum: number): Promise<HierarchyNode> {
    const firstObj = objections[0];
    const lastObj = objections[objections.length - 1];

    // Get context (which witness, which attorney)
    const contextEvent = await this.prisma.trialEvent.findFirst({
      where: {
        trialId: firstObj.trialId,
        id: firstObj.eventId || 0
      },
      include: {
        statement: {
          include: {
            speaker: true
          }
        }
      }
    });

    let context = '';
    if (contextEvent?.statement?.speaker) {
      context = `by ${contextEvent.statement.speaker.speakerHandle}`;
    }

    // Count rulings
    const sustainedCount = objections.filter(o => 
      o.description?.toLowerCase().includes('sustained')
    ).length;
    const overruledCount = objections.filter(o => 
      o.description?.toLowerCase().includes('overruled')
    ).length;

    const pseudoSection: MarkerSection = {
      id: -sequenceNum,
      trialId: firstObj.trialId,
      markerSectionType: MarkerSectionType.CUSTOM,
      name: `Objection Sequence ${sequenceNum}`,
      description: `${objections.length} objections ${context}`,
      startEventId: firstObj.eventId,
      endEventId: lastObj.eventId,
      confidence: 0.9,
      source: firstObj.source,
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
      text: `SUSTAINED: ${sustainedCount}, OVERRULED: ${overruledCount}`,
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
        eventCount: (lastObj.eventId || 0) - (firstObj.eventId || 0) + 1,
        confidence: 0.9
      }
    };
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
        text: null,
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
   * Print hierarchy to console
   */
  private printHierarchy(nodes: HierarchyNode[], viewType: string, trialName: string) {
    console.log(chalk.bold.blue(`\n${viewType.toUpperCase()} HIERARCHY: ${trialName}\n`));
    
    for (const node of nodes) {
      this.printNode(node, 0);
    }
  }

  /**
   * Print a single node and its children
   */
  private printNode(node: HierarchyNode, depth: number) {
    const indent = '  '.repeat(depth);
    const prefix = depth === 0 ? '' : '├─ ';
    
    // Format section info
    const section = node.section;
    const typeColor = this.getColorForType(section.markerSectionType);
    const typeName = typeColor(section.markerSectionType);
    
    let info = `${indent}${prefix}${typeName}: ${section.name || 'Unnamed'}`;
    
    // Add event range
    if (section.startEventId && section.endEventId) {
      info += chalk.gray(` [${section.startEventId}-${section.endEventId}]`);
    }
    
    // Add stats
    if (node.stats) {
      const statsInfo = [];
      if (node.stats.eventCount) {
        statsInfo.push(`${node.stats.eventCount} events`);
      }
      if (node.stats.confidence) {
        statsInfo.push(`conf: ${(node.stats.confidence * 100).toFixed(0)}%`);
      }
      if (node.stats.speakerCount) {
        statsInfo.push(`${node.stats.speakerCount} speakers`);
      }
      
      if (statsInfo.length > 0) {
        info += chalk.cyan(` (${statsInfo.join(', ')})`);
      }
    }
    
    console.log(info);
    
    // Add summary preview if available
    if (section.text) {
      const summaryLines = section.text.split('\n');
      const preview = summaryLines[0].substring(0, 80);
      console.log(chalk.gray(`${indent}  "${preview}${preview.length >= 80 ? '...' : ''}"`));
    }
    
    // Print children
    for (const child of node.children) {
      this.printNode(child, depth + 1);
    }
  }

  /**
   * Get color for section type
   */
  private getColorForType(type: string): any {
    switch (type) {
      case 'TRIAL': return chalk.bold.magenta;
      case 'SESSION': return chalk.bold.green;
      case 'OPENING_STATEMENTS_PERIOD':
      case 'OPENING_STATEMENT_PLAINTIFF':
      case 'OPENING_STATEMENT_DEFENSE':
        return chalk.yellow;
      case 'WITNESS_TESTIMONY_PERIOD':
      case 'WITNESS_TESTIMONY':
      case 'WITNESS_EXAMINATION':
        return chalk.blue;
      case 'CLOSING_STATEMENTS_PERIOD':
      case 'CLOSING_STATEMENT_PLAINTIFF':
      case 'CLOSING_STATEMENT_DEFENSE':
        return chalk.yellow;
      case 'JURY_SELECTION':
      case 'JURY_DELIBERATION':
      case 'JURY_VERDICT':
        return chalk.magenta;
      case 'CUSTOM':
        return chalk.cyan;
      default:
        return chalk.white;
    }
  }
}

// CLI setup
program
  .name('hierarchy-view')
  .description('View MarkerSection hierarchies for trials')
  .requiredOption('-t, --trial <id>', 'Trial ID to view', parseInt)
  .option('-v, --view <type>', 'View type: session, standard, objections, interactions', 'standard')
  .option('-a, --all', 'Show all hierarchy views')
  .option('-f, --format <format>', 'Output format: text or json', 'text')
  .option('-o, --output <file>', 'Output to file instead of console')
  .option('--verbose', 'Show detailed information')
  .action(async (options) => {
    try {
      const viewer = new HierarchyViewer(prisma);
      await viewer.viewHierarchy(options);
    } catch (error) {
      logger.error('Error viewing hierarchy:', error);
      process.exit(1);
    } finally {
      await prisma.$disconnect();
    }
  });

program.parse(process.argv);