/**
 * Sector Assignment Service
 *
 * DB-driven rule evaluation engine for assigning patents to sectors.
 * Replaces ad-hoc scripts with a systematic rule-based approach.
 */

import { PrismaClient, SectorRuleType } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

// Types for rule evaluation
interface SectorRuleRow {
  id: string;
  sectorId: string;
  sectorName: string;
  superSectorName: string | null;
  ruleType: SectorRuleType;
  expression: string;
  priority: number;
  isExclusion: boolean;
  scope: string;
  portfolioId: string | null;
}

interface PatentInput {
  patent_id: string;
  cpc_codes?: string[];
  patent_title?: string;
  abstract?: string | null;
}

export interface SectorAssignment {
  primarySector: string;
  superSector: string;
  matchedRules: Array<{
    ruleId: string;
    ruleType: string;
    expression: string;
    sectorName: string;
    priority: number;
  }>;
  confidence: number; // 0-1 based on number and quality of matches
}

export interface RulePreviewResult {
  matchCount: number;
  samplePatentIds: string[];
  overlapWithCurrentSector: number;
  newToSector: number;
}

// Rule cache with TTL
let ruleCache: SectorRuleRow[] | null = null;
let ruleCacheTime = 0;
const RULE_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Load all active sector rules from the DB, grouped and sorted.
 */
export async function loadSectorRules(): Promise<SectorRuleRow[]> {
  const now = Date.now();
  if (ruleCache && (now - ruleCacheTime) < RULE_CACHE_TTL) {
    return ruleCache;
  }

  const rules = await prisma.sectorRule.findMany({
    where: { isActive: true },
    include: {
      sector: {
        select: {
          name: true,
          superSector: { select: { name: true } },
        },
      },
    },
    orderBy: { priority: 'desc' },
  });

  ruleCache = rules.map(r => ({
    id: r.id,
    sectorId: r.sectorId,
    sectorName: r.sector.name,
    superSectorName: r.sector.superSector?.name ?? null,
    ruleType: r.ruleType,
    expression: r.expression,
    priority: r.priority,
    isExclusion: r.isExclusion,
    scope: r.scope,
    portfolioId: r.portfolioId,
  }));

  ruleCacheTime = now;
  return ruleCache;
}

/**
 * Clear the rule cache (after rule changes).
 */
export function clearRuleCache(): void {
  ruleCache = null;
  ruleCacheTime = 0;
}

/**
 * Evaluate a single patent against all sector rules.
 */
export async function assignSector(patent: PatentInput): Promise<SectorAssignment> {
  const rules = await loadSectorRules();
  const cpcCodes = patent.cpc_codes || [];
  const titleLower = (patent.patent_title || '').toLowerCase();
  const abstractLower = (patent.abstract || '').toLowerCase();
  const textContent = `${titleLower} ${abstractLower}`;

  // Collect all matching rules with their details
  const matches: Array<SectorRuleRow & { matchStrength: number }> = [];
  const exclusions = new Set<string>(); // sector names to exclude

  // Phase 1: CPC rules — sorted by expression length desc (most specific first)
  const cpcRules = rules
    .filter(r => r.ruleType === 'CPC_PREFIX' || r.ruleType === 'CPC_SUBGROUP')
    .sort((a, b) => b.expression.length - a.expression.length);

  for (const rule of cpcRules) {
    if (rule.isExclusion) {
      // Check if any CPC matches the exclusion
      const matches = matchCpcRule(rule, cpcCodes);
      if (matches) exclusions.add(rule.sectorName);
      continue;
    }

    if (matchCpcRule(rule, cpcCodes)) {
      matches.push({ ...rule, matchStrength: 1.0 });
    }
  }

  // Phase 2: Term rules — matched against title/abstract
  const termRules = rules.filter(r =>
    r.ruleType === 'KEYWORD' ||
    r.ruleType === 'PHRASE' ||
    r.ruleType === 'KEYWORD_AND' ||
    r.ruleType === 'BOOLEAN'
  );

  for (const rule of termRules) {
    if (rule.isExclusion) {
      if (matchTermRule(rule, textContent)) {
        exclusions.add(rule.sectorName);
      }
      continue;
    }

    if (matchTermRule(rule, textContent)) {
      matches.push({ ...rule, matchStrength: 0.8 });
    }
  }

  // Remove excluded sectors
  const validMatches = matches.filter(m => !exclusions.has(m.sectorName));

  if (validMatches.length === 0) {
    return {
      primarySector: 'general',
      superSector: 'COMPUTING',
      matchedRules: [],
      confidence: 0,
    };
  }

  // Sort by priority desc, then by match strength desc
  validMatches.sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    return b.matchStrength - a.matchStrength;
  });

  const best = validMatches[0];
  const confidence = Math.min(1.0, 0.3 + validMatches.length * 0.15);

  return {
    primarySector: best.sectorName,
    superSector: best.superSectorName || 'COMPUTING',
    matchedRules: validMatches.map(m => ({
      ruleId: m.id,
      ruleType: m.ruleType,
      expression: m.expression,
      sectorName: m.sectorName,
      priority: m.priority,
    })),
    confidence,
  };
}

/**
 * Batch evaluation — assigns sectors to multiple patents.
 */
export async function assignBatch(
  patents: PatentInput[]
): Promise<Map<string, SectorAssignment>> {
  // Pre-load rules once
  await loadSectorRules();

  const results = new Map<string, SectorAssignment>();
  for (const patent of patents) {
    results.set(patent.patent_id, await assignSector(patent));
  }
  return results;
}

/**
 * Preview what a proposed rule would match against portfolio patents.
 */
export async function previewRule(rule: {
  ruleType: SectorRuleType;
  expression: string;
  sectorId: string;
}): Promise<RulePreviewResult> {
  const patents = loadPortfolioPatents();
  const sector = await prisma.sector.findUnique({
    where: { id: rule.sectorId },
    select: { name: true },
  });
  const sectorName = sector?.name || '';

  let matchedIds: string[] = [];

  if (rule.ruleType === 'CPC_PREFIX' || rule.ruleType === 'CPC_SUBGROUP') {
    matchedIds = patents
      .filter(p => matchCpcRule(
        { ruleType: rule.ruleType, expression: rule.expression } as SectorRuleRow,
        p.cpc_codes || []
      ))
      .map(p => p.patent_id);
  } else {
    matchedIds = patents
      .filter(p => {
        const text = `${(p.patent_title || '').toLowerCase()} ${(p.abstract || '').toLowerCase()}`;
        return matchTermRule(
          { ruleType: rule.ruleType, expression: rule.expression } as SectorRuleRow,
          text
        );
      })
      .map(p => p.patent_id);
  }

  // Count how many already belong to this sector
  const currentSectorPatents = patents
    .filter(p => p.primary_sector === sectorName)
    .map(p => p.patent_id);
  const currentSet = new Set(currentSectorPatents);

  const overlapCount = matchedIds.filter(id => currentSet.has(id)).length;
  const newCount = matchedIds.filter(id => !currentSet.has(id)).length;

  return {
    matchCount: matchedIds.length,
    samplePatentIds: matchedIds.slice(0, 20),
    overlapWithCurrentSector: overlapCount,
    newToSector: newCount,
  };
}

/**
 * Recalculate patent counts for all sectors based on current portfolio data.
 */
export async function recalculatePatentCounts(): Promise<Record<string, number>> {
  const patents = loadPortfolioPatents();
  const sectorCounts = new Map<string, number>();

  for (const patent of patents) {
    const sector = patent.primary_sector || patent.sector || 'general';
    sectorCounts.set(sector, (sectorCounts.get(sector) || 0) + 1);
  }

  const result: Record<string, number> = {};
  const sectors = await prisma.sector.findMany({ select: { id: true, name: true } });

  for (const sector of sectors) {
    const count = sectorCounts.get(sector.name) || 0;
    await prisma.sector.update({
      where: { id: sector.id },
      data: { patentCount: count },
    });
    result[sector.name] = count;
  }

  return result;
}

/**
 * Recalculate patent count for a single sector.
 */
export async function recalculateSectorPatentCount(sectorId: string): Promise<number> {
  const sector = await prisma.sector.findUnique({
    where: { id: sectorId },
    select: { name: true },
  });
  if (!sector) throw new Error(`Sector not found: ${sectorId}`);

  const patents = loadPortfolioPatents();
  const count = patents.filter(
    p => (p.primary_sector || p.sector) === sector.name
  ).length;

  await prisma.sector.update({
    where: { id: sectorId },
    data: { patentCount: count },
  });

  return count;
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

function matchCpcRule(rule: Pick<SectorRuleRow, 'ruleType' | 'expression'>, cpcCodes: string[]): boolean {
  const expr = rule.expression.replace('/', '');

  if (rule.ruleType === 'CPC_SUBGROUP') {
    return cpcCodes.some(cpc => cpc.replace(/\//g, '') === expr);
  }

  // CPC_PREFIX: code starts with expression
  return cpcCodes.some(cpc => cpc.replace(/\//g, '').startsWith(expr));
}

function matchTermRule(rule: Pick<SectorRuleRow, 'ruleType' | 'expression'>, textContent: string): boolean {
  const exprLower = rule.expression.toLowerCase();

  switch (rule.ruleType) {
    case 'KEYWORD':
      // Any of the comma/space-separated keywords match
      return textContent.includes(exprLower);

    case 'PHRASE':
      return textContent.includes(exprLower);

    case 'KEYWORD_AND': {
      // All space-separated keywords must appear
      const keywords = exprLower.split(/\s+/).filter(k => k.length > 0);
      return keywords.every(kw => textContent.includes(kw));
    }

    case 'BOOLEAN': {
      // Simple boolean: supports AND, OR, NOT with parentheses
      return evaluateBoolean(exprLower, textContent);
    }

    default:
      return false;
  }
}

function evaluateBoolean(expr: string, text: string): boolean {
  // Simple recursive boolean parser for AND/OR/NOT
  // Tokenize: replace AND/OR/NOT with operators, handle parens
  const normalized = expr
    .replace(/\band\b/gi, '&&')
    .replace(/\bor\b/gi, '||')
    .replace(/\bnot\b/gi, '!');

  try {
    return evalBoolExpr(normalized, text);
  } catch {
    // Fallback: treat as simple keyword
    return text.includes(expr);
  }
}

function evalBoolExpr(expr: string, text: string): boolean {
  const trimmed = expr.trim();

  // Handle parentheses
  if (trimmed.startsWith('(') && findMatchingParen(trimmed, 0) === trimmed.length - 1) {
    return evalBoolExpr(trimmed.slice(1, -1), text);
  }

  // Split on OR (lowest precedence)
  const orParts = splitOnOperator(trimmed, '||');
  if (orParts.length > 1) {
    return orParts.some(part => evalBoolExpr(part, text));
  }

  // Split on AND
  const andParts = splitOnOperator(trimmed, '&&');
  if (andParts.length > 1) {
    return andParts.every(part => evalBoolExpr(part, text));
  }

  // Handle NOT
  if (trimmed.startsWith('!')) {
    return !evalBoolExpr(trimmed.slice(1), text);
  }

  // Base case: check if term exists in text
  const term = trimmed.replace(/['"]/g, '').trim();
  return text.includes(term);
}

function findMatchingParen(s: string, start: number): number {
  let depth = 0;
  for (let i = start; i < s.length; i++) {
    if (s[i] === '(') depth++;
    if (s[i] === ')') depth--;
    if (depth === 0) return i;
  }
  return -1;
}

function splitOnOperator(s: string, op: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';

  for (let i = 0; i < s.length; i++) {
    if (s[i] === '(') depth++;
    if (s[i] === ')') depth--;
    if (depth === 0 && s.substring(i, i + op.length) === op) {
      parts.push(current);
      current = '';
      i += op.length - 1;
    } else {
      current += s[i];
    }
  }
  parts.push(current);
  return parts.filter(p => p.trim().length > 0);
}

// Patent loader — loads from the candidates file (same pattern as patents.routes.ts)
interface PortfolioPatent {
  patent_id: string;
  patent_title?: string;
  abstract?: string | null;
  cpc_codes?: string[];
  primary_sector?: string;
  sector?: string;
  super_sector?: string;
}

let portfolioCache: PortfolioPatent[] | null = null;
let portfolioCacheTime = 0;
const PORTFOLIO_CACHE_TTL = 5 * 60 * 1000;

function loadPortfolioPatents(): PortfolioPatent[] {
  const now = Date.now();
  if (portfolioCache && (now - portfolioCacheTime) < PORTFOLIO_CACHE_TTL) {
    return portfolioCache;
  }

  const outputDir = path.join(process.cwd(), 'output');
  const files = fs.readdirSync(outputDir)
    .filter(f => f.startsWith('streaming-candidates-') && f.endsWith('.json'))
    .sort()
    .reverse();

  if (files.length === 0) {
    console.warn('[SectorAssignment] No candidates file found');
    return [];
  }

  const filePath = path.join(outputDir, files[0]);
  const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  portfolioCache = data.candidates || [];
  portfolioCacheTime = now;

  console.log(`[SectorAssignment] Loaded ${portfolioCache!.length} patents from ${files[0]}`);
  return portfolioCache!;
}
