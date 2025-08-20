import fs from 'fs';
import path from 'path';

interface CSVEntry {
  'Expression Type': string;
  'Phrase Pattern': string;
  'Search Strategy': string;
  'Fallback / Negative Strategy': string;
  'Notes': string;
}

interface ElasticSearchExpressionSeed {
  name: string;
  expressionType: string;
  phrasePattern: string;
  searchStrategy: string;
  esQuery: any;
  description?: string;
  isActive: boolean;
}

function sanitizeName(expressionType: string, phrase: string): string {
  const cleanPhrase = phrase
    .replace(/\*/g, '_wildcard_')
    .replace(/\s+/g, '_')
    .replace(/[^\w_]/g, '')
    .toLowerCase();
  const cleanType = expressionType
    .replace(/\s*\/\s*/g, '_')
    .replace(/\s+/g, '_')
    .toLowerCase();
  return `${cleanType}_${cleanPhrase}`;
}

function buildElasticsearchQuery(entry: CSVEntry): any {
  const phrase = entry['Phrase Pattern'];
  const strategy = entry['Search Strategy'];

  switch (strategy) {
    case 'match_phrase':
      return {
        match_phrase: {
          text: phrase
        }
      };

    case 'wildcard':
      // Convert simple wildcard patterns to Elasticsearch wildcard syntax
      const wildcardPattern = phrase.replace(/\*/g, '*').toLowerCase();
      return {
        wildcard: {
          'text.keyword': wildcardPattern
        }
      };

    case 'span_near':
      // Parse patterns like "word1 NEAR/3 word2"
      const nearMatch = phrase.match(/(.+)\s+NEAR\/(\d+)\s+(.+)/i);
      if (!nearMatch) {
        console.warn(`Invalid span_near pattern: ${phrase}, using match_phrase instead`);
        return {
          match_phrase: {
            text: phrase
          }
        };
      }
      const [, term1, slop, term2] = nearMatch;
      return {
        span_near: {
          clauses: [
            { span_term: { text: term1.trim().toLowerCase() } },
            { span_term: { text: term2.trim().toLowerCase() } }
          ],
          slop: parseInt(slop),
          in_order: true
        }
      };

    case 'bool_must_not':
      const negative = phrase.toLowerCase();
      const fallback = entry['Fallback / Negative Strategy'].toLowerCase();
      if (!fallback) {
        console.warn(`No fallback for bool_must_not pattern: ${phrase}`);
        return {
          match_phrase: {
            text: phrase
          }
        };
      }
      return {
        bool: {
          must: [
            { match_phrase: { text: fallback } }
          ],
          must_not: [
            { match_phrase: { text: negative } }
          ]
        }
      };

    default:
      console.warn(`Unknown search strategy: ${strategy}, using match_phrase`);
      return {
        match_phrase: {
          text: phrase
        }
      };
  }
}

function parseCSV(csvContent: string): CSVEntry[] {
  const lines = csvContent.split('\n').filter(line => line.trim());
  if (lines.length === 0) return [];
  
  // Parse headers
  const headers = lines[0].split(',').map(h => h.trim());
  
  // Parse data rows
  const records: CSVEntry[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',').map(v => v.trim());
    const record: any = {};
    headers.forEach((header, index) => {
      record[header] = values[index] || '';
    });
    records.push(record);
  }
  
  return records;
}

function convertCSVToSeed(csvPath: string): ElasticSearchExpressionSeed[] {
  const csvContent = fs.readFileSync(csvPath, 'utf-8');
  const records: CSVEntry[] = parseCSV(csvContent);

  const seedData: ElasticSearchExpressionSeed[] = [];

  for (const record of records) {
    if (!record['Phrase Pattern'] || !record['Search Strategy']) {
      console.warn('Skipping incomplete record:', record);
      continue;
    }

    try {
      const esQuery = buildElasticsearchQuery(record);
      const name = sanitizeName(record['Expression Type'], record['Phrase Pattern']);

      seedData.push({
        name,
        expressionType: record['Expression Type'],
        phrasePattern: record['Phrase Pattern'],
        searchStrategy: record['Search Strategy'],
        esQuery,
        description: record['Notes'] || undefined,
        isActive: true
      });
    } catch (error) {
      console.error(`Error processing record: ${JSON.stringify(record)}`, error);
    }
  }

  return seedData;
}

// Main execution
if (require.main === module) {
  const csvPath = path.join(
    __dirname,
    '../../docs/feature-assets/feature-07/courtroom_expressions_library_expanded.csv'
  );
  
  const outputPath = path.join(
    __dirname,
    '../../seed-data/elasticsearch-expressions.json'
  );

  try {
    const seedData = convertCSVToSeed(csvPath);
    
    // Write seed data
    fs.writeFileSync(
      outputPath,
      JSON.stringify(seedData, null, 2),
      'utf-8'
    );

    console.log(`Successfully converted ${seedData.length} expressions`);
    console.log(`Seed data written to: ${outputPath}`);
    
    // Print summary
    const typeGroups = seedData.reduce((acc, item) => {
      acc[item.expressionType] = (acc[item.expressionType] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    
    console.log('\nExpression types summary:');
    Object.entries(typeGroups).forEach(([type, count]) => {
      console.log(`  ${type}: ${count}`);
    });
  } catch (error) {
    console.error('Error converting CSV to seed data:', error);
    process.exit(1);
  }
}

export { convertCSVToSeed, ElasticSearchExpressionSeed };