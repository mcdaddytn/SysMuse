import { PrismaClient, Prisma, SessionType, SpeakerType } from '@prisma/client';
import { ElasticSearchService, ElasticSearchQuery } from './ElasticSearchService';
import logger from '../utils/logger';
import * as fs from 'fs';
import * as path from 'path';

export interface EnhancedSqlFilters {
  trialName?: string | string[];
  caseNumber?: string | string[];
  sessionDate?: Date | Date[];
  sessionType?: string | string[];
  speakerType?: string | string[];
  speakerPrefix?: string | string[];
}

export interface EnhancedSearchInput {
  trialName?: string | string[];
  caseNumber?: string | string[];
  sessionDate?: string | string[];
  sessionType?: string | string[];
  speakerType?: string | string[];
  speakerPrefix?: string | string[];
  elasticSearchQueries?: ElasticSearchQuery[];
  maxResults?: number;
  surroundingStatements?: number;
  outputFileNameTemplate?: string;
  outputFileTemplate?: string;
  resultSeparator?: string;
  outputFormat?: 'RAW' | 'MATCHED' | 'BOTH' | 'NEITHER';
}

export interface HierarchicalStatement {
  statementEventId: number;
  elasticSearchId: string | null;
  text: string;
  startTime: string | null;
  endTime: string | null;
  startLineNumber: number | null;
  endLineNumber: number | null;
  elasticSearchMatches?: { [queryName: string]: boolean };
  elasticSearchHighlights?: string[];
  isContextStatement?: boolean;
  speaker: {
    speakerId: number | null;
    speakerType: string | null;
    speakerPrefix: string | null;
    speakerHandle: string | null;
  };
}

export interface HierarchicalSession {
  sessionId: number | null;
  sessionDate: Date | null;
  sessionType: string | null;
  statements: HierarchicalStatement[];
}

export interface HierarchicalTrial {
  trialId: number;
  trialName: string;
  caseNumber: string | null;
  court: string | null;
  courtDivision: string | null;
  courtDistrict: string | null;
  sessions: { [sessionKey: string]: HierarchicalSession };
}

export interface EnhancedSearchResults {
  totalStatements: number;
  matchedStatements: number;
  statementResults: { [trialKey: string]: HierarchicalTrial };
  elasticSearchSummary?: {
    [queryName: string]: {
      matched: number;
      percentage: number;
    };
  };
  customParameters?: {
    caseHandle?: string;
    runTimeStamp?: string;
  };
  queryUsed?: EnhancedSearchInput;
  inputQuery?: string;
}

export class EnhancedSearchService {
  private prisma: PrismaClient;
  private elasticService: ElasticSearchService;
  
  constructor() {
    this.prisma = new PrismaClient();
    this.elasticService = new ElasticSearchService({
      url: process.env.ELASTICSEARCH_URL || 'http://localhost:9200',
      index: 'judicial_statements'
    });
  }
  
  async executeSearch(input: EnhancedSearchInput): Promise<EnhancedSearchResults> {
    try {
      logger.info('Executing enhanced search with filters:', input);
      
      const sqlFilters = this.buildSqlFilters(input);
      const statements = await this.queryStatements(sqlFilters);
      logger.info(`SQL query returned ${statements.length} statements`);
      
      let matchedStatementIds = new Set<number>();
      let elasticSearchSummary: any = {};
      
      if (input.elasticSearchQueries && input.elasticSearchQueries.length > 0) {
        const elasticSearchIds = statements
          .filter(stmt => stmt.elasticSearchId)
          .map(stmt => ({ id: stmt.elasticSearchId!, statementId: stmt.statementEventId }));
        
        if (elasticSearchIds.length > 0) {
          const matchMap = await this.elasticService.matchStatementsWithQueries(
            elasticSearchIds.map(item => item.id),
            input.elasticSearchQueries
          );
          
          for (const queryDef of input.elasticSearchQueries) {
            const matchedEsIds = matchMap.get(queryDef.name) || new Set();
            elasticSearchSummary[queryDef.name] = {
              matched: 0,
              percentage: 0
            };
            
            for (const stmt of statements) {
              if (stmt.elasticSearchId && matchedEsIds.has(stmt.elasticSearchId)) {
                matchedStatementIds.add(stmt.statementEventId);
                elasticSearchSummary[queryDef.name].matched++;
              }
            }
            
            elasticSearchSummary[queryDef.name].percentage = 
              statements.length > 0 
                ? Math.round((elasticSearchSummary[queryDef.name].matched / statements.length) * 100)
                : 0;
          }
        }
      } else {
        statements.forEach(stmt => matchedStatementIds.add(stmt.statementEventId));
      }
      
      let finalStatements = statements;
      
      if (input.maxResults && matchedStatementIds.size > input.maxResults) {
        const limitedIds = Array.from(matchedStatementIds).slice(0, input.maxResults);
        matchedStatementIds = new Set(limitedIds);
      }
      
      if (input.surroundingStatements && input.surroundingStatements > 0) {
        const expandedIds = await this.addSurroundingStatements(
          Array.from(matchedStatementIds),
          input.surroundingStatements
        );
        
        const additionalStatements = await this.getStatementsByIds(
          expandedIds.filter(id => !statements.find(s => s.statementEventId === id))
        );
        
        finalStatements = [...statements, ...additionalStatements].sort((a, b) => {
          if (a.trialId !== b.trialId) return a.trialId - b.trialId;
          if (a.sessionId !== b.sessionId) return (a.sessionId || 0) - (b.sessionId || 0);
          return (a.startLineNumber || 0) - (b.startLineNumber || 0);
        });
        
        for (const stmt of finalStatements) {
          if (!matchedStatementIds.has(stmt.statementEventId)) {
            stmt.isContextStatement = true;
          }
        }
      }
      
      const hierarchicalResults = this.buildHierarchicalStructure(
        finalStatements,
        matchedStatementIds,
        input.elasticSearchQueries || []
      );
      
      const customParameters = this.generateCustomParameters(hierarchicalResults);
      
      return {
        totalStatements: statements.length,
        matchedStatements: matchedStatementIds.size,
        statementResults: hierarchicalResults,
        elasticSearchSummary: Object.keys(elasticSearchSummary).length > 0 ? elasticSearchSummary : undefined,
        customParameters,
        queryUsed: input
      };
    } catch (error) {
      logger.error('Error in enhanced search:', error);
      throw error;
    }
  }
  
  private async addSurroundingStatements(
    statementIds: number[],
    surroundingCount: number
  ): Promise<number[]> {
    const expandedIds = new Set<number>(statementIds);
    
    for (const stmtId of statementIds) {
      const stmt = await this.prisma.statementEvent.findUnique({
        where: { id: stmtId },
        include: { event: true }
      });
      
      if (!stmt) continue;
      
      // For odd numbers, favor before (e.g., 5 = 3 before, 2 after)
      const beforeCount = Math.ceil(surroundingCount / 2);
      const afterCount = Math.floor(surroundingCount / 2);
      
      if (beforeCount > 0 && stmt.event.startLineNumber !== null) {
        const beforeStatements = await this.prisma.statementEvent.findMany({
          where: {
            event: {
              trialId: stmt.event.trialId,
              sessionId: stmt.event.sessionId,
              startLineNumber: { lt: stmt.event.startLineNumber }
            }
          },
          orderBy: { event: { startLineNumber: 'desc' } },
          take: beforeCount,
          include: { event: true }
        });
        
        beforeStatements.forEach(s => expandedIds.add(s.id));
      }
      
      if (afterCount > 0 && stmt.event.startLineNumber !== null) {
        const afterStatements = await this.prisma.statementEvent.findMany({
          where: {
            event: {
              trialId: stmt.event.trialId,
              sessionId: stmt.event.sessionId,
              startLineNumber: { gt: stmt.event.startLineNumber }
            }
          },
          orderBy: { event: { startLineNumber: 'asc' } },
          take: afterCount,
          include: { event: true }
        });
        
        afterStatements.forEach(s => expandedIds.add(s.id));
      }
    }
    
    return Array.from(expandedIds);
  }
  
  private buildHierarchicalStructure(
    statements: any[],
    matchedIds: Set<number>,
    elasticQueries: ElasticSearchQuery[]
  ): { [trialKey: string]: HierarchicalTrial } {
    const result: { [trialKey: string]: HierarchicalTrial } = {};
    
    for (const stmt of statements) {
      const trialKey = `trial_${stmt.trialId}`;
      const sessionKey = `session_${stmt.sessionId || 'null'}`;
      
      if (!result[trialKey]) {
        result[trialKey] = {
          trialId: stmt.trialId,
          trialName: stmt.trialName,
          caseNumber: stmt.caseNumber,
          court: stmt.court,
          courtDivision: stmt.courtDivision,
          courtDistrict: stmt.courtDistrict,
          sessions: {}
        };
      }
      
      if (!result[trialKey].sessions[sessionKey]) {
        result[trialKey].sessions[sessionKey] = {
          sessionId: stmt.sessionId,
          sessionDate: stmt.sessionDate,
          sessionType: stmt.sessionType,
          statements: []
        };
      }
      
      const hierarchicalStatement: HierarchicalStatement = {
        statementEventId: stmt.statementEventId,
        elasticSearchId: stmt.elasticSearchId,
        text: stmt.text,
        startTime: stmt.startTime,
        endTime: stmt.endTime,
        startLineNumber: stmt.startLineNumber,
        endLineNumber: stmt.endLineNumber,
        elasticSearchMatches: stmt.elasticSearchMatches,
        elasticSearchHighlights: stmt.elasticSearchHighlights,
        isContextStatement: stmt.isContextStatement,
        speaker: {
          speakerId: stmt.speakerId,
          speakerType: stmt.speakerType,
          speakerPrefix: stmt.speakerPrefix,
          speakerHandle: stmt.speakerHandle
        }
      };
      
      result[trialKey].sessions[sessionKey].statements.push(hierarchicalStatement);
    }
    
    return result;
  }
  
  private generateCustomParameters(hierarchicalResults: { [trialKey: string]: HierarchicalTrial }): any {
    const params: any = {};
    
    const firstTrial = Object.values(hierarchicalResults)[0];
    if (firstTrial && firstTrial.caseNumber) {
      params.caseHandle = firstTrial.caseNumber.replace(/[:\s]/g, '');
    }
    
    params.runTimeStamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    
    return params;
  }
  
  private buildSqlFilters(input: EnhancedSearchInput): EnhancedSqlFilters {
    const filters: EnhancedSqlFilters = {};
    
    if (input.trialName) {
      filters.trialName = input.trialName;
    }
    
    if (input.caseNumber) {
      filters.caseNumber = input.caseNumber;
    }
    
    if (input.sessionDate) {
      if (Array.isArray(input.sessionDate)) {
        filters.sessionDate = input.sessionDate.map(date => new Date(date));
      } else {
        filters.sessionDate = new Date(input.sessionDate);
      }
    }
    
    if (input.sessionType) {
      filters.sessionType = input.sessionType;
    }
    
    if (input.speakerType) {
      filters.speakerType = input.speakerType;
    }
    
    if (input.speakerPrefix) {
      filters.speakerPrefix = input.speakerPrefix;
    }
    
    return filters;
  }
  
  private async queryStatements(filters: EnhancedSqlFilters): Promise<any[]> {
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
      caseNumber: statement.event.trial.caseNumber,
      court: statement.event.trial.court,
      courtDivision: statement.event.trial.courtDivision,
      courtDistrict: statement.event.trial.courtDistrict,
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
  }
  
  private async getStatementsByIds(statementIds: number[]): Promise<any[]> {
    if (statementIds.length === 0) return [];
    
    const statements = await this.prisma.statementEvent.findMany({
      where: { id: { in: statementIds } },
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
      caseNumber: statement.event.trial.caseNumber,
      court: statement.event.trial.court,
      courtDivision: statement.event.trial.courtDivision,
      courtDistrict: statement.event.trial.courtDistrict,
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
  }
  
  private buildWhereClause(filters: EnhancedSqlFilters): Prisma.StatementEventWhereInput {
    const where: Prisma.StatementEventWhereInput = {};
    const trialConditions: any[] = [];
    
    if (filters.trialName) {
      if (Array.isArray(filters.trialName)) {
        trialConditions.push({ name: { in: filters.trialName } });
      } else {
        trialConditions.push({ name: filters.trialName });
      }
    }
    
    if (filters.caseNumber) {
      if (Array.isArray(filters.caseNumber)) {
        trialConditions.push({ caseNumber: { in: filters.caseNumber } });
      } else {
        trialConditions.push({ caseNumber: filters.caseNumber });
      }
    }
    
    if (trialConditions.length > 0) {
      where.event = {
        trial: trialConditions.length === 1 ? trialConditions[0] : { OR: trialConditions }
      };
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
          where.event!.session!.sessionType = { in: filters.sessionType as SessionType[] };
        } else {
          where.event!.session!.sessionType = filters.sessionType as SessionType;
        }
      }
    }
    
    if (filters.speakerType || filters.speakerPrefix) {
      where.speaker = {};
      
      if (filters.speakerType) {
        if (Array.isArray(filters.speakerType)) {
          where.speaker.speakerType = { in: filters.speakerType as SpeakerType[] };
        } else {
          where.speaker.speakerType = filters.speakerType as SpeakerType;
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
  
  async exportResults(
    results: EnhancedSearchResults,
    input: EnhancedSearchInput,
    outputDir: string,
    queryFileName?: string
  ): Promise<string[]> {
    const outputFiles: string[] = [];
    
    if (!input.outputFileNameTemplate && !input.outputFileTemplate) {
      // Don't create the raw search-results file anymore - it's too large
      // Users should use outputFormat: 'RAW' if they really need it
      return outputFiles;
    }
    
    const templateContent = input.outputFileTemplate 
      ? this.loadTemplate(input.outputFileTemplate)
      : 'Speaker: {Speaker.speakerPrefix}\t\tDate: {Session.sessionDate}\t\tTime: {TrialEvent.startTime}\n{StatementEvent.text}';
    
    const separator = input.resultSeparator || '\n\n';
    const fileGroups = this.groupStatementsForOutput(results, input.outputFileNameTemplate);
    
    for (const [fileName, statements] of Object.entries(fileGroups)) {
      const renderedStatements = statements.map(stmt => 
        this.renderTemplate(templateContent, stmt, results.customParameters)
      );
      
      const outputContent = renderedStatements.join(separator);
      const outputPath = path.join(outputDir, fileName);
      
      fs.writeFileSync(outputPath, outputContent);
      outputFiles.push(outputPath);
    }
    
    return outputFiles;
  }
  
  private loadTemplate(templateFileName: string): string {
    const templatePath = path.join(process.cwd(), 'config', 'templates', templateFileName);
    
    if (!fs.existsSync(templatePath)) {
      logger.warn(`Template file not found: ${templatePath}, using default template`);
      return 'Speaker: {Speaker.speakerPrefix}\t\tDate: {Session.sessionDate}\t\tTime: {TrialEvent.startTime}\n{StatementEvent.text}';
    }
    
    return fs.readFileSync(templatePath, 'utf-8');
  }
  
  private groupStatementsForOutput(
    results: EnhancedSearchResults,
    fileNameTemplate?: string
  ): { [fileName: string]: any[] } {
    const groups: { [fileName: string]: any[] } = {};
    const defaultFileName = `results-${results.customParameters?.runTimeStamp || 'output'}.txt`;
    
    if (!fileNameTemplate) {
      const allStatements = this.flattenStatements(results);
      groups[defaultFileName] = allStatements;
      return groups;
    }
    
    const allStatements = this.flattenStatements(results);
    
    for (const stmt of allStatements) {
      const fileName = this.renderTemplate(fileNameTemplate, stmt, results.customParameters);
      const sanitizedFileName = fileName.replace(/[<>:"|?*]/g, '');
      
      if (!groups[sanitizedFileName]) {
        groups[sanitizedFileName] = [];
      }
      groups[sanitizedFileName].push(stmt);
    }
    
    return groups;
  }
  
  private flattenStatements(results: EnhancedSearchResults): any[] {
    const statements: any[] = [];
    const allStmts: any[] = [];
    
    // First collect all statements with their metadata
    for (const trial of Object.values(results.statementResults)) {
      for (const session of Object.values(trial.sessions)) {
        for (const stmt of session.statements) {
          allStmts.push({
            Trial: trial,
            Session: session,
            StatementEvent: stmt,
            Speaker: stmt.speaker,
            TrialEvent: {
              startTime: stmt.startTime,
              endTime: stmt.endTime,
              startLineNumber: stmt.startLineNumber,
              endLineNumber: stmt.endLineNumber
            },
            IsContext: stmt.isContextStatement || false,
            sessionId: session.sessionId,
            lineNumber: stmt.startLineNumber
          });
        }
      }
    }
    
    // Sort by session and line number
    allStmts.sort((a, b) => {
      if (a.sessionId !== b.sessionId) {
        return (a.sessionId || 0) - (b.sessionId || 0);
      }
      return (a.lineNumber || 0) - (b.lineNumber || 0);
    });
    
    // Deduplicate statements based on line number and text content
    // Keep track of unique statements by line number + text hash
    const uniqueStmts: any[] = [];
    const seenContent = new Set<string>();
    
    for (const stmt of allStmts) {
      // Create a unique key based on line number and text content
      const contentKey = `${stmt.lineNumber}:${stmt.StatementEvent.text?.substring(0, 100)}`;
      
      // Skip if we've already seen this exact content at this line number
      if (!seenContent.has(contentKey)) {
        uniqueStmts.push(stmt);
        seenContent.add(contentKey);
      }
    }
    
    // For each matched statement, include it and its surrounding context
    const includedIds = new Set<number>();
    const includedLineNumbers = new Set<number>();
    
    for (let i = 0; i < uniqueStmts.length; i++) {
      const stmt = uniqueStmts[i];
      if (!stmt.IsContext) {  // This is a matched statement
        // Add the matched statement and its context window
        const sessionStmts = uniqueStmts.filter(s => s.sessionId === stmt.sessionId);
        const stmtIndex = sessionStmts.findIndex(s => s.StatementEvent.statementEventId === stmt.StatementEvent.statementEventId);
        
        // Include surrounding statements within the same session
        // Use a reasonable context window (5 before, 5 after for dialogue context)
        const contextWindow = 5;
        const startIdx = Math.max(0, stmtIndex - contextWindow);
        const endIdx = Math.min(sessionStmts.length - 1, stmtIndex + contextWindow);
        
        for (let j = startIdx; j <= endIdx; j++) {
          const contextStmt = sessionStmts[j];
          // Use both ID and line number to avoid duplicates
          if (!includedIds.has(contextStmt.StatementEvent.statementEventId) && 
              !includedLineNumbers.has(contextStmt.lineNumber)) {
            statements.push(contextStmt);
            includedIds.add(contextStmt.StatementEvent.statementEventId);
            if (contextStmt.lineNumber) {
              includedLineNumbers.add(contextStmt.lineNumber);
            }
          }
        }
      }
    }
    
    return statements;
  }
  
  private renderTemplate(template: string, data: any, customParams?: any): string {
    let rendered = template;
    
    const allParams = { ...data, ...customParams };
    
    const regex = /{([^}]+)}/g;
    rendered = rendered.replace(regex, (match, path) => {
      const value = this.getNestedValue(allParams, path);
      return value !== null && value !== undefined ? String(value) : match;
    });
    
    return rendered;
  }
  
  private getNestedValue(obj: any, path: string): any {
    const parts = path.split('.');
    let current = obj;
    
    for (const part of parts) {
      if (current === null || current === undefined) {
        return null;
      }
      current = current[part];
    }
    
    if (current instanceof Date) {
      return current.toISOString().split('T')[0];
    }
    
    return current;
  }
  
  async disconnect() {
    await this.prisma.$disconnect();
  }
}