import { PrismaClient, Prisma } from '@prisma/client';
import logger from '../utils/logger';

export interface SqlFilters {
  trialName?: string | string[];
  sessionDate?: Date | Date[];
  sessionType?: string | string[];
  speakerType?: string | string[];
  speakerPrefix?: string | string[];
}

export interface StatementQueryResult {
  statementEventId: number;
  elasticSearchId: string | null;
  text: string;
  trialId: number;
  trialName: string;
  sessionId: number | null;
  sessionDate: Date | null;
  sessionType: string | null;
  speakerId: number | null;
  speakerType: string | null;
  speakerPrefix: string | null;
  speakerHandle: string | null;
  startTime: string | null;
  endTime: string | null;
  startLineNumber: number | null;
  endLineNumber: number | null;
}

export class SqlQueryService {
  private prisma: PrismaClient;
  
  constructor() {
    this.prisma = new PrismaClient();
  }
  
  async queryStatements(filters: SqlFilters): Promise<StatementQueryResult[]> {
    try {
      const whereClause = this.buildWhereClause(filters);
      
      const statements = await this.prisma.statementEvent.findMany({
        where: whereClause,
        include: {
          event: {
            include: {
              trial: true,
              session: true
            }
          },
          speaker: true
        }
      });
      
      return statements.map(statement => ({
        statementEventId: statement.id,
        elasticSearchId: statement.elasticSearchId,
        text: statement.text,
        trialId: statement.event.trialId,
        trialName: statement.event.trial.name,
        sessionId: statement.event.sessionId,
        sessionDate: statement.event.session?.sessionDate || null,
        sessionType: statement.event.session?.sessionType || null,
        speakerId: statement.speakerId,
        speakerType: statement.speaker?.speakerType || null,
        speakerPrefix: statement.speaker?.speakerPrefix || null,
        speakerHandle: statement.speaker?.speakerHandle || null,
        startTime: statement.event.startTime,
        endTime: statement.event.endTime,
        startLineNumber: statement.event.startLineNumber,
        endLineNumber: statement.event.endLineNumber
      }));
    } catch (error) {
      logger.error('Error querying statements:', error);
      throw error;
    }
  }
  
  async getStatementsByIds(statementIds: number[]): Promise<StatementQueryResult[]> {
    try {
      const statements = await this.prisma.statementEvent.findMany({
        where: {
          id: { in: statementIds }
        },
        include: {
          event: {
            include: {
              trial: true,
              session: true
            }
          },
          speaker: true
        }
      });
      
      return statements.map(statement => ({
        statementEventId: statement.id,
        elasticSearchId: statement.elasticSearchId,
        text: statement.text,
        trialId: statement.event.trialId,
        trialName: statement.event.trial.name,
        sessionId: statement.event.sessionId,
        sessionDate: statement.event.session?.sessionDate || null,
        sessionType: statement.event.session?.sessionType || null,
        speakerId: statement.speakerId,
        speakerType: statement.speaker?.speakerType || null,
        speakerPrefix: statement.speaker?.speakerPrefix || null,
        speakerHandle: statement.speaker?.speakerHandle || null,
        startTime: statement.event.startTime,
        endTime: statement.event.endTime,
        startLineNumber: statement.event.startLineNumber,
        endLineNumber: statement.event.endLineNumber
      }));
    } catch (error) {
      logger.error('Error getting statements by IDs:', error);
      throw error;
    }
  }
  
  private buildWhereClause(filters: SqlFilters): Prisma.StatementEventWhereInput {
    const where: Prisma.StatementEventWhereInput = {};
    
    if (filters.trialName) {
      if (Array.isArray(filters.trialName)) {
        where.event = {
          trial: {
            name: { in: filters.trialName }
          }
        };
      } else {
        where.event = {
          trial: {
            name: filters.trialName
          }
        };
      }
    }
    
    if (filters.sessionDate || filters.sessionType) {
      if (!where.event) {
        where.event = {};
      }
      where.event = {
        ...where.event,
        session: {}
      } as any;
      
      if (filters.sessionDate) {
        if (Array.isArray(filters.sessionDate)) {
          where.event!.session!.sessionDate = { in: filters.sessionDate };
        } else {
          where.event!.session!.sessionDate = filters.sessionDate;
        }
      }
      
      if (filters.sessionType) {
        if (Array.isArray(filters.sessionType)) {
          where.event!.session!.sessionType = { in: filters.sessionType as any };
        } else {
          where.event!.session!.sessionType = filters.sessionType as any;
        }
      }
    }
    
    if (filters.speakerType || filters.speakerPrefix) {
      where.speaker = {};
      
      if (filters.speakerType) {
        if (Array.isArray(filters.speakerType)) {
          where.speaker.speakerType = { in: filters.speakerType as any };
        } else {
          where.speaker.speakerType = filters.speakerType as any;
        }
      }
      
      if (filters.speakerPrefix) {
        if (Array.isArray(filters.speakerPrefix)) {
          where.speaker.speakerPrefix = { in: filters.speakerPrefix };
        } else {
          where.speaker.speakerPrefix = filters.speakerPrefix;
        }
      }
    }
    
    return where;
  }
  
  async getTrialByName(name: string) {
    return await this.prisma.trial.findFirst({
      where: { name }
    });
  }
  
  async getAllTrials() {
    return await this.prisma.trial.findMany({
      orderBy: { name: 'asc' }
    });
  }
  
  async getSpeakersByTrial(trialId: number) {
    return await this.prisma.speaker.findMany({
      where: { trialId },
      orderBy: { speakerPrefix: 'asc' }
    });
  }
  
  async disconnect() {
    await this.prisma.$disconnect();
  }
}