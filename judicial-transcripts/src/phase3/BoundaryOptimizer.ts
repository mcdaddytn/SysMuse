import {
  PrismaClient,
  TrialEvent,
  AttorneyRole
} from '@prisma/client';
import { Logger } from '../utils/logger';

interface OptimizationResult {
  startEvent: any;
  endEvent: any;
  events: any[];
  attorneyRatio: number;
  totalWords: number;
  attorneyWords: number;
  violations: string[];
  score: number;
}

export class BoundaryOptimizer {
  private logger = new Logger('BoundaryOptimizer');

  constructor(private prisma: PrismaClient) {}

  /**
   * Optimize boundaries to ensure statement starts and ends with correct attorney
   * and maximizes attorney speaking ratio
   */
  async optimizeBoundaries(
    trialId: number,
    startEventId: number,
    endEventId: number,
    attorneyRole: 'PLAINTIFF' | 'DEFENDANT'
  ): Promise<OptimizationResult> {
    this.logger.info(`Optimizing boundaries for events ${startEventId}-${endEventId}, role: ${attorneyRole}`);

    // Load all events in extended window (a bit before and after)
    const events = await this.prisma.trialEvent.findMany({
      where: {
        trialId,
        id: {
          gte: Math.max(1, startEventId - 10),
          lte: endEventId + 10
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

    // Get valid attorney handles for this role
    const validAttorneys = await this.getValidAttorneys(trialId, attorneyRole);

    this.logger.debug(`Valid attorneys for ${attorneyRole}: ${Array.from(validAttorneys).join(', ')}`);

    // Find the index of our original start and end
    const origStartIdx = events.findIndex(e => e.id === startEventId);
    const origEndIdx = events.findIndex(e => e.id === endEventId);

    if (origStartIdx === -1 || origEndIdx === -1) {
      this.logger.error('Could not find original boundaries in events');
      return this.createResult(events.slice(origStartIdx, origEndIdx + 1), validAttorneys);
    }

    // First, try to find the best window by trimming from the end to find valid attorney ending
    let bestWindow: OptimizationResult | null = null;
    let bestScore = -1;

    // Start from original window and try minimal trimming first
    // Look for the last SUBSTANTIAL valid attorney statement (not just a few words)
    let bestEndIdx = origEndIdx;
    for (let endIdx = origEndIdx; endIdx >= origStartIdx && endIdx >= Math.max(0, origEndIdx - 10); endIdx--) {
      const endEvent = events[endIdx];
      if (!endEvent?.statement?.speaker) continue;

      // If this is a valid attorney for our role with substantial content, use this as end
      if (endEvent.statement.speaker.speakerType === 'ATTORNEY' &&
          this.isValidAttorney(endEvent.statement.speaker.speakerHandle, validAttorneys) &&
          (endEvent.wordCount || 0) > 50) { // Require at least 50 words to be considered substantial
        bestEndIdx = endIdx;
        break; // Use the first substantial valid attorney statement we find going backwards
      }
    }

    // If no substantial statement found, look for any valid attorney
    if (bestEndIdx === origEndIdx) {
      for (let endIdx = origEndIdx; endIdx >= origStartIdx && endIdx >= Math.max(0, origEndIdx - 10); endIdx--) {
        const endEvent = events[endIdx];
        if (!endEvent?.statement?.speaker) continue;

        if (endEvent.statement.speaker.speakerType === 'ATTORNEY' &&
            this.isValidAttorney(endEvent.statement.speaker.speakerHandle, validAttorneys)) {
          bestEndIdx = endIdx;
          break;
        }
      }
    }

    // Similarly find the first valid attorney statement for start
    let bestStartIdx = origStartIdx;
    for (let startIdx = origStartIdx; startIdx <= origEndIdx && startIdx <= Math.min(events.length - 1, origStartIdx + 10); startIdx++) {
      const startEvent = events[startIdx];
      if (!startEvent?.statement?.speaker) continue;

      if (startEvent.statement.speaker.speakerType === 'ATTORNEY' &&
          this.isValidAttorney(startEvent.statement.speaker.speakerHandle, validAttorneys)) {
        bestStartIdx = startIdx;
        break; // Use the first valid attorney we find going forwards
      }
    }

    // Create the minimally trimmed window
    if (bestStartIdx !== origStartIdx || bestEndIdx !== origEndIdx) {
      const window = events.slice(bestStartIdx, bestEndIdx + 1);
      const result = this.evaluateWindow(window, validAttorneys);

      // Only use this if it's actually better (no violations and good ratio)
      if (result.violations.length === 0 && result.attorneyRatio > 0.85) {
        bestWindow = result;
        bestScore = result.score;
        this.logger.debug(`Found minimally trimmed window: ${window[0].id}-${window[window.length - 1].id}, score: ${result.score.toFixed(3)}`);
      }
    }

    // If no perfect window found, search more broadly
    if (!bestWindow) {
      for (let startIdx = Math.max(0, origStartIdx - 5); startIdx <= origStartIdx + 5 && startIdx < events.length; startIdx++) {
        for (let endIdx = Math.max(startIdx, origEndIdx - 5); endIdx <= Math.min(origEndIdx + 5, events.length - 1); endIdx++) {
          if (endIdx - startIdx < 3) continue; // Minimum window size

          const window = events.slice(startIdx, endIdx + 1);
          const result = this.evaluateWindow(window, validAttorneys);

          // Prioritize correct boundaries
          const boundaryScore =
            (result.violations.filter(v => v.includes('First speaker')).length === 0 ? 0.3 : 0) +
            (result.violations.filter(v => v.includes('Last speaker')).length === 0 ? 0.3 : 0);

          const adjustedScore = result.score + boundaryScore;

          if (adjustedScore > bestScore) {
            bestScore = adjustedScore;
            bestWindow = result;
            this.logger.debug(`New best window: ${window[0].id}-${window[window.length - 1].id}, adjusted score: ${adjustedScore.toFixed(3)}`);
          }
        }
      }
    }

    // If no perfect window found, try to find best with minimal violations
    if (!bestWindow) {
      this.logger.warn('No perfect window found, finding best with minimal violations');

      for (let startIdx = Math.max(0, origStartIdx - 5); startIdx <= origStartIdx + 5 && startIdx < events.length; startIdx++) {
        for (let endIdx = Math.max(startIdx, origEndIdx - 5); endIdx <= Math.min(origEndIdx + 5, events.length - 1); endIdx++) {
          if (endIdx - startIdx < 3) continue;

          const window = events.slice(startIdx, endIdx + 1);
          const result = this.evaluateWindow(window, validAttorneys);

          // Prefer windows with attorney boundaries even if ratio is lower
          const boundaryPenalty = result.violations.filter(v =>
            v.includes('First speaker') || v.includes('Last speaker')
          ).length * 0.3;

          const adjustedScore = result.score - boundaryPenalty;

          if (adjustedScore > bestScore) {
            bestScore = adjustedScore;
            bestWindow = result;
          }
        }
      }
    }

    // Fallback to original window if nothing better found
    if (!bestWindow) {
      bestWindow = this.evaluateWindow(events.slice(origStartIdx, origEndIdx + 1), validAttorneys);
    }

    this.logger.info(`Optimized boundaries: ${bestWindow.startEvent.id}-${bestWindow.endEvent.id}`);
    this.logger.info(`Attorney ratio: ${(bestWindow.attorneyRatio * 100).toFixed(1)}%`);
    if (bestWindow.violations.length > 0) {
      this.logger.warn(`Remaining violations: ${bestWindow.violations.join(', ')}`);
    }

    return bestWindow;
  }

  /**
   * Get valid attorney speaker handles for a role
   */
  private async getValidAttorneys(trialId: number, role: AttorneyRole | string): Promise<Set<string>> {
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

    const handles = new Set<string>();

    for (const ta of attorneys) {
      if (ta.speaker?.speakerHandle) {
        handles.add(ta.speaker.speakerHandle);
      }

      // Also add name variations
      if (ta.attorney.name) {
        const lastName = ta.attorney.lastName || ta.attorney.name.split(' ').pop() || '';
        handles.add(`MR_${lastName.toUpperCase()}`);
        handles.add(`MS_${lastName.toUpperCase()}`);
      }
    }

    return handles;
  }

  /**
   * Evaluate a window of events
   */
  private evaluateWindow(
    window: any[],
    validAttorneys: Set<string>
  ): OptimizationResult {
    const violations: string[] = [];
    let totalWords = 0;
    let attorneyWords = 0;
    let validAttorneyWords = 0; // Words from attorneys of the correct side

    // Check first and last speakers
    const firstSpeaker = window[0]?.statement?.speaker;
    const lastSpeaker = window[window.length - 1]?.statement?.speaker;

    if (firstSpeaker) {
      if (firstSpeaker.speakerType !== 'ATTORNEY') {
        violations.push(`First speaker is not attorney: ${firstSpeaker.speakerHandle}`);
      } else if (!this.isValidAttorney(firstSpeaker.speakerHandle, validAttorneys)) {
        violations.push(`First speaker is wrong side: ${firstSpeaker.speakerHandle}`);
      }
    }

    if (lastSpeaker) {
      if (lastSpeaker.speakerType !== 'ATTORNEY') {
        violations.push(`Last speaker is not attorney: ${lastSpeaker.speakerHandle}`);
      } else if (!this.isValidAttorney(lastSpeaker.speakerHandle, validAttorneys)) {
        violations.push(`Last speaker is wrong side: ${lastSpeaker.speakerHandle}`);
      }
    }

    // Calculate ratios and check for invalid speakers
    const speakerStats = new Map<string, { type: string, words: number, count: number }>();

    for (const event of window) {
      const speaker = event.statement?.speaker;
      if (!speaker) continue;

      const words = event.wordCount || 0;
      totalWords += words;

      if (speaker.speakerType === 'ATTORNEY') {
        attorneyWords += words;
        if (this.isValidAttorney(speaker.speakerHandle, validAttorneys)) {
          validAttorneyWords += words;
        }
      }

      // Track speaker stats
      const key = speaker.speakerHandle;
      if (!speakerStats.has(key)) {
        speakerStats.set(key, { type: speaker.speakerType, words: 0, count: 0 });
      }
      const stats = speakerStats.get(key)!;
      stats.words += words;
      stats.count++;

      // Check for invalid speaker types
      if (speaker.speakerType === 'WITNESS') {
        violations.push(`Contains witness: ${speaker.speakerHandle}`);
      }
      if (speaker.speakerType === 'JUROR') {
        violations.push(`Contains juror: ${speaker.speakerHandle}`);
      }
      if (speaker.speakerType === 'COURT_OFFICER' && words > 20) {
        violations.push(`Court officer speaks too much: ${speaker.speakerHandle} (${words} words)`);
      }
    }

    const attorneyRatio = totalWords > 0 ? attorneyWords / totalWords : 0;
    const validAttorneyRatio = totalWords > 0 ? validAttorneyWords / totalWords : 0;

    // Calculate score
    // Prioritize: valid attorney ratio > attorney ratio > fewer violations
    let score = validAttorneyRatio * 0.5 + attorneyRatio * 0.3;

    // Bonus for correct boundaries
    if (firstSpeaker?.speakerType === 'ATTORNEY' &&
        this.isValidAttorney(firstSpeaker.speakerHandle, validAttorneys)) {
      score += 0.1;
    }
    if (lastSpeaker?.speakerType === 'ATTORNEY' &&
        this.isValidAttorney(lastSpeaker.speakerHandle, validAttorneys)) {
      score += 0.1;
    }

    // Penalty for violations
    score -= violations.length * 0.05;

    return {
      startEvent: window[0],
      endEvent: window[window.length - 1],
      events: window,
      attorneyRatio,
      totalWords,
      attorneyWords,
      violations,
      score: Math.max(0, score)
    };
  }

  /**
   * Check if a speaker handle belongs to valid attorneys
   */
  private isValidAttorney(handle: string, validAttorneys: Set<string>): boolean {
    if (validAttorneys.has(handle)) {
      return true;
    }

    // Check variations
    const handleUpper = handle.toUpperCase();
    for (const valid of validAttorneys) {
      if (handleUpper.includes(valid.toUpperCase()) ||
          valid.toUpperCase().includes(handleUpper)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Create result from events
   */
  private createResult(events: any[], validAttorneys: Set<string>): OptimizationResult {
    return this.evaluateWindow(events, validAttorneys);
  }
}