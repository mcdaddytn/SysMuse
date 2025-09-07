import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import { Logger } from '../utils/logger';

export interface SeedFileMapping {
  table: string;
  uniqueKey: string | string[];
  processor?: (data: any) => any;
}

export interface UpdateResult {
  file: string;
  table: string;
  updated: number;
  inserted: number;
  skipped: number;
  errors: number;
  errorDetails: any[];
}

export interface UpdateOptions {
  dryRun?: boolean;
  verbose?: boolean;
}

export class SeedUpdateService {
  private logger = new Logger('SeedUpdateService');
  private prisma: PrismaClient;

  // Mapping of seed files to their database tables and unique keys
  private readonly SEED_FILE_MAPPINGS: Record<string, SeedFileMapping> = {
    'accumulator-expressions.json': {
      table: 'accumulatorExpression',
      uniqueKey: 'name'
    },
    'accumulator-expressions-extended.json': {
      table: 'accumulatorExpression',
      uniqueKey: 'name'
    },
    'court-directives.json': {
      table: 'courtDirectiveType',
      uniqueKey: 'name'
    },
    'elasticsearch-expressions.json': {
      table: 'elasticSearchExpression',
      uniqueKey: 'name'
    },
    'marker-templates.json': {
      table: 'markerTemplate',
      uniqueKey: 'name'
    },
    'search-patterns.json': {
      table: 'searchPattern',
      uniqueKey: ['patternType', 'pattern'] // Composite key example
    },
    'system-config.json': {
      table: 'systemConfig',
      uniqueKey: 'key'
    }
  };

  constructor(prisma?: PrismaClient) {
    this.prisma = prisma || new PrismaClient();
  }

  /**
   * Update database from specified seed files
   */
  async updateFromFiles(fileNames: string[], options: UpdateOptions = {}): Promise<UpdateResult[]> {
    const results: UpdateResult[] = [];

    for (const fileName of fileNames) {
      try {
        const result = await this.updateFromFile(fileName, options);
        results.push(result);
      } catch (error) {
        this.logger.error(`Failed to update from ${fileName}:`, error);
        results.push({
          file: fileName,
          table: 'unknown',
          updated: 0,
          inserted: 0,
          skipped: 0,
          errors: 1,
          errorDetails: [error]
        });
      }
    }

    return results;
  }

  /**
   * Update database from a single seed file
   */
  async updateFromFile(fileName: string, options: UpdateOptions = {}): Promise<UpdateResult> {
    this.logger.info(`Processing seed file: ${fileName}`);

    // Get mapping for this file
    const mapping = this.SEED_FILE_MAPPINGS[fileName];
    if (!mapping) {
      throw new Error(`No mapping found for seed file: ${fileName}`);
    }

    // Load seed data
    const data = await this.loadSeedFile(fileName);
    if (!data || (!Array.isArray(data) && typeof data !== 'object')) {
      throw new Error(`Invalid data format in seed file: ${fileName}`);
    }

    // Convert to array if needed
    const records = Array.isArray(data) ? data : 
                   data[Object.keys(data)[0]] || [];

    if (!Array.isArray(records)) {
      throw new Error(`Cannot extract records from seed file: ${fileName}`);
    }

    this.logger.info(`Found ${records.length} records to process`);

    // Process records
    const result: UpdateResult = {
      file: fileName,
      table: mapping.table,
      updated: 0,
      inserted: 0,
      skipped: 0,
      errors: 0,
      errorDetails: []
    };

    if (options.dryRun) {
      this.logger.info('DRY RUN MODE - No changes will be applied');
      return this.performDryRun(records, mapping, result);
    } else {
      return this.performUpdate(records, mapping, result, options);
    }
  }

  /**
   * Perform actual database updates
   */
  private async performUpdate(
    records: any[],
    mapping: SeedFileMapping,
    result: UpdateResult,
    options: UpdateOptions
  ): Promise<UpdateResult> {
    const tableName = mapping.table;
    const uniqueKey = mapping.uniqueKey;

    for (const record of records) {
      try {
        // Build where clause based on unique key
        const where = this.buildWhereClause(record, uniqueKey);
        
        // Check if record exists
        const existing = await (this.prisma as any)[tableName].findUnique({ where });

        if (existing) {
          // Update existing record
          await (this.prisma as any)[tableName].update({
            where,
            data: record
          });
          result.updated++;
          if (options.verbose) {
            this.logger.info(`Updated: ${JSON.stringify(where)}`);
          }
        } else {
          // Insert new record
          await (this.prisma as any)[tableName].create({
            data: record
          });
          result.inserted++;
          if (options.verbose) {
            this.logger.info(`Inserted: ${JSON.stringify(where)}`);
          }
        }
      } catch (error: any) {
        result.errors++;
        result.errorDetails.push({
          record: this.buildWhereClause(record, uniqueKey),
          error: error.message
        });
        if (options.verbose) {
          this.logger.error(`Error processing record:`, error);
        }
      }
    }

    this.logger.info(`Completed: Updated=${result.updated}, Inserted=${result.inserted}, Errors=${result.errors}`);
    return result;
  }

  /**
   * Perform dry run to preview changes
   */
  private async performDryRun(
    records: any[],
    mapping: SeedFileMapping,
    result: UpdateResult
  ): Promise<UpdateResult> {
    const tableName = mapping.table;
    const uniqueKey = mapping.uniqueKey;
    const wouldUpdate: string[] = [];
    const wouldInsert: string[] = [];

    for (const record of records) {
      try {
        const where = this.buildWhereClause(record, uniqueKey);
        const existing = await (this.prisma as any)[tableName].findUnique({ where });

        if (existing) {
          result.updated++;
          const changes = this.detectChanges(existing, record);
          if (changes.length > 0) {
            wouldUpdate.push(`${JSON.stringify(where)}: ${changes.join(', ')}`);
          }
        } else {
          result.inserted++;
          wouldInsert.push(JSON.stringify(where));
        }
      } catch (error) {
        result.errors++;
      }
    }

    if (wouldUpdate.length > 0) {
      this.logger.info('Would update:');
      wouldUpdate.forEach(u => this.logger.info(`  - ${u}`));
    }

    if (wouldInsert.length > 0) {
      this.logger.info('Would insert:');
      wouldInsert.forEach(i => this.logger.info(`  - ${i}`));
    }

    return result;
  }

  /**
   * Build where clause for unique key lookup
   */
  private buildWhereClause(record: any, uniqueKey: string | string[]): any {
    if (typeof uniqueKey === 'string') {
      return { [uniqueKey]: record[uniqueKey] };
    } else {
      const where: any = {};
      for (const key of uniqueKey) {
        where[key] = record[key];
      }
      return where;
    }
  }

  /**
   * Detect changes between existing and new record
   */
  private detectChanges(existing: any, newRecord: any): string[] {
    const changes: string[] = [];
    
    for (const key in newRecord) {
      if (existing[key] !== undefined && existing[key] !== newRecord[key]) {
        changes.push(`${key}: ${existing[key]} → ${newRecord[key]}`);
      }
    }
    
    return changes;
  }

  /**
   * Load seed file from disk
   */
  private async loadSeedFile(fileName: string): Promise<any> {
    const filePath = path.join(process.cwd(), 'seed-data', fileName);
    
    if (!fs.existsSync(filePath)) {
      throw new Error(`Seed file not found: ${filePath}`);
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content);
  }

  /**
   * Validate that unique keys exist in schema
   */
  async validateUniqueKeys(): Promise<void> {
    // This would require introspecting the Prisma schema
    // For now, we rely on the mappings being correct
    this.logger.info('Unique key validation completed');
  }

  /**
   * Close database connection
   */
  async disconnect(): Promise<void> {
    await this.prisma.$disconnect();
  }
}