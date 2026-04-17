/**
 * Create Blackberry 44 × Google Vendor Package
 *
 * Full litigation package:
 *   1. Creates per-patent STRUCTURED assessment template (10 questions)
 *   2. Creates COLLECTIVE free-form strategy template
 *   3. Executes both templates via API (LLM jobs)
 *   4. Exports full vendor package (8 files)
 *
 * Usage:
 *   npx tsx scripts/_create-bb-google-vendor-package.ts
 *   npx tsx scripts/_create-bb-google-vendor-package.ts --skip-llm     # Create templates only
 *   npx tsx scripts/_create-bb-google-vendor-package.ts --export-only  # Export from existing results
 */

import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import { generateLitigationPackageCsv } from '../src/api/services/litigation-export-service.js';

const prisma = new PrismaClient();

const FOCUS_AREA_NAME = 'Blackberry 44';
const PACKAGE_SLUG = 'bb-google';
const PORTFOLIO_NAME = 'blackberry';

// Blackberry affiliates — MUST be excluded from assertion targets
const BB_AFFILIATES = [
  'BlackBerry', 'Blackberry', 'Research In Motion', 'RIM', 'QNX',
  '2236008 Ontario', 'SlipStream Data', 'Copiun', 'Certicom',
  'Good Technology', 'Secusmart', 'Cylance', 'AtHoc', 'Paratek',
  'Movirtu', 'WatchDox',
];
const AFFILIATE_PATTERN = new RegExp(
  BB_AFFILIATES.map(a => a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'i'
);

// ─── Assessment Questions (adapted for Blackberry vs Google) ─────────────────

const ASSESSMENT_QUESTIONS = [
  {
    fieldName: 'infringement_detectability',
    question: 'How easily can infringement of this patent be detected WITHOUT internal product access? Consider: Can you detect use from product datasheets, published documentation, API references, standards compliance, or public specifications? Score 1=requires internal access, 5=detectable via careful external analysis, 10=obvious from product specifications.',
    answerType: 'numeric',
    constraints: { min: 1, max: 10 }
  },
  {
    fieldName: 'claim_mapping_strength',
    question: 'How well do the independent claims map to known Google product implementations? Consider the claim elements and whether each element can be identified in Google Cloud, Android, Chromecast, AV1, GKE, or other Google products. Score 1=poor mapping, 5=partial mapping, 10=strong mapping (all elements clearly present in commercial products).',
    answerType: 'numeric',
    constraints: { min: 1, max: 10 }
  },
  {
    fieldName: 'claim_mapping_summary',
    question: 'Which specific claim elements map to which Google products or product categories? Identify the broadest independent claim and map each element to concrete Google implementations. Be specific about which Google products and services implement each element.',
    answerType: 'text'
  },
  {
    fieldName: 'standards_alignment',
    question: 'Which specific industry standards does this patent\'s technology map to? Consider relevant standards bodies (IETF, IEEE, 3GPP, NIST, W3C, AOM, etc.) and specifications. List specific standard references. If not standards-related, state \'Not standards-essential\'.',
    answerType: 'text_array'
  },
  {
    fieldName: 'target_products',
    question: 'List specific Google products or product categories that likely implement this patented technology. Be concrete — name specific products, product families, or product lines. Consider: Google Cloud (GKE, Cloud Load Balancing, VPC, Cloud Armor, IAM, Compute Engine), Android (NFC/HCE, media framework, security), YouTube/AV1 codec, Chromecast/Google TV, Pixel devices. IMPORTANT: Do NOT list any BlackBerry or BlackBerry-subsidiary products.',
    answerType: 'text_array'
  },
  {
    fieldName: 'target_companies',
    question: 'Beyond Google, which other companies are potential assertion targets for this patent? IMPORTANT EXCLUSIONS: Do NOT list BlackBerry or any BlackBerry subsidiary/affiliate (QNX, Certicom, Cylance, etc.). Focus on companies in the same technology space. List Google first, then consider other cloud providers (AWS, Azure, Oracle Cloud), mobile platforms (Apple, Samsung), streaming services (Netflix, Roku), or networking vendors as applicable. List at least 3 companies.',
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
    question: 'Considering all factors — detectability, claim mapping to Google products, prior art risk, target market size, and assertion strategy — rate the overall litigation potential against Google. Score 1=not recommended, 5=moderate potential, 10=excellent litigation candidate.',
    answerType: 'numeric',
    constraints: { min: 1, max: 10 }
  }
];

// ─── Collective Strategy Prompt ──────────────────────────────────────────────

function buildCollectivePrompt(): string {
  return `You are a patent litigation strategist analyzing BlackBerry's patent portfolio for assertion primarily against Google and its products/services.

Focus Area: <<focusArea.name>>
Description: <<focusArea.description>>
Patent Count: <<focusArea.patentCount>>

CRITICAL INSTRUCTION: You MUST reference ONLY the patents listed below by their exact patent_id. Do NOT invent, fabricate, or hallucinate patent numbers. Every patent ID you mention MUST appear in the data below.

CRITICAL EXCLUSION: BlackBerry, QNX, Certicom, Cylance, and all BlackBerry subsidiaries must NEVER be listed as competitors or assertion targets.

PRIMARY TARGET: Google (Alphabet) — including Google Cloud Platform, Android, YouTube, Chromecast/Google TV, Pixel devices, AV1 codec.

SECONDARY TARGETS: Other major technology companies that implement similar technologies: Amazon (AWS), Microsoft (Azure), Apple (iOS), Samsung, Netflix, Cisco, Oracle, etc.

Patent data for all <<focusArea.patentCount>> patents in this focus area:
<<focusArea.patentData>>

Using ONLY the patents listed above, produce a comprehensive litigation strategy document with the following sections:

## 1. Technology Clusters
Group the patents into technology clusters — sets of patents covering the same technology from different angles. For each cluster:
### Cluster [A-Z]: [Name]
**Patents:** [list patent IDs]
- Why these patents reinforce each other
- Combined coverage strength (rate as: Very High, High, Medium, Low)

## 2. Claim Chain Strategy
Which patents should be asserted TOGETHER for maximum impact against Google? Identify 3-5 assertion packages of 3-6 patents each. For each package:
### Package [1-N]: [Name]
**Patents:** [list patent IDs]
- The combined claim coverage
- Which Google products are most exposed
- Estimated damages basis

## 3. Competitor Vulnerability Matrix
For Google and each secondary target:
- Number of patents likely infringed
- Most impactful patents against this competitor (by patent_id from the list above)
- Vulnerability level (HIGH/MEDIUM/LOW)
- Specific products exposed
- Recommended assertion priority

## 4. Top 10 Patents Ranked by Litigation Potential Against Google
Rank the 10 strongest litigation candidates with reasoning:
- Patent ID (from the list above), title
- Which Google products are most at risk
- Why this patent is strong for litigation
- Recommended assertion strategy
- Key risk factors

## 5. Recommended Assertion Strategy
Design a multi-pronged litigation strategy identifying:
- Prong 1: Standards-essential (FRAND) — which patents, which standards, which products
- Prong 2: Implementation-specific (DIRECT) — which patents target specific Google implementations detectable via public documentation
- Prong 3: Cross-license leverage — which patents are best used as negotiating chips in cross-licensing with Google

For each prong: expected outcomes, risk factors, strongest claim elements.

## 6. Risk Assessment
- Strongest counterarguments Google will raise
- Prior art exposure areas
- Prosecution history concerns
- Forum selection recommendations
- Google's likely cross-licensing leverage

Be specific. Reference patents by their exact patent_id from the data above. Reference specific claim elements. Cite specific Google products and services.`;
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

// ─── Parse Collective Strategy for Patent Mappings ───────────────────────────

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

// ─── CLI Args ────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const skipLlm = args.includes('--skip-llm');
const exportOnly = args.includes('--export-only');

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n=== Blackberry 44 × Google Vendor Package ===`);
  console.log(`Skip LLM: ${skipLlm}, Export Only: ${exportOnly}\n`);

  // Find focus area
  const fa = await prisma.focusArea.findFirst({
    where: { name: FOCUS_AREA_NAME },
    include: { promptTemplates: true }
  });
  if (!fa) { console.error(`Focus area "${FOCUS_AREA_NAME}" not found`); process.exit(1); }
  console.log(`Focus Area: ${fa.name} (${fa.id})`);

  const faPatents = await prisma.focusAreaPatent.findMany({
    where: { focusAreaId: fa.id },
    select: { patentId: true },
  });
  console.log(`Patents: ${faPatents.length}`);

  if (exportOnly) {
    console.log('\n--export-only: Skipping template creation and LLM jobs');
    await exportVendorPackage(fa.id);
    await prisma.$disconnect();
    return;
  }

  // ── Step 1: Create Per-Patent Assessment Template ──
  console.log('\n--- Step 1: Creating Per-Patent Assessment Template ---');

  let assessmentTemplate = fa.promptTemplates.find(t => t.executionMode === 'PER_PATENT');
  if (assessmentTemplate) {
    console.log(`Found existing: ${assessmentTemplate.name} (${assessmentTemplate.id})`);
  } else {
    assessmentTemplate = await prisma.promptTemplate.create({
      data: {
        focusAreaId: fa.id,
        name: 'BB44 Google Litigation Assessment',
        description: 'Per-patent litigation assessment for Blackberry 44 patents targeting Google',
        templateType: 'STRUCTURED',
        executionMode: 'PER_PATENT',
        questions: ASSESSMENT_QUESTIONS,
        contextFields: ['patent_id', 'title', 'abstract', 'claims', 'grant_date', 'assignee', 'cpc_codes', 'forward_citations', 'competitor_citations', 'competitor_names'],
        llmModel: 'claude-sonnet-4-20250514',
        status: 'DRAFT',
        completedCount: 0,
        totalCount: faPatents.length,
      }
    });
    console.log(`Created: ${assessmentTemplate.name} (${assessmentTemplate.id})`);
  }

  // ── Step 2: Create Collective Strategy Template ──
  console.log('\n--- Step 2: Creating Collective Strategy Template ---');

  let collectiveTemplate = fa.promptTemplates.find(t => t.executionMode === 'COLLECTIVE');
  if (collectiveTemplate) {
    console.log(`Found existing: ${collectiveTemplate.name} (${collectiveTemplate.id})`);
  } else {
    collectiveTemplate = await prisma.promptTemplate.create({
      data: {
        focusAreaId: fa.id,
        name: 'BB44 Google Collective Litigation Strategy',
        description: 'Cross-patent litigation strategy for Blackberry 44 patents vs Google',
        templateType: 'FREE_FORM',
        executionMode: 'COLLECTIVE',
        promptText: buildCollectivePrompt(),
        contextFields: ['patent_id', 'title', 'abstract', 'claims', 'grant_date', 'assignee', 'cpc_codes', 'forward_citations', 'competitor_citations', 'competitor_names'],
        llmModel: 'claude-sonnet-4-20250514',
        status: 'DRAFT',
        completedCount: 0,
        totalCount: 1,
      }
    });
    console.log(`Created: ${collectiveTemplate.name} (${collectiveTemplate.id})`);
  }

  if (skipLlm) {
    console.log('\n--skip-llm: Templates created. Run LLM jobs via API or GUI.');
    console.log(`Focus Area ID: ${fa.id}`);
    console.log(`Assessment Template ID: ${assessmentTemplate.id}`);
    console.log(`Collective Template ID: ${collectiveTemplate.id}`);
    await prisma.$disconnect();
    return;
  }

  // ── Step 3: Execute Templates via API ──
  console.log('\n--- Step 3: Executing LLM Templates ---');
  console.log('Executing per-patent assessment (44 patents)...');

  const assessResponse = await resilientFetch(
    `http://localhost:3001/api/focus-areas/${fa.id}/prompt-templates/${assessmentTemplate.id}/execute`,
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
      `http://localhost:3001/api/focus-areas/${fa.id}/prompt-templates/${assessmentTemplate.id}/status`
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
    `http://localhost:3001/api/focus-areas/${fa.id}/prompt-templates/${collectiveTemplate.id}/execute`,
    { method: 'POST' }
  );
  const collectResult = await collectResponse.json();
  console.log('Collective execution:', JSON.stringify(collectResult));

  // Poll for collective completion
  let collectDone = false;
  while (!collectDone) {
    await new Promise(r => setTimeout(r, 10000));
    const statusRes = await resilientFetch(
      `http://localhost:3001/api/focus-areas/${fa.id}/prompt-templates/${collectiveTemplate.id}/status`
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

  // ── Step 4: Export Vendor Package ──
  console.log('\n--- Step 4: Exporting Vendor Package ---');
  await exportVendorPackage(fa.id);

  await prisma.$disconnect();
}

// ─── Export Vendor Package ────────────────────────────────────────────────────

async function exportVendorPackage(focusAreaId: string) {
  const date = new Date().toISOString().split('T')[0];
  const outputDir = path.resolve(`./output/vendor-exports/${PACKAGE_SLUG}-${date}`);
  fs.mkdirSync(outputDir, { recursive: true });

  const fa = await prisma.focusArea.findUnique({
    where: { id: focusAreaId },
    include: { promptTemplates: true }
  });
  if (!fa) { console.error('Focus area not found'); return; }

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

  // ── Per-patent assessment exports ──
  if (perPatentTemplate) {
    const resultDir = path.resolve(`./cache/focus-area-prompts/${focusAreaId}/${perPatentTemplate.id}`);
    if (fs.existsSync(resultDir)) {
      const files = fs.readdirSync(resultDir).filter(f => f.endsWith('.json') && f !== '_collective.json');
      console.log(`Found ${files.length} per-patent assessment results`);

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

        const targetStr = (data.target_companies || '') as string;
        const rawTargets = targetStr.split(/,\s*/).map((t: string) => t.trim())
          .filter((t: string) => t.length > 0 && !AFFILIATE_PATTERN.test(t));
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
            .filter((p: string) => p.toLowerCase().includes(target.toLowerCase()) && !AFFILIATE_PATTERN.test(p))
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
      console.log(`  vendor-targets.csv: ${entries.length} patents, ${maxTargets} target columns`);

      // vendor-targets-pivot.csv
      const pivotHeaders = ['PatentId', 'LitScore', 'Strategy', 'TechCluster', 'ClaimChain', 'Target', 'TargetProduct'];
      const pivotRows = [pivotHeaders.join(',')];
      for (const e of entries) {
        for (const target of e.targets) {
          const targetProduct = e.targetProducts.get(target) || '';
          pivotRows.push(csvRow([
            `US${e.patentId}B2`, e.litScore, e.strategy, e.techCluster, e.claimChain,
            target, targetProduct,
          ]));
        }
      }
      fs.writeFileSync(path.join(outputDir, 'vendor-targets-pivot.csv'), pivotRows.join('\n'));
      console.log(`  vendor-targets-pivot.csv: ${pivotRows.length - 1} rows`);

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
      console.log(`  tier1-assessment-results.csv: ${files.length} patents`);
    } else {
      console.log('  No per-patent assessment results found');
    }
  }

  // ── Collective strategy ──
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

  // ── Litigation package CSV (all EAV fields) ──
  try {
    const litResult = await generateLitigationPackageCsv(focusAreaId);
    fs.writeFileSync(path.join(outputDir, 'litigation-package-all-fields-export.csv'), litResult.csv);
    console.log(`  litigation-package-all-fields-export.csv: ${litResult.patentCount} patents, ${litResult.metricKeyCount} metric keys`);
  } catch (err) {
    console.warn('  Warning: Could not generate litigation package CSV:', (err as Error).message);
  }

  // ── Copy infringement heatmap + matrix ──
  const heatmapDir = path.resolve(`./output/vendor-exports/bb-google-2026-04-17`);
  for (const file of ['bb-google-infringement-heatmap.md', 'bb-google-patent-product-matrix.csv', 'bb-google-all-scores.csv']) {
    const src = path.join(heatmapDir, file);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(outputDir, file));
      console.log(`  ${file} (copied from heatmap export)`);
    }
  }

  // ── README ──
  const readme = `# Blackberry 44 × Google Litigation Package

**Generated:** ${new Date().toISOString().split('T')[0]}
**Portfolio:** Blackberry (blackberry)
**Focus Area:** Blackberry 44
**Focus Area ID:** ${focusAreaId}
**Target:** Google (Alphabet) — Cloud, Android, AV1, Chromecast/TV, Pixel

## Files

| File | Description |
|---|---|
| \`vendor-targets.csv\` | Per-patent litigation targets with TechCluster, ClaimChain, companies and products |
| \`vendor-targets-pivot.csv\` | One row per patent-target pair with TargetProduct |
| \`tier1-assessment-results.csv\` | Full per-patent assessment metrics (10 fields) |
| \`collective-strategy.md\` | Cross-patent litigation strategy narrative |
| \`litigation-package-all-fields-export.csv\` | Full structured LLM metrics, EAV scores, and sub-sector scoring data |
| \`bb-google-infringement-heatmap.md\` | Patent × Google product infringement score matrix with tier rankings |
| \`bb-google-patent-product-matrix.csv\` | Patent × product infringement scores for analysis |
| \`bb-google-all-scores.csv\` | All 924 patent×product×document score entries |
| \`README.md\` | This file |

## Top Infringement Results

| Patent | Product | Score | Description |
|--------|---------|-------|-------------|
| US9818096 | Android (HCE) | 0.95 | Transaction confirmation via NFC |
| US8578027 | Cloud Load Balancing | 0.81 | Server load balancing w/ metrics |
| US10778989 | AV1 codec | 0.76 | Rolling intra prediction for video |
| US9818096 | Pixel 10 (NFC) | 0.68 | Transaction confirmation (same patent) |
| US8521220 | Chromecast w/ Google TV | 0.62 | Media transfer and control |
`;

  fs.writeFileSync(path.join(outputDir, 'README.md'), readme);
  console.log('  README.md');

  const fileCount = fs.readdirSync(outputDir).filter(f => !f.startsWith('.')).length;
  console.log(`\nDone. ${fileCount} files written to ${outputDir}`);
}

// ─── Run ─────────────────────────────────────────────────────────────────────

main().catch(err => {
  console.error('Failed:', err);
  process.exit(1);
});
