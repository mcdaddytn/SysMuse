/**
 * Create "Best Of" vendor packages by assembling curated patent sets
 * from existing sector-level LLM assessment results.
 *
 * - Copies per-patent assessment results from original Focus Areas
 * - Runs NEW collective strategy LLM job for the curated group
 * - Exports in standard vendor package format
 *
 * Usage:
 *   npx tsx scripts/create-bestof-vendor-package.ts <package-name> --patents=ID1,ID2,... [--skip-llm] [--export-only]
 *   npx tsx scripts/create-bestof-vendor-package.ts <package-name> --patent-file=path/to/ids.txt [--skip-llm] [--export-only]
 */

import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

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

// ─── Collective Strategy Prompt Builder ───────────────────────────────────────

function buildCollectivePrompt(packageDisplayName: string): string {
  return `You are a patent litigation strategist analyzing Broadcom's patent portfolio in the ${packageDisplayName} technology area for assertion against competitors.

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

// ─── CLI Args ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const packageName = args.find(a => !a.startsWith('--'));
const patentFileArg = args.find(a => a.startsWith('--patent-file='))?.split('=')[1];
const patentsArg = args.find(a => a.startsWith('--patents='))?.split('=')[1];
const skipLlm = args.includes('--skip-llm');
const exportOnly = args.includes('--export-only');
const displayNameArg = args.find(a => a.startsWith('--display-name='))?.split('=')[1];

if (!packageName || (!patentFileArg && !patentsArg && !exportOnly)) {
  console.error('Usage: npx tsx scripts/create-bestof-vendor-package.ts <package-name> --patent-file=path/to/ids.txt [--display-name="..."] [--skip-llm] [--export-only]');
  process.exit(1);
}

// ─── Find cached per-patent results across all existing Focus Areas ──────────

async function findCachedAssessment(patentId: string): Promise<{ faId: string; templateId: string; filePath: string } | null> {
  const cacheBase = path.resolve('./cache/focus-area-prompts');
  if (!fs.existsSync(cacheBase)) return null;

  const faDirs = fs.readdirSync(cacheBase);
  for (const faDir of faDirs) {
    const faPath = path.join(cacheBase, faDir);
    if (!fs.statSync(faPath).isDirectory()) continue;

    const templateDirs = fs.readdirSync(faPath);
    for (const templateDir of templateDirs) {
      const resultFile = path.join(faPath, templateDir, `${patentId}.json`);
      if (fs.existsSync(resultFile)) {
        return { faId: faDir, templateId: templateDir, filePath: resultFile };
      }
    }
  }
  return null;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  // Load patent IDs
  let patentIds: string[];
  if (patentFileArg) {
    const content = fs.readFileSync(patentFileArg, 'utf-8');
    patentIds = content.split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 0)
      .map(l => l.replace(/^US-?/, '').replace(/-?B\d+$/, ''));
  } else {
    patentIds = patentsArg!.split(',').map(id => id.trim().replace(/^US-?/, '').replace(/-?B\d+$/, ''));
  }

  const displayName = displayNameArg || packageName.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

  console.log(`\n=== Best-Of Vendor Package: ${packageName} ===`);
  console.log(`Display name: ${displayName}`);
  console.log(`Patents: ${patentIds.length}`);
  console.log(`Skip LLM: ${skipLlm}, Export Only: ${exportOnly}\n`);

  if (exportOnly) {
    const existingFA = await prisma.focusArea.findFirst({
      where: { name: { contains: displayName }, name: { contains: 'Best-Of' } },
      include: { promptTemplates: true }
    });
    if (existingFA) {
      console.log(`Found existing FA: ${existingFA.name} (${existingFA.id})`);
      await exportVendorPackage(existingFA.id, packageName, displayName);
    } else {
      console.error('No existing focus area found for --export-only');
    }
    await prisma.$disconnect();
    return;
  }

  // Get patent details
  const patents = await prisma.patent.findMany({
    where: { patentId: { in: patentIds } },
    select: { patentId: true, title: true, primarySector: true, superSector: true },
  });
  const detailMap = new Map(patents.map(p => [p.patentId, p]));

  console.log('Selected patents:');
  for (const id of patentIds) {
    const d = detailMap.get(id);
    console.log(`  ${id} | ${d?.primarySector || '?'} | ${(d?.title || '').substring(0, 60)}`);
  }

  // ── Step 1: Create Focus Area ──
  console.log('\n--- Step 1: Creating Focus Area ---');

  let existingFA = await prisma.focusArea.findFirst({
    where: { name: `${displayName} Best-Of` }
  });

  let focusAreaId: string;
  if (existingFA) {
    console.log(`Found existing FA: ${existingFA.name} (${existingFA.id})`);
    focusAreaId = existingFA.id;
  } else {
    const fa = await prisma.focusArea.create({
      data: {
        name: `${displayName} Best-Of`,
        description: `Curated best-of ${displayName} patents for heatmap submission — ${patentIds.length} patents selected from cross-sector analysis`,
        superSector: 'VIDEO_STREAMING',
        primarySector: packageName,
        ownerId: 'default-user',
        status: 'ACTIVE',
        searchScopeType: 'SECTOR',
      }
    });
    focusAreaId = fa.id;
    console.log(`Created FA: ${fa.name} (${fa.id})`);
  }

  // Add patents to focus area
  let addedCount = 0;
  for (const patentId of patentIds) {
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
  console.log(`Added ${addedCount} patents to FA (${patentIds.length} total)`);
  await prisma.focusArea.update({
    where: { id: focusAreaId },
    data: { patentCount: patentIds.length }
  });

  // ── Step 2: Copy Per-Patent Assessment Results ──
  console.log('\n--- Step 2: Copying Per-Patent Assessment Results ---');

  let assessmentTemplate = await prisma.promptTemplate.findFirst({
    where: { focusAreaId, executionMode: 'PER_PATENT' }
  });

  if (!assessmentTemplate) {
    assessmentTemplate = await prisma.promptTemplate.create({
      data: {
        focusAreaId,
        name: `${displayName} Litigation Assessment`,
        description: `Per-patent litigation assessment for best-of ${displayName} patents`,
        templateType: 'STRUCTURED',
        executionMode: 'PER_PATENT',
        questions: [],
        contextFields: ['patent_id', 'title', 'abstract', 'claims', 'grant_date', 'assignee', 'cpc_codes', 'forward_citations'],
        llmModel: 'claude-sonnet-4-20250514',
        status: 'COMPLETE',
        completedCount: patentIds.length,
        totalCount: patentIds.length,
      }
    });
    console.log(`Created assessment template: ${assessmentTemplate.id}`);
  }

  // Create cache directory for this FA's per-patent results
  const resultDir = path.resolve(`./cache/focus-area-prompts/${focusAreaId}/${assessmentTemplate.id}`);
  fs.mkdirSync(resultDir, { recursive: true });

  let copiedCount = 0;
  let missingCount = 0;
  for (const patentId of patentIds) {
    const destFile = path.join(resultDir, `${patentId}.json`);
    if (fs.existsSync(destFile)) {
      copiedCount++;
      continue;
    }

    const cached = await findCachedAssessment(patentId);
    if (cached) {
      fs.copyFileSync(cached.filePath, destFile);
      copiedCount++;
    } else {
      console.log(`  WARNING: No cached assessment for ${patentId}`);
      missingCount++;
    }
  }
  console.log(`Copied ${copiedCount} per-patent results (${missingCount} missing)`);

  // ── Step 3: Create & Run Collective Strategy ──
  console.log('\n--- Step 3: Collective Strategy ---');

  let collectiveTemplate = await prisma.promptTemplate.findFirst({
    where: { focusAreaId, executionMode: 'COLLECTIVE' }
  });

  if (!collectiveTemplate) {
    collectiveTemplate = await prisma.promptTemplate.create({
      data: {
        focusAreaId,
        name: `${displayName} Collective Litigation Strategy`,
        description: `Cross-patent litigation strategy for best-of ${displayName} patents`,
        templateType: 'FREE_FORM',
        executionMode: 'COLLECTIVE',
        promptText: buildCollectivePrompt(displayName),
        contextFields: ['patent_id', 'title', 'abstract', 'claims', 'grant_date', 'assignee', 'cpc_codes', 'forward_citations'],
        llmModel: 'claude-sonnet-4-20250514',
        status: 'DRAFT',
        completedCount: 0,
        totalCount: 1,
      }
    });
    console.log(`Created collective template: ${collectiveTemplate.id}`);
  }

  // Check if collective already done
  const collectiveCachePath = path.resolve(`./cache/focus-area-prompts/${focusAreaId}/${collectiveTemplate.id}/_collective.json`);
  if (fs.existsSync(collectiveCachePath)) {
    console.log('Collective strategy already cached — skipping LLM');
  } else if (skipLlm) {
    console.log('--skip-llm: Skipping collective strategy execution');
  } else {
    console.log('Executing collective strategy via API...');
    const collectResponse = await resilientFetch(
      `http://localhost:3001/api/focus-areas/${focusAreaId}/prompt-templates/${collectiveTemplate.id}/execute`,
      { method: 'POST' }
    );
    const collectResult = await collectResponse.json();
    console.log('Collective execution:', JSON.stringify(collectResult));

    // Poll for completion
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
  }

  // ── Step 4: Export ──
  console.log('\n--- Step 4: Exporting Vendor Package ---');
  await exportVendorPackage(focusAreaId, packageName, displayName);

  await prisma.$disconnect();
}

// ─── Export Vendor Package ────────────────────────────────────────────────────

async function exportVendorPackage(focusAreaId: string, packageName: string, displayName: string) {
  const date = new Date().toISOString().split('T')[0];
  const outputDir = path.resolve(`./output/vendor-exports/${packageName}-${date}`);
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

  const websiteMap = await buildCompanyWebsiteMap();
  console.log(`  Loaded ${Math.floor(websiteMap.size / 2)} company websites`);

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

        const ownerPatterns = /\b(broadcom|avago)\b/i;
        const rawCompanies = data.target_companies || '';
        const targetStr = Array.isArray(rawCompanies) ? rawCompanies.join(', ') : String(rawCompanies);
        const rawTargets = targetStr.split(/,\s*/).map((t: string) => t.trim())
          .filter((t: string) => t.length > 0 && !ownerPatterns.test(t));
        const targets = rawTargets
          .map((t: string) => t.replace(/\s*\(.*$/, '').replace(/\).*$/, '')
            .replace(/\.\s*.*$/, '').replace(/\s*[-–—].*$/, '')
            .replace(/^(Primary|Secondary|Tertiary)\s+targets?:\s*/i, '').trim())
          .filter((t: string) => t.length > 0 && t.length < 50 && !/^(and|or|as|the|with|other|various)\b/i.test(t));
        if (targets.length > maxTargets) maxTargets = targets.length;

        const rawProducts = data.target_products || '';
        const productStr = Array.isArray(rawProducts) ? rawProducts.join(', ') : String(rawProducts);
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
      console.log(`  vendor-targets.csv: ${entries.length} patents, ${maxTargets} target columns`);

      // vendor-targets-pivot.csv
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
          Array.isArray(data.target_companies) ? data.target_companies.join(', ') : (data.target_companies ?? ''),
          Array.isArray(data.target_products) ? data.target_products.join(', ') : (data.target_products ?? ''),
          Array.isArray(data.standards_alignment) ? data.standards_alignment.join(', ') : (data.standards_alignment ?? ''),
          data.claim_mapping_summary ?? '',
        ]));
      }
      fs.writeFileSync(path.join(outputDir, 'tier1-assessment-results.csv'), assessRows.join('\n'));
      console.log(`  tier1-assessment-results.csv: ${files.length} patents`);
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
      console.log('  WARNING: No collective strategy result found');
    }
  }

  // Write README
  const readme = `# ${displayName} Best-Of Vendor Export Package

**Generated:** ${new Date().toISOString().split('T')[0]}
**Portfolio:** Broadcom Core (broadcom-core)
**Package:** ${packageName} (${displayName})
**Focus Area ID:** ${focusAreaId}
**Type:** Curated best-of selection from cross-sector analysis

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

main().catch(async err => {
  console.error('Failed:', err);
  await prisma.$disconnect();
  process.exit(1);
});
