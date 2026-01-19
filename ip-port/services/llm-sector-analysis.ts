/**
 * Sector-Specific LLM Analysis Service
 *
 * Uses Claude Opus for high-quality sector-specific patent analysis.
 * Includes product-focused questions and within-sector ranking signals.
 *
 * Features:
 * - Model selection: Opus (high quality) vs Sonnet (cost-effective)
 * - Sector-specific prompts loaded from config files (config/sector-prompts/)
 * - Product identification for vendor handoff
 * - Within-sector competitive ranking
 * - Configurable prompts per sector for customization and versioning
 */

import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { ChatAnthropic } from '@langchain/anthropic';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { z } from 'zod';

dotenv.config();

// ES module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Path to sector prompts directory
const SECTOR_PROMPTS_DIR = path.join(__dirname, '../config/sector-prompts');

// Model options
export const MODELS = {
  opus: 'claude-opus-4-20250514',
  sonnet: 'claude-sonnet-4-20250514',
} as const;

export type ModelName = keyof typeof MODELS;

// Sector-specific analysis schema
const SectorAnalysisSchema = z.object({
  patent_id: z.string(),

  // Core assessment (inherited from V3)
  summary: z.string(),
  technical_solution: z.string(),

  // Legal viability
  eligibility_score: z.number().min(1).max(5),
  validity_score: z.number().min(1).max(5),
  claim_breadth: z.number().min(1).max(5),

  // Enforcement
  enforcement_clarity: z.number().min(1).max(5),
  design_around_difficulty: z.number().min(1).max(5),

  // SECTOR-SPECIFIC: Product focus
  specific_products: z.array(z.object({
    product_name: z.string(),
    company: z.string(),
    relevance: z.string(),
    evidence_type: z.string(),
  })),

  product_evidence_sources: z.array(z.string()),

  // SECTOR-SPECIFIC: Market intelligence
  revenue_model: z.string(),
  unit_volume_tier: z.string(),
  price_point_tier: z.string(),
  revenue_per_unit_estimate: z.string(),

  // SECTOR-SPECIFIC: Licensing context
  licensing_leverage_factors: z.array(z.string()),
  negotiation_strengths: z.array(z.string()),
  potential_objections: z.array(z.string()),

  // SECTOR-SPECIFIC: Within-sector ranking
  within_sector_rank_rationale: z.string(),
  litigation_grouping_candidates: z.array(z.string()),

  // Standards (sector-relevant)
  standards_relevance: z.string(),
  standards_bodies: z.array(z.string()),

  // Meta
  confidence: z.number().min(1).max(5),
});

export type SectorAnalysis = z.infer<typeof SectorAnalysisSchema>;

// Interface for sector prompt configuration (loaded from JSON files)
interface SectorPromptConfig {
  version: string;
  sector_id: string;
  display_name: string;
  created?: string;
  lastModified?: string;
  system_prompt_additions: string;
  key_products: string[];
  key_companies: string[];
  standards_focus: string[];
  technical_focus: string[];
  damages_tier?: string;
  market_size_notes?: string;
  licensing_context?: Record<string, any>;
}

// Cache for loaded sector configs
const sectorConfigCache: Map<string, SectorPromptConfig> = new Map();

/**
 * Load a sector prompt configuration from its JSON file
 */
function loadSectorConfig(sectorId: string): SectorPromptConfig | null {
  // Check cache first
  if (sectorConfigCache.has(sectorId)) {
    return sectorConfigCache.get(sectorId)!;
  }

  const configPath = path.join(SECTOR_PROMPTS_DIR, `${sectorId}.json`);

  if (!fs.existsSync(configPath)) {
    console.error(`Sector config not found: ${configPath}`);
    return null;
  }

  try {
    const configContent = fs.readFileSync(configPath, 'utf-8');
    const config: SectorPromptConfig = JSON.parse(configContent);

    // Cache the loaded config
    sectorConfigCache.set(sectorId, config);

    return config;
  } catch (error) {
    console.error(`Error loading sector config for ${sectorId}:`, error);
    return null;
  }
}

/**
 * Get all available sector IDs from the index file
 */
function loadAvailableSectors(): string[] {
  const indexPath = path.join(SECTOR_PROMPTS_DIR, 'index.json');

  if (!fs.existsSync(indexPath)) {
    console.error(`Sector index not found: ${indexPath}`);
    // Fallback: scan directory for JSON files
    if (fs.existsSync(SECTOR_PROMPTS_DIR)) {
      return fs.readdirSync(SECTOR_PROMPTS_DIR)
        .filter(f => f.endsWith('.json') && f !== 'index.json')
        .map(f => f.replace('.json', ''));
    }
    return [];
  }

  try {
    const indexContent = fs.readFileSync(indexPath, 'utf-8');
    const index = JSON.parse(indexContent);
    return index.availableSectors || [];
  } catch (error) {
    console.error('Error loading sector index:', error);
    return [];
  }
}

/**
 * Clear the sector config cache (useful for hot-reloading during development)
 */
export function clearSectorConfigCache(): void {
  sectorConfigCache.clear();
  console.log('Sector config cache cleared');
}

// Build sector-specific user prompt
function buildSectorUserPrompt(patent: any, config: SectorPromptConfig): string {
  return `Analyze this patent with a focus on the ${config.display_name} sector:

PATENT:
- ID: ${patent.patent_id}
- Title: ${patent.title}
- Abstract: ${patent.abstract || 'Not available'}
- CPC Codes: ${patent.cpc_codes?.join(', ') || 'Not available'}
- Grant Date: ${patent.grant_date || 'Unknown'}

SECTOR CONTEXT:
- Sector: ${config.display_name}
- Key Products: ${config.key_products.join(', ')}
- Key Companies: ${config.key_companies.join(', ')}
- Relevant Standards: ${config.standards_focus.join(', ')}
- Technical Focus Areas: ${config.technical_focus.join(', ')}

Provide a comprehensive analysis in JSON format:

{
  "patent_id": "${patent.patent_id}",
  "summary": "2-3 sentence summary for licensing discussions",
  "technical_solution": "Technical explanation of how it works",

  "eligibility_score": 1-5,
  "validity_score": 1-5,
  "claim_breadth": 1-5,
  "enforcement_clarity": 1-5,
  "design_around_difficulty": 1-5,

  "specific_products": [
    {
      "product_name": "Specific named product (e.g., 'Apple iPhone 15 Pro')",
      "company": "Company name",
      "relevance": "Why this product likely implements the patent",
      "evidence_type": "public_documentation|product_features|technical_specs|teardown_reports"
    }
  ],

  "product_evidence_sources": [
    "Where to find evidence: datasheets, teardown reports, FCC filings, etc."
  ],

  "revenue_model": "subscription|hardware_sale|licensing|freemium|enterprise",
  "unit_volume_tier": "<1M|1M-10M|10M-100M|100M-1B|>1B",
  "price_point_tier": "<$10|$10-100|$100-1000|$1000-10000|>$10000",
  "revenue_per_unit_estimate": "Estimate of patent-relevant component value",

  "licensing_leverage_factors": [
    "Factors that strengthen licensing position"
  ],
  "negotiation_strengths": [
    "Strengths for negotiation"
  ],
  "potential_objections": [
    "Objections a licensee might raise"
  ],

  "within_sector_rank_rationale": "Why this patent ranks high/low within the sector",
  "litigation_grouping_candidates": [
    "Other patent IDs that could be litigated together"
  ],

  "standards_relevance": "none|related|likely_essential|declared_essential",
  "standards_bodies": ["Relevant standards bodies"],

  "confidence": 1-5
}

List 5-10 SPECIFIC products with real product names. Focus on the ${config.display_name} sector.`;
}

export interface AnalysisOptions {
  model?: ModelName;
  batchSize?: number;
  rateLimitMs?: number;
}

export class SectorLLMAnalyzer {
  private model: ChatAnthropic;
  private sectorConfig: SectorPromptConfig;
  private outputDir: string;

  constructor(
    sector: string,
    options: AnalysisOptions = {}
  ) {
    const modelName = options.model || 'sonnet';
    const modelId = MODELS[modelName];

    // Load sector config from JSON file
    const config = loadSectorConfig(sector);
    if (!config) {
      const available = loadAvailableSectors();
      throw new Error(`Sector "${sector}" not configured. Available: ${available.join(', ')}`);
    }

    this.sectorConfig = config;
    this.outputDir = `./output/sector-analysis/${sector}`;

    this.model = new ChatAnthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      model: modelId,
      temperature: 0.2,
      maxTokens: 6000,
    });

    console.log(`Initialized ${sector} analyzer with model: ${modelName} (${modelId})`);
    console.log(`  Config version: ${config.version}, last modified: ${config.lastModified || 'unknown'}`);

    // Ensure output directory exists
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }
  }

  async analyzePatent(patent: any): Promise<SectorAnalysis | null> {
    const systemPrompt = `You are a patent analysis expert specializing in the ${this.sectorConfig.display_name} sector.

${this.sectorConfig.system_prompt_additions}

Your analysis should:
1. Identify SPECIFIC named products (not generic categories)
2. Provide actionable intelligence for licensing negotiations
3. Assess within-sector competitive position
4. Identify litigation grouping opportunities

Always return valid JSON matching the requested schema.`;

    const userPrompt = buildSectorUserPrompt(patent, this.sectorConfig);

    try {
      const response = await this.model.invoke([
        new SystemMessage(systemPrompt),
        new HumanMessage(userPrompt)
      ]);

      const content = response.content as string;
      const jsonMatch = content.match(/\{[\s\S]*\}/);

      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return SectorAnalysisSchema.parse(parsed);
      }

      console.error(`Failed to extract JSON for patent ${patent.patent_id}`);
      return null;
    } catch (error) {
      console.error(`Error analyzing patent ${patent.patent_id}:`, error);
      return null;
    }
  }

  async analyzeBatch(
    patents: any[],
    options: { saveProgress?: boolean; rateLimitMs?: number } = {}
  ): Promise<SectorAnalysis[]> {
    const results: SectorAnalysis[] = [];
    const rateLimitMs = options.rateLimitMs || 2000;

    for (let i = 0; i < patents.length; i++) {
      const patent = patents[i];
      console.log(`[${i + 1}/${patents.length}] Analyzing ${patent.patent_id}: ${patent.title?.substring(0, 50)}...`);

      const analysis = await this.analyzePatent(patent);

      if (analysis) {
        results.push(analysis);
        console.log(`   ✓ Found ${analysis.specific_products.length} products, confidence: ${analysis.confidence}`);

        // Save progress
        if (options.saveProgress) {
          const progressPath = path.join(this.outputDir, `progress-${new Date().toISOString().split('T')[0]}.json`);
          fs.writeFileSync(progressPath, JSON.stringify(results, null, 2));
        }
      } else {
        console.log(`   ✗ Analysis failed`);
      }

      // Rate limiting
      if (i < patents.length - 1) {
        await new Promise(resolve => setTimeout(resolve, rateLimitMs));
      }
    }

    return results;
  }

  saveResults(results: SectorAnalysis[], filename?: string): string {
    const timestamp = new Date().toISOString().split('T')[0];
    const outputPath = path.join(
      this.outputDir,
      filename || `${this.sectorConfig.sector_id}-analysis-${timestamp}.json`
    );

    const output = {
      sector: this.sectorConfig.sector_id,
      sector_name: this.sectorConfig.display_name,
      total_patents: results.length,
      analyses: results,
      generated_at: new Date().toISOString()
    };

    fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
    return outputPath;
  }
}

// Export available sectors (loaded from config files)
export function getAvailableSectors(): string[] {
  return loadAvailableSectors();
}

export function getSectorConfig(sector: string): SectorPromptConfig | undefined {
  return loadSectorConfig(sector) || undefined;
}

/**
 * Reload all sector configs (useful for development/testing)
 */
export function reloadSectorConfigs(): void {
  clearSectorConfigCache();
  const sectors = loadAvailableSectors();
  console.log(`Reloaded ${sectors.length} sector configurations`);
}
