import {
  PrismaClient,
  TrialEvent,
  MarkerSection,
  MarkerSectionType,
  MarkerSource
} from '@prisma/client';
import { Logger } from '../utils/logger';
import { LongStatementsAccumulatorV3 } from './LongStatementsAccumulatorV3';
import { BoundaryOptimizer } from './BoundaryOptimizer';

interface ArgumentCandidate {
  startEvent: TrialEvent;
  endEvent: TrialEvent;
  totalWords: number;
  speakerWords: number;
  speakerRatio: number;
  confidence: number;
  role: 'PLAINTIFF' | 'DEFENDANT';
  type: 'OPENING' | 'CLOSING' | 'REBUTTAL';
  metadata?: any;
  validationScore?: number;
  hasInvalidSpeakers?: boolean;
}

interface SearchStrategy {
  name: string;
  execute: () => Promise<ArgumentCandidate[]>;
}

export class ArgumentFinder {
  private logger = new Logger('ArgumentFinder');
  private accumulator: LongStatementsAccumulatorV3;
  private boundaryOptimizer: BoundaryOptimizer;

  constructor(private prisma: PrismaClient) {
    this.accumulator = new LongStatementsAccumulatorV3(prisma);
    this.boundaryOptimizer = new BoundaryOptimizer(prisma);
  }

  /**
   * Find opening statements using multiple search strategies
   */
  async findOpeningStatements(
    trialId: number,
    searchStartEvent?: number,
    searchEndEvent?: number,
    config?: any
  ): Promise<{
    plaintiffOpening: ArgumentCandidate | null;
    defenseOpening: ArgumentCandidate | null;
  }> {
    this.logger.info(`Finding opening statements for trial ${trialId}`);

    const strategies: SearchStrategy[] = [
      {
        name: 'defense-first',
        execute: () => this.searchOpeningDefenseFirst(trialId, searchStartEvent, searchEndEvent, config)
      },
      {
        name: 'plaintiff-first',
        execute: () => this.searchOpeningPlaintiffFirst(trialId, searchStartEvent, searchEndEvent, config)
      },
      {
        name: 'parallel-search',
        execute: () => this.searchOpeningParallel(trialId, searchStartEvent, searchEndEvent, config)
      }
    ];

    // Execute all strategies
    const allCandidates: ArgumentCandidate[] = [];
    for (const strategy of strategies) {
      this.logger.info(`Executing strategy: ${strategy.name}`);
      const candidates = await strategy.execute();
      allCandidates.push(...candidates);
    }

    // Optimize boundaries first
    await this.optimizeCandidateBoundaries(allCandidates, trialId);

    // Validate and score all candidates
    await this.validateAndScoreCandidates(allCandidates, trialId);

    // Select best combination
    return this.selectBestOpeningCombination(allCandidates);
  }

  /**
   * Find closing statements using multiple search strategies
   */
  async findClosingStatements(
    trialId: number,
    searchStartEvent?: number,
    searchEndEvent?: number,
    config?: any
  ): Promise<{
    plaintiffClosing: ArgumentCandidate | null;
    defenseClosing: ArgumentCandidate | null;
    plaintiffRebuttal: ArgumentCandidate | null;
  }> {
    this.logger.info(`Finding closing statements for trial ${trialId}`);

    const strategies: SearchStrategy[] = [
      {
        name: 'defense-first',
        execute: () => this.searchClosingDefenseFirst(trialId, searchStartEvent, searchEndEvent, config)
      },
      {
        name: 'plaintiff-first',
        execute: () => this.searchClosingPlaintiffFirst(trialId, searchStartEvent, searchEndEvent, config)
      },
      {
        name: 'chronological',
        execute: () => this.searchClosingChronological(trialId, searchStartEvent, searchEndEvent, config)
      }
    ];

    // Execute all strategies
    const allCandidates: ArgumentCandidate[] = [];
    for (const strategy of strategies) {
      this.logger.info(`Executing strategy: ${strategy.name}`);
      const candidates = await strategy.execute();
      allCandidates.push(...candidates);
    }

    // Optimize boundaries first
    await this.optimizeCandidateBoundaries(allCandidates, trialId);

    // Validate and score all candidates
    await this.validateAndScoreCandidates(allCandidates, trialId);

    // Select best combination
    return this.selectBestClosingCombination(allCandidates);
  }

  /**
   * Strategy: Search for defense opening first, then plaintiff in narrowed window
   */
  private async searchOpeningDefenseFirst(
    trialId: number,
    searchStartEvent?: number,
    searchEndEvent?: number,
    config?: any
  ): Promise<ArgumentCandidate[]> {
    const candidates: ArgumentCandidate[] = [];

    // Search for defense opening
    const defenseOpening = await this.accumulator.findLongestStatement({
      trialId,
      speakerType: 'ATTORNEY',
      attorneyRole: 'DEFENDANT',
      searchStartEvent,
      searchEndEvent,
      minWords: config?.minWords || 400,
      maxInterruptionRatio: config?.maxInterruptionRatio || 0.4,
      ratioMode: config?.ratioMode || 'SMART_EXTEND',
      ratioThreshold: config?.ratioThreshold || 0.4,
      aggregateTeam: true
    });

    if (defenseOpening && defenseOpening.confidence > 0.4) {
      candidates.push({
        ...defenseOpening,
        role: 'DEFENDANT',
        type: 'OPENING',
        metadata: { ...defenseOpening.metadata, strategy: 'defense-first' }
      } as ArgumentCandidate);

      // Search for plaintiff opening BEFORE defense
      const plaintiffOpening = await this.accumulator.findLongestStatement({
        trialId,
        speakerType: 'ATTORNEY',
        attorneyRole: 'PLAINTIFF',
        searchStartEvent,
        searchEndEvent: defenseOpening.startEvent.id - 1,
        minWords: config?.minWords || 400,
        maxInterruptionRatio: config?.maxInterruptionRatio || 0.4,
        ratioMode: config?.ratioMode || 'SMART_EXTEND',
        ratioThreshold: config?.ratioThreshold || 0.4,
        aggregateTeam: true
      });

      if (plaintiffOpening && plaintiffOpening.confidence > 0.4) {
        candidates.push({
          ...plaintiffOpening,
          role: 'PLAINTIFF',
          type: 'OPENING',
          metadata: { ...plaintiffOpening.metadata, strategy: 'defense-first' }
        } as ArgumentCandidate);
      }
    }

    return candidates;
  }

  /**
   * Strategy: Search for plaintiff opening first, then defense after
   */
  private async searchOpeningPlaintiffFirst(
    trialId: number,
    searchStartEvent?: number,
    searchEndEvent?: number,
    config?: any
  ): Promise<ArgumentCandidate[]> {
    const candidates: ArgumentCandidate[] = [];

    // Search for plaintiff opening
    const plaintiffOpening = await this.accumulator.findLongestStatement({
      trialId,
      speakerType: 'ATTORNEY',
      attorneyRole: 'PLAINTIFF',
      searchStartEvent,
      searchEndEvent,
      minWords: config?.minWords || 400,
      maxInterruptionRatio: config?.maxInterruptionRatio || 0.4,
      ratioMode: config?.ratioMode || 'SMART_EXTEND',
      ratioThreshold: config?.ratioThreshold || 0.4,
      aggregateTeam: true
    });

    if (plaintiffOpening && plaintiffOpening.confidence > 0.4) {
      candidates.push({
        ...plaintiffOpening,
        role: 'PLAINTIFF',
        type: 'OPENING',
        metadata: { ...plaintiffOpening.metadata, strategy: 'plaintiff-first' }
      } as ArgumentCandidate);

      // Search for defense opening AFTER plaintiff
      const defenseOpening = await this.accumulator.findLongestStatement({
        trialId,
        speakerType: 'ATTORNEY',
        attorneyRole: 'DEFENDANT',
        searchStartEvent: plaintiffOpening.endEvent.id + 1,
        searchEndEvent,
        minWords: config?.minWords || 400,
        maxInterruptionRatio: config?.maxInterruptionRatio || 0.4,
        ratioMode: config?.ratioMode || 'SMART_EXTEND',
        ratioThreshold: config?.ratioThreshold || 0.4,
        aggregateTeam: true
      });

      if (defenseOpening && defenseOpening.confidence > 0.4) {
        candidates.push({
          ...defenseOpening,
          role: 'DEFENDANT',
          type: 'OPENING',
          metadata: { ...defenseOpening.metadata, strategy: 'plaintiff-first' }
        } as ArgumentCandidate);
      }
    }

    return candidates;
  }

  /**
   * Strategy: Search for both in parallel
   */
  private async searchOpeningParallel(
    trialId: number,
    searchStartEvent?: number,
    searchEndEvent?: number,
    config?: any
  ): Promise<ArgumentCandidate[]> {
    const candidates: ArgumentCandidate[] = [];

    // Search for both independently
    const [plaintiffOpening, defenseOpening] = await Promise.all([
      this.accumulator.findLongestStatement({
        trialId,
        speakerType: 'ATTORNEY',
        attorneyRole: 'PLAINTIFF',
        searchStartEvent,
        searchEndEvent,
        minWords: config?.minWords || 400,
        maxInterruptionRatio: config?.maxInterruptionRatio || 0.4,
        ratioMode: config?.ratioMode || 'SMART_EXTEND',
        ratioThreshold: config?.ratioThreshold || 0.4,
        aggregateTeam: true
      }),
      this.accumulator.findLongestStatement({
        trialId,
        speakerType: 'ATTORNEY',
        attorneyRole: 'DEFENDANT',
        searchStartEvent,
        searchEndEvent,
        minWords: config?.minWords || 400,
        maxInterruptionRatio: config?.maxInterruptionRatio || 0.4,
        ratioMode: config?.ratioMode || 'SMART_EXTEND',
        ratioThreshold: config?.ratioThreshold || 0.4,
        aggregateTeam: true
      })
    ]);

    if (plaintiffOpening && plaintiffOpening.confidence > 0.4) {
      candidates.push({
        ...plaintiffOpening,
        role: 'PLAINTIFF',
        type: 'OPENING',
        metadata: { ...plaintiffOpening.metadata, strategy: 'parallel' }
      } as ArgumentCandidate);
    }

    if (defenseOpening && defenseOpening.confidence > 0.4) {
      candidates.push({
        ...defenseOpening,
        role: 'DEFENDANT',
        type: 'OPENING',
        metadata: { ...defenseOpening.metadata, strategy: 'parallel' }
      } as ArgumentCandidate);
    }

    return candidates;
  }

  /**
   * Strategy: Search for defense closing first (often easier to detect)
   */
  private async searchClosingDefenseFirst(
    trialId: number,
    searchStartEvent?: number,
    searchEndEvent?: number,
    config?: any
  ): Promise<ArgumentCandidate[]> {
    const candidates: ArgumentCandidate[] = [];

    this.logger.info(`[defense-first] Searching for defense closing between ${searchStartEvent} and ${searchEndEvent}`);

    // Search for defense closing
    const defenseClosing = await this.accumulator.findLongestStatement({
      trialId,
      speakerType: 'ATTORNEY',
      attorneyRole: 'DEFENDANT',
      searchStartEvent,
      searchEndEvent,
      minWords: config?.minWords || 500,
      maxInterruptionRatio: config?.maxInterruptionRatio || 0.25,
      ratioMode: config?.ratioMode || 'SMART_EXTEND',
      ratioThreshold: config?.ratioThreshold || 0.5,
      aggregateTeam: true
    });

    if (defenseClosing && defenseClosing.confidence > 0.5) {
      this.logger.info(`[defense-first] Found defense closing at events ${defenseClosing.startEvent.id}-${defenseClosing.endEvent.id}`);

      candidates.push({
        ...defenseClosing,
        role: 'DEFENDANT',
        type: 'CLOSING',
        metadata: { ...defenseClosing.metadata, strategy: 'defense-first' }
      } as ArgumentCandidate);

      // Search for plaintiff closing BEFORE defense
      const plaintiffSearchEnd = defenseClosing.startEvent.id - 1;
      this.logger.info(`[defense-first] Searching for plaintiff closing between ${searchStartEvent} and ${plaintiffSearchEnd}`);

      const plaintiffClosing = await this.accumulator.findLongestStatement({
        trialId,
        speakerType: 'ATTORNEY',
        attorneyRole: 'PLAINTIFF',
        searchStartEvent,
        searchEndEvent: plaintiffSearchEnd,
        minWords: config?.minWords || 500,
        maxInterruptionRatio: config?.maxInterruptionRatio || 0.25,
        ratioMode: config?.ratioMode || 'SMART_EXTEND',
        ratioThreshold: config?.ratioThreshold || 0.5,
        aggregateTeam: true
      });

      if (plaintiffClosing && plaintiffClosing.confidence > 0.5) {
        this.logger.info(`[defense-first] Found plaintiff closing at events ${plaintiffClosing.startEvent.id}-${plaintiffClosing.endEvent.id}`);
        candidates.push({
          ...plaintiffClosing,
          role: 'PLAINTIFF',
          type: 'CLOSING',
          metadata: { ...plaintiffClosing.metadata, strategy: 'defense-first' }
        } as ArgumentCandidate);
      } else {
        this.logger.warn(`[defense-first] No plaintiff closing found before defense (confidence: ${plaintiffClosing?.confidence || 0})`);
      }

      // Search for plaintiff rebuttal AFTER defense
      const plaintiffRebuttal = await this.accumulator.findLongestStatement({
        trialId,
        speakerType: 'ATTORNEY',
        attorneyRole: 'PLAINTIFF',
        searchStartEvent: defenseClosing.endEvent.id + 1,
        searchEndEvent,
        minWords: Math.floor((config?.minWords || 500) / 2),
        maxInterruptionRatio: 0.35,
        ratioMode: config?.ratioMode || 'SMART_EXTEND',
        ratioThreshold: (config?.ratioThreshold || 0.5) * 0.8,
        aggregateTeam: true
      });

      if (plaintiffRebuttal && plaintiffRebuttal.confidence > 0.4) {
        candidates.push({
          ...plaintiffRebuttal,
          role: 'PLAINTIFF',
          type: 'REBUTTAL',
          metadata: { ...plaintiffRebuttal.metadata, strategy: 'defense-first' }
        } as ArgumentCandidate);
      }
    }

    return candidates;
  }

  /**
   * Strategy: Search for plaintiff closing first
   */
  private async searchClosingPlaintiffFirst(
    trialId: number,
    searchStartEvent?: number,
    searchEndEvent?: number,
    config?: any
  ): Promise<ArgumentCandidate[]> {
    const candidates: ArgumentCandidate[] = [];

    // Search for plaintiff closing
    const plaintiffClosing = await this.accumulator.findLongestStatement({
      trialId,
      speakerType: 'ATTORNEY',
      attorneyRole: 'PLAINTIFF',
      searchStartEvent,
      searchEndEvent,
      minWords: config?.minWords || 500,
      maxInterruptionRatio: config?.maxInterruptionRatio || 0.25,
      ratioMode: config?.ratioMode || 'SMART_EXTEND',
      ratioThreshold: config?.ratioThreshold || 0.5,
      aggregateTeam: true
    });

    if (plaintiffClosing && plaintiffClosing.confidence > 0.5) {
      candidates.push({
        ...plaintiffClosing,
        role: 'PLAINTIFF',
        type: 'CLOSING',
        metadata: { ...plaintiffClosing.metadata, strategy: 'plaintiff-first' }
      } as ArgumentCandidate);

      // Search for defense closing AFTER plaintiff
      const defenseClosing = await this.accumulator.findLongestStatement({
        trialId,
        speakerType: 'ATTORNEY',
        attorneyRole: 'DEFENDANT',
        searchStartEvent: plaintiffClosing.endEvent.id + 1,
        searchEndEvent,
        minWords: config?.minWords || 500,
        maxInterruptionRatio: config?.maxInterruptionRatio || 0.25,
        ratioMode: config?.ratioMode || 'SMART_EXTEND',
        ratioThreshold: config?.ratioThreshold || 0.5,
        aggregateTeam: true
      });

      if (defenseClosing && defenseClosing.confidence > 0.5) {
        candidates.push({
          ...defenseClosing,
          role: 'DEFENDANT',
          type: 'CLOSING',
          metadata: { ...defenseClosing.metadata, strategy: 'plaintiff-first' }
        } as ArgumentCandidate);

        // Search for plaintiff rebuttal AFTER defense
        const plaintiffRebuttal = await this.accumulator.findLongestStatement({
          trialId,
          speakerType: 'ATTORNEY',
          attorneyRole: 'PLAINTIFF',
          searchStartEvent: defenseClosing.endEvent.id + 1,
          searchEndEvent,
          minWords: Math.floor((config?.minWords || 500) / 2),
          maxInterruptionRatio: 0.35,
          ratioMode: config?.ratioMode || 'SMART_EXTEND',
          ratioThreshold: (config?.ratioThreshold || 0.5) * 0.8,
          aggregateTeam: true
        });

        if (plaintiffRebuttal && plaintiffRebuttal.confidence > 0.4) {
          candidates.push({
            ...plaintiffRebuttal,
            role: 'PLAINTIFF',
            type: 'REBUTTAL',
            metadata: { ...plaintiffRebuttal.metadata, strategy: 'plaintiff-first' }
          } as ArgumentCandidate);
        }
      }
    }

    return candidates;
  }

  /**
   * Strategy: Find all high-word statements and sort chronologically
   */
  private async searchClosingChronological(
    trialId: number,
    searchStartEvent?: number,
    searchEndEvent?: number,
    config?: any
  ): Promise<ArgumentCandidate[]> {
    const candidates: ArgumentCandidate[] = [];

    // Find high-word attorney statements - lower threshold to catch more
    const highWordEvents = await this.prisma.trialEvent.findMany({
      where: {
        trialId,
        id: {
          gte: searchStartEvent || 0,
          lte: searchEndEvent || 999999
        },
        eventType: 'STATEMENT',
        wordCount: { gte: Math.floor((config?.minWords || 500) * 0.6) }, // Lower to 60% to catch more
        statement: {
          speaker: {
            speakerType: 'ATTORNEY'
          }
        }
      },
      include: {
        statement: {
          include: { speaker: true }
        }
      },
      orderBy: { id: 'asc' },
      take: 20  // Increased from 10 to 20
    });

    // Group consecutive events by speaker
    for (let i = 0; i < highWordEvents.length; i++) {
      const event = highWordEvents[i];

      // Determine role based on speaker
      const role = await this.determineAttorneyRole(trialId, event.statement?.speaker?.speakerHandle || '');

      if (!role) continue;

      // Look for consecutive events from same side
      let endIdx = i;
      let totalWords = event.wordCount || 0;

      while (endIdx < highWordEvents.length - 1) {
        const nextEvent = highWordEvents[endIdx + 1];
        const nextRole = await this.determineAttorneyRole(trialId, nextEvent.statement?.speaker?.speakerHandle || '');

        if (nextRole === role && nextEvent.id - highWordEvents[endIdx].id <= 20) {
          endIdx++;
          totalWords += nextEvent.wordCount || 0;
        } else {
          break;
        }
      }

      // Determine type based on position
      let type: 'CLOSING' | 'REBUTTAL' = 'CLOSING';
      if (role === 'PLAINTIFF' && candidates.some(c => c.role === 'PLAINTIFF' && c.type === 'CLOSING')) {
        type = 'REBUTTAL';
      }

      candidates.push({
        startEvent: event,
        endEvent: highWordEvents[endIdx],
        totalWords,
        speakerWords: totalWords * 0.9, // Estimate
        speakerRatio: 0.9,
        confidence: 0.7,
        role: role as 'PLAINTIFF' | 'DEFENDANT',
        type,
        metadata: { strategy: 'chronological' }
      } as ArgumentCandidate);

      i = endIdx; // Skip processed events
    }

    return candidates;
  }

  /**
   * Optimize candidate boundaries to ensure proper start/end speakers
   */
  private async optimizeCandidateBoundaries(
    candidates: ArgumentCandidate[],
    trialId: number
  ): Promise<void> {
    for (const candidate of candidates) {
      if (!candidate.role) continue;

      const optimized = await this.boundaryOptimizer.optimizeBoundaries(
        trialId,
        candidate.startEvent.id,
        candidate.endEvent.id,
        candidate.role
      );

      // Update candidate with optimized boundaries if better
      if (optimized.violations.length === 0 ||
          optimized.violations.length < (candidate.hasInvalidSpeakers ? 2 : 0)) {
        this.logger.info(`Optimized boundaries for ${candidate.role} ${candidate.type}: ${candidate.startEvent.id}-${candidate.endEvent.id} -> ${optimized.startEvent.id}-${optimized.endEvent.id}`);

        candidate.startEvent = optimized.startEvent;
        candidate.endEvent = optimized.endEvent;
        candidate.totalWords = optimized.totalWords;
        candidate.speakerWords = optimized.attorneyWords;
        candidate.speakerRatio = optimized.attorneyRatio;
        candidate.hasInvalidSpeakers = optimized.violations.length > 0;

        // Add optimization info to metadata
        if (!candidate.metadata) candidate.metadata = {};
        candidate.metadata.optimized = true;
        candidate.metadata.originalStart = candidate.startEvent.id;
        candidate.metadata.originalEnd = candidate.endEvent.id;
      }
    }
  }

  /**
   * Validate candidates - check for invalid speakers (witnesses/jurors)
   */
  private async validateAndScoreCandidates(
    candidates: ArgumentCandidate[],
    trialId: number
  ): Promise<void> {
    for (const candidate of candidates) {
      let validationScore = 1.0;

      // Check for invalid speakers in the range
      const eventsInRange = await this.prisma.trialEvent.findMany({
        where: {
          trialId,
          id: {
            gte: candidate.startEvent.id,
            lte: candidate.endEvent.id
          },
          eventType: 'STATEMENT'
        },
        include: {
          statement: {
            include: { speaker: true }
          }
        }
      });

      let witnessStatements = 0;
      let jurorStatements = 0;
      let attorneyStatements = 0;
      let judgeStatements = 0;

      for (const event of eventsInRange) {
        const speakerType = event.statement?.speaker?.speakerType;
        if (speakerType === 'WITNESS') witnessStatements++;
        else if (speakerType === 'JUROR') jurorStatements++;
        else if (speakerType === 'ATTORNEY') attorneyStatements++;
        else if (speakerType === 'JUDGE') judgeStatements++;
      }

      // Penalize for witness/juror statements
      if (witnessStatements > 0) {
        validationScore -= 0.5;
        candidate.hasInvalidSpeakers = true;
        this.logger.warn(`Candidate has ${witnessStatements} witness statements - likely not an argument`);
      }

      if (jurorStatements > 0) {
        validationScore -= 0.5;
        candidate.hasInvalidSpeakers = true;
        this.logger.warn(`Candidate has ${jurorStatements} juror statements - likely not an argument`);
      }

      // Bonus for high attorney dominance
      const attorneyDominance = attorneyStatements / eventsInRange.length;
      validationScore += attorneyDominance * 0.2;

      // Penalty for too many judge interruptions
      const judgeRatio = judgeStatements / eventsInRange.length;
      if (judgeRatio > 0.2) {
        validationScore -= (judgeRatio - 0.2) * 0.3;
      }

      // Check chronological order for closing arguments
      if (candidate.type === 'CLOSING' || candidate.type === 'REBUTTAL') {
        // Plaintiff closing should come before defense closing
        // Defense closing should come before plaintiff rebuttal
        // Add logic here if needed
      }

      candidate.validationScore = Math.max(0, Math.min(1, validationScore));

      this.logger.debug(`Candidate ${candidate.role} ${candidate.type}: validation score ${validationScore.toFixed(2)}`);
    }
  }

  /**
   * Select best opening combination from candidates
   */
  private selectBestOpeningCombination(
    candidates: ArgumentCandidate[]
  ): {
    plaintiffOpening: ArgumentCandidate | null;
    defenseOpening: ArgumentCandidate | null;
  } {
    // Filter out invalid candidates
    const validCandidates = candidates.filter(c =>
      !c.hasInvalidSpeakers && (c.validationScore || 0) > 0.3
    );

    // Group by role and type
    const plaintiffOpenings = validCandidates.filter(c => c.role === 'PLAINTIFF' && c.type === 'OPENING');
    const defenseOpenings = validCandidates.filter(c => c.role === 'DEFENDANT' && c.type === 'OPENING');

    // Sort by combined confidence and validation score
    plaintiffOpenings.sort((a, b) =>
      (b.confidence * (b.validationScore || 1)) - (a.confidence * (a.validationScore || 1))
    );
    defenseOpenings.sort((a, b) =>
      (b.confidence * (b.validationScore || 1)) - (a.confidence * (a.validationScore || 1))
    );

    // Pick best of each
    const plaintiffOpening = plaintiffOpenings[0] || null;
    const defenseOpening = defenseOpenings[0] || null;

    // Verify chronological order if both found
    if (plaintiffOpening && defenseOpening) {
      if (plaintiffOpening.startEvent.id > defenseOpening.endEvent.id) {
        this.logger.warn('Plaintiff opening after defense - likely misidentified');
        // Swap or invalidate as needed
      }
    }

    return { plaintiffOpening, defenseOpening };
  }

  /**
   * Select best closing combination from candidates
   */
  private selectBestClosingCombination(
    candidates: ArgumentCandidate[]
  ): {
    plaintiffClosing: ArgumentCandidate | null;
    defenseClosing: ArgumentCandidate | null;
    plaintiffRebuttal: ArgumentCandidate | null;
  } {
    // Filter out invalid candidates
    const validCandidates = candidates.filter(c =>
      !c.hasInvalidSpeakers && (c.validationScore || 0) > 0.3
    );

    // Sort all candidates by start event to understand chronological order
    validCandidates.sort((a, b) => a.startEvent.id - b.startEvent.id);

    this.logger.info(`[selectBest] Have ${validCandidates.length} valid candidates`);
    validCandidates.forEach(c => {
      this.logger.debug(`  ${c.role} ${c.type}: events ${c.startEvent.id}-${c.endEvent.id}, conf ${c.confidence}`);
    });

    // First, identify the defense closing (usually most reliable)
    const defenseClosings = validCandidates.filter(c => c.role === 'DEFENDANT' && c.type === 'CLOSING');
    defenseClosings.sort((a, b) => b.confidence * (b.validationScore || 1) - a.confidence * (a.validationScore || 1));
    const defenseClosing: ArgumentCandidate | null = defenseClosings[0] || null;

    // Now identify plaintiff statements based on position relative to defense
    let plaintiffClosing: ArgumentCandidate | null = null;
    let plaintiffRebuttal: ArgumentCandidate | null = null;

    if (defenseClosing) {
      // Find plaintiff statements before and after defense
      const plaintiffBeforeDefense = validCandidates.filter(c =>
        c.role === 'PLAINTIFF' && c.endEvent.id < defenseClosing.startEvent.id
      );
      const plaintiffAfterDefense = validCandidates.filter(c =>
        c.role === 'PLAINTIFF' && c.startEvent.id > defenseClosing.endEvent.id
      );

      // Best plaintiff statement BEFORE defense is the main closing
      if (plaintiffBeforeDefense.length > 0) {
        plaintiffBeforeDefense.sort((a, b) => b.confidence * (b.validationScore || 1) - a.confidence * (a.validationScore || 1));
        plaintiffClosing = plaintiffBeforeDefense[0];
        // Override type to ensure it's marked as closing
        plaintiffClosing.type = 'CLOSING';
      }

      // Best plaintiff statement AFTER defense is the rebuttal
      if (plaintiffAfterDefense.length > 0) {
        plaintiffAfterDefense.sort((a, b) => b.confidence * (b.validationScore || 1) - a.confidence * (a.validationScore || 1));
        plaintiffRebuttal = plaintiffAfterDefense[0];
        // Override type to ensure it's marked as rebuttal
        plaintiffRebuttal.type = 'REBUTTAL';
      }
    } else {
      // No defense closing found, use type as assigned
      const plaintiffClosings = validCandidates.filter(c => c.role === 'PLAINTIFF' && c.type === 'CLOSING');
      const plaintiffRebuttals = validCandidates.filter(c => c.role === 'PLAINTIFF' && c.type === 'REBUTTAL');

      plaintiffClosings.sort((a, b) => b.confidence * (b.validationScore || 1) - a.confidence * (a.validationScore || 1));
      plaintiffRebuttals.sort((a, b) => b.confidence * (b.validationScore || 1) - a.confidence * (a.validationScore || 1));

      plaintiffClosing = plaintiffClosings[0] || null;
      plaintiffRebuttal = plaintiffRebuttals[0] || null;
    }

    // Verify chronological order
    if (plaintiffClosing && defenseClosing) {
      if (plaintiffClosing.startEvent.id > defenseClosing.endEvent.id) {
        // Defense comes before plaintiff - might need to swap
        this.logger.warn('Chronological order issue: defense closing before plaintiff closing');
      }
    }

    if (defenseClosing && plaintiffRebuttal) {
      if (plaintiffRebuttal.startEvent.id < defenseClosing.endEvent.id) {
        // Rebuttal before defense - invalid
        this.logger.warn('Invalid: plaintiff rebuttal before defense closing');
        plaintiffRebuttal = null;
      }
    }

    return { plaintiffClosing, defenseClosing, plaintiffRebuttal };
  }

  /**
   * Determine attorney role from speaker handle
   */
  private async determineAttorneyRole(
    trialId: number,
    speakerHandle: string
  ): Promise<'PLAINTIFF' | 'DEFENDANT' | null> {
    if (!speakerHandle) return null;

    // Look up in database
    const attorney = await this.prisma.trialAttorney.findFirst({
      where: {
        trialId,
        speaker: {
          speakerHandle
        }
      }
    });

    if (attorney?.role === 'PLAINTIFF' || attorney?.role === 'DEFENDANT') {
      return attorney.role as 'PLAINTIFF' | 'DEFENDANT';
    }

    // Try pattern matching as fallback
    const plaintiffPatterns = ['DACUS', 'KUBEHL', 'PANKRATZ', 'BAXTER'];
    const defensePatterns = ['VERHOEVEN', 'MACK', 'EISEMAN', 'YANG'];

    const handleUpper = speakerHandle.toUpperCase();

    if (plaintiffPatterns.some(p => handleUpper.includes(p))) {
      return 'PLAINTIFF';
    }

    if (defensePatterns.some(p => handleUpper.includes(p))) {
      return 'DEFENDANT';
    }

    return null;
  }
}