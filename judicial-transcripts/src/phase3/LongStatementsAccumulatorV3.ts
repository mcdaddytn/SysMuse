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
  ratioMode?: 'TRADITIONAL' | 'WEIGHTED_SQRT' | 'WEIGHTED_SQRT2' | 'WEIGHTED_SQRT3' | 'SMART_EXTEND' | 'TEAM_AGGREGATE';
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
    refinedByJuror: boolean;
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
          end: params.searchEndEvent || 999999,
          refinedByJuror: false
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
    refinedByJuror: boolean;
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

    return { start: startEvent, end: endEvent, refinedByJuror: refined };
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
    const evaluation: WindowEvaluation = {
      windowId: `${params.attorneyRole || 'unknown'}_${initialEvent.id}`,
      startEventId: initialEvent.id,
      endEventId: initialEvent.id,
      speakerRole: params.attorneyRole || 'OTHER',
      evaluation: {
        initialStatement: {
          eventId: initialEvent.id,
          speaker: initialEvent.statement?.speaker.speakerHandle || 'UNKNOWN',
          wordCount: initialEvent.wordCount || 0,
          meetsThreshold: (initialEvent.wordCount || 0) >= params.minWords
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
    let bestRatio = await this.calculateRatio(currentWindow, params);
    evaluation.evaluation.finalRatio = bestRatio;

    const maxExtensions = params.maxExtensionAttempts || 20;
    const declineThreshold = params.declineThreshold || 0.05;

    for (let step = 1; step <= maxExtensions; step++) {
      const nextEvent = await this.getNextStatementEvent(
        currentWindow[currentWindow.length - 1].id,
        params.searchEndEvent
      );

      if (!nextEvent) {
        this.logger.info(`No more events after ${currentWindow[currentWindow.length - 1].id}`);
        break;
      }

      // Check for deal-breakers
      if (params.breakOnOpposingLongStatement !== false) {
        const isOpposing = await this.isOpposingLongStatement(nextEvent, params);
        if (isOpposing) {
          evaluation.evaluation.extensions.push({
            step,
            addedEventId: nextEvent.id,
            addedSpeaker: nextEvent.statement?.speaker.speakerHandle || 'UNKNOWN',
            addedWords: nextEvent.wordCount || 0,
            ratio: bestRatio,
            decision: 'stop',
            reason: 'opposing_long_statement',
            totalWords: this.countTotalWords(currentWindow),
            speakerWords: await this.countSpeakerWords(currentWindow, params)
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
      const newRatio = await this.calculateRatio(extendedWindow, params);

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
          speakerWords: await this.countSpeakerWords(extendedWindow, params)
        });
      } else {
        // Stop extending
        evaluation.evaluation.extensions.push({
          step,
          addedEventId: nextEvent.id,
          addedSpeaker: nextEvent.statement?.speaker.speakerHandle || 'UNKNOWN',
          addedWords: nextEvent.wordCount || 0,
          ratio: newRatio,
          decision: 'stop',
          reason: 'ratio_decline',
          totalWords: this.countTotalWords(extendedWindow),
          speakerWords: await this.countSpeakerWords(extendedWindow, params)
        });
        break;
      }
    }

    return evaluation;
  }

  /**
   * Calculate ratio for a window of events
   */
  private async calculateRatio(events: any[], params: LongStatementParamsV3): Promise<number> {
    const totalWords = this.countTotalWords(events);
    const speakerWords = await this.countSpeakerWords(events, params);

    if (totalWords === 0) return 0;

    // Use WEIGHTED_SQRT by default as specified in the algorithm
    const ratioMode = params.ratioMode || 'WEIGHTED_SQRT';

    switch (ratioMode) {
      case 'WEIGHTED_SQRT':
        return speakerWords / Math.sqrt(totalWords);
      case 'WEIGHTED_SQRT2':
        return Math.pow(speakerWords / totalWords, 2) * Math.sqrt(speakerWords / 100);
      case 'WEIGHTED_SQRT3':
        return Math.pow(speakerWords / totalWords, 3) * Math.sqrt(speakerWords / 100);
      case 'TRADITIONAL':
      default:
        return speakerWords / totalWords;
    }
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
    const maxDisplayWords = params.maxDisplayWords || 100;
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

      // Truncate non-evaluation statements
      if (!isInEvalWindow && text.split(' ').length > maxDisplayWords) {
        const words = text.split(' ');
        text = words.slice(0, maxDisplayWords).join(' ') + '...';
        wordCount = maxDisplayWords;
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