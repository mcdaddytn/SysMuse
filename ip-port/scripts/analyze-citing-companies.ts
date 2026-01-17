/**
 * Analyze all companies citing Broadcom patents
 * to identify potential new competitors to track
 */

import * as fs from 'fs';
import * as path from 'path';

const OUTPUT_DIR = './output';

// Current competitors (to identify which are already tracked)
const CURRENT_COMPETITORS = new Set([
  'netflix', 'google', 'youtube', 'alphabet', 'amazon', 'apple', 'disney',
  'hulu', 'roku', 'comcast', 'nbcuniversal', 'peacock', 'microsoft', 'warner',
  'hbo', 'paramount', 'viacomcbs', 'sony', 'spotify', 'meta', 'facebook',
  'tiktok', 'bytedance'
]);

// Also filter out Broadcom-related assignees
const EXCLUDE_PATTERNS = ['broadcom', 'lsi logic', 'avago'];

function normalizeAssignee(name: string): string {
  return name.toLowerCase()
    .replace(/,?\s*(inc|llc|ltd|corp|corporation|company|co|technologies|technology|licensing)\.?$/gi, '')
    .replace(/,?\s*(inc|llc|ltd|corp|corporation|company|co|technologies|technology|licensing)\.?$/gi, '')
    .trim();
}

function isCurrentCompetitor(normalized: string): boolean {
  return [...CURRENT_COMPETITORS].some(c => normalized.includes(c));
}

function isBroadcomRelated(normalized: string): boolean {
  return EXCLUDE_PATTERNS.some(p => normalized.includes(p));
}

interface AssigneeData {
  fullName: string;
  count: number;
  patents: Set<string>;
  broadcomPatentsCited: Set<string>;
}

async function main() {
  // Load all citation overlap files
  const files = fs.readdirSync(OUTPUT_DIR).filter(f =>
    f.startsWith('citation-overlap-') && f.endsWith('.json')
  );

  console.log('Loading citation overlap files:', files.length);

  // Collect all citing assignees
  const assigneeCitations = new Map<string, AssigneeData>();

  for (const file of files) {
    const data = JSON.parse(fs.readFileSync(path.join(OUTPUT_DIR, file), 'utf-8'));
    const results = data.results || data.patentsWithCompetitorCitations || [];

    for (const patent of results) {
      const cites = patent.competitor_cites || [];
      const broadcomPatentId = patent.broadcom_patent_id || patent.patent_id;

      for (const cite of cites) {
        const assignee = cite.assignee || '';
        if (!assignee) continue;

        const normalized = normalizeAssignee(assignee);

        if (!assigneeCitations.has(normalized)) {
          assigneeCitations.set(normalized, {
            fullName: assignee,
            count: 0,
            patents: new Set(),
            broadcomPatentsCited: new Set()
          });
        }
        const entry = assigneeCitations.get(normalized)!;
        entry.count++;
        entry.patents.add(cite.patent_id);
        entry.broadcomPatentsCited.add(broadcomPatentId);
      }
    }
  }

  // Sort by citation count
  const sorted = Array.from(assigneeCitations.entries())
    .map(([key, val]) => ({
      normalized: key,
      fullName: val.fullName,
      citations: val.count,
      uniquePatents: val.patents.size,
      broadcomPatentsCited: val.broadcomPatentsCited.size,
      isCompetitor: isCurrentCompetitor(key),
      isBroadcom: isBroadcomRelated(key)
    }))
    .filter(a => !a.isBroadcom)
    .sort((a, b) => b.citations - a.citations);

  console.log('\n════════════════════════════════════════════════════════════════');
  console.log('  CITING COMPANY ANALYSIS');
  console.log('════════════════════════════════════════════════════════════════\n');

  // Current competitors summary
  const currentCompetitors = sorted.filter(a => a.isCompetitor);
  const potentialCompetitors = sorted.filter(a => !a.isCompetitor);

  console.log('=== CURRENT COMPETITORS (Citations Found) ===\n');
  currentCompetitors.slice(0, 20).forEach((a, i) => {
    console.log(`${String(i + 1).padStart(2)}. ${a.fullName}`);
    console.log(`    Citations: ${a.citations} | Patents: ${a.uniquePatents} | Broadcom cited: ${a.broadcomPatentsCited}`);
  });

  console.log('\n\n=== POTENTIAL NEW COMPETITORS (Not Currently Tracked) ===\n');
  console.log('These companies are citing Broadcom patents but are not in our competitor list:\n');

  potentialCompetitors.slice(0, 50).forEach((a, i) => {
    console.log(`${String(i + 1).padStart(2)}. ${a.fullName}`);
    console.log(`    Citations: ${a.citations} | Patents: ${a.uniquePatents} | Broadcom cited: ${a.broadcomPatentsCited}`);
  });

  // Technology-focused breakdown
  console.log('\n\n=== POTENTIAL COMPETITORS BY LIKELY SECTOR ===\n');

  // Categorize by common keywords
  const sectors: Record<string, typeof potentialCompetitors> = {
    'Semiconductor/Chip': [],
    'Telecom/Network': [],
    'Enterprise/Cloud': [],
    'Consumer Electronics': [],
    'Other Tech': [],
  };

  for (const company of potentialCompetitors.slice(0, 100)) {
    const name = company.normalized;
    if (name.includes('semiconductor') || name.includes('chip') || name.includes('intel') ||
        name.includes('qualcomm') || name.includes('nvidia') || name.includes('amd') ||
        name.includes('texas instruments') || name.includes('micron')) {
      sectors['Semiconductor/Chip'].push(company);
    } else if (name.includes('telecom') || name.includes('cisco') || name.includes('ericsson') ||
               name.includes('nokia') || name.includes('huawei') || name.includes('zte') ||
               name.includes('juniper') || name.includes('verizon') || name.includes('at&t')) {
      sectors['Telecom/Network'].push(company);
    } else if (name.includes('ibm') || name.includes('oracle') || name.includes('sap') ||
               name.includes('salesforce') || name.includes('vmware') || name.includes('dell') ||
               name.includes('hewlett') || name.includes('hp ')) {
      sectors['Enterprise/Cloud'].push(company);
    } else if (name.includes('samsung') || name.includes('lg') || name.includes('panasonic') ||
               name.includes('sharp') || name.includes('lenovo') || name.includes('xiaomi')) {
      sectors['Consumer Electronics'].push(company);
    } else {
      sectors['Other Tech'].push(company);
    }
  }

  for (const [sector, companies] of Object.entries(sectors)) {
    if (companies.length === 0) continue;
    console.log(`\n${sector}:`);
    companies.slice(0, 10).forEach(c => {
      console.log(`  - ${c.fullName} (${c.citations} citations, ${c.broadcomPatentsCited} Broadcom patents)`);
    });
  }

  // Summary stats
  console.log('\n\n=== SUMMARY ===\n');
  console.log(`Total unique citing companies: ${sorted.length}`);
  console.log(`Current competitors found: ${currentCompetitors.length}`);
  console.log(`Potential new competitors: ${potentialCompetitors.length}`);
  console.log(`\nTop potential additions (by citation volume):`);
  potentialCompetitors.slice(0, 10).forEach((c, i) => {
    console.log(`  ${i + 1}. ${c.fullName} - ${c.citations} citations across ${c.broadcomPatentsCited} Broadcom patents`);
  });

  // Save detailed results
  const outputPath = path.join(OUTPUT_DIR, 'citing-company-analysis.json');
  fs.writeFileSync(outputPath, JSON.stringify({
    generatedDate: new Date().toISOString(),
    currentCompetitors: currentCompetitors.map(c => ({
      name: c.fullName,
      citations: c.citations,
      uniquePatents: c.uniquePatents,
      broadcomPatentsCited: c.broadcomPatentsCited
    })),
    potentialCompetitors: potentialCompetitors.slice(0, 100).map(c => ({
      name: c.fullName,
      citations: c.citations,
      uniquePatents: c.uniquePatents,
      broadcomPatentsCited: c.broadcomPatentsCited
    })),
    summary: {
      totalCitingCompanies: sorted.length,
      currentCompetitorsFound: currentCompetitors.length,
      potentialNewCompetitors: potentialCompetitors.length
    }
  }, null, 2));
  console.log(`\n✓ Detailed results saved to: ${outputPath}`);
}

main().catch(console.error);
