/**
 * CPC XML Parser Service
 *
 * Parses USPTO CPC (Cooperative Patent Classification) XML files to extract
 * classification codes, titles, and definitions. Supports seeding the database
 * with comprehensive CPC taxonomy data.
 *
 * Data sources:
 * - CPC Scheme XML files: Classification hierarchy and short titles
 * - CPC Definition XML files: Extended definitions and descriptions
 *
 * Download from: https://www.cooperativepatentclassification.org/home
 */

import { PrismaClient, CpcLevel, CpcSource } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import { XMLParser } from 'fast-xml-parser';
import { cleanXmlText } from '../utils/xml-text-cleaner.js';

const prisma = new PrismaClient();

// ============================================================================
// Types
// ============================================================================

interface CpcCodeEntry {
  code: string;
  level: CpcLevel;
  parentCode: string | null;
  title: string;
  titleLong?: string;
  notAllocatable: boolean;
  dateRevised?: string;
}

interface ParsedSchemeResult {
  entries: CpcCodeEntry[];
  subclass: string;
  fileCount: number;
}

interface ParsedDefinitionResult {
  definitions: Map<string, string>;
  subclass: string;
}

interface SeedProgress {
  filesProcessed: number;
  codesInserted: number;
  codesUpdated: number;
  definitionsApplied: number;
  errors: string[];
}

interface SeedOptions {
  /** Only process specific subclasses (e.g., ['H04L', 'G06F']) */
  subclasses?: string[];
  /** Skip definition files (faster, less detail) */
  skipDefinitions?: boolean;
  /** Progress callback */
  onProgress?: (progress: SeedProgress) => void;
}

// ============================================================================
// XML Parsing Utilities
// ============================================================================

/**
 * Create an XML parser configured for CPC scheme files
 */
function createXmlParser(): XMLParser {
  return new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    textNodeName: '#text',
    isArray: (tagName) => {
      // Force array for nested classification items
      return ['classification-item', 'title-part', 'note', 'reference'].includes(tagName);
    },
  });
}

/**
 * Determine CPC level from code format
 */
function determineCpcLevel(code: string): CpcLevel {
  // Remove any whitespace
  code = code.trim();

  // Section: single letter (A, B, C, D, E, F, G, H, Y)
  if (/^[A-HY]$/.test(code)) {
    return CpcLevel.SECTION;
  }

  // Class: letter + 2 digits (H04, G06)
  if (/^[A-HY]\d{2}$/.test(code)) {
    return CpcLevel.CLASS;
  }

  // Subclass: letter + 2 digits + letter (H04L, G06F)
  if (/^[A-HY]\d{2}[A-Z]$/.test(code)) {
    return CpcLevel.SUBCLASS;
  }

  // Group or Subgroup: has numbers after the subclass
  if (code.includes('/')) {
    return CpcLevel.SUBGROUP;
  }

  // Group: subclass + 1-4 digits (H04L63, G06F21, H04L2101)
  if (/^[A-HY]\d{2}[A-Z]\d{1,4}$/.test(code)) {
    return CpcLevel.GROUP;
  }

  // Default to SUBGROUP for anything with "/" or unknown format
  return CpcLevel.SUBGROUP;
}

/**
 * Determine parent code for hierarchy
 */
function determineParentCode(code: string): string | null {
  code = code.trim();

  // Section has no parent
  if (/^[A-HY]$/.test(code)) {
    return null;
  }

  // Class -> Section
  if (/^[A-HY]\d{2}$/.test(code)) {
    return code[0];
  }

  // Subclass -> Class
  if (/^[A-HY]\d{2}[A-Z]$/.test(code)) {
    return code.slice(0, 3);
  }

  // Group -> Subclass
  if (/^[A-HY]\d{2}[A-Z]\d{1,4}$/.test(code) && !code.includes('/')) {
    return code.slice(0, 4);
  }

  // Subgroup -> Group (or parent subgroup)
  if (code.includes('/')) {
    const [group, subgroupPart] = code.split('/');

    // If subgroup is like 1416, parent is 14 (first 2 digits)
    if (subgroupPart.length > 2) {
      // Find nearest parent subgroup
      // H04L63/1416 -> H04L63/14
      // H04L63/1408 -> H04L63/14
      const parentSubgroup = subgroupPart.slice(0, 2);
      const potentialParent = `${group}/${parentSubgroup}`;
      if (potentialParent !== code) {
        return potentialParent;
      }
    }

    // Otherwise parent is the group
    return group;
  }

  return null;
}

/**
 * Extract text from various XML title structures
 */
function extractTitleText(titlePart: any): string {
  if (!titlePart) return '';

  let text = '';

  // Handle array of title parts
  if (Array.isArray(titlePart)) {
    titlePart = titlePart[0];
  }

  // Direct text content
  if (titlePart['#text']) {
    text = titlePart['#text'];
  }

  // CPC-specific text
  if (titlePart['CPC-specific-text']) {
    const cpcText = titlePart['CPC-specific-text'];
    if (cpcText?.text?.['#text']) {
      text = cpcText.text['#text'];
    } else if (cpcText?.text) {
      text = typeof cpcText.text === 'string' ? cpcText.text : '';
    }
  }

  // Regular text element
  if (titlePart?.text) {
    if (typeof titlePart.text === 'string') {
      text = titlePart.text;
    } else if (titlePart.text['#text']) {
      text = titlePart.text['#text'];
    }
  }

  // Clean up the text (decode XML entities, remove tags, normalize whitespace)
  return cleanXmlText(text);
}

// ============================================================================
// Scheme XML Parsing
// ============================================================================

/**
 * Parse a CPC scheme XML file to extract classification entries
 */
export async function parseSchemeXml(filePath: string): Promise<ParsedSchemeResult> {
  const content = fs.readFileSync(filePath, 'utf-8');
  const parser = createXmlParser();
  const parsed = parser.parse(content);

  const entries: CpcCodeEntry[] = [];
  const subclass = path.basename(filePath).replace('cpc-scheme-', '').replace('.xml', '');

  /**
   * Recursively process classification items
   */
  function processItem(item: any, depth = 0): void {
    if (!item) return;

    // Extract classification symbol
    const symbol = item['classification-symbol'];
    if (!symbol) return;

    const code = typeof symbol === 'string' ? symbol : symbol['#text'] || '';
    if (!code) return;

    // Extract title
    let title = '';
    if (item['class-title']?.['title-part']) {
      title = extractTitleText(item['class-title']['title-part']);
    }

    // Get attributes
    const notAllocatable = item['@_not-allocatable'] === 'true';
    const dateRevised = item['@_date-revised'] || undefined;

    // Create entry
    entries.push({
      code,
      level: determineCpcLevel(code),
      parentCode: determineParentCode(code),
      title: title || `[${code}]`,
      notAllocatable,
      dateRevised,
    });

    // Process nested items
    if (item['classification-item']) {
      const children = Array.isArray(item['classification-item'])
        ? item['classification-item']
        : [item['classification-item']];

      for (const child of children) {
        processItem(child, depth + 1);
      }
    }
  }

  // Start processing from root
  const root = parsed['class-scheme'];
  if (root?.['classification-item']) {
    const items = Array.isArray(root['classification-item'])
      ? root['classification-item']
      : [root['classification-item']];

    for (const item of items) {
      processItem(item);
    }
  }

  return { entries, subclass, fileCount: 1 };
}

// ============================================================================
// Definition XML Parsing
// ============================================================================

/**
 * Parse a CPC definition XML file to extract extended descriptions
 */
export async function parseDefinitionXml(filePath: string): Promise<ParsedDefinitionResult> {
  const content = fs.readFileSync(filePath, 'utf-8');
  const parser = createXmlParser();
  const parsed = parser.parse(content);

  const definitions = new Map<string, string>();
  const subclass = path.basename(filePath).replace('cpc-definition-', '').replace('.xml', '');

  /**
   * Extract definition text from a definition item
   */
  function extractDefinition(item: any): string {
    const parts: string[] = [];

    // Definition title
    if (item['definition-title']) {
      const title = typeof item['definition-title'] === 'string'
        ? item['definition-title']
        : item['definition-title']['#text'] || '';
      if (title) {
        parts.push(cleanXmlText(title.replace(/[{}]/g, '')));
      }
    }

    // Definition statement
    if (item['definition-statement']?.['section-body']) {
      const body = item['definition-statement']['section-body'];
      if (body['paragraph-text']) {
        const paragraphs = Array.isArray(body['paragraph-text'])
          ? body['paragraph-text']
          : [body['paragraph-text']];

        for (const p of paragraphs) {
          const text = typeof p === 'string' ? p : (p['#text'] || '');
          if (text && !text.startsWith('This place covers:')) {
            parts.push(cleanXmlText(text));
          }
        }
      }
    }

    return parts.join(' ').replace(/\s+/g, ' ').trim();
  }

  // Process definition items
  const root = parsed['definitions'];
  if (root?.['definition-item']) {
    const items = Array.isArray(root['definition-item'])
      ? root['definition-item']
      : [root['definition-item']];

    for (const item of items) {
      const symbol = item['classification-symbol'];
      const code = typeof symbol === 'string'
        ? symbol
        : (symbol?.['#text'] || symbol?.['@_scheme'] || '');

      if (code) {
        const cleanCode = code.replace(/^cpc:/, '').trim();
        const definition = extractDefinition(item);
        if (definition) {
          definitions.set(cleanCode, definition);
        }
      }
    }
  }

  return { definitions, subclass };
}

// ============================================================================
// Database Seeding
// ============================================================================

/**
 * Seed CPC codes from XML files into the database.
 *
 * @param options Seed options (subclasses filter, skip definitions, progress callback)
 */
export async function seedCpcFromXml(options: SeedOptions = {}): Promise<SeedProgress> {
  const schemeDir = process.env.CPC_SCHEME_XML_DIR;
  const definitionDir = process.env.CPC_DEFINITION_XML_DIR;

  if (!schemeDir) {
    throw new Error('CPC_SCHEME_XML_DIR environment variable not set');
  }

  const progress: SeedProgress = {
    filesProcessed: 0,
    codesInserted: 0,
    codesUpdated: 0,
    definitionsApplied: 0,
    errors: [],
  };

  // Get list of scheme files
  let schemeFiles = fs.readdirSync(schemeDir)
    .filter(f => f.startsWith('cpc-scheme-') && f.endsWith('.xml'))
    .sort();

  // Filter by subclasses if specified
  if (options.subclasses && options.subclasses.length > 0) {
    const subclassSet = new Set(options.subclasses.map(s => s.toUpperCase()));
    schemeFiles = schemeFiles.filter(f => {
      const subclass = f.replace('cpc-scheme-', '').replace('.xml', '');
      // Match exact subclass or prefix (e.g., 'H04' matches 'H04L', 'H04N', etc.)
      return subclassSet.has(subclass) ||
             [...subclassSet].some(sc => subclass.startsWith(sc));
    });
  }

  console.log(`Processing ${schemeFiles.length} scheme files...`);

  // Process scheme files
  for (const file of schemeFiles) {
    try {
      const filePath = path.join(schemeDir, file);
      const result = await parseSchemeXml(filePath);

      for (const entry of result.entries) {
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
            progress.codesUpdated++;
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
            progress.codesInserted++;
          }
        } catch (err) {
          progress.errors.push(`Error inserting ${entry.code}: ${err}`);
        }
      }

      progress.filesProcessed++;
      if (options.onProgress) {
        options.onProgress({ ...progress });
      }

      // Log progress every 50 files
      if (progress.filesProcessed % 50 === 0) {
        console.log(`  Processed ${progress.filesProcessed} files, ${progress.codesInserted + progress.codesUpdated} codes...`);
      }
    } catch (err) {
      progress.errors.push(`Error processing ${file}: ${err}`);
    }
  }

  // Process definition files if not skipped
  if (!options.skipDefinitions && definitionDir && fs.existsSync(definitionDir)) {
    let definitionFiles = fs.readdirSync(definitionDir)
      .filter(f => f.startsWith('cpc-definition-') && f.endsWith('.xml'))
      .sort();

    // Filter by subclasses if specified
    if (options.subclasses && options.subclasses.length > 0) {
      const subclassSet = new Set(options.subclasses.map(s => s.toUpperCase()));
      definitionFiles = definitionFiles.filter(f => {
        const subclass = f.replace('cpc-definition-', '').replace('.xml', '');
        return subclassSet.has(subclass) ||
               [...subclassSet].some(sc => subclass.startsWith(sc));
      });
    }

    console.log(`Processing ${definitionFiles.length} definition files...`);

    for (const file of definitionFiles) {
      try {
        const filePath = path.join(definitionDir, file);
        const result = await parseDefinitionXml(filePath);

        for (const [code, definition] of result.definitions) {
          try {
            const updated = await prisma.cpcCode.updateMany({
              where: { code },
              data: { titleLong: definition },
            });
            if (updated.count > 0) {
              progress.definitionsApplied++;
            }
          } catch (err) {
            // Silently ignore - code may not exist
          }
        }

        progress.filesProcessed++;
        if (options.onProgress) {
          options.onProgress({ ...progress });
        }
      } catch (err) {
        progress.errors.push(`Error processing definition ${file}: ${err}`);
      }
    }
  }

  console.log(`\nSeed complete:`);
  console.log(`  Files processed: ${progress.filesProcessed}`);
  console.log(`  Codes inserted: ${progress.codesInserted}`);
  console.log(`  Codes updated: ${progress.codesUpdated}`);
  console.log(`  Definitions applied: ${progress.definitionsApplied}`);
  if (progress.errors.length > 0) {
    console.log(`  Errors: ${progress.errors.length}`);
  }

  return progress;
}

/**
 * Seed only patent-relevant CPC subclasses (faster for typical IP portfolios)
 */
export async function seedPatentRelevantCpc(): Promise<SeedProgress> {
  const relevantSubclasses = [
    // Computing & Software
    'G06F', 'G06N', 'G06Q', 'G06T', 'G06V',
    // Networking & Communications
    'H04L', 'H04N', 'H04W', 'H04B', 'H04J', 'H04K', 'H04M', 'H04R', 'H04S',
    // Semiconductor & Electronics
    'H01L', 'H03F', 'H03H', 'H03K', 'H03L', 'H03M',
    // Storage
    'G11B', 'G11C',
    // Optics
    'G02B', 'G02F',
    // Audio/Speech
    'G10L',
    // Display
    'G09G',
  ];

  return seedCpcFromXml({ subclasses: relevantSubclasses });
}

/**
 * Get CPC code statistics from the database
 */
export async function getCpcStats(): Promise<{
  total: number;
  byLevel: Record<string, number>;
  withDefinitions: number;
  recentlyUpdated: number;
}> {
  const total = await prisma.cpcCode.count();

  const byLevelResults = await prisma.cpcCode.groupBy({
    by: ['level'],
    _count: { level: true },
  });

  const byLevel: Record<string, number> = {};
  for (const result of byLevelResults) {
    byLevel[result.level] = result._count.level;
  }

  const withDefinitions = await prisma.cpcCode.count({
    where: { titleLong: { not: null } },
  });

  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
  const recentlyUpdated = await prisma.cpcCode.count({
    where: { updatedAt: { gte: oneWeekAgo } },
  });

  return { total, byLevel, withDefinitions, recentlyUpdated };
}
