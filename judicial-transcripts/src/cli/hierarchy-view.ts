#!/usr/bin/env node

import { PrismaClient, MarkerSection, MarkerSectionType, Marker, MarkerType, MarkerSource } from '@prisma/client';
import { Logger } from '../utils/logger';
import { TranscriptRenderer } from '../services/TranscriptRenderer';
import { program } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { generateFileToken } from '../utils/fileTokenGenerator';
import stripAnsi from 'strip-ansi';

// Helper function to decode HTML entities
function decodeHtmlEntities(text: string): string {
  if (!text) return text;
  return text
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (match, dec) => String.fromCharCode(dec))
    .replace(/&#x([0-9A-Fa-f]+);/g, (match, hex) => String.fromCharCode(parseInt(hex, 16)));
}

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
  trial?: number;
  view?: ViewType;
  format?: OutputFormat;
  output?: string;
  all?: boolean;
  allTrials?: boolean;
  verbose?: boolean;
}

class HierarchyViewer {
  private renderer: TranscriptRenderer;
  
  constructor(private prisma: PrismaClient) {
    this.renderer = new TranscriptRenderer(prisma);
  }

  /**
   * Main entry point for viewing hierarchies
   */
  async viewHierarchy(options: ViewOptions) {
    // If trial ID is provided, run for single trial
    if (options.trial) {
      const trial = await this.prisma.trial.findUnique({
        where: { id: options.trial }
      });

      if (!trial) {
        throw new Error(`Trial ${options.trial} not found`);
      }

      await this.processTrialHierarchy(trial, options);
    } else {
      // Run for all trials
      await this.processAllTrialsHierarchy(options);
    }
  }

  /**
   * Process hierarchy for all trials
   */
  private async processAllTrialsHierarchy(options: ViewOptions) {
    const trials = await this.prisma.trial.findMany({
      orderBy: { id: 'asc' }
    });

    if (trials.length === 0) {
      logger.warn('No trials found in database');
      return;
    }

    logger.info(`Processing hierarchy views for ${trials.length} trials...`);

    // Default output directory
    const baseOutputDir = options.output || './output/hierview';
    
    // Ensure output directory exists
    if (!fs.existsSync(baseOutputDir)) {
      fs.mkdirSync(baseOutputDir, { recursive: true });
    }

    const viewTypes = ['standard', 'session', 'objections', 'interactions'] as ViewType[];
    const formats = ['json', 'text'] as OutputFormat[];

    for (const trial of trials) {
      logger.info(`\nProcessing trial: ${trial.name || trial.caseNumber}`);
      
      // Calculate shortNameHandle if not stored
      const shortNameHandle = trial.shortNameHandle || 
        (trial.shortName ? generateFileToken(trial.shortName) : generateFileToken(trial.name));
      
      for (const viewType of viewTypes) {
        for (const format of formats) {
          const viewSuffix = this.getViewSuffix(viewType);
          const extension = format === 'json' ? 'json' : 'txt';
          const outputFile = path.join(baseOutputDir, `${shortNameHandle}${viewSuffix}.${extension}`);
          
          logger.info(`  Generating ${viewType} view in ${format} format...`);
          
          try {
            await this.generateSingleView(trial, viewType, format, outputFile);
          } catch (error) {
            logger.error(`  Failed to generate ${viewType} view for trial ${trial.id}: ${error}`);
          }
        }
      }
    }

    logger.info(`\nCompleted processing all trials. Output saved to: ${baseOutputDir}`);
  }

  /**
   * Get suffix for view type
   */
  private getViewSuffix(viewType: ViewType): string {
    switch (viewType) {
      case 'standard': return '_std';
      case 'session': return '_sess';
      case 'objections': return '_obj';
      case 'interactions': return '_int';
      default: return '_unknown';
    }
  }

  /**
   * Generate a single view for a trial
   */
  private async generateSingleView(
    trial: any,
    viewType: ViewType,
    format: OutputFormat,
    outputFile: string
  ) {
    const hierarchy = await this.getHierarchyByType(trial.id, viewType);

    // Debug: Check if hierarchy is empty
    if (!hierarchy || hierarchy.length === 0) {
      logger.warn(`Empty hierarchy for trial ${trial.id} view ${viewType}`);
    }

    if (format === 'json') {
      const output = JSON.stringify({
        trial: {
          id: trial.id,
          name: trial.name,
          shortName: trial.shortName,
          caseNumber: trial.caseNumber
        },
        viewType,
        hierarchy
      }, null, 2);
      fs.writeFileSync(outputFile, output);
    } else {
      // Text format - capture console output
      const originalLog = console.log;
      const output: string[] = [];

      // Override console.log to capture output
      console.log = (...args: any[]) => {
        const line = args.map(arg =>
          typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
        ).join(' ');
        output.push(line);
      };

      try {
        this.printHierarchy(hierarchy, viewType, trial.name || trial.caseNumber);
      } finally {
        // Always restore console.log
        console.log = originalLog;
      }

      // Strip ANSI color codes when writing to file
      const cleanOutput = output.map(line => stripAnsi(line)).join('\n');
      fs.writeFileSync(outputFile, cleanOutput);
    }
  }

  /**
   * Process hierarchy for a single trial
   */
  private async processTrialHierarchy(trial: any, options: ViewOptions) {
    logger.info(`Viewing hierarchy for: ${trial.name || trial.caseNumber}`);

    const views = options.all 
      ? ['session', 'standard', 'objections', 'interactions'] as ViewType[]
      : [options.view || 'standard'];

    const results: any = {};

    for (const view of views) {
      logger.info(`Generating ${view} view...`);
      const hierarchy = await this.getHierarchyByType(trial.id, view);
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
      // Strip ANSI color codes when writing to file
      const cleanOutput = output.map(line => stripAnsi(line)).join('\n');
      fs.writeFileSync(options.output, cleanOutput);
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
        } else {
          // Orphaned node - this shouldn't happen in a proper hierarchy
          logger.warn(`Orphaned section found: ${section.name} (id: ${section.id}, parentId: ${section.parentSectionId})`);
          // Don't add orphaned nodes to root - they should have parents
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
    
    // Show individual objections (no grouping into sequences)
    const sequences: HierarchyNode[] = [];

    if (significantObjections.length > 0) {
      logger.info(`Found ${significantObjections.length} individual objections (no sequences)`);
      
      // Show first 20 individual objections
      for (const objection of significantObjections.slice(0, 20)) {
        const type = objection.accumulator.name === 'objection_sustained' ? 'SUSTAINED' : 'OVERRULED';
        const accumulatorName = (objection.metadata as any)?.accumulatorName || objection.accumulator.name;

        // Get transcript excerpt for individual objection
        // Use windowSize from metadata or default to 7
        const windowSize = (objection.metadata as any)?.windowSize || 7;
        const transcriptExcerpt = await this.getTranscriptExcerpt(
          objection.trialId,
          objection.startEventId,
          objection.endEventId,
          windowSize // Use actual window size
        );

        const pseudoSection: MarkerSection = {
          id: -objection.id,
          trialId: objection.trialId,
          markerSectionType: MarkerSectionType.CUSTOM,
          name: `Objection ${type}`,
          description: `Events ${objection.startEventId}-${objection.endEventId} (via ${accumulatorName}),`,
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

    // Get accumulator names
    const accumulatorNames = [...new Set(objections.map(o => (o.metadata as any)?.accumulatorName || o.accumulator.name))];

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
      description: `${objections.length} objections (SUSTAINED: ${sustainedCount}, OVERRULED: ${overruledCount}) via ${accumulatorNames.join(', ')}`,
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
      const accumulatorName = (result.metadata as any)?.accumulatorName || result.accumulator.name;

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
        description: `${speakers.size} participants: ${Array.from(speakers).join(', ')} (via ${accumulatorName}),`,
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
      orderBy: { id: 'asc' },  // Use id for proper ordering
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

    // Get speaker count and word count
    const statements = await this.prisma.trialEvent.findMany({
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
            speakerId: true,
            text: true
          }
        }
      }
    });

    const uniqueSpeakers = new Set(
      statements
        .map(s => s.statement?.speakerId)
        .filter((id): id is number => id !== null && id !== undefined)
    );

    // Calculate word count from all statement texts
    let wordCount = 0;
    for (const event of statements) {
      if (event.statement?.text) {
        // Count words by splitting on whitespace and filtering empty strings
        const words = event.statement.text.trim().split(/\s+/).filter(word => word.length > 0);
        wordCount += words.length;
      }
    }

    return {
      eventCount,
      confidence: section.confidence,
      speakerCount: uniqueSpeakers.size,
      wordCount
    };
  }

  /**
   * Print hierarchy to console
   */
  private printHierarchy(nodes: HierarchyNode[], viewType: string, trialName: string) {
    const decodedTrialName = decodeHtmlEntities(trialName);
    console.log(`\n${viewType.toUpperCase()} HIERARCHY: ${decodedTrialName}\n`);

    if (!nodes || nodes.length === 0) {
      console.log('(No hierarchy data available)');
      return;
    }

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
    
    // Decode HTML entities in the name
    const sectionName = decodeHtmlEntities(section.name || 'Unnamed');
    let info = `${indent}${prefix}${typeName}: ${sectionName}`;
    
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
      if (node.stats.wordCount) {
        // Format word count with thousands separator
        const formattedWords = node.stats.wordCount.toLocaleString();
        statsInfo.push(`${formattedWords} words`);
      }
      
      if (statsInfo.length > 0) {
        info += chalk.cyan(` (${statsInfo.join(', ')})`);
      }
    }
    
    console.log(info);
    
    // Add summary preview or full text based on section type
    if (section.text) {
      // Decode HTML entities in the text
      const decodedText = decodeHtmlEntities(section.text);
      
      // For objections and interactions (CUSTOM sections), show more of the transcript
      if (section.markerSectionType === 'CUSTOM') {
        console.log(chalk.gray(`${indent}  --- Transcript ---`));
        const lines = decodedText.split('\n');
        for (const line of lines.slice(0, 20)) { // Show up to 20 lines
          console.log(chalk.gray(`${indent}  ${line}`));
        }
        if (lines.length > 20) {
          console.log(chalk.gray(`${indent}  [... ${lines.length - 20} more lines]`));
        }
      } else {
        // For regular sections, show just the preview
        const summaryLines = decodedText.split('\n');
        const preview = summaryLines[0].substring(0, 80);
        console.log(chalk.gray(`${indent}  "${preview}${preview.length >= 80 ? '...' : ''}"`));
      }
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
  .option('-t, --trial <id>', 'Trial ID to view (if not provided, runs for all trials)', parseInt)
  .option('-v, --view <type>', 'View type: session, standard, objections, interactions', 'standard')
  .option('-a, --all', 'Show all hierarchy views')
  .option('-f, --format <format>', 'Output format: text or json', 'text')
  .option('-o, --output <path>', 'Output directory or file path (default: ./output/hierview for all trials)')
  .option('--verbose', 'Show detailed information')
  .option('--no-color', 'Disable colored output')
  .action(async (options) => {
    try {
      // Disable chalk colors if --no-color is specified
      if (options.noColor === false) {
        chalk.level = 0;
      }
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