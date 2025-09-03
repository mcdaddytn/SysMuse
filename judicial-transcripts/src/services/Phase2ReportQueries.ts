import { PrismaClient } from '@prisma/client';

// Type definitions for query results
export interface QueryResult {
  [key: string]: any;
}

export interface QueryExecutor {
  execute(prisma: PrismaClient, params?: any): Promise<QueryResult[]>;
}

/**
 * Query 1: StatementEvent Distribution by Speaker (Trial-Level)
 * Calculates statistics for each speaker across an entire trial
 */
export class StatementEventBySpeakerQuery implements QueryExecutor {
  async execute(prisma: PrismaClient, params?: any): Promise<QueryResult[]> {
    const where = params?.trialId ? { trialId: params.trialId } : {};
    
    // Get all statement events through TrialEvent
    const trialEvents = await prisma.trialEvent.findMany({
      where,
      include: {
        trial: true,
        statement: true
      }
    });

    // Filter for events that have statements
    const statementEvents = trialEvents
      .filter(e => e.statement !== null)
      .map(e => ({
        ...e.statement!,
        lineCount: e.lineCount,
        wordCount: e.wordCount,
        trial: e.trial
      }));

    // Group by speakerAlias
    const speakerGroups = new Map<string, any[]>();
    for (const event of statementEvents) {
      const alias = event.speakerAlias || 'UNKNOWN';
      if (!speakerGroups.has(alias)) {
        speakerGroups.set(alias, []);
      }
      speakerGroups.get(alias)!.push(event);
    }

    // Calculate statistics for each speaker
    const results: QueryResult[] = [];
    for (const [speakerAlias, events] of speakerGroups) {
      const lineCounts = events.map(e => e.lineCount || 0).filter(c => c > 0);
      const wordCounts = events.map(e => e.wordCount || 0).filter(c => c > 0);
      
      if (lineCounts.length === 0 && wordCounts.length === 0) continue;

      // Determine speaker type from the events
      let speakerType = 'UNKNOWN';
      if (events.length > 0 && events[0].speakerId) {
        const speaker = await prisma.speaker.findUnique({
          where: { id: events[0].speakerId }
        });
        if (speaker) {
          speakerType = speaker.speakerType || 'UNKNOWN';
        }
      }

      results.push({
        speakerAlias,
        speakerType,
        totalStatements: events.length,
        lineCount: {
          max: lineCounts.length > 0 ? Math.max(...lineCounts) : 0,
          min: lineCounts.length > 0 ? Math.min(...lineCounts) : 0,
          mean: lineCounts.length > 0 ? lineCounts.reduce((a, b) => a + b, 0) / lineCounts.length : 0,
          median: lineCounts.length > 0 ? this.calculateMedian(lineCounts) : 0,
          total: lineCounts.reduce((a, b) => a + b, 0)
        },
        wordCount: {
          max: wordCounts.length > 0 ? Math.max(...wordCounts) : 0,
          min: wordCounts.length > 0 ? Math.min(...wordCounts) : 0,
          mean: wordCounts.length > 0 ? wordCounts.reduce((a, b) => a + b, 0) / wordCounts.length : 0,
          median: wordCounts.length > 0 ? this.calculateMedian(wordCounts) : 0,
          total: wordCounts.reduce((a, b) => a + b, 0)
        },
        trial: events[0].trial
      });
    }

    return results.sort((a, b) => 
      (b.lineCount?.total || 0) - (a.lineCount?.total || 0)
    );
  }

  private calculateMedian(values: number[]): number {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 
      ? sorted[mid] 
      : (sorted[mid - 1] + sorted[mid]) / 2;
  }
}

/**
 * Query 2: StatementEvent Distribution by Speaker Type (Session-Level)
 * Calculates statistics for each speaker type within each session
 */
export class StatementEventBySpeakerTypeQuery implements QueryExecutor {
  async execute(prisma: PrismaClient, params?: any): Promise<QueryResult[]> {
    const where: any = {};
    if (params?.trialId) where.trialId = params.trialId;
    if (params?.sessionId) where.id = params.sessionId;

    // Get all sessions
    const sessions = await prisma.session.findMany({
      where,
      include: {
        trial: true
      },
      orderBy: [
        { trialId: 'asc' },
        { sessionDate: 'asc' },
        { sessionType: 'asc' }
      ]
    });

    const results: QueryResult[] = [];

    for (const session of sessions) {
      // Get trial events for this session with statements
      const trialEvents = await prisma.trialEvent.findMany({
        where: {
          sessionId: session.id
        },
        include: {
          statement: {
            include: {
              speaker: true
            }
          }
        }
      });

      // Filter for events with statements
      const statementEvents = trialEvents
        .filter(e => e.statement !== null)
        .map(e => ({
          ...e.statement!,
          lineCount: e.lineCount,
          wordCount: e.wordCount,
          speakerType: e.statement!.speaker?.speakerType || 'UNKNOWN'
        }));

      // Group by speakerType
      const typeGroups = new Map<string, any[]>();
      for (const event of statementEvents) {
        const type = event.speakerType;
        if (!typeGroups.has(type)) {
          typeGroups.set(type, []);
        }
        typeGroups.get(type)!.push(event);
      }

      // Calculate statistics for each speaker type
      for (const [speakerType, events] of typeGroups) {
        const lineCounts = events.map(e => e.lineCount || 0).filter(c => c > 0);
        const wordCounts = events.map(e => e.wordCount || 0).filter(c => c > 0);
        
        if (lineCounts.length === 0 && wordCounts.length === 0) continue;

        // Get unique speakers of this type
        const uniqueSpeakers = new Set(events.map(e => e.speakerAlias)).size;

        results.push({
          trial: session.trial,
          session,
          speakerType,
          uniqueSpeakers,
          totalStatements: events.length,
          lineCount: {
            max: lineCounts.length > 0 ? Math.max(...lineCounts) : 0,
            min: lineCounts.length > 0 ? Math.min(...lineCounts) : 0,
            mean: lineCounts.length > 0 ? lineCounts.reduce((a, b) => a + b, 0) / lineCounts.length : 0,
            median: lineCounts.length > 0 ? this.calculateMedian(lineCounts) : 0,
            total: lineCounts.reduce((a, b) => a + b, 0)
          },
          wordCount: {
            max: wordCounts.length > 0 ? Math.max(...wordCounts) : 0,
            min: wordCounts.length > 0 ? Math.min(...wordCounts) : 0,
            mean: wordCounts.length > 0 ? wordCounts.reduce((a, b) => a + b, 0) / wordCounts.length : 0,
            median: wordCounts.length > 0 ? this.calculateMedian(wordCounts) : 0,
            total: wordCounts.reduce((a, b) => a + b, 0)
          }
        });
      }
    }

    return results;
  }

  private calculateMedian(values: number[]): number {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 
      ? sorted[mid] 
      : (sorted[mid - 1] + sorted[mid]) / 2;
  }
}

/**
 * Query 3: Event Timeline Query
 * Returns chronological view of all trial events
 */
export class EventTimelineQuery implements QueryExecutor {
  async execute(prisma: PrismaClient, params?: any): Promise<QueryResult[]> {
    const where: any = {};
    if (params?.trialId) where.trialId = params.trialId;
    if (params?.sessionId) where.sessionId = params.sessionId;

    const events = await prisma.trialEvent.findMany({
      where,
      include: {
        trial: true,
        session: true,
        statement: {
          include: {
            speaker: true
          }
        },
        courtDirective: {
          include: {
            directiveType: true
          }
        }
      },
      orderBy: [
        { sessionId: 'asc' },
        { startLineNumber: 'asc' }
      ]
    });

    return events.map(event => ({
      ...event,
      eventType: event.eventType,
      eventContent: this.getEventContent(event),
      speakerInfo: this.getSpeakerInfo(event),
      sequenceNumber: event.startLineNumber || 0
    }));
  }

  private getEventContent(event: any): string {
    if (event.statement) {
      return event.statement.text || '';
    }
    if (event.courtDirective) {
      return event.courtDirective.directiveType?.name || '';
    }
    return event.rawText || '';
  }

  private getSpeakerInfo(event: any): string {
    if (event.statement) {
      return event.statement.speakerAlias || event.statement.speaker?.speakerName || 'UNKNOWN';
    }
    return '';
  }
}

/**
 * Query 4: Examination Report Query
 * Returns witness examination sequences
 */
export class ExaminationReportQuery implements QueryExecutor {
  async execute(prisma: PrismaClient, params?: any): Promise<QueryResult[]> {
    const where: any = {};
    if (params?.trialId) where.trialId = params.trialId;

    const witnesses = await prisma.witness.findMany({
      where,
      include: {
        trial: true
      }
    });

    // For each witness, get their examination events
    const results = [];
    for (const witness of witnesses) {
      // Get witness called events for this witness
      const witnessCalledEvents = await prisma.witnessCalledEvent.findMany({
        where: {
          witnessId: witness.id
        },
        include: {
          event: {
            include: {
              session: true
            }
          }
        },
        orderBy: {
          event: {
            startLineNumber: 'asc'
          }
        }
      });

      const examinations = witnessCalledEvents.map(wce => ({
        examinationType: wce.examinationType,
        swornStatus: wce.swornStatus,
        continued: wce.continued,
        presentedByVideo: wce.presentedByVideo,
        session: wce.event.session,
        startTime: wce.event.startTime
      }));

      const examinationTypes = {
        direct: examinations.filter(e => e.examinationType === 'DIRECT_EXAMINATION').length,
        cross: examinations.filter(e => e.examinationType === 'CROSS_EXAMINATION').length,
        redirect: examinations.filter(e => e.examinationType === 'REDIRECT_EXAMINATION').length,
        recross: examinations.filter(e => e.examinationType === 'RECROSS_EXAMINATION').length
      };

      results.push({
        witness,
        examinations,
        totalExaminations: examinations.length,
        examinationTypes
      });
    }

    return results;
  }
}

/**
 * Query Registry
 */
export const Phase2Queries = {
  StatementEventBySpeaker: StatementEventBySpeakerQuery,
  StatementEventBySpeakerType: StatementEventBySpeakerTypeQuery,
  EventTimeline: EventTimelineQuery,
  ExaminationReport: ExaminationReportQuery
};