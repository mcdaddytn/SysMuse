/**
 * Generate two documents for Nutanix V3 Discovery package:
 * 1. collective-strategy.md — convert JSON response to readable markdown
 * 2. litigation-package CSV — full patent detail export with all fields
 */

import { PrismaClient } from '@prisma/client';
import { generateLitigationPackageCsv } from '../src/api/services/litigation-export-service.js';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

function jsonToMarkdown(data: any): string {
  const lines: string[] = [];
  lines.push('# Nutanix V3 Discovery — Targeted Assertion Strategy\n');

  // 1. Technology Clusters
  if (data.technology_clusters) {
    lines.push('## 1. Technology Clusters\n');
    for (const [key, cluster] of Object.entries(data.technology_clusters) as any) {
      const name = key.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
      lines.push(`### ${name}`);
      if (cluster.description) lines.push(`${cluster.description}\n`);
      if (cluster.patent_ids) lines.push(`**Patents:** ${cluster.patent_ids.join(', ')}\n`);
      if (cluster.nutanix_features) {
        lines.push('**Nutanix features:**');
        const features = Array.isArray(cluster.nutanix_features) ? cluster.nutanix_features : [cluster.nutanix_features];
        for (const f of features) lines.push(`- ${f}`);
        lines.push('');
      }
      if (cluster.coverage_strength) lines.push(`**Coverage strength:** ${cluster.coverage_strength}\n`);
      if (cluster.reinforcement) lines.push(`**Why these reinforce each other:** ${cluster.reinforcement}\n`);
      if (cluster.combined_strength) lines.push(`**Combined coverage strength:** ${cluster.combined_strength}\n`);
      if (cluster.nutanix_overlap) lines.push(`**Nutanix overlap:** ${cluster.nutanix_overlap}\n`);
      lines.push('');
    }
  }

  // 2. Claim Chain Strategy
  if (data.claim_chain_strategy) {
    lines.push('## 2. Claim Chain Strategy\n');
    const packages = Array.isArray(data.claim_chain_strategy)
      ? data.claim_chain_strategy
      : Object.values(data.claim_chain_strategy);
    for (const [i, pkg] of packages.entries()) {
      lines.push(`### Package ${i + 1}${pkg.name ? ': ' + pkg.name : ''}`);
      if (pkg.patent_ids) lines.push(`**Patents:** ${pkg.patent_ids.join(', ')}`);
      if (pkg.combined_coverage) lines.push(`**Combined coverage:** ${pkg.combined_coverage}`);
      if (pkg.combined_claim_coverage) lines.push(`**Combined claim coverage:** ${pkg.combined_claim_coverage}`);
      if (pkg.nutanix_targets) {
        const targets = Array.isArray(pkg.nutanix_targets) ? pkg.nutanix_targets : [pkg.nutanix_targets];
        lines.push(`**Nutanix targets:**`);
        for (const t of targets) lines.push(`- ${t}`);
      }
      if (pkg.evidence) lines.push(`**Evidence:** ${pkg.evidence}`);
      if (pkg.damages_basis) lines.push(`**Damages basis:** ${pkg.damages_basis}`);
      if (pkg.most_exposed_competitors) {
        const competitors = Array.isArray(pkg.most_exposed_competitors)
          ? pkg.most_exposed_competitors.join(', ')
          : pkg.most_exposed_competitors;
        lines.push(`**Most exposed competitors:** ${competitors}`);
      }
      if (pkg.estimated_damages_basis) lines.push(`**Estimated damages basis:** ${pkg.estimated_damages_basis}`);
      lines.push('');
    }
  }

  // 3. Nutanix Vulnerability Analysis
  if (data.nutanix_vulnerability_analysis) {
    lines.push('## 3. Nutanix Product Vulnerability Analysis\n');
    const vuln = data.nutanix_vulnerability_analysis;

    if (vuln.patents_likely_infringed) {
      lines.push(`**Total patents likely infringed:** ${vuln.patents_likely_infringed}\n`);
    }

    if (vuln.most_impactful_patents && typeof vuln.most_impactful_patents === 'object' && !Array.isArray(vuln.most_impactful_patents)) {
      lines.push('### Most Impactful Patents\n');
      for (const [patId, detail] of Object.entries(vuln.most_impactful_patents) as any) {
        lines.push(`**US${patId}**`);
        if (detail.feature_mapping) lines.push(`- **Feature mapping:** ${detail.feature_mapping}`);
        if (detail.documentation_evidence) lines.push(`- **Documentation evidence:** ${detail.documentation_evidence}`);
        if (detail.vulnerability_level) lines.push(`- **Vulnerability level:** ${detail.vulnerability_level}`);
        lines.push('');
      }
    }

    if (vuln.vulnerability_by_area && typeof vuln.vulnerability_by_area === 'object') {
      lines.push('### Vulnerability by Area\n');
      for (const [area, assessment] of Object.entries(vuln.vulnerability_by_area)) {
        const name = area.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
        lines.push(`- **${name}:** ${assessment}`);
      }
      lines.push('');
    }

    if (vuln.assertion_priority) {
      lines.push('### Assertion Priority\n');
      const priorities = Array.isArray(vuln.assertion_priority) ? vuln.assertion_priority : [vuln.assertion_priority];
      for (const [i, p] of priorities.entries()) {
        lines.push(`${i + 1}. ${p}`);
      }
      lines.push('');
    }

    // Handle case where it's structured as product-level entries (alternate format)
    const knownKeys = new Set(['patents_likely_infringed', 'most_impactful_patents', 'vulnerability_by_area', 'assertion_priority']);
    for (const [product, info] of Object.entries(vuln) as any) {
      if (knownKeys.has(product)) continue;
      if (typeof info !== 'object' || info === null) continue;
      const name = product.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
      lines.push(`### ${name}`);
      if (info.patents_likely_infringed) lines.push(`**Patents likely infringed:** ${info.patents_likely_infringed}`);
      if (info.vulnerability_level) lines.push(`**Vulnerability level:** ${info.vulnerability_level}`);
      if (info.key_technology_overlaps) lines.push(`**Key technology overlaps:** ${info.key_technology_overlaps}`);
      if (info.assertion_priority) lines.push(`**Assertion priority:** ${info.assertion_priority}`);
      lines.push('');
    }
  }

  // 4. Top Patents Ranked
  if (data.top_10_patents_ranked || data.top_15_patents_ranked) {
    const ranked = data.top_15_patents_ranked || data.top_10_patents_ranked;
    lines.push('## 4. Top Patents Ranked by Nutanix Litigation Potential\n');
    const patents = Array.isArray(ranked) ? ranked : Object.values(ranked);
    for (const [i, patent] of patents.entries()) {
      lines.push(`**#${i + 1}** — US${patent.patent_id || patent.id || ''}${patent.title ? ': ' + patent.title : ''}`);
      if (patent.nutanix_feature) lines.push(`- **Nutanix feature:** ${patent.nutanix_feature}`);
      if (patent.evidence) lines.push(`- **Evidence:** ${patent.evidence}`);
      if (patent.strength || patent.why_strong) lines.push(`- **Why strong:** ${patent.strength || patent.why_strong}`);
      if (patent.assertion_strategy || patent.recommended_strategy) lines.push(`- **Strategy:** ${patent.assertion_strategy || patent.recommended_strategy}`);
      if (patent.risk_factors) lines.push(`- **Risk factors:** ${patent.risk_factors}`);
      if (patent.nutanix_products) lines.push(`- **Nutanix products:** ${patent.nutanix_products}`);
      lines.push('');
    }
  }

  // 5. Recommended Assertion Strategy
  if (data.recommended_assertion_strategy) {
    lines.push('## 5. Recommended Assertion Strategy\n');
    const strategy = data.recommended_assertion_strategy;
    if (typeof strategy === 'string') {
      lines.push(strategy);
    } else {
      for (const [key, prong] of Object.entries(strategy) as any) {
        const name = key.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
        lines.push(`### ${name}`);
        if (typeof prong === 'string') {
          lines.push(prong);
        } else {
          if (prong.patents) lines.push(`**Patents:** ${Array.isArray(prong.patents) ? prong.patents.join(', ') : prong.patents}`);
          if (prong.description) lines.push(`${prong.description}`);
          if (prong.targets) lines.push(`**Targets:** ${Array.isArray(prong.targets) ? prong.targets.join(', ') : prong.targets}`);
          if (prong.expected_outcomes) lines.push(`**Expected outcomes:** ${prong.expected_outcomes}`);
          if (prong.risk_factors) lines.push(`**Risk factors:** ${prong.risk_factors}`);
        }
        lines.push('');
      }
    }
  }

  // 6. Evidence Summary
  if (data.evidence_summary) {
    lines.push('## 6. Evidence Summary\n');
    const evidence = data.evidence_summary;
    if (typeof evidence === 'string') {
      lines.push(evidence);
    } else {
      for (const [patId, val] of Object.entries(evidence) as any) {
        lines.push(`### US${patId}`);
        if (typeof val === 'string') {
          lines.push(val);
        } else if (typeof val === 'object' && val !== null) {
          if (val.nutanix_feature) lines.push(`- **Nutanix feature:** ${val.nutanix_feature}`);
          if (val.documentation) lines.push(`- **Documentation:** ${val.documentation}`);
          if (val.claim_elements) lines.push(`- **Claim elements:** ${val.claim_elements}`);
          // Render any other keys not explicitly handled
          for (const [k, v] of Object.entries(val)) {
            if (['nutanix_feature', 'documentation', 'claim_elements'].includes(k)) continue;
            const label = k.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
            lines.push(`- **${label}:** ${typeof v === 'string' ? v : JSON.stringify(v)}`);
          }
        }
        lines.push('');
      }
    }
  }

  // 7. Risk Assessment
  if (data.risk_assessment) {
    lines.push('## 7. Risk Assessment\n');
    const risk = data.risk_assessment;
    if (typeof risk === 'string') {
      lines.push(risk);
    } else {
      for (const [key, val] of Object.entries(risk) as any) {
        const name = key.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
        lines.push(`### ${name}`);
        if (typeof val === 'string') lines.push(val);
        else if (Array.isArray(val)) lines.push(val.map((v: any) => `- ${typeof v === 'string' ? v : JSON.stringify(v)}`).join('\n'));
        else lines.push(JSON.stringify(val, null, 2));
        lines.push('');
      }
    }
  }

  return lines.join('\n');
}

async function main() {
  const fa = await prisma.focusArea.findFirst({
    where: { name: 'Nutanix V3 Discovery — Combined' },
    select: { id: true, name: true },
  });
  if (fa === null) {
    console.error('Focus area "Nutanix V3 Discovery — Combined" not found');
    process.exit(1);
  }
  console.log(`Focus area: ${fa.name} (${fa.id})\n`);

  const outputDir = path.resolve('./output/vendor-exports/nutanix-v3-discovery-2026-04-16');

  // 1. Convert collective strategy JSON to markdown
  console.log('--- Generating collective-strategy.md ---');
  const ct = await prisma.promptTemplate.findFirst({
    where: { focusAreaId: fa.id, executionMode: 'COLLECTIVE' },
    select: { id: true },
  });
  if (ct) {
    const cachePath = path.resolve(`./cache/focus-area-prompts/${fa.id}/${ct.id}/_collective.json`);
    if (fs.existsSync(cachePath)) {
      const raw = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
      const response = raw.response;
      let mdContent: string;
      if (typeof response === 'string') {
        mdContent = response;
      } else {
        mdContent = jsonToMarkdown(response);
      }
      fs.writeFileSync(path.join(outputDir, 'collective-strategy.md'), mdContent);
      console.log(`  Written: collective-strategy.md (${mdContent.length} chars)`);
    } else {
      console.log('  No collective cache found');
    }
  }

  // 2. Generate litigation package CSV
  console.log('\n--- Generating litigation package CSV ---');
  const result = await generateLitigationPackageCsv(fa.id);

  const litDir = path.join(process.cwd(), 'output', 'litigation-packages');
  fs.mkdirSync(litDir, { recursive: true });
  fs.writeFileSync(path.join(litDir, result.filename), result.csv, 'utf-8');
  console.log(`  Patents: ${result.patentCount}`);
  console.log(`  Metric keys: ${result.metricKeyCount}`);
  console.log(`  Written: output/litigation-packages/${result.filename}`);

  // Also copy to vendor export dir
  fs.writeFileSync(path.join(outputDir, result.filename), result.csv, 'utf-8');
  console.log(`  Also copied to: ${outputDir}/${result.filename}`);

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('Error:', err);
  await prisma.$disconnect();
  process.exit(1);
});
