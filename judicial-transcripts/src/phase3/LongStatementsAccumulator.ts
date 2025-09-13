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
  ratioMode?: 'TRADITIONAL' | 'WEIGHTED_SQRT' | 'WEIGHTED_SQRT2' | 'WEIGHTED_SQRT3' | 'SMART_EXTEND';  // New parameter for ratio calculation mode
  ratioThreshold?: number;  // Minimum ratio threshold for accepting a statement
}

export interface StatementResult {
  startEvent: TrialEvent;
  endEvent: TrialEvent;
  totalWords: number;
  speakerWords: number;
  interruptionWords: number;
  speakerRatio: number;
  confidence: number;
}

interface SpeakerBlock {
  startEvent: TrialEvent;
  endEvent: TrialEvent;
  events: any[];
  primarySpeaker: string;
  totalWords: number;
  speakerWords: number;
  ratio: number;
}

export class LongStatementsAccumulator {
  private logger = new Logger('LongStatementsAccumulator');

  constructor(private prisma: PrismaClient) {}

  /**
   * Find the longest continuous statement by a speaker or speaker type
   * Uses word count as primary indicator for opening/closing statements
   */
  async findLongestStatement(params: LongStatementParams): Promise<StatementResult | null> {
    this.logger.info(`Finding longest statement for ${params.speakerType} ${params.attorneyRole || ''} in trial ${params.trialId}`);
    this.logger.info(`Search range: events ${params.searchStartEvent || 'start'} to ${params.searchEndEvent || 'end'}`);
    this.logger.info(`Min words: ${params.minWords}, Max interruption ratio: ${params.maxInterruptionRatio}`);

    // First, look for high word count events as primary candidates
    const highWordEvents = await this.findHighWordCountEvents(params);
    
    if (highWordEvents.length === 0) {
      this.logger.info('No high word count events found - falling back to traditional approach');
      // Fall back to traditional sliding window approach
      return await this.findByTraditionalApproach(params);
    }

    // Group high word count events into coherent blocks
    const blocks = await this.groupHighWordEvents(highWordEvents, params);
    
    if (blocks.length === 0) {
      this.logger.info('No qualifying blocks from high word events');
      return null;
    }

    // Sort by total words and return best
    blocks.sort((a, b) => b.speakerWords - a.speakerWords);
    const best = blocks[0];
    
    this.logger.info(`Best block: ${best.speakerWords} words from events ${best.startEvent.id}-${best.endEvent.id}`);
    
    return {
      startEvent: best.startEvent,
      endEvent: best.endEvent,
      totalWords: best.totalWords,
      speakerWords: best.speakerWords,
      interruptionWords: best.totalWords - best.speakerWords,
      speakerRatio: best.speakerWords / best.totalWords,
      confidence: this.calculateConfidence(best.speakerWords / best.totalWords, best.speakerWords, params)
    };
  }

  /**
   * Find high word count events that are likely opening/closing statements
   */
  private async findHighWordCountEvents(params: LongStatementParams): Promise<any[]> {
    const whereClause: any = {
      trialId: params.trialId,
      eventType: 'STATEMENT',
      wordCount: { gte: 500 } // High word count threshold
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
      take: 20 // Get top 20 high word count events
    });

    // Filter by speaker type and role
    const filtered = await this.filterEventsBySpeakerType(events, params);
    
    this.logger.info(`Found ${filtered.length} high word count events matching speaker criteria`);
    filtered.forEach(e => {
      if (e.statement?.speaker) {
        this.logger.info(`  Event ${e.id}: ${e.statement.speaker.speakerHandle} - ${e.wordCount} words`);
      }
    });
    
    return filtered;
  }

  /**
   * Filter individual events by speaker type and role
   */
  private async filterEventsBySpeakerType(events: any[], params: LongStatementParams): Promise<any[]> {
    const filtered: any[] = [];
    
    // Pre-load attorney names if needed
    let validAttorneyNames: Set<string> = new Set();
    if (params.speakerType === 'ATTORNEY' && params.attorneyRole) {
      const trialAttorneys = await this.prisma.trialAttorney.findMany({
        where: {
          trialId: params.trialId,
          role: params.attorneyRole as AttorneyRole
        },
        include: { attorney: true }
      });
      
      trialAttorneys.forEach(ta => {
        if (ta.attorney.name) validAttorneyNames.add(ta.attorney.name.toUpperCase());
        if (ta.attorney.lastName) validAttorneyNames.add(ta.attorney.lastName.toUpperCase());
      });
    }
    
    for (const event of events) {
      if (!event.statement?.speaker) continue;
      
      const speaker = event.statement.speaker;
      
      // Check speaker type
      if (speaker.speakerType !== params.speakerType) continue;
      
      // Check attorney role if applicable
      if (params.speakerType === 'ATTORNEY' && params.attorneyRole && validAttorneyNames.size > 0) {
        const speakerHandle = speaker.speakerHandle.toUpperCase();
        let isValid = false;
        
        // Check various formats
        for (const name of validAttorneyNames) {
          if (speakerHandle.includes(name)) {
            isValid = true;
            break;
          }
        }
        
        if (!isValid) continue;
      }
      
      filtered.push(event);
    }
    
    return filtered;
  }

  /**
   * Group high word count events into coherent blocks
   */
  private async groupHighWordEvents(events: any[], params: LongStatementParams): Promise<StatementResult[]> {
    const blocks: StatementResult[] = [];
    
    // Sort events by ID to process chronologically
    events.sort((a, b) => a.id - b.id);
    
    // Group nearby high word count events (within 10 events of each other)
    let currentBlock: any[] = [];
    
    for (const event of events) {
      if (currentBlock.length === 0) {
        currentBlock = [event];
      } else {
        const lastEvent = currentBlock[currentBlock.length - 1];
        if (event.id - lastEvent.id <= 10) {
          // Close enough to be part of same statement
          currentBlock.push(event);
        } else {
          // Too far, start new block
          if (currentBlock.length > 0) {
            const block = await this.createBlockFromEvents(currentBlock, params);
            if (block) blocks.push(block);
          }
          currentBlock = [event];
        }
      }
    }
    
    // Process last block
    if (currentBlock.length > 0) {
      const block = await this.createBlockFromEvents(currentBlock, params);
      if (block) blocks.push(block);
    }
    
    return blocks;
  }

  /**
   * Extend a block to include continuation statements from the same speaker
   * This helps capture the final parts of closing statements after time warnings
   */
  private async extendBlockForContinuation(
    trialId: number,
    currentEndId: number,
    primarySpeaker: string,
    params: LongStatementParams
  ): Promise<number> {
    // For SMART_EXTEND mode, use intelligent ending detection
    if (params.ratioMode === 'SMART_EXTEND') {
      return await this.smartExtendBlock(trialId, currentEndId, primarySpeaker, params);
    }

    // Original extension logic for other modes
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
    const maxInterruptions = 2; // Allow up to 2 interruptions

    for (const event of lookAheadEvents) {
      const speaker = event.statement?.speaker?.speakerHandle;

      if (speaker === primarySpeaker) {
        // Found continuation from primary speaker
        newEndId = event.id;
        consecutiveOtherSpeakers = 0; // Reset interruption counter
        this.logger.debug(`Extended block to include event ${event.id} with ${event.wordCount} words from ${primarySpeaker}`);
      } else {
        // Different speaker (interruption)
        consecutiveOtherSpeakers++;
        if (consecutiveOtherSpeakers > maxInterruptions) {
          // Too many consecutive interruptions, stop extending
          break;
        }
      }
    }

    return newEndId;
  }

  /**
   * Smart extension: Continue until we hit a non-attorney, non-judge speaker
   * This captures the complete statement including all time warnings and wrap-ups
   */
  private async smartExtendBlock(
    trialId: number,
    currentEndId: number,
    primarySpeaker: string,
    params: LongStatementParams
  ): Promise<number> {
    // Get the attorney role of the primary speaker for team detection
    const primarySpeakerInfo = await this.prisma.speaker.findFirst({
      where: {
        trialId,
        speakerHandle: primarySpeaker
      }
    });

    // Get attorney role if available
    let primaryAttorneyRole: string | null = null;
    if (primarySpeakerInfo && params.attorneyRole) {
      primaryAttorneyRole = params.attorneyRole;
    }

    // Look ahead up to 50 events (enough to cover several pages)
    const lookAheadEvents = await this.prisma.trialEvent.findMany({
      where: {
        trialId,
        id: {
          gt: currentEndId,
          lte: currentEndId + 50
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
    let lastAttorneyEventId = currentEndId;

    for (const event of lookAheadEvents) {
      const speaker = event.statement?.speaker;
      if (!speaker) continue;

      const speakerHandle = speaker.speakerHandle;
      const speakerType = speaker.speakerType;

      // Check if this is the primary speaker continuing
      if (speakerHandle === primarySpeaker) {
        newEndId = event.id;
        lastAttorneyEventId = event.id;
        this.logger.debug(`SMART_EXTEND: Including continuation from ${primarySpeaker} at event ${event.id}`);
        continue;
      }

      // Check if this is a judge (allowed interruption)
      if (speakerType === 'JUDGE') {
        // Include the judge's statement but keep looking
        newEndId = event.id;
        this.logger.debug(`SMART_EXTEND: Including judge interruption at event ${event.id}`);
        continue;
      }

      // Check if this is a teammate attorney (same side)
      if (speakerType === 'ATTORNEY' && primaryAttorneyRole) {
        // Need to check if this attorney is on the same side
        const attorneyInfo = await this.prisma.trialAttorney.findFirst({
          where: {
            trialId,
            speakerId: speaker.id
          }
        });

        if (attorneyInfo?.role === primaryAttorneyRole) {
          // Same team attorney, include them
          newEndId = event.id;
          lastAttorneyEventId = event.id;
          this.logger.debug(`SMART_EXTEND: Including teammate attorney ${speakerHandle} at event ${event.id}`);
          continue;
        }
      }

      // We've hit a different type of speaker (opposing attorney, court officer, etc.)
      // This is where the statement should end
      this.logger.debug(`SMART_EXTEND: Stopping at event ${event.id} due to ${speakerType} speaker ${speakerHandle}`);
      break;
    }

    // Return the last event that should be included
    return newEndId;
  }

  /**
   * Create a statement result from a group of events
   */
  private async createBlockFromEvents(blockEvents: any[], params: LongStatementParams): Promise<StatementResult | null> {
    if (blockEvents.length === 0) return null;

    // Get all events in the range to calculate ratios
    const startId = blockEvents[0].id;
    let endId = blockEvents[blockEvents.length - 1].id;
    const primarySpeaker = blockEvents[0].statement?.speaker?.speakerHandle;

    // Try to extend the block to include continuation statements from the same speaker
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

    // Calculate total words and speaker words
    let totalWords = 0;
    let speakerWords = 0;
    
    allEvents.forEach(e => {
      const words = e.wordCount || 0;
      totalWords += words;
      if (e.statement?.speaker?.speakerHandle === primarySpeaker) {
        speakerWords += words;
      }
    });
    
    const ratio = this.calculateRatioByMode(allEvents as any[], primarySpeaker, params);
    const threshold = params.ratioThreshold || (1 - params.maxInterruptionRatio);

    // Only accept if speaker has sufficient dominance
    if (ratio < threshold) {
      this.logger.debug(`Block rejected: ratio ${ratio.toFixed(3)} < threshold ${threshold.toFixed(3)}`);
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
   * Fallback to traditional sliding window approach
   */
  private async findByTraditionalApproach(params: LongStatementParams): Promise<StatementResult | null> {
    // Load all statement events in search range
    const events = await this.loadEventsInRange(params);
    
    if (events.length === 0) {
      return null;
    }

    // Group consecutive statements into blocks
    const speakerBlocks = this.groupBySpeaker(events);
    
    // Filter blocks by speaker type criteria
    const candidateBlocks = await this.filterBySpeakerType(speakerBlocks, params);
    
    if (candidateBlocks.length === 0) {
      return null;
    }

    // Calculate word counts and ratios for each block
    const scoredBlocks = candidateBlocks.map(block => ({
      ...block,
      totalWords: this.countWords(block.events),
      speakerWords: this.countSpeakerWords(block.events, block.primarySpeaker),
      ratio: this.calculateRatioByMode(block.events, block.primarySpeaker, params)
    }));
    
    // Filter by minimum word threshold
    const qualifyingBlocks = scoredBlocks.filter(b => b.speakerWords >= params.minWords);
    
    if (qualifyingBlocks.length === 0) {
      return null;
    }

    // Sort by speaker ratio (descending) and then by word count
    qualifyingBlocks.sort((a, b) => {
      if (Math.abs(a.ratio - b.ratio) < 0.05) {
        return b.speakerWords - a.speakerWords;
      }
      return b.ratio - a.ratio;
    });
    
    // Take the best match and optimize boundaries
    const best = qualifyingBlocks[0];
    return await this.optimizeBoundaries(best, params);
  }

  /**
   * Load events within the search range
   */
  private async loadEventsInRange(params: LongStatementParams): Promise<any[]> {
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

    return await this.prisma.trialEvent.findMany({
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
  }

  /**
   * Calculate ratio based on the configured mode
   */
  private calculateRatioByMode(
    events: any[],
    primarySpeaker: string,
    params: LongStatementParams
  ): number {
    const mode = params.ratioMode || 'WEIGHTED_SQRT';

    if (mode === 'TRADITIONAL') {
      // Traditional calculation: speaker words / total words
      return this.calculateSpeakerRatio(events, primarySpeaker);
    } else if (mode === 'WEIGHTED_SQRT' || mode === 'SMART_EXTEND') {
      // Weighted sqrt calculation: words/sqrt(statements)
      // SMART_EXTEND uses same ratio but different ending detection
      return this.calculateWeightedSqrtRatio(events, primarySpeaker);
    } else if (mode === 'WEIGHTED_SQRT2') {
      // Enhanced weighted calculation: words²/sqrt(statements)
      return this.calculateWeightedSqrt2Ratio(events, primarySpeaker);
    } else if (mode === 'WEIGHTED_SQRT3') {
      // Ultra-enhanced weighted calculation: words³/sqrt(statements)
      return this.calculateWeightedSqrt3Ratio(events, primarySpeaker);
    } else {
      // Default to WEIGHTED_SQRT
      return this.calculateWeightedSqrtRatio(events, primarySpeaker);
    }
  }

  /**
   * Calculate weighted ratio using words/sqrt(statements) for both speaker and interruptions
   * This gives more tolerance to short interruptions while maintaining quality
   */
  private calculateWeightedSqrtRatio(events: any[], primarySpeaker: string): number {
    // Group statements by speaker
    const speakerStats = new Map<string, { words: number; statements: number }>();

    for (const event of events) {
      if (!event.statement?.speaker?.speakerHandle || !event.statement?.text) continue;

      const speaker = event.statement.speaker.speakerHandle;
      const words = event.statement.text.split(/\s+/).length;

      if (!speakerStats.has(speaker)) {
        speakerStats.set(speaker, { words: 0, statements: 0 });
      }

      const stats = speakerStats.get(speaker)!;
      stats.words += words;
      stats.statements += 1;
    }

    // Calculate weighted scores
    const primaryStats = speakerStats.get(primarySpeaker);
    if (!primaryStats || primaryStats.statements === 0) return 0;

    const primaryScore = primaryStats.words / Math.sqrt(primaryStats.statements);

    // Calculate interruption score (all other speakers combined)
    let interruptionWords = 0;
    let interruptionStatements = 0;

    for (const [speaker, stats] of speakerStats) {
      if (speaker !== primarySpeaker) {
        interruptionWords += stats.words;
        interruptionStatements += stats.statements;
      }
    }

    if (interruptionStatements === 0) {
      // No interruptions, perfect ratio
      return 1.0;
    }

    const interruptionScore = interruptionWords / Math.sqrt(interruptionStatements);

    // Return ratio of scores (higher is better for the primary speaker)
    // Normalize to 0-1 range similar to traditional ratio
    const ratio = primaryScore / (primaryScore + interruptionScore);

    this.logger.debug(`Weighted ratio: Primary(${primarySpeaker}): ${primaryStats.words} words / sqrt(${primaryStats.statements}) = ${primaryScore.toFixed(2)}`);
    this.logger.debug(`Interruptions: ${interruptionWords} words / sqrt(${interruptionStatements}) = ${interruptionScore.toFixed(2)}`);
    this.logger.debug(`Final weighted ratio: ${ratio.toFixed(3)}`);

    return ratio;
  }

  /**
   * Calculate enhanced weighted ratio using words²/sqrt(statements)
   * This gives even more weight to the primary speaker's long statements
   * while being more tolerant of brief interruptions
   */
  private calculateWeightedSqrt2Ratio(events: any[], primarySpeaker: string): number {
    // Group statements by speaker
    const speakerStats = new Map<string, { words: number; statements: number }>();

    for (const event of events) {
      if (!event.statement?.speaker?.speakerHandle || !event.statement?.text) continue;

      const speaker = event.statement.speaker.speakerHandle;
      const words = event.statement.text.split(/\s+/).length;

      if (!speakerStats.has(speaker)) {
        speakerStats.set(speaker, { words: 0, statements: 0 });
      }

      const stats = speakerStats.get(speaker)!;
      stats.words += words;
      stats.statements += 1;
    }

    // Calculate weighted scores with squared word count
    const primaryStats = speakerStats.get(primarySpeaker);
    if (!primaryStats || primaryStats.statements === 0) return 0;

    // Square the word count in numerator for primary speaker
    const primaryScore = (primaryStats.words * primaryStats.words) / Math.sqrt(primaryStats.statements);

    // Calculate interruption score (all other speakers combined)
    let interruptionWords = 0;
    let interruptionStatements = 0;

    for (const [speaker, stats] of speakerStats) {
      if (speaker !== primarySpeaker) {
        interruptionWords += stats.words;
        interruptionStatements += stats.statements;
      }
    }

    if (interruptionStatements === 0) {
      // No interruptions, perfect ratio
      return 1.0;
    }

    // Square the interruption words as well for consistency
    const interruptionScore = (interruptionWords * interruptionWords) / Math.sqrt(interruptionStatements);

    // Return ratio of scores (higher is better for the primary speaker)
    // Normalize to 0-1 range
    const ratio = primaryScore / (primaryScore + interruptionScore);

    this.logger.debug(`WEIGHTED_SQRT2 ratio: Primary(${primarySpeaker}): ${primaryStats.words}² / sqrt(${primaryStats.statements}) = ${primaryScore.toFixed(2)}`);
    this.logger.debug(`Interruptions: ${interruptionWords}² / sqrt(${interruptionStatements}) = ${interruptionScore.toFixed(2)}`);
    this.logger.debug(`Final WEIGHTED_SQRT2 ratio: ${ratio.toFixed(3)}`);

    return ratio;
  }

  /**
   * Calculate ultra-enhanced weighted ratio using words³/sqrt(statements)
   * This gives maximum weight to the primary speaker's long statements
   * and is extremely tolerant of brief interruptions
   */
  private calculateWeightedSqrt3Ratio(events: any[], primarySpeaker: string): number {
    // Group statements by speaker
    const speakerStats = new Map<string, { words: number; statements: number }>();

    for (const event of events) {
      if (!event.statement?.speaker?.speakerHandle || !event.statement?.text) continue;

      const speaker = event.statement.speaker.speakerHandle;
      const words = event.statement.text.split(/\s+/).length;

      if (!speakerStats.has(speaker)) {
        speakerStats.set(speaker, { words: 0, statements: 0 });
      }

      const stats = speakerStats.get(speaker)!;
      stats.words += words;
      stats.statements += 1;
    }

    // Calculate weighted scores with cubed word count
    const primaryStats = speakerStats.get(primarySpeaker);
    if (!primaryStats || primaryStats.statements === 0) return 0;

    // Cube the word count in numerator for primary speaker
    const primaryScore = Math.pow(primaryStats.words, 3) / Math.sqrt(primaryStats.statements);

    // Calculate interruption score (all other speakers combined)
    let interruptionWords = 0;
    let interruptionStatements = 0;

    for (const [speaker, stats] of speakerStats) {
      if (speaker !== primarySpeaker) {
        interruptionWords += stats.words;
        interruptionStatements += stats.statements;
      }
    }

    if (interruptionStatements === 0) {
      // No interruptions, perfect ratio
      return 1.0;
    }

    // Cube the interruption words as well for consistency
    const interruptionScore = Math.pow(interruptionWords, 3) / Math.sqrt(interruptionStatements);

    // Return ratio of scores (higher is better for the primary speaker)
    // Normalize to 0-1 range
    const ratio = primaryScore / (primaryScore + interruptionScore);

    this.logger.debug(`WEIGHTED_SQRT3 ratio: Primary(${primarySpeaker}): ${primaryStats.words}³ / sqrt(${primaryStats.statements}) = ${primaryScore.toFixed(2)}`);
    this.logger.debug(`Interruptions: ${interruptionWords}³ / sqrt(${interruptionStatements}) = ${interruptionScore.toFixed(2)}`);
    this.logger.debug(`Final WEIGHTED_SQRT3 ratio: ${ratio.toFixed(3)}`);

    return ratio;
  }

  /**
   * Group statements into blocks where one speaker dominates
   * Uses a sliding window approach to find sections with high speaker concentration
   */
  private groupBySpeaker(events: any[]): SpeakerBlock[] {
    const blocks: SpeakerBlock[] = [];
    
    // Use a sliding window to find dominated sections
    const windowSize = 20; // Smaller window for better granularity
    const minDominance = 0.5; // Speaker must have at least 50% of statements in window
    
    for (let i = 0; i < events.length; i++) {
      const windowEnd = Math.min(i + windowSize, events.length);
      const window = events.slice(i, windowEnd);
      
      // Count speakers in this window
      const speakerCounts = new Map<string, number>();
      window.forEach(e => {
        if (e.statement?.speaker) {
          const handle = e.statement.speaker.speakerHandle;
          speakerCounts.set(handle, (speakerCounts.get(handle) || 0) + 1);
        }
      });
      
      // Find dominant speaker
      let dominantSpeaker = '';
      let maxCount = 0;
      speakerCounts.forEach((count, speaker) => {
        if (count > maxCount) {
          maxCount = count;
          dominantSpeaker = speaker;
        }
      });
      
      // If speaker dominates this window, try to extend it
      if (maxCount / window.length >= minDominance) {
        // Extend forward while speaker remains dominant
        let blockEnd = windowEnd;
        let blockEvents = [...window];
        
        while (blockEnd < events.length) {
          const nextEvent = events[blockEnd];
          blockEvents.push(nextEvent);
          
          // Recalculate dominance
          const speakerCount = blockEvents.filter(e => 
            e.statement?.speaker?.speakerHandle === dominantSpeaker
          ).length;
          
          if (speakerCount / blockEvents.length < 0.4) { // Lower threshold for extension
            // Lost dominance, back up
            blockEvents.pop();
            break;
          }
          blockEnd++;
        }
        
        // Create block if it's substantial
        if (blockEvents.length >= 10) { // At least 10 events
          const block: SpeakerBlock = {
            startEvent: blockEvents[0],
            endEvent: blockEvents[blockEvents.length - 1],
            events: blockEvents,
            primarySpeaker: dominantSpeaker,
            totalWords: 0,
            speakerWords: 0,
            ratio: 0
          };
          
          // Check if this overlaps with existing blocks
          const overlaps = blocks.some(b => 
            (block.startEvent.id >= b.startEvent.id && block.startEvent.id <= b.endEvent.id) ||
            (block.endEvent.id >= b.startEvent.id && block.endEvent.id <= b.endEvent.id)
          );
          
          if (!overlaps) {
            blocks.push(block);
            // Skip ahead to avoid overlapping windows
            i = blockEnd - 1;
          }
        }
      }
    }
    
    return blocks;
  }

  /**
   * Check if two speakers are similar (same person, typos, etc.)
   */
  private isSimilarSpeaker(speaker1: string, speaker2: string): boolean {
    if (speaker1 === speaker2) return true;
    
    // Remove common prefixes
    const clean1 = speaker1.replace(/^(MR\.|MS\.|MRS\.|DR\.) /, '');
    const clean2 = speaker2.replace(/^(MR\.|MS\.|MRS\.|DR\.) /, '');
    
    return clean1 === clean2;
  }

  /**
   * Filter blocks by speaker type and role
   */
  private async filterBySpeakerType(
    blocks: SpeakerBlock[], 
    params: LongStatementParams
  ): Promise<SpeakerBlock[]> {
    const filtered: SpeakerBlock[] = [];

    // Pre-load all attorneys for this trial and role for efficient lookup
    let validAttorneyNames: Set<string> = new Set();
    if (params.speakerType === 'ATTORNEY' && params.attorneyRole) {
      const trialAttorneys = await this.prisma.trialAttorney.findMany({
        where: {
          trialId: params.trialId,
          role: params.attorneyRole as AttorneyRole
        },
        include: { attorney: true }
      });
      
      // Build set of valid attorney names and last names
      trialAttorneys.forEach(ta => {
        if (ta.attorney.name) {
          validAttorneyNames.add(ta.attorney.name.toUpperCase());
        }
        if (ta.attorney.lastName) {
          validAttorneyNames.add(ta.attorney.lastName.toUpperCase());
        }
      });
      
      this.logger.debug(`Found ${validAttorneyNames.size} ${params.attorneyRole} attorneys: ${Array.from(validAttorneyNames).join(', ')}`);
    }

    for (const block of blocks) {
      // Check if primary speaker matches criteria
      const primaryEvent = block.events.find(e => 
        e.statement?.speaker?.speakerHandle === block.primarySpeaker
      );
      
      if (!primaryEvent?.statement?.speaker) {
        this.logger.debug(`Block has no valid primary speaker event`);
        continue;
      }

      const speaker = primaryEvent.statement.speaker;
      
      // Check speaker type
      if (speaker.speakerType !== params.speakerType) {
        this.logger.debug(`Speaker ${speaker.speakerHandle} type ${speaker.speakerType} doesn't match ${params.speakerType}`);
        continue;
      }

      // If attorney, check role
      if (params.speakerType === 'ATTORNEY' && params.attorneyRole && validAttorneyNames.size > 0) {
        // Check if this speaker matches any of our valid attorneys
        const speakerHandle = speaker.speakerHandle.toUpperCase();
        
        // Try different parsing strategies for the speaker handle
        let isValidAttorney = false;
        
        // Strategy 1: Check if any valid attorney name is in the speaker handle
        for (const attorneyName of validAttorneyNames) {
          if (speakerHandle.includes(attorneyName)) {
            isValidAttorney = true;
            this.logger.debug(`Matched ${speaker.speakerHandle} to ${params.attorneyRole} attorney: ${attorneyName}`);
            break;
          }
        }
        
        // Strategy 2: Parse ATTORNEY_Lastname format
        if (!isValidAttorney && speakerHandle.startsWith('ATTORNEY_')) {
          const lastName = speakerHandle.replace('ATTORNEY_', '').toUpperCase();
          if (validAttorneyNames.has(lastName)) {
            isValidAttorney = true;
            this.logger.debug(`Matched ${speaker.speakerHandle} to ${params.attorneyRole} attorney via ATTORNEY_ prefix`);
          }
        }
        
        // Strategy 3: Parse MR_/MS_ format
        if (!isValidAttorney && (speakerHandle.startsWith('MR_') || speakerHandle.startsWith('MS_'))) {
          const lastName = speakerHandle.replace(/^(MR_|MS_)/, '').toUpperCase();
          if (validAttorneyNames.has(lastName)) {
            isValidAttorney = true;
            this.logger.debug(`Matched ${speaker.speakerHandle} to ${params.attorneyRole} attorney via MR_/MS_ prefix`);
          }
        }
        
        if (!isValidAttorney) {
          this.logger.debug(`Speaker ${speaker.speakerHandle} not matched to any ${params.attorneyRole} attorney`);
          continue;
        }
        
        this.logger.info(`Found ${params.attorneyRole} attorney block: ${speaker.speakerHandle}, ${block.speakerWords} words`);
      }

      filtered.push(block);
    }

    this.logger.info(`Filtered to ${filtered.length} blocks matching criteria`);
    return filtered;
  }

  /**
   * Count total words in events
   */
  private countWords(events: any[]): number {
    let total = 0;
    for (const event of events) {
      if (event.statement?.text) {
        total += event.statement.text.split(/\s+/).length;
      }
    }
    return total;
  }

  /**
   * Count words spoken by specific speaker
   */
  private countSpeakerWords(events: any[], speakerHandle: string): number {
    let total = 0;
    for (const event of events) {
      if (event.statement?.speaker.speakerHandle === speakerHandle && event.statement.text) {
        total += event.statement.text.split(/\s+/).length;
      }
    }
    return total;
  }

  /**
   * Calculate speaker ratio
   */
  private calculateSpeakerRatio(events: any[], speakerHandle: string): number {
    const totalWords = this.countWords(events);
    if (totalWords === 0) return 0;
    
    const speakerWords = this.countSpeakerWords(events, speakerHandle);
    return speakerWords / totalWords;
  }

  /**
   * Apply ratio threshold check based on configured mode
   */
  private meetsRatioThreshold(ratio: number, params: LongStatementParams): boolean {
    const threshold = params.ratioThreshold || (1 - params.maxInterruptionRatio);
    return ratio >= threshold;
  }

  /**
   * Optimize boundaries to maximize speaker ratio
   */
  private async optimizeBoundaries(
    initialBlock: SpeakerBlock,
    params: LongStatementParams
  ): Promise<StatementResult> {
    let bestStart = initialBlock.startEvent;
    let bestEnd = initialBlock.endEvent;
    let bestRatio = initialBlock.ratio;
    let bestEvents = initialBlock.events;

    // Try expanding boundaries
    const expanded = await this.tryExpandBoundaries(initialBlock, params);
    if (expanded.ratio > bestRatio && this.meetsRatioThreshold(expanded.ratio, params)) {
      bestStart = expanded.startEvent;
      bestEnd = expanded.endEvent;
      bestRatio = expanded.ratio;
      bestEvents = expanded.events;
    }

    // Try contracting boundaries to remove interruptions
    const contracted = this.tryContractBoundaries(initialBlock, params);
    if (contracted.ratio > bestRatio) {
      bestStart = contracted.startEvent;
      bestEnd = contracted.endEvent;
      bestRatio = contracted.ratio;
      bestEvents = contracted.events;
    }

    const totalWords = this.countWords(bestEvents);
    const speakerWords = this.countSpeakerWords(bestEvents, initialBlock.primarySpeaker);
    const interruptionWords = totalWords - speakerWords;

    return {
      startEvent: bestStart,
      endEvent: bestEnd,
      totalWords,
      speakerWords,
      interruptionWords,
      speakerRatio: bestRatio,
      confidence: this.calculateConfidence(bestRatio, speakerWords, params)
    };
  }

  /**
   * Try expanding boundaries to include more of the same speaker
   */
  private async tryExpandBoundaries(
    block: SpeakerBlock,
    params: LongStatementParams
  ): Promise<SpeakerBlock> {
    // Load events before and after the block
    const expandedEvents = await this.prisma.trialEvent.findMany({
      where: {
        trialId: params.trialId,
        eventType: 'STATEMENT',
        id: {
          gte: block.startEvent.id - 20, // Look 20 events before
          lte: block.endEvent.id + 20    // And 20 events after
        }
      },
      include: {
        statement: {
          include: {
            speaker: true
          }
        }
      },
      orderBy: { ordinal: 'asc' }
    });

    // Find the optimal expansion
    let bestExpanded = block;
    let bestRatio = block.ratio;

    for (let startIdx = 0; startIdx < expandedEvents.length; startIdx++) {
      for (let endIdx = startIdx + 1; endIdx <= expandedEvents.length; endIdx++) {
        const testEvents = expandedEvents.slice(startIdx, endIdx);
        if (testEvents.length === 0) continue;

        // Must include original block
        const includesOriginal = testEvents.some(e => e.id === block.startEvent.id) &&
                                testEvents.some(e => e.id === block.endEvent.id);
        if (!includesOriginal) continue;

        const ratio = this.calculateRatioByMode(testEvents as any[], block.primarySpeaker, params);
        const speakerWords = this.countSpeakerWords(testEvents as any[], block.primarySpeaker);

        if (ratio > bestRatio && speakerWords >= params.minWords) {
          bestRatio = ratio;
          bestExpanded = {
            ...block,
            startEvent: testEvents[0],
            endEvent: testEvents[testEvents.length - 1],
            events: testEvents,
            ratio
          };
        }
      }
    }

    return bestExpanded;
  }

  /**
   * Try contracting boundaries to remove interruptions
   */
  private tryContractBoundaries(
    block: SpeakerBlock,
    params: LongStatementParams
  ): SpeakerBlock {
    let bestContracted = block;
    let bestRatio = block.ratio;

    // Try removing events from start and end that aren't the primary speaker
    let startIdx = 0;
    let endIdx = block.events.length - 1;

    // Trim from start
    while (startIdx < block.events.length && 
           block.events[startIdx].statement?.speaker.speakerHandle !== block.primarySpeaker) {
      startIdx++;
    }

    // Trim from end
    while (endIdx > startIdx && 
           block.events[endIdx].statement?.speaker.speakerHandle !== block.primarySpeaker) {
      endIdx--;
    }

    if (startIdx < endIdx) {
      const trimmedEvents = block.events.slice(startIdx, endIdx + 1);
      const ratio = this.calculateRatioByMode(trimmedEvents, block.primarySpeaker, params);
      const speakerWords = this.countSpeakerWords(trimmedEvents, block.primarySpeaker);

      if (ratio > bestRatio && speakerWords >= params.minWords) {
        bestContracted = {
          ...block,
          startEvent: trimmedEvents[0],
          endEvent: trimmedEvents[trimmedEvents.length - 1],
          events: trimmedEvents,
          ratio
        };
      }
    }

    return bestContracted;
  }

  /**
   * Calculate confidence score for the statement
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