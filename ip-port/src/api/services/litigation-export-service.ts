/**
 * Litigation Package CSV Export Service
 *
 * Generates comprehensive CSV exports for focus areas that include:
 * - All patent metadata + EAV score columns
 * - PatentSubSectorScore metrics (scores + reasoning) flattened into columns
 * - Sub-sector scoring metadata (composite score, rank, template used)
 */

import { PrismaClient } from '@prisma/client';
import * as patentDataService from './patent-data-service.js';
import { getActiveSnapshotScores } from '../routes/scores.routes.js';

const prisma = new PrismaClient();

// ─────────────────────────────────────────────────────────────────────────────
// CSV Helper
// ─────────────────────────────────────────────────────────────────────────────

function escapeCSV(val: unknown): string {
  if (val === null || val === undefined) return '';
  if (Array.isArray(val)) return `"${val.join('; ')}"`;
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

// ─────────────────────────────────────────────────────────────────────────────
// Column Definitions
// ─────────────────────────────────────────────────────────────────────────────

const FIXED_METADATA_COLUMNS = [
  { key: 'patent_id', label: 'Patent ID' },
  { key: 'patent_title', label: 'Title' },
  { key: 'abstract', label: 'Abstract' },
  { key: 'patent_date', label: 'Grant Date' },
  { key: 'remaining_years', label: 'Remaining Years' },
  { key: 'affiliate', label: 'Affiliate' },
  { key: 'super_sector', label: 'Super Sector' },
  { key: 'primary_sector', label: 'Primary Sector' },
  { key: 'primary_sub_sector_name', label: 'Primary Sub-Sector' },
  { key: 'assignee', label: 'Assignee' },
  { key: 'cpc_codes', label: 'CPC Codes' },
  { key: 'forward_citations', label: 'Forward Citations' },
  { key: 'is_expired', label: 'Is Expired' },
  { key: 'is_quarantined', label: 'Is Quarantined' },
];

const FOCUS_AREA_COLUMNS = [
  { key: 'fa_match_score', label: 'FA Match Score' },
];

const SCORE_COLUMNS = [
  { key: 'score', label: 'Base Score' },
  { key: 'v2_score', label: 'V2 Score' },
  { key: 'v3_score', label: 'V3 Score' },
  { key: 'sub_sector_composite_score', label: 'Sub-Sector Composite Score' },
  { key: 'sub_sector_rank', label: 'Sub-Sector Rank' },
  { key: 'scoring_template', label: 'Scoring Template' },
];

const EAV_NUMERIC_COLUMNS = [
  { key: 'eligibility_score', label: 'Eligibility Score' },
  { key: 'validity_score', label: 'Validity Score' },
  { key: 'claim_breadth', label: 'Claim Breadth' },
  { key: 'enforcement_clarity', label: 'Enforcement Clarity' },
  { key: 'design_around_difficulty', label: 'Design Around Difficulty' },
  { key: 'claim_clarity_score', label: 'Claim Clarity Score' },
  { key: 'evidence_accessibility_score', label: 'Evidence Accessibility Score' },
  { key: 'market_relevance_score', label: 'Market Relevance Score' },
  { key: 'trend_alignment_score', label: 'Trend Alignment Score' },
  { key: 'investigation_priority_score', label: 'Investigation Priority Score' },
  { key: 'llm_confidence', label: 'LLM Confidence' },
  { key: 'legal_viability_score', label: 'Legal Viability Score' },
  { key: 'enforcement_potential_score', label: 'Enforcement Potential Score' },
  { key: 'market_value_score', label: 'Market Value Score' },
];

const EAV_TEXT_COLUMNS = [
  { key: 'llm_summary', label: 'LLM Summary' },
  { key: 'llm_prior_art_problem', label: 'Prior Art Problem' },
  { key: 'llm_technical_solution', label: 'Technical Solution' },
  { key: 'llm_technology_category', label: 'Technology Category' },
  { key: 'llm_implementation_type', label: 'Implementation Type' },
  { key: 'llm_standards_relevance', label: 'Standards Relevance' },
  { key: 'llm_market_segment', label: 'Market Segment' },
  { key: 'llm_detection_method', label: 'Detection Method' },
  { key: 'llm_implementation_complexity', label: 'Implementation Complexity' },
  { key: 'llm_claim_type_primary', label: 'Claim Type Primary' },
  { key: 'llm_geographic_scope', label: 'Geographic Scope' },
  { key: 'llm_lifecycle_stage', label: 'Lifecycle Stage' },
];

// ─────────────────────────────────────────────────────────────────────────────
// Main Export Function
// ─────────────────────────────────────────────────────────────────────────────

interface MetricValue {
  score?: number;
  reasoning?: string;
  confidence?: number;
}

export async function generateLitigationPackageCsv(focusAreaId: string): Promise<{
  csv: string;
  filename: string;
  patentCount: number;
  metricKeyCount: number;
}> {
  // 1. Load focus area metadata
  const focusArea = await prisma.focusArea.findUnique({
    where: { id: focusAreaId },
    select: { id: true, name: true },
  });
  if (!focusArea) {
    throw new Error(`Focus area not found: ${focusAreaId}`);
  }

  // 2. Get all patents via existing service (with snapshot scores)
  const snapshotScores = await getActiveSnapshotScores();
  const patents = await patentDataService.getAllPatents({
    focusAreaId,
    snapshotScores: { v2: snapshotScores.v2Scores, v3: snapshotScores.v3Scores },
  });

  if (patents.length === 0) {
    throw new Error('No patents found in this focus area');
  }

  const patentIds = patents.map(p => p.patent_id);

  // 3. Load sub-sector scores for these patent IDs
  const subSectorScores = await prisma.patentSubSectorScore.findMany({
    where: { patentId: { in: patentIds } },
    select: {
      patentId: true,
      subSectorId: true,
      metrics: true,
      compositeScore: true,
      rankInSubSector: true,
      normalizedScore: true,
      templateConfigId: true,
    },
  });
  const scoreByPatent = new Map(subSectorScores.map(s => [s.patentId, s]));

  // 4. Build union of all metric keys (sorted for stable column order)
  const allMetricKeys = new Set<string>();
  for (const s of subSectorScores) {
    const metrics = s.metrics as Record<string, MetricValue> | null;
    if (metrics) {
      for (const key of Object.keys(metrics)) {
        allMetricKeys.add(key);
      }
    }
  }
  const sortedMetricKeys = Array.from(allMetricKeys).sort();

  // 5. Build dynamic columns for metric scores and reasoning
  const dynamicScoreColumns = sortedMetricKeys.map(key => ({
    key: `${key}_score`,
    label: `${key}_score`,
  }));
  const dynamicReasoningColumns = sortedMetricKeys.map(key => ({
    key: `${key}_reasoning`,
    label: `${key}_reasoning`,
  }));

  // 6. Assemble all columns
  const allColumns = [
    ...FIXED_METADATA_COLUMNS,
    ...FOCUS_AREA_COLUMNS,
    ...SCORE_COLUMNS,
    ...EAV_NUMERIC_COLUMNS,
    ...EAV_TEXT_COLUMNS,
    ...dynamicScoreColumns,
    ...dynamicReasoningColumns,
  ];

  // 7. Build CSV header
  const header = allColumns.map(c => escapeCSV(c.label)).join(',');

  // 8. Build CSV rows
  const rows = patents.map(patent => {
    const patentRecord = patent as Record<string, unknown>;
    const subScore = scoreByPatent.get(patent.patent_id);
    const metrics = (subScore?.metrics as Record<string, MetricValue> | null) ?? {};

    return allColumns.map(col => {
      // Sub-sector scoring metadata
      if (col.key === 'sub_sector_composite_score') {
        return escapeCSV(subScore?.compositeScore ?? '');
      }
      if (col.key === 'sub_sector_rank') {
        return escapeCSV(subScore?.rankInSubSector ?? '');
      }
      if (col.key === 'scoring_template') {
        return escapeCSV(subScore?.templateConfigId ?? '');
      }

      // Dynamic metric score columns
      if (col.key.endsWith('_score') && !EAV_NUMERIC_COLUMNS.some(e => e.key === col.key)) {
        const metricKey = col.key.replace(/_score$/, '');
        if (sortedMetricKeys.includes(metricKey)) {
          return escapeCSV(metrics[metricKey]?.score ?? '');
        }
      }

      // Dynamic metric reasoning columns
      if (col.key.endsWith('_reasoning')) {
        const metricKey = col.key.replace(/_reasoning$/, '');
        if (sortedMetricKeys.includes(metricKey)) {
          return escapeCSV(metrics[metricKey]?.reasoning ?? '');
        }
      }

      // Fixed columns — read from PatentDTO
      return escapeCSV(patentRecord[col.key]);
    }).join(',');
  });

  const csv = [header, ...rows].join('\n');

  // 9. Build filename
  const slug = focusArea.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  const date = new Date().toISOString().split('T')[0];
  const filename = `litigation-package-${slug}-${date}.csv`;

  return {
    csv,
    filename,
    patentCount: patents.length,
    metricKeyCount: sortedMetricKeys.length,
  };
}
