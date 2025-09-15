import { PrismaClient, AccumulatorExpression, AccumulatorType, ConfidenceLevel, CombinationType, TrialEvent, StatementEvent, Speaker } from '@prisma/client';
import { Logger } from '../utils/logger';
import { SearchStrategy, SearchResult } from '../services/SearchStrategy';
import { SearchStrategyFactory } from '../services/SearchStrategy';
import { TranscriptConfig } from '../types/config.types';

// Type for StatementEvent with speaker relation included
type StatementEventWithSpeaker = StatementEvent & {
  speaker?: Speaker | null;
};

interface AccumulatorWindow {
  startEvent: TrialEvent;
  endEvent: TrialEvent;
  events: TrialEvent[];
  statements: StatementEventWithSpeaker[];
  searchResults: Map<number, SearchResult[]>; // statementId -> results
}

interface AccumulatorEvaluation {
  matched: boolean;
  confidence: ConfidenceLevel;
  score: number;
  metadata: any;
}

export class AccumulatorEngineV2 {
  private logger = new Logger('AccumulatorEngineV2');
  private searchStrategy?: SearchStrategy;

  constructor(
    private prisma: PrismaClient,
    private config: TranscriptConfig
  ) {}

  /**
   * Initialize the engine with appropriate search strategy
   */
  async initialize(): Promise<void> {
    this.searchStrategy = await SearchStrategyFactory.createStrategy(this.config, this.prisma);
    if (this.searchStrategy?.initialize) {
      await this.searchStrategy.initialize();
    }
    this.logger.info(`Initialized with ${this.config.enableElasticSearch ? 'ElasticSearch' : 'in-memory'} search strategy`);
  }

  /**
   * Evaluate all active accumulators for a trial
   */
  async evaluateTrialAccumulators(trialId: number): Promise<void> {
    if (!this.searchStrategy) {
      await this.initialize();
    }

    this.logger.info(`Evaluating accumulators for trial ${trialId}`);

    // Load active accumulators
    const accumulators = await this.prisma.accumulatorExpression.findMany({
      where: { isActive: true },
      include: {
        components: true,
        esExpressions: true
      }
    });

    this.logger.info(`Found ${accumulators.length} active accumulators`);

    // Load trial events with related data
    const trialEvents = await this.prisma.trialEvent.findMany({
      where: { trialId },
      orderBy: { id: 'asc' },
      include: {
        statement: {
          include: {
            speaker: true
          }
        },
        courtDirective: true,
        witnessCalled: true
      }
    });

    this.logger.info(`Loaded ${trialEvents.length} trial events`);

    // Process each accumulator
    let totalResults = 0;
    for (let i = 0; i < accumulators.length; i++) {
      const accumulator = accumulators[i];
      this.logger.info(`Processing accumulator ${i + 1}/${accumulators.length}: ${accumulator.name}`);
      const results = await this.evaluateAccumulator(accumulator, trialEvents, trialId);
      this.logger.info(`  Generated ${results} results for ${accumulator.name}`);
      totalResults += results;
    }

    this.logger.info(`Completed accumulator evaluation for trial ${trialId}`);
    this.logger.info(`Total accumulator results generated: ${totalResults}`);

    // Cleanup
    if (this.searchStrategy?.cleanup) {
      await this.searchStrategy.cleanup();
    }
  }

  /**
   * Evaluate a single accumulator across all windows in the trial
   */
  private async evaluateAccumulator(
    accumulator: any,
    trialEvents: any[],
    trialId: number
  ): Promise<number> {
    const windowSize = accumulator.windowSize;
    const displaySize = accumulator.metadata?.displaySize || accumulator.displaySize || windowSize;
    const statementEvents = trialEvents.filter(e => e.eventType === 'STATEMENT' && e.statement);
    
    const totalWindows = Math.max(0, statementEvents.length - windowSize + 1);
    this.logger.debug(`  Sliding window size ${windowSize} through ${statementEvents.length} statements (${totalWindows} windows)`);
    
    let resultsStored = 0;
    let windowsProcessed = 0;

    // Slide window through statements
    let i = 0;
    while (i <= statementEvents.length - windowSize) {
      const windowEvents = statementEvents.slice(i, i + windowSize);
      const window = await this.createWindow(windowEvents, accumulator);

      // Evaluate window
      const evaluation = await this.evaluateWindow(accumulator, window);

      // Store result if matched
      if (evaluation.matched || evaluation.score > 0) {
        // Expand window for display if displaySize is larger than windowSize
        let displayWindow = window;
        if (displaySize > windowSize) {
          const expansion = Math.floor((displaySize - windowSize) / 2);
          const startIdx = Math.max(0, i - expansion);
          const endIdx = Math.min(statementEvents.length, i + windowSize + expansion);
          const expandedEvents = statementEvents.slice(startIdx, endIdx);
          displayWindow = await this.createWindow(expandedEvents, accumulator);
        }
        await this.storeResult(accumulator, displayWindow, evaluation, trialId);
        resultsStored++;

        // IMPORTANT: Advance cursor to end of matched pattern to avoid overlapping matches
        // This is particularly important for objections and interactions
        // Check if navigation mode is configured in metadata
        const navigationMode = accumulator.metadata?.navigationMode || 'jump_to_end';

        if (navigationMode === 'jump_to_end') {
          // Jump to the end of the current window to avoid overlapping matches
          i += windowSize;
        } else {
          // Default single step advancement (for backward compatibility)
          i++;
        }
      } else {
        // No match, advance by 1
        i++;
      }

      windowsProcessed++;

      // Progress logging
      if (windowsProcessed % 100 === 0) {
        this.logger.debug(`    Processed ${windowsProcessed}/${totalWindows} windows, found ${resultsStored} matches`);
      }
    }
    
    return resultsStored;
  }

  /**
   * Create a window object from events with search results
   */
  private async createWindow(
    events: any[],
    accumulator: any
  ): Promise<AccumulatorWindow> {
    const statements = events.map(e => e.statement).filter(Boolean);
    
    // Use search strategy to find matches
    const searchResults = this.searchStrategy 
      ? await this.searchStrategy.searchWithExpressions(statements, accumulator)
      : new Map<number, SearchResult[]>();

    return {
      startEvent: events[0],
      endEvent: events[events.length - 1],
      events,
      statements,
      searchResults
    };
  }

  /**
   * Evaluate a window against an accumulator
   */
  private async evaluateWindow(
    accumulator: any,
    window: AccumulatorWindow
  ): Promise<AccumulatorEvaluation> {
    const metadata = accumulator.metadata || {};
    let scores: number[] = [];
    let matchDetails: any[] = [];
    let attorneyScore: number | undefined;
    let judgeScore: number | undefined;

    // Check search results
    if (window.searchResults.size > 0) {
      // Process phrase matches
      const phraseMatches = this.evaluatePhraseMatches(window, metadata);
      if (phraseMatches.score > 0 || phraseMatches.attorneyScore || phraseMatches.judgeScore) {
        // For WEIGHTEDAVG, we'll handle scores differently
        if (accumulator.combinationType === 'WEIGHTEDAVG') {
          attorneyScore = phraseMatches.attorneyScore;
          judgeScore = phraseMatches.judgeScore;
        } else {
          scores.push(phraseMatches.score);
        }
        matchDetails.push(...phraseMatches.details);
      }
    }

    // Check speaker requirements
    if (metadata.requiredSpeakers) {
      const speakerMatch = this.evaluateSpeakerRequirements(window, metadata.requiredSpeakers);
      if (speakerMatch.matched) {
        scores.push(1.0);
        matchDetails.push(...speakerMatch.details);
      } else if (accumulator.combinationType === 'AND') {
        // For AND type, if required speakers not found, fail immediately
        scores.push(0.0);
      }
    }

    // Check minimum distinct speakers
    if (metadata.minDistinctSpeakers) {
      const distinctSpeakers = new Set(
        window.statements
          .filter(s => s.speakerId)
          .map(s => s.speakerId)
      );

      if (distinctSpeakers.size >= metadata.minDistinctSpeakers) {
        scores.push(1.0);
        matchDetails.push({
          type: 'distinct_speakers',
          count: distinctSpeakers.size
        });
      } else if (accumulator.combinationType === 'AND') {
        // For AND type, if not enough distinct speakers, fail immediately
        scores.push(0.0);
        matchDetails.push({
          type: 'distinct_speakers_failed',
          count: distinctSpeakers.size,
          required: metadata.minDistinctSpeakers
        });
      }
    }

    // Check attorney requirements
    if (metadata.minAttorneys) {
      const attorneyCount = this.countAttorneys(window);
      if (attorneyCount >= metadata.minAttorneys) {
        scores.push(1.0);
        matchDetails.push({
          type: 'attorney_count',
          count: attorneyCount
        });
      }
    }

    // Calculate final score
    let finalScore: number;
    if (accumulator.combinationType === 'WEIGHTEDAVG' && metadata.attorneyPhraseWeight && metadata.judgePhraseWeight) {
      // For WEIGHTEDAVG, require BOTH attorney and judge phrases
      if (!attorneyScore || !judgeScore) {
        // If either side is missing, no match
        finalScore = 0;
        matchDetails.push({
          type: 'weighted_avg_incomplete',
          attorneyFound: !!attorneyScore,
          judgeFound: !!judgeScore
        });
      } else {
        // Use weighted average for objection accumulators
        const attorneyWeight = metadata.attorneyPhraseWeight || 0.5;
        const judgeWeight = metadata.judgePhraseWeight || 0.5;
        const attorneyContribution = attorneyScore * attorneyWeight;
        const judgeContribution = judgeScore * judgeWeight;
        finalScore = attorneyContribution + judgeContribution;

        // Add accumulator name to match details
        matchDetails.push({
          type: 'accumulator',
          name: accumulator.name,
          weightedScore: finalScore
        });
      }
    } else {
      finalScore = this.combineScores(scores, accumulator.combinationType);
    }

    const confidence = this.calculateConfidence(finalScore);
    const matched = this.evaluateThreshold(
      finalScore,
      accumulator.thresholdValue,
      confidence,
      accumulator.minConfidenceLevel
    );

    return {
      matched,
      confidence,
      score: finalScore,
      metadata: {
        windowSize: window.events.length,
        startTime: window.startEvent.startTime,
        endTime: window.endEvent.endTime,
        matches: matchDetails,
        accumulatorName: accumulator.name
      }
    };
  }

  /**
   * Evaluate phrase matches from search results
   */
  private evaluatePhraseMatches(
    window: AccumulatorWindow,
    metadata: any
  ): { score: number; details: any[]; attorneyScore?: number; judgeScore?: number } {
    const details: any[] = [];
    let totalScore = 0;
    let matchCount = 0;
    let attorneyScore: number | undefined;
    let judgeScore: number | undefined;

    // Check attorney phrases (find only first match)
    if (metadata.attorneyPhrases) {
      const attorneyMatches = this.countPhraseMatchesWithWeights(
        window,
        metadata.attorneyPhrases,
        metadata.weights || {},
        'attorney',
        metadata.attorneyMaxWords
      );
      if (attorneyMatches.count > 0) {
        matchCount += attorneyMatches.count;
        attorneyScore = attorneyMatches.weightedScore;
        details.push({
          type: 'attorney_phrase',
          matches: attorneyMatches.count,
          weightedScore: attorneyMatches.weightedScore,
          matchedPhrase: attorneyMatches.firstMatch
        });
      }
    }

    // Check judge phrases (find only first match)
    if (metadata.judgePhrases) {
      const judgeMatches = this.countPhraseMatchesWithWeights(
        window,
        metadata.judgePhrases,
        metadata.weights || {},
        'judge',
        metadata.judgeMaxWords
      );
      if (judgeMatches.count > 0) {
        matchCount += judgeMatches.count;
        judgeScore = judgeMatches.weightedScore;
        details.push({
          type: 'judge_phrase',
          matches: judgeMatches.count,
          weightedScore: judgeMatches.weightedScore,
          matchedPhrase: judgeMatches.firstMatch
        });
      }
    }

    // Calculate score based on matches
    if (matchCount > 0) {
      totalScore = Math.min(1.0, matchCount / (window.statements.length / 2));
    }

    return { score: totalScore, details, attorneyScore, judgeScore };
  }

  /**
   * Count phrase matches in window
   */
  private countPhraseMatches(
    window: AccumulatorWindow,
    phrases: string[],
    speakerType?: string
  ): number {
    let count = 0;

    // Convert Map to array for iteration
    const searchEntries = Array.from(window.searchResults.entries());

    for (const [statementId, results] of searchEntries) {
      for (const result of results) {
        // Check if phrase matches
        if (phrases.includes(result.phrase)) {
          // Check speaker type if specified
          if (!speakerType || result.metadata?.speakerType === speakerType) {
            count++;
          }
        }
      }
    }

    return count;
  }

  /**
   * Count phrase matches with weights (find only first valid match)
   */
  private countPhraseMatchesWithWeights(
    window: AccumulatorWindow,
    phrases: string[],
    weights: { [key: string]: number },
    speakerType?: string,
    maxWords?: number
  ): { count: number; weightedScore: number; firstMatch?: string } {
    let count = 0;
    let firstMatchWeight = 0;
    let firstMatch: string | undefined;

    // Convert Map to array for iteration
    const searchEntries = Array.from(window.searchResults.entries());

    for (const [statementId, results] of searchEntries) {
      // If we already found a match, stop looking
      if (firstMatchWeight > 0) break;

      // Find the statement to check word count
      const statement = window.statements.find(s => s.id === statementId);

      for (const result of results) {
        // Check if phrase matches
        if (phrases.includes(result.phrase)) {
          // Check speaker type if specified
          if (!speakerType || result.metadata?.speakerType === speakerType) {
            // Check word count if maxWords is specified
            if (maxWords && statement?.text) {
              const wordCount = statement.text.split(/\s+/).length;
              if (wordCount > maxWords) {
                // Skip this match as statement is too long
                continue;
              }
            }

            count++;
            const weight = weights[result.phrase] || 1.0;
            // Track the first match and its weight, then stop looking
            if (firstMatchWeight === 0) {
              firstMatchWeight = weight;
              firstMatch = result.phrase;
              break; // Found our match, stop looking
            }
          }
        }
      }
    }

    return { count, weightedScore: firstMatchWeight, firstMatch };
  }

  /**
   * Evaluate speaker requirements
   */
  private evaluateSpeakerRequirements(
    window: AccumulatorWindow,
    requiredSpeakers: string[]
  ): { matched: boolean; details: any[] } {
    const details: any[] = [];
    const foundSpeakers = new Set<string>();

    for (const statement of window.statements) {
      if (statement.speaker) {
        const speakerType = statement.speaker.speakerType;
        const speakerHandle = statement.speaker.speakerHandle?.toLowerCase();

        for (const required of requiredSpeakers) {
          if (required === 'JUDGE' && speakerType === 'JUDGE') {
            foundSpeakers.add('JUDGE');
          } else if (required === 'ATTORNEY' && speakerType === 'ATTORNEY') {
            foundSpeakers.add('ATTORNEY');
          } else if (required === 'WITNESS' && speakerType === 'WITNESS') {
            foundSpeakers.add('WITNESS');
          } else if (speakerHandle && speakerHandle.includes(required.toLowerCase())) {
            foundSpeakers.add(required);
          }
        }
      }
    }

    const matched = requiredSpeakers.every(req => foundSpeakers.has(req));
    
    if (matched) {
      details.push({
        type: 'required_speakers',
        speakers: Array.from(foundSpeakers)
      });
    }

    return { matched, details };
  }

  /**
   * Count attorneys in window
   */
  private countAttorneys(window: AccumulatorWindow): number {
    const attorneys = new Set<number>();
    
    for (const statement of window.statements) {
      if (statement.speaker?.speakerType === 'ATTORNEY' && statement.speakerId) {
        attorneys.add(statement.speakerId);
      }
    }
    
    return attorneys.size;
  }

  /**
   * Combine scores based on combination type
   */
  private combineScores(scores: number[], combinationType?: CombinationType | null): number {
    if (scores.length === 0) return 0;

    switch (combinationType) {
      case 'ADD':
        return scores.reduce((a, b) => a + b, 0);
      
      case 'MULTIPLY':
        return scores.reduce((a, b) => a * b, 1);
      
      case 'AND':
        return scores.every(s => s > 0) ? 1 : 0;
      
      case 'OR':
        return scores.some(s => s > 0) ? 1 : 0;
      
      default:
        return scores.reduce((a, b) => a + b, 0) / scores.length;
    }
  }

  /**
   * Calculate confidence level from score
   */
  private calculateConfidence(score: number): ConfidenceLevel {
    if (score >= 0.8) return 'HIGH';
    if (score >= 0.5) return 'MEDIUM';
    return 'LOW';
  }

  /**
   * Evaluate if threshold is met
   */
  private evaluateThreshold(
    score: number,
    threshold: number,
    confidence: ConfidenceLevel,
    minConfidence?: ConfidenceLevel | null
  ): boolean {
    // Check score threshold
    if (score < threshold) return false;

    // Check confidence threshold
    if (minConfidence) {
      const confidenceLevels: Record<ConfidenceLevel, number> = { 
        'NONE': 0,
        'LOW': 1, 
        'MEDIUM': 2, 
        'HIGH': 3 
      };
      const currentLevel = confidenceLevels[confidence];
      const requiredLevel = confidenceLevels[minConfidence];
      return currentLevel >= requiredLevel;
    }

    return true;
  }

  /**
   * Store accumulator result
   */
  private async storeResult(
    accumulator: AccumulatorExpression,
    window: AccumulatorWindow,
    evaluation: AccumulatorEvaluation,
    trialId: number
  ): Promise<void> {
    await this.prisma.accumulatorResult.create({
      data: {
        accumulatorId: accumulator.id,
        trialId,
        startEventId: window.startEvent.id,
        endEventId: window.endEvent.id,
        booleanResult: evaluation.matched,
        confidenceLevel: evaluation.confidence,
        floatResult: evaluation.score,
        metadata: {
          ...evaluation.metadata,
          windowSize: window.events.length,
          accumulatorName: accumulator.name,
          displaySize: window.events.length
        }
      }
    });
  }
}