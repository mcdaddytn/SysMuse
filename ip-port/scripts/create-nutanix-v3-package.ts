/**
 * Create Nutanix V3 Discovery Package
 *
 * Selects top V3-scored patents across all Nutanix-relevant sectors,
 * combines with existing Nutanix Litigation Targets, creates a focus area,
 * runs Nutanix-specific per-patent assessments and collective strategy,
 * then exports the vendor package.
 *
 * Usage:
 *   npx tsx scripts/create-nutanix-v3-package.ts [--top=50] [--skip-llm]
 */

import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();
const BROADCOM_PORTFOLIO_NAME = 'broadcom-core';

const NUTANIX_SECTORS = [
  'computing-runtime', 'computing-systems', 'computing-ui', 'data-retrieval',
  'fintech-business', 'power-management',
  'network-error-control', 'network-management', 'network-multiplexing',
  'network-protocols', 'network-signal-processing', 'network-switching',
  'streaming-multimedia', 'telephony',
  'computing-auth-boot', 'computing-data-protection', 'computing-os-security',
  'network-auth-access', 'network-crypto', 'network-secure-compute',
  'network-threat-protection', 'wireless-security',
];

// Broadcom affiliates — MUST be excluded from assertion targets
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

// ─── Assessment Questions (same as sector vendor packages) ─────────────────

const ASSESSMENT_QUESTIONS = [
  {
    fieldName: 'infringement_detectability',
    question: 'How easily can infringement of this patent be detected by analyzing Nutanix products WITHOUT internal product access? Consider: Can you detect use from Nutanix product datasheets, the Nutanix Bible, published specifications, or Nutanix documentation? Score 1=requires internal access, 5=detectable via careful external analysis, 10=obvious from Nutanix product specifications.',
    answerType: 'numeric',
    constraints: { min: 1, max: 10 }
  },
  {
    fieldName: 'claim_mapping_strength',
    question: 'How well do the independent claims map to known Nutanix product implementations (AHV, NCI, Flow Virtual Networking, Flow Network Security, Prism Central)? Consider the claim elements and whether each element can be identified in Nutanix products. Score 1=poor mapping, 5=partial mapping, 10=strong mapping (all elements clearly present in Nutanix products).',
    answerType: 'numeric',
    constraints: { min: 1, max: 10 }
  },
  {
    fieldName: 'claim_mapping_summary',
    question: 'Which specific claim elements map to which Nutanix products or product features? Identify the broadest independent claim and map each element to concrete Nutanix implementations. Be specific about which Nutanix products (AHV, NCI, Flow Virtual Networking, Flow Network Security, Prism Central) implement each element.',
    answerType: 'text'
  },
  {
    fieldName: 'standards_alignment',
    question: 'Which specific industry standards does this patent\'s technology map to? Consider relevant standards bodies and specifications. List specific standard references. If not standards-related, state \'Not standards-essential\'.',
    answerType: 'text_array'
  },
  {
    fieldName: 'target_products',
    question: 'List specific Nutanix products or product features that likely implement this patented technology. Focus on: Nutanix AHV (KVM/QEMU hypervisor, Open vSwitch, OVN, live migration, memory overcommit), Nutanix Cloud Infrastructure (NCI), Flow Virtual Networking (VPC, Geneve tunneling, BGP routing, virtual routers), Flow Network Security (microsegmentation, OVS/OpenFlow policies), Prism Central (management plane). Be specific about which features or subsystems overlap.',
    answerType: 'text_array'
  },
  {
    fieldName: 'target_companies',
    question: 'Is Nutanix the primary assertion target for this patent? Also list any other companies whose products implement similar technology. IMPORTANT: Do NOT list Broadcom or any Broadcom subsidiary/affiliate (VMware, Symantec, CA Technologies, Carbon Black, Nicira, VeloCloud, Blue Coat, Brocade, LSI, Avago, Pivotal, Heptio, Emulex, NetLogic, PLX Technology, SandForce, Lastline, Nyansa, Avi Networks, Agere, CloudHealth, Cyoptics, AirWatch, Marvell). List Nutanix first, then other companies that may also infringe.',
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
    question: 'What is the recommended assertion approach against Nutanix? Choose: DIRECT (standard infringement suit), SEP_FRAND (standards-essential with FRAND obligations), CROSS_LICENSE (leverage in cross-licensing), DEFENSIVE (hold, not for assertion).',
    answerType: 'enum',
    constraints: { options: ['DIRECT', 'SEP_FRAND', 'CROSS_LICENSE', 'DEFENSIVE'] }
  },
  {
    fieldName: 'overall_litigation_score',
    question: 'Considering all factors — detectability against Nutanix products, claim mapping to AHV/NCI/Flow/Prism, prior art risk, target market size, and assertion strategy — rate the overall litigation potential against Nutanix. Score 1=not recommended, 5=moderate potential, 10=excellent litigation candidate.',
    answerType: 'numeric',
    constraints: { min: 1, max: 10 }
  }
];

// ─── Resilient Fetch ──────────────────────────────────────────────────────

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

// ─── CSV Helpers ──────────────────────────────────────────────────────────

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

// ─── Main ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const topN = parseInt(args.find(a => a.startsWith('--top='))?.split('=')[1] || '50');
const skipLlm = args.includes('--skip-llm');

async function main() {
  console.log('\n=== Nutanix V3 Discovery Package ===');
  console.log(`Top N: ${topN}, Skip LLM: ${skipLlm}\n`);

  // 1. Resolve portfolio and V3 snapshot
  const portfolio = await prisma.portfolio.findUnique({
    where: { name: BROADCOM_PORTFOLIO_NAME },
    select: { id: true },
  });
  if (!portfolio) { console.error('broadcom-core portfolio not found'); process.exit(1); }

  const v3Snapshot = await prisma.scoreSnapshot.findFirst({
    where: { scoreType: 'V3', isActive: true, portfolioId: portfolio.id },
    select: { id: true, name: true },
  });
  if (!v3Snapshot) { console.error('No active V3 snapshot found'); process.exit(1); }
  console.log(`V3 Snapshot: ${v3Snapshot.name}`);

  // 2. Get existing Nutanix FA patent IDs (to include them too)
  const existingNutanixFAs = await prisma.focusArea.findMany({
    where: { name: { contains: 'Nutanix Litigation Targets' } },
    select: { id: true },
  });
  const existingPatentIds = new Set<string>();
  for (const fa of existingNutanixFAs) {
    const faPatents = await prisma.focusAreaPatent.findMany({
      where: { focusAreaId: fa.id },
      select: { patentId: true },
    });
    for (const p of faPatents) existingPatentIds.add(p.patentId);
  }
  console.log(`Existing Nutanix Litigation Targets: ${existingPatentIds.size} patents`);

  // 3. Get top V3 patents from Nutanix sectors
  const sectorPatents = await prisma.patent.findMany({
    where: {
      primarySector: { in: NUTANIX_SECTORS },
      isQuarantined: false,
      portfolios: { some: { portfolioId: portfolio.id } },
    },
    select: { patentId: true },
  });
  const sectorPatentIds = sectorPatents.map(p => p.patentId);

  const v3Entries = await prisma.patentScoreEntry.findMany({
    where: {
      snapshotId: v3Snapshot.id,
      patentId: { in: sectorPatentIds },
    },
    orderBy: { score: 'desc' },
    select: { patentId: true, score: true, rank: true },
  });
  console.log(`V3-scored patents in Nutanix sectors: ${v3Entries.length}`);

  // 4. Combine: existing Nutanix patents + top V3 discoveries
  const selectedIds = new Set<string>(existingPatentIds);
  for (const entry of v3Entries) {
    if (selectedIds.size >= topN + existingPatentIds.size) break;
    selectedIds.add(entry.patentId);
  }
  const allPatentIds = [...selectedIds];
  const newDiscoveries = allPatentIds.filter(id => !existingPatentIds.has(id));

  console.log(`\nPackage composition:`);
  console.log(`  Existing Nutanix patents: ${existingPatentIds.size}`);
  console.log(`  New V3 discoveries: ${newDiscoveries.length}`);
  console.log(`  Total: ${allPatentIds.length}`);

  // Show top new discoveries
  const v3Map = new Map(v3Entries.map(e => [e.patentId, e]));
  const newWithScores = newDiscoveries
    .map(id => ({ id, score: v3Map.get(id)?.score || 0 }))
    .sort((a, b) => b.score - a.score);

  const patentDetails = await prisma.patent.findMany({
    where: { patentId: { in: allPatentIds } },
    select: { patentId: true, title: true, primarySector: true },
  });
  const titleMap = new Map(patentDetails.map(p => [p.patentId, p]));

  console.log(`\nTop 15 new discoveries:`);
  for (const p of newWithScores.slice(0, 15)) {
    const detail = titleMap.get(p.id);
    console.log(`  ${p.score.toFixed(2)} | ${p.id} | ${detail?.primarySector || '?'} | ${(detail?.title || '').substring(0, 55)}`);
  }

  // 5. Create focus area
  console.log('\n--- Creating Focus Area ---');
  const faName = 'Nutanix V3 Discovery — Combined';

  const existingFA = await prisma.focusArea.findFirst({ where: { name: faName } });
  let focusAreaId: string;

  if (existingFA) {
    focusAreaId = existingFA.id;
    console.log(`Found existing FA: ${faName} (${focusAreaId})`);
  } else {
    const fa = await prisma.focusArea.create({
      data: {
        name: faName,
        description: `Top ${topN} V3-scored patents across Nutanix-relevant sectors (COMPUTING, NETWORKING, SECURITY) combined with ${existingPatentIds.size} existing Nutanix Litigation Targets. V3 scoring maximizes LLM quality signals (eligibility, enforcement clarity, validity, design-around difficulty) with minimal citation weight.`,
        ownerId: 'default-user',
        status: 'ACTIVE',
        searchScopeType: 'SUPER_SECTOR',
      }
    });
    focusAreaId = fa.id;
    console.log(`Created FA: ${faName} (${focusAreaId})`);
  }

  // Add patents to focus area (upsert)
  let addedCount = 0;
  for (const patentId of allPatentIds) {
    const existing = await prisma.focusAreaPatent.findFirst({
      where: { focusAreaId, patentId }
    });
    if (!existing) {
      await prisma.focusAreaPatent.create({
        data: { focusAreaId, patentId, membershipType: 'MANUAL' }
      });
      addedCount++;
    }
  }
  console.log(`Added ${addedCount} patents to FA (${allPatentIds.length} total)`);

  const totalPatents = await prisma.focusAreaPatent.count({ where: { focusAreaId } });
  await prisma.focusArea.update({
    where: { id: focusAreaId },
    data: { patentCount: totalPatents },
  });

  if (skipLlm) {
    console.log('\n--skip-llm: Focus area created. Run LLM jobs manually.');
    console.log(`Focus Area ID: ${focusAreaId}`);
    await prisma.$disconnect();
    return;
  }

  // 6. Create per-patent assessment template
  console.log('\n--- Creating Per-Patent Assessment Template ---');

  let assessmentTemplate = await prisma.promptTemplate.findFirst({
    where: { focusAreaId, executionMode: 'PER_PATENT' }
  });

  if (assessmentTemplate) {
    console.log(`Found existing: ${assessmentTemplate.name} (${assessmentTemplate.id})`);
  } else {
    assessmentTemplate = await prisma.promptTemplate.create({
      data: {
        focusAreaId,
        name: 'Nutanix V3 Discovery — Litigation Assessment',
        description: `Nutanix-specific per-patent litigation assessment for ${allPatentIds.length} patents`,
        templateType: 'STRUCTURED',
        executionMode: 'PER_PATENT',
        questions: ASSESSMENT_QUESTIONS,
        contextFields: ['patent_id', 'title', 'abstract', 'claims', 'grant_date', 'assignee', 'cpc_codes', 'forward_citations', 'competitor_citations', 'competitor_names'],
        llmModel: 'claude-sonnet-4-20250514',
        status: 'DRAFT',
        completedCount: 0,
        totalCount: allPatentIds.length,
      }
    });
    console.log(`Created: ${assessmentTemplate.name} (${assessmentTemplate.id})`);
  }

  // 7. Create collective strategy template with Nutanix product intelligence
  console.log('\n--- Creating Collective Strategy Template ---');

  let collectiveTemplate = await prisma.promptTemplate.findFirst({
    where: { focusAreaId, executionMode: 'COLLECTIVE' }
  });

  if (collectiveTemplate) {
    console.log(`Found existing: ${collectiveTemplate.name} (${collectiveTemplate.id})`);
  } else {
    // Get existing Nutanix product intelligence from prior template
    const existingCollective = await prisma.promptTemplate.findFirst({
      where: { name: { contains: 'Nutanix AHV Targeted Assertion Strategy' } },
      select: { promptText: true },
    });

    let collectivePrompt: string;
    if (existingCollective?.promptText) {
      // Reuse the existing Nutanix product intelligence prompt, just update the intro
      collectivePrompt = existingCollective.promptText
        .replace(
          /^You are a patent litigation strategist analyzing Broadcom's patent portfolio for targeted assertion against nutanix's Nutanix AHV\./,
          'You are a patent litigation strategist analyzing Broadcom\'s patent portfolio for targeted assertion against Nutanix across their full product line (AHV, NCI, Flow Virtual Networking, Flow Network Security, Prism Central).'
        );
      console.log('Reused Nutanix product intelligence from existing AHV template');
    } else {
      collectivePrompt = buildDefaultCollectivePrompt();
      console.log('Built default collective prompt (no existing Nutanix template found)');
    }

    collectiveTemplate = await prisma.promptTemplate.create({
      data: {
        focusAreaId,
        name: 'Nutanix V3 Discovery — Targeted Assertion Strategy',
        description: `Cross-patent Nutanix assertion strategy for ${allPatentIds.length} patents`,
        templateType: 'FREE_FORM',
        executionMode: 'COLLECTIVE',
        promptText: collectivePrompt,
        contextFields: ['patent_id', 'title', 'abstract', 'claims', 'grant_date', 'assignee', 'cpc_codes', 'forward_citations', 'competitor_citations', 'competitor_names'],
        llmModel: 'claude-sonnet-4-20250514',
        status: 'DRAFT',
        completedCount: 0,
        totalCount: 1,
      }
    });
    console.log(`Created: ${collectiveTemplate.name} (${collectiveTemplate.id})`);
  }

  // 8. Execute templates via API
  console.log('\n--- Executing LLM Templates ---');
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
    await new Promise(r => setTimeout(r, 10000));
    const statusRes = await resilientFetch(
      `http://localhost:3001/api/focus-areas/${focusAreaId}/prompt-templates/${assessmentTemplate.id}/status`
    );
    const status = await statusRes.json() as any;
    const pct = status.totalCount > 0 ? ((status.completedCount / status.totalCount) * 100).toFixed(0) : '0';
    console.log(`  Assessment: ${status.completedCount}/${status.totalCount} (${pct}%) - ${status.status}`);
    if (status.status === 'COMPLETE' || status.status === 'ERROR') {
      assessDone = true;
      if (status.status === 'ERROR') console.error('Assessment failed:', status.errorMessage);
    }
  }

  console.log('\nExecuting collective strategy...');
  const collectResponse = await resilientFetch(
    `http://localhost:3001/api/focus-areas/${focusAreaId}/prompt-templates/${collectiveTemplate.id}/execute`,
    { method: 'POST' }
  );
  const collectResult = await collectResponse.json();
  console.log('Collective execution:', JSON.stringify(collectResult));

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
      if (status.status === 'ERROR') console.error('Collective strategy failed:', status.errorMessage);
    }
  }

  // 9. Export vendor package
  console.log('\n--- Exporting Vendor Package ---');
  await exportVendorPackage(focusAreaId);

  await prisma.$disconnect();
}

function buildDefaultCollectivePrompt(): string {
  return `You are a patent litigation strategist analyzing Broadcom's patent portfolio for targeted assertion against Nutanix across their full product line (AHV, NCI, Flow Virtual Networking, Flow Network Security, Prism Central).

Focus Area: <<focusArea.name>>
Description: <<focusArea.description>>
Patent Count: <<focusArea.patentCount>>

CRITICAL INSTRUCTION: You MUST reference ONLY the patents listed below by their exact patent_id. Do NOT invent, fabricate, or hallucinate patent numbers.

Patent data for all <<focusArea.patentCount>> patents in this focus area:
<<focusArea.patentData>>

Produce a comprehensive Nutanix-targeted assertion strategy with:

## 1. Technology Clusters (grouped by Nutanix product overlap)
## 2. Claim Chain Strategy (3-5 assertion packages of 3-6 patents)
## 3. Nutanix Product Vulnerability Matrix (AHV, NCI, Flow VN, Flow NS, Prism Central)
## 4. Top 15 Patents Ranked by Nutanix Litigation Potential
## 5. Recommended Assertion Strategy (multi-pronged)
## 6. Risk Assessment

Be specific. Reference patents by exact patent_id.`;
}

async function exportVendorPackage(focusAreaId: string) {
  const date = new Date().toISOString().split('T')[0];
  const outputDir = path.resolve(`./output/vendor-exports/nutanix-v3-discovery-${date}`);
  fs.mkdirSync(outputDir, { recursive: true });

  const fa = await prisma.focusArea.findUnique({
    where: { id: focusAreaId },
    include: { promptTemplates: true }
  });
  if (!fa) { console.error('Focus area not found'); return; }

  const perPatentTemplate = fa.promptTemplates.find(t => t.executionMode === 'PER_PATENT');
  const collectiveTemplate = fa.promptTemplates.find(t => t.executionMode === 'COLLECTIVE');

  if (perPatentTemplate) {
    const resultDir = path.resolve(`./cache/focus-area-prompts/${focusAreaId}/${perPatentTemplate.id}`);
    if (fs.existsSync(resultDir)) {
      const files = fs.readdirSync(resultDir).filter(f => f.endsWith('.json') && f !== '_collective.json');
      console.log(`Found ${files.length} per-patent assessment results`);

      const patentIds = files.map(f => f.replace('.json', ''));
      const patentRows = await prisma.patent.findMany({
        where: { patentId: { in: patentIds } },
        select: { patentId: true, title: true, primarySector: true, baseScore: true, forwardCitations: true, remainingYears: true },
      });
      const detailMap = new Map(patentRows.map(p => [p.patentId, p]));

      // Get V3 scores
      const v3Snapshot = await prisma.scoreSnapshot.findFirst({
        where: { scoreType: 'V3', isActive: true },
        select: { id: true },
      });
      const v3Scores = v3Snapshot ? await prisma.patentScoreEntry.findMany({
        where: { snapshotId: v3Snapshot.id, patentId: { in: patentIds } },
        select: { patentId: true, score: true, rank: true },
      }) : [];
      const v3Map = new Map(v3Scores.map(s => [s.patentId, s]));

      // Build assessment results CSV
      const assessHeaders = [
        'patent_id', 'title', 'sector', 'base_score', 'v3_score', 'v3_rank',
        'fwd_citations', 'remaining_years',
        'infringement_detectability', 'claim_mapping_strength',
        'prior_art_risk', 'assertion_strategy', 'overall_litigation_score',
        'target_companies', 'target_products', 'standards_alignment', 'claim_mapping_summary',
      ];
      const assessRows = [assessHeaders.join(',')];

      // Build vendor-targets CSV
      type TargetEntry = { patentId: string; title: string; litScore: string; strategy: string; targets: string[]; notes: string };
      const entries: TargetEntry[] = [];
      let maxTargets = 0;

      for (const file of files) {
        const result = JSON.parse(fs.readFileSync(path.join(resultDir, file), 'utf-8'));
        const data = result.response || result.fields || {};
        const patentId = result.patentId || file.replace('.json', '');
        const detail = detailMap.get(patentId);
        const v3 = v3Map.get(patentId);

        assessRows.push(csvRow([
          patentId, detail?.title ?? '', detail?.primarySector ?? '',
          detail?.baseScore ?? '', v3?.score ?? '', v3?.rank ?? '',
          detail?.forwardCitations ?? '', detail?.remainingYears ?? '',
          data.infringement_detectability ?? '', data.claim_mapping_strength ?? '',
          data.prior_art_risk ?? '', data.assertion_strategy ?? '', data.overall_litigation_score ?? '',
          data.target_companies ?? '', data.target_products ?? '', data.standards_alignment ?? '',
          data.claim_mapping_summary ?? '',
        ]));

        // Targets
        const targetStr = (data.target_companies || '') as string;
        const targets = targetStr.split(/,\s*/).map((t: string) => t.trim())
          .filter((t: string) => t.length > 0 && !AFFILIATE_PATTERN.test(t))
          .map((t: string) => t.replace(/\s*\(.*$/, '').replace(/\).*$/, '')
            .replace(/\.\s*.*$/, '').replace(/\s*[-–—].*$/, '')
            .replace(/^(Primary|Secondary|Tertiary)\s+targets?:\s*/i, '').trim())
          .filter((t: string) => t.length > 0 && t.length < 50 && !/^(and|or|as|the|with|other|various)\b/i.test(t));
        if (targets.length > maxTargets) maxTargets = targets.length;

        const productStr = (data.target_products || '') as string;
        entries.push({
          patentId,
          title: detail?.title ?? '',
          litScore: data.overall_litigation_score ?? '',
          strategy: data.assertion_strategy ?? '',
          targets,
          notes: productStr.substring(0, 200),
        });
      }

      entries.sort((a, b) => Number(b.litScore || 0) - Number(a.litScore || 0));
      maxTargets = Math.max(maxTargets, 5);

      // Write vendor-targets.csv
      const targetHeaders = Array.from({ length: maxTargets }, (_, i) => `Target${i + 1}`);
      const vtHeaders = ['PatentId', 'Title', 'LitScore', 'Strategy', ...targetHeaders, 'Notes'];
      const vtRows = [vtHeaders.join(',')];
      for (const e of entries) {
        const targetCells = Array.from({ length: maxTargets }, (_, i) => e.targets[i] || '');
        vtRows.push(csvRow([`US${e.patentId}B2`, e.title, e.litScore, e.strategy, ...targetCells, e.notes]));
      }
      fs.writeFileSync(path.join(outputDir, 'vendor-targets.csv'), vtRows.join('\n'));
      console.log(`  vendor-targets.csv: ${entries.length} patents`);

      // Write assessment results
      fs.writeFileSync(path.join(outputDir, 'nutanix-assessment-results.csv'), assessRows.join('\n'));
      console.log(`  nutanix-assessment-results.csv: ${files.length} patents`);

      // Write pivot CSV
      const pivotHeaders = ['PatentId', 'LitScore', 'Strategy', 'Target', 'TargetProducts'];
      const pivotRows = [pivotHeaders.join(',')];
      for (const e of entries) {
        for (const target of e.targets) {
          pivotRows.push(csvRow([`US${e.patentId}B2`, e.litScore, e.strategy, target, e.notes]));
        }
      }
      fs.writeFileSync(path.join(outputDir, 'vendor-targets-pivot.csv'), pivotRows.join('\n'));
      console.log(`  vendor-targets-pivot.csv: ${pivotRows.length - 1} patent-target pairs`);
    }
  }

  // Write collective strategy
  if (collectiveTemplate) {
    const collectivePath = path.resolve(`./cache/focus-area-prompts/${focusAreaId}/${collectiveTemplate.id}/_collective.json`);
    if (fs.existsSync(collectivePath)) {
      const result = JSON.parse(fs.readFileSync(collectivePath, 'utf-8'));
      const content = result.rawText || (typeof result.response === 'string' ? result.response : JSON.stringify(result.response || result, null, 2));
      fs.writeFileSync(path.join(outputDir, 'nutanix-collective-strategy.md'), content);
      console.log('  nutanix-collective-strategy.md');
    }
  }

  console.log(`\nDone. Files written to ${outputDir}`);
}

main().catch(async (err) => {
  console.error('Error:', err);
  await prisma.$disconnect();
  process.exit(1);
});
