import { PrismaClient, AccumulatorExpression, AccumulatorType, ConfidenceLevel, CombinationType, TrialEvent, StatementEvent, ElasticSearchResult } from '@prisma/client';
import { Logger } from '../utils/logger';

interface AccumulatorWindow {
  startEvent: TrialEvent;
  endEvent: TrialEvent;
  events: TrialEvent[];
  statements: StatementEvent[];
  esResults: Map<number, ElasticSearchResult[]>; // statementId -> results
}

interface AccumulatorEvaluation {
  matched: boolean;
  confidence: ConfidenceLevel;
  score: number;
  metadata: any;
}

export class AccumulatorEngine {
  private logger = new Logger('AccumulatorEngine');

  constructor(private prisma: PrismaClient) {}

  /**
   * Evaluate all active accumulators for a trial
   */
  async evaluateTrialAccumulators(trialId: number): Promise<void> {
    this.logger.info(`Evaluating accumulators for trial ${trialId}`);

    // Load active accumulators
    const accumulators = await this.prisma.accumulatorExpression.findMany({
      where: { isActive: true },
      include: {
        components: true,
        esExpressions: true
      }
    });

    // Load trial events with related data
    const trialEvents = await this.prisma.trialEvent.findMany({
      where: { trialId },
      orderBy: { startTime: 'asc' },
      include: {
        statement: {
          include: {
            speaker: true,
            esResults: {
              include: {
                expression: true
              }
            }
          }
        },
        courtDirective: true,
        witnessCalled: true
      }
    });

    // Process each accumulator
    for (const accumulator of accumulators) {
      await this.evaluateAccumulator(accumulator, trialEvents, trialId);
    }

    this.logger.info(`Completed accumulator evaluation for trial ${trialId}`);
  }

  /**
   * Evaluate a single accumulator across all windows in the trial
   */
  private async evaluateAccumulator(
    accumulator: any,
    trialEvents: any[],
    trialId: number
  ): Promise<void> {
    this.logger.info(`Evaluating accumulator: ${accumulator.name}`);

    const windowSize = accumulator.windowSize;
    const statementEvents = trialEvents.filter(e => e.eventType === 'STATEMENT' && e.statement);

    // Slide window through statements
    for (let i = 0; i <= statementEvents.length - windowSize; i++) {
      const window = this.createWindow(statementEvents.slice(i, i + windowSize));
      
      // Evaluate window
      const evaluation = await this.evaluateWindow(accumulator, window);

      // Store result if matched
      if (evaluation.matched || evaluation.score > 0) {
        await this.storeResult(accumulator, window, evaluation, trialId);
      }
    }
  }

  /**
   * Create a window object from events
   */
  private createWindow(events: any[]): AccumulatorWindow {
    const statements = events.map(e => e.statement).filter(Boolean);
    const esResults = new Map();

    for (const statement of statements) {
      if (statement.esResults && statement.esResults.length > 0) {
        esResults.set(statement.id, statement.esResults);
      }
    }

    return {
      startEvent: events[0],
      endEvent: events[events.length - 1],
      events,
      statements,
      esResults
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

    // Check ES expression matches
    if (accumulator.esExpressions && accumulator.esExpressions.length > 0) {
      for (const esExpr of accumulator.esExpressions) {
        const matchCount = this.countESMatches(window, esExpr.id);
        if (matchCount > 0) {
          scores.push(1.0);
          matchDetails.push({
            type: 'es_expression',
            expression: esExpr.name,
            matches: matchCount
          });
        }
      }
    }

    // Check speaker requirements
    if (metadata.requiredSpeakers) {
      const speakerTypes = new Set<string>();
      // We need to load speaker data separately if not included
      // For now, skip this check if speaker is not loaded
      // TODO: Include speaker relation in query

      for (const required of metadata.requiredSpeakers) {
        if (speakerTypes.has(required)) {
          scores.push(1.0);
          matchDetails.push({
            type: 'speaker',
            speakerType: required
          });
        }
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
      }
    }

    // Calculate final score based on combination type
    const finalScore = this.combineScores(scores, accumulator.combinationType);
    
    // Determine confidence level
    const confidence = this.calculateConfidence(finalScore);

    // Determine if matched based on threshold
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
        matches: matchDetails
      }
    };
  }

  /**
   * Count ES expression matches in window
   */
  private countESMatches(window: AccumulatorWindow, expressionId: number): number {
    let count = 0;
    for (const [, results] of window.esResults) {
      count += results.filter(r => r.expressionId === expressionId && r.matched).length;
    }
    return count;
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
      
      case 'OR':
        return Math.max(...scores);
      
      case 'AND':
        return Math.min(...scores);
      
      default:
        return scores.reduce((a, b) => a + b, 0) / scores.length; // Average
    }
  }

  /**
   * Calculate confidence level from score
   */
  private calculateConfidence(score: number): ConfidenceLevel {
    if (score >= 0.8) return 'HIGH';
    if (score >= 0.5) return 'MEDIUM';
    if (score >= 0.3) return 'LOW';
    return 'NONE';
  }

  /**
   * Evaluate threshold conditions
   */
  private evaluateThreshold(
    score: number,
    threshold?: number | null,
    confidence?: ConfidenceLevel,
    minConfidence?: ConfidenceLevel | null
  ): boolean {
    // Check numeric threshold
    if (threshold !== null && threshold !== undefined) {
      if (score < threshold) return false;
    }

    // Check confidence threshold
    if (minConfidence && confidence) {
      const confidenceLevels = ['NONE', 'LOW', 'MEDIUM', 'HIGH'];
      const currentLevel = confidenceLevels.indexOf(confidence);
      const minLevel = confidenceLevels.indexOf(minConfidence);
      if (currentLevel < minLevel) return false;
    }

    return true;
  }

  /**
   * Store accumulator result
   */
  private async storeResult(
    accumulator: any,
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
        metadata: evaluation.metadata
      }
    });
  }

  /**
   * Evaluate ElasticSearch expressions against statements
   */
  async evaluateESExpressions(trialId: number): Promise<void> {
    this.logger.info(`Evaluating ElasticSearch expressions for trial ${trialId}`);

    // Load active ES expressions
    const expressions = await this.prisma.elasticSearchExpression.findMany({
      where: { isActive: true }
    });

    // Load statements for trial
    const statements = await this.prisma.statementEvent.findMany({
      where: {
        event: {
          trialId
        }
      },
      include: {
        event: true
      }
    });

    // For each expression, evaluate against each statement
    // Note: In production, this would actually query ElasticSearch
    // For now, we'll do simple pattern matching
    for (const expression of expressions) {
      for (const statement of statements) {
        const matched = await this.evaluateESExpression(expression, statement);
        
        // Store result
        await this.prisma.elasticSearchResult.upsert({
          where: {
            expressionId_statementId: {
              expressionId: expression.id,
              statementId: statement.id
            }
          },
          update: {
            matched,
            score: matched ? 1.0 : 0.0
          },
          create: {
            expressionId: expression.id,
            statementId: statement.id,
            trialId,
            matched,
            score: matched ? 1.0 : 0.0
          }
        });
      }
    }

    this.logger.info(`Completed ES expression evaluation for trial ${trialId}`);
  }

  /**
   * Evaluate a single ES expression against a statement
   * This is a simplified version - in production would use actual ElasticSearch
   */
  private async evaluateESExpression(
    expression: any,
    statement: any
  ): Promise<boolean> {
    const text = statement.text.toLowerCase();
    const pattern = expression.phrasePattern.toLowerCase();

    switch (expression.searchStrategy) {
      case 'match_phrase':
        return text.includes(pattern);
      
      case 'wildcard':
        // Simple wildcard matching
        const regexPattern = pattern
          .replace(/\*/g, '.*')
          .replace(/\?/g, '.');
        const regex = new RegExp(regexPattern);
        return regex.test(text);
      
      default:
        return text.includes(pattern);
    }
  }
}