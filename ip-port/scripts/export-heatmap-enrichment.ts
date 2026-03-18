#!/usr/bin/env npx tsx
/**
 * Export patent enrichment data for heatmap summary package.
 *
 * Joins heatmap patent cache with:
 *   - Vendor package data (TechCluster, ClaimChain, Strategy, LitScore, claim mapping)
 *   - Database sector/super-sector assignments
 *   - Collective strategy damages basis
 *
 * Outputs: patent-enrichment.csv — one row per patent, keyed by PatentId for joining
 *
 * Usage:
 *   npx tsx scripts/export-heatmap-enrichment.ts [--output-dir <path>]
 */

import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';
import type { PatentCache } from '../src/api/services/patlytics-cache-service';

const args = process.argv.slice(2);
function getArg(name: string, defaultVal: string): string {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : defaultVal;
}

const OUTPUT_DIR = getArg('output-dir', 'output/heatmap-summary');
const CACHE_BASE = path.join(process.cwd(), 'cache', 'patlytics');
const PATENTS_DIR = path.join(CACHE_BASE, 'patents');
const VENDOR_EXPORTS_DIR = path.join(process.cwd(), 'output', 'vendor-exports');

// ── CSV Helpers ─────────────────────────────────────────────────────────────

function csvEscape(val: string | number | null | undefined): string {
  if (val === null || val === undefined) return '';
  const s = String(val);
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function csvRow(fields: (string | number | null | undefined)[]): string {
  return fields.map(csvEscape).join(',');
}

/** Parse a simple CSV line (handles quoted fields with commas) */
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        fields.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
  }
  fields.push(current);
  return fields;
}

// ── Types ───────────────────────────────────────────────────────────────────

interface VendorTargetData {
  packageName: string;
  litScore: string;
  strategy: string;
  techCluster: string;
  claimChain: string;
}

interface Tier1Data {
  packageName: string;
  infringementDetectability: string;
  claimMappingStrength: string;
  priorArtRisk: string;
  assertionStrategy: string;
  overallLitigationScore: string;
  targetCompanies: string;
  targetProducts: string;
  standardsAlignment: string;
  claimMappingSummary: string;
}

interface DamagesData {
  packageName: string;
  damagesBasis: string;
}

// ── Load Vendor Package Data ────────────────────────────────────────────────

function loadVendorTargets(): Map<string, VendorTargetData> {
  const map = new Map<string, VendorTargetData>();

  if (!fs.existsSync(VENDOR_EXPORTS_DIR)) return map;

  for (const pkg of fs.readdirSync(VENDOR_EXPORTS_DIR)) {
    const csvPath = path.join(VENDOR_EXPORTS_DIR, pkg, 'vendor-targets.csv');
    if (!fs.existsSync(csvPath)) continue;

    const lines = fs.readFileSync(csvPath, 'utf-8').split('\n').filter(l => l.trim());
    if (lines.length < 2) continue;

    const headers = parseCsvLine(lines[0]);
    const litScoreIdx = headers.indexOf('LitScore');
    const strategyIdx = headers.indexOf('Strategy');
    const clusterIdx = headers.indexOf('TechCluster');
    const chainIdx = headers.indexOf('ClaimChain');
    const patentIdx = headers.indexOf('PatentId');

    for (let i = 1; i < lines.length; i++) {
      const fields = parseCsvLine(lines[i]);
      const rawId = fields[patentIdx] || '';
      // Extract numeric patent ID from "US10484677B2" format
      const match = rawId.match(/(\d{6,8})/);
      if (!match) continue;
      const patentId = match[1];

      // Keep first (or highest lit score) entry per patent
      if (!map.has(patentId)) {
        map.set(patentId, {
          packageName: pkg,
          litScore: fields[litScoreIdx] || '',
          strategy: fields[strategyIdx] || '',
          techCluster: fields[clusterIdx] || '',
          claimChain: fields[chainIdx] || '',
        });
      }
    }
  }

  return map;
}

function loadTier1Assessments(): Map<string, Tier1Data> {
  const map = new Map<string, Tier1Data>();

  if (!fs.existsSync(VENDOR_EXPORTS_DIR)) return map;

  for (const pkg of fs.readdirSync(VENDOR_EXPORTS_DIR)) {
    const csvPath = path.join(VENDOR_EXPORTS_DIR, pkg, 'tier1-assessment-results.csv');
    if (!fs.existsSync(csvPath)) continue;

    const lines = fs.readFileSync(csvPath, 'utf-8').split('\n').filter(l => l.trim());
    if (lines.length < 2) continue;

    const headers = parseCsvLine(lines[0]);
    const colMap: Record<string, number> = {};
    headers.forEach((h, idx) => { colMap[h] = idx; });

    for (let i = 1; i < lines.length; i++) {
      const fields = parseCsvLine(lines[i]);
      const rawId = fields[colMap['patent_id']] || '';
      const match = rawId.match(/(\d{6,8})/);
      if (!match) continue;
      const patentId = match[1];

      if (!map.has(patentId)) {
        map.set(patentId, {
          packageName: pkg,
          infringementDetectability: fields[colMap['infringement_detectability']] || '',
          claimMappingStrength: fields[colMap['claim_mapping_strength']] || '',
          priorArtRisk: fields[colMap['prior_art_risk']] || '',
          assertionStrategy: fields[colMap['assertion_strategy']] || '',
          overallLitigationScore: fields[colMap['overall_litigation_score']] || '',
          targetCompanies: fields[colMap['target_companies']] || '',
          targetProducts: fields[colMap['target_products']] || '',
          standardsAlignment: fields[colMap['standards_alignment']] || '',
          claimMappingSummary: fields[colMap['claim_mapping_summary']] || '',
        });
      }
    }
  }

  return map;
}

/** Parse damages basis from collective-strategy.md — look for "Damages Basis" lines */
function loadDamagesBasis(): Map<string, DamagesData> {
  const map = new Map<string, DamagesData>();

  if (!fs.existsSync(VENDOR_EXPORTS_DIR)) return map;

  for (const pkg of fs.readdirSync(VENDOR_EXPORTS_DIR)) {
    const mdPath = path.join(VENDOR_EXPORTS_DIR, pkg, 'collective-strategy.md');
    if (!fs.existsSync(mdPath)) continue;

    const content = fs.readFileSync(mdPath, 'utf-8');

    // Find "Damages Basis" entries and associated patents
    // Pattern: ### Package N: ... \n**Patents:** 1234, 5678\n... **Damages Basis:** ...
    const sections = content.split(/###\s+/);
    for (const section of sections) {
      const patentsMatch = section.match(/\*\*Patents:\*\*\s*([^\n]+)/);
      const damagesMatch = section.match(/\*\*Damages Basis:\*\*\s*([^\n]+)/);

      if (patentsMatch && damagesMatch) {
        const patentIds = patentsMatch[1].match(/\d{6,8}/g) || [];
        const damages = damagesMatch[1].trim();

        for (const pid of patentIds) {
          if (!map.has(pid)) {
            map.set(pid, { packageName: pkg, damagesBasis: damages });
          }
        }
      }
    }
  }

  return map;
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== Heatmap Enrichment Export ===\n');

  // Load heatmap patent cache
  const patentFiles = fs.readdirSync(PATENTS_DIR).filter(f => f.endsWith('.json'));
  const patents: PatentCache[] = [];
  for (const file of patentFiles) {
    patents.push(JSON.parse(fs.readFileSync(path.join(PATENTS_DIR, file), 'utf-8')));
  }
  patents.sort((a, b) => {
    if (b.maxScoreOverall !== a.maxScoreOverall) return b.maxScoreOverall - a.maxScoreOverall;
    if (b.hotProductCount !== a.hotProductCount) return b.hotProductCount - a.hotProductCount;
    return a.patentId.localeCompare(b.patentId);
  });
  console.log(`Loaded ${patents.length} heatmap patents`);

  // Load vendor package data
  const vendorTargets = loadVendorTargets();
  console.log(`Loaded vendor targets for ${vendorTargets.size} patents`);

  const tier1 = loadTier1Assessments();
  console.log(`Loaded tier1 assessments for ${tier1.size} patents`);

  const damages = loadDamagesBasis();
  console.log(`Loaded damages basis for ${damages.size} patents`);

  // Load sector/super-sector from DB
  const prisma = new PrismaClient();
  const patentIds = patents.map(p => p.patentId);
  const dbPatents = await prisma.patent.findMany({
    where: { patentId: { in: patentIds } },
    select: { patentId: true, superSector: true, primarySector: true },
  });
  const dbMap = new Map(dbPatents.map(p => [p.patentId, p]));
  console.log(`Loaded DB sector data for ${dbMap.size} patents`);
  await prisma.$disconnect();

  // ── Build enrichment CSV ────────────────────────────────────────────────

  const headers = [
    'Rank',
    'PatentId',
    'FullPatentId',
    'Title',
    'MaxHeatmapScore',
    'HotTier',
    'HotProductCount',
    'SuperSector',
    'PrimarySector',
    'VendorPackage',
    'TechCluster',
    'ClaimChain',
    'Strategy',
    'LitScore',
    'InfringementDetectability',
    'ClaimMappingStrength',
    'PriorArtRisk',
    'DamagesBasis',
    'StandardsAlignment',
    'ClaimMappingSummary',
  ];

  const rows: string[] = [csvRow(headers)];
  let matchedVendor = 0;
  let matchedTier1 = 0;
  let matchedDb = 0;

  for (let i = 0; i < patents.length; i++) {
    const p = patents[i];
    const vt = vendorTargets.get(p.patentId);
    const t1 = tier1.get(p.patentId);
    const dmg = damages.get(p.patentId);
    const db = dbMap.get(p.patentId);

    if (vt) matchedVendor++;
    if (t1) matchedTier1++;
    if (db) matchedDb++;

    let hotTier = 'COOL';
    if (p.maxScoreOverall >= 0.95) hotTier = 'VERY_HOT';
    else if (p.maxScoreOverall >= 0.80) hotTier = 'HOT';
    else if (p.maxScoreOverall >= 0.60) hotTier = 'WARM';

    rows.push(csvRow([
      i + 1,
      p.patentId,
      p.fullPatentId,
      p.title,
      p.maxScoreOverall.toFixed(2),
      hotTier,
      p.hotProductCount,
      db?.superSector || '',
      db?.primarySector || '',
      vt?.packageName || t1?.packageName || '',
      vt?.techCluster || '',
      vt?.claimChain || '',
      vt?.strategy || t1?.assertionStrategy || '',
      vt?.litScore || t1?.overallLitigationScore || '',
      t1?.infringementDetectability || '',
      t1?.claimMappingStrength || '',
      t1?.priorArtRisk || '',
      dmg?.damagesBasis || '',
      t1?.standardsAlignment || '',
      t1?.claimMappingSummary || '',
    ]));
  }

  // Write output
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const outPath = path.join(OUTPUT_DIR, 'patent-enrichment.csv');
  fs.writeFileSync(outPath, rows.join('\n'));

  console.log(`\n=== Output ===`);
  console.log(`  ${outPath} — ${patents.length} patents`);
  console.log(`\n=== Match Rates ===`);
  console.log(`  Vendor package data: ${matchedVendor}/${patents.length} (${(matchedVendor / patents.length * 100).toFixed(0)}%)`);
  console.log(`  Tier1 assessments:   ${matchedTier1}/${patents.length} (${(matchedTier1 / patents.length * 100).toFixed(0)}%)`);
  console.log(`  Damages basis:       ${damages.size}/${patents.length}`);
  console.log(`  DB sector data:      ${matchedDb}/${patents.length} (${(matchedDb / patents.length * 100).toFixed(0)}%)`);
  console.log('\nDone!');
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
