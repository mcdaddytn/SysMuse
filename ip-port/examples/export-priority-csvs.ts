/**
 * Export Priority Patents to CSV
 *
 * Merges all batch results and exports tiers to CSV for Excel import.
 */

import * as fs from 'fs/promises';

interface Patent {
  patent_id: string;
  title?: string;
  date?: string;
  assignee?: string;
  forward_citations?: number;
  remaining_years?: number;
  competitor_citations?: number;
  competitors?: string[];
  original_score?: number;
  enhanced_score?: number;
}

function normalizeCompetitor(assignee: string): string {
  const a = (assignee || '').toUpperCase();
  if (a.includes('MICROSOFT')) return 'Microsoft';
  if (a.includes('APPLE')) return 'Apple';
  if (a.includes('GOOGLE')) return 'Google';
  if (a.includes('AMAZON')) return 'Amazon';
  if (a.includes('NETFLIX')) return 'Netflix';
  if (a.includes('SONY')) return 'Sony';
  if (a.includes('COMCAST')) return 'Comcast';
  if (a.includes('DISNEY')) return 'Disney';
  if (a.includes('WARNER')) return 'Warner';
  if (a.includes('META') || a.includes('FACEBOOK')) return 'Meta';
  if (a.includes('ROKU')) return 'Roku';
  if (a.includes('BYTEDANCE') || a.includes('TIKTOK')) return 'ByteDance';
  if (a.includes('HULU')) return 'Hulu';
  if (a.includes('NBC')) return 'NBCUniversal';
  return assignee;
}

function escapeCSV(str: string): string {
  if (!str) return '';
  return str.replace(/"/g, '""');
}

async function main() {
  const timestamp = '2026-01-15';

  const batches = [
    './output/citation-overlap-2026-01-15.json',
    './output/citation-overlap-300-600-2026-01-15.json',
    './output/citation-overlap-600-1000-2026-01-15.json',
    './output/citation-overlap-1000-1500-2026-01-15.json',
    './output/high-cite-overlap-2026-01-15.json',
  ];

  const masterMap = new Map<string, Patent>();

  for (const file of batches) {
    try {
      const data = JSON.parse(await fs.readFile(file, 'utf-8'));
      for (const r of (data.results || [])) {
        const id = r.broadcom_patent_id;
        const existing: Patent = masterMap.get(id) || { patent_id: id, competitors: [] };

        const newCompetitors = (r.competitor_cites || []).map((c: any) => normalizeCompetitor(c.assignee));

        masterMap.set(id, {
          patent_id: id,
          title: existing.title || r.broadcom_title,
          date: existing.date || r.broadcom_date,
          assignee: existing.assignee || r.broadcom_assignee,
          forward_citations: Math.max(existing.forward_citations || 0, r.forward_citations || 0),
          remaining_years: r.remaining_years ?? existing.remaining_years,
          competitor_citations: Math.max(existing.competitor_citations || 0, r.competitor_citations || 0),
          competitors: [...new Set([...(existing.competitors || []), ...newCompetitors])],
          original_score: existing.original_score || r.original_score,
          enhanced_score: Math.max(existing.enhanced_score || 0, r.enhanced_score || 0),
        });
      }
      console.log(`Loaded ${file}`);
    } catch (e) {
      console.log(`Skipped ${file}`);
    }
  }

  const all = [...masterMap.values()];
  console.log(`\nTotal unique patents: ${all.length}`);

  // Create tiers
  const tier1 = all
    .filter(p => (p.competitor_citations || 0) >= 10)
    .sort((a, b) => (b.competitor_citations || 0) - (a.competitor_citations || 0));

  const tier2 = all
    .filter(p => (p.competitor_citations || 0) > 0 && (p.remaining_years || 0) > 2)
    .sort((a, b) => (b.competitor_citations || 0) - (a.competitor_citations || 0));

  const tier3 = all
    .filter(p => (p.forward_citations || 0) >= 100 && (p.competitor_citations || 0) > 0)
    .sort((a, b) => (b.forward_citations || 0) - (a.forward_citations || 0));

  const allPriority = all
    .filter(p => (p.competitor_citations || 0) > 0)
    .sort((a, b) => (b.competitor_citations || 0) - (a.competitor_citations || 0));

  // CSV generator
  function toCSV(patents: Patent[]): string {
    const lines = ['Patent ID,Title,Grant Date,Assignee,Forward Citations,Years Remaining,Competitor Citations,Competitors Citing,Enhanced Score'];
    for (const p of patents) {
      const title = escapeCSV(p.title || '');
      const assignee = escapeCSV(p.assignee || '');
      const competitors = (p.competitors || []).join('; ');
      lines.push(
        `"${p.patent_id}","${title}","${p.date || ''}","${assignee}",${p.forward_citations || 0},${(p.remaining_years || 0).toFixed(1)},${p.competitor_citations || 0},"${competitors}",${(p.enhanced_score || 0).toFixed(1)}`
      );
    }
    return lines.join('\n');
  }

  // Save CSVs
  await fs.writeFile(`./output/priority-tier1-${timestamp}.csv`, toCSV(tier1));
  await fs.writeFile(`./output/priority-tier2-${timestamp}.csv`, toCSV(tier2));
  await fs.writeFile(`./output/priority-tier3-${timestamp}.csv`, toCSV(tier3));
  await fs.writeFile(`./output/priority-all-${timestamp}.csv`, toCSV(allPriority));

  // Updated JSONs
  await fs.writeFile(`./output/priority-tier1-${timestamp}.json`, JSON.stringify(tier1, null, 2));
  await fs.writeFile(`./output/priority-tier2-${timestamp}.json`, JSON.stringify(tier2, null, 2));
  await fs.writeFile(`./output/priority-tier3-${timestamp}.json`, JSON.stringify(tier3, null, 2));
  await fs.writeFile(`./output/priority-all-${timestamp}.json`, JSON.stringify(allPriority, null, 2));

  console.log(`\n=== Results ===`);
  console.log(`Tier 1 (10+ competitor cites): ${tier1.length} patents`);
  console.log(`Tier 2 (cites + 2+ years term): ${tier2.length} patents`);
  console.log(`Tier 3 (100+ fwd cites + overlap): ${tier3.length} patents`);
  console.log(`All with competitor citations: ${allPriority.length} patents`);

  // Competitor summary
  const compStats = new Map<string, number>();
  for (const p of allPriority) {
    for (const c of (p.competitors || [])) {
      compStats.set(c, (compStats.get(c) || 0) + 1);
    }
  }

  console.log('\n=== Competitor Exposure ===');
  const sorted = [...compStats.entries()].sort((a, b) => b[1] - a[1]);
  for (const [comp, count] of sorted) {
    console.log(`  ${comp}: ${count} Broadcom patents cited`);
  }

  console.log('\n✓ Files saved:');
  console.log(`  - priority-tier1-${timestamp}.csv (${tier1.length} patents)`);
  console.log(`  - priority-tier2-${timestamp}.csv (${tier2.length} patents)`);
  console.log(`  - priority-tier3-${timestamp}.csv (${tier3.length} patents)`);
  console.log(`  - priority-all-${timestamp}.csv (${allPriority.length} patents)`);
}

main().catch(console.error);
