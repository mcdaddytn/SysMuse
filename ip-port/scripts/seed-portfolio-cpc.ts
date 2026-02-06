#!/usr/bin/env ts-node
/**
 * Seed CPC Codes from Portfolio Patents
 *
 * Extracts the unique CPC subclasses from cached patent data and seeds
 * the database with CPC codes from the XML scheme files.
 *
 * Usage:
 *   npx ts-node scripts/seed-portfolio-cpc.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { PrismaClient, CpcLevel, CpcSource } from '@prisma/client';
import { XMLParser } from 'fast-xml-parser';

dotenv.config();

const prisma = new PrismaClient();

// ============================================================================
// XML Parsing (inlined from cpc-xml-parser-service)
// ============================================================================

function createXmlParser(): XMLParser {
  return new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    textNodeName: '#text',
    isArray: (tagName) => ['classification-item', 'title-part', 'note', 'reference'].includes(tagName),
  });
}

function determineCpcLevel(code: string): CpcLevel {
  code = code.trim();
  if (/^[A-HY]$/.test(code)) return CpcLevel.SECTION;
  if (/^[A-HY]\d{2}$/.test(code)) return CpcLevel.CLASS;
  if (/^[A-HY]\d{2}[A-Z]$/.test(code)) return CpcLevel.SUBCLASS;
  if (code.includes('/')) return CpcLevel.SUBGROUP;
  if (/^[A-HY]\d{2}[A-Z]\d{1,4}$/.test(code)) return CpcLevel.GROUP;
  return CpcLevel.SUBGROUP;
}

function determineParentCode(code: string): string | null {
  code = code.trim();
  if (/^[A-HY]$/.test(code)) return null;
  if (/^[A-HY]\d{2}$/.test(code)) return code[0];
  if (/^[A-HY]\d{2}[A-Z]$/.test(code)) return code.slice(0, 3);
  if (/^[A-HY]\d{2}[A-Z]\d{1,4}$/.test(code) && !code.includes('/')) return code.slice(0, 4);
  if (code.includes('/')) {
    const [group, subgroupPart] = code.split('/');
    if (subgroupPart.length > 2) {
      const parentSubgroup = subgroupPart.slice(0, 2);
      const potentialParent = `${group}/${parentSubgroup}`;
      if (potentialParent !== code) return potentialParent;
    }
    return group;
  }
  return null;
}

function extractTitleText(titlePart: any): string {
  if (!titlePart) return '';
  let text = '';
  if (Array.isArray(titlePart)) titlePart = titlePart[0];
  if (titlePart['#text']) text = titlePart['#text'];
  if (titlePart['CPC-specific-text']) {
    const cpcText = titlePart['CPC-specific-text'];
    if (cpcText?.text?.['#text']) text = cpcText.text['#text'];
    else if (cpcText?.text) text = typeof cpcText.text === 'string' ? cpcText.text : '';
  }
  if (titlePart?.text) {
    if (typeof titlePart.text === 'string') text = titlePart.text;
    else if (titlePart.text['#text']) text = titlePart.text['#text'];
  }
  return text.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

interface CpcEntry {
  code: string;
  level: CpcLevel;
  parentCode: string | null;
  title: string;
  notAllocatable: boolean;
  dateRevised?: string;
}

async function parseSchemeXml(filePath: string): Promise<CpcEntry[]> {
  const content = fs.readFileSync(filePath, 'utf-8');
  const parser = createXmlParser();
  const parsed = parser.parse(content);
  const entries: CpcEntry[] = [];

  function processItem(item: any): void {
    if (!item) return;
    const symbol = item['classification-symbol'];
    if (!symbol) return;
    const code = typeof symbol === 'string' ? symbol : symbol['#text'] || '';
    if (!code) return;

    let title = '';
    if (item['class-title']?.['title-part']) {
      title = extractTitleText(item['class-title']['title-part']);
    }

    entries.push({
      code,
      level: determineCpcLevel(code),
      parentCode: determineParentCode(code),
      title: title || `[${code}]`,
      notAllocatable: item['@_not-allocatable'] === 'true',
      dateRevised: item['@_date-revised'] || undefined,
    });

    if (item['classification-item']) {
      const children = Array.isArray(item['classification-item'])
        ? item['classification-item']
        : [item['classification-item']];
      for (const child of children) processItem(child);
    }
  }

  const root = parsed['class-scheme'];
  if (root?.['classification-item']) {
    const items = Array.isArray(root['classification-item'])
      ? root['classification-item']
      : [root['classification-item']];
    for (const item of items) processItem(item);
  }

  return entries;
}

async function parseDefinitionXml(filePath: string): Promise<Map<string, string>> {
  const content = fs.readFileSync(filePath, 'utf-8');
  const parser = createXmlParser();
  const parsed = parser.parse(content);
  const definitions = new Map<string, string>();

  function extractDefinition(item: any): string {
    const parts: string[] = [];
    if (item['definition-title']) {
      const title = typeof item['definition-title'] === 'string'
        ? item['definition-title']
        : item['definition-title']['#text'] || '';
      if (title) parts.push(title.replace(/[{}]/g, '').trim());
    }
    if (item['definition-statement']?.['section-body']) {
      const body = item['definition-statement']['section-body'];
      if (body['paragraph-text']) {
        const paragraphs = Array.isArray(body['paragraph-text'])
          ? body['paragraph-text']
          : [body['paragraph-text']];
        for (const p of paragraphs) {
          const text = typeof p === 'string' ? p : (p['#text'] || '');
          if (text && !text.startsWith('This place covers:')) {
            parts.push(text.trim());
          }
        }
      }
    }
    return parts.join(' ').replace(/\s+/g, ' ').trim();
  }

  const root = parsed['definitions'];
  if (root?.['definition-item']) {
    const items = Array.isArray(root['definition-item'])
      ? root['definition-item']
      : [root['definition-item']];
    for (const item of items) {
      const symbol = item['classification-symbol'];
      const code = typeof symbol === 'string' ? symbol : (symbol?.['#text'] || symbol?.['@_scheme'] || '');
      if (code) {
        const cleanCode = code.replace(/^cpc:/, '').trim();
        const definition = extractDefinition(item);
        if (definition) definitions.set(cleanCode, definition);
      }
    }
  }

  return definitions;
}

// ============================================================================
// Main Script
// ============================================================================

async function main() {
  console.log('='.repeat(70));
  console.log('CPC Code Seeder - Portfolio-Based');
  console.log('='.repeat(70));

  // Step 1: Extract unique CPC subclasses from cached patents
  console.log('\n[Step 1] Extracting CPC subclasses from patent cache...');

  const cacheDir = path.join(process.cwd(), 'cache', 'api', 'patentsview', 'patent');

  if (!fs.existsSync(cacheDir)) {
    console.error(`  ERROR: Cache directory not found: ${cacheDir}`);
    process.exit(1);
  }

  const files = fs.readdirSync(cacheDir).filter(f => f.endsWith('.json'));
  console.log(`  Found ${files.length} cached patent files`);

  const subclasses = new Set<string>();
  let processed = 0;
  let errors = 0;

  for (const file of files) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(cacheDir, file), 'utf-8'));
      const cpcData = data.cpc_current || data.cpc || [];
      for (const cpc of cpcData) {
        if (cpc.cpc_subclass_id) {
          subclasses.add(cpc.cpc_subclass_id);
        }
      }
      processed++;
    } catch {
      errors++;
    }

    if (processed % 5000 === 0) {
      console.log(`  Processed ${processed} files, found ${subclasses.size} unique subclasses...`);
    }
  }

  const sortedSubclasses = [...subclasses].sort();
  console.log(`  Completed: ${processed} files processed, ${errors} errors`);
  console.log(`  Found ${sortedSubclasses.length} unique CPC subclasses`);

  // Step 2: Check configuration
  console.log('\n[Step 2] Checking CPC XML configuration...');

  const schemeDir = process.env.CPC_SCHEME_XML_DIR;
  const definitionDir = process.env.CPC_DEFINITION_XML_DIR;

  if (!schemeDir) {
    console.error('  ERROR: CPC_SCHEME_XML_DIR not set in .env');
    process.exit(1);
  }

  if (!fs.existsSync(schemeDir)) {
    console.error(`  ERROR: Scheme directory not found: ${schemeDir}`);
    process.exit(1);
  }

  console.log(`  Scheme directory: ${schemeDir}`);
  console.log(`  Definition directory: ${definitionDir || '(not set)'}`);

  // Get list of scheme files that match our subclasses
  let schemeFiles = fs.readdirSync(schemeDir)
    .filter(f => f.startsWith('cpc-scheme-') && f.endsWith('.xml'))
    .sort();

  // Filter to only files matching our subclasses
  const subclassSet = new Set(sortedSubclasses);
  schemeFiles = schemeFiles.filter(f => {
    const fileSubclass = f.replace('cpc-scheme-', '').replace('.xml', '');
    return subclassSet.has(fileSubclass) ||
           [...subclassSet].some(sc => sc.startsWith(fileSubclass) || fileSubclass.startsWith(sc));
  });

  console.log(`  Matching scheme files: ${schemeFiles.length}`);

  // Step 3: Seed the database
  console.log('\n[Step 3] Seeding CPC codes from XML...');
  console.log('  This may take a few minutes...\n');

  const startTime = Date.now();
  let totalCodesInserted = 0;
  let totalCodesUpdated = 0;
  let totalDefinitionsApplied = 0;
  let filesProcessed = 0;

  for (const file of schemeFiles) {
    try {
      const filePath = path.join(schemeDir, file);
      const entries = await parseSchemeXml(filePath);

      for (const entry of entries) {
        try {
          const existing = await prisma.cpcCode.findUnique({
            where: { code: entry.code },
          });

          if (existing) {
            await prisma.cpcCode.update({
              where: { code: entry.code },
              data: {
                level: entry.level,
                parentCode: entry.parentCode,
                title: entry.title,
                notAllocatable: entry.notAllocatable,
                dateRevised: entry.dateRevised,
                source: CpcSource.XML,
              },
            });
            totalCodesUpdated++;
          } else {
            await prisma.cpcCode.create({
              data: {
                code: entry.code,
                level: entry.level,
                parentCode: entry.parentCode,
                title: entry.title,
                notAllocatable: entry.notAllocatable,
                dateRevised: entry.dateRevised,
                source: CpcSource.XML,
              },
            });
            totalCodesInserted++;
          }
        } catch (err) {
          // Ignore individual code errors
        }
      }

      filesProcessed++;
      if (filesProcessed % 25 === 0) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`  [${elapsed}s] Processed ${filesProcessed}/${schemeFiles.length} files, ${totalCodesInserted + totalCodesUpdated} codes...`);
      }
    } catch (err) {
      console.log(`  Warning: Failed to process ${file}`);
    }
  }

  // Process definition files
  if (definitionDir && fs.existsSync(definitionDir)) {
    console.log('\n  Processing definition files...');

    let definitionFiles = fs.readdirSync(definitionDir)
      .filter(f => f.startsWith('cpc-definition-') && f.endsWith('.xml'))
      .sort();

    // Filter to matching subclasses
    definitionFiles = definitionFiles.filter(f => {
      const fileSubclass = f.replace('cpc-definition-', '').replace('.xml', '');
      return subclassSet.has(fileSubclass) ||
             [...subclassSet].some(sc => sc.startsWith(fileSubclass) || fileSubclass.startsWith(sc));
    });

    for (const file of definitionFiles) {
      try {
        const filePath = path.join(definitionDir, file);
        const definitions = await parseDefinitionXml(filePath);

        for (const [code, definition] of definitions) {
          try {
            const updated = await prisma.cpcCode.updateMany({
              where: { code },
              data: { titleLong: definition },
            });
            if (updated.count > 0) totalDefinitionsApplied++;
          } catch {
            // Ignore
          }
        }
      } catch (err) {
        // Ignore file errors
      }
    }
  }

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log('\n[Step 4] Summary');
  console.log('─'.repeat(50));
  console.log(`  Time elapsed:         ${totalTime}s`);
  console.log(`  Files processed:      ${filesProcessed}`);
  console.log(`  Codes inserted:       ${totalCodesInserted}`);
  console.log(`  Codes updated:        ${totalCodesUpdated}`);
  console.log(`  Definitions applied:  ${totalDefinitionsApplied}`);

  // Final stats
  console.log('\n[Step 5] Database Statistics');
  console.log('─'.repeat(50));
  const total = await prisma.cpcCode.count();
  const withDefinitions = await prisma.cpcCode.count({ where: { titleLong: { not: null } } });
  const byLevel = await prisma.cpcCode.groupBy({ by: ['level'], _count: { level: true } });

  console.log(`  Total CPC codes:      ${total}`);
  console.log(`  With definitions:     ${withDefinitions}`);
  console.log('  By level:');
  for (const item of byLevel) {
    console.log(`    ${item.level.padEnd(12)}: ${item._count.level}`);
  }

  console.log('\n' + '='.repeat(70));
  console.log('Done!');
  console.log('='.repeat(70));

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('Fatal error:', err);
  await prisma.$disconnect();
  process.exit(1);
});
