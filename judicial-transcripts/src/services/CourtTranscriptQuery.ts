import { PrismaClient, Prisma } from '@prisma/client';
import { QueryExecutor, QueryResult } from './QueryRegistry';
import logger from '../utils/logger';

export class CourtTranscriptQuery implements QueryExecutor {
  name = 'CourtTranscript';

  async execute(prisma: PrismaClient, params?: any): Promise<QueryResult[]> {
    const where = this.buildWhereClause(params);
    
    const events = await prisma.trialEvent.findMany({
      where,
      orderBy: [
        { sessionId: 'asc' },
        { startLineNumber: 'asc' }
      ],
      include: {
        trial: true,
        session: true,
        statement: {
          include: {
            speaker: true
          }
        },
        witnessCalled: {
          include: {
            witness: true
          }
        },
        courtDirective: {
          include: {
            directiveType: true
          }
        }
      }
    });

    return events.map(event => {
      const result: QueryResult = {
        lineNumber: event.startLineNumber,
        eventType: event.eventType,
        timestamp: event.startTime,
        
        // Trial info
        caseNumber: event.trial.caseNumber,
        trialName: event.trial.name,
        court: event.trial.court,
        
        // Session info
        sessionDate: event.session?.sessionDate,
        sessionType: event.session?.sessionType,
      };

      // Add type-specific content for transcript formatting
      if (event.statement && event.statement.speaker) {
        result.speakerHandle = event.statement.speaker.speakerHandle;
        result.speakerPrefix = event.statement.speaker.speakerPrefix;
        result.text = event.statement.text;
        result.isStatement = true;
      } else if (event.witnessCalled) {
        result.isWitnessCalled = true;
        result.witnessName = event.witnessCalled.witness?.displayName || 'Unknown Witness';
        result.examinationType = this.formatExaminationType(event.witnessCalled.examinationType);
        result.swornStatus = event.witnessCalled.swornStatus;
        result.rawText = event.rawText;
      } else if (event.courtDirective) {
        result.isCourtDirective = true;
        result.directiveText = event.rawText;
        result.directiveType = event.courtDirective.directiveType?.name;
      }

      return result;
    });
  }

  private buildWhereClause(params?: any): Prisma.TrialEventWhereInput {
    const where: Prisma.TrialEventWhereInput = {};
    
    if (!params) return where;
    
    // Filter by case number
    if (params.caseNumber) {
      where.trial = {
        caseNumber: params.caseNumber
      };
    }
    
    // Filter by date/time range
    if (params.startDateTime || params.endDateTime) {
      const timeConditions: any = {};
      
      if (params.startDateTime) {
        timeConditions.gte = params.startDateTime;
      }
      
      if (params.endDateTime) {
        timeConditions.lte = params.endDateTime;
      }
      
      where.startTime = timeConditions;
    }
    
    // Filter by session date if provided
    if (params.sessionDate) {
      if (!where.session) where.session = {};
      where.session.sessionDate = params.sessionDate;
    }
    
    return where;
  }
  
  private formatExaminationType(type: string): string {
    const typeMap: { [key: string]: string } = {
      'DIRECT_EXAMINATION': 'Direct Examination',
      'CROSS_EXAMINATION': 'Cross-Examination',
      'REDIRECT_EXAMINATION': 'Redirect Examination',
      'RECROSS_EXAMINATION': 'Recross-Examination',
      'VIDEO_DEPOSITION': 'Video Deposition'
    };
    
    return typeMap[type] || type;
  }
}