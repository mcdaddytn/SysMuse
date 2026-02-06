/**
 * Scoring Template Service
 *
 * Manages hierarchical scoring templates with inheritance.
 * Templates flow down: Super-Sector → Sector → Sub-Sector
 *
 * Key Features:
 * - Template inheritance with question-level overrides
 * - Effective template resolution for any sub-sector
 * - Score calculation and normalization
 * - Ranking within sub-sector and sector
 * - JSON config file support for version-controlled templates
 */

import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// ES module __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const prisma = new PrismaClient();

// ============================================================================
// Types
// ============================================================================

export interface ScoringQuestion {
  fieldName: string;           // e.g., "technical_complexity"
  displayName: string;         // e.g., "Technical Complexity"
  question: string;            // The prompt question for LLM
  answerType: 'numeric' | 'categorical' | 'text';
  scale?: { min: number; max: number };  // For numeric
  options?: string[];          // For categorical
  weight: number;              // Default weight (0-1)
  requiresReasoning: boolean;
  reasoningPrompt?: string;
}

export interface MetricScore {
  score: number;
  reasoning: string;
  confidence?: number;
}

export interface EffectiveTemplate {
  templateId: string;
  templateName: string;
  questions: ScoringQuestion[];
  inheritanceChain: string[];  // Template IDs from most specific to base
  level: 'sub_sector' | 'sector' | 'super_sector' | 'portfolio';
}

export interface ScoreCalculationResult {
  patentId: string;
  subSectorId: string;
  metrics: Record<string, MetricScore>;
  compositeScore: number;
  templateId: string;
  templateVersion: number;
}

// ============================================================================
// Template Resolution (with Inheritance)
// ============================================================================

/**
 * Resolve the effective template for a sub-sector.
 * Walks up the hierarchy: sub-sector → sector → super-sector → portfolio default
 * Questions are merged, with more specific levels overriding inherited ones.
 */
export async function resolveEffectiveTemplate(
  subSectorId: string
): Promise<EffectiveTemplate | null> {
  // Get sub-sector with sector and super-sector info
  const subSector = await prisma.subSector.findUnique({
    where: { id: subSectorId },
    include: {
      sector: {
        include: {
          superSector: true
        }
      }
    }
  });

  if (!subSector) return null;

  const sectorId = subSector.sectorId;
  const superSectorId = subSector.sector.superSectorId;

  // Find templates at each level (most specific first)
  const templates = await prisma.scoringTemplate.findMany({
    where: {
      isActive: true,
      OR: [
        { subSectorId },
        { sectorId, subSectorId: null },
        { superSectorId, sectorId: null, subSectorId: null },
        { superSectorId: null, sectorId: null, subSectorId: null, isDefault: true }
      ]
    },
    orderBy: { createdAt: 'asc' }
  });

  if (templates.length === 0) return null;

  // Sort by specificity: sub-sector > sector > super-sector > portfolio
  const prioritized = templates.sort((a, b) => {
    const scoreA = (a.subSectorId ? 3 : 0) + (a.sectorId ? 2 : 0) + (a.superSectorId ? 1 : 0);
    const scoreB = (b.subSectorId ? 3 : 0) + (b.sectorId ? 2 : 0) + (b.superSectorId ? 1 : 0);
    return scoreB - scoreA;  // Higher specificity first
  });

  // Merge questions from least specific to most specific
  const mergedQuestions = new Map<string, ScoringQuestion>();
  const inheritanceChain: string[] = [];

  // Process from base to most specific
  for (let i = prioritized.length - 1; i >= 0; i--) {
    const template = prioritized[i];
    inheritanceChain.push(template.id);

    const questions = (template.questions as ScoringQuestion[]) || [];
    for (const q of questions) {
      mergedQuestions.set(q.fieldName, q);  // Override with more specific
    }
  }

  // Determine level of most specific template
  const mostSpecific = prioritized[0];
  let level: 'sub_sector' | 'sector' | 'super_sector' | 'portfolio';
  if (mostSpecific.subSectorId) {
    level = 'sub_sector';
  } else if (mostSpecific.sectorId) {
    level = 'sector';
  } else if (mostSpecific.superSectorId) {
    level = 'super_sector';
  } else {
    level = 'portfolio';
  }

  return {
    templateId: mostSpecific.id,
    templateName: mostSpecific.name,
    questions: Array.from(mergedQuestions.values()),
    inheritanceChain: inheritanceChain.reverse(),
    level
  };
}

/**
 * Get template by ID with resolved inheritance chain
 */
export async function getTemplateWithInheritance(
  templateId: string
): Promise<{ template: any; inheritedQuestions: ScoringQuestion[] } | null> {
  const template = await prisma.scoringTemplate.findUnique({
    where: { id: templateId },
    include: { inheritsFrom: true }
  });

  if (!template) return null;

  // Walk up inheritance chain
  const inheritedQuestions = new Map<string, ScoringQuestion>();
  let current = template.inheritsFrom;

  while (current) {
    const questions = (current.questions as ScoringQuestion[]) || [];
    for (const q of questions) {
      if (!inheritedQuestions.has(q.fieldName)) {
        inheritedQuestions.set(q.fieldName, q);
      }
    }
    const parent = await prisma.scoringTemplate.findUnique({
      where: { id: current.inheritsFromId || '' }
    });
    current = parent;
  }

  return {
    template,
    inheritedQuestions: Array.from(inheritedQuestions.values())
  };
}

// ============================================================================
// Template CRUD
// ============================================================================

export interface CreateTemplateInput {
  name: string;
  description?: string;
  superSectorId?: string;
  sectorId?: string;
  subSectorId?: string;
  questions: ScoringQuestion[];
  inheritsFromId?: string;
  isDefault?: boolean;
}

/**
 * Create a new scoring template
 */
export async function createTemplate(input: CreateTemplateInput) {
  // Validate hierarchy - only one level can be set
  const levelCount = [input.superSectorId, input.sectorId, input.subSectorId].filter(Boolean).length;
  if (levelCount > 1) {
    throw new Error('Template can only be bound to one hierarchy level');
  }

  // Validate questions
  for (const q of input.questions) {
    if (!q.fieldName || !q.question || !q.answerType) {
      throw new Error(`Invalid question: missing required fields`);
    }
    if (q.weight < 0 || q.weight > 1) {
      throw new Error(`Question "${q.fieldName}" has invalid weight (must be 0-1)`);
    }
  }

  return prisma.scoringTemplate.create({
    data: {
      name: input.name,
      description: input.description,
      superSectorId: input.superSectorId,
      sectorId: input.sectorId,
      subSectorId: input.subSectorId,
      questions: input.questions,
      inheritsFromId: input.inheritsFromId,
      isDefault: input.isDefault || false,
    }
  });
}

/**
 * Update a scoring template
 */
export async function updateTemplate(
  templateId: string,
  input: Partial<CreateTemplateInput>
) {
  const existing = await prisma.scoringTemplate.findUnique({
    where: { id: templateId }
  });

  if (!existing) {
    throw new Error('Template not found');
  }

  return prisma.scoringTemplate.update({
    where: { id: templateId },
    data: {
      name: input.name,
      description: input.description,
      questions: input.questions,
      inheritsFromId: input.inheritsFromId,
      isDefault: input.isDefault,
      version: existing.version + 1,
      updatedAt: new Date()
    }
  });
}

/**
 * List templates with optional filtering
 */
export async function listTemplates(filters?: {
  superSectorId?: string;
  sectorId?: string;
  subSectorId?: string;
  isActive?: boolean;
}) {
  return prisma.scoringTemplate.findMany({
    where: {
      ...(filters?.superSectorId && { superSectorId: filters.superSectorId }),
      ...(filters?.sectorId && { sectorId: filters.sectorId }),
      ...(filters?.subSectorId && { subSectorId: filters.subSectorId }),
      ...(filters?.isActive !== undefined && { isActive: filters.isActive })
    },
    orderBy: [
      { isDefault: 'desc' },
      { createdAt: 'desc' }
    ]
  });
}

// ============================================================================
// Score Calculation
// ============================================================================

/**
 * Calculate composite score from individual metrics
 */
export function calculateCompositeScore(
  metrics: Record<string, MetricScore>,
  questions: ScoringQuestion[]
): number {
  let weightedSum = 0;
  let totalWeight = 0;

  for (const question of questions) {
    const metric = metrics[question.fieldName];
    if (metric && question.weight > 0 && question.answerType === 'numeric') {
      // Normalize score to 0-1 if scale is provided
      let normalizedScore = metric.score;
      if (question.scale) {
        const range = question.scale.max - question.scale.min;
        normalizedScore = (metric.score - question.scale.min) / range;
      }

      weightedSum += normalizedScore * question.weight;
      totalWeight += question.weight;
    }
  }

  if (totalWeight === 0) return 0;

  // Return score on 0-100 scale
  return Math.round((weightedSum / totalWeight) * 100 * 100) / 100;
}

/**
 * Save a patent's sub-sector score
 */
export async function savePatentScore(
  result: ScoreCalculationResult
): Promise<void> {
  await prisma.patentSubSectorScore.upsert({
    where: {
      patentId_subSectorId: {
        patentId: result.patentId,
        subSectorId: result.subSectorId
      }
    },
    create: {
      patentId: result.patentId,
      subSectorId: result.subSectorId,
      metrics: result.metrics,
      compositeScore: result.compositeScore,
      templateId: result.templateId,
      templateVersion: result.templateVersion,
      executedAt: new Date()
    },
    update: {
      metrics: result.metrics,
      compositeScore: result.compositeScore,
      templateId: result.templateId,
      templateVersion: result.templateVersion,
      executedAt: new Date(),
      updatedAt: new Date()
    }
  });
}

// ============================================================================
// Normalization & Ranking
// ============================================================================

/**
 * Recalculate ranks and normalized scores within a sub-sector
 */
export async function normalizeSubSectorScores(subSectorId: string): Promise<{
  count: number;
  topScore: number;
  bottomScore: number;
}> {
  // Get all scores for this sub-sector, sorted by composite score descending
  const scores = await prisma.patentSubSectorScore.findMany({
    where: { subSectorId },
    orderBy: { compositeScore: 'desc' }
  });

  if (scores.length === 0) {
    return { count: 0, topScore: 0, bottomScore: 0 };
  }

  // Update ranks and percentiles
  const updates = scores.map((score, index) => {
    const rank = index + 1;
    // Percentile: top scorer = 100, bottom = near 0
    const percentile = Math.round((1 - index / scores.length) * 100 * 100) / 100;

    return prisma.patentSubSectorScore.update({
      where: { id: score.id },
      data: {
        rankInSubSector: rank,
        normalizedScore: percentile
      }
    });
  });

  await prisma.$transaction(updates);

  return {
    count: scores.length,
    topScore: scores[0].compositeScore,
    bottomScore: scores[scores.length - 1].compositeScore
  };
}

/**
 * Recalculate sector-level ranks from sub-sector normalized scores
 */
export async function normalizeSectorScores(sectorId: string): Promise<{
  subSectorCount: number;
  patentCount: number;
}> {
  // Get all sub-sectors for this sector
  const subSectors = await prisma.subSector.findMany({
    where: { sectorId },
    select: { id: true }
  });

  const subSectorIds = subSectors.map(ss => ss.id);

  // Get all scores across sub-sectors, use normalized score for ranking
  const scores = await prisma.patentSubSectorScore.findMany({
    where: { subSectorId: { in: subSectorIds } },
    orderBy: { normalizedScore: 'desc' }
  });

  if (scores.length === 0) {
    return { subSectorCount: subSectors.length, patentCount: 0 };
  }

  // Update sector ranks
  const updates = scores.map((score, index) => {
    return prisma.patentSubSectorScore.update({
      where: { id: score.id },
      data: { rankInSector: index + 1 }
    });
  });

  await prisma.$transaction(updates);

  return {
    subSectorCount: subSectors.length,
    patentCount: scores.length
  };
}

/**
 * Get score stats for a sub-sector
 */
export async function getSubSectorScoreStats(subSectorId: string) {
  const scores = await prisma.patentSubSectorScore.findMany({
    where: { subSectorId },
    select: { compositeScore: true }
  });

  if (scores.length === 0) {
    return null;
  }

  const values = scores.map(s => s.compositeScore);
  const sorted = [...values].sort((a, b) => a - b);

  return {
    count: values.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    mean: Math.round(values.reduce((a, b) => a + b, 0) / values.length * 100) / 100,
    median: sorted[Math.floor(sorted.length / 2)],
    p25: sorted[Math.floor(sorted.length * 0.25)],
    p75: sorted[Math.floor(sorted.length * 0.75)]
  };
}

/**
 * Get scores for patents in a sub-sector
 */
export async function getSubSectorScores(
  subSectorId: string,
  options?: { limit?: number; offset?: number }
) {
  return prisma.patentSubSectorScore.findMany({
    where: { subSectorId },
    orderBy: { rankInSubSector: 'asc' },
    take: options?.limit,
    skip: options?.offset,
    include: {
      template: {
        select: { name: true, version: true }
      }
    }
  });
}

/**
 * Get score for a specific patent
 */
export async function getPatentScore(patentId: string) {
  return prisma.patentSubSectorScore.findFirst({
    where: { patentId },
    include: {
      template: {
        select: { name: true, version: true, questions: true }
      }
    }
  });
}

// ============================================================================
// JSON Config File Loading
// ============================================================================

const CONFIG_DIR = path.resolve(__dirname, '../../../config/scoring-templates');

interface TemplateConfigFile {
  $schema?: string;
  id: string;
  name: string;
  description?: string;
  level: 'portfolio' | 'super_sector' | 'sector' | 'sub_sector';
  superSectorName?: string;
  sectorName?: string;
  subSectorId?: string;
  inheritsFrom?: string;
  isDefault?: boolean;
  version: number;
  questions: ScoringQuestion[];
}

/**
 * Load a template from a JSON config file
 */
export function loadTemplateFromFile(filePath: string): TemplateConfigFile {
  const fullPath = path.isAbsolute(filePath) ? filePath : path.join(CONFIG_DIR, filePath);
  const content = fs.readFileSync(fullPath, 'utf-8');
  return JSON.parse(content) as TemplateConfigFile;
}

/**
 * Load the portfolio default template from config
 */
export function loadPortfolioDefaultTemplate(): TemplateConfigFile {
  return loadTemplateFromFile('portfolio-default.json');
}

/**
 * Load all super-sector templates from config
 */
export function loadSuperSectorTemplates(): Map<string, TemplateConfigFile> {
  const templates = new Map<string, TemplateConfigFile>();
  const superSectorsDir = path.join(CONFIG_DIR, 'super-sectors');

  if (!fs.existsSync(superSectorsDir)) {
    return templates;
  }

  const files = fs.readdirSync(superSectorsDir).filter(f => f.endsWith('.json'));

  for (const file of files) {
    const template = loadTemplateFromFile(path.join('super-sectors', file));
    if (template.superSectorName) {
      templates.set(template.superSectorName, template);
    }
  }

  return templates;
}

/**
 * Get merged questions for a super-sector (inheriting from portfolio default)
 */
export function getMergedQuestionsForSuperSector(superSectorName: string): ScoringQuestion[] {
  const portfolioDefault = loadPortfolioDefaultTemplate();
  const superSectorTemplates = loadSuperSectorTemplates();
  const superSectorTemplate = superSectorTemplates.get(superSectorName);

  // Start with portfolio default questions
  const merged = new Map<string, ScoringQuestion>();
  for (const q of portfolioDefault.questions) {
    merged.set(q.fieldName, q);
  }

  // Add/override with super-sector questions
  if (superSectorTemplate) {
    for (const q of superSectorTemplate.questions) {
      merged.set(q.fieldName, q);
    }
  }

  // Normalize weights to sum to ~1.0
  const questions = Array.from(merged.values());
  const totalWeight = questions.reduce((sum, q) => sum + q.weight, 0);
  if (totalWeight > 0) {
    for (const q of questions) {
      q.weight = Math.round((q.weight / totalWeight) * 100) / 100;
    }
  }

  return questions;
}

// ============================================================================
// Default Template Seeding
// ============================================================================

/**
 * Seed default templates for all super-sectors from JSON config files
 * Called during initial setup or when new super-sectors are added
 */
export async function seedDefaultTemplates(): Promise<{
  created: number;
  skipped: number;
  errors: string[];
}> {
  const superSectors = await prisma.superSector.findMany();
  const errors: string[] = [];

  let created = 0;
  let skipped = 0;

  // Load templates from JSON config files
  let portfolioDefaultConfig: TemplateConfigFile;
  let superSectorConfigs: Map<string, TemplateConfigFile>;

  try {
    portfolioDefaultConfig = loadPortfolioDefaultTemplate();
  } catch (err) {
    errors.push(`Failed to load portfolio-default.json: ${err}`);
    return { created, skipped, errors };
  }

  try {
    superSectorConfigs = loadSuperSectorTemplates();
  } catch (err) {
    errors.push(`Failed to load super-sector templates: ${err}`);
    superSectorConfigs = new Map();
  }

  // Portfolio-wide default template
  const portfolioDefault = await prisma.scoringTemplate.findFirst({
    where: { isDefault: true, superSectorId: null, sectorId: null, subSectorId: null }
  });

  if (!portfolioDefault) {
    await createTemplate({
      name: portfolioDefaultConfig.name,
      description: portfolioDefaultConfig.description,
      isDefault: true,
      questions: portfolioDefaultConfig.questions
    });
    created++;
  } else {
    skipped++;
  }

  // Super-sector specific templates
  for (const ss of superSectors) {
    const existing = await prisma.scoringTemplate.findFirst({
      where: { superSectorId: ss.id, isDefault: true }
    });

    if (existing) {
      skipped++;
      continue;
    }

    const config = superSectorConfigs.get(ss.name);
    if (!config) {
      errors.push(`No config file found for super-sector: ${ss.name}`);
      // Fall back to portfolio default questions only
      await createTemplate({
        name: `${ss.displayName} Scoring`,
        description: `Scoring template for ${ss.displayName} patents (default - no config file)`,
        superSectorId: ss.id,
        isDefault: true,
        questions: portfolioDefaultConfig.questions
      });
      created++;
      continue;
    }

    // Merge questions with portfolio default
    const mergedQuestions = getMergedQuestionsForSuperSector(ss.name);

    await createTemplate({
      name: config.name,
      description: config.description,
      superSectorId: ss.id,
      isDefault: true,
      questions: mergedQuestions
    });
    created++;
  }

  return { created, skipped, errors };
}

/**
 * List all available template config files
 */
export function listTemplateConfigFiles(): {
  portfolioDefault: TemplateConfigFile | null;
  superSectors: Array<{
    filename: string;
    superSectorName: string;
    template: TemplateConfigFile;
  }>;
  sectors: Array<{ filename: string; template: TemplateConfigFile }>;
  subSectors: Array<{ filename: string; template: TemplateConfigFile }>;
} {
  const result = {
    portfolioDefault: null as TemplateConfigFile | null,
    superSectors: [] as Array<{ filename: string; superSectorName: string; template: TemplateConfigFile }>,
    sectors: [] as Array<{ filename: string; template: TemplateConfigFile }>,
    subSectors: [] as Array<{ filename: string; template: TemplateConfigFile }>
  };

  // Load portfolio default
  try {
    result.portfolioDefault = loadPortfolioDefaultTemplate();
  } catch {
    // File doesn't exist
  }

  // Load super-sector templates
  const superSectorsDir = path.join(CONFIG_DIR, 'super-sectors');
  if (fs.existsSync(superSectorsDir)) {
    const files = fs.readdirSync(superSectorsDir).filter(f => f.endsWith('.json'));
    for (const file of files) {
      try {
        const template = loadTemplateFromFile(path.join('super-sectors', file));
        if (template.superSectorName) {
          result.superSectors.push({
            filename: file,
            superSectorName: template.superSectorName,
            template
          });
        }
      } catch {
        // Skip invalid files
      }
    }
  }

  // Load sector templates (if they exist)
  const sectorsDir = path.join(CONFIG_DIR, 'sectors');
  if (fs.existsSync(sectorsDir)) {
    const files = fs.readdirSync(sectorsDir).filter(f => f.endsWith('.json'));
    for (const file of files) {
      try {
        const template = loadTemplateFromFile(path.join('sectors', file));
        result.sectors.push({ filename: file, template });
      } catch {
        // Skip invalid files
      }
    }
  }

  // Load sub-sector templates (if they exist)
  const subSectorsDir = path.join(CONFIG_DIR, 'sub-sectors');
  if (fs.existsSync(subSectorsDir)) {
    const files = fs.readdirSync(subSectorsDir).filter(f => f.endsWith('.json'));
    for (const file of files) {
      try {
        const template = loadTemplateFromFile(path.join('sub-sectors', file));
        result.subSectors.push({ filename: file, template });
      } catch {
        // Skip invalid files
      }
    }
  }

  return result;
}

// Note: Template questions are now loaded from JSON config files in /config/scoring-templates/
// See loadPortfolioDefaultTemplate(), loadSuperSectorTemplates(), and getMergedQuestionsForSuperSector()
