import {
  PrismaClient,
  TrialEvent,
  StatementEvent,
  Speaker,
  Attorney,
  AttorneyRole
} from '@prisma/client';
import { Logger } from '../utils/logger';

export interface LongStatementParams {
  trialId: number;
  speakerType: 'ATTORNEY' | 'WITNESS' | 'JUDGE';
  attorneyRole?: 'PLAINTIFF' | 'DEFENDANT';
  searchStartEvent?: number;
  searchEndEvent?: number;
  minWords: number;
  maxInterruptionRatio: number;
  ratioMode?: 'TRADITIONAL' | 'WEIGHTED_SQRT' | 'WEIGHTED_SQRT2' | 'WEIGHTED_SQRT3' | 'SMART_EXTEND' | 'TEAM_AGGREGATE';
  ratioThreshold?: number;
  aggregateTeam?: boolean; // Aggregate all attorneys on the same side
}

export interface StatementResult {
  startEvent: TrialEvent;
  endEvent: TrialEvent;
  totalWords: number;
  speakerWords: number;
  interruptionWords: number;
  speakerRatio: number;
  confidence: number;
  metadata?: {
    primarySpeaker?: string;
    teamSpeakers?: string[];
    searchStrategy?: string;
  };
}

interface SpeakerBlock {
  startEvent: TrialEvent;
  endEvent: TrialEvent;
  events: any[];
  primarySpeaker: string;
  teamSpeakers?: Set<string>; // All speakers from the same team
  totalWords: number;
  speakerWords: number;
  ratio: number;
}

export class LongStatementsAccumulatorV2 {
  private logger = new Logger('LongStatementsAccumulatorV2');
  private teamAttorneyCache: Map<string, Set<string>> = new Map();

  constructor(private prisma: PrismaClient) {}

  /**
   * Find the longest continuous statement by a speaker or speaker type
   * Now supports team aggregation for split arguments
   */
  async findLongestStatement(params: LongStatementParams): Promise<StatementResult | null> {
    this.logger.info(`Finding longest statement for ${params.speakerType} ${params.attorneyRole || ''} in trial ${params.trialId}`);
    this.logger.info(`Search range: events ${params.searchStartEvent || 'start'} to ${params.searchEndEvent || 'end'}`);
    this.logger.info(`Min words: ${params.minWords}, Max interruption ratio: ${params.maxInterruptionRatio}`);
    this.logger.info(`Aggregate team: ${params.aggregateTeam}, Ratio mode: ${params.ratioMode}`);

    // Pre-load team attorneys if aggregating
    if (params.aggregateTeam && params.attorneyRole) {
      await this.loadTeamAttorneys(params.trialId, params.attorneyRole);
    }

    // Try multiple strategies in order of preference
    const strategies = [
      { name: 'high-word-team', fn: () => this.findByHighWordTeamApproach(params) },
      { name: 'high-word-individual', fn: () => this.findByHighWordCountApproach(params) },
      { name: 'traditional', fn: () => this.findByTraditionalApproach(params) }
    ];

    for (const strategy of strategies) {
      this.logger.info(`Trying strategy: ${strategy.name}`);
      const result = await strategy.fn();

      if (result && result.confidence > 0.5) {
        this.logger.info(`Found statement with ${strategy.name} strategy: confidence ${result.confidence}`);
        if (result.metadata) {
          result.metadata.searchStrategy = strategy.name;
        } else {
          result.metadata = { searchStrategy: strategy.name };
        }
        return result;
      }
    }

    this.logger.info('No qualifying statement found with any strategy');
    return null;
  }

  /**
   * Load all attorneys for a given team/role
   */
  private async loadTeamAttorneys(trialId: number, role: AttorneyRole | string): Promise<Set<string>> {
    const cacheKey = `${trialId}-${role}`;

    if (this.teamAttorneyCache.has(cacheKey)) {
      return this.teamAttorneyCache.get(cacheKey)!;
    }

    const attorneys = await this.prisma.trialAttorney.findMany({
      where: {
        trialId,
        role: role as AttorneyRole
      },
      include: {
        attorney: true,
        speaker: true
      }
    });

    const teamHandles = new Set<string>();

    for (const ta of attorneys) {
      // Add speaker handle if available
      if (ta.speaker?.speakerHandle) {
        teamHandles.add(ta.speaker.speakerHandle);
      }

      // Also add variations based on attorney name
      if (ta.attorney.name) {
        const lastName = ta.attorney.lastName || ta.attorney.name.split(' ').pop() || '';
        teamHandles.add(`MR. ${lastName.toUpperCase()}`);
        teamHandles.add(`MS. ${lastName.toUpperCase()}`);
        teamHandles.add(`MR_${lastName.toUpperCase()}`);
        teamHandles.add(`MS_${lastName.toUpperCase()}`);
        teamHandles.add(lastName.toUpperCase());
      }
    }

    this.teamAttorneyCache.set(cacheKey, teamHandles);
    this.logger.info(`Loaded ${teamHandles.size} speaker handles for ${role}: ${Array.from(teamHandles).join(', ')}`);

    return teamHandles;
  }

  /**
   * Find statements using high word count events with team aggregation
   */
  private async findByHighWordTeamApproach(params: LongStatementParams): Promise<StatementResult | null> {
    if (!params.aggregateTeam || !params.attorneyRole) {
      return null; // This approach only works with team aggregation
    }

    const teamHandles = await this.loadTeamAttorneys(params.trialId, params.attorneyRole);

    // Find high word count events from ANY team member
    const whereClause: any = {
      trialId: params.trialId,
      eventType: 'STATEMENT',
      wordCount: { gte: 300 } // Lower threshold for team aggregation
    };

    if (params.searchStartEvent) {
      whereClause.id = { ...whereClause.id, gte: params.searchStartEvent };
    }
    if (params.searchEndEvent) {
      whereClause.id = { ...whereClause.id, lte: params.searchEndEvent };
    }

    const events = await this.prisma.trialEvent.findMany({
      where: whereClause,
      include: {
        statement: {
          include: {
            speaker: true
          }
        }
      },
      orderBy: { id: 'asc' }
    });

    // Filter by team members
    const teamEvents = events.filter(e => {
      const handle = e.statement?.speaker?.speakerHandle;
      return handle && this.isTeamMember(handle, teamHandles);
    });

    if (teamEvents.length === 0) {
      return null;
    }

    // Group into coherent blocks allowing team transitions
    const blocks = await this.groupTeamEvents(teamEvents, params, teamHandles);

    if (blocks.length === 0) {
      return null;
    }

    // Sort by total team words
    blocks.sort((a, b) => b.speakerWords - a.speakerWords);
    const best = blocks[0];

    this.logger.info(`Best team block: ${best.speakerWords} words from events ${best.startEvent.id}-${best.endEvent.id}`);
    this.logger.info(`Team speakers involved: ${Array.from(best.teamSpeakers || []).join(', ')}`);

    return {
      startEvent: best.startEvent,
      endEvent: best.endEvent,
      totalWords: best.totalWords,
      speakerWords: best.speakerWords,
      interruptionWords: best.totalWords - best.speakerWords,
      speakerRatio: best.speakerRatio,
      confidence: this.calculateConfidence(best.speakerRatio, best.speakerWords, params),
      metadata: {
        primarySpeaker: best.primarySpeaker || undefined,
        teamSpeakers: Array.from(best.teamSpeakers || [])
      }
    };
  }

  /**
   * Find statements using high word count events (individual approach)
   */
  private async findByHighWordCountApproach(params: LongStatementParams): Promise<StatementResult | null> {
    const whereClause: any = {
      trialId: params.trialId,
      eventType: 'STATEMENT',
      wordCount: { gte: 500 }
    };

    if (params.searchStartEvent) {
      whereClause.id = { ...whereClause.id, gte: params.searchStartEvent };
    }
    if (params.searchEndEvent) {
      whereClause.id = { ...whereClause.id, lte: params.searchEndEvent };
    }

    const events = await this.prisma.trialEvent.findMany({
      where: whereClause,
      include: {
        statement: {
          include: {
            speaker: true
          }
        }
      },
      orderBy: { wordCount: 'desc' },
      take: 20
    });

    const filtered = await this.filterEventsBySpeakerType(events, params);

    if (filtered.length === 0) {
      return null;
    }

    const blocks = await this.groupHighWordEvents(filtered, params);

    if (blocks.length === 0) {
      return null;
    }

    blocks.sort((a, b) => b.speakerWords - a.speakerWords);
    const best = blocks[0];

    return {
      startEvent: best.startEvent,
      endEvent: best.endEvent,
      totalWords: best.totalWords,
      speakerWords: best.speakerWords,
      interruptionWords: best.totalWords - best.speakerWords,
      speakerRatio: best.speakerRatio,
      confidence: this.calculateConfidence(best.speakerRatio, best.speakerWords, params)
    };
  }

  /**
   * Check if a speaker handle belongs to a team
   */
  private isTeamMember(handle: string, teamHandles: Set<string>): boolean {
    // Direct match
    if (teamHandles.has(handle)) {
      return true;
    }

    // Check if handle contains any team member name
    const handleUpper = handle.toUpperCase();
    for (const teamHandle of teamHandles) {
      if (handleUpper.includes(teamHandle) || teamHandle.includes(handleUpper)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Group team events into coherent blocks
   */
  private async groupTeamEvents(
    events: any[],
    params: LongStatementParams,
    teamHandles: Set<string>
  ): Promise<any[]> {
    const blocks: any[] = [];

    // Sort events by ID
    events.sort((a, b) => a.id - b.id);

    // Group nearby events (within 20 events)
    let currentBlock: any[] = [];

    for (const event of events) {
      if (currentBlock.length === 0) {
        currentBlock = [event];
      } else {
        const lastEvent = currentBlock[currentBlock.length - 1];
        if (event.id - lastEvent.id <= 20) {
          currentBlock.push(event);
        } else {
          // Process current block
          const block = await this.createTeamBlockFromEvents(currentBlock, params, teamHandles);
          if (block) blocks.push(block);
          currentBlock = [event];
        }
      }
    }

    // Process last block
    if (currentBlock.length > 0) {
      const block = await this.createTeamBlockFromEvents(currentBlock, params, teamHandles);
      if (block) blocks.push(block);
    }

    return blocks;
  }

  /**
   * Create a statement result from team events
   */
  private async createTeamBlockFromEvents(
    blockEvents: any[],
    params: LongStatementParams,
    teamHandles: Set<string>
  ): Promise<StatementResult | null> {
    if (blockEvents.length === 0) return null;

    const startId = blockEvents[0].id;
    let endId = blockEvents[blockEvents.length - 1].id;

    // Determine primary speaker (most words in block)
    const speakerWords = new Map<string, number>();
    for (const event of blockEvents) {
      const handle = event.statement?.speaker?.speakerHandle;
      if (handle) {
        speakerWords.set(handle, (speakerWords.get(handle) || 0) + (event.wordCount || 0));
      }
    }

    let primarySpeaker = '';
    let maxWords = 0;
    for (const [speaker, words] of speakerWords) {
      if (words > maxWords) {
        maxWords = words;
        primarySpeaker = speaker;
      }
    }

    // Try to extend the block to include continuation from team members
    endId = await this.extendBlockForTeam(params.trialId, endId, teamHandles, params);

    // Get all events in range
    const allEvents = await this.prisma.trialEvent.findMany({
      where: {
        trialId: params.trialId,
        id: { gte: startId, lte: endId }
      },
      include: {
        statement: {
          include: { speaker: true }
        }
      },
      orderBy: { id: 'asc' }
    });

    // Calculate words
    let totalWords = 0;
    let teamWords = 0;
    const teamSpeakers = new Set<string>();

    for (const event of allEvents) {
      const words = event.wordCount || 0;
      totalWords += words;

      const handle = event.statement?.speaker?.speakerHandle;
      if (handle && this.isTeamMember(handle, teamHandles)) {
        teamWords += words;
        teamSpeakers.add(handle);
      }
    }

    const ratio = this.calculateTeamRatio(allEvents, teamHandles, params);
    const threshold = params.ratioThreshold || (1 - params.maxInterruptionRatio);

    if (ratio < threshold) {
      return null;
    }

    return {
      startEvent: allEvents[0],
      endEvent: allEvents[allEvents.length - 1],
      totalWords,
      speakerWords: teamWords,
      interruptionWords: totalWords - teamWords,
      speakerRatio: ratio,
      confidence: this.calculateConfidence(ratio, teamWords, params),
      metadata: {
        primarySpeaker,
        teamSpeakers: Array.from(teamSpeakers)
      }
    };
  }

  /**
   * Extend block to include team member continuations
   */
  private async extendBlockForTeam(
    trialId: number,
    currentEndId: number,
    teamHandles: Set<string>,
    params: LongStatementParams
  ): Promise<number> {
    // Look ahead up to 30 events
    const lookAheadEvents = await this.prisma.trialEvent.findMany({
      where: {
        trialId,
        id: {
          gt: currentEndId,
          lte: currentEndId + 30
        },
        eventType: 'STATEMENT'
      },
      include: {
        statement: {
          include: { speaker: true }
        }
      },
      orderBy: { id: 'asc' }
    });

    let newEndId = currentEndId;
    let consecutiveNonTeam = 0;
    const maxInterruptions = 3;

    for (const event of lookAheadEvents) {
      const handle = event.statement?.speaker?.speakerHandle;
      const speakerType = event.statement?.speaker?.speakerType;

      if (!handle) continue;

      // Check if team member
      if (this.isTeamMember(handle, teamHandles)) {
        newEndId = event.id;
        consecutiveNonTeam = 0;
        this.logger.debug(`Extended to include team member ${handle} at event ${event.id}`);
        continue;
      }

      // Allow judge interruptions
      if (speakerType === 'JUDGE') {
        newEndId = event.id;
        this.logger.debug(`Including judge interruption at event ${event.id}`);
        continue;
      }

      // Non-team member
      consecutiveNonTeam++;
      if (consecutiveNonTeam > maxInterruptions) {
        break;
      }
    }

    return newEndId;
  }

  /**
   * Calculate ratio for team of attorneys
   */
  private calculateTeamRatio(
    events: any[],
    teamHandles: Set<string>,
    params: LongStatementParams
  ): number {
    // Group by team vs non-team
    let teamWords = 0;
    let teamStatements = 0;
    let nonTeamWords = 0;
    let nonTeamStatements = 0;

    for (const event of events) {
      const handle = event.statement?.speaker?.speakerHandle;
      if (!handle || !event.statement?.text) continue;

      const words = event.statement.text.split(/\s+/).length;

      if (this.isTeamMember(handle, teamHandles)) {
        teamWords += words;
        teamStatements++;
      } else {
        nonTeamWords += words;
        nonTeamStatements++;
      }
    }

    if (teamStatements === 0) return 0;

    // Use weighted calculation for team ratio
    const teamScore = teamWords / Math.sqrt(teamStatements);

    if (nonTeamStatements === 0) {
      return 1.0; // Perfect score, no interruptions
    }

    const nonTeamScore = nonTeamWords / Math.sqrt(nonTeamStatements);
    const ratio = teamScore / (teamScore + nonTeamScore);

    this.logger.debug(`Team ratio: ${teamWords} words / sqrt(${teamStatements}) = ${teamScore.toFixed(2)}`);
    this.logger.debug(`Non-team: ${nonTeamWords} words / sqrt(${nonTeamStatements}) = ${nonTeamScore.toFixed(2)}`);
    this.logger.debug(`Final ratio: ${ratio.toFixed(3)}`);

    return ratio;
  }

  /**
   * Filter events by speaker type
   */
  private async filterEventsBySpeakerType(events: any[], params: LongStatementParams): Promise<any[]> {
    const filtered: any[] = [];

    let validAttorneyNames: Set<string> = new Set();
    if (params.speakerType === 'ATTORNEY' && params.attorneyRole) {
      validAttorneyNames = await this.loadTeamAttorneys(params.trialId, params.attorneyRole);
    }

    for (const event of events) {
      if (!event.statement?.speaker) continue;

      const speaker = event.statement.speaker;

      if (speaker.speakerType !== params.speakerType) continue;

      if (params.speakerType === 'ATTORNEY' && params.attorneyRole && validAttorneyNames.size > 0) {
        if (!this.isTeamMember(speaker.speakerHandle, validAttorneyNames)) continue;
      }

      filtered.push(event);
    }

    return filtered;
  }

  /**
   * Group high word events into blocks
   */
  private async groupHighWordEvents(events: any[], params: LongStatementParams): Promise<StatementResult[]> {
    const blocks: StatementResult[] = [];

    events.sort((a, b) => a.id - b.id);

    let currentBlock: any[] = [];

    for (const event of events) {
      if (currentBlock.length === 0) {
        currentBlock = [event];
      } else {
        const lastEvent = currentBlock[currentBlock.length - 1];
        if (event.id - lastEvent.id <= 10) {
          currentBlock.push(event);
        } else {
          if (currentBlock.length > 0) {
            const block = await this.createBlockFromEvents(currentBlock, params);
            if (block) blocks.push(block);
          }
          currentBlock = [event];
        }
      }
    }

    if (currentBlock.length > 0) {
      const block = await this.createBlockFromEvents(currentBlock, params);
      if (block) blocks.push(block);
    }

    return blocks;
  }

  /**
   * Create block from individual speaker events
   */
  private async createBlockFromEvents(blockEvents: any[], params: LongStatementParams): Promise<StatementResult | null> {
    if (blockEvents.length === 0) return null;

    const startId = blockEvents[0].id;
    let endId = blockEvents[blockEvents.length - 1].id;
    const primarySpeaker = blockEvents[0].statement?.speaker?.speakerHandle;

    if (primarySpeaker) {
      endId = await this.extendBlockForContinuation(params.trialId, endId, primarySpeaker, params);
    }

    const allEvents = await this.prisma.trialEvent.findMany({
      where: {
        trialId: params.trialId,
        id: { gte: startId, lte: endId }
      },
      include: {
        statement: {
          include: { speaker: true }
        }
      },
      orderBy: { id: 'asc' }
    });

    let totalWords = 0;
    let speakerWords = 0;

    allEvents.forEach(e => {
      const words = e.wordCount || 0;
      totalWords += words;
      if (e.statement?.speaker?.speakerHandle === primarySpeaker) {
        speakerWords += words;
      }
    });

    const ratio = totalWords > 0 ? speakerWords / totalWords : 0;
    const threshold = params.ratioThreshold || (1 - params.maxInterruptionRatio);

    if (ratio < threshold) {
      return null;
    }

    return {
      startEvent: allEvents[0],
      endEvent: allEvents[allEvents.length - 1],
      totalWords,
      speakerWords,
      interruptionWords: totalWords - speakerWords,
      speakerRatio: ratio,
      confidence: this.calculateConfidence(ratio, speakerWords, params)
    };
  }

  /**
   * Extend block for continuation
   */
  private async extendBlockForContinuation(
    trialId: number,
    currentEndId: number,
    primarySpeaker: string,
    params: LongStatementParams
  ): Promise<number> {
    const lookAheadEvents = await this.prisma.trialEvent.findMany({
      where: {
        trialId,
        id: {
          gt: currentEndId,
          lte: currentEndId + 10
        },
        eventType: 'STATEMENT'
      },
      include: {
        statement: {
          include: { speaker: true }
        }
      },
      orderBy: { id: 'asc' }
    });

    let newEndId = currentEndId;
    let consecutiveOtherSpeakers = 0;

    for (const event of lookAheadEvents) {
      const speaker = event.statement?.speaker?.speakerHandle;

      if (speaker === primarySpeaker) {
        newEndId = event.id;
        consecutiveOtherSpeakers = 0;
      } else {
        consecutiveOtherSpeakers++;
        if (consecutiveOtherSpeakers > 2) {
          break;
        }
      }
    }

    return newEndId;
  }

  /**
   * Traditional sliding window approach
   */
  private async findByTraditionalApproach(params: LongStatementParams): Promise<StatementResult | null> {
    const whereClause: any = {
      trialId: params.trialId,
      eventType: 'STATEMENT'
    };

    if (params.searchStartEvent) {
      whereClause.id = { ...whereClause.id, gte: params.searchStartEvent };
    }
    if (params.searchEndEvent) {
      whereClause.id = { ...whereClause.id, lte: params.searchEndEvent };
    }

    const events = await this.prisma.trialEvent.findMany({
      where: whereClause,
      include: {
        statement: {
          include: {
            speaker: true
          }
        }
      },
      orderBy: { ordinal: 'asc' }
    });

    if (events.length === 0) {
      return null;
    }

    // Simple approach: find the highest word count event matching criteria
    const filtered = await this.filterEventsBySpeakerType(events, params);

    if (filtered.length === 0) {
      return null;
    }

    // Sort by word count
    filtered.sort((a, b) => (b.wordCount || 0) - (a.wordCount || 0));

    // Take the highest and build a block around it
    const anchor = filtered[0];
    const anchorIdx = events.findIndex(e => e.id === anchor.id);

    if (anchorIdx === -1) {
      return null;
    }

    // Build window around anchor
    const windowStart = Math.max(0, anchorIdx - 5);
    const windowEnd = Math.min(events.length, anchorIdx + 6);
    const windowEvents = events.slice(windowStart, windowEnd);

    let totalWords = 0;
    let speakerWords = 0;
    const primarySpeaker = anchor.statement?.speaker?.speakerHandle;

    for (const event of windowEvents) {
      const words = event.wordCount || 0;
      totalWords += words;
      if (event.statement?.speaker?.speakerHandle === primarySpeaker) {
        speakerWords += words;
      }
    }

    if (speakerWords < params.minWords) {
      return null;
    }

    const ratio = totalWords > 0 ? speakerWords / totalWords : 0;

    return {
      startEvent: windowEvents[0],
      endEvent: windowEvents[windowEvents.length - 1],
      totalWords,
      speakerWords,
      interruptionWords: totalWords - speakerWords,
      speakerRatio: ratio,
      confidence: this.calculateConfidence(ratio, speakerWords, params)
    };
  }

  /**
   * Calculate confidence score
   */
  private calculateConfidence(
    ratio: number,
    wordCount: number,
    params: LongStatementParams
  ): number {
    let confidence = 0.0;

    // Ratio component (0-0.5)
    if (ratio > 0.9) {
      confidence += 0.5;
    } else if (ratio > 0.8) {
      confidence += 0.4;
    } else if (ratio > 0.7) {
      confidence += 0.3;
    } else if (ratio > 0.6) {
      confidence += 0.2;
    } else {
      confidence += 0.1;
    }

    // Word count component (0-0.3)
    if (wordCount > params.minWords * 3) {
      confidence += 0.3;
    } else if (wordCount > params.minWords * 2) {
      confidence += 0.2;
    } else if (wordCount > params.minWords) {
      confidence += 0.1;
    }

    // Speaker type bonus (0-0.2)
    if (params.speakerType === 'ATTORNEY') {
      confidence += 0.2;
    } else if (params.speakerType === 'JUDGE') {
      confidence += 0.15;
    } else {
      confidence += 0.1;
    }

    return Math.min(1.0, confidence);
  }
}