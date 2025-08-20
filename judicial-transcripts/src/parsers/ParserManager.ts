import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import { IParser, ParserConfig } from './interfaces/IParser';
import { RegexParser } from './RegexParser';
import { LawFirmDetector } from './custom/LawFirmDetector';
import logger from '../utils/logger';

export class ParserManager {
  private parsers: Map<string, IParser> = new Map();
  private configurations: Map<string, ParserConfig> = new Map();
  private prisma: PrismaClient;
  private configPath: string;

  constructor(prisma: PrismaClient, configPath?: string) {
    this.prisma = prisma;
    this.configPath = configPath || path.join(process.cwd(), 'config', 'parser-patterns.json');
    this.loadParsers();
  }

  private loadParsers(): void {
    try {
      // Load from JSON file
      if (fs.existsSync(this.configPath)) {
        const configData = fs.readFileSync(this.configPath, 'utf-8');
        const config = JSON.parse(configData);
        
        if (config.parsers) {
          for (const [name, parserConfig] of Object.entries(config.parsers)) {
            const cfg = parserConfig as ParserConfig;
            cfg.name = name;
            this.configurations.set(name, cfg);
            this.createParser(name, cfg);
          }
        }
        
        logger.info(`Loaded ${this.parsers.size} parsers from ${this.configPath}`);
      } else {
        logger.warn(`Parser configuration file not found at ${this.configPath}`);
      }
    } catch (error) {
      logger.error('Error loading parser configurations:', error);
    }
  }

  private createParser(name: string, config: ParserConfig): void {
    try {
      let parser: IParser;
      
      switch (config.type) {
        case 'REGEX':
          parser = new RegexParser(config);
          break;
        
        case 'CUSTOM':
          parser = this.createCustomParser(config);
          break;
        
        default:
          logger.warn(`Unknown parser type: ${config.type} for parser ${name}`);
          return;
      }
      
      this.parsers.set(name, parser);
    } catch (error) {
      logger.error(`Error creating parser ${name}:`, error);
    }
  }

  private createCustomParser(config: ParserConfig): IParser {
    // Map implementation names to classes
    switch (config.implementation) {
      case 'LawFirmDetector':
        return new LawFirmDetector(config);
      
      // Add more custom parsers here as needed
      default:
        throw new Error(`Unknown custom parser implementation: ${config.implementation}`);
    }
  }

  getParser(name: string): IParser | undefined {
    return this.parsers.get(name);
  }

  getAllParsers(): Map<string, IParser> {
    return new Map(this.parsers);
  }

  getConfiguration(name: string): ParserConfig | undefined {
    return this.configurations.get(name);
  }

  async saveToDatabase(): Promise<void> {
    try {
      // Create a table for parser configurations if it doesn't exist
      // This would require a Prisma schema update, so for now we'll just log
      logger.info('Parser configurations would be saved to database');
      
      // In a real implementation, you would:
      // 1. Add a ParserConfiguration model to schema.prisma
      // 2. Save each configuration to the database
      // 3. Allow loading from database as well as JSON
      
      for (const [name, config] of this.configurations) {
        logger.debug(`Would save parser ${name} to database:`, config);
      }
    } catch (error) {
      logger.error('Error saving parsers to database:', error);
    }
  }

  async loadFromDatabase(): Promise<void> {
    try {
      // This would load parser configurations from database
      // For now, just log that we would do this
      logger.info('Would load parser configurations from database');
    } catch (error) {
      logger.error('Error loading parsers from database:', error);
    }
  }

  // Utility method to test a parser
  testParser(parserName: string, text: string): void {
    const parser = this.getParser(parserName);
    if (!parser) {
      logger.warn(`Parser ${parserName} not found`);
      return;
    }

    const result = parser.parse(text);
    logger.info(`Testing parser ${parserName}:`);
    logger.info(`  Input: "${text}"`);
    logger.info(`  Result:`, result);
  }

  // Method to reload parsers from configuration
  reload(): void {
    this.parsers.clear();
    this.configurations.clear();
    this.loadParsers();
  }
}