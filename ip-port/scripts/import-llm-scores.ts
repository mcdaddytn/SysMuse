/**
 * Import LLM Scores from JSON or CSV Exports
 *
 * Imports LLM analysis scores from various export formats into the
 * per-patent cache structure used by the scoring service.
 *
 * Supported input formats:
 * 1. combined-v3-*.json — { analyses: [{ patent_id, eligibility_score, ... }] }
 * 2. multi-score-analysis-*.json — { results: [{ patent_id, eligibility_score, ... }] }
 * 3. Array of patent objects — [{ patent_id, eligibility_score, ... }]
 * 4. Object with any array property containing patent objects
 * 5. Nested metrics — { patents: [{ patent_id, metrics: { eligibility_score, ... } }] }
 * 6. CSV files — header row with patent_id + score columns
 *
 * Usage:
 *   npx tsx scripts/import-llm-scores.ts <input-file> [--dry-run] [--force]
 *   npx tsx scripts/import-llm-scores.ts ./exports/all-patents-scored-v3.csv
 *   npx tsx scripts/import-llm-scores.ts ./old-exports/ --all  # import all JSON/CSV files in directory
 */

import * as fs from 'fs';
import * as path from 'path';

const LLM_SCORES_DIR = path.join(process.cwd(), 'cache/llm-scores');

interface LlmScoreRecord {
  patent_id: string;
  eligibility_score: number;
  validity_score: number;
  claim_breadth: number;
  enforcement_clarity: number;
  design_around_difficulty: number;
  source: string;
  imported_at: string;
  // Optional extra fields preserved from source
  confidence?: number;
  summary?: string;
  technology_category?: string;
  implementation_type?: string;
  standards_relevance?: string;
  market_segment?: string;
}

const LLM_SCORE_FIELDS = [
  'eligibility_score',
  'validity_score',
  'claim_breadth',
  'enforcement_clarity',
  'design_around_difficulty',
] as const;

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function isValidScore(v: unknown): v is number {
  return typeof v === 'number' && v >= 1 && v <= 5;
}

// Resolve a score field from an item, checking both top-level and nested metrics
function getScoreField(item: any, field: string): number | undefined {
  const direct = item[field];
  if (isValidScore(direct)) return direct;
  // Check nested metrics object (unified JSON format)
  const nested = item.metrics?.[field];
  if (isValidScore(nested)) return nested;
  // Check as parsed number (CSV values come as strings)
  const parsed = Number(direct);
  if (!isNaN(parsed) && parsed >= 1 && parsed <= 5) return parsed;
  const parsedNested = Number(nested);
  if (!isNaN(parsedNested) && parsedNested >= 1 && parsedNested <= 5) return parsedNested;
  return undefined;
}

function getStringField(item: any, field: string): string | undefined {
  const direct = item[field];
  if (typeof direct === 'string' && direct.trim()) return direct;
  const nested = item.metrics?.[field];
  if (typeof nested === 'string' && nested.trim()) return nested;
  return undefined;
}

function extractPatentRecords(data: unknown, sourcePath: string): LlmScoreRecord[] {
  const records: LlmScoreRecord[] = [];
  const ext = path.extname(sourcePath).toLowerCase();
  const source = path.basename(sourcePath, ext);

  function tryExtract(items: any[]): void {
    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      if (!item.patent_id) continue;

      // Check if it has at least one valid LLM score (direct or nested)
      const hasScores = LLM_SCORE_FIELDS.some(f => getScoreField(item, f) !== undefined);
      if (!hasScores) continue;

      records.push({
        patent_id: String(item.patent_id),
        eligibility_score: getScoreField(item, 'eligibility_score') ?? 0,
        validity_score: getScoreField(item, 'validity_score') ?? 0,
        claim_breadth: getScoreField(item, 'claim_breadth') ?? 0,
        enforcement_clarity: getScoreField(item, 'enforcement_clarity') ?? 0,
        design_around_difficulty: getScoreField(item, 'design_around_difficulty') ?? 0,
        source,
        imported_at: new Date().toISOString(),
        confidence: getScoreField(item, 'confidence'),
        summary: getStringField(item, 'summary'),
        technology_category: getStringField(item, 'technology_category'),
        implementation_type: getStringField(item, 'implementation_type'),
        standards_relevance: getStringField(item, 'standards_relevance'),
        market_segment: getStringField(item, 'market_segment'),
      });
    }
  }

  if (Array.isArray(data)) {
    tryExtract(data);
  } else if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>;

    // Try known array properties
    for (const key of ['analyses', 'results', 'patents', 'data', 'candidates']) {
      if (Array.isArray(obj[key])) {
        tryExtract(obj[key] as any[]);
      }
    }

    // If nothing found, try all array properties
    if (records.length === 0) {
      for (const value of Object.values(obj)) {
        if (Array.isArray(value) && value.length > 0) {
          tryExtract(value);
          if (records.length > 0) break;
        }
      }
    }
  }

  return records;
}

function parseCsvToObjects(content: string): any[] {
  const lines = content.split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];

  // Parse header — handle quoted fields
  const headers = parseCsvLine(lines[0]);
  const objects: any[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i]);
    if (values.length < headers.length) continue;

    const obj: any = {};
    for (let j = 0; j < headers.length; j++) {
      obj[headers[j]] = values[j];
    }
    objects.push(obj);
  }

  return objects;
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

function importFile(filePath: string, dryRun: boolean, force: boolean): { imported: number; skipped: number; total: number } {
  const absPath = path.resolve(filePath);
  if (!fs.existsSync(absPath)) {
    console.error(`File not found: ${absPath}`);
    return { imported: 0, skipped: 0, total: 0 };
  }

  const ext = path.extname(absPath).toLowerCase();
  let records: LlmScoreRecord[];

  if (ext === '.csv') {
    // CSV import
    const content = fs.readFileSync(absPath, 'utf-8');
    const objects = parseCsvToObjects(content);
    records = extractPatentRecords(objects, absPath);
  } else {
    // JSON import
    let data: unknown;
    try {
      data = JSON.parse(fs.readFileSync(absPath, 'utf-8'));
    } catch (e) {
      console.error(`Failed to parse JSON: ${absPath}`);
      return { imported: 0, skipped: 0, total: 0 };
    }
    records = extractPatentRecords(data, absPath);
  }

  if (records.length === 0) {
    console.log(`  No LLM score records found in ${path.basename(filePath)}`);
    return { imported: 0, skipped: 0, total: 0 };
  }

  let imported = 0;
  let skipped = 0;

  for (const record of records) {
    const outPath = path.join(LLM_SCORES_DIR, `${record.patent_id}.json`);

    if (!force && fs.existsSync(outPath)) {
      skipped++;
      continue;
    }

    if (!dryRun) {
      fs.writeFileSync(outPath, JSON.stringify(record, null, 2));
    }
    imported++;
  }

  return { imported, skipped, total: records.length };
}

function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const force = args.includes('--force');
  const importAll = args.includes('--all');

  const inputPaths = args.filter(a => !a.startsWith('--'));

  if (inputPaths.length === 0) {
    console.error('Usage: npx tsx scripts/import-llm-scores.ts <input-file-or-dir> [--dry-run] [--force] [--all]');
    console.error('');
    console.error('Supports JSON and CSV files.');
    console.error('');
    console.error('Options:');
    console.error('  --dry-run  Show what would be imported without writing');
    console.error('  --force    Overwrite existing cache files');
    console.error('  --all      Import all JSON/CSV files from directory');
    process.exit(1);
  }

  ensureDir(LLM_SCORES_DIR);

  console.log('='.repeat(60));
  console.log('Import LLM Scores');
  console.log('='.repeat(60));
  if (dryRun) console.log('DRY RUN — no files will be written');
  if (force) console.log('FORCE — existing files will be overwritten');
  console.log('');

  let totalImported = 0;
  let totalSkipped = 0;
  let totalRecords = 0;

  for (const inputPath of inputPaths) {
    const absPath = path.resolve(inputPath);
    const stat = fs.statSync(absPath);

    if (stat.isDirectory()) {
      if (!importAll) {
        console.error(`${inputPath} is a directory. Use --all to import all JSON files.`);
        continue;
      }

      const files = fs.readdirSync(absPath).filter(f => f.endsWith('.json') || f.endsWith('.csv')).sort();
      console.log(`Scanning ${files.length} JSON files in ${inputPath}...`);

      for (const file of files) {
        const filePath = path.join(absPath, file);
        const result = importFile(filePath, dryRun, force);
        if (result.total > 0) {
          console.log(`  ${file}: ${result.imported} imported, ${result.skipped} skipped (${result.total} found)`);
        }
        totalImported += result.imported;
        totalSkipped += result.skipped;
        totalRecords += result.total;
      }
    } else {
      console.log(`Importing from ${path.basename(inputPath)}...`);
      const result = importFile(absPath, dryRun, force);
      console.log(`  ${result.imported} imported, ${result.skipped} skipped (${result.total} found)`);
      totalImported += result.imported;
      totalSkipped += result.skipped;
      totalRecords += result.total;
    }
  }

  console.log('');
  console.log('='.repeat(60));
  console.log('Summary');
  console.log('='.repeat(60));
  console.log(`Total records found:  ${totalRecords}`);
  console.log(`Imported:             ${totalImported}`);
  console.log(`Skipped (existing):   ${totalSkipped}`);
  console.log(`Output directory:     ${LLM_SCORES_DIR}`);

  if (dryRun) {
    console.log('\nThis was a dry run. Run without --dry-run to actually import.');
  } else if (totalImported > 0) {
    console.log('\nTo use these scores in the V3 scoring engine:');
    console.log('  1. Restart the API server, or');
    console.log('  2. Call POST /api/scores/reload');
  }
}

main();
