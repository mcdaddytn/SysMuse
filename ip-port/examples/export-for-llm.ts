/**
 * Export Top 250 Patents for LLM Analysis
 *
 * Generates individual text files for each patent suitable for
 * Azure AI chat completion workflow.
 */

import * as fs from 'fs';
import * as path from 'path';

const OUTPUT_DIR = './output';
const EXPORT_DIR = './output/export';

interface PatentRecord {
  rank: number;
  patentId: string;
  title: string;
  grantDate: string;
  assignee: string;
  yearsLeft: number;
  fwdCitations: number;
  competitorCites: number;
  topCompetitors: string;
  licensingScore: number;
  litigationScore: number;
  strategicScore: number;
  overallScore: number;
  abstract?: string;
}

function loadTop250(): PatentRecord[] {
  const csvPath = path.join(OUTPUT_DIR, 'top-250-actionable-2026-01-15.csv');
  const content = fs.readFileSync(csvPath, 'utf-8');
  const lines = content.trim().split('\n');

  // Skip header
  const records: PatentRecord[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    // Parse CSV (handle quoted fields)
    const fields = parseCSVLine(line);

    records.push({
      rank: parseInt(fields[0]),
      patentId: fields[1].replace(/"/g, ''),
      title: fields[2].replace(/"/g, ''),
      grantDate: fields[3].replace(/"/g, ''),
      assignee: fields[4].replace(/"/g, ''),
      yearsLeft: parseFloat(fields[5]),
      fwdCitations: parseInt(fields[6]),
      competitorCites: parseInt(fields[7]),
      topCompetitors: fields[8].replace(/"/g, ''),
      licensingScore: parseFloat(fields[9]),
      litigationScore: parseFloat(fields[10]),
      strategicScore: parseFloat(fields[11]),
      overallScore: parseFloat(fields[12]),
    });
  }

  return records;
}

function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (const char of line) {
    if (char === '"') {
      inQuotes = !inQuotes;
      current += char;
    } else if (char === ',' && !inQuotes) {
      fields.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  fields.push(current);

  return fields;
}

function loadAbstracts(): Map<string, string> {
  const abstractMap = new Map<string, string>();

  // Load from portfolio
  const portfolioPath = path.join(OUTPUT_DIR, 'broadcom-portfolio-2026-01-15.json');
  if (fs.existsSync(portfolioPath)) {
    const data = JSON.parse(fs.readFileSync(portfolioPath, 'utf-8'));
    for (const patent of data.patents || []) {
      if (patent.patent_abstract) {
        abstractMap.set(patent.patent_id, patent.patent_abstract);
      }
    }
  }

  // Load from streaming batches (may have more detail)
  const batchFiles = fs.readdirSync(OUTPUT_DIR).filter(f => f.startsWith('patents-batch-'));
  for (const file of batchFiles) {
    const data = JSON.parse(fs.readFileSync(path.join(OUTPUT_DIR, file), 'utf-8'));
    for (const patent of data.patents || []) {
      if (patent.patent_abstract && !abstractMap.has(patent.patent_id)) {
        abstractMap.set(patent.patent_id, patent.patent_abstract);
      }
    }
  }

  console.log(`Loaded ${abstractMap.size} abstracts`);
  return abstractMap;
}

function formatPatentFile(patent: PatentRecord): string {
  const lines: string[] = [
    '═'.repeat(70),
    `PATENT ANALYSIS: US${patent.patentId}`,
    '═'.repeat(70),
    '',
    `Patent Number:     US${patent.patentId}`,
    `Title:             ${patent.title}`,
    `Grant Date:        ${patent.grantDate}`,
    `Assignee:          ${patent.assignee}`,
    '',
    '─'.repeat(70),
    'PORTFOLIO RANKING & SCORES',
    '─'.repeat(70),
    '',
    `Overall Rank:      #${patent.rank} of 250`,
    `Overall Score:     ${patent.overallScore.toFixed(1)}`,
    '',
    `Licensing Score:   ${patent.licensingScore.toFixed(1)} (weighted by remaining term)`,
    `Litigation Score:  ${patent.litigationScore.toFixed(1)} (requires 3+ years term)`,
    `Strategic Score:   ${patent.strategicScore.toFixed(1)} (portfolio/defensive value)`,
    '',
    '─'.repeat(70),
    'KEY METRICS',
    '─'.repeat(70),
    '',
    `Years Remaining:   ${patent.yearsLeft.toFixed(1)} years`,
    `Forward Citations: ${patent.fwdCitations}`,
    `Competitor Cites:  ${patent.competitorCites}`,
    `Top Competitors:   ${patent.topCompetitors || 'N/A'}`,
    '',
  ];

  if (patent.abstract) {
    lines.push(
      '─'.repeat(70),
      'ABSTRACT (for attorney reference)',
      '─'.repeat(70),
      '',
      wrapText(patent.abstract, 70),
      ''
    );
  }

  lines.push(
    '═'.repeat(70),
    'END OF PATENT SUMMARY',
    '═'.repeat(70),
    ''
  );

  return lines.join('\n');
}

function wrapText(text: string, width: number): string {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    if (current.length + word.length + 1 <= width) {
      current += (current ? ' ' : '') + word;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);

  return lines.join('\n');
}

async function main() {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  EXPORT TOP 250 PATENTS FOR LLM ANALYSIS');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Create export directory
  if (!fs.existsSync(EXPORT_DIR)) {
    fs.mkdirSync(EXPORT_DIR, { recursive: true });
    console.log(`Created directory: ${EXPORT_DIR}`);
  }

  // Load data
  console.log('Loading top 250 patents...');
  const patents = loadTop250();
  console.log(`Loaded ${patents.length} patents from ranking`);

  console.log('Loading abstracts...');
  const abstracts = loadAbstracts();

  // Merge abstracts
  for (const patent of patents) {
    patent.abstract = abstracts.get(patent.patentId);
  }

  const withAbstracts = patents.filter(p => p.abstract).length;
  console.log(`Matched ${withAbstracts}/${patents.length} patents with abstracts`);

  // Generate files
  console.log('\nGenerating export files...\n');

  let generated = 0;
  for (const patent of patents) {
    const filename = `US${patent.patentId}.txt`;
    const filepath = path.join(EXPORT_DIR, filename);
    const content = formatPatentFile(patent);

    fs.writeFileSync(filepath, content);
    generated++;

    if (generated % 50 === 0) {
      console.log(`  Generated ${generated}/${patents.length} files...`);
    }
  }

  console.log(`\n✓ Generated ${generated} patent files in ${EXPORT_DIR}/`);

  // Summary
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  EXPORT SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Files created:     ${generated}`);
  console.log(`  With abstracts:    ${withAbstracts}`);
  console.log(`  Output directory:  ${EXPORT_DIR}/`);
  console.log(`  File format:       US<patent_id>.txt`);
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Show sample
  console.log('Sample files (top 5):');
  for (const patent of patents.slice(0, 5)) {
    console.log(`  US${patent.patentId}.txt - ${patent.title.substring(0, 50)}...`);
  }
}

main().catch(console.error);
