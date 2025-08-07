// src/utils/file-helpers.ts
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import logger from './logger';

const execAsync = promisify(exec);

export class FileHelpers {
  /**
   * Extract text from PDF using pdf-text-extract
   */
  static async extractTextFromPdf(pdfPath: string): Promise<string> {
    try {
      const { stdout } = await execAsync(`pdf-text-extract "${pdfPath}"`);
      return stdout;
    } catch (error) {
      logger.error(`Error extracting text from PDF ${pdfPath}:`, error);
      throw error;
    }
  }
  
  /**
   * Ensure directory exists
   */
  static ensureDirectory(dirPath: string): void {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  }
  
  /**
   * Read JSON file
   */
  static readJsonFile<T>(filePath: string): T {
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content);
  }
  
  /**
   * Write JSON file
   */
  static writeJsonFile(filePath: string, data: any): void {
    const content = JSON.stringify(data, null, 2);
    fs.writeFileSync(filePath, content, 'utf-8');
  }
  
  /**
   * Get all files matching pattern in directory
   */
  static getFiles(dirPath: string, pattern?: RegExp): string[] {
    const files = fs.readdirSync(dirPath);
    
    if (pattern) {
      return files.filter(f => pattern.test(f));
    }
    
    return files;
  }
  
  /**
   * Clean filename for safe file system usage
   */
  static sanitizeFilename(filename: string): string {
    return filename
      .replace(/[^a-z0-9]/gi, '_')
      .replace(/_+/g, '_')
      .toLowerCase();
  }
}
