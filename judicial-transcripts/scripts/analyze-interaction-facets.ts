#!/usr/bin/env npx ts-node

import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import Anthropic from '@anthropic-ai/sdk';

dotenv.config();

interface InteractionData {
  interactionId: number;
  startStatementId: number;
  endStatementId: number;
  participantCount: number;
  duration: number;
  statements: Array<{
    id: number;
    speaker: string;
    role: string;
    text: string;
  }>;
}

interface FacetAnalysis {
  interactionId: number;
  startStatementId: number;
  endStatementId: number;
  primaryCategory: string;
  subcategories: string[];
  emotions: Array<{
    speaker: string;
    role: string;
    emotion: string;
    intensity: 'mild' | 'moderate' | 'strong';
    confidence: number;
  }>;
  facets: Record<string, any>;
  keyPhrases: string[];
  suggestedPatterns: Array<{
    pattern: string;
    facetName: string;
    facetValue: string;
    examples: string[];
  }>;
}

class InteractionFacetAnalyzer {
  private anthropic: Anthropic;

  constructor(apiKey: string) {
    this.anthropic = new Anthropic({ apiKey });
  }

  private createAnalysisPrompt(interaction: InteractionData): string {
    const speakerText = interaction.statements
      .map(s => `${s.role} ${s.speaker}: ${s.text}`)
      .join('\n');

    return `Analyze this IP litigation transcript interaction and extract detailed facets.

INTERACTION TEXT:
${speakerText}

Identify and categorize:

1. PRIMARY CATEGORY (choose one):
   - Objection
   - Exhibit_Handling
   - Video_Deposition
   - Witness_Transition
   - Court_Management
   - Time_Management
   - Professional_Conduct
   - Technical_Issue
   - Examination_Phase
   - Other

2. SUBCATEGORIES (all that apply):
   List specific subcategories relevant to the primary category

3. EMOTIONS for each speaker:
   - Emotion type (frustrated, patient, aggressive, conciliatory, confused, confident, etc.)
   - Intensity (mild, moderate, strong)
   - Confidence score (0-1)
   - Include specific phrases that indicate the emotion

4. SPECIFIC FACETS based on category:
   For Objections: type of objection, ruling, basis
   For Exhibit_Handling: action taken, exhibit reference, any issues
   For Video_Deposition: start/stop, timestamps mentioned, objections
   For Witness_Transition: type of transition, who's taking witness
   For Court_Management: specific action (recess, jury management, sidebar)
   For Professional_Conduct: apologies, admissions, warnings

5. KEY PHRASES that could be used as patterns for automated detection

6. SUGGESTED SEARCH PATTERNS for finding similar interactions

Return as JSON with this structure:
{
  "primaryCategory": "string",
  "subcategories": ["array"],
  "emotions": [{
    "speaker": "string",
    "role": "string",
    "emotion": "string",
    "intensity": "mild|moderate|strong",
    "confidence": number,
    "indicators": ["phrases that show emotion"]
  }],
  "facets": {
    // Category-specific facets
  },
  "keyPhrases": ["important phrases"],
  "suggestedPatterns": [{
    "pattern": "regex or keyword pattern",
    "facetName": "string",
    "facetValue": "string",
    "examples": ["matching phrases from text"]
  }]
}`;
  }

  async analyzeInteraction(interaction: InteractionData): Promise<FacetAnalysis> {
    try {
      const prompt = this.createAnalysisPrompt(interaction);

      const response = await this.anthropic.messages.create({
        model: 'claude-3-haiku-20240307',
        max_tokens: 1500,
        temperature: 0.3,
        messages: [{
          role: 'user',
          content: prompt
        }]
      });

      const content = response.content[0];
      if (content.type === 'text') {
        const jsonMatch = content.text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const analysis = JSON.parse(jsonMatch[0]);
          return {
            interactionId: interaction.interactionId,
            startStatementId: interaction.startStatementId,
            endStatementId: interaction.endStatementId,
            ...analysis
          };
        }
      }

      throw new Error('Failed to parse LLM response');
    } catch (error) {
      console.error(`Error analyzing interaction ${interaction.interactionId}:`, error);
      throw error;
    }
  }

  async analyzeFile(filePath: string, options: {
    sampleSize?: number;
    outputPath?: string;
    minDuration?: number;
  } = {}): Promise<void> {
    console.log(`\nAnalyzing interactions from: ${filePath}`);

    const content = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(content);

    // Handle different data formats
    let interactions: InteractionData[] = [];

    if (data.hierarchy) {
      // Convert hierview format to InteractionData format
      interactions = data.hierarchy.map((item: any) => {
        const statements = item.section?.metadata?.statements || [];
        return {
          interactionId: item.section?.id || 0,
          startStatementId: statements[0]?.statementId || 0,
          endStatementId: statements[statements.length - 1]?.statementId || 0,
          participantCount: item.section?.metadata?.matches?.[1]?.count || 2,
          duration: statements.length,
          statements: statements.map((s: any) => ({
            id: s.statementId,
            speaker: s.speakerHandle,
            role: s.speakerType,
            text: s.text
          }))
        };
      });
    } else {
      interactions = data.interactions || data;
    }

    if (options.minDuration !== undefined) {
      const minDur = options.minDuration;
      interactions = interactions.filter(i => i.duration >= minDur);
    }

    if (options.sampleSize && interactions.length > options.sampleSize) {
      interactions = this.sampleInteractions(interactions, options.sampleSize);
    }

    console.log(`Processing ${interactions.length} interactions...`);

    const results: FacetAnalysis[] = [];
    const patternSummary: Record<string, Set<string>> = {};
    const emotionSummary: Record<string, number> = {};

    for (let i = 0; i < interactions.length; i++) {
      console.log(`  [${i + 1}/${interactions.length}] Analyzing interaction ${interactions[i].interactionId}...`);

      try {
        const analysis = await this.analyzeInteraction(interactions[i]);
        results.push(analysis);

        if (!patternSummary[analysis.primaryCategory]) {
          patternSummary[analysis.primaryCategory] = new Set();
        }
        analysis.keyPhrases.forEach(phrase => {
          patternSummary[analysis.primaryCategory].add(phrase);
        });

        analysis.emotions.forEach(e => {
          const key = `${e.role}_${e.emotion}`;
          emotionSummary[key] = (emotionSummary[key] || 0) + 1;
        });

        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (error) {
        console.error(`    Failed to analyze interaction: ${error}`);
      }
    }

    const summary = {
      totalAnalyzed: results.length,
      categoryDistribution: this.getCategoryDistribution(results),
      emotionDistribution: emotionSummary,
      commonPatterns: this.extractCommonPatterns(results),
      suggestedAccumulators: this.generateAccumulatorSuggestions(results),
      detailedResults: results
    };

    const outputPath = options.outputPath || filePath.replace(/\.json$/, '-facet-analysis.json');
    fs.writeFileSync(outputPath, JSON.stringify(summary, null, 2));

    console.log(`\n✅ Analysis complete!`);
    console.log(`   Output saved to: ${outputPath}`);
    this.printSummary(summary);
  }

  private sampleInteractions(interactions: InteractionData[], sampleSize: number): InteractionData[] {
    const sorted = [...interactions].sort((a, b) => b.duration - a.duration);
    const longInteractions = sorted.slice(0, Math.floor(sampleSize * 0.6));

    const remaining = interactions.filter(i => !longInteractions.includes(i));
    const randomSample = [];
    for (let i = 0; i < Math.floor(sampleSize * 0.4) && remaining.length > 0; i++) {
      const idx = Math.floor(Math.random() * remaining.length);
      randomSample.push(remaining.splice(idx, 1)[0]);
    }

    return [...longInteractions, ...randomSample];
  }

  private getCategoryDistribution(results: FacetAnalysis[]): Record<string, number> {
    const dist: Record<string, number> = {};
    results.forEach(r => {
      dist[r.primaryCategory] = (dist[r.primaryCategory] || 0) + 1;
    });
    return dist;
  }

  private extractCommonPatterns(results: FacetAnalysis[]): Record<string, string[]> {
    const patterns: Record<string, Set<string>> = {};

    results.forEach(r => {
      r.suggestedPatterns.forEach(p => {
        const key = `${p.facetName}:${p.facetValue}`;
        if (!patterns[key]) patterns[key] = new Set();
        patterns[key].add(p.pattern);
      });
    });

    const commonPatterns: Record<string, string[]> = {};
    Object.entries(patterns).forEach(([key, set]) => {
      if (set.size >= 2) {
        commonPatterns[key] = Array.from(set).slice(0, 5);
      }
    });

    return commonPatterns;
  }

  private generateAccumulatorSuggestions(results: FacetAnalysis[]): any[] {
    const suggestions: any[] = [];

    const categoryGroups = new Map<string, FacetAnalysis[]>();
    results.forEach(r => {
      if (!categoryGroups.has(r.primaryCategory)) {
        categoryGroups.set(r.primaryCategory, []);
      }
      categoryGroups.get(r.primaryCategory)!.push(r);
    });

    categoryGroups.forEach((group, category) => {
      const patterns = new Set<string>();
      const facetValues = new Map<string, Set<string>>();

      group.forEach(item => {
        item.keyPhrases.forEach(phrase => patterns.add(phrase));
        item.suggestedPatterns.forEach(p => {
          if (!facetValues.has(p.facetName)) {
            facetValues.set(p.facetName, new Set());
          }
          facetValues.get(p.facetName)!.add(p.facetValue);
        });
      });

      if (patterns.size > 0) {
        suggestions.push({
          name: `${category.toLowerCase()}_detector`,
          category: category,
          primaryPatterns: Array.from(patterns).slice(0, 10),
          facets: Array.from(facetValues.entries()).map(([name, values]) => ({
            facetName: name,
            possibleValues: Array.from(values)
          })),
          exampleCount: group.length
        });
      }
    });

    return suggestions;
  }

  private printSummary(summary: any): void {
    console.log('\n📊 ANALYSIS SUMMARY');
    console.log('=' .repeat(50));

    console.log('\n📁 Categories Found:');
    Object.entries(summary.categoryDistribution)
      .sort((a, b) => (b[1] as number) - (a[1] as number))
      .forEach(([cat, count]) => {
        console.log(`   ${cat}: ${count} interactions`);
      });

    console.log('\n😊 Top Emotions Detected:');
    Object.entries(summary.emotionDistribution)
      .sort((a, b) => (b[1] as number) - (a[1] as number))
      .slice(0, 10)
      .forEach(([emotion, count]) => {
        console.log(`   ${emotion}: ${count} occurrences`);
      });

    console.log('\n🔍 Suggested Accumulators:');
    summary.suggestedAccumulators.forEach((acc: any) => {
      console.log(`   - ${acc.name} (${acc.exampleCount} examples)`);
      console.log(`     Facets: ${acc.facets.map((f: any) => f.facetName).join(', ')}`);
    });

    console.log('\n💡 Common Patterns Found:');
    const patterns = Object.keys(summary.commonPatterns).slice(0, 5);
    patterns.forEach(pattern => {
      console.log(`   ${pattern}`);
    });
  }
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 1) {
    console.log('Usage: npx ts-node analyze-interaction-facets.ts <interaction-json-file> [options]');
    console.log('\nOptions:');
    console.log('  --sample-size <n>     Analyze only n interactions (default: all)');
    console.log('  --min-duration <n>    Only analyze interactions with duration >= n');
    console.log('  --output <path>       Output file path (default: input-facet-analysis.json)');
    console.log('\nExample:');
    console.log('  npx ts-node scripts/analyze-interaction-facets.ts output/hierview/01_Genband_int.json --sample-size 20');
    process.exit(1);
  }

  const filePath = args[0];
  if (!fs.existsSync(filePath)) {
    console.error(`Error: File not found: ${filePath}`);
    process.exit(1);
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('Error: ANTHROPIC_API_KEY environment variable not set');
    process.exit(1);
  }

  const options: any = {};
  for (let i = 1; i < args.length; i += 2) {
    const flag = args[i];
    const value = args[i + 1];

    switch (flag) {
      case '--sample-size':
        options.sampleSize = parseInt(value);
        break;
      case '--min-duration':
        options.minDuration = parseInt(value);
        break;
      case '--output':
        options.outputPath = value;
        break;
    }
  }

  const analyzer = new InteractionFacetAnalyzer(apiKey);
  await analyzer.analyzeFile(filePath, options);
}

if (require.main === module) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}