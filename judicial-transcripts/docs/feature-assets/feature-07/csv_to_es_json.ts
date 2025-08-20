import fs from 'fs';
import csv from 'csv-parser';

interface ExpressionEntry {
  "Expression Type": string;
  "Phrase Pattern": string;
  "Search Strategy": string;
  "Fallback / Negative Strategy": string;
  "Notes": string;
}

interface ESQuery {
  query: Record<string, any>;
}

const inputCSV = 'courtroom_expressions_library_expanded.csv';
const outputJSON = 'courtroom_expressions_es_queries.json';

const escapeForRegExp = (pattern: string) => pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const buildQuery = (entry: ExpressionEntry): ESQuery => {
  const phrase = entry["Phrase Pattern"];
  const strategy = entry["Search Strategy"];

  switch (strategy) {
    case 'match_phrase':
      return {
        query: {
          match_phrase: {
            text: phrase
          }
        }
      };

    case 'wildcard':
      return {
        query: {
          wildcard: {
            "text.raw_lower": phrase.toLowerCase() // assumes a lowercased keyword subfield
          }
        }
      };

    case 'span_near': {
      // parse something like "word1 NEAR/3 word2"
      const match = phrase.match(/(.+)\s+NEAR\/(\d+)\s+(.+)/i);
      if (!match) throw new Error(`Invalid span_near pattern: ${phrase}`);
      const [, term1, slop, term2] = match;
      return {
        query: {
          span_near: {
            clauses: [
              { span_term: { text: term1.trim().toLowerCase() } },
              { span_term: { text: term2.trim().toLowerCase() } }
            ],
            slop: parseInt(slop),
            in_order: true
          }
        }
      };
    }

    case 'bool_must_not': {
      const negative = phrase.toLowerCase();
      const fallback = entry["Fallback / Negative Strategy"].toLowerCase();
      return {
        query: {
          bool: {
            should: [
              {
                bool: {
                  must: [
                    { match_phrase: { text: fallback } }
                  ],
                  must_not: [
                    { match_phrase: { text: negative } }
                  ]
                }
              }
            ]
          }
        }
      };
    }

    default:
      throw new Error(`Unknown strategy: ${strategy}`);
  }
};

const results: Record<string, any>[] = [];

fs.createReadStream(inputCSV)
  .pipe(csv())
  .on('data', (data: ExpressionEntry) => {
    try {
      const query = buildQuery(data);
      results.push({
        expression_type: data["Expression Type"],
        phrase_pattern: data["Phrase Pattern"],
        strategy: data["Search Strategy"],
        query
      });
    } catch (err) {
      console.error(`Skipping invalid entry: ${data["Phrase Pattern"]} - ${err}`);
    }
  })
  .on('end', () => {
    fs.writeFileSync(outputJSON, JSON.stringify(results, null, 2));
    console.log(`Saved ${results.length} queries to ${outputJSON}`);
  });
