/**
 * Merge Priority Subsets
 *
 * Combines all analysis results into prioritized subsets for partner review.
 * Creates multiple tiers based on different criteria.
 */

import * as fs from 'fs/promises';

interface PatentRecord {
  patent_id: string;
  title?: string;
  date?: string;
  assignee?: string;
  forward_citations?: number;
  remaining_years?: number;
  competitor_citations?: number;
  competitors_citing?: string[];
  cpc_overlap?: boolean;
  original_score?: number;
  enhanced_score?: number;
  source?: string[];
}

async function loadJSON(path: string): Promise<any> {
  try {
    return JSON.parse(await fs.readFile(path, 'utf-8'));
  } catch (e) {
    console.log(`  Warning: Could not load ${path}`);
    return null;
  }
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('     MERGING PRIORITY SUBSETS');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const masterMap: Map<string, PatentRecord> = new Map();

  // Load citation overlap results (0-300)
  console.log('Loading citation overlap 0-300...');
  const overlap0_300 = await loadJSON('./output/citation-overlap-2026-01-15.json');
  if (overlap0_300?.results) {
    for (const r of overlap0_300.results) {
      const existing: PatentRecord = masterMap.get(r.broadcom_patent_id) || { patent_id: r.broadcom_patent_id, source: [] };
      existing.title = r.broadcom_title;
      existing.date = r.broadcom_date;
      existing.assignee = r.broadcom_assignee;
      existing.forward_citations = r.forward_citations;
      existing.remaining_years = r.remaining_years;
      existing.competitor_citations = (existing.competitor_citations || 0) + r.competitor_citations;
      existing.competitors_citing = [...new Set([
        ...(existing.competitors_citing || []),
        ...r.competitor_cites.map((c: any) => c.assignee)
      ])];
      existing.original_score = r.original_score;
      existing.enhanced_score = r.enhanced_score;
      existing.source = [...(existing.source || []), 'overlap-0-300'];
      masterMap.set(r.broadcom_patent_id, existing);
    }
    console.log(`  Added ${overlap0_300.results.length} patents`);
  }

  // Load citation overlap 300-600
  console.log('Loading citation overlap 300-600...');
  const overlap300_600 = await loadJSON('./output/citation-overlap-300-600-2026-01-15.json');
  if (overlap300_600?.results) {
    for (const r of overlap300_600.results) {
      const existing: PatentRecord = masterMap.get(r.broadcom_patent_id) || { patent_id: r.broadcom_patent_id, source: [] };
      existing.title = existing.title || r.broadcom_title;
      existing.date = existing.date || r.broadcom_date;
      existing.assignee = existing.assignee || r.broadcom_assignee;
      existing.forward_citations = existing.forward_citations || r.forward_citations;
      existing.remaining_years = existing.remaining_years || r.remaining_years;
      existing.competitor_citations = Math.max(existing.competitor_citations || 0, r.competitor_citations);
      if (r.competitor_cites?.length > 0) {
        existing.competitors_citing = [...new Set([
          ...(existing.competitors_citing || []),
          ...r.competitor_cites.map((c: any) => c.assignee)
        ])];
      }
      existing.original_score = existing.original_score || r.original_score;
      existing.enhanced_score = Math.max(existing.enhanced_score || 0, r.enhanced_score);
      if (!existing.source?.includes('overlap-300-600')) {
        existing.source = [...(existing.source || []), 'overlap-300-600'];
      }
      masterMap.set(r.broadcom_patent_id, existing);
    }
    console.log(`  Merged ${overlap300_600.results.length} patents`);
  }

  // Load citation overlap 600-1000
  console.log('Loading citation overlap 600-1000...');
  const overlap600_1000 = await loadJSON('./output/citation-overlap-600-1000-2026-01-15.json');
  if (overlap600_1000?.results) {
    for (const r of overlap600_1000.results) {
      const existing: PatentRecord = masterMap.get(r.broadcom_patent_id) || { patent_id: r.broadcom_patent_id, source: [] };
      existing.title = existing.title || r.broadcom_title;
      existing.date = existing.date || r.broadcom_date;
      existing.assignee = existing.assignee || r.broadcom_assignee;
      existing.forward_citations = existing.forward_citations || r.forward_citations;
      existing.remaining_years = existing.remaining_years || r.remaining_years;
      existing.competitor_citations = Math.max(existing.competitor_citations || 0, r.competitor_citations);
      if (r.competitor_cites?.length > 0) {
        existing.competitors_citing = [...new Set([
          ...(existing.competitors_citing || []),
          ...r.competitor_cites.map((c: any) => c.assignee)
        ])];
      }
      existing.original_score = existing.original_score || r.original_score;
      existing.enhanced_score = Math.max(existing.enhanced_score || 0, r.enhanced_score);
      if (!existing.source?.includes('overlap-600-1000')) {
        existing.source = [...(existing.source || []), 'overlap-600-1000'];
      }
      masterMap.set(r.broadcom_patent_id, existing);
    }
    console.log(`  Merged ${overlap600_1000.results.length} patents`);
  }

  // Load high-citation patents
  console.log('Loading high-citation patents...');
  const highCite = await loadJSON('./output/high-cite-overlap-2026-01-15.json');
  if (highCite?.results) {
    for (const r of highCite.results) {
      const existing: PatentRecord = masterMap.get(r.broadcom_patent_id) || { patent_id: r.broadcom_patent_id, source: [] };
      existing.title = existing.title || r.broadcom_title;
      existing.date = existing.date || r.broadcom_date;
      existing.assignee = existing.assignee || r.broadcom_assignee;
      existing.forward_citations = Math.max(existing.forward_citations || 0, r.forward_citations);
      existing.remaining_years = existing.remaining_years ?? r.remaining_years;
      existing.competitor_citations = Math.max(existing.competitor_citations || 0, r.competitor_citations);
      if (r.competitor_cites?.length > 0) {
        existing.competitors_citing = [...new Set([
          ...(existing.competitors_citing || []),
          ...r.competitor_cites.map((c: any) => c.assignee)
        ])];
      }
      if (!existing.source?.includes('high-cite')) {
        existing.source = [...(existing.source || []), 'high-cite'];
      }
      masterMap.set(r.broadcom_patent_id, existing);
    }
    console.log(`  Merged ${highCite.results.length} patents`);
  }

  // Load CPC priority patents
  console.log('Loading CPC priority patents...');
  const cpcPriority = await loadJSON('./output/cpc-priority-patents-2026-01-15.json');
  if (cpcPriority) {
    for (const r of cpcPriority) {
      const existing: PatentRecord = masterMap.get(r.patent_id) || { patent_id: r.patent_id, source: [] };
      existing.title = existing.title || r.title;
      existing.forward_citations = Math.max(existing.forward_citations || 0, r.citations || 0);
      existing.cpc_overlap = true;
      if (!existing.source?.includes('cpc-priority')) {
        existing.source = [...(existing.source || []), 'cpc-priority'];
      }
      masterMap.set(r.patent_id, existing);
    }
    console.log(`  Merged ${cpcPriority.length} patents`);
  }

  console.log(`\nTotal unique patents: ${masterMap.size}\n`);

  // Convert to array and sort
  const allPatents = [...masterMap.values()];

  // Create subsets
  console.log('Creating priority subsets...\n');

  // Tier 1: High competitor citations (10+) regardless of term
  const tier1 = allPatents
    .filter(p => (p.competitor_citations || 0) >= 10)
    .sort((a, b) => (b.competitor_citations || 0) - (a.competitor_citations || 0));

  // Tier 2: Has competitor citations AND remaining term (licensable)
  const tier2 = allPatents
    .filter(p => (p.competitor_citations || 0) > 0 && (p.remaining_years || 0) > 2)
    .sort((a, b) => (b.competitor_citations || 0) - (a.competitor_citations || 0));

  // Tier 3: High citations (100+) with any competitor overlap
  const tier3 = allPatents
    .filter(p => (p.forward_citations || 0) >= 100 && (p.competitor_citations || 0) > 0)
    .sort((a, b) => (b.forward_citations || 0) - (a.forward_citations || 0));

  // Tier 4: CPC overlap + competitor citations
  const tier4 = allPatents
    .filter(p => p.cpc_overlap && (p.competitor_citations || 0) > 0)
    .sort((a, b) => (b.competitor_citations || 0) - (a.competitor_citations || 0));

  // Print summaries
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('SUBSET SUMMARIES');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log(`TIER 1: High Competitor Citations (10+)`);
  console.log(`  Count: ${tier1.length} patents`);
  console.log(`  Use case: Highest priority for claim analysis`);
  console.log(`  Top 5:`);
  for (const p of tier1.slice(0, 5)) {
    console.log(`    ${p.patent_id}: ${p.competitor_citations} competitor cites, ${p.remaining_years?.toFixed(1) || 0} yrs left`);
  }

  console.log(`\nTIER 2: Licensable (competitor cites + 2+ years term)`);
  console.log(`  Count: ${tier2.length} patents`);
  console.log(`  Use case: Active licensing opportunities`);
  console.log(`  Top 5:`);
  for (const p of tier2.slice(0, 5)) {
    console.log(`    ${p.patent_id}: ${p.competitor_citations} cites, ${p.remaining_years?.toFixed(1)} yrs left`);
  }

  console.log(`\nTIER 3: Foundational (100+ fwd citations with competitor overlap)`);
  console.log(`  Count: ${tier3.length} patents`);
  console.log(`  Use case: Technology leadership evidence`);
  console.log(`  Top 5:`);
  for (const p of tier3.slice(0, 5)) {
    console.log(`    ${p.patent_id}: ${p.forward_citations} fwd cites, ${p.competitor_citations} competitor cites`);
  }

  console.log(`\nTIER 4: CPC Overlap + Competitor Citations`);
  console.log(`  Count: ${tier4.length} patents`);
  console.log(`  Use case: Technology area disputes`);

  // Competitor breakdown across all patents with citations
  const competitorStats: Map<string, number> = new Map();
  for (const p of allPatents) {
    for (const comp of (p.competitors_citing || [])) {
      // Normalize competitor names
      const name = comp.toUpperCase().includes('MICROSOFT') ? 'Microsoft' :
                   comp.toUpperCase().includes('APPLE') ? 'Apple' :
                   comp.toUpperCase().includes('GOOGLE') ? 'Google' :
                   comp.toUpperCase().includes('AMAZON') ? 'Amazon' :
                   comp.toUpperCase().includes('NETFLIX') ? 'Netflix' :
                   comp.toUpperCase().includes('COMCAST') ? 'Comcast' :
                   comp.toUpperCase().includes('DISNEY') ? 'Disney' :
                   comp.toUpperCase().includes('SONY') ? 'Sony' :
                   comp.toUpperCase().includes('META') || comp.toUpperCase().includes('FACEBOOK') ? 'Meta' :
                   comp.toUpperCase().includes('WARNER') ? 'Warner' :
                   comp.toUpperCase().includes('ROKU') ? 'Roku' :
                   comp.toUpperCase().includes('BYTEDANCE') || comp.toUpperCase().includes('TIKTOK') ? 'ByteDance' : comp;
      competitorStats.set(name, (competitorStats.get(name) || 0) + 1);
    }
  }

  console.log('\n─────────────────────────────────────────────────────────────');
  console.log('COMPETITOR EXPOSURE (patents citing Broadcom)');
  console.log('─────────────────────────────────────────────────────────────\n');

  const sortedComps = [...competitorStats.entries()].sort((a, b) => b[1] - a[1]);
  for (const [comp, count] of sortedComps.slice(0, 15)) {
    console.log(`  ${comp}: ${count} Broadcom patents cited`);
  }

  // Save subsets
  const timestamp = new Date().toISOString().split('T')[0];

  // Save all tiers
  await fs.writeFile(`./output/priority-tier1-${timestamp}.json`, JSON.stringify(tier1, null, 2));
  await fs.writeFile(`./output/priority-tier2-${timestamp}.json`, JSON.stringify(tier2, null, 2));
  await fs.writeFile(`./output/priority-tier3-${timestamp}.json`, JSON.stringify(tier3, null, 2));
  await fs.writeFile(`./output/priority-tier4-${timestamp}.json`, JSON.stringify(tier4, null, 2));

  // Master CSV for partner review
  const csvLines = [
    'Patent ID,Title,Date,Assignee,Fwd Citations,Years Left,Competitor Cites,Competitors,CPC Priority,Sources'
  ];

  // Combine all unique patents from tiers
  const allPriority = new Map<string, PatentRecord>();
  for (const p of [...tier1, ...tier2, ...tier3, ...tier4]) {
    if (!allPriority.has(p.patent_id)) {
      allPriority.set(p.patent_id, p);
    }
  }

  const sortedAll = [...allPriority.values()].sort((a, b) => (b.competitor_citations || 0) - (a.competitor_citations || 0));

  for (const p of sortedAll) {
    const competitors = (p.competitors_citing || []).slice(0, 5).join('; ');
    csvLines.push(
      `"${p.patent_id}","${(p.title || '').replace(/"/g, '""')}","${p.date || ''}","${p.assignee || ''}",${p.forward_citations || 0},${p.remaining_years?.toFixed(1) || 0},${p.competitor_citations || 0},"${competitors}",${p.cpc_overlap ? 'Yes' : 'No'},"${(p.source || []).join('; ')}"`
    );
  }

  await fs.writeFile(`./output/priority-all-${timestamp}.csv`, csvLines.join('\n'));

  console.log(`\n✓ Results saved:`);
  console.log(`  - priority-tier1-${timestamp}.json (${tier1.length} patents)`);
  console.log(`  - priority-tier2-${timestamp}.json (${tier2.length} patents)`);
  console.log(`  - priority-tier3-${timestamp}.json (${tier3.length} patents)`);
  console.log(`  - priority-tier4-${timestamp}.json (${tier4.length} patents)`);
  console.log(`  - priority-all-${timestamp}.csv (${sortedAll.length} unique priority patents)`);

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('     MERGE COMPLETE');
  console.log('═══════════════════════════════════════════════════════════════\n');
}

main().catch(console.error);
