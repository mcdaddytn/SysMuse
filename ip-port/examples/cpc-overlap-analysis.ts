/**
 * CPC Overlap Analysis
 *
 * Analyzes CPC classification overlap between Broadcom portfolio and competitors.
 * Identifies technology areas where both Broadcom and competitors are active.
 */

import * as fs from 'fs/promises';
import * as dotenv from 'dotenv';
dotenv.config();

interface Patent {
  patent_id: string;
  patent_title?: string;
  patent_date?: string;
  cpc_current?: Array<{ cpc_group_id?: string; cpc_subclass_id?: string }>;
  cpc?: Array<{ cpc_group_id?: string; cpc_subclass_id?: string }>;
  assignees?: Array<{ assignee_organization?: string }>;
  patent_num_times_cited_by_us_patents?: number;
}

interface CPCStats {
  cpc_code: string;
  broadcom_count: number;
  competitor_count: number;
  overlap_ratio: number;
  broadcom_patents: string[];
  competitor_patents: Map<string, string[]>; // competitor name -> patent IDs
  top_broadcom_by_citations: Patent[];
}

const COMPETITORS = [
  { name: 'Netflix', file: 'netflix-streaming-2026-01-15.json' },
  { name: 'Google', file: 'google-youtube-streaming-2026-01-15.json' },
  { name: 'Amazon', file: 'amazon-streaming-2026-01-15.json' },
  { name: 'Apple', file: 'apple-streaming-2026-01-15.json' },
  { name: 'Disney', file: 'disney-streaming-2026-01-15.json' },
  { name: 'Roku', file: 'roku-streaming-2026-01-15.json' },
  { name: 'Comcast', file: 'comcast-streaming-2026-01-15.json' },
  { name: 'Microsoft', file: 'microsoft-streaming-2026-01-15.json' },
];

function getCPCCodes(patent: Patent): string[] {
  const cpcs = patent.cpc_current || patent.cpc || [];
  const codes: string[] = [];

  for (const cpc of cpcs) {
    // Get subclass (e.g., H04N, H04L, G06F)
    if (cpc.cpc_subclass_id) {
      codes.push(cpc.cpc_subclass_id);
    }
    // Get group (more specific, e.g., H04N19/00)
    if (cpc.cpc_group_id) {
      // Extract the main group (before the slash or first few chars)
      const group = cpc.cpc_group_id.split('/')[0];
      if (group && group.length > 3) {
        codes.push(group);
      }
    }
  }

  return [...new Set(codes)];
}

async function loadBroadcomPortfolio(): Promise<Patent[]> {
  console.log('Loading Broadcom portfolio...');

  const patents: Patent[] = [];
  const dir = './output/streaming-video';

  try {
    const files = await fs.readdir(dir);
    for (const file of files) {
      if (file.endsWith('.json') && file.startsWith('patents-batch')) {
        const data = JSON.parse(await fs.readFile(`${dir}/${file}`, 'utf-8'));
        patents.push(...data);
      }
    }
  } catch (e) {
    console.log('  Could not load from streaming-video, trying main portfolio...');
    const data = JSON.parse(await fs.readFile('./output/broadcom-portfolio-2026-01-15.json', 'utf-8'));
    patents.push(...(data.patents || data));
  }

  console.log(`  ✓ Loaded ${patents.length.toLocaleString()} Broadcom patents\n`);
  return patents;
}

async function loadCompetitorPortfolio(competitor: { name: string; file: string }): Promise<Patent[]> {
  try {
    const path = `./output/competitors/${competitor.file}`;
    const data = JSON.parse(await fs.readFile(path, 'utf-8'));
    return data.patents || data;
  } catch (e) {
    console.log(`  Warning: Could not load ${competitor.name} portfolio`);
    return [];
  }
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('     CPC OVERLAP ANALYSIS');
  console.log('     Finding technology overlap between Broadcom & competitors');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Load Broadcom portfolio
  const broadcomPatents = await loadBroadcomPortfolio();

  // Build CPC -> patents map for Broadcom
  const broadcomByCPC: Map<string, Patent[]> = new Map();

  for (const patent of broadcomPatents) {
    const cpcs = getCPCCodes(patent);
    for (const cpc of cpcs) {
      if (!broadcomByCPC.has(cpc)) {
        broadcomByCPC.set(cpc, []);
      }
      broadcomByCPC.get(cpc)!.push(patent);
    }
  }

  console.log(`Broadcom CPC distribution: ${broadcomByCPC.size} unique CPC codes\n`);

  // Load competitor portfolios and build CPC maps
  const competitorByCPC: Map<string, Map<string, Patent[]>> = new Map(); // CPC -> competitor -> patents

  console.log('Loading competitor portfolios...');
  for (const competitor of COMPETITORS) {
    const patents = await loadCompetitorPortfolio(competitor);
    console.log(`  ${competitor.name}: ${patents.length.toLocaleString()} patents`);

    for (const patent of patents) {
      const cpcs = getCPCCodes(patent);
      for (const cpc of cpcs) {
        if (!competitorByCPC.has(cpc)) {
          competitorByCPC.set(cpc, new Map());
        }
        const cpcMap = competitorByCPC.get(cpc)!;
        if (!cpcMap.has(competitor.name)) {
          cpcMap.set(competitor.name, []);
        }
        cpcMap.get(competitor.name)!.push(patent);
      }
    }
  }

  console.log('\n');

  // Find overlapping CPC codes
  const overlapStats: CPCStats[] = [];

  for (const [cpc, broadcomList] of broadcomByCPC) {
    const competitorMap = competitorByCPC.get(cpc);
    if (!competitorMap || competitorMap.size === 0) continue;

    let totalCompetitorCount = 0;
    const competitorPatents: Map<string, string[]> = new Map();

    for (const [compName, compPatents] of competitorMap) {
      totalCompetitorCount += compPatents.length;
      competitorPatents.set(compName, compPatents.map(p => p.patent_id));
    }

    // Sort Broadcom patents by citations
    const sortedBroadcom = [...broadcomList].sort(
      (a, b) => (b.patent_num_times_cited_by_us_patents || 0) - (a.patent_num_times_cited_by_us_patents || 0)
    );

    overlapStats.push({
      cpc_code: cpc,
      broadcom_count: broadcomList.length,
      competitor_count: totalCompetitorCount,
      overlap_ratio: Math.min(broadcomList.length, totalCompetitorCount) / Math.max(broadcomList.length, totalCompetitorCount),
      broadcom_patents: broadcomList.map(p => p.patent_id),
      competitor_patents: competitorPatents,
      top_broadcom_by_citations: sortedBroadcom.slice(0, 5),
    });
  }

  // Sort by total activity (Broadcom + competitor patents)
  overlapStats.sort((a, b) => (b.broadcom_count + b.competitor_count) - (a.broadcom_count + a.competitor_count));

  // Print results
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('RESULTS');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log(`Total CPC codes with overlap: ${overlapStats.length}\n`);

  console.log('─────────────────────────────────────────────────────────────');
  console.log('TOP 30 CPC CODES WITH HIGHEST COMBINED ACTIVITY');
  console.log('─────────────────────────────────────────────────────────────\n');

  for (const stat of overlapStats.slice(0, 30)) {
    const competitors = [...stat.competitor_patents.keys()];
    console.log(`${stat.cpc_code}`);
    console.log(`  Broadcom: ${stat.broadcom_count} patents | Competitors: ${stat.competitor_count}`);
    console.log(`  Active competitors: ${competitors.join(', ')}`);

    // Show top Broadcom patent in this CPC
    if (stat.top_broadcom_by_citations.length > 0) {
      const top = stat.top_broadcom_by_citations[0];
      console.log(`  Top Broadcom: ${top.patent_id} (${top.patent_num_times_cited_by_us_patents || 0} citations)`);
    }
    console.log('');
  }

  // Summary by competitor
  console.log('─────────────────────────────────────────────────────────────');
  console.log('COMPETITOR OVERLAP SUMMARY');
  console.log('─────────────────────────────────────────────────────────────\n');

  const competitorOverlap: Map<string, { cpcCount: number; patentCount: number }> = new Map();

  for (const stat of overlapStats) {
    for (const [comp, patents] of stat.competitor_patents) {
      if (!competitorOverlap.has(comp)) {
        competitorOverlap.set(comp, { cpcCount: 0, patentCount: 0 });
      }
      const data = competitorOverlap.get(comp)!;
      data.cpcCount++;
      data.patentCount += patents.length;
    }
  }

  const sortedCompetitors = [...competitorOverlap.entries()].sort((a, b) => b[1].patentCount - a[1].patentCount);

  for (const [comp, data] of sortedCompetitors) {
    console.log(`${comp}:`);
    console.log(`  Overlapping CPC codes: ${data.cpcCount}`);
    console.log(`  Patents in overlapping areas: ${data.patentCount.toLocaleString()}`);
    console.log('');
  }

  // Save results
  const timestamp = new Date().toISOString().split('T')[0];

  // Full results
  const fullFile = `./output/cpc-overlap-${timestamp}.json`;
  await fs.writeFile(fullFile, JSON.stringify({
    metadata: {
      generatedDate: new Date().toISOString(),
      broadcomPatents: broadcomPatents.length,
      competitors: COMPETITORS.map(c => c.name),
      cpcCodesWithOverlap: overlapStats.length,
    },
    overlapStats: overlapStats.map(s => ({
      ...s,
      competitor_patents: Object.fromEntries(s.competitor_patents),
      top_broadcom_by_citations: s.top_broadcom_by_citations.map(p => ({
        patent_id: p.patent_id,
        title: p.patent_title,
        citations: p.patent_num_times_cited_by_us_patents,
      })),
    })),
  }, null, 2));

  // CSV summary
  const csvFile = `./output/cpc-overlap-summary-${timestamp}.csv`;
  const csvLines = ['CPC Code,Broadcom Patents,Competitor Patents,Active Competitors,Top Broadcom Patent'];
  for (const stat of overlapStats) {
    const competitors = [...stat.competitor_patents.keys()].join('; ');
    const topPatent = stat.top_broadcom_by_citations[0]?.patent_id || '';
    csvLines.push(
      `"${stat.cpc_code}",${stat.broadcom_count},${stat.competitor_count},"${competitors}","${topPatent}"`
    );
  }
  await fs.writeFile(csvFile, csvLines.join('\n'));

  // Priority patents: Broadcom patents in high-overlap CPC areas
  const priorityPatents: Set<string> = new Set();
  for (const stat of overlapStats.slice(0, 50)) { // Top 50 CPC areas
    for (const patent of stat.top_broadcom_by_citations) {
      priorityPatents.add(patent.patent_id);
    }
  }

  const priorityFile = `./output/cpc-priority-patents-${timestamp}.json`;
  const priorityList = [...priorityPatents].map(id => {
    const patent = broadcomPatents.find(p => p.patent_id === id);
    return {
      patent_id: id,
      title: patent?.patent_title,
      citations: patent?.patent_num_times_cited_by_us_patents,
      cpcs: getCPCCodes(patent!),
    };
  }).sort((a, b) => (b.citations || 0) - (a.citations || 0));

  await fs.writeFile(priorityFile, JSON.stringify(priorityList, null, 2));

  console.log(`\n✓ Results saved:`);
  console.log(`  - ${fullFile}`);
  console.log(`  - ${csvFile}`);
  console.log(`  - ${priorityFile} (${priorityList.length} priority patents)`);
}

main().catch(console.error);
