// src/services/SearchService.ts
import { PrismaClient } from '@prisma/client';
import { ElasticSearchService } from './ElasticSearchService';
import logger from '../utils/logger';

export interface SearchQuery {
  query: string;
  trialId?: number;
  sessionIds?: number[];
  markerTypes?: string[];
  speakerTypes?: string[];
  dateRange?: {
    start: Date;
    end: Date;
  };
  limit?: number;
  offset?: number;
}

export interface SearchResult {
  id: string;
  trialId: number;
  trialName: string;
  sessionDate?: Date;
  markerType?: string;
  speakerName?: string;
  text: string;
  highlight: string;
  score: number;
  metadata?: any;
}

export class SearchService {
  private prisma: PrismaClient;
  private elasticSearch: ElasticSearchService;
  
  constructor() {
    this.prisma = new PrismaClient();
    this.elasticSearch = new ElasticSearchService({
      url: process.env.ELASTICSEARCH_URL || 'http://localhost:9200',
      index: 'judicial_transcripts'
    });
  }
  
  async search(searchQuery: SearchQuery): Promise<SearchResult[]> {
    logger.info('Executing search query:', searchQuery);
    
    try {
      // Build ElasticSearch filters
      const filters = this.buildFilters(searchQuery);
      
      // Execute search
      const hits = await this.elasticSearch.search(searchQuery.query, filters);
      
      // Process and enrich results
      const results = await this.processSearchResults(hits, searchQuery);
      
      return results;
    } catch (error) {
      logger.error('Error during search:', error);
      throw error;
    }
  }
  
  // Phase 3 feature - commented out until schema is ready
  /*
  async searchByPattern(
    pattern: string,
    trialId?: number
  ): Promise<SearchResult[]> {
    logger.info(`Searching by pattern: ${pattern}`);
    
    try {
      // Get search patterns from database
      const searchPattern = await this.prisma.searchPattern.findFirst({
        where: {
          pattern,
          isActive: true
        }
      });
      
      if (!searchPattern) {
        logger.warn(`Pattern not found: ${pattern}`);
        return [];
      }
      
      // Build query based on pattern
      const query: SearchQuery = {
        query: searchPattern.pattern,
        trialId
      };
      
      return this.search(query);
    } catch (error) {
      logger.error('Error in pattern search:', error);
      throw error;
    }
  }
  */
  
  // Phase 3 feature - commented out until schema is ready
  /*
  async searchWithinMarkers(
    query: string,
    markerIds: number[]
  ): Promise<SearchResult[]> {
    logger.info(`Searching within ${markerIds.length} markers`);
    
    try {
      // Get marker texts
      const markerTexts = await this.prisma.markerText.findMany({
        where: {
          markerId: { in: markerIds },
          textRenderMode: 'ORIGINAL'
        },
        include: {
          marker: {
            include: {
              trial: true
            }
          }
        }
      });
      
      // Search within each marker text
      const results: SearchResult[] = [];
      
      for (const markerText of markerTexts) {
        if (markerText.text.toLowerCase().includes(query.toLowerCase())) {
          // Extract matching context
          const highlight = this.extractHighlight(markerText.text, query);
          
          results.push({
            id: markerText.id.toString(),
            trialId: markerText.marker.trialId,
            trialName: markerText.marker.trial.name,
            markerType: markerText.marker.markerType,
            text: markerText.text,
            highlight,
            score: this.calculateRelevanceScore(markerText.text, query),
            metadata: {
              markerId: markerText.markerId,
              markerName: markerText.marker.name
            }
          });
        }
      }
      
      // Sort by relevance score
      return results.sort((a, b) => b.score - a.score);
    } catch (error) {
      logger.error('Error searching within markers:', error);
      throw error;
    }
  }
  */
  
  private buildFilters(searchQuery: SearchQuery): any[] {
    const filters: any[] = [];
    
    if (searchQuery.trialId) {
      filters.push({ term: { trialId: searchQuery.trialId } });
    }
    
    if (searchQuery.markerTypes && searchQuery.markerTypes.length > 0) {
      filters.push({
        terms: { markerType: searchQuery.markerTypes }
      });
    }
    
    if (searchQuery.dateRange) {
      filters.push({
        range: {
          timestamp: {
            gte: searchQuery.dateRange.start,
            lte: searchQuery.dateRange.end
          }
        }
      });
    }
    
    return filters;
  }
  
  private async processSearchResults(
    hits: any[],
    searchQuery: SearchQuery
  ): Promise<SearchResult[]> {
    const results: SearchResult[] = [];
    
    for (const hit of hits) {
      const source = hit._source;
      
      // Get trial information
      const trial = await this.prisma.trial.findUnique({
        where: { id: source.trialId }
      });
      
      if (!trial) continue;
      
      results.push({
        id: hit._id,
        trialId: source.trialId,
        trialName: trial.name,
        markerType: source.markerType,
        speakerName: source.speakerName,
        text: source.text,
        highlight: hit.highlight?.text?.[0] || this.extractHighlight(source.text, searchQuery.query),
        score: hit._score,
        metadata: source
      });
    }
    
    return results;
  }
  
  private extractHighlight(text: string, query: string, contextLength: number = 100): string {
    const lowerText = text.toLowerCase();
    const lowerQuery = query.toLowerCase();
    const index = lowerText.indexOf(lowerQuery);
    
    if (index === -1) return text.substring(0, contextLength * 2) + '...';
    
    const start = Math.max(0, index - contextLength);
    const end = Math.min(text.length, index + query.length + contextLength);
    
    let highlight = text.substring(start, end);
    
    if (start > 0) highlight = '...' + highlight;
    if (end < text.length) highlight = highlight + '...';
    
    // Highlight the matching text
    const regex = new RegExp(`(${query})`, 'gi');
    highlight = highlight.replace(regex, '**$1**');
    
    return highlight;
  }
  
  private calculateRelevanceScore(text: string, query: string): number {
    const lowerText = text.toLowerCase();
    const lowerQuery = query.toLowerCase();
    
    // Count occurrences
    const occurrences = (lowerText.match(new RegExp(lowerQuery, 'g')) || []).length;
    
    // Calculate position score (earlier matches score higher)
    const firstIndex = lowerText.indexOf(lowerQuery);
    const positionScore = firstIndex === -1 ? 0 : (1 - firstIndex / text.length);
    
    // Combined score
    return occurrences * 10 + positionScore * 5;
  }
}

