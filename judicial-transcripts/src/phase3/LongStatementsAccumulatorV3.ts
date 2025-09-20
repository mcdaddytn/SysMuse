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
  ratioMode?: 'WORD_RACE' | 'WORD_RACE2' | 'WORD_RACE3';
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
  searchType?: 'opening' | 'closing' | 'opening-rebuttal' | 'closing-rebuttal'; // Specific search type
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
      // WORD_RACE specific fields
      statementIndex?: number;
      targetWords?: number;
      otherWords?: number;
      distFactor?: number;
      targetAdjWords?: number;
      otherAdjWords?: number;
      deltaAdjWords?: number;
      targetWordScore?: number;
      // Legacy fields for backward compatibility
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
      addedText?: string;  // Truncated text of the added statement
      decision: 'extend' | 'stop';
      reason?: string;
      totalWords: number;
      speakerWords: number;
      bestScore?: boolean;  // Marks the extension with the highest score
      // WORD_RACE specific fields
      statementIndex?: number;
      targetWords?: number;
      otherWords?: number;
      distFactor?: number;
      targetAdjWords?: number;
      otherAdjWords?: number;
      deltaAdjWords?: number;
      targetWordScore?: number;
      // Legacy fields for backward compatibility
      targetSpeakerWords?: number;
      targetSpeakerStatements?: number;
      otherSpeakerWords?: number;
      otherSpeakerStatements?: number;
      targetSpeakerRatio?: number;
      otherSpeakerRatio?: number;
      ratio?: number;
    }>;
    finalRatio?: number; // Legacy field
    finalScore?: number; // WORD_RACE score
    selected: boolean;
    selectionReason?: string;
  };
  displayWindow?: DisplayStatement[];
}

interface SearchEvaluation {
  trial: string;
  phase: string;  // Allow any phase name for more detailed tracking
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
  private allSearchEvaluations: SearchEvaluation[] = [];  // Accumulate all searches
  private currentSearchPhase: string = '';  // Track which phase we're in

  constructor(private prisma: PrismaClient) {}

  /**
   * Clear accumulated evaluations (call before starting a new opening/closing search)
   */
  public clearAccumulatedEvaluations(): void {
    this.allSearchEvaluations = [];
    this.currentSearchPhase = '';
  }

  /**
   * Save all accumulated evaluations to a single file
   */
  public async saveAllAccumulatedEvaluations(
    trialId: number,
    trialName: string,
    statementType: string
  ): Promise<void> {
    if (this.allSearchEvaluations.length === 0) {
      return;
    }

    const outputDir = './output/longstatements';
    const trialDir = path.join(outputDir, trialName || `trial_${trialId}`);

    // Create directories if needed
    if (!fs.existsSync(trialDir)) {
      fs.mkdirSync(trialDir, { recursive: true });
    }

    // Create combined evaluation with all searches
    const combinedEvaluation = {
      trial: trialName || `trial_${trialId}`,
      statementType: statementType,
      searchStrategy: 'defense-first-enhanced',
      searches: this.allSearchEvaluations,
      searchSequence: this.allSearchEvaluations.map(s => s.phase),
      timestamp: new Date().toISOString()
    };

    const filename = `${statementType}-evaluation.json`;
    const filepath = path.join(trialDir, filename);

    // Write combined evaluation log
    fs.writeFileSync(filepath, JSON.stringify(combinedEvaluation, null, 2));
    this.logger.info(`Saved combined evaluation log to ${filepath}`);

    // Also save algorithm summary
    const summaryFile = path.join(trialDir, 'algorithm-summary.json');

    // Calculate statistics across all searches
    const allEvaluations = this.allSearchEvaluations.flatMap(s => s.evaluations || []);
    const finalSelections = this.allSearchEvaluations
      .filter(s => s.finalSelection)
      .map(s => s.finalSelection);

    const summary = {
      trial: trialName || `trial_${trialId}`,
      statementType: statementType,
      searchStrategy: 'defense-first-enhanced',
      totalSearches: this.allSearchEvaluations.length,
      searchesWithResults: this.allSearchEvaluations.filter(s => s.evaluations && s.evaluations.length > 0).length,
      searchSequence: this.allSearchEvaluations.map(s => s.phase),
      evaluationStats: {
        totalCandidatesEvaluated: allEvaluations.length,
        averageExtensions: allEvaluations.length > 0
          ? allEvaluations.reduce((sum, e) => sum + (e.evaluation?.extensions?.length || 0), 0) / allEvaluations.length
          : 0,
        averageFinalScore: allEvaluations.length > 0
          ? allEvaluations.reduce((sum, e) => sum + (e.evaluation?.finalScore || 0), 0) / allEvaluations.length
          : 0,
        candidatesAboveThreshold: allEvaluations.filter(e => (e.evaluation?.finalScore || 0) > 500).length
      },
      finalSelections: finalSelections,
      timestamp: new Date().toISOString()
    };

    // Read existing summary to preserve other statement types
    let existingSummary: any = {};
    if (fs.existsSync(summaryFile)) {
      try {
        existingSummary = JSON.parse(fs.readFileSync(summaryFile, 'utf-8'));
      } catch (e) {
        // Invalid JSON, will be overwritten
      }
    }
    existingSummary[statementType] = summary;
    fs.writeFileSync(summaryFile, JSON.stringify(existingSummary, null, 2));
    this.logger.info(`Saved algorithm summary to ${summaryFile}`);
  }

  /**
   * Enhanced findLongestStatement with state tracking
   */
  async findLongestStatement(params: LongStatementParamsV3): Promise<StatementResultV3 | null> {
    this.logger.info(`Finding longest statement for ${params.speakerType} ${params.attorneyRole || ''} in trial ${params.trialId}`);

    // Log critical parameters at WARN level for visibility
    const ratioMode = params.ratioMode || 'WORD_RACE3';
    this.logger.info(`[CALCULATION MODE] Using ratioMode: ${ratioMode}`);
    this.logger.info(`[CALCULATION PARAMS] minWords: ${params.minWords}, ratioThreshold: ${params.ratioThreshold}, searchType: ${params.searchType || params.statementType || 'unknown'}`);
    this.logger.info(`[CALCULATION PARAMS] breakOnOpposingLongStatement: ${params.breakOnOpposingLongStatement !== false}, maxExtensionAttempts: ${params.maxExtensionAttempts || 20}`);

    // Initialize search evaluation tracking
    if (params.trackEvaluations) {
      // Determine search phase based on attorney role
      let searchPhase = '';
      if (params.attorneyRole === 'DEFENDANT') {
        searchPhase = 'defense-opening';
      } else if (params.attorneyRole === 'PLAINTIFF') {
        // Check if this is before or after defense (based on search window)
        if (params.searchEndEvent && params.searchEndEvent < 999999) {
          searchPhase = 'plaintiff-opening-before-defense';
        } else {
          searchPhase = 'plaintiff-opening-or-rebuttal';
        }
      } else {
        searchPhase = `${params.attorneyRole || 'unknown'}-${params.statementType || 'statement'}`;
      }

      this.currentSearchPhase = searchPhase;
      this.searchEvaluation = {
        trial: params.trialName || `trial_${params.trialId}`,
        phase: searchPhase,
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

    // Log details about why no candidates were found
    if (candidates.length === 0) {
      this.logger.warn(`No candidates found for ${params.statementType} statement`);
      this.logger.warn(`Search window: ${params.searchStartEvent || 0} to ${params.searchEndEvent || 999999}`);
      this.logger.warn(`Attorney role: ${params.attorneyRole || 'any'}`);

      // Also log this to the evaluation
      if (this.searchEvaluation) {
        (this.searchEvaluation as any).noCandidatesReason = {
          message: 'No candidate starting statements found',
          searchWindow: `${params.searchStartEvent || 0} to ${params.searchEndEvent || 999999}`,
          attorneyRole: params.attorneyRole || 'unknown'
        };
      }
    }

    // Step 3: Evaluate each candidate window
    let bestResult: StatementResultV3 | null = null;
    let bestScore = this.isWordRaceMode(params.ratioMode) ? -Infinity : 0;
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
      const currentScore = this.isWordRaceMode(params.ratioMode)
        ? (evaluation.evaluation.finalScore || 0)
        : (evaluation.evaluation.finalRatio || 0);

      if (currentScore > bestScore) {
        bestScore = currentScore;
        bestResult = await this.createResultFromEvaluation(evaluation, candidate, params);
        bestEvaluation = evaluation;
        bestCandidate = candidate;

        // Mark as selected
        evaluation.evaluation.selected = true;
        evaluation.evaluation.selectionReason = this.isWordRaceMode(params.ratioMode)
          ? 'highest_score'
          : 'highest_ratio';
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

      // Add this search to the accumulated evaluations
      this.allSearchEvaluations.push({ ...this.searchEvaluation });

      // Don't save individual searches - we'll save all at once at the end
      // await this.saveEvaluationLog(params, this.searchEvaluation);
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
   * Check if using WORD_RACE mode (always true now since deprecated modes removed)
   */
  private isWordRaceMode(mode: string | undefined): boolean {
    return true; // All modes are WORD_RACE variants now
  }

  /**
   * Evaluate a candidate window by extending it forward
   */
  private async evaluateWindow(
    initialEvent: any,
    params: LongStatementParamsV3
  ): Promise<WindowEvaluation> {
    // Always use WORD_RACE evaluation
    const ratioMode = params.ratioMode || 'WORD_RACE3';
    this.logger.warn(`[EVALUATION METHOD] Using evaluateWindowWordRace with mode: ${ratioMode}`);
    return this.evaluateWindowWordRace(initialEvent, params);
  }

  /**
   * Evaluate window using WORD_RACE algorithm
   */
  private async evaluateWindowWordRace(
    initialEvent: any,
    params: LongStatementParamsV3
  ): Promise<WindowEvaluation> {
    const searchType = params.searchType || params.statementType || 'unknown';
    const windowId = `${params.attorneyRole || 'unknown'}_${searchType}_${initialEvent.id}`;

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
        finalScore: 0,
        selected: false
      }
    };

    // Only proceed if initial statement meets threshold
    if (params.requireInitialThreshold !== false && !evaluation.evaluation.initialStatement.meetsThreshold) {
      this.logger.info(`Initial event ${initialEvent.id} does not meet threshold (${initialEvent.wordCount} < ${params.minWords})`);
      return evaluation;
    }

    // Get distance factor exponent based on mode
    let distFactorExponent = 3; // Default to WORD_RACE3
    if (params.ratioMode === 'WORD_RACE') distFactorExponent = 1;
    else if (params.ratioMode === 'WORD_RACE2') distFactorExponent = 2;

    // Initialize with baseline statement (statementIndex = 1)
    const isTargetSpeaker = await this.isTargetSpeaker(initialEvent, params);
    const targetWords = isTargetSpeaker ? (initialEvent.wordCount || 0) : 0;
    const otherWords = isTargetSpeaker ? 0 : (initialEvent.wordCount || 0);
    const distFactor = Math.pow(1, 1 / distFactorExponent); // Always 1 for baseline
    const targetAdjWords = targetWords / distFactor;
    const otherAdjWords = otherWords * distFactor;
    const deltaAdjWords = targetAdjWords - otherAdjWords;
    let targetWordScore = deltaAdjWords;

    // Store initial calculations
    evaluation.evaluation.initialStatement.statementIndex = 1;
    evaluation.evaluation.initialStatement.targetWords = targetWords;
    evaluation.evaluation.initialStatement.otherWords = otherWords;
    evaluation.evaluation.initialStatement.distFactor = distFactor;
    evaluation.evaluation.initialStatement.targetAdjWords = targetAdjWords;
    evaluation.evaluation.initialStatement.otherAdjWords = otherAdjWords;
    evaluation.evaluation.initialStatement.deltaAdjWords = deltaAdjWords;
    evaluation.evaluation.initialStatement.targetWordScore = targetWordScore;

    // Track best score and best window configuration
    let bestScore = targetWordScore;
    let bestWindowEndId = initialEvent.id;
    evaluation.evaluation.finalScore = bestScore;

    // Build window by extending forward
    let currentWindow = [initialEvent];
    let statementIndex = 1;
    const maxExtensions = params.maxExtensionAttempts || 20;
    const declineThreshold = 50; // Allow score to decline by up to 50 points
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
      statementIndex++;

      // Calculate WORD_RACE metrics for this statement
      const isNextTarget = await this.isTargetSpeaker(nextEvent, params);
      const nextTargetWords = isNextTarget ? (nextEvent.wordCount || 0) : 0;
      const nextOtherWords = isNextTarget ? 0 : (nextEvent.wordCount || 0);
      const nextDistFactor = Math.pow(statementIndex, 1 / distFactorExponent);
      const nextTargetAdjWords = nextTargetWords / nextDistFactor;
      const nextOtherAdjWords = nextOtherWords * nextDistFactor;
      const nextDeltaAdjWords = nextTargetAdjWords - nextOtherAdjWords;
      const newScore = targetWordScore + nextDeltaAdjWords;

      // Check for deal-breakers (long statement from any non-target speaker)
      if (params.breakOnOpposingLongStatement !== false) {
        const isDealBreaker = await this.isDealBreakerStatement(nextEvent, params);
        if (isDealBreaker) {
          evaluation.evaluation.extensions.push({
            step,
            addedEventId: nextEvent.id,
            addedSpeaker: nextEvent.statement?.speaker.speakerHandle || 'UNKNOWN',
            addedWords: nextEvent.wordCount || 0,
            addedText: this.truncateText(nextEvent.statement?.text || '', 50),
            decision: 'stop',
            reason: `deal_breaker_${nextEvent.statement?.speaker.speakerHandle || 'OTHER'}_${nextEvent.wordCount}w`,
            totalWords: this.countTotalWords([...currentWindow, nextEvent]),
            speakerWords: await this.countSpeakerWords([...currentWindow, nextEvent], params),
            statementIndex,
            targetWords: nextTargetWords,
            otherWords: nextOtherWords,
            distFactor: nextDistFactor,
            targetAdjWords: nextTargetAdjWords,
            otherAdjWords: nextOtherAdjWords,
            deltaAdjWords: nextDeltaAdjWords,
            targetWordScore: newScore
          });
          break;
        }
      }

      // Decide whether to extend
      if (newScore >= bestScore - declineThreshold) {
        // Accept extension
        currentWindow.push(nextEvent);
        targetWordScore = newScore;
        if (newScore > bestScore) {
          bestScore = newScore;
          bestWindowEndId = nextEvent.id;  // Track the best window endpoint
        }
        evaluation.endEventId = nextEvent.id;
        evaluation.evaluation.finalScore = Math.max(evaluation.evaluation.finalScore || 0, newScore);

        evaluation.evaluation.extensions.push({
          step,
          addedEventId: nextEvent.id,
          addedSpeaker: nextEvent.statement?.speaker.speakerHandle || 'UNKNOWN',
          addedWords: nextEvent.wordCount || 0,
          addedText: this.truncateText(nextEvent.statement?.text || '', 50),
          decision: 'extend',
          totalWords: this.countTotalWords(currentWindow),
          speakerWords: await this.countSpeakerWords(currentWindow, params),
          statementIndex,
          targetWords: nextTargetWords,
          otherWords: nextOtherWords,
          distFactor: nextDistFactor,
          targetAdjWords: nextTargetAdjWords,
          otherAdjWords: nextOtherAdjWords,
          deltaAdjWords: nextDeltaAdjWords,
          targetWordScore: newScore
        });
      } else {
        // Score declined too much - record but continue evaluation
        evaluation.evaluation.extensions.push({
          step,
          addedEventId: nextEvent.id,
          addedSpeaker: nextEvent.statement?.speaker.speakerHandle || 'UNKNOWN',
          addedWords: nextEvent.wordCount || 0,
          addedText: this.truncateText(nextEvent.statement?.text || '', 50),
          decision: 'stop',
          reason: 'score_decline',
          totalWords: this.countTotalWords([...currentWindow, nextEvent]),
          speakerWords: await this.countSpeakerWords([...currentWindow, nextEvent], params),
          statementIndex,
          targetWords: nextTargetWords,
          otherWords: nextOtherWords,
          distFactor: nextDistFactor,
          targetAdjWords: nextTargetAdjWords,
          otherAdjWords: nextOtherAdjWords,
          deltaAdjWords: nextDeltaAdjWords,
          targetWordScore: newScore
        });
        // Don't break - continue to evaluate more extensions
      }
    }

    // Set the final window to the best configuration found
    evaluation.endEventId = bestWindowEndId;
    evaluation.evaluation.finalScore = bestScore;
    // Mark the step where we had the best score
    for (let i = 0; i < evaluation.evaluation.extensions.length; i++) {
      const ext = evaluation.evaluation.extensions[i];
      if (ext.addedEventId === bestWindowEndId && ext.decision === 'extend') {
        ext.bestScore = true;  // Mark this as the best scoring extension
      }
    }

    return evaluation;
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
   * Check if an event is a deal-breaker (long statement from non-target speaker)
   */
  private async isDealBreakerStatement(event: any, params: LongStatementParamsV3): Promise<boolean> {
    if (!event.statement?.speaker || !event.wordCount) return false;

    // Must meet minWords threshold to be a deal-breaker
    if (event.wordCount < params.minWords) return false;

    // Check if this is NOT a target speaker
    const isTarget = await this.isTargetSpeaker(event, params);

    // If it's not a target speaker and meets word threshold, it's a deal-breaker
    return !isTarget;
  }

  /**
   * Check if an event is an opposing long statement (legacy method - kept for compatibility)
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
    startEvent: any,
    params?: LongStatementParamsV3
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

    // Use appropriate scoring for confidence
    const scoreValue = params && this.isWordRaceMode(params.ratioMode)
      ? (evaluation.evaluation.finalScore || 0)
      : (evaluation.evaluation.finalRatio || 0);

    // For WORD_RACE, normalize confidence (0-1 range)
    const confidence = params && this.isWordRaceMode(params.ratioMode)
      ? Math.min(1, scoreValue / 1000) // Normalize WORD_RACE score
      : (scoreValue > 0.7 ? 1 : scoreValue);

    return {
      startEvent,
      endEvent: endEvent || startEvent,
      totalWords: lastExtension?.totalWords || (startEvent.wordCount || 0),
      speakerWords: lastExtension?.speakerWords || (startEvent.wordCount || 0),
      interruptionWords: (lastExtension?.totalWords || 0) - (lastExtension?.speakerWords || 0),
      speakerRatio: params && this.isWordRaceMode(params.ratioMode) ? scoreValue : (evaluation.evaluation.finalRatio || 0),
      confidence,
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

    // Write evaluation log (always replace existing file with fresh data)
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
        averageFinalRatio: evaluation.evaluations.reduce((sum, e) => sum + (e.evaluation.finalRatio || e.evaluation.finalScore || 0), 0) / evaluation.evaluations.length,
        candidatesAboveThreshold: evaluation.evaluations.filter(e => (e.evaluation.finalRatio || e.evaluation.finalScore || 0) > 0.6).length
      }
    };

    // Read existing summary to preserve other phases
    let existingSummary: any = {};
    if (fs.existsSync(summaryFile)) {
      try {
        existingSummary = JSON.parse(fs.readFileSync(summaryFile, 'utf-8'));
      } catch (e) {
        // Invalid JSON, will be overwritten
      }
    }
    existingSummary[evaluation.phase] = summary;
    fs.writeFileSync(summaryFile, JSON.stringify(existingSummary, null, 2));
  }
}