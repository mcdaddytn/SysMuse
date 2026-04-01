/**
 * Formula Generator Service
 *
 * Reads scoring template JSON files and produces FormulaStructure
 * with grouped terms organized by taxonomy level.
 *
 * Each taxonomy level's questions form a separate GroupTerm:
 * - Portfolio group: base 7 LLM questions + quantitative + API metrics
 * - Super-sector group: only NEW fieldNames introduced at super-sector level
 * - Sector group: only NEW fieldNames introduced at sector level
 * - Sub-sector group: only NEW fieldNames introduced at sub-sector level
 *
 * Questions with the same fieldName as portfolio (re-weighted/annotated) stay in portfolio group.
 */

import { PrismaClient } from '@prisma/client';
import {
  metricTerm,
  groupTerm,
  linearScaling,
  sqrtScaling,
  rangeScaling,
} from './formula-engine.js';
import type {
  FormulaStructure,
  FormulaTerm,
  MetricTerm,
  GroupTerm,
  SparseHandling,
} from './formula-types.js';
import {
  loadPortfolioDefaultTemplate,
  loadSuperSectorTemplates,
  loadSectorTemplates,
} from './scoring-template-service.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const prisma = new PrismaClient();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CONFIG_DIR = path.resolve(__dirname, '../../../config/scoring-templates');

// =============================================================================
// Template question extraction
// =============================================================================

interface TemplateQuestion {
  fieldName: string;
  displayName: string;
  weight: number;
  scale?: { min: number; max: number };
  answerType: string;
}

/**
 * Extract weighted numeric questions from a template's questions array.
 */
function extractNumericQuestions(questions: any[]): TemplateQuestion[] {
  return questions
    .filter((q: any) => q.answerType === 'numeric' && q.scale)
    .map((q: any) => ({
      fieldName: q.fieldName,
      displayName: q.displayName,
      weight: q.weight,
      scale: q.scale,
      answerType: q.answerType,
    }));
}

/**
 * Find fieldNames that are NEW at a given level (not present in any parent level).
 */
function findNewFieldNames(
  levelQuestions: TemplateQuestion[],
  parentFieldNames: Set<string>,
): TemplateQuestion[] {
  return levelQuestions.filter(q => !parentFieldNames.has(q.fieldName));
}

/**
 * Apply default equal weights to questions that have weight=0 or undefined.
 * If ALL questions at a level lack weights, assign 1/N to each.
 * If SOME have explicit weights and some don't, the weightless ones get
 * equal share of the remaining weight (1 - sum_of_explicit) / count_of_weightless.
 */
function applyDefaultEqualWeights(questions: TemplateQuestion[]): TemplateQuestion[] {
  if (questions.length === 0) return questions;

  const hasWeight = questions.filter(q => q.weight > 0);
  const noWeight = questions.filter(q => !q.weight || q.weight <= 0);

  if (noWeight.length === 0) return questions; // All have explicit weights

  if (hasWeight.length === 0) {
    // All lack weights — assign equal 1/N
    const equalWeight = 1 / questions.length;
    return questions.map(q => ({ ...q, weight: equalWeight }));
  }

  // Some have weights, some don't — give weightless ones equal share of remainder
  const explicitSum = hasWeight.reduce((s, q) => s + q.weight, 0);
  const remainder = Math.max(0, 1 - explicitSum);
  const perQuestion = noWeight.length > 0 ? remainder / noWeight.length : 0;

  return questions.map(q => {
    if (!q.weight || q.weight <= 0) {
      return { ...q, weight: perQuestion };
    }
    return q;
  });
}

/**
 * Build MetricTerms for LLM questions (1-10 scale by default).
 */
function buildLlmTerms(questions: TemplateQuestion[]): MetricTerm[] {
  return questions.map(q =>
    metricTerm(q.fieldName, rangeScaling(q.scale?.min ?? 1, q.scale?.max ?? 10), {
      displayName: q.displayName,
    })
  );
}

// =============================================================================
// Portfolio group builder
// =============================================================================

/**
 * Build the portfolio group containing:
 * - Base LLM questions (7 weighted numeric from portfolio-default)
 * - Quantitative metrics (citations, years, etc.)
 * - API metrics (IPR, prosecution — sparse)
 */
function buildPortfolioGroup(portfolioQuestions: TemplateQuestion[]): GroupTerm {
  const terms: FormulaTerm[] = [
    // Quantitative metrics
    metricTerm('competitor_citations', linearScaling(20), { displayName: 'Competitor Citations' }),
    metricTerm('adjusted_forward_citations', sqrtScaling(900), { displayName: 'Adjusted Forward Citations' }),
    metricTerm('years_remaining', linearScaling(15), { displayName: 'Years Remaining' }),
    metricTerm('competitor_count', linearScaling(5), { displayName: 'Competitor Count' }),
    metricTerm('competitor_density', linearScaling(1), { displayName: 'Competitor Density' }),
    // API metrics (sparse)
    metricTerm('ipr_risk_score', rangeScaling(1, 5), { sparseGroup: 'api', displayName: 'IPR Risk Score' }),
    metricTerm('prosecution_quality_score', rangeScaling(1, 5), { sparseGroup: 'api', displayName: 'Prosecution Quality' }),
    // Portfolio LLM questions
    ...buildLlmTerms(portfolioQuestions),
  ];

  return groupTerm('portfolio', terms, {
    weightKey: 'g_portfolio',
    sparseHandling: 'renormalize',
  });
}

// =============================================================================
// Main generator
// =============================================================================

export interface GeneratedFormula {
  structure: FormulaStructure;
  defaultWeights: Record<string, number>;
  groupInfo: Array<{ name: string; weightKey: string; termCount: number; level: string }>;
}

/**
 * Generate a FormulaStructure with grouped terms for a given taxonomy scope.
 *
 * @param scopeType  The taxonomy level to generate for
 * @param superSectorName  Super-sector name (e.g., "WIRELESS")
 * @param sectorName  Sector name (e.g., "rf-acoustic") — required for SECTOR and SUB_SECTOR
 * @param subSectorName  Sub-sector template id (e.g., "amplifiers") — required for SUB_SECTOR
 */
export function generateFormulaForScope(
  scopeType: 'SUPER_SECTOR' | 'SECTOR' | 'SUB_SECTOR',
  superSectorName: string,
  sectorName?: string,
  subSectorName?: string,
): GeneratedFormula {
  // 1. Load portfolio template
  const portfolioTemplate = loadPortfolioDefaultTemplate();
  const portfolioQuestions = extractNumericQuestions(portfolioTemplate.questions)
    .filter(q => q.weight > 0); // Only include weighted questions
  const portfolioFieldNames = new Set(
    extractNumericQuestions(portfolioTemplate.questions).map(q => q.fieldName)
  );

  // 2. Load super-sector template
  const superSectorTemplates = loadSuperSectorTemplates();
  const superSectorTemplate = superSectorTemplates.get(superSectorName);
  const superSectorQuestions = superSectorTemplate
    ? extractNumericQuestions(superSectorTemplate.questions)
    : [];
  const superNewQuestionsRaw = findNewFieldNames(superSectorQuestions, portfolioFieldNames);
  const superNewQuestions = applyDefaultEqualWeights(superNewQuestionsRaw);
  const superFieldNames = new Set(superNewQuestions.map(q => q.fieldName));

  // 3. Load sector template (if applicable)
  let sectorNewQuestions: TemplateQuestion[] = [];
  const sectorFieldNames = new Set<string>();
  if (sectorName && (scopeType === 'SECTOR' || scopeType === 'SUB_SECTOR')) {
    const sectorTemplates = loadSectorTemplates();
    const sectorTemplate = sectorTemplates.get(sectorName);
    if (sectorTemplate) {
      const sectorQuestions = extractNumericQuestions(sectorTemplate.questions);
      const parentFields = new Set([...portfolioFieldNames, ...superFieldNames]);
      sectorNewQuestions = applyDefaultEqualWeights(findNewFieldNames(sectorQuestions, parentFields));
      for (const q of sectorNewQuestions) sectorFieldNames.add(q.fieldName);
    }
  }

  // 4. Load sub-sector template (if applicable)
  let subSectorNewQuestions: TemplateQuestion[] = [];
  if (subSectorName && scopeType === 'SUB_SECTOR') {
    const subSectorPath = path.join(CONFIG_DIR, 'sub-sectors', `${subSectorName}.json`);
    if (fs.existsSync(subSectorPath)) {
      const subSectorTemplate = JSON.parse(fs.readFileSync(subSectorPath, 'utf-8'));
      const subSectorQuestions = extractNumericQuestions(subSectorTemplate.questions);
      const parentFields = new Set([...portfolioFieldNames, ...superFieldNames, ...sectorFieldNames]);
      subSectorNewQuestions = applyDefaultEqualWeights(findNewFieldNames(subSectorQuestions, parentFields));
    }
  }

  // 5. Build grouped formula structure
  const terms: FormulaTerm[] = [];
  const defaultWeights: Record<string, number> = {};
  const groupInfo: GeneratedFormula['groupInfo'] = [];

  // Portfolio group (always present)
  const portfolioGroup = buildPortfolioGroup(portfolioQuestions);
  terms.push(portfolioGroup);
  defaultWeights['g_portfolio'] = 0.80;
  // Set default within-group weights
  for (const q of portfolioQuestions) {
    defaultWeights[q.fieldName] = q.weight;
  }
  // Quantitative defaults
  defaultWeights['competitor_citations'] = 0.20;
  defaultWeights['adjusted_forward_citations'] = 0.10;
  defaultWeights['years_remaining'] = 0.15;
  defaultWeights['competitor_count'] = 0.05;
  defaultWeights['competitor_density'] = 0.05;
  defaultWeights['ipr_risk_score'] = 0.05;
  defaultWeights['prosecution_quality_score'] = 0.05;
  groupInfo.push({
    name: 'portfolio',
    weightKey: 'g_portfolio',
    termCount: portfolioGroup.terms.length,
    level: 'portfolio',
  });

  // Super-sector group (if new questions exist)
  if (superNewQuestions.length > 0) {
    const ssGroup = groupTerm(`ss_${superSectorName.toLowerCase()}`, buildLlmTerms(superNewQuestions), {
      weightKey: `g_super_sector`,
      sparseHandling: 'zero',
    });
    terms.push(ssGroup);
    defaultWeights['g_super_sector'] = 0.10;
    for (const q of superNewQuestions) {
      defaultWeights[q.fieldName] = q.weight;
    }
    groupInfo.push({
      name: `ss_${superSectorName.toLowerCase()}`,
      weightKey: 'g_super_sector',
      termCount: superNewQuestions.length,
      level: 'super_sector',
    });
  }

  // Sector group (if new questions exist)
  if (sectorNewQuestions.length > 0) {
    const secGroup = groupTerm(`sec_${sectorName}`, buildLlmTerms(sectorNewQuestions), {
      weightKey: 'g_sector',
      sparseHandling: 'zero',
    });
    terms.push(secGroup);
    defaultWeights['g_sector'] = 0.05;
    for (const q of sectorNewQuestions) {
      defaultWeights[q.fieldName] = q.weight;
    }
    groupInfo.push({
      name: `sec_${sectorName}`,
      weightKey: 'g_sector',
      termCount: sectorNewQuestions.length,
      level: 'sector',
    });
  }

  // Sub-sector group (if new questions exist)
  if (subSectorNewQuestions.length > 0) {
    const subGroup = groupTerm(`sub_${subSectorName}`, buildLlmTerms(subSectorNewQuestions), {
      weightKey: 'g_sub_sector',
      sparseHandling: 'zero',
    });
    terms.push(subGroup);
    defaultWeights['g_sub_sector'] = 0.05;
    for (const q of subSectorNewQuestions) {
      defaultWeights[q.fieldName] = q.weight;
    }
    groupInfo.push({
      name: `sub_${subSectorName}`,
      weightKey: 'g_sub_sector',
      termCount: subSectorNewQuestions.length,
      level: 'sub_sector',
    });
  }

  // Normalize group weights to sum to 1.0
  const groupWeightKeys = groupInfo.map(g => g.weightKey);
  const groupWeightSum = groupWeightKeys.reduce((sum, k) => sum + (defaultWeights[k] ?? 0), 0);
  if (groupWeightSum > 0 && Math.abs(groupWeightSum - 1.0) > 0.001) {
    for (const k of groupWeightKeys) {
      defaultWeights[k] = Math.round((defaultWeights[k] / groupWeightSum) * 100) / 100;
    }
  }

  const structure: FormulaStructure = {
    version: 1,
    outputScale: 100,
    terms,
    multipliers: [
      {
        attribute: 'years_remaining',
        fn: 'linear_floor',
        params: { floor: 0.3, ceiling: 1.0, scale: 15, exponent: 0.8 },
      },
    ],
    sparseHandling: 'zero', // Top-level default; groups override individually
  };

  return { structure, defaultWeights, groupInfo };
}

// =============================================================================
// On-demand formula persistence
// =============================================================================

/**
 * Get or create a FormulaDefinition for a given taxonomy scope.
 * Checks DB first; if not found, generates and persists.
 */
export async function getOrCreateFormula(
  scopeType: 'SUPER_SECTOR' | 'SECTOR' | 'SUB_SECTOR',
  scopeId: string,
  superSectorName: string,
  sectorName?: string,
  subSectorName?: string,
): Promise<{ formulaId: string; isNew: boolean }> {
  const name = `taxonomy-${scopeType.toLowerCase()}-${scopeId}`;

  // Check if formula already exists
  const existing = await prisma.formulaDefinition.findFirst({
    where: { name, isActive: true },
  });

  if (existing) {
    return { formulaId: existing.id, isNew: false };
  }

  // Generate formula
  const generated = generateFormulaForScope(scopeType, superSectorName, sectorName, subSectorName);

  // Build display name
  const displayParts = [superSectorName];
  if (sectorName) displayParts.push(sectorName);
  if (subSectorName) displayParts.push(subSectorName);
  const displayName = `${scopeType.replace('_', ' ')} Score: ${displayParts.join(' > ')}`;

  // Create FormulaDefinition
  const formula = await prisma.formulaDefinition.create({
    data: {
      name,
      displayName,
      description: `Auto-generated taxonomy formula for ${displayParts.join(' > ')}. Groups: ${generated.groupInfo.map(g => `${g.name}(${g.termCount})`).join(', ')}.`,
      scopeType: scopeType === 'SUPER_SECTOR' ? 'TAXONOMY_LEVEL1' : scopeType === 'SECTOR' ? 'TAXONOMY_LEVEL2' : 'TAXONOMY_LEVEL3',
      scopeId,
      structure: generated.structure as any,
      version: 1,
    },
  });

  // Create default weight profile
  await prisma.weightProfile.create({
    data: {
      name: 'default',
      description: `Default weights for ${displayName}`,
      scopeType: 'GLOBAL',
      weights: generated.defaultWeights,
      isDefault: true,
      isBuiltIn: true,
      isActive: true,
      formulaDefId: formula.id,
    },
  });

  return { formulaId: formula.id, isNew: true };
}

/**
 * List available taxonomy scopes that can have formulas generated.
 * Returns super-sectors, sectors with their super-sector, and sub-sectors with their lineage.
 */
export function listAvailableScopes(): {
  superSectors: string[];
  sectors: Array<{ name: string; superSector: string }>;
  subSectors: Array<{ name: string; sector: string; superSector: string }>;
} {
  const superSectorTemplates = loadSuperSectorTemplates();
  const sectorTemplates = loadSectorTemplates();

  const superSectors = Array.from(superSectorTemplates.keys());

  const sectors: Array<{ name: string; superSector: string }> = [];
  for (const [sectorName, template] of sectorTemplates) {
    // Determine super-sector from inheritsFrom chain
    const inheritsFrom = template.inheritsFrom;
    const ssTemplate = inheritsFrom ? superSectorTemplates.get(inheritsFrom.toUpperCase()) : null;
    const superSector = ssTemplate?.superSectorName ?? template.superSectorName ?? 'UNKNOWN';
    sectors.push({ name: sectorName, superSector });
  }

  // Sub-sectors from config files
  const subSectors: Array<{ name: string; sector: string; superSector: string }> = [];
  const subSectorsDir = path.join(CONFIG_DIR, 'sub-sectors');
  if (fs.existsSync(subSectorsDir)) {
    const files = fs.readdirSync(subSectorsDir).filter(f => f.endsWith('.json'));
    for (const file of files) {
      const template = JSON.parse(fs.readFileSync(path.join(subSectorsDir, file), 'utf-8'));
      const sectorMatch = sectors.find(s => s.name === template.inheritsFrom || s.name === template.sectorName);
      subSectors.push({
        name: template.id,
        sector: sectorMatch?.name ?? template.inheritsFrom ?? 'unknown',
        superSector: sectorMatch?.superSector ?? 'UNKNOWN',
      });
    }
  }

  return { superSectors, sectors, subSectors };
}
