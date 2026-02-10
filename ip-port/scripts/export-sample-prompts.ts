/**
 * Export sample LLM prompts for review
 * Usage: npx tsx scripts/export-sample-prompts.ts [sector] [limit]
 * Example: npx tsx scripts/export-sample-prompts.ts video-codec 3
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { extractClaimsText } from '../src/api/services/patent-xml-parser-service.js';

// ES module compatible __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// USPTO XML directory for claims extraction
const USPTO_XML_DIR = process.env.USPTO_PATENT_GRANT_XML_DIR || '/Volumes/PortFat4/uspto/bulkdata/export';

async function loadPatentData(patentId: string) {
  // Load from PatentsView cache
  const pvCachePath = path.join(__dirname, `../cache/api/patentsview/patent/${patentId}.json`);
  if (fs.existsSync(pvCachePath)) {
    const data = JSON.parse(fs.readFileSync(pvCachePath, 'utf-8'));
    return {
      patent_id: patentId,
      patent_title: data.patent_title,
      abstract: data.patent_abstract,
      cpc_codes: data.cpcs?.map((c: any) => c.cpc_subgroup_id) || []
    };
  }
  return null;
}

function loadClaims(patentId: string): string | null {
  // Extract claims from USPTO XML files (same as LLM scoring service)
  return extractClaimsText(patentId, USPTO_XML_DIR, {
    independentOnly: true,
    maxClaims: 5,
    maxTokens: 800
  });
}

function loadScoringTemplate(sectorName: string) {
  // Load portfolio default
  const portfolioPath = path.join(__dirname, '../config/scoring-templates/portfolio-default.json');
  const portfolio = JSON.parse(fs.readFileSync(portfolioPath, 'utf-8'));

  // Load sector template
  const sectorPath = path.join(__dirname, `../config/scoring-templates/sectors/${sectorName}.json`);
  if (!fs.existsSync(sectorPath)) {
    console.error(`Sector template not found: ${sectorPath}`);
    return null;
  }
  const sector = JSON.parse(fs.readFileSync(sectorPath, 'utf-8'));

  // Load super-sector template
  const superSectorName = sector.superSectorName?.toLowerCase().replace('_', '-');
  const superSectorPath = path.join(__dirname, `../config/scoring-templates/super-sectors/${superSectorName}.json`);
  let superSector = null;
  if (fs.existsSync(superSectorPath)) {
    superSector = JSON.parse(fs.readFileSync(superSectorPath, 'utf-8'));
  }

  // Merge questions
  const questions = [
    ...portfolio.questions,
    ...(superSector?.questions || []),
    ...sector.questions
  ];

  return {
    name: sector.name,
    inheritanceChain: ['portfolio-default', superSectorName, sectorName].filter(Boolean),
    questions,
    contextDescription: sector.contextDescription,
    scoringGuidance: [
      ...(portfolio.scoringGuidance || []),
      ...(superSector?.scoringGuidance || []),
      ...(sector.scoringGuidance || [])
    ]
  };
}

function buildPrompt(patent: any, template: any, claimsText: string | null): string {
  const questions = template.questions;

  const questionPrompts = questions.map((q: any, idx: number) => {
    let prompt = `### Question ${idx + 1}: ${q.displayName}\n`;
    prompt += `${q.question}\n`;
    prompt += `Scale: ${q.scale.min}-${q.scale.max}\n`;
    if (q.reasoningPrompt) {
      prompt += `Reasoning guidance: ${q.reasoningPrompt}\n`;
    }
    return prompt;
  }).join('\n');

  const guidanceSection = template.scoringGuidance?.length > 0
    ? `\n## Scoring Guidance\n${template.scoringGuidance.map((g: string) => `- ${g}`).join('\n')}\n`
    : '';

  return `# Patent Scoring Assessment

You are evaluating a patent for a patent portfolio analysis. Score the patent on multiple dimensions.

${template.contextDescription ? `## Context\n${template.contextDescription}\n` : ''}
${guidanceSection}

## Patent Information

**Patent ID:** ${patent.patent_id}
**Title:** ${patent.patent_title}
**CPC Codes:** ${patent.cpc_codes?.join(', ') || 'N/A'}

**Abstract:**
${patent.abstract || 'No abstract available.'}
${claimsText ? `\n## Key Claims\n${claimsText}` : '\n## Claims\n(No claims available - scoring based on abstract only)'}

## Scoring Questions

For each question below, provide:
1. A numeric score within the specified scale
2. A brief reasoning explaining your score (2-3 sentences)
3. A confidence level (high/medium/low)

${questionPrompts}

## Response Format

Respond with a JSON object containing the scores.`;
}

async function main() {
  const args = process.argv.slice(2);
  const sectorName = args[0] || 'video-codec';
  const limit = parseInt(args[1]) || 3;

  console.log(`\n=== Exporting Sample Prompts for ${sectorName} ===\n`);

  // Load template
  const template = loadScoringTemplate(sectorName);
  if (!template) {
    process.exit(1);
  }

  console.log(`Template: ${template.inheritanceChain.join(' → ')}`);
  console.log(`Questions: ${template.questions.length}`);
  console.log('');

  // Get sample patents from the sector via database query
  const { execSync } = await import('child_process');
  let patentIds: string[] = [];

  try {
    const query = `SELECT patent_id FROM patent_sub_sector_scores WHERE template_config_id = '${sectorName}' LIMIT ${limit};`;
    const result = execSync(
      `docker exec ip-port-postgres psql -U ip_admin -d ip_portfolio -t -c "${query}"`,
      { encoding: 'utf-8' }
    );
    patentIds = result.trim().split('\n').map(id => id.trim()).filter(id => id);
    console.log(`Found ${patentIds.length} patents from database for sector: ${sectorName}`);
  } catch {
    console.log('Database query failed, using fallback...');
    patentIds = ['9282328', '9406252', '8705567'].slice(0, limit);
  }

  // Output directory
  const outputDir = path.join(__dirname, '../exports/sample-prompts');
  fs.mkdirSync(outputDir, { recursive: true });

  for (let i = 0; i < patentIds.length; i++) {
    const patentId = patentIds[i];
    console.log(`Processing patent ${i + 1}/${patentIds.length}: ${patentId}`);

    const patent = await loadPatentData(patentId);
    if (!patent) {
      console.log(`  - Patent data not found in cache`);
      continue;
    }

    const claims = loadClaims(patentId);
    console.log(`  - Title: ${patent.patent_title?.substring(0, 60)}...`);
    console.log(`  - Claims: ${claims ? 'Yes' : 'No'}`);

    const prompt = buildPrompt(patent, template, claims);

    // Save prompt
    const outputFile = path.join(outputDir, `${sectorName}_${patentId}.txt`);
    fs.writeFileSync(outputFile, prompt);
    console.log(`  - Saved to: ${outputFile}`);
  }

  console.log(`\n=== Done. Prompts saved to ${outputDir} ===\n`);
}

main().catch(console.error);
