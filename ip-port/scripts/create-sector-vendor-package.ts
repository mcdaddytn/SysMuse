/**
 * Create Sector-Level Vendor Package
 *
 * End-to-end script that:
 *   1. Selects top N broadcom patents in a sector by composite score
 *   2. Creates a Focus Area with those patents
 *   3. Creates a per-patent STRUCTURED assessment template
 *   4. Creates a COLLECTIVE free-form strategy template
 *   5. Executes both templates (LLM jobs)
 *   6. Exports vendor package (vendor-targets.csv, collective-strategy.md, etc.)
 *
 * Usage: npx tsx scripts/create-sector-vendor-package.ts <SECTOR_NAME> [--top=N] [--skip-llm] [--export-only]
 * Example: npx tsx scripts/create-sector-vendor-package.ts computing-runtime --top=35
 */

import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();
const BROADCOM_PORTFOLIO_NAME = 'broadcom-core';

// ─── Parse Collective Strategy for Patent Mappings ───────────────────────────

interface PatentMappings {
  techCluster: Map<string, string>;   // patentId -> "A", "B", "C", etc.
  claimChain: Map<string, string>;    // patentId -> "1", "2", "3", etc.
}

function parseCollectiveStrategy(mdContent: string): PatentMappings {
  const techCluster = new Map<string, string>();
  const claimChain = new Map<string, string>();

  const clusterRegex = /###\s+Cluster\s+([A-Z]):[^\n]*\n\*\*Patents:\*\*\s*([^\n]+)/gi;
  let match;
  while ((match = clusterRegex.exec(mdContent)) !== null) {
    const clusterLetter = match[1];
    const patentNums = match[2].match(/\d{7,8}/g) || [];
    for (const num of patentNums) {
      techCluster.set(num, clusterLetter);
    }
  }

  const packageRegex = /###\s+Package\s+(\d+):[^\n]*\n\*\*Patents:\*\*\s*([^\n]+)/gi;
  while ((match = packageRegex.exec(mdContent)) !== null) {
    const packageNum = match[1];
    const patentNums = match[2].match(/\d{7,8}/g) || [];
    for (const num of patentNums) {
      const existing = claimChain.get(num);
      claimChain.set(num, existing ? `${existing},${packageNum}` : packageNum);
    }
  }

  return { techCluster, claimChain };
}

// ─── Company Website Lookup ──────────────────────────────────────────────────

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
    // Company table may not exist in all environments
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

// ─── CLI Args ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const sectorName = args.find(a => !a.startsWith('--'));
const topN = parseInt(args.find(a => a.startsWith('--top='))?.split('=')[1] || '35');
const skipLlm = args.includes('--skip-llm');
const exportOnly = args.includes('--export-only');

if (!sectorName) {
  console.error('Usage: npx tsx scripts/create-sector-vendor-package.ts <SECTOR_NAME> [--top=N] [--skip-llm] [--export-only]');
  process.exit(1);
}

// ─── Assessment Questions (same as SEMICONDUCTOR) ─────────────────────────────

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
    question: 'List specific competitor products or product categories that likely implement this patented technology. Be concrete — name specific products, product families, or product lines.',
    answerType: 'text_array'
  },
  {
    fieldName: 'target_companies',
    question: 'Which companies are primary assertion targets for this patent? Consider: (1) Who manufactures products implementing this technology? (2) Who has the largest market share / highest volumes? (3) Who is most likely already using this technology?',
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

// ─── Collective Strategy Prompt Builder ───────────────────────────────────────

function buildCollectivePrompt(sectorDisplayName: string): string {
  return `You are a patent litigation strategist analyzing Broadcom's patent portfolio in the ${sectorDisplayName} technology area for assertion against competitors.

Focus Area: <<focusArea.name>>
Description: <<focusArea.description>>
Patent Count: <<focusArea.patentCount>>

CRITICAL INSTRUCTION: You MUST reference ONLY the patents listed below by their exact patent_id. Do NOT invent, fabricate, or hallucinate patent numbers. Every patent ID you mention MUST appear in the data below. If you are unsure about a patent, omit it rather than guess.

Patent data for all <<focusArea.patentCount>> patents in this focus area:
<<focusArea.patentData>>

Using ONLY the patents listed above, produce a comprehensive litigation strategy document with the following sections:

## 1. Technology Clusters
Group the patents into technology clusters — sets of patents covering the same technology from different angles. For each cluster:
- Cluster name and description
- Patent IDs in the cluster (MUST be from the list above)
- Why these patents reinforce each other
- Combined coverage strength

## 2. Claim Chain Strategy
Which patents should be asserted TOGETHER for maximum impact? Identify 3-5 assertion packages of 3-6 patents each. For each package:
- Patent IDs (MUST be from the list above)
- The combined claim coverage
- Which competitors are most exposed
- Estimated damages basis

## 3. Competitor Vulnerability Matrix
For each major competitor that appears in the patent data above:
- Number of patents likely infringed
- Most impactful patents against this competitor (by patent_id from the list above)
- Vulnerability level (HIGH/MEDIUM/LOW)
- Recommended assertion priority

## 4. Top 10 Patents Ranked by Litigation Potential
Rank the 10 strongest litigation candidates with reasoning:
- Patent ID (from the list above), title
- Why this patent is strong for litigation
- Recommended assertion strategy
- Key risk factors

## 5. Recommended Assertion Strategy
Design a multi-pronged litigation strategy identifying:
- Prong 1: Standards-essential (FRAND) — which patents, which standards, which companies
- Prong 2: Implementation-specific (DIRECT) — which patents target specific implementations detectable via external analysis
- Prong 3: Cross-license leverage — which patents are best used as negotiating chips

For each prong: expected outcomes, timeline, risk factors.

## 6. Risk Assessment
- Strongest counterarguments competitors will raise
- Prior art exposure areas
- Prosecution history concerns
- Forum selection recommendations

Be specific. Reference patents by their exact patent_id from the data above. Reference specific claim elements from the claims data provided. Cite specific competitor products.`;
}

// ─── CSV Helpers ──────────────────────────────────────────────────────────────

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

// ─── Resilient Fetch ──────────────────────────────────────────────────────────

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

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n=== Sector Vendor Package: ${sectorName} ===`);
  console.log(`Top N: ${topN}, Skip LLM: ${skipLlm}, Export Only: ${exportOnly}\n`);

  // Validate sector exists
  const sector = await prisma.sector.findFirst({ where: { name: sectorName } });
  if (sector === null) {
    console.error(`Sector "${sectorName}" not found in database`);
    process.exit(1);
  }
  console.log(`Sector: ${sector.displayName} (${sector.name})`);
  console.log(`Super-sector: ${sector.superSectorId}`);

  // Get broadcom portfolio
  const portfolio = await prisma.portfolio.findUnique({ where: { name: BROADCOM_PORTFOLIO_NAME } });
  if (portfolio === null) {
    console.error('broadcom-core portfolio not found');
    process.exit(1);
  }

  // Get broadcom patent IDs in this sector
  const broadcomPatents = await prisma.patent.findMany({
    where: {
      primarySector: sectorName,
      isQuarantined: false,
      portfolios: { some: { portfolioId: portfolio.id } }
    },
    select: { patentId: true }
  });
  const broadcomIds = broadcomPatents.map(p => p.patentId);
  console.log(`Broadcom patents in sector: ${broadcomIds.length}`);

  // Get scores and rank
  const allScores = await prisma.patentSubSectorScore.findMany({
    where: { patentId: { in: broadcomIds } },
    orderBy: { compositeScore: 'desc' },
  });

  // Deduplicate to best per patent
  const bestByPatent = new Map<string, (typeof allScores)[0]>();
  for (const s of allScores) {
    if (!bestByPatent.has(s.patentId)) {
      bestByPatent.set(s.patentId, s);
    }
  }
  const ranked = [...bestByPatent.entries()]
    .sort((a, b) => b[1].compositeScore - a[1].compositeScore);

  console.log(`Scored patents: ${ranked.length}`);
  console.log(`Top score: ${ranked[0]?.[1].compositeScore.toFixed(1) || 'n/a'}`);

  // Select top N
  const topPatentIds = ranked.slice(0, topN).map(([id]) => id);
  const topScores = ranked.slice(0, topN);
  console.log(`\nSelected top ${topPatentIds.length} patents for vendor package`);
  console.log(`Score range: ${topScores[topScores.length - 1]?.[1].compositeScore.toFixed(1)} - ${topScores[0]?.[1].compositeScore.toFixed(1)}`);

  // Print top patents summary
  const patentDetails = await prisma.patent.findMany({
    where: { patentId: { in: topPatentIds } },
    select: { patentId: true, title: true, assignee: true }
  });
  const detailMap = new Map(patentDetails.map(p => [p.patentId, p]));

  console.log('\nTop patents:');
  for (const [id, score] of topScores.slice(0, 10)) {
    const d = detailMap.get(id);
    console.log(`  ${score.compositeScore.toFixed(1)} | ${id} | ${(d?.title || '').substring(0, 60)}`);
  }
  if (topScores.length > 10) console.log(`  ... and ${topScores.length - 10} more`);

  if (exportOnly) {
    console.log('\n--export-only: Skipping focus area creation and LLM jobs');
    // Find existing focus area
    const existingFA = await prisma.focusArea.findFirst({
      where: {
        primarySector: sectorName,
        name: { contains: 'Crown' }
      },
      include: { promptTemplates: true }
    });
    if (existingFA) {
      console.log(`Found existing FA: ${existingFA.name} (${existingFA.id})`);
      await exportVendorPackage(existingFA.id, sectorName, sector.displayName || sectorName);
    } else {
      console.error('No existing focus area found for --export-only');
    }
    await prisma.$disconnect();
    return;
  }

  // ── Step 1: Create Focus Area ──
  console.log('\n--- Step 1: Creating Focus Area ---');

  // Check for existing FA
  const existingFA = await prisma.focusArea.findFirst({
    where: {
      primarySector: sectorName,
      name: { contains: 'Crown' }
    }
  });

  let focusAreaId: string;
  if (existingFA) {
    console.log(`Found existing FA: ${existingFA.name} (${existingFA.id})`);
    focusAreaId = existingFA.id;
  } else {
    // Get super-sector name
    const superSector = await prisma.superSector.findFirst({ where: { id: sector.superSectorId || '' } });
    const ssName = superSector?.name || 'COMPUTING';

    const fa = await prisma.focusArea.create({
      data: {
        name: `${sector.displayName || sectorName} Crown Jewels`,
        description: `Top ${topN} highest-scoring broadcom patents in ${sector.displayName || sectorName} for litigation vendor assessment`,
        superSector: ssName,
        primarySector: sectorName,
        ownerId: 'default-user',
        status: 'ACTIVE',
        searchScopeType: 'SECTOR',
      }
    });
    focusAreaId = fa.id;
    console.log(`Created FA: ${fa.name} (${fa.id})`);
  }

  // Add patents to focus area (upsert)
  let addedCount = 0;
  for (const patentId of topPatentIds) {
    const existing = await prisma.focusAreaPatent.findFirst({
      where: { focusAreaId, patentId }
    });
    if (existing === null) {
      await prisma.focusAreaPatent.create({
        data: {
          focusAreaId,
          patentId,
          membershipType: 'MANUAL'
        }
      });
      addedCount++;
    }
  }
  console.log(`Added ${addedCount} patents to FA (${topPatentIds.length} total)`);

  // Update patent count on FA
  const totalPatents = await prisma.focusAreaPatent.count({ where: { focusAreaId } });
  await prisma.focusArea.update({
    where: { id: focusAreaId },
    data: { patentCount: totalPatents }
  });

  if (skipLlm) {
    console.log('\n--skip-llm: Focus area created. Run LLM jobs manually via the GUI or remove --skip-llm.');
    console.log(`Focus Area ID: ${focusAreaId}`);
    await prisma.$disconnect();
    return;
  }

  // ── Step 2: Create Per-Patent Assessment Template ──
  console.log('\n--- Step 2: Creating Per-Patent Assessment Template ---');

  let assessmentTemplate = await prisma.promptTemplate.findFirst({
    where: {
      focusAreaId,
      executionMode: 'PER_PATENT'
    }
  });

  if (assessmentTemplate) {
    console.log(`Found existing assessment template: ${assessmentTemplate.name} (${assessmentTemplate.id})`);
  } else {
    assessmentTemplate = await prisma.promptTemplate.create({
      data: {
        focusAreaId,
        name: `${sector.displayName || sectorName} Litigation Assessment`,
        description: `Per-patent litigation assessment for top ${sectorName} patents`,
        templateType: 'STRUCTURED',
        executionMode: 'PER_PATENT',
        questions: ASSESSMENT_QUESTIONS,
        contextFields: ['patent_id', 'title', 'abstract', 'claims', 'grant_date', 'assignee', 'cpc_codes', 'forward_citations'],
        llmModel: 'claude-sonnet-4-20250514',
        status: 'DRAFT',
        completedCount: 0,
        totalCount: topPatentIds.length,
      }
    });
    console.log(`Created assessment template: ${assessmentTemplate.name} (${assessmentTemplate.id})`);
  }

  // ── Step 3: Create Collective Strategy Template ──
  console.log('\n--- Step 3: Creating Collective Strategy Template ---');

  let collectiveTemplate = await prisma.promptTemplate.findFirst({
    where: {
      focusAreaId,
      executionMode: 'COLLECTIVE'
    }
  });

  if (collectiveTemplate) {
    console.log(`Found existing collective template: ${collectiveTemplate.name} (${collectiveTemplate.id})`);
  } else {
    collectiveTemplate = await prisma.promptTemplate.create({
      data: {
        focusAreaId,
        name: `${sector.displayName || sectorName} Collective Litigation Strategy`,
        description: `Cross-patent litigation strategy for top ${sectorName} patents`,
        templateType: 'FREE_FORM',
        executionMode: 'COLLECTIVE',
        promptText: buildCollectivePrompt(sector.displayName || sectorName),
        contextFields: ['patent_id', 'title', 'abstract', 'claims', 'grant_date', 'assignee', 'cpc_codes', 'forward_citations'],
        llmModel: 'claude-sonnet-4-20250514',
        status: 'DRAFT',
        completedCount: 0,
        totalCount: 1,
      }
    });
    console.log(`Created collective template: ${collectiveTemplate.name} (${collectiveTemplate.id})`);
  }

  // ── Step 4: Execute Templates via API ──
  console.log('\n--- Step 4: Executing LLM Templates ---');
  console.log('Executing per-patent assessment...');

  const assessResponse = await resilientFetch(
    `http://localhost:3001/api/focus-areas/${focusAreaId}/prompt-templates/${assessmentTemplate.id}/execute`,
    { method: 'POST' }
  );
  const assessResult = await assessResponse.json();
  console.log('Assessment execution:', JSON.stringify(assessResult));

  // Poll for completion
  console.log('\nPolling per-patent assessment progress...');
  let assessDone = false;
  while (!assessDone) {
    await new Promise(r => setTimeout(r, 10000)); // 10s poll interval
    const statusRes = await resilientFetch(
      `http://localhost:3001/api/focus-areas/${focusAreaId}/prompt-templates/${assessmentTemplate.id}/status`
    );
    const status = await statusRes.json() as any;
    const pct = status.totalCount > 0 ? ((status.completedCount / status.totalCount) * 100).toFixed(0) : '0';
    console.log(`  Assessment: ${status.completedCount}/${status.totalCount} (${pct}%) - ${status.status}`);
    if (status.status === 'COMPLETE' || status.status === 'ERROR') {
      assessDone = true;
      if (status.status === 'ERROR') {
        console.error('Assessment failed:', status.errorMessage);
      }
    }
  }

  console.log('\nExecuting collective strategy...');
  const collectResponse = await resilientFetch(
    `http://localhost:3001/api/focus-areas/${focusAreaId}/prompt-templates/${collectiveTemplate.id}/execute`,
    { method: 'POST' }
  );
  const collectResult = await collectResponse.json();
  console.log('Collective execution:', JSON.stringify(collectResult));

  // Poll for collective completion
  let collectDone = false;
  while (!collectDone) {
    await new Promise(r => setTimeout(r, 10000));
    const statusRes = await resilientFetch(
      `http://localhost:3001/api/focus-areas/${focusAreaId}/prompt-templates/${collectiveTemplate.id}/status`
    );
    const status = await statusRes.json() as any;
    console.log(`  Collective: ${status.completedCount}/${status.totalCount} - ${status.status}`);
    if (status.status === 'COMPLETE' || status.status === 'ERROR') {
      collectDone = true;
      if (status.status === 'ERROR') {
        console.error('Collective strategy failed:', status.errorMessage);
      }
    }
  }

  // ── Step 5: Export Vendor Package ──
  console.log('\n--- Step 5: Exporting Vendor Package ---');
  await exportVendorPackage(focusAreaId, sectorName, sector.displayName || sectorName);

  await prisma.$disconnect();
}

// ─── Export Vendor Package ────────────────────────────────────────────────────

async function exportVendorPackage(focusAreaId: string, sectorName: string, sectorDisplayName: string) {
  const date = new Date().toISOString().split('T')[0];
  const outputDir = path.resolve(`./output/vendor-exports/${sectorName}-${date}`);
  fs.mkdirSync(outputDir, { recursive: true });

  const fa = await prisma.focusArea.findUnique({
    where: { id: focusAreaId },
    include: { promptTemplates: true }
  });
  if (fa === null) { console.error('Focus area not found'); return; }

  const perPatentTemplate = fa.promptTemplates.find(t => t.executionMode === 'PER_PATENT');
  const collectiveTemplate = fa.promptTemplates.find(t => t.executionMode === 'COLLECTIVE');

  // Load collective strategy for tech cluster and claim chain mappings
  let patentMappings: PatentMappings = { techCluster: new Map(), claimChain: new Map() };
  if (collectiveTemplate) {
    const collectivePath = path.resolve(`./cache/focus-area-prompts/${focusAreaId}/${collectiveTemplate.id}/_collective.json`);
    if (fs.existsSync(collectivePath)) {
      const result = JSON.parse(fs.readFileSync(collectivePath, 'utf-8'));
      const mdContent = result.rawText || result.response || '';
      patentMappings = parseCollectiveStrategy(mdContent);
      console.log(`  Parsed collective strategy: ${patentMappings.techCluster.size} cluster mappings, ${patentMappings.claimChain.size} chain mappings`);
    }
  }

  // Load company websites for target URL lookup
  const websiteMap = await buildCompanyWebsiteMap();
  console.log(`  Loaded ${Math.floor(websiteMap.size / 2)} company websites`);

  if (perPatentTemplate) {
    const resultDir = path.resolve(`./cache/focus-area-prompts/${focusAreaId}/${perPatentTemplate.id}`);
    if (fs.existsSync(resultDir)) {
      const files = fs.readdirSync(resultDir).filter(f => f.endsWith('.json') && f !== '_collective.json');
      console.log(`Found ${files.length} per-patent assessment results`);

      // Extended entry type with cluster/chain info and per-target products
      type TargetEntry = {
        patentId: string;
        title: string;
        litScore: string;
        strategy: string;
        techCluster: string;
        claimChain: string;
        targets: string[];
        targetProducts: Map<string, string>;
        notes: string;
      };
      const entries: TargetEntry[] = [];
      let maxTargets = 0;

      // Fetch patent titles
      const patentIds = files.map(f => f.replace('.json', ''));
      const patentRows = await prisma.patent.findMany({
        where: { patentId: { in: patentIds } },
        select: { patentId: true, title: true },
      });
      const titleMap = new Map(patentRows.map(p => [p.patentId, p.title || '']));

      for (const file of files) {
        const result = JSON.parse(fs.readFileSync(path.join(resultDir, file), 'utf-8'));
        const data = result.response || result.fields || {};
        const patentId = result.patentId || file.replace('.json', '');

        const ownerPatterns = /\b(broadcom|avago)\b/i;
        const targetStr = (data.target_companies || '') as string;
        const rawTargets = targetStr.split(/,\s*/).map((t: string) => t.trim())
          .filter((t: string) => t.length > 0 && !ownerPatterns.test(t));
        const targets = rawTargets
          .map((t: string) => t.replace(/\s*\(.*$/, '').replace(/\).*$/, '')
            .replace(/\.\s*.*$/, '').replace(/\s*[-–—].*$/, '')
            .replace(/^(Primary|Secondary|Tertiary)\s+targets?:\s*/i, '').trim())
          .filter((t: string) => t.length > 0 && t.length < 50 && !/^(and|or|as|the|with|other|various)\b/i.test(t));
        if (targets.length > maxTargets) maxTargets = targets.length;

        // Build notes and target-specific products
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

      // Build vendor-targets.csv (wide format with TechCluster and ClaimChain)
      const targetHeaders = Array.from({ length: maxTargets }, (_, i) => `Target${i + 1}`);
      const headers = ['PatentId', 'Title', 'LitScore', 'Strategy', 'TechCluster', 'ClaimChain', ...targetHeaders, 'Notes'];
      const rows = [headers.join(',')];
      for (const e of entries) {
        const targetCells = Array.from({ length: maxTargets }, (_, i) => e.targets[i] || '');
        rows.push(csvRow([`US${e.patentId}B2`, e.title, e.litScore, e.strategy, e.techCluster, e.claimChain, ...targetCells, e.notes]));
      }
      fs.writeFileSync(path.join(outputDir, 'vendor-targets.csv'), rows.join('\n'));
      console.log(`  vendor-targets.csv: ${entries.length} patents, ${maxTargets} target columns (with TechCluster, ClaimChain)`);

      // Build vendor-targets-pivot.csv (long format: one row per patent-target pair)
      const pivotHeaders = ['PatentId', 'LitScore', 'Strategy', 'TechCluster', 'ClaimChain', 'Target', 'TargetProduct', 'TargetUrl'];
      const pivotRows = [pivotHeaders.join(',')];
      for (const e of entries) {
        for (const target of e.targets) {
          const targetProduct = e.targetProducts.get(target) || '';
          const targetUrl = findCompanyWebsite(target, websiteMap);
          pivotRows.push(csvRow([
            `US${e.patentId}B2`, e.litScore, e.strategy, e.techCluster, e.claimChain,
            target, targetProduct, targetUrl,
          ]));
        }
      }
      fs.writeFileSync(path.join(outputDir, 'vendor-targets-pivot.csv'), pivotRows.join('\n'));
      console.log(`  vendor-targets-pivot.csv: ${pivotRows.length - 1} rows (patent-target pairs)`);

      // Build tier1-assessment-results.csv
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
      console.log(`  tier1-assessment-results.csv: ${files.length} patents`);
    } else {
      console.log('  No per-patent assessment results found');
    }
  }

  // Write collective strategy
  if (collectiveTemplate) {
    const collectivePath = path.resolve(`./cache/focus-area-prompts/${focusAreaId}/${collectiveTemplate.id}/_collective.json`);
    if (fs.existsSync(collectivePath)) {
      const result = JSON.parse(fs.readFileSync(collectivePath, 'utf-8'));
      const content = result.rawText || result.response || JSON.stringify(result, null, 2);
      fs.writeFileSync(path.join(outputDir, 'collective-strategy.md'), content);
      console.log('  collective-strategy.md');
    } else {
      console.log('  No collective strategy result found');
    }
  }

  // Write README
  const readme = `# ${sectorDisplayName} Sector Vendor Export Package

**Generated:** ${new Date().toISOString().split('T')[0]}
**Portfolio:** Broadcom Core (broadcom-core)
**Sector:** ${sectorName} (${sectorDisplayName})
**Focus Area ID:** ${focusAreaId}

## Files

| File | Description |
|---|---|
| \`vendor-targets.csv\` | Per-patent litigation targets with TechCluster, ClaimChain, companies and products |
| \`vendor-targets-pivot.csv\` | One row per patent-target pair with TargetProduct and TargetUrl |
| \`tier1-assessment-results.csv\` | Full per-patent assessment metrics |
| \`collective-strategy.md\` | Cross-patent litigation strategy narrative |
| \`README.md\` | This file |
`;

  fs.writeFileSync(path.join(outputDir, 'README.md'), readme);
  console.log(`  README.md`);

  const fileCount = fs.readdirSync(outputDir).filter(f => !f.startsWith('.')).length;
  console.log(`\nDone. ${fileCount} files written to ${outputDir}`);
}

// ─── Run ──────────────────────────────────────────────────────────────────────

main().catch(err => {
  console.error('Failed:', err);
  process.exit(1);
});
