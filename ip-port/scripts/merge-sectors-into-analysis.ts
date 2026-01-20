#!/usr/bin/env npx tsx
/**
 * Merge Sector Assignments into Multi-Score Analysis
 *
 * Adds sector and super-sector assignments to each patent in the analysis.
 *
 * Usage: npx tsx scripts/merge-sectors-into-analysis.ts
 */

import * as fs from 'fs';

interface SectorAssignment {
  sector: string;
  sectorName: string;
  cpc_codes?: string[];
  source?: string;
}

interface SuperSectorConfig {
  superSectors: {
    [key: string]: {
      displayName: string;
      sectors: string[];
    };
  };
}

interface Patent {
  patent_id: string;
  sector?: string;
  sectorName?: string;
  superSector?: string;
  superSectorName?: string;
  [key: string]: any;
}

interface MultiScoreAnalysis {
  metadata: any;
  patents: Patent[];
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('        MERGE SECTOR ASSIGNMENTS INTO ANALYSIS');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Load multi-score analysis
  const analysisFile = './output/multi-score-analysis-LATEST.json';
  console.log(`Loading: ${analysisFile}`);
  const analysis: MultiScoreAnalysis = JSON.parse(fs.readFileSync(analysisFile, 'utf-8'));
  console.log(`  Patents: ${analysis.patents.length.toLocaleString()}`);

  // Load sector assignments
  const sectorFile = './output/patent-sector-assignments.json';
  console.log(`Loading: ${sectorFile}`);
  const sectorAssignments: Record<string, SectorAssignment> = JSON.parse(
    fs.readFileSync(sectorFile, 'utf-8')
  );
  console.log(`  Sector assignments: ${Object.keys(sectorAssignments).length.toLocaleString()}`);

  // Load super-sector config
  const superSectorFile = './config/super-sectors.json';
  console.log(`Loading: ${superSectorFile}`);
  const superSectorConfig: SuperSectorConfig = JSON.parse(
    fs.readFileSync(superSectorFile, 'utf-8')
  );

  // Build sector -> super-sector mapping
  const sectorToSuperSector = new Map<string, { key: string; name: string }>();
  for (const [superKey, superData] of Object.entries(superSectorConfig.superSectors)) {
    for (const sector of superData.sectors) {
      sectorToSuperSector.set(sector, {
        key: superKey,
        name: superData.displayName,
      });
    }
  }
  console.log(`  Super-sector mappings: ${sectorToSuperSector.size}\n`);

  // Merge sectors into analysis
  let merged = 0;
  let notFound = 0;
  let noSuperSector = 0;

  for (const patent of analysis.patents) {
    const assignment = sectorAssignments[patent.patent_id];
    if (assignment) {
      patent.sector = assignment.sector;
      patent.sectorName = assignment.sectorName;

      const superSector = sectorToSuperSector.get(assignment.sector);
      if (superSector) {
        patent.superSector = superSector.key;
        patent.superSectorName = superSector.name;
      } else {
        patent.superSector = 'OTHER';
        patent.superSectorName = 'Other';
        noSuperSector++;
      }
      merged++;
    } else {
      notFound++;
    }
  }

  console.log('MERGE RESULTS:');
  console.log('─'.repeat(50));
  console.log(`  Sectors merged:      ${merged.toLocaleString()}`);
  console.log(`  Not in assignments:  ${notFound.toLocaleString()}`);
  console.log(`  No super-sector:     ${noSuperSector.toLocaleString()}`);

  // Update metadata
  analysis.metadata.sectorMerge = {
    mergedAt: new Date().toISOString(),
    totalMerged: merged,
    notFound: notFound,
  };

  // Save
  const today = new Date().toISOString().split('T')[0];
  const outputFile = `./output/multi-score-analysis-${today}.json`;
  fs.writeFileSync(outputFile, JSON.stringify(analysis, null, 2));

  const latestFile = './output/multi-score-analysis-LATEST.json';
  if (fs.existsSync(latestFile)) {
    fs.unlinkSync(latestFile);
  }
  fs.copyFileSync(outputFile, latestFile);

  console.log(`\n✓ Saved: ${outputFile}`);
  console.log(`✓ Updated: ${latestFile}`);

  // Verify
  const withSector = analysis.patents.filter(p => p.sector).length;
  console.log(`\nSector coverage: ${withSector.toLocaleString()} / ${analysis.patents.length.toLocaleString()} (${((withSector / analysis.patents.length) * 100).toFixed(1)}%)`);

  console.log('\n' + '═'.repeat(60) + '\n');
}

main().catch(console.error);
