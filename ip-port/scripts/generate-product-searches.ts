/**
 * Avago A/V Product Search Query Generation Script
 *
 * Phase 4 of the Avago A/V Analysis Approach:
 * - Generates targeted web search queries for product identification
 * - Maps patent terminology to commercial product features
 * - Creates search templates for infringement evidence gathering
 * - Outputs queries suitable for Google/Bing product searches
 */

import * as fs from 'fs';
import * as path from 'path';

const INPUT_DIR = './output/avago-av';
const OUTPUT_DIR = './output/avago-av';

// Technical term to commercial feature mapping
const TERM_TO_FEATURE_MAP: Record<string, string[]> = {
  // Acoustic/resonator terms
  'acoustic': ['acoustic filter', 'RF filter', 'BAW filter', 'MEMS microphone'],
  'resonator': ['RF resonator', 'crystal resonator', 'MEMS resonator', 'frequency filter'],
  'piezoelectric': ['piezo sensor', 'piezo transducer', 'piezo microphone', 'acoustic transducer'],
  'bulk': ['bulk acoustic wave', 'BAW duplexer', 'BAW filter module'],
  'baw': ['BAW filter', 'BAW resonator', 'BAW duplexer', '5G RF filter'],
  'fbar': ['FBAR filter', 'thin film resonator', 'FBAR duplexer'],
  'electrode': ['interdigital electrode', 'IDT electrode', 'SAW electrode'],
  'wave': ['surface acoustic wave', 'SAW filter', 'acoustic wave sensor'],

  // Video/codec terms
  'codec': ['video codec chip', 'H.264 encoder', 'HEVC encoder IC', 'AV1 encoder'],
  'encoding': ['video encoding ASIC', 'hardware encoder', 'transcoding chip'],
  'decoding': ['video decoder chip', 'hardware decoder', 'video decode SoC'],
  'frame': ['frame buffer', 'video frame processor', 'display controller'],
  'bitrate': ['adaptive bitrate', 'ABR streaming', 'video streaming engine'],
  'compression': ['video compression IP', 'image compression codec', 'lossless compression'],

  // Display/interface terms
  'hdmi': ['HDMI transmitter', 'HDMI receiver chip', 'HDMI switch IC', 'HDMI 2.1 controller'],
  'displayport': ['DisplayPort controller', 'DP transmitter', 'DP receiver IC'],
  'display': ['display driver IC', 'display controller', 'timing controller TCON'],
  'pixel': ['pixel processing', 'image signal processor', 'pixel engine'],

  // Audio terms
  'audio': ['audio codec chip', 'audio DSP', 'audio amplifier IC', 'audio interface'],
  'speaker': ['speaker driver', 'class D amplifier', 'audio power amplifier'],
  'microphone': ['MEMS microphone', 'digital microphone', 'microphone array'],
  'sound': ['sound processor', 'audio SoC', 'surround sound DSP'],

  // Wireless/connectivity
  'wireless': ['wireless module', 'WiFi chip', 'Bluetooth SoC', 'wireless audio'],
  'wifi': ['WiFi 6 module', 'WiFi chip', '802.11ax SoC'],
  'bluetooth': ['Bluetooth audio', 'BLE module', 'Bluetooth SoC'],

  // Storage terms
  'storage': ['SSD controller', 'storage controller', 'flash controller'],
  'memory': ['memory controller', 'DDR controller', 'NAND controller'],
};

// Target companies for product searches (from competitor discovery)
const TARGET_COMPANIES = [
  // Major acoustic/RF competitors
  { name: 'Murata', products: ['BAW filter', 'SAW filter', 'RF module', 'MEMS microphone'] },
  { name: 'Skyworks', products: ['RF filter', 'front end module', 'BAW duplexer', '5G RF'] },
  { name: 'Qorvo', products: ['BAW filter', 'RF switch', 'filter module', 'acoustic filter'] },
  { name: 'Akoustis', products: ['BAW filter', 'XBAW', 'RF filter'] },
  { name: 'Qualcomm', products: ['RF front end', '5G modem', 'UltraSAW'] },

  // Semiconductor companies
  { name: 'Texas Instruments', products: ['audio codec', 'display driver', 'video processor'] },
  { name: 'NXP', products: ['MEMS microphone', 'audio amplifier', 'Bluetooth audio'] },
  { name: 'Cirrus Logic', products: ['audio codec', 'audio amplifier', 'haptic driver'] },
  { name: 'Analog Devices', products: ['audio codec', 'MEMS microphone', 'ADC converter'] },

  // Professional A/V
  { name: 'Avid', products: ['Pro Tools', 'media composer', 'video editing'] },
  { name: 'Blackmagic', products: ['video capture', 'HDMI converter', 'video interface'] },
  { name: 'AJA', products: ['video I/O', 'frame grabber', 'HDMI capture'] },
  { name: 'Dolby', products: ['audio codec', 'Dolby Atmos', 'AC-4 encoder'] },

  // Consumer electronics
  { name: 'Samsung', products: ['display driver', 'audio codec', 'OLED controller'] },
  { name: 'Apple', products: ['audio chip', 'display timing', 'video encoder'] },
  { name: 'Sony', products: ['audio DSP', 'image sensor processor', 'audio codec'] },
];

// Search query templates
const QUERY_TEMPLATES = {
  productSpec: (company: string, product: string) =>
    `"${company}" "${product}" specification datasheet`,

  teardown: (company: string, product: string) =>
    `"${company}" "${product}" teardown analysis chip`,

  technicalBlog: (company: string, feature: string) =>
    `"${company}" ${feature} technology implementation`,

  patentCoverage: (term: string, application: string) =>
    `${term} patent ${application} implementation`,

  productAnnouncement: (company: string, product: string) =>
    `"${company}" announces "${product}" new chip`,

  designWin: (company: string, feature: string) =>
    `"${company}" ${feature} design win smartphone`,
};

interface SearchQuery {
  query: string;
  category: string;
  target_company?: string;
  related_patent_terms: string[];
  search_purpose: string;
}

interface ProductSearchOutput {
  generated_at: string;
  total_queries: number;
  queries_by_category: Record<string, number>;
  queries: SearchQuery[];
}

/**
 * Generate product search queries from extracted terms
 */
function generateSearchQueries(extractedTerms: Array<{ term: string; doc_count: number; score: number }>): SearchQuery[] {
  const queries: SearchQuery[] = [];

  // Filter to technical terms with meaningful scores
  const technicalTerms = extractedTerms
    .filter(t => t.score > 0.2 && TERM_TO_FEATURE_MAP[t.term.toLowerCase()])
    .slice(0, 15);

  console.log(`Processing ${technicalTerms.length} technical terms...`);

  // Generate queries for each term
  for (const termData of technicalTerms) {
    const term = termData.term.toLowerCase();
    const features = TERM_TO_FEATURE_MAP[term] || [];

    // Generate product spec searches for target companies
    for (const company of TARGET_COMPANIES.slice(0, 10)) {
      for (const product of company.products.slice(0, 2)) {
        if (features.some(f => product.toLowerCase().includes(term) ||
            f.toLowerCase().includes(product.toLowerCase().split(' ')[0]))) {
          queries.push({
            query: QUERY_TEMPLATES.productSpec(company.name, product),
            category: 'Product Specification',
            target_company: company.name,
            related_patent_terms: [term],
            search_purpose: `Find ${company.name} ${product} specs for claim mapping`
          });
        }
      }
    }

    // Generate teardown searches
    for (const feature of features.slice(0, 2)) {
      queries.push({
        query: `"${feature}" teardown analysis chip identification`,
        category: 'Teardown Analysis',
        related_patent_terms: [term],
        search_purpose: `Find teardown reports showing ${feature} implementations`
      });
    }

    // Generate technical blog searches
    for (const feature of features.slice(0, 1)) {
      queries.push({
        query: `${feature} implementation technology comparison`,
        category: 'Technical Analysis',
        related_patent_terms: [term],
        search_purpose: `Find technical articles about ${feature} technology`
      });
    }
  }

  // Add high-priority company-specific searches
  const priorityCompanies = ['Murata', 'Skyworks', 'Qorvo', 'Akoustis'];
  for (const company of priorityCompanies) {
    queries.push({
      query: `"${company}" BAW filter patent portfolio technology`,
      category: 'Competitive Intelligence',
      target_company: company,
      related_patent_terms: ['baw', 'acoustic', 'resonator'],
      search_purpose: `Research ${company} BAW technology and IP position`
    });

    queries.push({
      query: `"${company}" 5G RF filter module specification`,
      category: 'Product Specification',
      target_company: company,
      related_patent_terms: ['resonator', 'bulk', 'acoustic'],
      search_purpose: `Find ${company} 5G filter products for claim mapping`
    });
  }

  // Add application-specific searches
  const applications = [
    { name: 'smartphone RF filter', terms: ['baw', 'acoustic', 'resonator'] },
    { name: 'MEMS microphone', terms: ['piezoelectric', 'acoustic', 'sensor'] },
    { name: '5G antenna module', terms: ['resonator', 'bulk', 'wave'] },
    { name: 'wireless earbuds', terms: ['bluetooth', 'audio', 'speaker'] },
  ];

  for (const app of applications) {
    queries.push({
      query: `${app.name} technology leaders market share 2024`,
      category: 'Market Intelligence',
      related_patent_terms: app.terms,
      search_purpose: `Identify major players in ${app.name} market`
    });

    queries.push({
      query: `${app.name} chip manufacturer comparison specification`,
      category: 'Technical Comparison',
      related_patent_terms: app.terms,
      search_purpose: `Compare ${app.name} vendors for licensing targets`
    });
  }

  return queries;
}

/**
 * Deduplicate and prioritize queries
 */
function deduplicateQueries(queries: SearchQuery[]): SearchQuery[] {
  const seen = new Set<string>();
  const unique: SearchQuery[] = [];

  for (const q of queries) {
    const normalized = q.query.toLowerCase().replace(/\s+/g, ' ').trim();
    if (!seen.has(normalized)) {
      seen.add(normalized);
      unique.push(q);
    }
  }

  return unique;
}

/**
 * Main execution
 */
async function main() {
  console.log('='.repeat(60));
  console.log('Avago A/V Product Search Query Generation');
  console.log('Phase 4: Commercial Product Search Preparation');
  console.log('='.repeat(60));

  // Load extracted terms from Phase 1
  const termsFiles = fs.readdirSync(INPUT_DIR)
    .filter(f => f.startsWith('avago-av-key-terms-'))
    .sort()
    .reverse();

  if (termsFiles.length === 0) {
    console.error('No terms file found. Run extract-av-terms.ts first.');
    process.exit(1);
  }

  const termsPath = path.join(INPUT_DIR, termsFiles[0]);
  console.log(`Loading terms from: ${termsPath}`);

  const termsData = JSON.parse(fs.readFileSync(termsPath, 'utf-8'));
  const extractedTerms = termsData.significant_terms;

  console.log(`Loaded ${extractedTerms.length} extracted terms`);

  // Generate queries
  console.log('\nGenerating search queries...');
  let queries = generateSearchQueries(extractedTerms);

  // Deduplicate
  queries = deduplicateQueries(queries);
  console.log(`Generated ${queries.length} unique queries`);

  // Categorize
  const byCategory: Record<string, number> = {};
  for (const q of queries) {
    byCategory[q.category] = (byCategory[q.category] || 0) + 1;
  }

  // Display summary
  console.log('\n' + '='.repeat(60));
  console.log('QUERY GENERATION RESULTS');
  console.log('='.repeat(60));

  console.log('\nQueries by Category:');
  console.log('-'.repeat(40));
  for (const [category, count] of Object.entries(byCategory).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${category.padEnd(25)} ${count} queries`);
  }

  console.log('\nSample Product Specification Queries:');
  console.log('-'.repeat(40));
  queries
    .filter(q => q.category === 'Product Specification')
    .slice(0, 10)
    .forEach(q => {
      console.log(`  ${q.query}`);
      console.log(`    Company: ${q.target_company || 'N/A'}, Terms: ${q.related_patent_terms.join(', ')}`);
    });

  console.log('\nSample Teardown Analysis Queries:');
  console.log('-'.repeat(40));
  queries
    .filter(q => q.category === 'Teardown Analysis')
    .slice(0, 5)
    .forEach(q => {
      console.log(`  ${q.query}`);
    });

  console.log('\nSample Market Intelligence Queries:');
  console.log('-'.repeat(40));
  queries
    .filter(q => q.category === 'Market Intelligence')
    .slice(0, 5)
    .forEach(q => {
      console.log(`  ${q.query}`);
    });

  // Save results
  const timestamp = new Date().toISOString().split('T')[0];

  const output: ProductSearchOutput = {
    generated_at: new Date().toISOString(),
    total_queries: queries.length,
    queries_by_category: byCategory,
    queries: queries
  };

  const outputFile = path.join(OUTPUT_DIR, `av-product-search-queries-${timestamp}.json`);
  fs.writeFileSync(outputFile, JSON.stringify(output, null, 2));
  console.log(`\nSaved queries to: ${outputFile}`);

  // Also save as simple text file for easy copy/paste
  const textFile = path.join(OUTPUT_DIR, `av-search-queries-${timestamp}.txt`);
  const textContent = queries
    .map(q => `[${q.category}] ${q.query}`)
    .join('\n');
  fs.writeFileSync(textFile, textContent);
  console.log(`Saved text format to: ${textFile}`);

  // Save priority queries (high-value targets)
  const priorityQueries = queries.filter(q =>
    q.target_company && ['Murata', 'Skyworks', 'Qorvo', 'Akoustis'].includes(q.target_company)
  );
  const priorityFile = path.join(OUTPUT_DIR, `av-priority-searches-${timestamp}.json`);
  fs.writeFileSync(priorityFile, JSON.stringify({
    generated_at: new Date().toISOString(),
    description: 'Priority search queries for top BAW/RF competitors',
    count: priorityQueries.length,
    queries: priorityQueries
  }, null, 2));
  console.log(`Saved priority queries to: ${priorityFile}`);

  console.log('\n' + '='.repeat(60));
  console.log('Phase 4 Complete');
  console.log('Use generated queries for:');
  console.log('  - Google/Bing product specification searches');
  console.log('  - Teardown report research (iFixit, TechInsights, etc.)');
  console.log('  - Market intelligence gathering');
  console.log('='.repeat(60));
}

main().catch(console.error);
