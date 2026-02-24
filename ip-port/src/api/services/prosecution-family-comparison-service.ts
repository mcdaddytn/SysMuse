/**
 * Prosecution Family Comparison Service
 *
 * Compares prosecution timelines across patent family members to identify:
 * - Shared prior art cited across family members
 * - Parallel narrowing patterns (same limitations added in multiple family members)
 * - Survived challenges (which rejection bases were overcome across the family)
 * - Prosecution consistency (did continuations face the same or different challenges?)
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ProsecutionTimelineData, PriorArtReference, EstoppelArgument, SurvivedBasis } from '../../../types/office-action-types.js';

const PROSECUTION_ANALYSIS_CACHE_DIR = path.join(process.cwd(), 'cache/prosecution-analysis');

export interface FamilyProsecutionComparison {
  familyPatentIds: string[];
  analyzedPatentIds: string[];

  // Shared prior art across family
  sharedPriorArt: Array<{
    designation: string;
    referenceType: string;
    citedInPatents: string[];
    totalClaimsAffected: number;
  }>;

  // Parallel narrowing patterns
  parallelNarrowing: Array<{
    description: string;
    patentIds: string[];
    claimNumbers: Record<string, number[]>;
  }>;

  // Prosecution difficulty comparison
  difficultyComparison: Array<{
    patentId: string;
    prosecutionScore: number;
    totalRejections: number;
    totalRCEs: number;
    estoppelCount: number;
  }>;

  // Common rejection bases across family
  commonRejectionBases: Array<{
    basis: string;
    patentIds: string[];
    overcomeCount: number;
  }>;

  // Strategy insights
  insights: string[];
}

/**
 * Compare prosecution timelines across patent family members.
 */
export function compareFamilyProsecution(familyPatentIds: string[]): FamilyProsecutionComparison {
  // Load prosecution analysis for each family member
  const timelines = new Map<string, ProsecutionTimelineData>();
  for (const pid of familyPatentIds) {
    const cachePath = path.join(PROSECUTION_ANALYSIS_CACHE_DIR, `${pid}.json`);
    if (fs.existsSync(cachePath)) {
      try {
        const data = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
        timelines.set(pid, data);
      } catch {
        // Skip corrupted files
      }
    }
  }

  const analyzedIds = Array.from(timelines.keys());
  if (analyzedIds.length === 0) {
    return {
      familyPatentIds,
      analyzedPatentIds: [],
      sharedPriorArt: [],
      parallelNarrowing: [],
      difficultyComparison: [],
      commonRejectionBases: [],
      insights: ['No prosecution analysis data available for any family member.'],
    };
  }

  // 1. Find shared prior art
  const priorArtByRef = new Map<string, { ref: PriorArtReference; patents: Set<string>; totalClaims: number }>();
  for (const [pid, tl] of timelines) {
    for (const art of tl.citedPriorArt || []) {
      const key = art.designation;
      if (!priorArtByRef.has(key)) {
        priorArtByRef.set(key, { ref: art, patents: new Set(), totalClaims: 0 });
      }
      const entry = priorArtByRef.get(key)!;
      entry.patents.add(pid);
      entry.totalClaims += (art.relevantClaims || []).length;
    }
  }

  const sharedPriorArt = Array.from(priorArtByRef.values())
    .filter(e => e.patents.size > 1)
    .map(e => ({
      designation: e.ref.designation,
      referenceType: e.ref.referenceType,
      citedInPatents: Array.from(e.patents),
      totalClaimsAffected: e.totalClaims,
    }))
    .sort((a, b) => b.citedInPatents.length - a.citedInPatents.length);

  // 2. Find parallel narrowing patterns
  const narrowingByDesc = new Map<string, { patents: Map<string, number[]> }>();
  for (const [pid, tl] of timelines) {
    for (const nc of tl.narrowedClaims || []) {
      const desc = (nc.narrowingDescription || nc.addressedRejection || 'unknown').toLowerCase();
      if (!narrowingByDesc.has(desc)) {
        narrowingByDesc.set(desc, { patents: new Map() });
      }
      const entry = narrowingByDesc.get(desc)!;
      if (!entry.patents.has(pid)) entry.patents.set(pid, []);
      entry.patents.get(pid)!.push(nc.claimNumber);
    }
  }

  const parallelNarrowing = Array.from(narrowingByDesc.entries())
    .filter(([_, e]) => e.patents.size > 1)
    .map(([desc, e]) => ({
      description: desc,
      patentIds: Array.from(e.patents.keys()),
      claimNumbers: Object.fromEntries(e.patents),
    }));

  // 3. Prosecution difficulty comparison
  const difficultyComparison = analyzedIds.map(pid => {
    const tl = timelines.get(pid)!;
    return {
      patentId: pid,
      prosecutionScore: tl.prosecutionScore,
      totalRejections: tl.totalRejections,
      totalRCEs: tl.totalRCEs,
      estoppelCount: (tl.estoppelArguments || []).length,
    };
  }).sort((a, b) => b.prosecutionScore - a.prosecutionScore);

  // 4. Common rejection bases
  const basisByType = new Map<string, { patents: Set<string>; overcomeCount: number }>();
  for (const [pid, tl] of timelines) {
    for (const oa of tl.officeActions || []) {
      for (const rej of oa.claimRejections || []) {
        const basis = rej.statutoryBasis;
        if (!basisByType.has(basis)) basisByType.set(basis, { patents: new Set(), overcomeCount: 0 });
        basisByType.get(basis)!.patents.add(pid);
      }
    }
    for (const sb of tl.survivedBases || []) {
      if (basisByType.has(sb.statutoryBasis)) {
        basisByType.get(sb.statutoryBasis)!.overcomeCount++;
      }
    }
  }

  const commonRejectionBases = Array.from(basisByType.entries())
    .filter(([_, e]) => e.patents.size > 1)
    .map(([basis, e]) => ({
      basis,
      patentIds: Array.from(e.patents),
      overcomeCount: e.overcomeCount,
    }));

  // 5. Generate insights
  const insights: string[] = [];
  if (sharedPriorArt.length > 0) {
    insights.push(`${sharedPriorArt.length} prior art reference(s) cited across multiple family members — potential coordinated defense opportunity.`);
  }
  if (parallelNarrowing.length > 0) {
    insights.push(`${parallelNarrowing.length} parallel narrowing pattern(s) detected — family members may have similar scope limitations.`);
  }

  const scores = difficultyComparison.map(d => d.prosecutionScore);
  const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
  if (avgScore >= 4) {
    insights.push('Family has clean prosecution history overall (avg score >= 4) — strong enforceability signal.');
  } else if (avgScore <= 2) {
    insights.push('Family has difficult prosecution history (avg score <= 2) — potential estoppel concerns across family.');
  }

  const continuationPatents = difficultyComparison.filter(d => d.prosecutionScore > avgScore);
  if (continuationPatents.length > 0 && analyzedIds.length > 1) {
    insights.push(`${continuationPatents.length}/${analyzedIds.length} family members scored above average — consider prioritizing these for assertion.`);
  }

  return {
    familyPatentIds,
    analyzedPatentIds: analyzedIds,
    sharedPriorArt,
    parallelNarrowing,
    difficultyComparison,
    commonRejectionBases,
    insights,
  };
}
