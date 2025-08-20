import { PrismaClient, Prisma } from '@prisma/client';
import logger from '../utils/logger';
import { CourtTranscriptQuery } from './CourtTranscriptQuery';

export interface QueryResult {
  [key: string]: any;
}

export interface QueryExecutor {
  name: string;
  execute(prisma: PrismaClient, params?: any): Promise<QueryResult[]>;
}

export class StatementEventQuery implements QueryExecutor {
  name = 'StatementEvent';

  async execute(prisma: PrismaClient, params?: any): Promise<QueryResult[]> {
    const where = this.buildWhereClause(params);
    
    const statements = await prisma.statementEvent.findMany({
      where,
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
      StatementEvent: {
        statementEventId: statement.id,
        elasticSearchId: statement.elasticSearchId,
        text: statement.text,
        speakerAlias: statement.speakerAlias
      },
      TrialEvent: {
        id: statement.event.id,
        startTime: statement.event.startTime,
        endTime: statement.event.endTime,
        startLineNumber: statement.event.startLineNumber,
        endLineNumber: statement.event.endLineNumber,
        lineCount: statement.event.lineCount,
        eventType: statement.event.eventType,
        wordCount: (statement.event as any).wordCount,
        characterCount: (statement.event as any).characterCount
      },
      Trial: {
        id: statement.event.trial.id,
        trialName: statement.event.trial.name,
        caseNumber: statement.event.trial.caseNumber,
        court: statement.event.trial.court,
        courtDivision: statement.event.trial.courtDivision,
        courtDistrict: statement.event.trial.courtDistrict
      },
      Session: statement.event.session ? {
        sessionId: statement.event.session.id,
        sessionDate: statement.event.session.sessionDate,
        sessionType: statement.event.session.sessionType
      } : null,
      Speaker: statement.speaker ? {
        speakerId: statement.speaker.id,
        speakerType: statement.speaker.speakerType,
        speakerPrefix: statement.speaker.speakerPrefix,
        speakerHandle: statement.speaker.speakerHandle
      } : null
    }));
  }

  private buildWhereClause(params?: any): Prisma.StatementEventWhereInput {
    const where: Prisma.StatementEventWhereInput = {};
    
    if (!params) return where;
    
    // Build trial conditions
    const trialConditions: any[] = [];
    if (params.trialName) {
      trialConditions.push({ name: Array.isArray(params.trialName) ? { in: params.trialName } : params.trialName });
    }
    if (params.caseNumber) {
      trialConditions.push({ caseNumber: Array.isArray(params.caseNumber) ? { in: params.caseNumber } : params.caseNumber });
    }
    
    if (trialConditions.length > 0) {
      where.event = {
        trial: trialConditions.length === 1 ? trialConditions[0] : { OR: trialConditions }
      };
    }
    
    // Add session conditions
    if (params.sessionDate || params.sessionType) {
      if (!where.event) where.event = {};
      where.event = {
        ...where.event,
        session: {}
      } as any;
      
      if (params.sessionDate) {
        where.event!.session!.sessionDate = Array.isArray(params.sessionDate) 
          ? { in: params.sessionDate } 
          : params.sessionDate;
      }
      
      if (params.sessionType) {
        where.event!.session!.sessionType = Array.isArray(params.sessionType)
          ? { in: params.sessionType }
          : params.sessionType;
      }
    }
    
    // Add speaker conditions
    if (params.speakerType || params.speakerPrefix || params.speakerHandle) {
      where.speaker = {};
      
      if (params.speakerType) {
        where.speaker.speakerType = Array.isArray(params.speakerType)
          ? { in: params.speakerType }
          : params.speakerType;
      }
      
      if (params.speakerPrefix) {
        where.speaker.speakerPrefix = Array.isArray(params.speakerPrefix)
          ? { in: params.speakerPrefix }
          : params.speakerPrefix;
      }
      
      if (params.speakerHandle) {
        where.speaker.speakerHandle = Array.isArray(params.speakerHandle)
          ? { in: params.speakerHandle }
          : params.speakerHandle;
      }
    }
    
    return where;
  }
}

export class TrialEventQuery implements QueryExecutor {
  name = 'TrialEvent';

  async execute(prisma: PrismaClient, params?: any): Promise<QueryResult[]> {
    const where = this.buildWhereClause(params);
    
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
      const baseResult: QueryResult = {
        TrialEvent: {
          id: event.id,
          startTime: event.startTime,
          endTime: event.endTime,
          startLineNumber: event.startLineNumber,
          endLineNumber: event.endLineNumber,
          lineCount: event.lineCount,
          eventType: event.eventType,
          rawText: event.rawText,
          wordCount: (event as any).wordCount,
          characterCount: (event as any).characterCount
        },
        Trial: {
          id: event.trial.id,
          trialName: event.trial.name,
          caseNumber: event.trial.caseNumber,
          court: event.trial.court,
          courtDivision: event.trial.courtDivision,
          courtDistrict: event.trial.courtDistrict
        },
        Session: event.session ? {
          sessionId: event.session.id,
          sessionDate: event.session.sessionDate,
          sessionType: event.session.sessionType
        } : null
      };

      // Add type-specific data using MTI pattern
      if (event.statement) {
        baseResult.StatementEvent = {
          statementEventId: event.statement.id,
          text: event.statement.text,
          elasticSearchId: event.statement.elasticSearchId,
          speakerAlias: event.statement.speakerAlias
        };
        // Also add text property at root level for convenience
        baseResult.text = event.statement.text;
        
        if (event.statement.speaker) {
          baseResult.Speaker = {
            speakerId: event.statement.speaker.id,
            speakerType: event.statement.speaker.speakerType,
            speakerPrefix: event.statement.speaker.speakerPrefix,
            speakerHandle: event.statement.speaker.speakerHandle
          };
        }
      }
      
      if (event.witnessCalled) {
        baseResult.WitnessCalledEvent = {
          id: event.witnessCalled.id,
          examinationType: event.witnessCalled.examinationType,
          swornStatus: event.witnessCalled.swornStatus,
          continued: event.witnessCalled.continued,
          presentedByVideo: event.witnessCalled.presentedByVideo
        };
        
        if (event.witnessCalled.witness) {
          baseResult.Witness = {
            witnessId: event.witnessCalled.witness.id,
            name: event.witnessCalled.witness.name,
            displayName: event.witnessCalled.witness.displayName,
            witnessType: event.witnessCalled.witness.witnessType,
            witnessCaller: event.witnessCalled.witness.witnessCaller,
            expertField: event.witnessCalled.witness.expertField
          };
        }
      }
      
      if (event.courtDirective) {
        baseResult.CourtDirectiveEvent = {
          id: event.courtDirective.id,
          isStandard: event.courtDirective.isStandard
        };
        
        if (event.courtDirective.directiveType) {
          baseResult.DirectiveType = {
            name: event.courtDirective.directiveType.name,
            description: event.courtDirective.directiveType.description,
            isPaired: event.courtDirective.directiveType.isPaired
          };
        }
      }

      return baseResult;
    });
  }

  private buildWhereClause(params?: any): Prisma.TrialEventWhereInput {
    const where: Prisma.TrialEventWhereInput = {};
    
    if (!params) return where;
    
    // Build trial conditions
    const trialConditions: any[] = [];
    if (params.trialName) {
      trialConditions.push({ name: Array.isArray(params.trialName) ? { in: params.trialName } : params.trialName });
    }
    if (params.caseNumber) {
      trialConditions.push({ caseNumber: Array.isArray(params.caseNumber) ? { in: params.caseNumber } : params.caseNumber });
    }
    
    if (trialConditions.length > 0) {
      where.trial = trialConditions.length === 1 ? trialConditions[0] : { OR: trialConditions };
    }
    
    // Add session conditions
    if (params.sessionDate || params.sessionType) {
      where.session = {};
      
      if (params.sessionDate) {
        where.session.sessionDate = Array.isArray(params.sessionDate) 
          ? { in: params.sessionDate } 
          : params.sessionDate;
      }
      
      if (params.sessionType) {
        where.session.sessionType = Array.isArray(params.sessionType)
          ? { in: params.sessionType }
          : params.sessionType;
      }
    }
    
    // Add event type filter
    if (params.eventType) {
      where.eventType = Array.isArray(params.eventType)
        ? { in: params.eventType }
        : params.eventType;
    }
    
    // Add time range filter
    if (params.startTime || params.endTime) {
      if (params.startTime) {
        where.startTime = { gte: params.startTime };
      }
      if (params.endTime) {
        where.endTime = { lte: params.endTime };
      }
    }
    
    return where;
  }
}

export class TrialEventHierarchyQuery implements QueryExecutor {
  name = 'TrialEventHierarchy';

  async execute(prisma: PrismaClient, params?: any): Promise<QueryResult[]> {
    const trialWhere = this.buildTrialWhereClause(params);
    const eventWhere = this.buildEventWhereClause(params);
    
    const trials = await prisma.trial.findMany({
      where: trialWhere,
      include: {
        sessions: {
          orderBy: { sessionDate: 'asc' },
          include: {
            trialEvents: {
              where: eventWhere,
              orderBy: { startLineNumber: 'asc' },
              include: {
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
            }
          }
        }
      }
    });

    const results: QueryResult[] = [];
    
    for (const trial of trials) {
      const trialData = {
        id: trial.id,
        trialName: trial.name,
        caseNumber: trial.caseNumber,
        court: trial.court,
        courtDivision: trial.courtDivision,
        courtDistrict: trial.courtDistrict,
        sessions: trial.sessions.map(session => ({
          sessionId: session.id,
          sessionDate: session.sessionDate,
          sessionType: session.sessionType,
          documentNumber: session.documentNumber,
          fileName: session.fileName,
          events: session.trialEvents.map(event => {
            const eventData: any = {
              id: event.id,
              startTime: event.startTime,
              endTime: event.endTime,
              startLineNumber: event.startLineNumber,
              endLineNumber: event.endLineNumber,
              lineCount: event.lineCount,
              eventType: event.eventType,
              rawText: event.rawText,
              wordCount: (event as any).wordCount,
              characterCount: (event as any).characterCount
            };

            // Add type-specific data
            if (event.statement) {
              eventData.statement = {
                id: event.statement.id,
                text: event.statement.text,
                elasticSearchId: event.statement.elasticSearchId,
                speakerAlias: event.statement.speakerAlias,
                speaker: event.statement.speaker ? {
                  speakerId: event.statement.speaker.id,
                  speakerType: event.statement.speaker.speakerType,
                  speakerPrefix: event.statement.speaker.speakerPrefix,
                  speakerHandle: event.statement.speaker.speakerHandle
                } : null
              };
              // Also add text property at root level for convenience
              eventData.text = event.statement.text;
            }
            
            if (event.witnessCalled) {
              eventData.witnessCalled = {
                id: event.witnessCalled.id,
                examinationType: event.witnessCalled.examinationType,
                swornStatus: event.witnessCalled.swornStatus,
                continued: event.witnessCalled.continued,
                presentedByVideo: event.witnessCalled.presentedByVideo,
                witness: event.witnessCalled.witness ? {
                  id: event.witnessCalled.witness.id,
                  name: event.witnessCalled.witness.name,
                  displayName: event.witnessCalled.witness.displayName,
                  witnessType: event.witnessCalled.witness.witnessType,
                  witnessCaller: event.witnessCalled.witness.witnessCaller
                } : null
              };
            }
            
            if (event.courtDirective) {
              eventData.courtDirective = {
                id: event.courtDirective.id,
                isStandard: event.courtDirective.isStandard,
                directiveType: event.courtDirective.directiveType ? {
                  name: event.courtDirective.directiveType.name,
                  description: event.courtDirective.directiveType.description
                } : null
              };
            }

            return eventData;
          })
        }))
      };
      
      results.push(trialData);
    }

    // Apply surrounding events logic if requested
    if (params?.speakerHandle && params?.surroundingEvents) {
      return this.applySurroundingEventsFilter(results, params);
    }
    
    return results;
  }

  private applySurroundingEventsFilter(results: QueryResult[], params: any): QueryResult[] {
    const speakerHandle = params.speakerHandle;
    const surroundingCount = params.surroundingEvents || 0;
    
    return results.map((trial: any) => {
      const filteredTrial = { ...trial };
      filteredTrial.sessions = trial.sessions.map((session: any) => {
        const allEvents = session.events;
        const judgeEventIndices: number[] = [];
        
        // Find all events where the judge speaks
        allEvents.forEach((event: any, index: number) => {
          if (event.statement?.speaker?.speakerHandle === speakerHandle) {
            judgeEventIndices.push(index);
          }
        });
        
        // Collect events with surrounding context
        const includedIndices = new Set<number>();
        judgeEventIndices.forEach(index => {
          for (let i = Math.max(0, index - surroundingCount); 
               i <= Math.min(allEvents.length - 1, index + surroundingCount); 
               i++) {
            includedIndices.add(i);
          }
        });
        
        // Filter events to only include those in context
        const filteredEvents = allEvents.filter((_: any, index: number) => 
          includedIndices.has(index)
        );
        
        return {
          ...session,
          events: filteredEvents
        };
      }).filter((session: any) => session.events.length > 0); // Only keep sessions with events
      
      return filteredTrial;
    });
  }

  private buildEventWhereClause(params?: any): Prisma.TrialEventWhereInput {
    const where: Prisma.TrialEventWhereInput = {};
    
    if (!params) return where;
    
    // Add date range filtering
    if (params.startTime || params.endTime) {
      where.startTime = {};
      if (params.startTime) {
        where.startTime.gte = params.startTime;
      }
      if (params.endTime) {
        where.startTime.lte = params.endTime;
      }
    }
    
    return where;
  }

  private buildTrialWhereClause(params?: any): Prisma.TrialWhereInput {
    const where: Prisma.TrialWhereInput = {};
    
    if (!params) return where;
    
    if (params.trialName) {
      where.name = Array.isArray(params.trialName) 
        ? { in: params.trialName } 
        : params.trialName;
    }
    
    if (params.caseNumber) {
      where.caseNumber = Array.isArray(params.caseNumber)
        ? { in: params.caseNumber }
        : params.caseNumber;
    }
    
    return where;
  }
}

export class QueryRegistry {
  private static queries: Map<string, QueryExecutor> = new Map();
  
  static {
    // Register default queries
    QueryRegistry.register(new StatementEventQuery());
    QueryRegistry.register(new TrialEventQuery());
    QueryRegistry.register(new TrialEventHierarchyQuery());
    QueryRegistry.register(new CourtTranscriptQuery());
  }
  
  static register(query: QueryExecutor): void {
    this.queries.set(query.name, query);
    logger.info(`Registered query: ${query.name}`);
  }
  
  static get(name: string): QueryExecutor | undefined {
    return this.queries.get(name);
  }
  
  static async execute(name: string, prisma: PrismaClient, params?: any): Promise<QueryResult[]> {
    const query = this.get(name);
    if (!query) {
      throw new Error(`Query not found: ${name}`);
    }
    
    logger.info(`Executing query: ${name}`, params);
    return query.execute(prisma, params);
  }
  
  static list(): string[] {
    return Array.from(this.queries.keys());
  }
}