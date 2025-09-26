import * as fs from 'fs';
import * as path from 'path';
import { PostProcessorConfig, PostProcessorMode, PostProcessorResult, ConversionSummary } from './types';
import { NormalizeWitnessProcessor } from './NormalizeWitnessProcessor';

export class PostProcessor {
  private normalizeWitnessProcessor: NormalizeWitnessProcessor;

  constructor() {
    this.normalizeWitnessProcessor = new NormalizeWitnessProcessor();
  }

  async process(config: PostProcessorConfig): Promise<PostProcessorResult> {
    const startTime = new Date().toISOString();

    try {
      if (config.mode === 'NONE') {
        return {
          success: true,
          mode: config.mode,
          filesProcessed: 0,
          timestamp: startTime
        };
      }

      console.log(`Starting post-processor in ${config.mode} mode for trial ${config.trialId}`);

      // Back up existing files
      const backupSuffix = '_conv';
      await this.backupFiles(config.outputDir, backupSuffix);

      // Process based on mode
      let filesProcessed = 0;
      if (config.mode === 'NORMALIZEWITNESS') {
        filesProcessed = await this.normalizeWitnessProcessor.process(config);
      }

      // Update conversion summary
      await this.updateConversionSummary(config.outputDir, config.mode, filesProcessed, backupSuffix, startTime);

      console.log(`Post-processor completed: ${filesProcessed} files processed`);

      return {
        success: true,
        mode: config.mode,
        filesProcessed,
        backupSuffix,
        timestamp: startTime
      };
    } catch (error) {
      console.error('Post-processor error:', error);
      return {
        success: false,
        mode: config.mode,
        filesProcessed: 0,
        error: error instanceof Error ? error.message : String(error),
        timestamp: startTime
      };
    }
  }

  async backupFiles(outputDir: string, suffix: string): Promise<void> {
    console.log(`Creating backups with suffix ${suffix}`);

    // Find all .txt files in the output directory and subdirectories
    const txtFiles = await this.findTextFiles(outputDir);

    for (const filePath of txtFiles) {
      // Skip files that already have the backup suffix
      if (filePath.endsWith(`${suffix}.txt`)) {
        continue;
      }

      const backupPath = filePath.replace(/\.txt$/, `${suffix}.txt`);

      // Only backup if the backup doesn't already exist
      if (!fs.existsSync(backupPath)) {
        console.log(`Backing up: ${path.basename(filePath)} -> ${path.basename(backupPath)}`);
        fs.copyFileSync(filePath, backupPath);
      }
    }
  }

  private async findTextFiles(dir: string): Promise<string[]> {
    const files: string[] = [];

    if (!fs.existsSync(dir)) {
      return files;
    }

    const items = fs.readdirSync(dir, { withFileTypes: true });

    for (const item of items) {
      const fullPath = path.join(dir, item.name);

      if (item.isDirectory()) {
        // Recursively search subdirectories
        const subFiles = await this.findTextFiles(fullPath);
        files.push(...subFiles);
      } else if (item.isFile() && item.name.endsWith('.txt')) {
        files.push(fullPath);
      }
    }

    return files;
  }

  async updateConversionSummary(
    outputDir: string,
    mode: PostProcessorMode,
    filesProcessed: number,
    backupSuffix: string,
    timestamp: string
  ): Promise<void> {
    const summaryPath = path.join(outputDir, 'conversion-summary.json');

    let summary: ConversionSummary = {};
    if (fs.existsSync(summaryPath)) {
      const content = fs.readFileSync(summaryPath, 'utf-8');
      summary = JSON.parse(content);
    }

    // Update with post-processor information
    summary.postProcessorMode = mode;
    summary.postProcessorCompleted = true;
    summary.postProcessorTimestamp = timestamp;
    summary.filesProcessed = filesProcessed;
    summary.backupSuffix = backupSuffix;

    fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
    console.log('Updated conversion-summary.json with post-processor status');
  }
}