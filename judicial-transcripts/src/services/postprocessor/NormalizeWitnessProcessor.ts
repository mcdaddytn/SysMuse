import * as fs from 'fs';
import * as path from 'path';
import { PostProcessorConfig, AttorneyMapping } from './types';

export class NormalizeWitnessProcessor {
  async process(config: PostProcessorConfig): Promise<number> {
    console.log('Starting NORMALIZEWITNESS post-processor');

    // Build attorney mapping from trial metadata
    const attorneyMap = await this.buildAttorneyMapping(config);

    // Find all text files to process
    const txtFiles = await this.findTextFiles(config.outputDir);

    let filesProcessed = 0;
    for (const filePath of txtFiles) {
      // Skip backup files
      if (filePath.endsWith('_conv.txt')) {
        continue;
      }

      const processed = await this.processFile(filePath, attorneyMap);
      if (processed) {
        filesProcessed++;
      }
    }

    return filesProcessed;
  }

  async buildAttorneyMapping(config: PostProcessorConfig): Promise<Map<string, AttorneyMapping>> {
    const attorneyMap = new Map<string, AttorneyMapping>();

    // Determine the trial metadata path
    const metadataPath = config.trialMetadataPath || path.join(config.outputDir, 'trial-metadata.json');

    if (!fs.existsSync(metadataPath)) {
      console.warn(`Trial metadata not found at ${metadataPath}, using empty attorney mapping`);
      return attorneyMap;
    }

    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));

    // Process TrialAttorney (singular) to build the mapping
    if (metadata.TrialAttorney && Array.isArray(metadata.TrialAttorney)) {
      for (const trialAttorney of metadata.TrialAttorney) {
        const attorney = metadata.Attorney?.find((a: any) => a.id === trialAttorney.attorneyId);

        if (attorney && attorney.speakerPrefix) {
          // Determine side based on trialAttorney.role
          let side: 'PLAINTIFF' | 'DEFENDANT';
          const role = trialAttorney.role?.toUpperCase() || '';

          if (role.includes('PLAINTIFF') || role.includes('PETITIONER')) {
            side = 'PLAINTIFF';
          } else if (role.includes('DEFENDANT') || role.includes('RESPONDENT')) {
            side = 'DEFENDANT';
          } else {
            // Skip attorneys without clear side designation
            console.warn(`Cannot determine side for attorney ${attorney.fullName} with role ${trialAttorney.role}`);
            continue;
          }

          // Store multiple possible formats of the speaker prefix
          const prefixes = [
            attorney.speakerPrefix.toUpperCase(),
            attorney.speakerPrefix.toUpperCase().replace(/\.$/, ''), // Without period
            attorney.speakerPrefix.toUpperCase().replace(/^(MR|MS|MRS|DR)\.?\s*/, '') // Last name only
          ];

          for (const prefix of prefixes) {
            if (prefix) {
              attorneyMap.set(prefix, {
                speakerPrefix: attorney.speakerPrefix,
                side,
                fullName: attorney.fullName
              });
            }
          }
        }
      }
    }

    console.log(`Built attorney mapping with ${attorneyMap.size} entries`);
    return attorneyMap;
  }

  async processFile(filePath: string, attorneyMap: Map<string, AttorneyMapping>): Promise<boolean> {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    let modified = false;
    const outputLines: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const nextLine = i + 1 < lines.length ? lines[i + 1] : '';
      const nextLine2 = i + 2 < lines.length ? lines[i + 2] : '';
      const nextLine3 = i + 3 < lines.length ? lines[i + 3] : '';
      const nextLine4 = i + 4 < lines.length ? lines[i + 4] : '';
      const nextLine5 = i + 5 < lines.length ? lines[i + 5] : '';

      // Check if this is a witness declaration that needs normalization
      const witnessMatch = this.isWitnessDeclaration(line, nextLine, nextLine2, nextLine3, nextLine4, nextLine5, lines, i);

      if (witnessMatch) {
        // Extract the examining attorney
        const attorneyLine = witnessMatch.attorneyLineIndex;
        const attorneyLineText = i + attorneyLine < lines.length ? lines[i + attorneyLine] : '';
        const attorneyName = this.extractAttorneyName(attorneyLineText);

        if (attorneyName) {
          const side = this.determineWitnessSide(attorneyName, attorneyMap);

          if (side) {
            // Transform the witness declaration
            const transformedLine = this.transformWitnessLine(line, side);
            outputLines.push(transformedLine);

            // Skip "testified under oath as follows:" or "having been duly sworn" line if present
            if (nextLine.toLowerCase().includes('testified under oath') ||
                nextLine.toLowerCase().includes('having been duly sworn')) {
              i++; // Skip this line
            }

            modified = true;
            continue;
          }
        }
      }

      outputLines.push(line);
    }

    if (modified) {
      fs.writeFileSync(filePath, outputLines.join('\n'));
      console.log(`Processed: ${path.basename(filePath)}`);
      return true;
    }

    return false;
  }

  private isWitnessDeclaration(
    line: string,
    nextLine: string,
    nextLine2: string,
    nextLine3: string,
    nextLine4: string,
    nextLine5: string,
    allLines: string[],
    currentIndex: number
  ): { attorneyLineIndex: number } | null {

    const upperLine = line.toUpperCase();

    // Check if this line contains a witness being sworn
    // Witness name lines have CAPITALIZED NAMES followed by SWORN
    // Pattern: multiple uppercase words (name) followed by SWORN
    const witnessPattern = /[A-Z][A-Z\s\.\-,']+(?:Ph\.?D\.?|MD|JD|Esq\.?)?,?\s+SWORN/;

    if (witnessPattern.test(line) && !upperLine.includes('PREVIOUSLY SWORN')) {
      // Get next non-blank lines for pattern matching
      const nonBlankLines: { text: string; index: number }[] = [];
      let checkIndex = currentIndex + 1;

      while (nonBlankLines.length < 5 && checkIndex < allLines.length) {
        if (allLines[checkIndex].trim()) {
          nonBlankLines.push({ text: allLines[checkIndex], index: checkIndex - currentIndex });
        }
        checkIndex++;
      }

      if (nonBlankLines.length >= 3) {
        const firstNonBlank = nonBlankLines[0].text;
        const secondNonBlank = nonBlankLines[1].text;
        const thirdNonBlank = nonBlankLines.length > 2 ? nonBlankLines[2].text : '';

        // Check for the pattern with "testified under oath" or similar variations
        if (firstNonBlank.toLowerCase().includes('testified under oath') ||
            firstNonBlank.toLowerCase().includes('having been duly sworn')) {
          // Check if DIRECT EXAMINATION is the next non-blank line
          if (secondNonBlank.toUpperCase().includes('DIRECT EXAMINATION')) {
            // BY MR/MS should be the next non-blank line after that
            if (thirdNonBlank.toUpperCase().includes('BY M')) {
              return { attorneyLineIndex: nonBlankLines[2].index };
            }
          }
        }
        // Check for pattern where DIRECT EXAMINATION immediately follows SWORN
        else if (firstNonBlank.toUpperCase().includes('DIRECT EXAMINATION')) {
          // BY MR/MS should be the next non-blank line
          if (secondNonBlank.toUpperCase().includes('BY M')) {
            return { attorneyLineIndex: nonBlankLines[1].index };
          }
        }
      }
    }

    return null;
  }

  private extractAttorneyName(line: string): string | null {
    // Match patterns like "BY MR. RENNIE:" or "BY MS. SMITH:"
    const match = line.match(/BY\s+(MR\.?|MS\.?|MRS\.?|DR\.?)\s+([A-Z][A-Z\s\-']+)/i);
    if (match) {
      return match[2].trim().replace(':', '');
    }
    return null;
  }

  private determineWitnessSide(attorneyName: string, attorneyMap: Map<string, AttorneyMapping>):
    'PLAINTIFF' | 'DEFENDANT' | null {

    const upperName = attorneyName.toUpperCase();

    // Try exact match first
    const mapping = attorneyMap.get(upperName);
    if (mapping) {
      return mapping.side;
    }

    // Try to find partial match (last name match)
    for (const [prefix, attorneyMapping] of attorneyMap.entries()) {
      if (upperName.includes(prefix) || prefix.includes(upperName)) {
        return attorneyMapping.side;
      }
    }

    console.warn(`Could not determine side for attorney: ${attorneyName}`);
    return null;
  }

  private transformWitnessLine(line: string, side: 'PLAINTIFF' | 'DEFENDANT'): string {
    // Find where to insert the side designation
    // Look for patterns like "NAME, SWORN" or "NAME, PhD, SWORN"
    const sideText = side === 'PLAINTIFF' ? "PLAINTIFF'S WITNESS, " : "DEFENDANTS' WITNESS, ";

    // Replace "SWORN," with side designation and "PREVIOUSLY SWORN"
    const transformed = line.replace(/,\s*SWORN,?/i, `, ${sideText}PREVIOUSLY SWORN`);

    // If no replacement was made, try another pattern
    if (transformed === line) {
      // Try pattern without comma before SWORN
      return line.replace(/\s+SWORN,?/i, `, ${sideText}PREVIOUSLY SWORN`);
    }

    return transformed;
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
        const subFiles = await this.findTextFiles(fullPath);
        files.push(...subFiles);
      } else if (item.isFile() && item.name.endsWith('.txt')) {
        files.push(fullPath);
      }
    }

    return files;
  }
}