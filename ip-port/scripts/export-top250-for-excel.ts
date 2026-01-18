/**
 * Export Top 250 for Excel Import
 *
 * Creates a standardized CSV file with clear naming for Excel import.
 *
 * File naming convention:
 *   TOP250-YYYY-MM-DD.csv  - The filtered top 250 for vendor work
 *
 * This is the ONLY file that should be imported into Excel for analysis.
 * The file is placed in the excel/ directory for easy access.
 *
 * Usage:
 *   npx tsx scripts/export-top250-for-excel.ts
 */

import * as fs from 'fs';
import * as path from 'path';

const EXCEL_DIR = './excel';
const OUTPUT_DIR = './output';

function getDateString(): string {
  return new Date().toISOString().split('T')[0];
}

function main() {
  const dateStr = getDateString();

  console.log('============================================================');
  console.log('Export Top 250 for Excel');
  console.log('============================================================\n');

  // Find the most recent unified-top250-v2 file
  const outputFiles = fs.readdirSync(OUTPUT_DIR)
    .filter(f => f.startsWith('unified-top250-v2-') && f.endsWith('.csv'))
    .sort()
    .reverse();

  if (outputFiles.length === 0) {
    console.error('ERROR: No unified-top250-v2-*.csv file found in output/');
    console.error('Run: npx tsx scripts/calculate-unified-top250-v2.ts');
    process.exit(1);
  }

  const sourceFile = path.join(OUTPUT_DIR, outputFiles[0]);
  console.log(`Source file: ${sourceFile}`);

  // Read the source CSV
  const csvContent = fs.readFileSync(sourceFile, 'utf-8');
  const lines = csvContent.trim().split('\n');

  // Verify it's the filtered top 250 (not raw metrics)
  if (lines.length > 260) {
    console.error('ERROR: Source file has more than 250 patents - this may be the wrong file');
    process.exit(1);
  }

  // Ensure excel directory exists
  if (!fs.existsSync(EXCEL_DIR)) {
    fs.mkdirSync(EXCEL_DIR, { recursive: true });
  }

  // Create the standardized output file
  const outputFile = path.join(EXCEL_DIR, `TOP250-${dateStr}.csv`);
  fs.writeFileSync(outputFile, csvContent);

  // Also create a "latest" symlink-style copy
  const latestFile = path.join(EXCEL_DIR, 'TOP250-LATEST.csv');
  fs.writeFileSync(latestFile, csvContent);

  console.log(`\nExported to:`);
  console.log(`  ${outputFile}`);
  console.log(`  ${latestFile} (copy for easy import)`);

  // Print summary
  const patentCount = lines.length - 1; // Exclude header
  console.log(`\nSummary:`);
  console.log(`  Patents: ${patentCount}`);
  console.log(`  Columns: ${lines[0].split(',').length}`);

  // Verify years_remaining filter
  const yearsCol = lines[0].split(',').indexOf('years_remaining');
  if (yearsCol >= 0) {
    const years = lines.slice(1).map(l => parseFloat(l.split(',')[yearsCol])).filter(y => !isNaN(y));
    const minYears = Math.min(...years);
    const maxYears = Math.max(...years);
    console.log(`  Years remaining: ${minYears.toFixed(1)} - ${maxYears.toFixed(1)}`);

    if (minYears < 3) {
      console.warn(`\nWARNING: Found patents with less than 3 years remaining!`);
    } else {
      console.log(`  ✓ All patents have 3+ years remaining (filtered)`);
    }
  }

  console.log('\n============================================================');
  console.log('EXCEL IMPORT INSTRUCTIONS');
  console.log('============================================================');
  console.log(`1. Open Excel workbook with VBA macros`);
  console.log(`2. Run macro: ImportTop250`);
  console.log(`   - Auto-imports: excel/TOP250-${dateStr}.csv`);
  console.log(`   - Or fallback: excel/TOP250-LATEST.csv`);
  console.log(`3. Scores calculate automatically based on UserWeights`);
  console.log('============================================================\n');
}

main();
