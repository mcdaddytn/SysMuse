/**
 * Currency Service — revAIQ Question Version Tracking
 *
 * Tracks which version of structured questions has been applied to each patent
 * at each taxonomy level. Enables precise staleness detection and enrichment
 * planning by comparing per-patent revAIQ against current question versions.
 *
 * revAIQ format: "portfolio.superSector.sector.subSector" (e.g., "2.4.1.1")
 */

import { PrismaClient } from '@prisma/client';
import {
  loadPortfolioDefaultTemplate,
  loadSuperSectorTemplates,
  loadSectorTemplates,
  loadSubSectorTemplates,
  computeQuestionFingerprint,
} from './scoring-template-service.js';

const prisma = new PrismaClient();

// =============================================================================
// Types
// =============================================================================

export interface VersionInfo {
  level: string;
  scopeId: string;
  version: number;
  questionFingerprint: string;
  questionCount: number;
  templateFileVersion: number;
}

export interface TaxonomyPathVersions {
  portfolio: number;
  superSector: number;
  sector: number;
  subSector: number;
  revAIQ: string;
}

export interface CurrencyGapResult {
  taxonomyPath: string;
  latestRevAIQ: string;
  total: number;
  current: number;
  stalePortfolio: number;
  staleSuperSector: number;
  staleSector: number;
  staleSubSector: number;
  neverScored: number;
  patents: Array<{
    patentId: string;
    currentRevAIQ: string | null;
    latestRevAIQ: string;
    staleLevels: string[];
  }>;
}

// =============================================================================
// Version Lookup
// =============================================================================

/**
 * Get the current (latest) QuestionVersion for a given scope.
 */
export async function getCurrentVersion(level: string, scopeId: string): Promise<VersionInfo | null> {
  const version = await prisma.questionVersion.findFirst({
    where: { level, scopeId },
    orderBy: { version: 'desc' },
  });

  if (!version) return null;

  return {
    level: version.level,
    scopeId: version.scopeId,
    version: version.version,
    questionFingerprint: version.questionFingerprint,
    questionCount: version.questionCount,
    templateFileVersion: version.templateFileVersion,
  };
}

/**
 * Get current versions for all levels in a taxonomy path.
 *
 * @param taxonomyPath  Slash-separated path: "WIRELESS/rf-acoustic/amplifiers"
 *                      Can be partial: "WIRELESS" or "WIRELESS/rf-acoustic"
 */
export async function getCurrentVersions(taxonomyPath: string): Promise<TaxonomyPathVersions> {
  const parts = taxonomyPath.split('/');
  const superSectorName = parts[0] || '';
  const sectorName = parts[1] || '';
  const subSectorName = parts[2] || '';

  const portfolio = await getCurrentVersion('portfolio', 'portfolio-default');
  const superSector = superSectorName ? await getCurrentVersion('super_sector', superSectorName.toLowerCase()) : null;
  const sector = sectorName ? await getCurrentVersion('sector', sectorName) : null;
  const subSector = subSectorName ? await getCurrentVersion('sub_sector', subSectorName) : null;

  const versions: TaxonomyPathVersions = {
    portfolio: portfolio?.version ?? 0,
    superSector: superSector?.version ?? 0,
    sector: sector?.version ?? 0,
    subSector: subSector?.version ?? 0,
    revAIQ: '',
  };

  versions.revAIQ = `${versions.portfolio}.${versions.superSector}.${versions.sector}.${versions.subSector}`;
  return versions;
}

/**
 * Get the revAIQ string for a taxonomy path.
 */
export async function getRevAIQ(taxonomyPath: string): Promise<string> {
  const versions = await getCurrentVersions(taxonomyPath);
  return versions.revAIQ;
}

// =============================================================================
// Patent Currency
// =============================================================================

/**
 * Get the currency record for a patent at a specific taxonomy path.
 */
export async function getPatentCurrency(patentId: string, taxonomyPath: string) {
  return prisma.patentQuestionCurrency.findUnique({
    where: { patentId_taxonomyPath: { patentId, taxonomyPath } },
  });
}

/**
 * Get all currency records for a patent (across all taxonomy paths).
 */
export async function getAllPatentCurrency(patentId: string) {
  return prisma.patentQuestionCurrency.findMany({
    where: { patentId },
    orderBy: { taxonomyPath: 'asc' },
  });
}

/**
 * Record that a patent has been scored with current question versions.
 * Called after LLM scoring completes.
 */
export async function recordPatentCurrency(
  patentId: string,
  taxonomyPath: string,
  llmModel?: string,
): Promise<void> {
  const versions = await getCurrentVersions(taxonomyPath);

  await prisma.patentQuestionCurrency.upsert({
    where: { patentId_taxonomyPath: { patentId, taxonomyPath } },
    update: {
      revAIQ: versions.revAIQ,
      portfolioVersion: versions.portfolio,
      superSectorVersion: versions.superSector,
      sectorVersion: versions.sector,
      subSectorVersion: versions.subSector,
      llmModel: llmModel ?? null,
      scoredAt: new Date(),
    },
    create: {
      patentId,
      taxonomyPath,
      revAIQ: versions.revAIQ,
      portfolioVersion: versions.portfolio,
      superSectorVersion: versions.superSector,
      sectorVersion: versions.sector,
      subSectorVersion: versions.subSector,
      llmModel: llmModel ?? null,
      scoredAt: new Date(),
    },
  });
}

// =============================================================================
// Currency Gap Analysis
// =============================================================================

/**
 * Compute currency gaps for all patents in a portfolio within a taxonomy path.
 * Compares each patent's revAIQ against the latest question versions.
 */
export async function computeCurrencyGaps(
  portfolioId: string,
  taxonomyPath: string,
  options?: { limit?: number },
): Promise<CurrencyGapResult> {
  const latestVersions = await getCurrentVersions(taxonomyPath);

  // Get all patent IDs in the portfolio
  const portfolioPatents = await prisma.portfolioPatent.findMany({
    where: { portfolioId },
    select: { patentId: true },
  });
  const patentIds = portfolioPatents.map(p => p.patentId);

  // Get currency records for these patents at this path (or any child path).
  // E.g., querying "WIRELESS" should match "WIRELESS/wireless-scheduling" records.
  const currencyRecords = await prisma.patentQuestionCurrency.findMany({
    where: {
      patentId: { in: patentIds },
      taxonomyPath: { startsWith: taxonomyPath },
    },
  });
  // For patents with multiple currency records (different sectors), use the most recent
  const currencyMap = new Map<string, typeof currencyRecords[0]>();
  for (const c of currencyRecords) {
    const existing = currencyMap.get(c.patentId);
    if (!existing || c.scoredAt > existing.scoredAt) {
      currencyMap.set(c.patentId, c);
    }
  }

  // Analyze gaps
  let current = 0;
  let stalePortfolio = 0;
  let staleSuperSector = 0;
  let staleSector = 0;
  let staleSubSector = 0;
  let neverScored = 0;

  const patents: CurrencyGapResult['patents'] = [];

  for (const patentId of patentIds) {
    const currency = currencyMap.get(patentId);

    if (!currency) {
      neverScored++;
      patents.push({
        patentId,
        currentRevAIQ: null,
        latestRevAIQ: latestVersions.revAIQ,
        staleLevels: ['portfolio', 'super_sector', 'sector', 'sub_sector'],
      });
      continue;
    }

    const staleLevels: string[] = [];
    if (currency.portfolioVersion < latestVersions.portfolio) {
      stalePortfolio++;
      staleLevels.push('portfolio');
    }
    if (currency.superSectorVersion < latestVersions.superSector) {
      staleSuperSector++;
      staleLevels.push('super_sector');
    }
    if (currency.sectorVersion < latestVersions.sector) {
      staleSector++;
      staleLevels.push('sector');
    }
    if (currency.subSectorVersion < latestVersions.subSector) {
      staleSubSector++;
      staleLevels.push('sub_sector');
    }

    if (staleLevels.length === 0) {
      current++;
    }

    patents.push({
      patentId,
      currentRevAIQ: currency.revAIQ,
      latestRevAIQ: latestVersions.revAIQ,
      staleLevels,
    });
  }

  // Apply limit to patent details (summary counts are always complete)
  const limitedPatents = options?.limit ? patents.slice(0, options.limit) : patents;

  return {
    taxonomyPath,
    latestRevAIQ: latestVersions.revAIQ,
    total: patentIds.length,
    current,
    stalePortfolio,
    staleSuperSector,
    staleSector,
    staleSubSector,
    neverScored,
    patents: limitedPatents,
  };
}

// =============================================================================
// Version Management
// =============================================================================

/**
 * Bump the version for a scope. Reads current template to compute new fingerprint.
 */
export async function bumpVersion(
  level: string,
  scopeId: string,
  changeSummary?: string,
): Promise<VersionInfo> {
  // Get current version
  const current = await getCurrentVersion(level, scopeId);
  const newVersion = (current?.version ?? 0) + 1;

  // Compute new fingerprint from template
  const { fingerprint, questionCount, templateFileVersion, templateConfigId } =
    computeTemplateFingerprint(level, scopeId);

  const created = await prisma.questionVersion.create({
    data: {
      level,
      scopeId,
      version: newVersion,
      questionFingerprint: fingerprint,
      questionCount,
      templateConfigId,
      templateFileVersion,
      changeSummary: changeSummary ?? null,
    },
  });

  return {
    level: created.level,
    scopeId: created.scopeId,
    version: created.version,
    questionFingerprint: created.questionFingerprint,
    questionCount: created.questionCount,
    templateFileVersion: created.templateFileVersion,
  };
}

/**
 * Sync QuestionVersion table with current template files.
 * Creates v1 entries for scopes that don't have any version yet,
 * and bumps versions for scopes where the fingerprint has changed.
 */
export async function syncVersionsFromTemplates(): Promise<{
  created: number;
  bumped: number;
  unchanged: number;
  details: Array<{ level: string; scopeId: string; action: string; version: number }>;
}> {
  let created = 0;
  let bumped = 0;
  let unchanged = 0;
  const details: Array<{ level: string; scopeId: string; action: string; version: number }> = [];

  // Collect all scopes from template files
  const scopes = collectAllScopes();

  for (const scope of scopes) {
    const { fingerprint, questionCount, templateFileVersion, templateConfigId } =
      computeTemplateFingerprint(scope.level, scope.scopeId);

    if (questionCount === 0) continue; // Skip scopes with no questions

    const current = await getCurrentVersion(scope.level, scope.scopeId);

    if (!current) {
      // No version exists — create v1
      await prisma.questionVersion.create({
        data: {
          level: scope.level,
          scopeId: scope.scopeId,
          version: 1,
          questionFingerprint: fingerprint,
          questionCount,
          templateConfigId,
          templateFileVersion,
          changeSummary: 'Initial version from template sync',
        },
      });
      created++;
      details.push({ level: scope.level, scopeId: scope.scopeId, action: 'created', version: 1 });
    } else if (current.questionFingerprint !== fingerprint) {
      // Fingerprint changed — bump version
      const newVersion = current.version + 1;
      await prisma.questionVersion.create({
        data: {
          level: scope.level,
          scopeId: scope.scopeId,
          version: newVersion,
          questionFingerprint: fingerprint,
          questionCount,
          templateConfigId,
          templateFileVersion,
          changeSummary: `Template fingerprint changed (was: ${current.questionFingerprint.substring(0, 50)}...)`,
        },
      });
      bumped++;
      details.push({ level: scope.level, scopeId: scope.scopeId, action: 'bumped', version: newVersion });
    } else {
      unchanged++;
      details.push({ level: scope.level, scopeId: scope.scopeId, action: 'unchanged', version: current.version });
    }
  }

  return { created, bumped, unchanged, details };
}

// =============================================================================
// Internal helpers
// =============================================================================

interface TemplateFingerprint {
  fingerprint: string;
  questionCount: number;
  templateFileVersion: number;
  templateConfigId: string;
}

/**
 * Compute fingerprint for a template at a given level/scope.
 * For revAIQ, we track only the NEW questions introduced at each level
 * (not inherited ones), matching the formula generator's grouped-term model.
 */
function computeTemplateFingerprint(level: string, scopeId: string): TemplateFingerprint {
  const portfolioTemplate = loadPortfolioDefaultTemplate();
  const portfolioFieldNames = new Set(
    portfolioTemplate.questions
      .filter((q: any) => q.answerType === 'numeric')
      .map((q: any) => q.fieldName)
  );

  if (level === 'portfolio') {
    const numericQuestions = portfolioTemplate.questions.filter((q: any) => q.answerType === 'numeric');
    const fieldNames = numericQuestions.map((q: any) => q.fieldName).sort();
    return {
      fingerprint: fieldNames.join(','),
      questionCount: fieldNames.length,
      templateFileVersion: portfolioTemplate.version,
      templateConfigId: portfolioTemplate.id,
    };
  }

  if (level === 'super_sector') {
    const templates = loadSuperSectorTemplates();
    const template = templates.get(scopeId.toUpperCase()) ?? templates.get(scopeId);
    if (!template) return { fingerprint: '', questionCount: 0, templateFileVersion: 0, templateConfigId: scopeId };

    const numericQuestions = template.questions.filter((q: any) => q.answerType === 'numeric');
    const newFields = numericQuestions
      .filter((q: any) => !portfolioFieldNames.has(q.fieldName))
      .map((q: any) => q.fieldName)
      .sort();

    return {
      fingerprint: newFields.join(','),
      questionCount: newFields.length,
      templateFileVersion: template.version,
      templateConfigId: template.id,
    };
  }

  if (level === 'sector') {
    const superSectorTemplates = loadSuperSectorTemplates();
    const sectorTemplates = loadSectorTemplates();
    const template = sectorTemplates.get(scopeId);
    if (!template) return { fingerprint: '', questionCount: 0, templateFileVersion: 0, templateConfigId: scopeId };

    // Collect parent field names (portfolio + super-sector)
    const parentFields = new Set(portfolioFieldNames);
    const inheritsFrom = template.inheritsFrom;
    if (inheritsFrom) {
      const ssTemplate = superSectorTemplates.get(inheritsFrom.toUpperCase()) ?? superSectorTemplates.get(inheritsFrom);
      if (ssTemplate) {
        for (const q of ssTemplate.questions) {
          if (q.answerType === 'numeric') parentFields.add(q.fieldName);
        }
      }
    }

    const numericQuestions = template.questions.filter((q: any) => q.answerType === 'numeric');
    const newFields = numericQuestions
      .filter((q: any) => !parentFields.has(q.fieldName))
      .map((q: any) => q.fieldName)
      .sort();

    return {
      fingerprint: newFields.join(','),
      questionCount: newFields.length,
      templateFileVersion: template.version,
      templateConfigId: template.id,
    };
  }

  if (level === 'sub_sector') {
    const subSectorTemplates = loadSubSectorTemplates();
    const template = subSectorTemplates.get(scopeId);
    if (!template) return { fingerprint: '', questionCount: 0, templateFileVersion: 0, templateConfigId: scopeId };

    // For sub-sectors, we need the full parent chain
    // Sub-sector inherits from sector which inherits from super-sector which inherits from portfolio
    // Collect all parent field names
    const parentFields = new Set(portfolioFieldNames);
    const superSectorTemplates = loadSuperSectorTemplates();
    const sectorTemplates = loadSectorTemplates();

    // Walk up: sub-sector.inheritsFrom → sector → super-sector
    const sectorId = template.inheritsFrom || template.sectorName;
    if (sectorId) {
      const sectorTemplate = sectorTemplates.get(sectorId);
      if (sectorTemplate) {
        for (const q of sectorTemplate.questions) {
          if (q.answerType === 'numeric') parentFields.add(q.fieldName);
        }
        const ssId = sectorTemplate.inheritsFrom;
        if (ssId) {
          const ssTemplate = superSectorTemplates.get(ssId.toUpperCase()) ?? superSectorTemplates.get(ssId);
          if (ssTemplate) {
            for (const q of ssTemplate.questions) {
              if (q.answerType === 'numeric') parentFields.add(q.fieldName);
            }
          }
        }
      }
    }

    const numericQuestions = template.questions.filter((q: any) => q.answerType === 'numeric');
    const newFields = numericQuestions
      .filter((q: any) => !parentFields.has(q.fieldName))
      .map((q: any) => q.fieldName)
      .sort();

    return {
      fingerprint: newFields.join(','),
      questionCount: newFields.length,
      templateFileVersion: template.version,
      templateConfigId: template.id,
    };
  }

  return { fingerprint: '', questionCount: 0, templateFileVersion: 0, templateConfigId: scopeId };
}

/**
 * Collect all scopes from template files.
 */
function collectAllScopes(): Array<{ level: string; scopeId: string }> {
  const scopes: Array<{ level: string; scopeId: string }> = [];

  // Portfolio
  scopes.push({ level: 'portfolio', scopeId: 'portfolio-default' });

  // Super-sectors
  const superSectorTemplates = loadSuperSectorTemplates();
  for (const [name] of superSectorTemplates) {
    scopes.push({ level: 'super_sector', scopeId: name.toLowerCase() });
  }

  // Sectors
  const sectorTemplates = loadSectorTemplates();
  for (const [name] of sectorTemplates) {
    scopes.push({ level: 'sector', scopeId: name });
  }

  // Sub-sectors
  const subSectorTemplates = loadSubSectorTemplates();
  for (const [name] of subSectorTemplates) {
    scopes.push({ level: 'sub_sector', scopeId: name });
  }

  return scopes;
}
