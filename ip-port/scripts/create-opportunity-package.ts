/**
 * Create target-specific opportunity packages with product doc intelligence.
 *
 * Selects top Broadcom patents overlapping with a target company's products,
 * creates a Focus Area with enhanced LLM prompts that include product doc
 * summaries as "Target Product Intelligence", and exports the package.
 *
 * Usage:
 *   npx tsx scripts/create-opportunity-package.ts --target-company nutanix [options]
 *     --target-company <slug>   Target company (required)
 *     --product <slug>          Specific product (default: all products for company)
 *     --top <n>                 Patents per product (default: 25)
 *     --skip-llm                Create focus area only, no LLM execution
 *     --export-only             Export existing results only
 *
 * Requires: app server running on localhost:3001
 */

import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import {
  getAllProductCaches,
  readProductCache,
  getAllPatentCaches,
  type PatentCache,
} from '../src/api/services/patlytics-cache-service.js';

const prisma = new PrismaClient();
const BROADCOM_PORTFOLIO_NAME = 'broadcom-core';
const SUMMARIES_DIR = path.resolve('./cache/product-doc-summaries');

// Broadcom affiliates and subsidiaries — MUST be excluded from assertion targets
const BROADCOM_AFFILIATES = [
  'Broadcom', 'Avago', 'VMware', 'Symantec', 'CA Technologies',
  'Carbon Black', 'Nicira', 'VeloCloud', 'Blue Coat', 'Brocade',
  'LSI', 'Pivotal', 'Heptio', 'Emulex', 'NetLogic', 'PLX Technology',
  'SandForce', 'Lastline', 'Nyansa', 'Avi Networks', 'Agere',
  'CloudHealth', 'Cyoptics', 'AirWatch', 'Foundry Networks',
];
const AFFILIATE_PATTERN = new RegExp(
  BROADCOM_AFFILIATES.map(a => a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'i'
);

// ── Product-to-Sector Mapping (same as map-broadcom-target-overlap.ts) ────

const PRODUCT_SECTOR_MAP: Record<string, Record<string, string[]>> = {
  nutanix: {
    'nutanix-ahv': [
      'computing-systems', 'computing-runtime', 'network-switching',
      'network-signal-processing', 'computing-os-security',
    ],
    'nutanix-cloud-infrastructure-nci': [
      'computing-systems', 'computing-runtime', 'network-switching',
      'network-management', 'network-protocols', 'network-signal-processing',
    ],
    'flow-virtual-networking': [
      'network-switching', 'network-protocols', 'network-management',
      'network-signal-processing', 'network-multiplexing',
    ],
    'flow-network-security': [
      'network-threat-protection', 'network-auth-access', 'network-secure-compute',
      'network-switching',
    ],
  },
};

// Product slug aliases: maps a canonical product to its related slugs
// (used to aggregate doc summaries from multiple heatmap-created products)
const PRODUCT_ALIASES: Record<string, Record<string, string[]>> = {
  nutanix: {
    'nutanix-ahv': ['ahv', 'ahv-acropolis-hypervisor'],
    'nutanix-cloud-infrastructure-nci': ['nutanix-prism-central'],
    'flow-virtual-networking': ['flow-virtual-networking-fvn', 'nutanix-flow-virtual-networking'],
    'flow-network-security': ['nutanix-flow-network-security'],
  },
};

// ── Config ────────────────────────────────────────────────────────────────

interface Config {
  targetCompany: string;
  product: string | null;
  topN: number;
  skipLlm: boolean;
  exportOnly: boolean;
}

function parseArgs(): Config {
  const args = process.argv.slice(2);
  let targetCompany = '';
  let product: string | null = null;
  let topN = 25;
  let skipLlm = false;
  let exportOnly = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--target-company' && args[i + 1]) targetCompany = args[++i];
    else if (arg === '--product' && args[i + 1]) product = args[++i];
    else if (arg === '--top' && args[i + 1]) topN = parseInt(args[++i], 10);
    else if (arg === '--skip-llm') skipLlm = true;
    else if (arg === '--export-only') exportOnly = true;
  }

  if (!targetCompany) {
    console.error('Usage: npx tsx scripts/create-opportunity-package.ts --target-company <slug> [--product <slug>] [--top N]');
    process.exit(1);
  }

  return { targetCompany, product, topN, skipLlm, exportOnly };
}

// ── Assessment Questions (from create-sector-vendor-package.ts) ───────────

const ASSESSMENT_QUESTIONS = [
  {
    fieldName: 'infringement_detectability',
    question: 'How easily can infringement of this patent be detected WITHOUT internal product access? Consider: Can you detect use from product datasheets, teardown reports, published specifications, or standards compliance? Score 1=requires internal access, 5=detectable via careful external analysis, 10=obvious from product specifications.',
    answerType: 'numeric',
    constraints: { min: 1, max: 10 }
  },
  {
    fieldName: 'claim_mapping_strength',
    question: 'How well do the independent claims map to known competitor product implementations? Consider the claim elements and whether each element can be identified in real products. Score 1=poor mapping, 5=partial mapping, 10=strong mapping (all elements clearly present in commercial products).',
    answerType: 'numeric',
    constraints: { min: 1, max: 10 }
  },
  {
    fieldName: 'claim_mapping_summary',
    question: 'Which specific claim elements map to which products or product categories? Identify the broadest independent claim and map each element to concrete implementations. Be specific about which companies and products implement each element.',
    answerType: 'text'
  },
  {
    fieldName: 'standards_alignment',
    question: 'Which specific industry standards does this patent\'s technology map to? Consider relevant standards bodies and specifications. List specific standard references. If not standards-related, state \'Not standards-essential\'.',
    answerType: 'text_array'
  },
  {
    fieldName: 'target_products',
    question: 'List specific competitor products or product categories that likely implement this patented technology. Be concrete — name specific products, product families, or product lines. IMPORTANT: Do NOT list any Broadcom or Broadcom-subsidiary products. The following are all Broadcom affiliates and must be EXCLUDED: VMware, Symantec, CA Technologies, Carbon Black, Nicira, VeloCloud, Blue Coat, Brocade, LSI, Avago, Pivotal, Heptio, Emulex, NetLogic, PLX Technology, SandForce, Lastline, Nyansa, Avi Networks, Agere, CloudHealth, Cyoptics, AirWatch, Marvell.',
    answerType: 'text_array'
  },
  {
    fieldName: 'target_companies',
    question: 'Which companies are primary assertion targets for this patent? IMPORTANT EXCLUSIONS: Do NOT list Broadcom or any Broadcom subsidiary/affiliate. The following are ALL Broadcom affiliates — EXCLUDE every one: VMware, Symantec, CA Technologies, Carbon Black, Nicira, VeloCloud, Blue Coat, Brocade, LSI, Avago, Pivotal, Heptio, Emulex, NetLogic, PLX Technology, SandForce, Lastline, Nyansa, Avi Networks, Agere, CloudHealth, Cyoptics, AirWatch, Marvell. TARGETING RULES: You MUST list at least 5 smaller/mid-size companies (under $10B revenue) BEFORE listing any large company. Large companies (Cisco, Intel, Samsung, Qualcomm, Apple, Google, Microsoft, Amazon, Oracle, IBM) likely already have cross-licensing with Broadcom — list at most 2 of these and ONLY after the smaller targets. The best assertion targets are specialized companies with $200M-$5B revenue in this specific technology niche. Think about who the niche players, emerging competitors, and specialized vendors are in this technology area.',
    answerType: 'text_array'
  },
  {
    fieldName: 'prior_art_risk',
    question: 'How vulnerable is this patent to prior art challenge or IPR? Score 1=highly vulnerable, 5=moderate risk, 10=very defensible. Consider the filing date, breadth of claims, and likelihood of invalidation.',
    answerType: 'numeric',
    constraints: { min: 1, max: 10 }
  },
  {
    fieldName: 'prosecution_risk',
    question: 'Are there prosecution history estoppel concerns, claim construction risks, or other prosecution-related vulnerabilities?',
    answerType: 'text'
  },
  {
    fieldName: 'assertion_strategy',
    question: 'What is the recommended assertion approach? Choose: DIRECT (standard infringement suit), SEP_FRAND (standards-essential with FRAND obligations), CROSS_LICENSE (leverage in cross-licensing), DEFENSIVE (hold, not for assertion).',
    answerType: 'enum',
    constraints: { options: ['DIRECT', 'SEP_FRAND', 'CROSS_LICENSE', 'DEFENSIVE'] }
  },
  {
    fieldName: 'overall_litigation_score',
    question: 'Considering all factors — detectability, claim mapping, prior art risk, target market size, and assertion strategy — rate the overall litigation potential. Score 1=not recommended, 5=moderate potential, 10=excellent litigation candidate.',
    answerType: 'numeric',
    constraints: { min: 1, max: 10 }
  }
];

// ── Collective Strategy Prompt Builder (enhanced with product intelligence) ─

function buildCollectivePrompt(
  targetCompany: string,
  targetProductName: string,
  productIntelligence: string
): string {
  return `You are a patent litigation strategist analyzing Broadcom's patent portfolio for targeted assertion against ${targetCompany}'s ${targetProductName}.

Focus Area: <<focusArea.name>>
Description: <<focusArea.description>>
Patent Count: <<focusArea.patentCount>>

CRITICAL INSTRUCTION: You MUST reference ONLY the patents listed below by their exact patent_id. Do NOT invent, fabricate, or hallucinate patent numbers. Every patent ID you mention MUST appear in the data below.

CRITICAL EXCLUSION: The following companies are ALL Broadcom subsidiaries/affiliates and must NEVER be listed as competitors or assertion targets: VMware, Symantec, CA Technologies, Carbon Black, Nicira, VeloCloud, Blue Coat, Brocade, LSI, Avago, Pivotal, Heptio, Emulex, NetLogic, PLX Technology, SandForce, Lastline, Nyansa, Avi Networks, Agere, CloudHealth, Cyoptics, AirWatch, Marvell. If any of these appear in the patent data as assignees or citations, they are part of Broadcom's own portfolio — do NOT treat them as competitors.

Patent data for all <<focusArea.patentCount>> patents in this focus area:
<<focusArea.patentData>>

## TARGET PRODUCT INTELLIGENCE

The following is a technical analysis of ${targetCompany}'s ${targetProductName} product documentation, summarizing the technology implementations that may overlap with Broadcom's patents:

${productIntelligence}

---

Using ONLY the patents listed above and the target product intelligence, produce a comprehensive targeted assertion strategy:

## 1. Technology Clusters
Group the patents into technology clusters matching ${targetProductName}'s implementation areas. For each cluster:
- Cluster name and description
- Patent IDs in the cluster (MUST be from the list above)
- Specific ${targetProductName} features that overlap with this cluster
- Combined coverage strength against ${targetProductName}

## 2. Claim Chain Strategy
Which patents should be asserted TOGETHER against ${targetProductName} for maximum impact? Identify 3-5 assertion packages. For each:
- Patent IDs (MUST be from the list above)
- Combined claim coverage
- Specific ${targetProductName} features targeted
- Evidence from product documentation supporting infringement theory
- Estimated damages basis

## 3. ${targetCompany} Vulnerability Analysis
Detailed vulnerability assessment against ${targetProductName}:
- Number of patents likely infringed
- Most impactful patents with specific claim-to-feature mappings
- Product documentation evidence for each mapping
- Vulnerability level (HIGH/MEDIUM/LOW) per technology area
- Recommended assertion priority

## 4. Top 10 Patents Ranked by Assertion Potential Against ${targetProductName}
Rank the strongest candidates with:
- Patent ID, title
- Specific ${targetProductName} feature targeted
- Evidence from product documentation
- Key risk factors

## 5. Recommended Assertion Strategy
Design a multi-pronged strategy specifically for ${targetCompany}:
- Prong 1: Standards-essential (FRAND) patents
- Prong 2: Implementation-specific (DIRECT) patents with product doc evidence
- Prong 3: Cross-license leverage patents

For each prong: expected outcomes, timeline, risk factors.

## 6. Evidence Summary
Map each top patent to specific product documentation that supports the infringement theory:
| Patent ID | ${targetProductName} Feature | Documentation Evidence | Claim Elements Matched |

## 7. Risk Assessment
- Strongest counterarguments ${targetCompany} will raise
- Prior art exposure areas
- Product design-around possibilities
- Forum selection recommendations

Be specific. Reference patents by their exact patent_id from the data above. Map specific claim elements to specific ${targetProductName} features documented in the product intelligence above.`;
}

// ── CSV Helpers ───────────────────────────────────────────────────────────

function escapeCSV(value: string | number | boolean | null | undefined): string {
  if (value === undefined || value === null) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function csvRow(values: (string | number | boolean | null | undefined)[]): string {
  return values.map(escapeCSV).join(',');
}

// ── JSON Strategy → Markdown Converter ──────────────────────────────────

function jsonStrategyToMarkdown(obj: Record<string, any>): string {
  const lines: string[] = ['# Targeted Assertion Strategy\n'];

  // Technology Clusters
  if (obj.technology_clusters) {
    lines.push('## 1. Technology Clusters\n');
    for (const [key, cluster] of Object.entries(obj.technology_clusters) as [string, any][]) {
      lines.push(`### ${cluster.cluster_name || key}\n`);
      if (cluster.description) lines.push(`${cluster.description}\n`);
      if (cluster.patent_ids?.length) lines.push(`**Patents:** ${cluster.patent_ids.join(', ')}\n`);
      if (cluster.flow_features_overlap?.length || cluster.features_overlap?.length) {
        const features = cluster.flow_features_overlap || cluster.features_overlap || [];
        lines.push('**Overlapping Features:**');
        for (const f of features) lines.push(`- ${f}`);
        lines.push('');
      }
      if (cluster.coverage_strength) lines.push(`**Coverage Strength:** ${cluster.coverage_strength}\n`);
    }
  }

  // Claim Chain Strategy
  if (obj.claim_chain_strategy) {
    lines.push('## 2. Claim Chain Strategy\n');
    for (const [key, pkg] of Object.entries(obj.claim_chain_strategy) as [string, any][]) {
      lines.push(`### Package: ${pkg.name || key}\n`);
      if (pkg.patent_ids?.length) lines.push(`**Patents:** ${pkg.patent_ids.join(', ')}\n`);
      if (pkg.combined_coverage) lines.push(`**Combined Coverage:** ${pkg.combined_coverage}\n`);
      if (pkg.targeted_features?.length) {
        lines.push('**Targeted Features:**');
        for (const f of pkg.targeted_features) lines.push(`- ${f}`);
        lines.push('');
      }
      if (pkg.evidence) lines.push(`**Evidence:** ${pkg.evidence}\n`);
      if (pkg.damages_basis) lines.push(`**Damages Basis:** ${pkg.damages_basis}\n`);
    }
  }

  // Vulnerability Analysis
  if (obj.vulnerability_analysis) {
    lines.push('## 3. Vulnerability Analysis\n');
    const va = obj.vulnerability_analysis;
    for (const [key, val] of Object.entries(va)) {
      if (typeof val === 'string' || typeof val === 'number') {
        lines.push(`**${key.replace(/_/g, ' ')}:** ${val}\n`);
      } else if (Array.isArray(val)) {
        lines.push(`**${key.replace(/_/g, ' ')}:**`);
        for (const item of val) {
          if (typeof item === 'string') lines.push(`- ${item}`);
          else lines.push(`- ${JSON.stringify(item)}`);
        }
        lines.push('');
      } else if (typeof val === 'object' && val !== null) {
        lines.push(`### ${key.replace(/_/g, ' ')}\n`);
        for (const [k2, v2] of Object.entries(val as Record<string, any>)) {
          if (typeof v2 === 'object' && v2 !== null) {
            lines.push(`**${k2}:** ${v2.level || ''} - ${v2.description || v2.detail || JSON.stringify(v2)}\n`);
          } else {
            lines.push(`**${k2}:** ${v2}\n`);
          }
        }
      }
    }
  }

  // Top 10 Patents
  if (obj.top_10_patents_ranked?.length) {
    lines.push('## 4. Top 10 Patents Ranked by Assertion Potential\n');
    lines.push('| Rank | Patent ID | Title | Targeted Feature | Evidence | Risk Factors |');
    lines.push('|------|-----------|-------|------------------|----------|--------------|');
    for (const p of obj.top_10_patents_ranked) {
      lines.push(`| ${p.rank || ''} | ${p.patent_id || ''} | ${p.title || ''} | ${p.targeted_feature || ''} | ${p.evidence || ''} | ${p.risk_factors || ''} |`);
    }
    lines.push('');
  }

  // Recommended Assertion Strategy
  if (obj.recommended_assertion_strategy) {
    lines.push('## 5. Recommended Assertion Strategy\n');
    for (const [key, prong] of Object.entries(obj.recommended_assertion_strategy) as [string, any][]) {
      lines.push(`### ${prong.name || key.replace(/_/g, ' ')}\n`);
      if (prong.patents?.length) lines.push(`**Patents:** ${prong.patents.join(', ')}\n`);
      if (prong.expected_outcomes) lines.push(`**Expected Outcomes:** ${prong.expected_outcomes}\n`);
      if (prong.timeline) lines.push(`**Timeline:** ${prong.timeline}\n`);
      if (prong.risk_factors) lines.push(`**Risk Factors:** ${prong.risk_factors}\n`);
      if (prong.description) lines.push(`${prong.description}\n`);
    }
  }

  // Evidence Summary
  if (obj.evidence_summary) {
    lines.push('## 6. Evidence Summary\n');
    lines.push('| Patent ID | Feature | Documentation Evidence | Claim Elements |');
    lines.push('|-----------|---------|----------------------|----------------|');
    for (const [patId, ev] of Object.entries(obj.evidence_summary) as [string, any][]) {
      if (typeof ev === 'object' && ev !== null) {
        lines.push(`| ${patId} | ${ev.feature || ''} | ${ev.documentation || ''} | ${ev.claim_elements || ''} |`);
      }
    }
    lines.push('');
  }

  // Risk Assessment
  if (obj.risk_assessment) {
    lines.push('## 7. Risk Assessment\n');
    const ra = obj.risk_assessment;
    for (const [key, val] of Object.entries(ra)) {
      const label = key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      if (typeof val === 'string') {
        lines.push(`**${label}:** ${val}\n`);
      } else if (Array.isArray(val)) {
        lines.push(`**${label}:**`);
        for (const item of val) lines.push(`- ${typeof item === 'string' ? item : JSON.stringify(item)}`);
        lines.push('');
      }
    }
  }

  return lines.join('\n');
}

// ── Parse Collective Strategy ─────────────────────────────────────────────

interface PatentMappings {
  techCluster: Map<string, string>;
  claimChain: Map<string, string>;
}

function parseCollectiveStrategy(mdContent: string): PatentMappings {
  const techCluster = new Map<string, string>();
  const claimChain = new Map<string, string>();

  const clusterRegex = /###\s+Cluster\s+([A-Z]):[^\n]*\n\*\*Patents:\*\*\s*([^\n]+)/gi;
  let match;
  while ((match = clusterRegex.exec(mdContent)) !== null) {
    const patentNums = match[2].match(/\d{7,8}/g) || [];
    for (const num of patentNums) {
      techCluster.set(num, match[1]);
    }
  }

  const packageRegex = /###\s+Package\s+(\d+):[^\n]*\n\*\*Patents:\*\*\s*([^\n]+)/gi;
  while ((match = packageRegex.exec(mdContent)) !== null) {
    const patentNums = match[2].match(/\d{7,8}/g) || [];
    for (const num of patentNums) {
      const existing = claimChain.get(num);
      claimChain.set(num, existing ? `${existing},${match[1]}` : match[1]);
    }
  }

  return { techCluster, claimChain };
}

// ── Company Website Lookup ────────────────────────────────────────────────

async function buildCompanyWebsiteMap(): Promise<Map<string, string>> {
  try {
    const companies = await prisma.company.findMany({
      where: { website: { not: null } },
      select: { name: true, displayName: true, website: true },
    });
    const websiteMap = new Map<string, string>();
    for (const c of companies) {
      if (c.website) {
        websiteMap.set(c.name.toLowerCase(), c.website);
        websiteMap.set(c.displayName.toLowerCase(), c.website);
      }
    }
    return websiteMap;
  } catch {
    return new Map();
  }
}

function findCompanyWebsite(companyName: string, websiteMap: Map<string, string>): string {
  const lower = companyName.toLowerCase();
  if (websiteMap.has(lower)) return websiteMap.get(lower)!;
  for (const [key, url] of websiteMap) {
    if (lower.includes(key) || key.includes(lower)) return url;
  }
  return '';
}

// ── Resilient Fetch ───────────────────────────────────────────────────────

async function resilientFetch(url: string, options?: RequestInit, maxRetries = 5): Promise<Response> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fetch(url, options);
    } catch (err: any) {
      if (attempt === maxRetries) throw err;
      const delay = Math.min(5000 * attempt, 30000);
      console.log(`  [Retry ${attempt}/${maxRetries}] fetch failed (${err.code || err.message}), waiting ${delay / 1000}s...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw new Error('unreachable');
}

// ── Load Product Intelligence ─────────────────────────────────────────────

function loadProductIntelligence(companySlug: string, productSlug: string): string {
  // Load from primary slug and all alias slugs
  const aliases = PRODUCT_ALIASES[companySlug]?.[productSlug] || [];
  const allSlugs = [productSlug, ...aliases];

  const sections: string[] = [];
  const seenDocs = new Set<string>();

  for (const slug of allSlugs) {
    const productDir = path.join(SUMMARIES_DIR, companySlug, slug);
    if (!fs.existsSync(productDir)) continue;

    for (const file of fs.readdirSync(productDir).filter(f => f.endsWith('.json'))) {
      try {
        const summary = JSON.parse(fs.readFileSync(path.join(productDir, file), 'utf-8'));
        // Deduplicate by document name
        if (seenDocs.has(summary.documentName)) continue;
        seenDocs.add(summary.documentName);

        const s = summary.summary;
        let section = `### ${summary.documentName}\n`;
        if (s.executiveSummary) section += `${s.executiveSummary}\n\n`;
        if (s.sdnNfvFeatures?.length) section += `**SDN/NFV:** ${s.sdnNfvFeatures.join(', ')}\n`;
        if (s.networkSecurityCapabilities?.length) section += `**Security:** ${s.networkSecurityCapabilities.join(', ')}\n`;
        if (s.virtualSwitchingRouting?.length) section += `**Switching/Routing:** ${s.virtualSwitchingRouting.join(', ')}\n`;
        if (s.hypervisorVmManagement?.length) section += `**Hypervisor/VM:** ${s.hypervisorVmManagement.join(', ')}\n`;
        if (s.keyTechnologies?.length) section += `**Key Tech:** ${s.keyTechnologies.join(', ')}\n`;

        sections.push(section);
      } catch { /* skip */ }
    }
  }

  if (sections.length === 0) return '(No product documentation summaries available)';
  return sections.join('\n---\n\n');
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const config = parseArgs();

  console.log(`\n=== Opportunity Package: ${config.targetCompany} ===`);
  if (config.product) console.log(`Product: ${config.product}`);
  console.log(`Top patents: ${config.topN}`);
  if (config.skipLlm) console.log('MODE: Skip LLM');
  if (config.exportOnly) console.log('MODE: Export Only');

  const portfolio = await prisma.portfolio.findUnique({ where: { name: BROADCOM_PORTFOLIO_NAME } });
  if (!portfolio) { console.error('broadcom-core portfolio not found'); process.exit(1); }

  const sectorMap = PRODUCT_SECTOR_MAP[config.targetCompany];
  if (!sectorMap) {
    console.error(`No product-sector mapping for "${config.targetCompany}"`);
    process.exit(1);
  }

  // Filter to specific product if requested
  const productSlugs = config.product
    ? [config.product]
    : Object.keys(sectorMap);

  // Load heatmap data for scoring
  const heatmapPatents = getAllPatentCaches();
  const heatmapByPatent = new Map(heatmapPatents.map(p => [p.patentId, p]));

  const websiteMap = await buildCompanyWebsiteMap();

  for (const productSlug of productSlugs) {
    const sectors = sectorMap[productSlug];
    if (!sectors) {
      console.log(`\nNo sector mapping for product "${productSlug}" — skipping`);
      continue;
    }

    const productCache = readProductCache(config.targetCompany, productSlug);
    const productName = productCache?.productName || productSlug;

    console.log(`\n======== ${productName} (${productSlug}) ========`);
    console.log(`Sectors: ${sectors.join(', ')}`);

    // Select top patents across all relevant sectors
    const broadcomPatents = await prisma.patent.findMany({
      where: {
        primarySector: { in: sectors },
        isQuarantined: false,
        portfolios: { some: { portfolioId: portfolio.id } },
      },
      select: { patentId: true, title: true, primarySector: true },
    });

    const scores = await prisma.patentSubSectorScore.findMany({
      where: { patentId: { in: broadcomPatents.map(p => p.patentId) } },
      orderBy: { compositeScore: 'desc' },
    });
    const bestScoreByPatent = new Map<string, number>();
    for (const s of scores) {
      if (!bestScoreByPatent.has(s.patentId)) {
        bestScoreByPatent.set(s.patentId, s.compositeScore);
      }
    }

    // Rank by composite score + heatmap score
    const ranked = broadcomPatents
      .map(p => {
        const compositeScore = bestScoreByPatent.get(p.patentId) || 0;
        const heatmapScore = getHeatmapScore(heatmapByPatent.get(p.patentId), config.targetCompany, productSlug);
        return { ...p, compositeScore, heatmapScore, combinedScore: compositeScore + (heatmapScore * 50) };
      })
      .sort((a, b) => b.combinedScore - a.combinedScore)
      .slice(0, config.topN);

    console.log(`Selected ${ranked.length} patents (from ${broadcomPatents.length} candidates)`);
    if (ranked.length === 0) continue;

    // Print top
    console.log('\nTop patents:');
    for (const p of ranked.slice(0, 5)) {
      console.log(`  ${p.compositeScore.toFixed(1)} (hm:${p.heatmapScore.toFixed(2)}) | ${p.patentId} | ${p.title.substring(0, 50)}`);
    }

    const topPatentIds = ranked.map(p => p.patentId);

    // Load product intelligence
    const productIntel = loadProductIntelligence(config.targetCompany, productSlug);
    const hasIntel = !productIntel.includes('No product documentation summaries');
    console.log(`Product intelligence: ${hasIntel ? 'available' : 'not available'}`);

    // Create Focus Area name
    const faName = `${productName} Assertion Analysis`;
    const faDescription = `Broadcom patents for targeted assertion against ${config.targetCompany}'s ${productName}. ${ranked.length} patents selected from sectors: ${sectors.join(', ')}`;

    if (config.exportOnly) {
      const existingFA = await prisma.focusArea.findFirst({
        where: { name: faName },
        include: { promptTemplates: true },
      });
      if (existingFA) {
        await exportPackage(existingFA.id, config.targetCompany, productSlug, productName, productIntel, websiteMap);
      } else {
        console.log(`No existing focus area "${faName}" found for --export-only`);
      }
      continue;
    }

    // Create or find Focus Area
    let focusAreaId: string;
    const existingFA = await prisma.focusArea.findFirst({ where: { name: faName } });

    if (existingFA) {
      console.log(`\nFound existing FA: ${existingFA.name} (${existingFA.id})`);
      focusAreaId = existingFA.id;
    } else {
      const fa = await prisma.focusArea.create({
        data: {
          name: faName,
          description: faDescription,
          superSector: 'NETWORKING',
          primarySector: sectors[0],
          ownerId: 'default-user',
          status: 'ACTIVE',
          searchScopeType: 'SECTOR',
        },
      });
      focusAreaId = fa.id;
      console.log(`\nCreated FA: ${fa.name} (${fa.id})`);
    }

    // Add patents to focus area
    let addedCount = 0;
    for (const patentId of topPatentIds) {
      const existing = await prisma.focusAreaPatent.findFirst({
        where: { focusAreaId, patentId },
      });
      if (existing === null) {
        await prisma.focusAreaPatent.create({
          data: { focusAreaId, patentId, membershipType: 'MANUAL' },
        });
        addedCount++;
      }
    }
    console.log(`Added ${addedCount} patents to FA (${topPatentIds.length} total)`);

    await prisma.focusArea.update({
      where: { id: focusAreaId },
      data: { patentCount: await prisma.focusAreaPatent.count({ where: { focusAreaId } }) },
    });

    if (config.skipLlm) {
      console.log('\n--skip-llm: Focus area created. Run LLM jobs manually or remove --skip-llm.');
      continue;
    }

    // Create per-patent assessment template
    let assessmentTemplate = await prisma.promptTemplate.findFirst({
      where: { focusAreaId, executionMode: 'PER_PATENT' },
    });

    if (!assessmentTemplate) {
      assessmentTemplate = await prisma.promptTemplate.create({
        data: {
          focusAreaId,
          name: `${productName} Litigation Assessment`,
          description: `Per-patent litigation assessment for ${config.targetCompany} ${productName} assertion`,
          templateType: 'STRUCTURED',
          executionMode: 'PER_PATENT',
          questions: ASSESSMENT_QUESTIONS,
          contextFields: ['patent_id', 'title', 'abstract', 'claims', 'grant_date', 'assignee', 'cpc_codes', 'forward_citations', 'competitor_citations', 'competitor_names'],
          llmModel: 'claude-sonnet-4-20250514',
          status: 'DRAFT',
          completedCount: 0,
          totalCount: topPatentIds.length,
        },
      });
      console.log(`Created assessment template: ${assessmentTemplate.id}`);
    } else {
      console.log(`Found existing assessment template: ${assessmentTemplate.id}`);
    }

    // Create collective strategy template (enhanced with product intelligence)
    let collectiveTemplate = await prisma.promptTemplate.findFirst({
      where: { focusAreaId, executionMode: 'COLLECTIVE' },
    });

    if (!collectiveTemplate) {
      collectiveTemplate = await prisma.promptTemplate.create({
        data: {
          focusAreaId,
          name: `${productName} Targeted Assertion Strategy`,
          description: `Cross-patent strategy for ${config.targetCompany} ${productName} with product doc intelligence`,
          templateType: 'FREE_FORM',
          executionMode: 'COLLECTIVE',
          promptText: buildCollectivePrompt(config.targetCompany, productName, productIntel),
          contextFields: ['patent_id', 'title', 'abstract', 'claims', 'grant_date', 'assignee', 'cpc_codes', 'forward_citations', 'competitor_citations', 'competitor_names'],
          llmModel: 'claude-sonnet-4-20250514',
          status: 'DRAFT',
          completedCount: 0,
          totalCount: 1,
        },
      });
      console.log(`Created collective template: ${collectiveTemplate.id}`);
    } else {
      console.log(`Found existing collective template: ${collectiveTemplate.id}`);
    }

    // Execute templates via API
    console.log('\nExecuting per-patent assessment...');
    const assessRes = await resilientFetch(
      `http://localhost:3001/api/focus-areas/${focusAreaId}/prompt-templates/${assessmentTemplate.id}/execute`,
      { method: 'POST' },
    );
    console.log('Assessment execution:', await assessRes.json());

    // Poll for completion
    let done = false;
    while (!done) {
      await new Promise(r => setTimeout(r, 10000));
      const res = await resilientFetch(
        `http://localhost:3001/api/focus-areas/${focusAreaId}/prompt-templates/${assessmentTemplate.id}/status`,
      );
      const status = await res.json() as any;
      const pct = status.totalCount > 0 ? ((status.completedCount / status.totalCount) * 100).toFixed(0) : '0';
      console.log(`  Assessment: ${status.completedCount}/${status.totalCount} (${pct}%) - ${status.status}`);
      if (status.status === 'COMPLETE' || status.status === 'ERROR') done = true;
    }

    console.log('\nExecuting collective strategy...');
    const collectRes = await resilientFetch(
      `http://localhost:3001/api/focus-areas/${focusAreaId}/prompt-templates/${collectiveTemplate.id}/execute`,
      { method: 'POST' },
    );
    console.log('Collective execution:', await collectRes.json());

    done = false;
    while (!done) {
      await new Promise(r => setTimeout(r, 10000));
      const res = await resilientFetch(
        `http://localhost:3001/api/focus-areas/${focusAreaId}/prompt-templates/${collectiveTemplate.id}/status`,
      );
      const status = await res.json() as any;
      console.log(`  Collective: ${status.completedCount}/${status.totalCount} - ${status.status}`);
      if (status.status === 'COMPLETE' || status.status === 'ERROR') done = true;
    }

    // Export package
    await exportPackage(focusAreaId, config.targetCompany, productSlug, productName, productIntel, websiteMap);
  }

  await prisma.$disconnect();
}

// ── Export Package ─────────────────────────────────────────────────────────

async function exportPackage(
  focusAreaId: string,
  targetCompany: string,
  productSlug: string,
  productName: string,
  productIntel: string,
  websiteMap: Map<string, string>
) {
  const date = new Date().toISOString().split('T')[0];
  const outputDir = path.resolve(`./output/vendor-exports/${targetCompany}-${productSlug}-${date}`);
  fs.mkdirSync(outputDir, { recursive: true });

  const fa = await prisma.focusArea.findUnique({
    where: { id: focusAreaId },
    include: { promptTemplates: true },
  });
  if (!fa) { console.error('Focus area not found'); return; }

  const perPatentTemplate = fa.promptTemplates.find(t => t.executionMode === 'PER_PATENT');
  const collectiveTemplate = fa.promptTemplates.find(t => t.executionMode === 'COLLECTIVE');

  // Parse collective strategy for cluster/chain mappings
  let patentMappings: PatentMappings = { techCluster: new Map(), claimChain: new Map() };
  if (collectiveTemplate) {
    const collectivePath = path.resolve(`./cache/focus-area-prompts/${focusAreaId}/${collectiveTemplate.id}/_collective.json`);
    if (fs.existsSync(collectivePath)) {
      const result = JSON.parse(fs.readFileSync(collectivePath, 'utf-8'));
      const mdContent = result.rawText || result.response || '';
      patentMappings = parseCollectiveStrategy(mdContent);
    }
  }

  if (perPatentTemplate) {
    const resultDir = path.resolve(`./cache/focus-area-prompts/${focusAreaId}/${perPatentTemplate.id}`);
    if (fs.existsSync(resultDir)) {
      const files = fs.readdirSync(resultDir).filter(f => f.endsWith('.json') && f !== '_collective.json');
      console.log(`\nExporting ${files.length} per-patent results`);

      // Fetch titles
      const patentIds = files.map(f => f.replace('.json', ''));
      const patentRows = await prisma.patent.findMany({
        where: { patentId: { in: patentIds } },
        select: { patentId: true, title: true },
      });
      const titleMap = new Map(patentRows.map(p => [p.patentId, p.title || '']));

      type TargetEntry = {
        patentId: string; title: string; litScore: string; strategy: string;
        techCluster: string; claimChain: string; targets: string[];
        targetProducts: Map<string, string>; notes: string;
      };
      const entries: TargetEntry[] = [];
      let maxTargets = 0;

      for (const file of files) {
        const result = JSON.parse(fs.readFileSync(path.join(resultDir, file), 'utf-8'));
        const data = result.response || result.fields || {};
        const patentId = result.patentId || file.replace('.json', '');

        const ownerPatterns = AFFILIATE_PATTERN;
        const targetStr = (data.target_companies || '') as string;
        const rawTargets = targetStr.split(/,\s*/).map((t: string) => t.trim())
          .filter((t: string) => t.length > 0 && !ownerPatterns.test(t));
        const targets = rawTargets
          .map((t: string) => t.replace(/\s*\(.*$/, '').replace(/\).*$/, '')
            .replace(/\.\s*.*$/, '').replace(/\s*[-–—].*$/, '')
            .replace(/^(Primary|Secondary|Tertiary)\s+targets?:\s*/i, '').trim())
          .filter((t: string) => t.length > 0 && t.length < 50 && !/^(and|or|as|the|with|other|various)\b/i.test(t));
        if (targets.length > maxTargets) maxTargets = targets.length;

        const productStr = (data.target_products || '') as string;
        const notesParts: string[] = [];
        const targetProducts = new Map<string, string>();
        for (const target of targets) {
          const companyProducts = productStr.split(/,\s*(?=[A-Z])/)
            .filter((p: string) => p.toLowerCase().includes(target.toLowerCase()) && !ownerPatterns.test(p))
            .map((p: string) => p.trim());
          if (companyProducts.length > 0) {
            notesParts.push(`${target}: ${companyProducts.join(', ')}`);
            targetProducts.set(target, companyProducts.join(', '));
          }
        }
        if (notesParts.length === 0 && productStr.trim()) notesParts.push(productStr.trim());

        entries.push({
          patentId,
          title: titleMap.get(patentId) || '',
          litScore: data.overall_litigation_score ?? '',
          strategy: data.assertion_strategy ?? '',
          techCluster: patentMappings.techCluster.get(patentId) || '',
          claimChain: patentMappings.claimChain.get(patentId) || '',
          targets,
          targetProducts,
          notes: notesParts.join('; '),
        });
      }

      maxTargets = Math.max(maxTargets, 5);
      entries.sort((a, b) => Number(b.litScore || 0) - Number(a.litScore || 0));

      // vendor-targets.csv
      const targetHeaders = Array.from({ length: maxTargets }, (_, i) => `Target${i + 1}`);
      const headers = ['PatentId', 'Title', 'LitScore', 'Strategy', 'TechCluster', 'ClaimChain', ...targetHeaders, 'Notes'];
      const rows = [headers.join(',')];
      for (const e of entries) {
        const targetCells = Array.from({ length: maxTargets }, (_, i) => e.targets[i] || '');
        rows.push(csvRow([`US${e.patentId}B2`, e.title, e.litScore, e.strategy, e.techCluster, e.claimChain, ...targetCells, e.notes]));
      }
      fs.writeFileSync(path.join(outputDir, 'vendor-targets.csv'), rows.join('\n'));

      // vendor-targets-pivot.csv
      const pivotHeaders = ['PatentId', 'LitScore', 'Strategy', 'TechCluster', 'ClaimChain', 'Target', 'TargetProduct', 'TargetUrl'];
      const pivotRows = [pivotHeaders.join(',')];
      for (const e of entries) {
        for (const target of e.targets) {
          pivotRows.push(csvRow([
            `US${e.patentId}B2`, e.litScore, e.strategy, e.techCluster, e.claimChain,
            target, e.targetProducts.get(target) || '', findCompanyWebsite(target, websiteMap),
          ]));
        }
      }
      fs.writeFileSync(path.join(outputDir, 'vendor-targets-pivot.csv'), pivotRows.join('\n'));

      // tier1-assessment-results.csv
      const assessHeaders = [
        'patent_id', 'infringement_detectability', 'claim_mapping_strength',
        'prior_art_risk', 'assertion_strategy', 'overall_litigation_score',
        'target_companies', 'target_products', 'standards_alignment', 'claim_mapping_summary',
      ];
      const assessRows = [assessHeaders.join(',')];
      for (const file of files) {
        const result = JSON.parse(fs.readFileSync(path.join(resultDir, file), 'utf-8'));
        const data = result.response || result.fields || {};
        const patentId = result.patentId || file.replace('.json', '');
        assessRows.push(csvRow([
          patentId, data.infringement_detectability ?? '', data.claim_mapping_strength ?? '',
          data.prior_art_risk ?? '', data.assertion_strategy ?? '', data.overall_litigation_score ?? '',
          data.target_companies ?? '', data.target_products ?? '', data.standards_alignment ?? '',
          data.claim_mapping_summary ?? '',
        ]));
      }
      fs.writeFileSync(path.join(outputDir, 'tier1-assessment-results.csv'), assessRows.join('\n'));

      console.log(`  vendor-targets.csv: ${entries.length} patents`);
      console.log(`  vendor-targets-pivot.csv: ${pivotRows.length - 1} rows`);
      console.log(`  tier1-assessment-results.csv: ${files.length} patents`);
    }
  }

  // collective-strategy.md
  if (collectiveTemplate) {
    const collectivePath = path.resolve(`./cache/focus-area-prompts/${focusAreaId}/${collectiveTemplate.id}/_collective.json`);
    if (fs.existsSync(collectivePath)) {
      const result = JSON.parse(fs.readFileSync(collectivePath, 'utf-8'));
      const raw = result.rawText || result.response;
      const content = typeof raw === 'string' ? raw : jsonStrategyToMarkdown(raw ?? result);
      fs.writeFileSync(path.join(outputDir, 'collective-strategy.md'), content);
      console.log('  collective-strategy.md');
    }
  }

  // product-evidence.md — doc summaries mapped to patents
  const evidenceLines: string[] = [
    `# ${productName} Product Documentation Evidence\n`,
    `**Target:** ${targetCompany} / ${productName}`,
    `**Generated:** ${new Date().toISOString().split('T')[0]}\n`,
    '## Product Documentation Summaries\n',
    productIntel,
  ];
  fs.writeFileSync(path.join(outputDir, 'product-evidence.md'), evidenceLines.join('\n'));
  console.log('  product-evidence.md');

  // README.md
  const readme = `# ${targetCompany} ${productName} Opportunity Package

**Generated:** ${new Date().toISOString().split('T')[0]}
**Portfolio:** Broadcom Core (broadcom-core)
**Target:** ${targetCompany} / ${productName}
**Focus Area ID:** ${focusAreaId}

## Files

| File | Description |
|---|---|
| \`vendor-targets.csv\` | Per-patent litigation targets with TechCluster, ClaimChain |
| \`vendor-targets-pivot.csv\` | One row per patent-target pair |
| \`tier1-assessment-results.csv\` | Full per-patent assessment metrics |
| \`collective-strategy.md\` | ${productName}-targeted assertion strategy |
| \`product-evidence.md\` | Product doc summaries as assertion evidence |
| \`README.md\` | This file |
`;

  fs.writeFileSync(path.join(outputDir, 'README.md'), readme);
  console.log('  README.md');

  const fileCount = fs.readdirSync(outputDir).filter(f => !f.startsWith('.')).length;
  console.log(`\nDone. ${fileCount} files → ${outputDir}`);
}

// ── Heatmap Score Lookup ──────────────────────────────────────────────────

function getHeatmapScore(
  patentCache: PatentCache | undefined,
  targetCompanySlug: string,
  productSlug: string
): number {
  if (!patentCache) return 0;

  // Check primary slug and aliases
  const aliases = PRODUCT_ALIASES[targetCompanySlug]?.[productSlug] || [];
  const allSlugs = [productSlug, ...aliases];

  for (const prod of patentCache.products) {
    if (prod.companySlug === targetCompanySlug && allSlugs.includes(prod.productSlug)) {
      return prod.maxScore;
    }
  }
  for (const prod of patentCache.products) {
    if (prod.companySlug === targetCompanySlug) {
      return prod.maxScore;
    }
  }
  return 0;
}

main().catch(err => {
  console.error('Failed:', err);
  process.exit(1);
});
