import { Client } from '@elastic/elasticsearch';
import { PrismaClient, Trial } from '@prisma/client';
import logger from '../utils/logger';

export interface LifecycleConfig {
  enabled: boolean;
  autoCleanup: boolean;
  cleanupDelay: number;
  preserveMarkerSections: boolean;
  phase2IndexPrefix: string;
  phase3IndexPrefix: string;
  maxConcurrentTrials: number;
}

export class ElasticsearchLifecycleService {
  private client: Client;
  private prisma: PrismaClient;
  private config: LifecycleConfig;
  
  constructor(
    elasticsearchUrl: string = 'http://localhost:9200',
    config?: Partial<LifecycleConfig>
  ) {
    this.client = new Client({ node: elasticsearchUrl });
    this.prisma = new PrismaClient();
    
    this.config = {
      enabled: true,
      autoCleanup: true,
      cleanupDelay: 0,
      preserveMarkerSections: true,
      phase2IndexPrefix: 'trial_phase2_',
      phase3IndexPrefix: 'trial_phase3_',
      maxConcurrentTrials: 1,
      ...config
    };
  }
  
  /**
   * Get index name for Phase 2 data (temporary, per-trial)
   */
  getPhase2IndexName(trialId: number): string {
    return `${this.config.phase2IndexPrefix}${trialId}`;
  }
  
  /**
   * Get index name for Phase 3 data (permanent, all trials)
   */
  getPhase3IndexName(): string {
    return 'judicial_markers_permanent';
  }
  
  /**
   * Create or clear Phase 2 index for a trial
   */
  async preparePhase2Index(trialId: number): Promise<string> {
    const indexName = this.getPhase2IndexName(trialId);
    
    try {
      // Check if index exists
      const exists = await this.client.indices.exists({ index: indexName });
      
      if (exists) {
        logger.info(`Clearing existing Phase 2 index: ${indexName}`);
        await this.client.deleteByQuery({
          index: indexName,
          body: {
            query: { match_all: {} }
          }
        });
      } else {
        logger.info(`Creating new Phase 2 index: ${indexName}`);
        await this.client.indices.create({
          index: indexName,
          body: {
            settings: {
              number_of_shards: 1,
              number_of_replicas: 0,
              'index.refresh_interval': '1s'
            },
            mappings: {
              properties: {
                trialId: { type: 'integer' },
                sessionId: { type: 'integer' },
                pageId: { type: 'integer' },
                lineNumber: { type: 'integer' },
                pageNumber: { type: 'integer' },
                text: { 
                  type: 'text',
                  analyzer: 'standard',
                  fields: {
                    keyword: { type: 'keyword' }
                  }
                },
                speakerName: { type: 'keyword' },
                speakerRole: { type: 'keyword' },
                statementType: { type: 'keyword' },
                timestamp: { type: 'date' },
                metadata: { type: 'object', enabled: false }
              }
            }
          }
        });
      }
      
      // Update or create processing status
      await this.prisma.trialProcessingStatus.upsert({
        where: { trialId },
        update: {
          phase2StartedAt: new Date(),
          phase2IndexName: indexName,
          elasticsearchCleared: false
        },
        create: {
          trialId,
          phase2StartedAt: new Date(),
          phase2IndexName: indexName,
          elasticsearchCleared: false
        }
      });
      
      return indexName;
    } catch (error) {
      logger.error(`Error preparing Phase 2 index for trial ${trialId}:`, error);
      throw error;
    }
  }
  
  /**
   * Ensure Phase 3 permanent index exists
   */
  async preparePhase3Index(): Promise<string> {
    const indexName = this.getPhase3IndexName();
    
    try {
      const exists = await this.client.indices.exists({ index: indexName });
      
      if (!exists) {
        logger.info(`Creating permanent Phase 3 index: ${indexName}`);
        await this.client.indices.create({
          index: indexName,
          body: {
            settings: {
              number_of_shards: 2,
              number_of_replicas: 1,
              'index.refresh_interval': '5s'
            },
            mappings: {
              properties: {
                trialId: { type: 'integer' },
                trialName: { type: 'keyword' },
                caseNumber: { type: 'keyword' },
                markerId: { type: 'integer' },
                markerType: { type: 'keyword' },
                sectionType: { type: 'keyword' },
                sectionNumber: { type: 'integer' },
                text: { 
                  type: 'text',
                  analyzer: 'standard',
                  fields: {
                    keyword: { type: 'keyword' }
                  }
                },
                startPage: { type: 'integer' },
                endPage: { type: 'integer' },
                startLine: { type: 'integer' },
                endLine: { type: 'integer' },
                witnessName: { type: 'keyword' },
                attorneyName: { type: 'keyword' },
                examinationType: { type: 'keyword' },
                timestamp: { type: 'date' },
                metadata: { type: 'object', enabled: false }
              }
            }
          }
        });
      }
      
      return indexName;
    } catch (error) {
      logger.error('Error preparing Phase 3 index:', error);
      throw error;
    }
  }
  
  /**
   * Clean up Phase 2 Elasticsearch data for a trial
   */
  async cleanupPhase2Data(trialId: number): Promise<void> {
    if (!this.config.enabled || !this.config.autoCleanup) {
      logger.info(`Elasticsearch lifecycle cleanup disabled for trial ${trialId}`);
      return;
    }
    
    const indexName = this.getPhase2IndexName(trialId);
    
    try {
      // Wait if configured
      if (this.config.cleanupDelay > 0) {
        logger.info(`Waiting ${this.config.cleanupDelay}ms before cleanup`);
        await new Promise(resolve => setTimeout(resolve, this.config.cleanupDelay));
      }
      
      // Delete the entire index
      const exists = await this.client.indices.exists({ index: indexName });
      if (exists) {
        logger.info(`Deleting Phase 2 index: ${indexName}`);
        await this.client.indices.delete({ index: indexName });
      }
      
      // Update database records
      await this.prisma.statementEvent.updateMany({
        where: { 
          event: { trialId } 
        },
        data: { elasticSearchId: null }
      });
      
      // Mark trial as cleared
      await this.prisma.trialProcessingStatus.update({
        where: { trialId },
        data: {
          elasticsearchCleared: true,
          elasticsearchClearedAt: new Date(),
          phase3CompletedAt: new Date()
        }
      });
      
      logger.info(`Successfully cleaned up Phase 2 ES data for trial ${trialId}`);
    } catch (error) {
      logger.error(`Error cleaning up Phase 2 data for trial ${trialId}:`, error);
      throw error;
    }
  }
  
  /**
   * Index Phase 3 marker sections to permanent index
   */
  async indexPhase3MarkerSections(trialId: number): Promise<void> {
    if (!this.config.preserveMarkerSections) {
      logger.info('MarkerSection preservation disabled');
      return;
    }
    
    try {
      const indexName = await this.preparePhase3Index();
      
      // Get trial info
      const trial = await this.prisma.trial.findUnique({
        where: { id: trialId }
      });
      
      if (!trial) {
        throw new Error(`Trial ${trialId} not found`);
      }
      
      // Get all markers with their sections for the trial
      const markers = await this.prisma.marker.findMany({
        where: { trialId },
        include: {
          sections: true
        }
      });
      
      let totalSections = 0;
      const bulkBody: any[] = [];
      
      for (const marker of markers) {
        totalSections += marker.sections.length;
        
        for (const section of marker.sections) {
          const doc = {
            trialId: trial.id,
            trialName: trial.name,
            caseNumber: trial.caseNumber,
            markerId: marker.id,
            markerType: marker.markerType,
            markerSectionId: section.id,
            sectionText: section.sectionText,
            startPage: marker.startPage,
            endPage: marker.endPage,
            startLine: marker.startLine,
            endLine: marker.endLine,
            witnessName: marker.witnessName,
            attorneyName: marker.attorneyName,
            examinationType: marker.examinationType,
            timestamp: new Date(),
            metadata: {
              ...marker.metadata,
              sectionNumber: section.sectionNumber
            }
          };
          
          bulkBody.push(
            { index: { _index: indexName, _id: `${trialId}_marker_${marker.id}_section_${section.id}` } },
            doc
          );
        }
      }
      
      logger.info(`Indexing ${totalSections} marker sections from ${markers.length} markers for trial ${trialId}`);
      
      if (totalSections === 0) {
        return;
      }
      
      // Bulk index to Elasticsearch
      const result = await this.client.bulk({
        body: bulkBody,
        refresh: true
      });
      
      if (result.errors) {
        logger.error('Bulk indexing errors:', result.items.filter((item: any) => item.index?.error));
      } else {
        logger.info(`Successfully indexed ${totalSections} marker sections to permanent index`);
      }
    } catch (error) {
      logger.error(`Error indexing Phase 3 marker sections for trial ${trialId}:`, error);
      throw error;
    }
  }
  
  /**
   * Get Elasticsearch storage status
   */
  async getStorageStatus(): Promise<any> {
    try {
      // Get all indices
      const indices = await this.client.cat.indices({ format: 'json' });
      
      const phase2Indices = indices.filter((idx: any) => 
        idx.index.startsWith(this.config.phase2IndexPrefix)
      );
      
      const phase3Index = indices.find((idx: any) => 
        idx.index === this.getPhase3IndexName()
      );
      
      // Get trial status
      const trials = await this.prisma.trial.findMany({
        select: {
          id: true,
          name: true,
          caseNumber: true,
          processingStatus: true
        },
        orderBy: { id: 'asc' }
      });
      
      return {
        phase2Indices: phase2Indices.map((idx: any) => ({
          name: idx.index,
          size: idx['store.size'],
          docs: idx['docs.count']
        })),
        phase3Index: phase3Index ? {
          name: phase3Index.index,
          size: phase3Index['store.size'],
          docs: phase3Index['docs.count']
        } : null,
        trials: trials.map(t => ({
          id: t.id,
          name: t.name,
          caseNumber: t.caseNumber,
          phase2Started: !!t.processingStatus?.phase2StartedAt,
          phase2Completed: !!t.processingStatus?.phase2CompletedAt,
          phase3Completed: !!t.processingStatus?.phase3CompletedAt,
          elasticsearchCleared: t.processingStatus?.elasticsearchCleared || false
        })),
        config: this.config
      };
    } catch (error) {
      logger.error('Error getting storage status:', error);
      throw error;
    }
  }
  
  /**
   * Clean up all Phase 2 indices
   */
  async cleanupAllPhase2Indices(): Promise<void> {
    try {
      const indices = await this.client.cat.indices({ format: 'json' });
      const phase2Indices = indices.filter((idx: any) => 
        idx.index.startsWith(this.config.phase2IndexPrefix)
      );
      
      for (const idx of phase2Indices) {
        const indexName = idx.index as string;
        logger.info(`Deleting index: ${indexName}`);
        await this.client.indices.delete({ index: indexName });
      }
      
      // Clear all ES references in database
      await this.prisma.statementEvent.updateMany({
        data: { elasticSearchId: null }
      });
      
      await this.prisma.trialProcessingStatus.updateMany({
        data: { 
          elasticsearchCleared: true,
          elasticsearchClearedAt: new Date()
        }
      });
      
      logger.info(`Cleaned up ${phase2Indices.length} Phase 2 indices`);
    } catch (error) {
      logger.error('Error cleaning up all Phase 2 indices:', error);
      throw error;
    }
  }
  
  async disconnect(): Promise<void> {
    await this.prisma.$disconnect();
  }
}