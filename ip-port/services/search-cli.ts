/**
 * Patent Search CLI
 *
 * Interactive tool for testing search terms against the ElasticSearch index.
 *
 * Usage:
 *   npx tsx services/search-cli.ts
 *
 * Commands (in interactive mode):
 *   search <query>        Search patents by text
 *   similar <patent_id>   Find patents similar to given ID
 *   terms [tier]          Extract significant terms from tier
 *   cpc [competitor]      Show CPC code distribution
 *   filter <field>=<val>  Set filter (tier=1, competitor=Apple, etc.)
 *   clear                 Clear filters
 *   stats                 Show index statistics
 *   help                  Show help
 *   exit                  Exit
 */

import * as readline from 'readline';
import { createElasticsearchService, ElasticsearchService } from './elasticsearch-service.js';
import * as dotenv from 'dotenv';

dotenv.config();

class SearchCLI {
  private es: ElasticsearchService;
  private filters: Record<string, any> = {};
  private rl: readline.Interface;

  constructor() {
    this.es = createElasticsearchService();
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: 'patent-search> '
    });
  }

  async start() {
    console.log(`
===========================================
  Patent Portfolio Search CLI
===========================================
Type 'help' for available commands.
`);

    // Check ES health
    const healthy = await this.es.healthCheck();
    if (!healthy) {
      console.log('WARNING: ElasticSearch is not available.');
      console.log('Start it with: docker compose up -d\n');
    } else {
      const stats = await this.es.getStats();
      console.log(`Connected to ElasticSearch: ${stats.docCount} patents indexed\n`);
    }

    this.rl.prompt();

    this.rl.on('line', async (line) => {
      const trimmed = line.trim();
      if (trimmed) {
        await this.handleCommand(trimmed);
      }
      this.rl.prompt();
    });

    this.rl.on('close', () => {
      console.log('\nGoodbye!');
      process.exit(0);
    });
  }

  private async handleCommand(input: string) {
    const parts = input.split(/\s+/);
    const command = parts[0].toLowerCase();
    const args = parts.slice(1).join(' ');

    try {
      switch (command) {
        case 'search':
        case 's':
          await this.search(args);
          break;

        case 'similar':
        case 'sim':
          await this.findSimilar(args);
          break;

        case 'terms':
        case 't':
          await this.extractTerms(args ? parseInt(args) : undefined);
          break;

        case 'cpc':
          await this.showCpcDistribution(args || undefined);
          break;

        case 'competitors':
        case 'comp':
          await this.showCompetitorDistribution();
          break;

        case 'filter':
        case 'f':
          this.setFilter(args);
          break;

        case 'clear':
          this.clearFilters();
          break;

        case 'stats':
          await this.showStats();
          break;

        case 'help':
        case 'h':
        case '?':
          this.showHelp();
          break;

        case 'exit':
        case 'quit':
        case 'q':
          this.rl.close();
          break;

        default:
          // Treat as search if not a command
          if (input.length > 2) {
            await this.search(input);
          } else {
            console.log(`Unknown command: ${command}. Type 'help' for commands.`);
          }
      }
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
    }
  }

  private async search(query: string) {
    if (!query) {
      console.log('Usage: search <query>');
      return;
    }

    console.log(`\nSearching for: "${query}"`);
    if (Object.keys(this.filters).length > 0) {
      console.log(`Filters: ${JSON.stringify(this.filters)}`);
    }
    console.log('---');

    const results = await this.es.search(query, {
      size: 15,
      filters: this.filters,
      highlight: true
    });

    console.log(`Found ${results.total} patents:\n`);

    for (const hit of results.hits) {
      const tier = hit.tier ? `[Tier ${hit.tier}]` : '';
      const competitors = hit.competitors_citing?.length
        ? `[${hit.competitors_citing.join(', ')}]`
        : '';
      const score = hit.enhanced_score ? `Score: ${hit.enhanced_score.toFixed(0)}` : '';

      console.log(`${hit.patent_id}: ${hit.title}`);
      console.log(`  ${tier} ${competitors} ${score}`.trim());

      if (hit.highlights?.abstract) {
        const snippet = hit.highlights.abstract[0]
          .replace(/<mark>/g, '\x1b[33m')
          .replace(/<\/mark>/g, '\x1b[0m');
        console.log(`  ...${snippet}...`);
      } else if (hit.abstract) {
        console.log(`  ${hit.abstract.substring(0, 150)}...`);
      }
      console.log();
    }
  }

  private async findSimilar(patentId: string) {
    if (!patentId) {
      console.log('Usage: similar <patent_id>');
      return;
    }

    console.log(`\nFinding patents similar to ${patentId}...`);
    console.log('---');

    const results = await this.es.findSimilar(patentId, { size: 10 });

    if (results.total === 0) {
      console.log('No similar patents found (or patent not in index).');
      return;
    }

    console.log(`Found ${results.total} similar patents:\n`);

    for (const hit of results.hits) {
      console.log(`${hit.patent_id}: ${hit.title}`);
      console.log(`  Similarity: ${hit.score.toFixed(2)}`);
      if (hit.assignee) {
        console.log(`  Assignee: ${hit.assignee}`);
      }
      console.log();
    }
  }

  private async extractTerms(tier?: number) {
    console.log(`\nExtracting significant terms${tier ? ` from Tier ${tier}` : ''}...`);
    console.log('---');

    const terms = await this.es.extractSignificantTerms({ tier }, { size: 30 });

    if (terms.length === 0) {
      console.log('No significant terms found.');
      return;
    }

    console.log('Top significant terms in abstracts:\n');
    for (const t of terms) {
      const bar = '='.repeat(Math.min(50, Math.round(t.score * 10)));
      console.log(`  ${t.term.padEnd(25)} ${t.docCount.toString().padStart(4)} docs  ${bar}`);
    }
    console.log();
  }

  private async showCpcDistribution(competitor?: string) {
    console.log(`\nCPC code distribution${competitor ? ` for ${competitor} citations` : ''}...`);
    console.log('---');

    const terms = await this.es.getTermFrequencies(
      competitor ? { competitor } : {},
      { field: 'cpc_classes', size: 20 }
    );

    if (terms.length === 0) {
      console.log('No CPC data found.');
      return;
    }

    const CPC_NAMES: Record<string, string> = {
      'H04': 'Electric Communication',
      'G06': 'Computing/Calculating',
      'H01': 'Electric Elements',
      'G11': 'Information Storage',
      'H03': 'Electronic Circuits',
      'G09': 'Education/Display',
      'G10': 'Musical Instruments/Acoustics',
      'H02': 'Electric Power',
    };

    console.log('CPC Class Distribution:\n');
    const maxCount = terms[0]?.count || 1;
    for (const t of terms) {
      const bar = '='.repeat(Math.round(t.count / maxCount * 40));
      const name = CPC_NAMES[t.term] || '';
      console.log(`  ${t.term.padEnd(6)} ${t.count.toString().padStart(5)}  ${bar}  ${name}`);
    }
    console.log();
  }

  private async showCompetitorDistribution() {
    console.log('\nCompetitor citation distribution...');
    console.log('---');

    const terms = await this.es.getTermFrequencies({}, { field: 'competitors_citing', size: 20 });

    if (terms.length === 0) {
      console.log('No competitor citation data found.');
      return;
    }

    console.log('Patents by competitor citations:\n');
    const maxCount = terms[0]?.count || 1;
    for (const t of terms) {
      const bar = '='.repeat(Math.round(t.count / maxCount * 40));
      console.log(`  ${t.term.padEnd(15)} ${t.count.toString().padStart(5)}  ${bar}`);
    }
    console.log();
  }

  private setFilter(filterStr: string) {
    if (!filterStr.includes('=')) {
      console.log('Usage: filter <field>=<value>');
      console.log('Available filters: tier, competitor, cpc_class, min_score, has_competitor_citations');
      return;
    }

    const [key, value] = filterStr.split('=');
    const numValue = parseInt(value);

    if (key === 'tier' && !isNaN(numValue)) {
      this.filters.tier = numValue;
    } else if (key === 'competitor') {
      this.filters.competitor = value;
    } else if (key === 'cpc_class') {
      this.filters.cpc_class = value;
    } else if (key === 'min_score' && !isNaN(numValue)) {
      this.filters.min_score = numValue;
    } else if (key === 'has_competitor_citations') {
      this.filters.has_competitor_citations = value.toLowerCase() === 'true';
    } else {
      this.filters[key] = value;
    }

    console.log(`Filter set: ${key}=${value}`);
    console.log(`Active filters: ${JSON.stringify(this.filters)}`);
  }

  private clearFilters() {
    this.filters = {};
    console.log('Filters cleared.');
  }

  private async showStats() {
    const stats = await this.es.getStats();
    console.log(`
Index Statistics:
  Documents: ${stats.docCount.toLocaleString()}
  Size: ${(stats.sizeBytes / 1024 / 1024).toFixed(2)} MB

Active Filters: ${Object.keys(this.filters).length === 0 ? 'none' : JSON.stringify(this.filters)}
`);
  }

  private showHelp() {
    console.log(`
Patent Search CLI Commands:

  search <query>        Search patents by text in title/abstract
  s <query>             Shortcut for search

  similar <patent_id>   Find patents similar to a given patent
  sim <patent_id>       Shortcut for similar

  terms [tier]          Extract significant terms from abstracts
  t [tier]              Shortcut for terms

  cpc [competitor]      Show CPC code distribution
  competitors           Show competitor citation distribution

  filter <key>=<value>  Set a search filter
                        Available: tier, competitor, cpc_class, min_score
  clear                 Clear all filters

  stats                 Show index statistics

  help, h, ?            Show this help
  exit, quit, q         Exit the CLI

Examples:
  search adaptive bitrate streaming
  filter tier=1
  search video codec
  similar 8010707
  terms 1
  cpc Apple
`);
  }
}

// Run CLI
new SearchCLI().start();
