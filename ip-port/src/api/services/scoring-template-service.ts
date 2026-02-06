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
 */

import { PrismaClient } from '@prisma/client';

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
// Default Template Seeding
// ============================================================================

/**
 * Seed default templates for all super-sectors
 * Called during initial setup or when new super-sectors are added
 */
export async function seedDefaultTemplates(): Promise<{
  created: number;
  skipped: number;
}> {
  const superSectors = await prisma.superSector.findMany();

  let created = 0;
  let skipped = 0;

  // Portfolio-wide default template
  const portfolioDefault = await prisma.scoringTemplate.findFirst({
    where: { isDefault: true, superSectorId: null, sectorId: null, subSectorId: null }
  });

  if (!portfolioDefault) {
    await createTemplate({
      name: 'Portfolio Default',
      description: 'Default scoring template for all patents',
      isDefault: true,
      questions: getBaseQuestions()
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

    const questions = getSuperSectorQuestions(ss.name);
    await createTemplate({
      name: `${ss.displayName} Scoring`,
      description: `Scoring template for ${ss.displayName} patents`,
      superSectorId: ss.id,
      isDefault: true,
      questions
    });
    created++;
  }

  return { created, skipped };
}

/**
 * Get base questions applicable to all patents
 */
function getBaseQuestions(): ScoringQuestion[] {
  return [
    {
      fieldName: 'technical_novelty',
      displayName: 'Technical Novelty',
      question: 'Rate the technical novelty of this patent\'s core innovation. Consider: How different is this from prior art? Does it represent a significant departure from existing approaches?',
      answerType: 'numeric',
      scale: { min: 1, max: 10 },
      weight: 0.20,
      requiresReasoning: true,
      reasoningPrompt: 'Explain what makes this technically novel or incremental.'
    },
    {
      fieldName: 'claim_breadth',
      displayName: 'Claim Breadth',
      question: 'Rate the breadth of the patent claims. Consider: How broadly do the claims cover the invention? Could they capture variations and alternative implementations?',
      answerType: 'numeric',
      scale: { min: 1, max: 10 },
      weight: 0.15,
      requiresReasoning: true,
      reasoningPrompt: 'Describe the scope of the claims.'
    },
    {
      fieldName: 'design_around_difficulty',
      displayName: 'Design-Around Difficulty',
      question: 'How difficult would it be for a competitor to design around this patent while achieving similar functionality?',
      answerType: 'numeric',
      scale: { min: 1, max: 10 },
      weight: 0.20,
      requiresReasoning: true,
      reasoningPrompt: 'Explain what makes this hard or easy to design around.'
    },
    {
      fieldName: 'market_relevance',
      displayName: 'Market Relevance',
      question: 'Rate the relevance of this technology to current market needs and industry trends.',
      answerType: 'numeric',
      scale: { min: 1, max: 10 },
      weight: 0.15,
      requiresReasoning: true,
      reasoningPrompt: 'Describe the market context and relevance.'
    },
    {
      fieldName: 'implementation_clarity',
      displayName: 'Implementation Clarity',
      question: 'How clearly does the patent describe the implementation? Could infringement be easily detected in a product?',
      answerType: 'numeric',
      scale: { min: 1, max: 10 },
      weight: 0.15,
      requiresReasoning: true,
      reasoningPrompt: 'Assess detectability and clarity of implementation.'
    },
    {
      fieldName: 'standards_relevance',
      displayName: 'Standards Relevance',
      question: 'Is this patent related to any industry standards (IEEE, 3GPP, IETF, etc.)? Rate its standards essentiality.',
      answerType: 'numeric',
      scale: { min: 1, max: 10 },
      weight: 0.15,
      requiresReasoning: true,
      reasoningPrompt: 'Identify any standards relationships.'
    }
  ];
}

/**
 * Get super-sector specific questions
 */
function getSuperSectorQuestions(superSectorName: string): ScoringQuestion[] {
  const base = getBaseQuestions();

  // Add super-sector specific questions
  const sectorQuestions: Record<string, ScoringQuestion[]> = {
    'SECURITY': [
      {
        fieldName: 'threat_coverage',
        displayName: 'Threat Coverage',
        question: 'How comprehensive is this patent\'s coverage of security threats? Consider attack vectors, defensive mechanisms, and breadth of protection.',
        answerType: 'numeric',
        scale: { min: 1, max: 10 },
        weight: 0.20,
        requiresReasoning: true,
        reasoningPrompt: 'Describe the security threats addressed.'
      },
      {
        fieldName: 'attack_sophistication',
        displayName: 'Attack Sophistication',
        question: 'Rate the sophistication of attacks this patent helps prevent or detect.',
        answerType: 'numeric',
        scale: { min: 1, max: 10 },
        weight: 0.10,
        requiresReasoning: true
      }
    ],
    'NETWORKING': [
      {
        fieldName: 'protocol_relevance',
        displayName: 'Protocol Relevance',
        question: 'How relevant is this patent to core networking protocols and standards?',
        answerType: 'numeric',
        scale: { min: 1, max: 10 },
        weight: 0.15,
        requiresReasoning: true,
        reasoningPrompt: 'Identify relevant protocols and standards.'
      },
      {
        fieldName: 'scalability',
        displayName: 'Scalability Impact',
        question: 'Does this patent address scalability challenges in networking (bandwidth, latency, connections)?',
        answerType: 'numeric',
        scale: { min: 1, max: 10 },
        weight: 0.10,
        requiresReasoning: true
      }
    ],
    'COMPUTING': [
      {
        fieldName: 'performance_impact',
        displayName: 'Performance Impact',
        question: 'Rate the potential performance improvement this technology offers.',
        answerType: 'numeric',
        scale: { min: 1, max: 10 },
        weight: 0.15,
        requiresReasoning: true
      },
      {
        fieldName: 'resource_efficiency',
        displayName: 'Resource Efficiency',
        question: 'How efficiently does this technology use computing resources (CPU, memory, power)?',
        answerType: 'numeric',
        scale: { min: 1, max: 10 },
        weight: 0.10,
        requiresReasoning: true
      }
    ],
    'STORAGE': [
      {
        fieldName: 'data_integrity',
        displayName: 'Data Integrity',
        question: 'How well does this patent protect data integrity and reliability?',
        answerType: 'numeric',
        scale: { min: 1, max: 10 },
        weight: 0.15,
        requiresReasoning: true
      },
      {
        fieldName: 'storage_efficiency',
        displayName: 'Storage Efficiency',
        question: 'Rate the storage efficiency improvements this technology enables.',
        answerType: 'numeric',
        scale: { min: 1, max: 10 },
        weight: 0.10,
        requiresReasoning: true
      }
    ],
    'WIRELESS': [
      {
        fieldName: 'spectrum_efficiency',
        displayName: 'Spectrum Efficiency',
        question: 'How efficiently does this technology use wireless spectrum?',
        answerType: 'numeric',
        scale: { min: 1, max: 10 },
        weight: 0.15,
        requiresReasoning: true
      },
      {
        fieldName: 'wireless_standard_alignment',
        displayName: 'Wireless Standard Alignment',
        question: 'Rate alignment with wireless standards (WiFi, 5G, Bluetooth, etc.).',
        answerType: 'numeric',
        scale: { min: 1, max: 10 },
        weight: 0.15,
        requiresReasoning: true
      }
    ],
    'MEDIA': [
      {
        fieldName: 'codec_efficiency',
        displayName: 'Codec Efficiency',
        question: 'Rate the compression efficiency or quality improvements this technology offers.',
        answerType: 'numeric',
        scale: { min: 1, max: 10 },
        weight: 0.15,
        requiresReasoning: true
      },
      {
        fieldName: 'media_standard_relevance',
        displayName: 'Media Standard Relevance',
        question: 'How relevant is this to media standards (HEVC, AV1, JPEG, etc.)?',
        answerType: 'numeric',
        scale: { min: 1, max: 10 },
        weight: 0.15,
        requiresReasoning: true
      }
    ],
    'SEMICONDUCTOR': [
      {
        fieldName: 'manufacturing_relevance',
        displayName: 'Manufacturing Relevance',
        question: 'How relevant is this to semiconductor manufacturing processes?',
        answerType: 'numeric',
        scale: { min: 1, max: 10 },
        weight: 0.15,
        requiresReasoning: true
      },
      {
        fieldName: 'chip_integration',
        displayName: 'Chip Integration',
        question: 'How easily can this be integrated into chip designs?',
        answerType: 'numeric',
        scale: { min: 1, max: 10 },
        weight: 0.10,
        requiresReasoning: true
      }
    ],
    'INTERFACE': [
      {
        fieldName: 'interface_standard',
        displayName: 'Interface Standard',
        question: 'How relevant is this to interface standards (PCIe, USB, etc.)?',
        answerType: 'numeric',
        scale: { min: 1, max: 10 },
        weight: 0.15,
        requiresReasoning: true
      },
      {
        fieldName: 'interoperability',
        displayName: 'Interoperability',
        question: 'Rate the interoperability benefits this technology provides.',
        answerType: 'numeric',
        scale: { min: 1, max: 10 },
        weight: 0.10,
        requiresReasoning: true
      }
    ]
  };

  const additionalQuestions = sectorQuestions[superSectorName] || [];

  // Merge: super-sector questions first, then base (base questions with matching fieldName are overridden)
  const merged = new Map<string, ScoringQuestion>();

  for (const q of base) {
    merged.set(q.fieldName, q);
  }
  for (const q of additionalQuestions) {
    merged.set(q.fieldName, q);
  }

  // Re-normalize weights to sum to ~1.0
  const questions = Array.from(merged.values());
  const totalWeight = questions.reduce((sum, q) => sum + q.weight, 0);
  if (totalWeight > 0) {
    for (const q of questions) {
      q.weight = Math.round((q.weight / totalWeight) * 100) / 100;
    }
  }

  return questions;
}
