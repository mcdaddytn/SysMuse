#!/usr/bin/env npx ts-node

import * as fs from 'fs';
import * as path from 'path';

interface Statement {
  text: string;
  wordCount: number;
  speakerType: string;
  statementId: number;
  speakerHandle: string;
}

interface InteractionSection {
  section: {
    id: number;
    name: string;
    description: string;
    metadata?: {
      statements: Statement[];
    };
  };
}

interface InteractionFile {
  trial: {
    id: number;
    name: string;
    shortName: string;
  };
  hierarchy: InteractionSection[];
}

interface PatternMatch {
  pattern: string;
  category: string;
  subcategory: string;
  confidence: number;
}

interface FacetSummary {
  trialName: string;
  totalInteractions: number;
  categoriesFound: Record<string, number>;
  patternsIdentified: PatternMatch[];
  sampleInteractions: Array<{
    id: number;
    name: string;
    category: string;
    keyPhrases: string[];
    speakerRoles: string[];
  }>;
}

class OfflineInteractionAnalyzer {
  private patterns = {
    objections: {
      patterns: [
        /\bobjection\b/i,
        /\bobject\b/i,
        /\bsustained\b/i,
        /\boverruled\b/i,
        /\bwithdraw\b/i
      ],
      subcategories: {
        leading: /\bleading\b/i,
        speculation: /\bspeculat/i,
        foundation: /\bfoundation\b/i,
        hearsay: /\bhearsay\b/i,
        relevance: /\brelevan/i,
        argumentative: /\bargumentative\b/i,
        asked_answered: /asked and answered/i,
        beyond_scope: /beyond.*scope/i
      }
    },
    exhibit_handling: {
      patterns: [
        /\bexhibit\b/i,
        /\bmark.*identification\b/i,
        /\bmove.*admission\b/i,
        /\badmit.*evidence\b/i,
        /\bpublish.*jury\b/i,
        /\bshow.*witness\b/i,
        /\bdisplay\b/i,
        /\bscreen\b/i
      ],
      subcategories: {
        marking: /mark.*identification/i,
        admission: /move.*admission|admit.*evidence/i,
        publishing: /publish.*jury/i,
        displaying: /display|screen|pull up/i,
        technical: /can't see|not showing|not working/i
      }
    },
    video_deposition: {
      patterns: [
        /\bvideo\b.*\bdeposition\b/i,
        /\bplayback\b/i,
        /\brecording\b/i,
        /\bdesignation\b/i,
        /\bcounter.*designation\b/i,
        /\d+:\d+/
      ],
      subcategories: {
        start: /play.*video|start.*video/i,
        stop: /stop.*video|pause/i,
        objection: /objection.*video/i,
        timestamp: /\d+:\d+/
      }
    },
    witness_transitions: {
      patterns: [
        /\bpass.*witness\b/i,
        /\bnothing further\b/i,
        /\btender.*witness\b/i,
        /\bmay I approach\b/i,
        /\bwitness.*excused\b/i,
        /\bwitness.*recalled\b/i,
        /\bdirect examination\b/i,
        /\bcross examination\b/i,
        /\bredirect\b/i,
        /\brecross\b/i
      ],
      subcategories: {
        pass: /pass.*witness|tender.*witness/i,
        approach: /may I approach/i,
        done: /nothing further/i,
        examination: /direct|cross|redirect|recross/i
      }
    },
    court_management: {
      patterns: [
        /\brecess\b/i,
        /\bjury.*excused\b/i,
        /\bjury.*recalled\b/i,
        /\bsidebar\b/i,
        /\bbench conference\b/i,
        /\bapproach.*bench\b/i,
        /\brule.*invocation\b/i
      ],
      subcategories: {
        recess: /recess|break|resume/i,
        jury: /jury.*excused|jury.*recalled|jury.*out|jury.*in/i,
        sidebar: /sidebar|bench conference/i
      }
    },
    professional_conduct: {
      patterns: [
        /\bapolog/i,
        /\bsorry\b/i,
        /\bmy mistake\b/i,
        /\bI stand corrected\b/i,
        /\bwithdraw.*question\b/i,
        /\badmonish/i,
        /\bwarning\b/i,
        /\bstrike.*comment\b/i
      ],
      subcategories: {
        apology: /apolog|sorry/i,
        correction: /mistake|stand corrected|withdraw/i,
        admonishment: /admonish|warning/i
      }
    },
    emotion_indicators: {
      patterns: [
        /\bfrustrated\b/i,
        /\bmove on\b/i,
        /\basked and answered\b/i,
        /\bwe've been over\b/i,
        /\balready ruled\b/i,
        /\brespectfully\b/i,
        /\bwith all due respect\b/i,
        /\bif I may\b/i,
        /\bthank you, your honor\b/i
      ],
      subcategories: {
        frustration: /frustrated|move on|been over|already ruled/i,
        deference: /respectfully|with all due respect|if I may/i,
        gratitude: /thank you/i
      }
    }
  };

  analyzeInteraction(section: InteractionSection): {
    category: string;
    subcategories: string[];
    keyPhrases: string[];
    confidence: number;
  } | null {
    const statements = section.section.metadata?.statements || [];
    if (statements.length === 0) return null;

    const allText = statements.map(s => s.text).join(' ');
    const results: { category: string; subcategories: string[]; matches: number } = {
      category: 'uncategorized',
      subcategories: [],
      matches: 0
    };

    for (const [category, config] of Object.entries(this.patterns)) {
      let matchCount = 0;
      const foundSubcategories: string[] = [];

      for (const pattern of config.patterns) {
        if (pattern.test(allText)) {
          matchCount++;
        }
      }

      for (const [subcat, pattern] of Object.entries(config.subcategories)) {
        if (pattern.test(allText)) {
          foundSubcategories.push(subcat);
        }
      }

      if (matchCount > results.matches) {
        results.category = category;
        results.subcategories = foundSubcategories;
        results.matches = matchCount;
      }
    }

    if (results.matches === 0) return null;

    const keyPhrases = this.extractKeyPhrases(allText, results.category);

    return {
      category: results.category,
      subcategories: results.subcategories,
      keyPhrases,
      confidence: Math.min(results.matches / 3, 1)
    };
  }

  private extractKeyPhrases(text: string, category: string): string[] {
    const phrases: string[] = [];
    const sentences = text.split(/[.!?]/);

    for (const sentence of sentences) {
      const config = this.patterns[category as keyof typeof this.patterns];
      if (config) {
        for (const pattern of config.patterns) {
          if (pattern.test(sentence)) {
            const trimmed = sentence.trim();
            if (trimmed.length > 10 && trimmed.length < 100) {
              phrases.push(trimmed);
              if (phrases.length >= 3) return phrases;
            }
          }
        }
      }
    }

    return phrases;
  }

  analyzeFile(filePath: string): FacetSummary {
    console.log(`\nAnalyzing: ${filePath}`);

    const content = fs.readFileSync(filePath, 'utf-8');
    const data: InteractionFile = JSON.parse(content);

    const summary: FacetSummary = {
      trialName: data.trial.shortName,
      totalInteractions: data.hierarchy.length,
      categoriesFound: {},
      patternsIdentified: [],
      sampleInteractions: []
    };

    console.log(`Found ${data.hierarchy.length} interactions to analyze...`);

    for (const interaction of data.hierarchy) {
      const analysis = this.analyzeInteraction(interaction);

      if (analysis) {
        summary.categoriesFound[analysis.category] =
          (summary.categoriesFound[analysis.category] || 0) + 1;

        if (summary.sampleInteractions.length < 20) {
          const speakerRoles = Array.from(new Set(
            (interaction.section.metadata?.statements || [])
              .map(s => s.speakerType)
          ));

          summary.sampleInteractions.push({
            id: interaction.section.id,
            name: interaction.section.name,
            category: analysis.category,
            keyPhrases: analysis.keyPhrases,
            speakerRoles
          });
        }

        for (const subcat of analysis.subcategories) {
          const patternKey = `${analysis.category}:${subcat}`;
          const existing = summary.patternsIdentified.find(p =>
            p.category === analysis.category && p.subcategory === subcat
          );

          if (!existing) {
            summary.patternsIdentified.push({
              pattern: patternKey,
              category: analysis.category,
              subcategory: subcat,
              confidence: analysis.confidence
            });
          }
        }
      }
    }

    return summary;
  }

  generateAccumulatorSuggestions(summary: FacetSummary): any[] {
    const suggestions = [];

    for (const [category, count] of Object.entries(summary.categoriesFound)) {
      const patterns = summary.patternsIdentified
        .filter(p => p.category === category)
        .map(p => p.subcategory);

      const examples = summary.sampleInteractions
        .filter(i => i.category === category)
        .slice(0, 3);

      suggestions.push({
        name: `${category}_detector`,
        description: `Detect ${category.replace(/_/g, ' ')} interactions`,
        occurrences: count,
        facets: patterns,
        examplePhrases: examples.flatMap(e => e.keyPhrases).slice(0, 5),
        speakerPatterns: Array.from(new Set(examples.flatMap(e => e.speakerRoles)))
      });
    }

    return suggestions.sort((a, b) => b.occurrences - a.occurrences);
  }
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 1) {
    console.log('Usage: npx ts-node analyze-interaction-facets-offline.ts <interaction-json-file>');
    console.log('\nExample:');
    console.log('  npx ts-node scripts/analyze-interaction-facets-offline.ts output/hierview/01_Genband_int.json');
    process.exit(1);
  }

  const filePath = args[0];
  if (!fs.existsSync(filePath)) {
    console.error(`Error: File not found: ${filePath}`);
    process.exit(1);
  }

  const analyzer = new OfflineInteractionAnalyzer();
  const summary = analyzer.analyzeFile(filePath);

  console.log('\n📊 ANALYSIS SUMMARY');
  console.log('=' .repeat(50));
  console.log(`Trial: ${summary.trialName}`);
  console.log(`Total Interactions: ${summary.totalInteractions}`);

  console.log('\n📁 Categories Found:');
  Object.entries(summary.categoriesFound)
    .sort((a, b) => b[1] - a[1])
    .forEach(([cat, count]) => {
      console.log(`   ${cat}: ${count} interactions`);
    });

  console.log('\n🔍 Pattern Subcategories:');
  const byCategory = new Map<string, string[]>();
  summary.patternsIdentified.forEach(p => {
    if (!byCategory.has(p.category)) {
      byCategory.set(p.category, []);
    }
    byCategory.get(p.category)!.push(p.subcategory);
  });

  byCategory.forEach((subcats, cat) => {
    console.log(`   ${cat}: ${subcats.join(', ')}`);
  });

  const suggestions = analyzer.generateAccumulatorSuggestions(summary);
  console.log('\n💡 Suggested Accumulators:');
  suggestions.slice(0, 5).forEach(s => {
    console.log(`   - ${s.name} (${s.occurrences} matches)`);
    if (s.facets.length > 0) {
      console.log(`     Facets: ${s.facets.join(', ')}`);
    }
  });

  const outputPath = filePath.replace(/\.json$/, '-facet-summary.json');
  const output = {
    summary,
    suggestedAccumulators: suggestions,
    timestamp: new Date().toISOString()
  };

  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(`\n✅ Analysis saved to: ${outputPath}`);
}

if (require.main === module) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}