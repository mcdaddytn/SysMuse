import {
  PrismaClient,
  TrialEvent,
  StatementEvent,
  Speaker,
  Attorney,
  AttorneyRole
} from '@prisma/client';
import { Logger } from '../utils/logger';
import * as fs from 'fs';
import * as path from 'path';

// Extended params to include state tracking options
export interface LongStatementParamsV3 {
  trialId: number;
  trialName?: string;
  speakerType: 'ATTORNEY' | 'WITNESS' | 'JUDGE';
  attorneyRole?: 'PLAINTIFF' | 'DEFENDANT';
  searchStartEvent?: number;
  searchEndEvent?: number;
  minWords: number;
  maxInterruptionRatio: number;
  ratioMode?: 'TRADITIONAL' | 'WEIGHTED_SQRT' | 'WEIGHTED_SQRT2' | 'WEIGHTED_SQRT3' | 'TEAM_AGGREGATE';
  ratioThreshold?: number;
  aggregateTeam?: boolean;

  // New parameters for enhanced algorithm
  trackEvaluations?: boolean;
  outputDir?: string;
  requireInitialThreshold?: boolean;
  breakOnOpposingLongStatement?: boolean;
  maxExtensionAttempts?: number;
  declineThreshold?: number;
  statementType?: 'opening' | 'closing';
  displayWindowSize?: number; // Number of statements to include in display window (default: 9)
  maxDisplayWords?: number; // Max words for non-evaluation statements (default: 100)
}

export interface StatementResultV3 {
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
    windowId?: string;
  };
}

// Individual statement in display window
interface DisplayStatement {
  statementId: number;
  speaker: string;
  text: string;
  wordCount: number;
  isInEvaluationWindow: boolean;
  contributesToScore: boolean;
  speakerRole?: 'PLAINTIFF' | 'DEFENDANT' | 'COURT' | 'JUROR' | 'OTHER';
}

// Window evaluation tracking structure
interface WindowEvaluation {
  windowId: string;
  startEventId: number;
  endEventId: number;
  speakerRole: 'PLAINTIFF' | 'DEFENDANT' | 'OTHER';
  evaluation: {
    initialStatement: {
      eventId: number;
      speaker: string;
      wordCount: number;
      meetsThreshold: boolean;
      text?: string;
      targetSpeakerWords?: number;
      targetSpeakerStatements?: number;
      otherSpeakerWords?: number;
      otherSpeakerStatements?: number;
      targetSpeakerRatio?: number;
      otherSpeakerRatio?: number;
      ratio?: number;
    };
    extensions: Array<{
      step: number;
      addedEventId: number;
      addedSpeaker: string;
      addedWords: number;
      ratio: number;
      decision: 'extend' | 'stop';
      reason?: string;
      totalWords: number;
      speakerWords: number;
      targetSpeakerWords?: number;
      targetSpeakerStatements?: number;
      otherSpeakerWords?: number;
      otherSpeakerStatements?: number;
      targetSpeakerRatio?: number;
      otherSpeakerRatio?: number;
    }>;
    finalRatio: number;
    selected: boolean;
    selectionReason?: string;
  };
  displayWindow?: DisplayStatement[];
}

interface SearchEvaluation {
  trial: string;
  phase: 'opening' | 'closing';
  searchStrategy: string;
  enclosingWindow: {
    start: number;
    end: number;
  };
  evaluations: WindowEvaluation[];
  finalSelection?: {
    windowId: string;
    startEvent: number;
    endEvent: number;
    ratio: number;
    displayWindow?: DisplayStatement[];
  };
}

export class LongStatementsAccumulatorV3 {
  private logger = new Logger('LongStatementsAccumulatorV3');
  private teamAttorneyCache: Map<string, Set<string>> = new Map();
  private currentEvaluations: WindowEvaluation[] = [];
  private searchEvaluation: SearchEvaluation | null = null;

  constructor(private prisma: PrismaClient) {}

  /**
   * Enhanced findLongestStatement with state tracking
   */
  async findLongestStatement(params: LongStatementParamsV3): Promise<StatementResultV3 | null> {
    this.logger.info(`Finding longest statement for ${params.speakerType} ${params.attorneyRole || ''} in trial ${params.trialId}`);

    // Initialize search evaluation tracking
    if (params.trackEvaluations) {
      this.searchEvaluation = {
        trial: params.trialName || `trial_${params.trialId}`,
        phase: params.statementType || 'opening',
        searchStrategy: 'defense-first-enhanced',
        enclosingWindow: {
          start: params.searchStartEvent || 0,
          end: params.searchEndEvent || 999999
        },
        evaluations: []
      };
      this.currentEvaluations = [];
    }

    // Step 1: Refine enclosing window if needed
    const refinedWindow = await this.refineEnclosingWindow(params);
    if (this.searchEvaluation && refinedWindow) {
      this.searchEvaluation.enclosingWindow = refinedWindow;
    }

    // Step 2: Find candidate starting statements
    const candidates = await this.findCandidateStartingStatements(params);
    this.logger.info(`Found ${candidates.length} candidate starting statements`);

    // Step 3: Evaluate each candidate window
    let bestResult: StatementResultV3 | null = null;
    let bestRatio = 0;
    let bestEvaluation: WindowEvaluation | null = null;
    let bestCandidate: any = null;

    for (const candidate of candidates) {
      const evaluation = await this.evaluateWindow(candidate, params);

      // Build display window if tracking
      if (params.trackEvaluations && params.displayWindowSize) {
        evaluation.displayWindow = await this.buildDisplayWindow(evaluation, params);
      }

      if (params.trackEvaluations) {
        this.currentEvaluations.push(evaluation);
      }

      // Check if this is the best candidate so far
      if (evaluation.evaluation.finalRatio > bestRatio) {
        bestRatio = evaluation.evaluation.finalRatio;
        bestResult = await this.createResultFromEvaluation(evaluation, candidate);
        bestEvaluation = evaluation;
        bestCandidate = candidate;

        // Mark as selected
        evaluation.evaluation.selected = true;
        evaluation.evaluation.selectionReason = 'highest_ratio';
      }
    }

    // Step 4: Save evaluation log if tracking
    if (params.trackEvaluations && this.searchEvaluation) {
      this.searchEvaluation.evaluations = this.currentEvaluations;
      if (bestResult && bestEvaluation) {
        this.searchEvaluation.finalSelection = {
          windowId: bestEvaluation.windowId,
          startEvent: bestResult.startEvent.id,
          endEvent: bestResult.endEvent.id,
          ratio: bestResult.speakerRatio,
          displayWindow: bestEvaluation.displayWindow
        };
      }
      await this.saveEvaluationLog(params, this.searchEvaluation);
    }

    return bestResult;
  }

  /**
   * Refine enclosing window based on juror statements
   */
  private async refineEnclosingWindow(params: LongStatementParamsV3): Promise<{
    start: number;
    end: number;
  } | null> {
    if (!params.searchStartEvent || !params.searchEndEvent) {
      return null;
    }

    let refined = false;
    let startEvent = params.searchStartEvent;
    let endEvent = params.searchEndEvent;

    // For opening statements, find last juror statement to refine start
    if (params.statementType === 'opening') {
      const lastJurorEvent = await this.findLastJurorStatement(
        params.trialId,
        params.searchStartEvent,
        params.searchEndEvent
      );
      if (lastJurorEvent && lastJurorEvent.id > startEvent) {
        this.logger.info(`Refining opening window start from ${startEvent} to ${lastJurorEvent.id + 1} (after last juror)`);
        startEvent = lastJurorEvent.id + 1;
        refined = true;
      }
    }

    // For closing statements, find first juror statement at end to refine
    if (params.statementType === 'closing') {
      const firstJurorEvent = await this.findFirstJurorStatement(
        params.trialId,
        params.searchStartEvent,
        params.searchEndEvent
      );
      if (firstJurorEvent && firstJurorEvent.id < endEvent) {
        this.logger.info(`Refining closing window end from ${endEvent} to ${firstJurorEvent.id - 1} (before first juror)`);
        endEvent = firstJurorEvent.id - 1;
        refined = true;
      }
    }

    return { start: startEvent, end: endEvent };
  }

  /**
   * Find candidate starting statements that meet minWords threshold
   */
  private async findCandidateStartingStatements(params: LongStatementParamsV3): Promise<TrialEvent[]> {
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

    // Get all statement events in range
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

    // Filter for candidates that meet criteria
    const candidates: TrialEvent[] = [];

    for (const event of events) {
      if (!event.statement || !event.wordCount || !event.statement.speaker) continue;

      // Check if this event meets the minWords threshold
      if (event.wordCount >= params.minWords) {
        // Check if it's the right speaker type
        if (params.speakerType === 'ATTORNEY' && event.statement.speaker.speakerType === 'ATTORNEY') {
          // Check attorney role if specified
          if (params.attorneyRole) {
            // Check if this speaker has the right role
            const attorneyRecord = await this.prisma.trialAttorney.findFirst({
              where: {
                trialId: params.trialId,
                speakerId: event.statement.speaker.id,
                role: params.attorneyRole
              }
            });
            if (attorneyRecord) {
              candidates.push(event);
              this.logger.info(`Candidate ${event.id}: ${event.statement.speaker.speakerHandle} (${event.wordCount} words)`);
            }
          } else {
            candidates.push(event);
          }
        }
      }
    }

    return candidates;
  }

  /**
   * Evaluate a candidate window by extending it forward
   */
  private async evaluateWindow(
    initialEvent: any,
    params: LongStatementParamsV3
  ): Promise<WindowEvaluation> {
    const windowId = `${params.attorneyRole || 'unknown'}_${initialEvent.id}`;

    const evaluation: WindowEvaluation = {
      windowId,
      startEventId: initialEvent.id,
      endEventId: initialEvent.id,
      speakerRole: params.attorneyRole || 'OTHER',
      evaluation: {
        initialStatement: {
          eventId: initialEvent.id,
          speaker: initialEvent.statement?.speaker.speakerHandle || 'UNKNOWN',
          wordCount: initialEvent.wordCount || 0,
          meetsThreshold: (initialEvent.wordCount || 0) >= params.minWords,
          text: this.truncateText(initialEvent.statement?.text || '', 50)
        },
        extensions: [],
        finalRatio: 0,
        selected: false
      }
    };

    // Only proceed if initial statement meets threshold (when required)
    if (params.requireInitialThreshold !== false && !evaluation.evaluation.initialStatement.meetsThreshold) {
      this.logger.info(`Initial event ${initialEvent.id} does not meet threshold (${initialEvent.wordCount} < ${params.minWords})`);
      return evaluation;
    }

    // Build the window by extending forward
    let currentWindow = [initialEvent];
    const initialStats = await this.calculateSpeakerStatistics(currentWindow, params);
    let bestRatio = await this.calculateRatioWithStats(initialStats, params);
    evaluation.evaluation.finalRatio = bestRatio;

    // Store initial statement calculations
    evaluation.evaluation.initialStatement.targetSpeakerWords = initialStats.targetSpeakerWords;
    evaluation.evaluation.initialStatement.targetSpeakerStatements = initialStats.targetSpeakerStatements;
    evaluation.evaluation.initialStatement.otherSpeakerWords = initialStats.otherSpeakerWords;
    evaluation.evaluation.initialStatement.otherSpeakerStatements = initialStats.otherSpeakerStatements;
    evaluation.evaluation.initialStatement.targetSpeakerRatio = initialStats.targetSpeakerRatio;
    evaluation.evaluation.initialStatement.otherSpeakerRatio = initialStats.otherSpeakerRatio;
    evaluation.evaluation.initialStatement.ratio = bestRatio;

    const maxExtensions = params.maxExtensionAttempts || 20;
    const declineThreshold = params.declineThreshold || 0.05;
    let lastEvaluatedId = initialEvent.id;

    for (let step = 1; step <= maxExtensions; step++) {
      const nextEvent = await this.getNextStatementEvent(
        lastEvaluatedId,
        params.searchEndEvent
      );

      if (!nextEvent) {
        this.logger.info(`No more events after ${lastEvaluatedId}`);
        break;
      }

      lastEvaluatedId = nextEvent.id;

      // Check for deal-breakers
      if (params.breakOnOpposingLongStatement !== false) {
        const isOpposing = await this.isOpposingLongStatement(nextEvent, params);
        if (isOpposing) {
          const stats = await this.calculateSpeakerStatistics(currentWindow, params);
          evaluation.evaluation.extensions.push({
            step,
            addedEventId: nextEvent.id,
            addedSpeaker: nextEvent.statement?.speaker.speakerHandle || 'UNKNOWN',
            addedWords: nextEvent.wordCount || 0,
            ratio: bestRatio,
            decision: 'stop',
            reason: 'opposing_long_statement',
            totalWords: this.countTotalWords(currentWindow),
            speakerWords: await this.countSpeakerWords(currentWindow, params),
            targetSpeakerWords: stats.targetSpeakerWords,
            targetSpeakerStatements: stats.targetSpeakerStatements,
            otherSpeakerWords: stats.otherSpeakerWords,
            otherSpeakerStatements: stats.otherSpeakerStatements,
            targetSpeakerRatio: stats.targetSpeakerRatio,
            otherSpeakerRatio: stats.otherSpeakerRatio
          });
          break;
        }
      }

      // Look ahead for same-team content if current event is a short interruption
      let shouldExtend = false;
      let lookaheadReason = '';

      if (nextEvent.wordCount && nextEvent.wordCount < 50) {
        // This is a short interruption, look ahead for same-team content
        const lookaheadEvents = await this.getLookaheadEvents(nextEvent.id, params.searchEndEvent, 5);
        for (const futureEvent of lookaheadEvents) {
          if (await this.isSameTeamSpeaker(futureEvent, params)) {
            if ((futureEvent.wordCount || 0) >= params.minWords * 0.5) {
              // Significant same-team content ahead, extend through the interruption
              shouldExtend = true;
              lookaheadReason = `extending_to_reach_${futureEvent.statement?.speaker?.speakerHandle}_${futureEvent.wordCount}w`;
              break;
            }
          }
        }
      }

      // Try extending the window
      const extendedWindow = [...currentWindow, nextEvent];
      const extStats = await this.calculateSpeakerStatistics(extendedWindow, params);
      const newRatio = this.calculateRatioWithStats(extStats, params);

      // Decide whether to extend
      if (shouldExtend || newRatio >= bestRatio - declineThreshold) {
        // Accept extension
        currentWindow = extendedWindow;
        if (newRatio > bestRatio) {
          bestRatio = newRatio;
        }
        evaluation.endEventId = nextEvent.id;
        evaluation.evaluation.finalRatio = Math.max(evaluation.evaluation.finalRatio, newRatio);

        evaluation.evaluation.extensions.push({
          step,
          addedEventId: nextEvent.id,
          addedSpeaker: nextEvent.statement?.speaker.speakerHandle || 'UNKNOWN',
          addedWords: nextEvent.wordCount || 0,
          ratio: newRatio,
          decision: 'extend',
          reason: lookaheadReason || undefined,
          totalWords: this.countTotalWords(extendedWindow),
          speakerWords: await this.countSpeakerWords(extendedWindow, params),
          targetSpeakerWords: extStats.targetSpeakerWords,
          targetSpeakerStatements: extStats.targetSpeakerStatements,
          otherSpeakerWords: extStats.otherSpeakerWords,
          otherSpeakerStatements: extStats.otherSpeakerStatements,
          targetSpeakerRatio: extStats.targetSpeakerRatio,
          otherSpeakerRatio: extStats.otherSpeakerRatio
        });
      } else {
        // Check if next event is a deal-breaker (long statement from another speaker)
        const nextEventIsLongStatement = (nextEvent.wordCount || 0) >= params.minWords;
        const nextEventIsFromOtherSpeaker = !(await this.isTargetSpeaker(nextEvent, params));

        if (nextEventIsLongStatement && nextEventIsFromOtherSpeaker) {
          // This is a deal-breaker - another speaker with long statement
          const stopStats = await this.calculateSpeakerStatistics(currentWindow, params);
          evaluation.evaluation.extensions.push({
            step,
            addedEventId: nextEvent.id,
            addedSpeaker: nextEvent.statement?.speaker.speakerHandle || 'UNKNOWN',
            addedWords: nextEvent.wordCount || 0,
            ratio: bestRatio,
            decision: 'stop',
            reason: 'other_speaker_long_statement',
            totalWords: this.countTotalWords(currentWindow),
            speakerWords: await this.countSpeakerWords(currentWindow, params),
            targetSpeakerWords: stopStats.targetSpeakerWords,
            targetSpeakerStatements: stopStats.targetSpeakerStatements,
            otherSpeakerWords: stopStats.otherSpeakerWords,
            otherSpeakerStatements: stopStats.otherSpeakerStatements,
            targetSpeakerRatio: stopStats.targetSpeakerRatio,
            otherSpeakerRatio: stopStats.otherSpeakerRatio
          });
          break;
        } else {
          // Not a deal-breaker, but ratio declined - log it but continue evaluation
          // Use the extended window stats to show what the ratio would be if we added this event
          evaluation.evaluation.extensions.push({
            step,
            addedEventId: nextEvent.id,
            addedSpeaker: nextEvent.statement?.speaker.speakerHandle || 'UNKNOWN',
            addedWords: nextEvent.wordCount || 0,
            ratio: newRatio,  // Show the new ratio that would result
            decision: 'stop',
            reason: 'ratio_decline',
            totalWords: this.countTotalWords(extendedWindow),  // Extended window stats
            speakerWords: await this.countSpeakerWords(extendedWindow, params),
            targetSpeakerWords: extStats.targetSpeakerWords,  // Extended window stats
            targetSpeakerStatements: extStats.targetSpeakerStatements,
            otherSpeakerWords: extStats.otherSpeakerWords,
            otherSpeakerStatements: extStats.otherSpeakerStatements,
            targetSpeakerRatio: extStats.targetSpeakerRatio,
            otherSpeakerRatio: extStats.otherSpeakerRatio
          });
          // Don't break - continue to evaluate more extensions
        }
      }
    }

    return evaluation;
  }

  /**
   * Calculate ratio for a window of events using ratio of ratios approach
   */
  private async calculateRatio(events: any[], params: LongStatementParamsV3): Promise<number> {
    // Get detailed speaker statistics
    const stats = await this.calculateSpeakerStatistics(events, params);
    return this.calculateRatioWithStats(stats, params);
  }

  /**
   * Calculate ratio from pre-computed statistics
   */
  private calculateRatioWithStats(stats: any, params: LongStatementParamsV3): number {

    // Use WEIGHTED_SQRT by default as specified in the algorithm
    const ratioMode = params.ratioMode || 'WEIGHTED_SQRT';

    // Calculate target speaker ratio based on mode
    let targetSpeakerRatio = 0;
    if (stats.targetSpeakerStatements > 0) {
      switch (ratioMode) {
        case 'WEIGHTED_SQRT':
          targetSpeakerRatio = stats.targetSpeakerWords / Math.sqrt(stats.targetSpeakerStatements);
          break;
        case 'WEIGHTED_SQRT2':
          targetSpeakerRatio = Math.pow(stats.targetSpeakerWords, 2) / Math.sqrt(stats.targetSpeakerStatements);
          break;
        case 'WEIGHTED_SQRT3':
          targetSpeakerRatio = Math.pow(stats.targetSpeakerWords, 3) / Math.sqrt(stats.targetSpeakerStatements);
          break;
        case 'TRADITIONAL':
          targetSpeakerRatio = stats.targetSpeakerWords;
          break;
        case 'TEAM_AGGREGATE':
          targetSpeakerRatio = stats.targetSpeakerWords;
          break;
        default:
          targetSpeakerRatio = stats.targetSpeakerWords;
      }
    }

    // Calculate other speaker ratio based on mode
    let otherSpeakerRatio = 0;
    if (stats.otherSpeakerStatements > 0) {
      switch (ratioMode) {
        case 'WEIGHTED_SQRT':
          otherSpeakerRatio = stats.otherSpeakerWords / Math.sqrt(stats.otherSpeakerStatements);
          break;
        case 'WEIGHTED_SQRT2':
          otherSpeakerRatio = Math.pow(stats.otherSpeakerWords, 2) / Math.sqrt(stats.otherSpeakerStatements);
          break;
        case 'WEIGHTED_SQRT3':
          otherSpeakerRatio = Math.pow(stats.otherSpeakerWords, 3) / Math.sqrt(stats.otherSpeakerStatements);
          break;
        case 'TRADITIONAL':
          otherSpeakerRatio = stats.otherSpeakerWords;
          break;
        case 'TEAM_AGGREGATE':
          otherSpeakerRatio = stats.otherSpeakerWords;
          break;
        default:
          otherSpeakerRatio = stats.otherSpeakerWords;
      }
    }

    // Store ratios in stats for logging
    stats.targetSpeakerRatio = targetSpeakerRatio;
    stats.otherSpeakerRatio = otherSpeakerRatio;

    // For TRADITIONAL and TEAM_AGGREGATE modes, use simple ratio
    if (ratioMode === 'TRADITIONAL' || ratioMode === 'TEAM_AGGREGATE') {
      const totalWords = stats.targetSpeakerWords + stats.otherSpeakerWords;
      return totalWords > 0 ? stats.targetSpeakerWords / totalWords : 0;
    }

    // Calculate ratio of ratios (avoid division by zero)
    if (otherSpeakerRatio === 0 && targetSpeakerRatio > 0) {
      return 1; // Perfect ratio when only target speakers
    } else if (otherSpeakerRatio === 0) {
      return 0; // No speakers at all
    }

    return targetSpeakerRatio / otherSpeakerRatio;
  }

  /**
   * Calculate detailed speaker statistics for a window
   */
  private async calculateSpeakerStatistics(events: any[], params: LongStatementParamsV3): Promise<{
    targetSpeakerWords: number;
    targetSpeakerStatements: number;
    otherSpeakerWords: number;
    otherSpeakerStatements: number;
    targetSpeakerRatio?: number;
    otherSpeakerRatio?: number;
  }> {
    let targetSpeakerWords = 0;
    let targetSpeakerStatements = 0;
    let otherSpeakerWords = 0;
    let otherSpeakerStatements = 0;

    for (const event of events) {
      if (!event.statement?.speaker || !event.wordCount) continue;

      const isTargetSpeaker = await this.isTargetSpeaker(event, params);

      if (isTargetSpeaker) {
        targetSpeakerWords += event.wordCount;
        targetSpeakerStatements++;
      } else {
        otherSpeakerWords += event.wordCount;
        otherSpeakerStatements++;
      }
    }

    return {
      targetSpeakerWords,
      targetSpeakerStatements,
      otherSpeakerWords,
      otherSpeakerStatements
    };
  }

  /**
   * Check if an event is from a target speaker
   */
  private async isTargetSpeaker(event: any, params: LongStatementParamsV3): Promise<boolean> {
    if (!event.statement?.speaker) return false;

    const speaker = event.statement.speaker;

    // Check speaker type
    if (speaker.speakerType !== params.speakerType) return false;

    // For attorneys, check role
    if (params.speakerType === 'ATTORNEY' && params.attorneyRole) {
      if (params.aggregateTeam) {
        // Check if this attorney is on the team
        const teamAttorneys = await this.getTeamAttorneys(params.trialId, params.attorneyRole);
        return teamAttorneys.has(speaker.speakerHandle);
      } else {
        // Check individual attorney role
        const attorneyRecord = await this.prisma.trialAttorney.findFirst({
          where: {
            trialId: params.trialId,
            speakerId: speaker.id,
            role: params.attorneyRole
          }
        });
        return !!attorneyRecord;
      }
    }

    return true; // Speaker matches type but no role check needed
  }

  /**
   * Count total words in events
   */
  private countTotalWords(events: any[]): number {
    return events.reduce((sum, event) => sum + (event.wordCount || 0), 0);
  }

  /**
   * Count words from target speakers
   */
  private async countSpeakerWords(events: any[], params: LongStatementParamsV3): Promise<number> {
    let count = 0;

    for (const event of events) {
      if (!event.statement?.speaker) continue;

      const speaker = event.statement.speaker;

      // Check speaker type
      if (speaker.speakerType !== params.speakerType) continue;

      // For attorneys, check role
      if (params.speakerType === 'ATTORNEY' && params.attorneyRole) {
        if (params.aggregateTeam) {
          // Check if this attorney is on the team
          const teamAttorneys = await this.getTeamAttorneys(params.trialId, params.attorneyRole);
          if (teamAttorneys.has(speaker.speakerHandle)) {
            count += event.wordCount || 0;
          }
        } else {
          // Check individual attorney role
          const attorneyRecord = await this.prisma.trialAttorney.findFirst({
            where: {
              trialId: params.trialId,
              speakerId: speaker.id,
              role: params.attorneyRole
            }
          });
          if (attorneyRecord) {
            count += event.wordCount || 0;
          }
        }
      } else {
        count += event.wordCount || 0;
      }
    }

    return count;
  }

  /**
   * Get team attorneys for a role
   */
  private async getTeamAttorneys(trialId: number, role: AttorneyRole | string): Promise<Set<string>> {
    const cacheKey = `${trialId}_${role}`;

    if (this.teamAttorneyCache.has(cacheKey)) {
      return this.teamAttorneyCache.get(cacheKey)!;
    }

    const trialAttorneys = await this.prisma.trialAttorney.findMany({
      where: {
        trialId,
        role: role as AttorneyRole
      },
      include: {
        speaker: true
      }
    });

    const handles = new Set<string>();
    for (const ta of trialAttorneys) {
      if (ta.speaker?.speakerHandle) {
        handles.add(ta.speaker.speakerHandle);
      }
    }
    this.teamAttorneyCache.set(cacheKey, handles);
    return handles;
  }

  /**
   * Check if an event is an opposing long statement
   */
  private async isOpposingLongStatement(event: any, params: LongStatementParamsV3): Promise<boolean> {
    if (!event.statement?.speaker || !event.wordCount) return false;

    // Must meet minWords threshold
    if (event.wordCount < params.minWords) return false;

    const speaker = event.statement.speaker;

    // Must be an attorney
    if (speaker.speakerType !== 'ATTORNEY') return false;

    // Check if opposing role
    if (params.attorneyRole) {
      // Need to check if this speaker is an attorney with opposing role
      const attorneyRecord = await this.prisma.trialAttorney.findFirst({
        where: {
          trialId: params.trialId,
          speakerId: speaker.id
        }
      });
      if (attorneyRecord) {
        const opposingRole = params.attorneyRole === 'PLAINTIFF' ? 'DEFENDANT' : 'PLAINTIFF';
        return attorneyRecord.role === opposingRole;
      }
    }

    return false;
  }

  /**
   * Get next statement event
   */
  private async getNextStatementEvent(afterId: number, maxId?: number): Promise<any | null> {
    const where: any = {
      id: { gt: afterId },
      eventType: 'STATEMENT'
    };

    if (maxId) {
      where.id.lte = maxId;
    }

    return await this.prisma.trialEvent.findFirst({
      where,
      include: {
        statement: {
          include: {
            speaker: true
          }
        }
      },
      orderBy: { id: 'asc' }
    });
  }

  /**
   * Get lookahead events for checking future content
   */
  private async getLookaheadEvents(afterId: number, maxId?: number, limit: number = 5): Promise<any[]> {
    const where: any = {
      id: { gt: afterId },
      eventType: 'STATEMENT'
    };

    if (maxId) {
      where.id.lte = maxId;
    }

    return await this.prisma.trialEvent.findMany({
      where,
      include: {
        statement: {
          include: {
            speaker: true
          }
        }
      },
      orderBy: { id: 'asc' },
      take: limit
    });
  }

  /**
   * Check if an event speaker is on the same team
   */
  private async isSameTeamSpeaker(event: any, params: LongStatementParamsV3): Promise<boolean> {
    if (!event.statement?.speaker) return false;

    const speaker = event.statement.speaker;
    if (speaker.speakerType !== params.speakerType) return false;

    if (params.speakerType === 'ATTORNEY' && params.attorneyRole) {
      if (params.aggregateTeam) {
        const teamAttorneys = await this.getTeamAttorneys(params.trialId, params.attorneyRole);
        return teamAttorneys.has(speaker.speakerHandle);
      } else {
        const attorneyRecord = await this.prisma.trialAttorney.findFirst({
          where: {
            trialId: params.trialId,
            speakerId: speaker.id,
            role: params.attorneyRole
          }
        });
        return !!attorneyRecord;
      }
    }

    return false;
  }

  /**
   * Find last juror statement in range
   */
  private async findLastJurorStatement(
    trialId: number,
    startId: number,
    endId: number
  ): Promise<TrialEvent | null> {
    return await this.prisma.trialEvent.findFirst({
      where: {
        trialId,
        id: { gte: startId, lte: endId },
        eventType: 'STATEMENT',
        statement: {
          speaker: {
            speakerType: 'JUROR'
          }
        }
      },
      orderBy: { id: 'desc' }
    });
  }

  /**
   * Find first juror statement in range (searching from end)
   */
  private async findFirstJurorStatement(
    trialId: number,
    startId: number,
    endId: number
  ): Promise<TrialEvent | null> {
    // Find the first juror statement when searching backward from the end
    const jurorEvents = await this.prisma.trialEvent.findMany({
      where: {
        trialId,
        id: { gte: startId, lte: endId },
        eventType: 'STATEMENT',
        statement: {
          speaker: {
            speakerType: 'JUROR'
          }
        }
      },
      orderBy: { id: 'desc' },
      take: 10
    });

    // Return the one closest to the end (first when searching backward)
    return jurorEvents.length > 0 ? jurorEvents[0] : null;
  }

  /**
   * Build display window around evaluation window
   */
  private async buildDisplayWindow(
    evaluation: WindowEvaluation,
    params: LongStatementParamsV3
  ): Promise<DisplayStatement[]> {
    const displayWindowSize = params.displayWindowSize || 9;
    const maxDisplayWords = 50; // Always truncate to 50 words for display
    const displayStatements: DisplayStatement[] = [];

    // Determine evaluation window boundaries
    const evalStartId = evaluation.startEventId;
    const evalEndId = evaluation.endEventId;

    // Calculate how many statements to fetch before and after
    const halfWindow = Math.floor(displayWindowSize / 2);

    // Fetch statements before evaluation window
    const beforeStatements = await this.prisma.trialEvent.findMany({
      where: {
        trialId: params.trialId,
        id: { lt: evalStartId },
        eventType: 'STATEMENT'
      },
      include: {
        statement: {
          include: { speaker: true }
        }
      },
      orderBy: { id: 'desc' },
      take: halfWindow
    });

    // Fetch statements in evaluation window
    const evaluationStatements = await this.prisma.trialEvent.findMany({
      where: {
        trialId: params.trialId,
        id: { gte: evalStartId, lte: evalEndId },
        eventType: 'STATEMENT'
      },
      include: {
        statement: {
          include: { speaker: true }
        }
      },
      orderBy: { id: 'asc' }
    });

    // Fetch statements after evaluation window
    const remainingSlots = displayWindowSize - beforeStatements.length - evaluationStatements.length;
    const afterStatements = await this.prisma.trialEvent.findMany({
      where: {
        trialId: params.trialId,
        id: { gt: evalEndId },
        eventType: 'STATEMENT'
      },
      include: {
        statement: {
          include: { speaker: true }
        }
      },
      orderBy: { id: 'asc' },
      take: remainingSlots
    });

    // Build display statements array
    const allStatements = [
      ...beforeStatements.reverse(),
      ...evaluationStatements,
      ...afterStatements
    ];

    for (const stmt of allStatements) {
      if (!stmt.statement) continue;

      const isInEvalWindow = stmt.id >= evalStartId && stmt.id <= evalEndId;
      const speaker = stmt.statement.speaker;
      const isSameTeam = await this.isSameTeamSpeaker(stmt, params);

      let text = stmt.statement.text || '';
      let wordCount = stmt.wordCount || 0;

      // Truncate ALL text to maxDisplayWords
      if (text.split(' ').length > maxDisplayWords) {
        const words = text.split(' ');
        text = words.slice(0, maxDisplayWords).join(' ') + '...';
        // Keep original word count for evaluation statements
        if (!isInEvalWindow) {
          wordCount = maxDisplayWords;
        }
      }

      // Determine speaker role
      let speakerRole: 'PLAINTIFF' | 'DEFENDANT' | 'COURT' | 'JUROR' | 'OTHER' = 'OTHER';
      if (speaker?.speakerType === 'JUDGE') {
        speakerRole = 'COURT';
      } else if (speaker?.speakerType === 'JUROR') {
        speakerRole = 'JUROR';
      } else if (speaker?.speakerType === 'ATTORNEY') {
        const attorney = await this.prisma.trialAttorney.findFirst({
          where: {
            trialId: params.trialId,
            speakerId: speaker.id
          }
        });
        if (attorney) {
          speakerRole = attorney.role as 'PLAINTIFF' | 'DEFENDANT';
        }
      }

      displayStatements.push({
        statementId: stmt.id,
        speaker: speaker?.speakerHandle || 'UNKNOWN',
        text,
        wordCount,
        isInEvaluationWindow: isInEvalWindow,
        contributesToScore: isInEvalWindow && isSameTeam,
        speakerRole
      });
    }

    return displayStatements;
  }

  /**
   * Create result from evaluation
   */
  private async createResultFromEvaluation(
    evaluation: WindowEvaluation,
    startEvent: any
  ): Promise<StatementResultV3> {
    const lastExtension = evaluation.evaluation.extensions[evaluation.evaluation.extensions.length - 1];

    // Fetch the actual end event
    let endEvent = startEvent;
    if (evaluation.endEventId && evaluation.endEventId !== startEvent.id) {
      endEvent = await this.prisma.trialEvent.findUnique({
        where: { id: evaluation.endEventId },
        include: {
          statement: {
            include: { speaker: true }
          }
        }
      });
    }

    return {
      startEvent,
      endEvent: endEvent || startEvent,
      totalWords: lastExtension?.totalWords || (startEvent.wordCount || 0),
      speakerWords: lastExtension?.speakerWords || (startEvent.wordCount || 0),
      interruptionWords: (lastExtension?.totalWords || 0) - (lastExtension?.speakerWords || 0),
      speakerRatio: evaluation.evaluation.finalRatio,
      confidence: evaluation.evaluation.finalRatio > 0.7 ? 1 : evaluation.evaluation.finalRatio,
      metadata: {
        windowId: evaluation.windowId
      }
    };
  }

  /**
   * Truncate text to specified number of words
   */
  private truncateText(text: string, maxWords: number): string {
    if (!text) return '';
    const words = text.split(/\s+/);
    if (words.length <= maxWords) return text;
    return words.slice(0, maxWords).join(' ') + '...';
  }

  /**
   * Save evaluation log to file
   */
  private async saveEvaluationLog(
    params: LongStatementParamsV3,
    evaluation: SearchEvaluation
  ): Promise<void> {
    const outputDir = params.outputDir || './output/longstatements';
    const trialDir = path.join(outputDir, params.trialName || `trial_${params.trialId}`);

    // Create directories if needed
    if (!fs.existsSync(trialDir)) {
      fs.mkdirSync(trialDir, { recursive: true });
    }

    // Determine filename based on statement type
    const filename = `${params.statementType || 'unknown'}-evaluation.json`;
    const filepath = path.join(trialDir, filename);

    // Load existing data if file exists
    let existingData: any = null;
    if (fs.existsSync(filepath)) {
      try {
        existingData = JSON.parse(fs.readFileSync(filepath, 'utf-8'));
      } catch (e) {
        // File exists but isn't valid JSON, will be overwritten
      }
    }

    // If we have existing data, merge evaluations
    if (existingData && existingData.evaluations) {
      // Append new evaluations to existing ones
      evaluation.evaluations = [...existingData.evaluations, ...evaluation.evaluations];

      // Update final selection if the new one is better
      if (evaluation.finalSelection && existingData.finalSelection) {
        if ((evaluation.finalSelection.ratio || 0) > (existingData.finalSelection.ratio || 0)) {
          // Keep new final selection
        } else {
          // Keep existing final selection
          evaluation.finalSelection = existingData.finalSelection;
        }
      } else if (existingData.finalSelection) {
        evaluation.finalSelection = existingData.finalSelection;
      }
    }

    // Write evaluation log
    fs.writeFileSync(filepath, JSON.stringify(evaluation, null, 2));
    this.logger.info(`Saved evaluation log to ${filepath}`);

    // Also save a summary file
    const summaryFile = path.join(trialDir, 'algorithm-summary.json');
    const summary = {
      trial: evaluation.trial,
      phase: evaluation.phase,
      totalCandidates: evaluation.evaluations.length,
      selectedWindow: evaluation.finalSelection,
      evaluationStats: {
        averageExtensions: evaluation.evaluations.reduce((sum, e) => sum + e.evaluation.extensions.length, 0) / evaluation.evaluations.length,
        averageFinalRatio: evaluation.evaluations.reduce((sum, e) => sum + e.evaluation.finalRatio, 0) / evaluation.evaluations.length,
        candidatesAboveThreshold: evaluation.evaluations.filter(e => e.evaluation.finalRatio > 0.6).length
      }
    };

    // Append or update summary
    let existingSummary: any = {};
    if (fs.existsSync(summaryFile)) {
      existingSummary = JSON.parse(fs.readFileSync(summaryFile, 'utf-8'));
    }
    existingSummary[evaluation.phase] = summary;
    fs.writeFileSync(summaryFile, JSON.stringify(existingSummary, null, 2));
  }
}