import { PrismaClient, Prisma } from '@prisma/client';
import logger from '../utils/logger';
import { QueryExecutor, QueryResult } from './QueryRegistry';

/**
 * Query 1: Hierarchical Trial/Session/SessionSection query
 * Returns all SessionSections for each trial and session
 */
export class TrialSessionSectionQuery implements QueryExecutor {
  name = 'TrialSessionSection';

  async execute(prisma: PrismaClient, params?: any): Promise<QueryResult[]> {
    const where = this.buildWhereClause(params);
    
    const trials = await prisma.trial.findMany({
      where,
      include: {
        sessions: {
          orderBy: { sessionDate: 'asc' },
          include: {
            sessionSections: {
              orderBy: { orderIndex: 'asc' }
            }
          }
        }
      }
    });

    const results: QueryResult[] = [];
    
    for (const trial of trials) {
      for (const session of (trial as any).sessions) {
        results.push({
          trial: {
            id: trial.id,
            name: trial.name,
            caseNumber: trial.caseNumber,
            caseHandle: trial.caseHandle,
            plaintiff: trial.plaintiff,
            defendant: trial.defendant,
            court: trial.court,
            courtDistrict: trial.courtDistrict,
            courtDivision: trial.courtDivision
          },
          session: {
            id: session.id,
            sessionDate: session.sessionDate,
            sessionType: session.sessionType,
            startTime: session.startTime,
            fileName: session.fileName,
            documentNumber: session.documentNumber
          },
          sessionSections: session.sessionSections.map((section: any) => ({
            id: section.id,
            sectionType: section.sectionType,
            sectionText: section.sectionText,
            orderIndex: section.orderIndex,
            metadata: section.metadata
          }))
        });
      }
    }
    
    return results;
  }

  private buildWhereClause(params?: any): Prisma.TrialWhereInput {
    const where: Prisma.TrialWhereInput = {};
    
    if (!params) return where;
    
    if (params.trialId) {
      where.id = params.trialId;
    }
    
    if (params.trialName) {
      where.name = params.trialName;
    }
    
    if (params.caseNumber) {
      where.caseNumber = params.caseNumber;
    }
    
    return where;
  }
}

/**
 * Query 2: Hierarchical Trial/Session/Page/Line query
 * Returns all Lines for each trial, session, and page
 * Can be filtered by documentSection
 */
export class TrialSessionPageLineQuery implements QueryExecutor {
  name = 'TrialSessionPageLine';

  async execute(prisma: PrismaClient, params?: any): Promise<QueryResult[]> {
    const trialWhere = this.buildTrialWhereClause(params);
    const lineWhere = this.buildLineWhereClause(params);
    
    const trials = await prisma.trial.findMany({
      where: trialWhere,
      include: {
        sessions: {
          orderBy: { sessionDate: 'asc' },
          include: {
            pages: {
              orderBy: { pageNumber: 'asc' },
              include: {
                lines: {
                  where: lineWhere,
                  orderBy: { lineNumber: 'asc' }
                }
              }
            }
          }
        }
      }
    });

    const results: QueryResult[] = [];
    
    for (const trial of trials) {
      for (const session of (trial as any).sessions) {
        const sessionResult: QueryResult = {
          trial: {
            id: trial.id,
            name: trial.name,
            caseNumber: trial.caseNumber,
            caseHandle: trial.caseHandle,
            plaintiff: trial.plaintiff,
            defendant: trial.defendant,
            court: trial.court,
            courtDistrict: trial.courtDistrict,
            courtDivision: trial.courtDivision
          },
          session: {
            id: session.id,
            sessionDate: session.sessionDate,
            sessionType: session.sessionType,
            startTime: session.startTime,
            fileName: session.fileName,
            documentNumber: session.documentNumber
          },
          pages: []
        };

        for (const page of (session as any).pages) {
          if (page.lines.length > 0) {
            (sessionResult.pages as any[]).push({
              pageNumber: page.pageNumber,
              trialPageNumber: page.trialPageNumber,
              lines: page.lines.map((line: any) => ({
                id: line.id,
                lineNumber: line.lineNumber,
                text: line.text,
                linePrefix: line.linePrefix,
                documentSection: line.documentSection,
                speakerPrefix: line.speakerPrefix,
                isBlank: line.isBlank,
                timestamp: line.timestamp
              }))
            });
          }
        }

        if ((sessionResult.pages as any[]).length > 0) {
          results.push(sessionResult);
        }
      }
    }
    
    return results;
  }

  private buildTrialWhereClause(params?: any): Prisma.TrialWhereInput {
    const where: Prisma.TrialWhereInput = {};
    
    if (!params) return where;
    
    if (params.trialId) {
      where.id = params.trialId;
    }
    
    if (params.trialName) {
      where.name = params.trialName;
    }
    
    if (params.caseNumber) {
      where.caseNumber = params.caseNumber;
    }
    
    return where;
  }

  private buildLineWhereClause(params?: any): Prisma.LineWhereInput {
    const where: Prisma.LineWhereInput = {};
    
    if (!params) return where;
    
    if (params.documentSection) {
      where.documentSection = params.documentSection;
    }
    
    return where;
  }
}

/**
 * Query for getting summary lines only (filtered to SUMMARY section)
 */
export class SummaryLinesQuery implements QueryExecutor {
  name = 'SummaryLines';

  async execute(prisma: PrismaClient, params?: any): Promise<QueryResult[]> {
    // Use the TrialSessionPageLine query with documentSection filter
    const lineQuery = new TrialSessionPageLineQuery();
    const queryParams = {
      ...params,
      documentSection: 'SUMMARY'
    };
    
    const results = await lineQuery.execute(prisma, queryParams);
    
    // Transform results to focus on clean text output
    return results.map(result => ({
      trial: result.trial,
      session: result.session,
      summaryText: this.extractCleanText(result.pages as any[])
    }));
  }

  private extractCleanText(pages: any[]): string[] {
    const lines: string[] = [];
    
    for (const page of pages) {
      for (const line of page.lines) {
        // Only include the text, removing prefixes and other artifacts
        if (line.text && line.text.trim()) {
          lines.push(line.text);
        }
      }
    }
    
    return lines;
  }
}

/**
 * Query for session statistics
 */
export class SessionStatisticsQuery implements QueryExecutor {
  name = 'SessionStatistics';

  async execute(prisma: PrismaClient, params?: any): Promise<QueryResult[]> {
    const where = this.buildWhereClause(params);
    
    const sessions = await prisma.session.findMany({
      where,
      include: {
        trial: true,
        pages: {
          include: {
            _count: {
              select: {
                lines: true
              }
            }
          }
        },
        sessionSections: {
          select: {
            sectionType: true
          }
        },
        _count: {
          select: {
            trialEvents: true
          }
        }
      }
    });

    return sessions.map(session => {
      const pageCount = session.pages.length;
      const lineCount = session.pages.reduce((sum, page) => sum + page._count.lines, 0);
      const eventCount = session._count.trialEvents;
      const sectionTypes = [...new Set(session.sessionSections.map(s => s.sectionType))];

      return {
        trial: {
          id: session.trial.id,
          name: session.trial.name,
          caseNumber: session.trial.caseNumber,
          caseHandle: session.trial.caseHandle
        },
        session: {
          id: session.id,
          sessionDate: session.sessionDate,
          sessionType: session.sessionType,
          fileName: session.fileName
        },
        statistics: {
          pageCount,
          lineCount,
          eventCount,
          sectionTypes,
          averageLinesPerPage: pageCount > 0 ? Math.round(lineCount / pageCount) : 0
        }
      };
    });
  }

  private buildWhereClause(params?: any): Prisma.SessionWhereInput {
    const where: Prisma.SessionWhereInput = {};
    
    if (!params) return where;
    
    if (params.sessionId) {
      where.id = params.sessionId;
    }
    
    if (params.trialId) {
      where.trialId = params.trialId;
    }
    
    if (params.sessionDate) {
      where.sessionDate = params.sessionDate;
    }
    
    if (params.sessionType) {
      where.sessionType = params.sessionType;
    }
    
    return where;
  }
}