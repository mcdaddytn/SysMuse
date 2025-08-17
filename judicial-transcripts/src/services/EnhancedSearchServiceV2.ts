import { PrismaClient, Prisma, SessionType, SpeakerType } from '@prisma/client';
import { ElasticSearchService, ElasticSearchQuery } from './ElasticSearchService';
import { QueryRegistry } from './QueryRegistry';
import { TemplateEngineFactory, TemplateEngine } from './TemplateEngine';
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
  speakerHandle?: string | string[];
}

export interface EnhancedSearchInput {
  trialName?: string | string[];
  caseNumber?: string | string[];
  sessionDate?: string | string[];
  sessionType?: string | string[];
  speakerType?: string | string[];
  speakerPrefix?: string | string[];
  speakerHandle?: string | string[];
  elasticSearchQueries?: ElasticSearchQuery[];
  maxResults?: number;
  surroundingEvents?: number;
  surroundingEventUnit?: 'EventCount' | 'WordCount' | 'CharCount';
  precedingEvents?: number;
  followingEvents?: number;
  fileNameTemplate?: string;
  fileTemplate?: string;
  templateBody?: string;
  resultSeparator?: string;
  outputFormat?: 'RAW' | 'MATCHED' | 'BOTH' | 'NEITHER';
  templateType?: 'Native' | 'Mustache';
  nativeStartDelimiter?: string;
  nativeEndDelimiter?: string;
  templateQuery?: string;
  queryParams?: { [key: string]: any };
  templateParams?: { [key: string]: any };
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
  queryResults?: any[];
}

export class EnhancedSearchServiceV2 {
  private prisma: PrismaClient;
  private elasticService: ElasticSearchService;
  private templateEngine: TemplateEngine;
  
  constructor() {
    this.prisma = new PrismaClient();
    this.elasticService = new ElasticSearchService({
      url: process.env.ELASTICSEARCH_URL || 'http://localhost:9200',
      index: 'judicial_statements'
    });
    this.templateEngine = TemplateEngineFactory.create();
  }
  
  async executeSearch(input: EnhancedSearchInput): Promise<EnhancedSearchResults> {
    try {
      logger.info('Executing enhanced search V2 with filters:', input);
      
      // Use query registry if templateQuery is specified
      if (input.templateQuery) {
        return await this.executeQueryRegistrySearch(input);
      }
      
      // Otherwise use the original StatementEvent query logic
      return await this.executeStatementEventSearch(input);
    } catch (error) {
      logger.error('Error executing search:', error);
      throw error;
    } finally {
      await this.prisma.$disconnect();
    }
  }
  
  private async executeQueryRegistrySearch(input: EnhancedSearchInput): Promise<EnhancedSearchResults> {
    const queryName = input.templateQuery || 'StatementEvent';
    const queryParams = this.extractQueryParams(input);
    
    // Execute the selected query
    const queryResults = await QueryRegistry.execute(queryName, this.prisma, queryParams);
    
    // Apply surrounding events logic if needed
    const processedResults = await this.applySurroundingEvents(queryResults, input);
    
    // Create result structure
    const results: EnhancedSearchResults = {
      totalStatements: queryResults.length,
      matchedStatements: queryResults.length,
      statementResults: {},
      queryResults: processedResults,
      customParameters: {
        caseHandle: this.sanitizeForFileName(input.caseNumber?.[0] || 'unknown'),
        runTimeStamp: new Date().toISOString().replace(/:/g, '-').replace(/\./g, '-')
      },
      queryUsed: input
    };
    
    return results;
  }
  
  private async executeStatementEventSearch(input: EnhancedSearchInput): Promise<EnhancedSearchResults> {
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
      finalStatements = statements.filter(stmt => matchedStatementIds.has(stmt.statementEventId));
    }
    
    // Apply surrounding events
    if (input.surroundingEvents || input.precedingEvents || input.followingEvents) {
      finalStatements = await this.addSurroundingStatements(
        finalStatements,
        matchedStatementIds,
        input
      );
    }
    
    const hierarchicalResults = this.organizeStatementsHierarchically(finalStatements, matchedStatementIds);
    
    return {
      totalStatements: statements.length,
      matchedStatements: matchedStatementIds.size,
      statementResults: hierarchicalResults,
      elasticSearchSummary: Object.keys(elasticSearchSummary).length > 0 ? elasticSearchSummary : undefined,
      customParameters: {
        caseHandle: this.sanitizeForFileName(input.caseNumber?.[0] || 'unknown'),
        runTimeStamp: new Date().toISOString().replace(/:/g, '-').replace(/\./g, '-')
      },
      queryUsed: input
    };
  }
  
  private extractQueryParams(input: EnhancedSearchInput): any {
    // Extract query parameters from either queryParams sub-node or root level
    if (input.queryParams) {
      return input.queryParams;
    }
    
    // Backward compatibility: extract from root level
    return {
      trialName: input.trialName,
      caseNumber: input.caseNumber,
      sessionDate: input.sessionDate,
      sessionType: input.sessionType,
      speakerType: input.speakerType,
      speakerPrefix: input.speakerPrefix,
      speakerHandle: input.speakerHandle
    };
  }
  
  private async applySurroundingEvents(results: any[], input: EnhancedSearchInput): Promise<any[]> {
    if (!input.surroundingEvents && !input.precedingEvents && !input.followingEvents) {
      return results;
    }
    
    // Calculate preceding and following counts
    let precedingCount = 0;
    let followingCount = 0;
    
    if (input.precedingEvents !== undefined) {
      precedingCount = input.precedingEvents;
    }
    if (input.followingEvents !== undefined) {
      followingCount = input.followingEvents;
    }
    if (input.surroundingEvents !== undefined) {
      // Distribute surrounding events, favoring preceding by 1 if odd
      const total = input.surroundingEvents;
      precedingCount = Math.ceil(total / 2);
      followingCount = Math.floor(total / 2);
    }
    
    // Apply surrounding events based on unit type
    const unit = input.surroundingEventUnit || 'EventCount';
    
    if (unit === 'EventCount') {
      return this.applySurroundingByEventCount(results, precedingCount, followingCount);
    } else if (unit === 'WordCount') {
      return this.applySurroundingByWordCount(results, precedingCount, followingCount);
    } else if (unit === 'CharCount') {
      return this.applySurroundingByCharCount(results, precedingCount, followingCount);
    }
    
    return results;
  }
  
  private applySurroundingByEventCount(results: any[], preceding: number, following: number): any[] {
    // Implementation for event count based surrounding
    // This would need to query additional events from the database
    // For now, returning results as-is
    return results;
  }
  
  private applySurroundingByWordCount(results: any[], precedingWords: number, followingWords: number): any[] {
    // Implementation for word count based surrounding
    // This would need to query events until word count threshold is met
    return results;
  }
  
  private applySurroundingByCharCount(results: any[], precedingChars: number, followingChars: number): any[] {
    // Implementation for character count based surrounding
    // This would need to query events until character count threshold is met
    return results;
  }
  
  private buildSqlFilters(input: EnhancedSearchInput): EnhancedSqlFilters {
    const filters: EnhancedSqlFilters = {};
    
    const queryParams = input.queryParams || input;
    
    if (queryParams.trialName) filters.trialName = queryParams.trialName;
    if (queryParams.caseNumber) filters.caseNumber = queryParams.caseNumber;
    if (queryParams.sessionType) filters.sessionType = queryParams.sessionType;
    if (queryParams.speakerType) filters.speakerType = queryParams.speakerType;
    if (queryParams.speakerPrefix) filters.speakerPrefix = queryParams.speakerPrefix;
    if (queryParams.speakerHandle) filters.speakerHandle = queryParams.speakerHandle;
    
    if (queryParams.sessionDate) {
      if (Array.isArray(queryParams.sessionDate)) {
        filters.sessionDate = queryParams.sessionDate.map(date => new Date(date));
      } else {
        filters.sessionDate = new Date(queryParams.sessionDate);
      }
    }
    
    return filters;
  }
  
  private async queryStatements(filters: EnhancedSqlFilters): Promise<any[]> {
    const where = this.buildWhereClause(filters);
    
    const statements = await this.prisma.statementEvent.findMany({
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
  
  private async addSurroundingStatements(
    statements: any[],
    matchedIds: Set<number>,
    input: EnhancedSearchInput
  ): Promise<any[]> {
    const allStatementIds = new Set<number>();
    const sessionGroups = new Map<number, number[]>();
    
    // Group statements by session
    for (const stmt of statements) {
      if (stmt.sessionId) {
        if (!sessionGroups.has(stmt.sessionId)) {
          sessionGroups.set(stmt.sessionId, []);
        }
        sessionGroups.get(stmt.sessionId)!.push(stmt.statementEventId);
      }
    }
    
    // Calculate preceding and following counts
    let precedingCount = 0;
    let followingCount = 0;
    
    if (input.precedingEvents !== undefined) {
      precedingCount = input.precedingEvents;
    }
    if (input.followingEvents !== undefined) {
      followingCount = input.followingEvents;
    }
    if (input.surroundingEvents !== undefined) {
      // Distribute surrounding events, favoring preceding by 1 if odd
      const total = input.surroundingEvents;
      precedingCount = Math.ceil(total / 2);
      followingCount = Math.floor(total / 2);
    }
    
    // For each matched statement, get surrounding statements
    for (const [sessionId, stmtIds] of sessionGroups.entries()) {
      const sessionStatements = await this.getSessionStatements(sessionId);
      const sessionStmtMap = new Map(sessionStatements.map(s => [s.statementEventId, s]));
      
      for (const matchedId of stmtIds) {
        if (matchedIds.has(matchedId)) {
          allStatementIds.add(matchedId);
          
          const matchedIdx = sessionStatements.findIndex(s => s.statementEventId === matchedId);
          if (matchedIdx >= 0) {
            // Add preceding statements
            for (let i = Math.max(0, matchedIdx - precedingCount); i < matchedIdx; i++) {
              allStatementIds.add(sessionStatements[i].statementEventId);
            }
            
            // Add following statements
            for (let i = matchedIdx + 1; i <= Math.min(sessionStatements.length - 1, matchedIdx + followingCount); i++) {
              allStatementIds.add(sessionStatements[i].statementEventId);
            }
          }
        }
      }
    }
    
    // Get all required statements
    if (allStatementIds.size > statements.length) {
      return await this.getStatementsByIds(Array.from(allStatementIds));
    }
    
    return statements;
  }
  
  private async getSessionStatements(sessionId: number): Promise<any[]> {
    const statements = await this.prisma.statementEvent.findMany({
      where: {
        event: {
          sessionId: sessionId
        }
      },
      include: {
        event: {
          include: {
            trial: true,
            session: true
          }
        },
        speaker: true
      },
      orderBy: {
        event: {
          startLineNumber: 'asc'
        }
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
    
    if (filters.speakerType || filters.speakerPrefix || filters.speakerHandle) {
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
      
      if (filters.speakerHandle) {
        if (Array.isArray(filters.speakerHandle)) {
          where.speaker.speakerHandle = { in: filters.speakerHandle };
        } else {
          where.speaker.speakerHandle = filters.speakerHandle;
        }
      }
    }
    
    return where;
  }
  
  private organizeStatementsHierarchically(
    statements: any[],
    matchedIds: Set<number>
  ): { [trialKey: string]: HierarchicalTrial } {
    const trials: { [trialKey: string]: HierarchicalTrial } = {};
    
    for (const stmt of statements) {
      const trialKey = `${stmt.trialId}-${stmt.trialName}`;
      
      if (!trials[trialKey]) {
        trials[trialKey] = {
          trialId: stmt.trialId,
          trialName: stmt.trialName,
          caseNumber: stmt.caseNumber,
          court: stmt.court,
          courtDivision: stmt.courtDivision,
          courtDistrict: stmt.courtDistrict,
          sessions: {}
        };
      }
      
      const sessionKey = stmt.sessionId ? `${stmt.sessionId}-${stmt.sessionDate}` : 'no-session';
      
      if (!trials[trialKey].sessions[sessionKey]) {
        trials[trialKey].sessions[sessionKey] = {
          sessionId: stmt.sessionId,
          sessionDate: stmt.sessionDate,
          sessionType: stmt.sessionType,
          statements: []
        };
      }
      
      trials[trialKey].sessions[sessionKey].statements.push({
        statementEventId: stmt.statementEventId,
        elasticSearchId: stmt.elasticSearchId,
        text: stmt.text,
        startTime: stmt.startTime,
        endTime: stmt.endTime,
        startLineNumber: stmt.startLineNumber,
        endLineNumber: stmt.endLineNumber,
        isContextStatement: !matchedIds.has(stmt.statementEventId),
        speaker: {
          speakerId: stmt.speakerId,
          speakerType: stmt.speakerType,
          speakerPrefix: stmt.speakerPrefix,
          speakerHandle: stmt.speakerHandle
        }
      });
    }
    
    return trials;
  }
  
  async exportResults(
    results: EnhancedSearchResults,
    input: EnhancedSearchInput,
    outputDir: string,
    queryFileName?: string
  ): Promise<string[]> {
    const outputFiles: string[] = [];
    
    // Initialize template engine with config
    this.templateEngine = TemplateEngineFactory.create({
      templateType: input.templateType,
      nativeStartDelimiter: input.nativeStartDelimiter,
      nativeEndDelimiter: input.nativeEndDelimiter
    });
    
    // Get template content
    let templateContent: string;
    if (input.templateBody) {
      templateContent = input.templateBody;
    } else if (input.fileTemplate) {
      templateContent = this.loadTemplate(input.fileTemplate);
    } else {
      templateContent = 'Speaker: {Speaker.speakerPrefix}\t\tDate: {Session.sessionDate}\t\tTime: {TrialEvent.startTime}\n{StatementEvent.text}';
    }
    
    const separator = input.resultSeparator || '\n\n';
    
    // Handle different query types
    if (results.queryResults) {
      // Using query registry results
      const fileGroups = this.groupQueryResultsForOutput(results.queryResults, input.fileNameTemplate, results.customParameters, input.templateParams);
      
      for (const [fileName, items] of Object.entries(fileGroups)) {
        const renderedItems = items.map(item => {
          const mergedData = { ...item, ...input.templateParams, ...results.customParameters };
          return this.templateEngine.render(templateContent, mergedData);
        });
        
        const outputContent = renderedItems.join(separator);
        const outputPath = path.join(outputDir, fileName);
        
        fs.writeFileSync(outputPath, outputContent);
        outputFiles.push(outputPath);
      }
    } else {
      // Using traditional statement results
      const fileGroups = this.groupStatementsForOutput(results, input.fileNameTemplate);
      
      for (const [fileName, statements] of Object.entries(fileGroups)) {
        const renderedStatements = statements.map(stmt => {
          const mergedData = { ...stmt, ...input.templateParams, ...results.customParameters };
          return this.templateEngine.render(templateContent, mergedData);
        });
        
        const outputContent = renderedStatements.join(separator);
        const outputPath = path.join(outputDir, fileName);
        
        fs.writeFileSync(outputPath, outputContent);
        outputFiles.push(outputPath);
      }
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
  
  private groupQueryResultsForOutput(
    results: any[],
    fileNameTemplate?: string,
    customParams?: any,
    templateParams?: any
  ): { [fileName: string]: any[] } {
    const groups: { [fileName: string]: any[] } = {};
    const defaultFileName = `results-${customParams?.runTimeStamp || 'output'}.txt`;
    
    if (!fileNameTemplate) {
      groups[defaultFileName] = results;
      return groups;
    }
    
    const engine = TemplateEngineFactory.create();
    
    for (const item of results) {
      const mergedData = { ...item, ...templateParams, ...customParams };
      const fileName = engine.render(fileNameTemplate, mergedData);
      const sanitizedFileName = this.sanitizeForFileName(fileName);
      
      if (!groups[sanitizedFileName]) {
        groups[sanitizedFileName] = [];
      }
      groups[sanitizedFileName].push(item);
    }
    
    return groups;
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
    const engine = TemplateEngineFactory.create();
    
    for (const stmt of allStatements) {
      const fileName = engine.render(fileNameTemplate, { ...stmt, ...results.customParameters });
      const sanitizedFileName = this.sanitizeForFileName(fileName);
      
      if (!groups[sanitizedFileName]) {
        groups[sanitizedFileName] = [];
      }
      groups[sanitizedFileName].push(stmt);
    }
    
    return groups;
  }
  
  private flattenStatements(results: EnhancedSearchResults): any[] {
    const statements: any[] = [];
    
    for (const trial of Object.values(results.statementResults)) {
      for (const session of Object.values(trial.sessions)) {
        for (const stmt of session.statements) {
          statements.push({
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
            IsContext: stmt.isContextStatement || false
          });
        }
      }
    }
    
    return statements;
  }
  
  private sanitizeForFileName(str: string): string {
    return str.replace(/[<>:"|?*\/\\]/g, '-').replace(/\s+/g, '_');
  }
  
  async disconnect(): Promise<void> {
    await this.prisma.$disconnect();
  }
}