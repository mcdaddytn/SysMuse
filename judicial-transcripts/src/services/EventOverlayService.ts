import { PrismaClient, MarkerSection } from '@prisma/client';
import { Logger } from '../utils/logger';

const logger = new Logger('EventOverlayService');
const prisma = new PrismaClient();

export interface EventOverlay {
  id: number;
  type: string;
  subtype: string;
  startEventId: number;
  endEventId: number;
  confidence: number;
  transcript: string;
  metadata: any;
}

export interface EventSummary {
  totalEvents: number;
  sustained?: number;
  overruled?: number;
  averageConfidence: number;
  judgeInteractions?: number;
  attorneyInteractions?: number;
}

export class EventOverlayService {
  constructor(private prisma: PrismaClient) {}

  /**
   * Get events that overlap with a given section
   */
  async getOverlappingEvents(
    section: MarkerSection,
    eventType: 'objections' | 'interactions',
    minConfidence: number = 0.0,
    limit: number = 100,
    offset: number = 0
  ): Promise<EventOverlay[]> {
    if (!section.startEventId || !section.endEventId) {
      return [];
    }

    if (eventType === 'objections') {
      return this.getObjections(section, minConfidence, limit, offset);
    } else {
      return this.getInteractions(section, minConfidence, limit, offset);
    }
  }

  /**
   * Get objections overlapping with section
   */
  private async getObjections(
    section: MarkerSection,
    minConfidence: number,
    limit: number,
    offset: number
  ): Promise<EventOverlay[]> {
    // Get objection results from accumulators - get all for deduplication
    const objectionResults = await this.prisma.accumulatorResult.findMany({
      where: {
        trialId: section.trialId,
        // Check for overlap with section
        OR: [
          {
            // Objection starts within section
            AND: [
              { startEventId: { gte: section.startEventId! } },
              { startEventId: { lte: section.endEventId! } }
            ]
          },
          {
            // Objection ends within section
            AND: [
              { endEventId: { gte: section.startEventId! } },
              { endEventId: { lte: section.endEventId! } }
            ]
          },
          {
            // Objection encompasses section
            AND: [
              { startEventId: { lte: section.startEventId! } },
              { endEventId: { gte: section.endEventId! } }
            ]
          }
        ],
        floatResult: { gte: minConfidence }
      },
      orderBy: [
        { startEventId: 'asc' },
        { floatResult: 'desc' }  // Higher confidence first
      ]
    });

    // Deduplicate objections - keep only the highest confidence one for each event range
    const seenRanges = new Set<string>();
    const events: EventOverlay[] = [];

    for (const result of objectionResults) {
      // Create a unique key for this event range
      const rangeKey = `${result.startEventId}-${result.endEventId}`;

      // Skip if we've already processed this range (since we ordered by confidence desc)
      if (seenRanges.has(rangeKey)) {
        continue;
      }
      seenRanges.add(rangeKey);

      // Get the accumulator expression to determine ruling type
      const accumulator = await prisma.accumulatorExpression.findUnique({
        where: { id: result.accumulatorId }
      });

      // Skip if not an objection accumulator
      if (!accumulator || !['objection_sustained', 'objection_overruled'].includes(accumulator.name)) {
        continue;
      }

      const ruling = accumulator.name === 'objection_sustained' ? 'sustained' : 'overruled';

      // Get transcript excerpt - use windowSize from metadata or default to 7
      const windowSize = (result.metadata as any)?.windowSize || 7;
      const transcript = await this.getTranscriptExcerpt(
        result.trialId,
        result.startEventId,
        result.endEventId,
        windowSize
      );

      // Extract metadata from the result
      const metadata: any = {
        ruling,
        grounds: this.extractObjectionGrounds(transcript),
        accumulatorName: accumulator.name,
        sourceAccumulator: (result.metadata as any)?.accumulatorName || accumulator.name
      };

      // Try to identify the objecting attorney from the transcript
      const attorneyMatch = transcript.match(/^(MR\.|MS\.|MRS\.) [A-Z]+:/m);
      if (attorneyMatch) {
        metadata.objectingAttorney = attorneyMatch[0].replace(':', '');
      }

      events.push({
        id: result.id,
        type: 'objection',
        subtype: ruling,
        startEventId: result.startEventId,
        endEventId: result.endEventId,
        confidence: result.floatResult || 0.9,
        transcript,
        metadata
      });
    }

    // Apply limit and offset after deduplication
    return events.slice(offset, offset + limit);
  }

  /**
   * Get interactions overlapping with section
   */
  private async getInteractions(
    section: MarkerSection,
    minConfidence: number,
    limit: number,
    offset: number
  ): Promise<EventOverlay[]> {
    // Get interaction results from accumulators
    const interactionResults = await this.prisma.accumulatorResult.findMany({
      where: {
        trialId: section.trialId,
        // Check for overlap with section
        OR: [
          {
            AND: [
              { startEventId: { gte: section.startEventId! } },
              { startEventId: { lte: section.endEventId! } }
            ]
          },
          {
            AND: [
              { endEventId: { gte: section.startEventId! } },
              { endEventId: { lte: section.endEventId! } }
            ]
          },
          {
            AND: [
              { startEventId: { lte: section.startEventId! } },
              { endEventId: { gte: section.endEventId! } }
            ]
          }
        ],
        floatResult: { gte: minConfidence }
      },
      orderBy: { startEventId: 'asc' },
      skip: offset,
      take: limit
    });

    const events: EventOverlay[] = [];

    for (const result of interactionResults) {
      // Get the accumulator expression to determine interaction type
      const accumulator = await prisma.accumulatorExpression.findUnique({
        where: { id: result.accumulatorId }
      });

      // Skip if not an interaction accumulator
      if (!accumulator || !['judge_attorney_interaction', 'opposing_counsel_interaction'].includes(accumulator.name)) {
        continue;
      }

      const interactionType = accumulator.name === 'judge_attorney_interaction'
        ? 'judge-attorney'
        : 'opposing-counsel';

      // Get participants
      const participants = await this.getInteractionParticipants(
        result.trialId,
        result.startEventId,
        result.endEventId
      );

      // Get transcript excerpt
      const transcript = await this.getTranscriptExcerpt(
        result.trialId,
        result.startEventId,
        result.endEventId,
        8
      );

      const metadata: any = {
        interactionType,
        participants: participants.map(p => p.handle),
        participantTypes: participants.map(p => p.type),
        speakerCount: participants.length,
        accumulatorName: accumulator.name,
        sourceAccumulator: (result.metadata as any)?.accumulatorName || accumulator.name
      };

      events.push({
        id: result.id,
        type: 'interaction',
        subtype: interactionType,
        startEventId: result.startEventId,
        endEventId: result.endEventId,
        confidence: result.floatResult || 0.8,
        transcript,
        metadata
      });
    }

    return events;
  }

  /**
   * Get summary statistics for events in a section
   */
  async getEventSummary(
    section: MarkerSection,
    eventType: 'objections' | 'interactions'
  ): Promise<EventSummary> {
    if (!section.startEventId || !section.endEventId) {
      return {
        totalEvents: 0,
        averageConfidence: 0
      };
    }

    if (eventType === 'objections') {
      return this.getObjectionSummary(section);
    } else {
      return this.getInteractionSummary(section);
    }
  }

  /**
   * Get objection summary statistics
   */
  private async getObjectionSummary(section: MarkerSection): Promise<EventSummary> {
    const objectionResults = await this.prisma.accumulatorResult.findMany({
      where: {
        trialId: section.trialId,
        OR: [
          {
            AND: [
              { startEventId: { gte: section.startEventId! } },
              { startEventId: { lte: section.endEventId! } }
            ]
          },
          {
            AND: [
              { endEventId: { gte: section.startEventId! } },
              { endEventId: { lte: section.endEventId! } }
            ]
          }
        ]
      }
    });

    // Get accumulator expressions to filter by type
    let sustained = 0;
    let overruled = 0;

    for (const result of objectionResults) {
      const accumulator = await prisma.accumulatorExpression.findUnique({
        where: { id: result.accumulatorId }
      });

      if (accumulator?.name === 'objection_sustained') {
        sustained++;
      } else if (accumulator?.name === 'objection_overruled') {
        overruled++;
      }
    }

    const totalConfidence = objectionResults.reduce((sum, r) =>
      sum + (r.floatResult || 0), 0
    );

    return {
      totalEvents: objectionResults.length,
      sustained,
      overruled,
      averageConfidence: objectionResults.length > 0
        ? totalConfidence / objectionResults.length
        : 0
    };
  }

  /**
   * Get interaction summary statistics
   */
  private async getInteractionSummary(section: MarkerSection): Promise<EventSummary> {
    const interactionResults = await this.prisma.accumulatorResult.findMany({
      where: {
        trialId: section.trialId,
        OR: [
          {
            AND: [
              { startEventId: { gte: section.startEventId! } },
              { startEventId: { lte: section.endEventId! } }
            ]
          },
          {
            AND: [
              { endEventId: { gte: section.startEventId! } },
              { endEventId: { lte: section.endEventId! } }
            ]
          }
        ]
      }
    });

    // Get accumulator expressions to filter by type
    let judgeInteractions = 0;
    let attorneyInteractions = 0;

    for (const result of interactionResults) {
      const accumulator = await prisma.accumulatorExpression.findUnique({
        where: { id: result.accumulatorId }
      });

      if (accumulator?.name === 'judge_attorney_interaction') {
        judgeInteractions++;
      } else if (accumulator?.name === 'opposing_counsel_interaction') {
        attorneyInteractions++;
      }
    }

    const totalConfidence = interactionResults.reduce((sum, r) =>
      sum + (r.floatResult || 0), 0
    );

    return {
      totalEvents: interactionResults.length,
      judgeInteractions,
      attorneyInteractions,
      averageConfidence: interactionResults.length > 0
        ? totalConfidence / interactionResults.length
        : 0
    };
  }

  /**
   * Get transcript excerpt for an event range
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
      orderBy: { ordinal: 'asc' },
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

    return lines.join('\n');
  }

  /**
   * Get participants in an interaction
   */
  private async getInteractionParticipants(
    trialId: number,
    startEventId: number,
    endEventId: number
  ): Promise<Array<{ handle: string; type: string }>> {
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
      }
    });

    const participantMap = new Map<string, string>();

    for (const event of events) {
      if (event.statement?.speaker) {
        const handle = event.statement.speaker.speakerHandle;
        const type = event.statement.speaker.speakerType;
        if (handle && !participantMap.has(handle)) {
          participantMap.set(handle, type);
        }
      }
    }

    return Array.from(participantMap.entries()).map(([handle, type]) => ({
      handle,
      type
    }));
  }

  /**
   * Extract objection grounds from transcript
   */
  private extractObjectionGrounds(transcript: string): string {
    // Common objection grounds patterns
    const groundsPatterns = [
      /calls for speculation/i,
      /beyond the scope/i,
      /asked and answered/i,
      /argumentative/i,
      /compound question/i,
      /leading/i,
      /foundation/i,
      /hearsay/i,
      /relevance/i,
      /assumes facts not in evidence/i,
      /non-responsive/i
    ];

    for (const pattern of groundsPatterns) {
      const match = transcript.match(pattern);
      if (match) {
        return match[0].toLowerCase();
      }
    }

    return 'unspecified';
  }
}