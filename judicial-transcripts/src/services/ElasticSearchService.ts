// src/services/ElasticSearchService.ts
import { Client } from '@elastic/elasticsearch';
import logger from '../utils/logger';

export class ElasticSearchService {
  private client: Client;
  private indexName: string;
  
  constructor(options: any) {
    this.client = new Client({
      node: options.url || 'http://localhost:9200',
      auth: options.apiKey ? {
        apiKey: options.apiKey
      } : undefined
    });
    this.indexName = options.index || 'judicial_transcripts';
  }
  
  async indexMarkerText(id: string, marker: any, text: string): Promise<void> {
    try {
      await this.client.index({
        index: this.indexName,
        id,
        body: {
          trialId: marker.trialId,
          markerId: marker.id,
          markerType: marker.markerType,
          markerCategory: marker.markerCategory,
          name: marker.name,
          text,
          timestamp: marker.startTime,
          createdAt: new Date()
        }
      });
      
      logger.info(`Indexed marker text in ElasticSearch: ${id}`);
    } catch (error) {
      logger.error('Error indexing to ElasticSearch:', error);
    }
  }
  
  async search(query: string, filters?: any): Promise<any> {
    try {
      const result = await this.client.search({
        index: this.indexName,
        body: {
          query: {
            bool: {
              must: [
                {
                  match: {
                    text: query
                  }
                }
              ],
              filter: filters || []
            }
          }
        }
      });
      
      return result.hits.hits;
    } catch (error) {
      logger.error('Error searching ElasticSearch:', error);
      return [];
    }
  }
}
