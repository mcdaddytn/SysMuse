/**
 * Citation Co-occurrence Report Generator
 *
 * Groups Broadcom patents by common citators for litigation packaging.
 * If competitor patent X cites both Broadcom patents A and B, then A and B
 * are "co-cited" and form a natural litigation bundle.
 *
 * Output:
 *   - Clusters of Broadcom patents that share common citators
 *   - Per-cluster: which competitor patents/companies cite the cluster
 *   - Recommendation for litigation packaging
 *
 * Usage:
 *   npx tsx scripts/generate-cocitation-report.ts [--min-overlap 2] [--top 50]
 */

import * as fs from 'fs';
import * as path from 'path';

// Configuration
const OUTPUT_DIR = './output';
const TOP250_PATH = './output/unified-top250-v3-2026-01-18.json';

interface CompetitorCite {
  patent_id: string;
  patent_title: string;
  patent_date: string;
  assignee: string;
}

interface CitationResult {
  broadcom_patent_id: string;
  broadcom_title: string;
  broadcom_assignee: string;
  broadcom_date: string;
  competitor_citations: number;
  competitor_cites: CompetitorCite[];
}

interface CitationOverlapFile {
  metadata: {
    generatedDate: string;
    totalAnalyzed: number;
    competitorsChecked: string[];
  };
  results: CitationResult[];
}

interface CoCitationCluster {
  clusterId: number;
  broadcomPatents: string[];
  commonCitators: {
    patentId: string;
    title: string;
    assignee: string;
    date: string;
  }[];
  companies: Map<string, number>;
  totalCoCitations: number;
  avgPatentScore?: number;
}

interface PatentPair {
  patentA: string;
  patentB: string;
  sharedCitators: string[];
  sharedCount: number;
}

// ============================================================================
// Data Loading
// ============================================================================

function loadAllCitationData(): Map<string, CitationResult> {
  const results = new Map<string, CitationResult>();

  const files = fs.readdirSync(OUTPUT_DIR)
    .filter(f => f.startsWith('citation-overlap-') && f.endsWith('.json'))
    .map(f => path.join(OUTPUT_DIR, f));

  console.log(`Found ${files.length} citation overlap files`);

  for (const file of files) {
    try {
      const data: CitationOverlapFile = JSON.parse(fs.readFileSync(file, 'utf-8'));
      for (const result of data.results || []) {
        if (result.broadcom_patent_id && result.competitor_cites?.length > 0) {
          // Merge if exists (may have duplicate entries)
          const existing = results.get(result.broadcom_patent_id);
          if (existing) {
            // Merge competitor cites
            const existingIds = new Set(existing.competitor_cites.map(c => c.patent_id));
            for (const cite of result.competitor_cites) {
              if (!existingIds.has(cite.patent_id)) {
                existing.competitor_cites.push(cite);
              }
            }
            existing.competitor_citations = existing.competitor_cites.length;
          } else {
            results.set(result.broadcom_patent_id, result);
          }
        }
      }
    } catch (e) {
      // Skip invalid files
    }
  }

  console.log(`Loaded ${results.size} Broadcom patents with competitor citations`);
  return results;
}

function loadTop250PatentIds(): Set<string> {
  const ids = new Set<string>();

  // Try to load from unified top 250
  const top250Files = fs.readdirSync(OUTPUT_DIR)
    .filter(f => f.startsWith('unified-top250-v3-') && f.endsWith('.json'))
    .sort()
    .reverse();

  if (top250Files.length > 0) {
    const data = JSON.parse(fs.readFileSync(path.join(OUTPUT_DIR, top250Files[0]), 'utf-8'));
    for (const p of data.patents || []) {
      ids.add(p.patent_id);
    }
    console.log(`Loaded ${ids.size} patents from top 250`);
  }

  return ids;
}

// ============================================================================
// Co-citation Analysis
// ============================================================================

function buildInvertedIndex(citationData: Map<string, CitationResult>): Map<string, string[]> {
  // Map: competitor_patent_id -> [broadcom_patent_ids it cites]
  const inverted = new Map<string, string[]>();

  for (const [broadcomId, result] of citationData) {
    for (const cite of result.competitor_cites) {
      const existing = inverted.get(cite.patent_id) || [];
      if (!existing.includes(broadcomId)) {
        existing.push(broadcomId);
      }
      inverted.set(cite.patent_id, existing);
    }
  }

  // Filter to only citators that cite 2+ Broadcom patents
  const filtered = new Map<string, string[]>();
  for (const [compId, broadcomIds] of inverted) {
    if (broadcomIds.length >= 2) {
      filtered.set(compId, broadcomIds);
    }
  }

  console.log(`Found ${filtered.size} competitor patents that cite 2+ Broadcom patents`);
  return filtered;
}

function findPairwiseOverlaps(
  inverted: Map<string, string[]>,
  citationData: Map<string, CitationResult>,
  minOverlap: number
): PatentPair[] {
  // Count shared citators for each pair of Broadcom patents
  const pairCounts = new Map<string, Set<string>>();

  for (const [compId, broadcomIds] of inverted) {
    // For all pairs within this citator's list
    for (let i = 0; i < broadcomIds.length; i++) {
      for (let j = i + 1; j < broadcomIds.length; j++) {
        const pairKey = [broadcomIds[i], broadcomIds[j]].sort().join('|');
        const existing = pairCounts.get(pairKey) || new Set();
        existing.add(compId);
        pairCounts.set(pairKey, existing);
      }
    }
  }

  // Convert to sorted list of pairs
  const pairs: PatentPair[] = [];
  for (const [pairKey, citators] of pairCounts) {
    if (citators.size >= minOverlap) {
      const [patentA, patentB] = pairKey.split('|');
      pairs.push({
        patentA,
        patentB,
        sharedCitators: Array.from(citators),
        sharedCount: citators.size,
      });
    }
  }

  pairs.sort((a, b) => b.sharedCount - a.sharedCount);
  console.log(`Found ${pairs.length} patent pairs with ${minOverlap}+ shared citators`);
  return pairs;
}

function buildClusters(
  pairs: PatentPair[],
  citationData: Map<string, CitationResult>,
  inverted: Map<string, string[]>
): CoCitationCluster[] {
  // Use union-find to group patents into clusters
  const parent = new Map<string, string>();

  function find(x: string): string {
    if (!parent.has(x)) parent.set(x, x);
    if (parent.get(x) !== x) {
      parent.set(x, find(parent.get(x)!));
    }
    return parent.get(x)!;
  }

  function union(x: string, y: string): void {
    const px = find(x);
    const py = find(y);
    if (px !== py) {
      parent.set(px, py);
    }
  }

  // Build clusters from pairs
  for (const pair of pairs) {
    union(pair.patentA, pair.patentB);
  }

  // Group by cluster root
  const clusterMap = new Map<string, Set<string>>();
  const allPatents = new Set<string>();
  for (const pair of pairs) {
    allPatents.add(pair.patentA);
    allPatents.add(pair.patentB);
  }

  for (const patent of allPatents) {
    const root = find(patent);
    const cluster = clusterMap.get(root) || new Set();
    cluster.add(patent);
    clusterMap.set(root, cluster);
  }

  // Build cluster details
  const clusters: CoCitationCluster[] = [];
  let clusterId = 1;

  for (const [_, patents] of clusterMap) {
    const patentArray = Array.from(patents);

    // Find common citators for the cluster
    const citatorCounts = new Map<string, number>();
    for (const patent of patentArray) {
      const result = citationData.get(patent);
      if (result) {
        for (const cite of result.competitor_cites) {
          const invList = inverted.get(cite.patent_id);
          if (invList && invList.filter(p => patents.has(p)).length >= 2) {
            citatorCounts.set(cite.patent_id, (citatorCounts.get(cite.patent_id) || 0) + 1);
          }
        }
      }
    }

    // Get top citators (cite 2+ patents in cluster)
    const commonCitators: CoCitationCluster['commonCitators'] = [];
    const companies = new Map<string, number>();

    for (const [citatorId, count] of citatorCounts) {
      if (count >= 2) {
        // Find citator details from any patent's data
        for (const patent of patentArray) {
          const result = citationData.get(patent);
          const cite = result?.competitor_cites.find(c => c.patent_id === citatorId);
          if (cite) {
            commonCitators.push({
              patentId: cite.patent_id,
              title: cite.patent_title,
              assignee: cite.assignee,
              date: cite.patent_date,
            });

            // Normalize company name
            const company = normalizeCompany(cite.assignee);
            companies.set(company, (companies.get(company) || 0) + 1);
            break;
          }
        }
      }
    }

    if (commonCitators.length > 0) {
      clusters.push({
        clusterId: clusterId++,
        broadcomPatents: patentArray.sort(),
        commonCitators: commonCitators.sort((a, b) => b.patentId.localeCompare(a.patentId)),
        companies,
        totalCoCitations: commonCitators.length,
      });
    }
  }

  // Sort by cluster size then co-citations
  clusters.sort((a, b) => {
    if (b.broadcomPatents.length !== a.broadcomPatents.length) {
      return b.broadcomPatents.length - a.broadcomPatents.length;
    }
    return b.totalCoCitations - a.totalCoCitations;
  });

  // Re-number after sort
  clusters.forEach((c, i) => c.clusterId = i + 1);

  console.log(`Built ${clusters.length} clusters`);
  return clusters;
}

function normalizeCompany(assignee: string): string {
  const upper = assignee.toUpperCase();
  if (upper.includes('AMAZON') || upper.includes('AWS')) return 'Amazon';
  if (upper.includes('GOOGLE') || upper.includes('ALPHABET')) return 'Google';
  if (upper.includes('APPLE')) return 'Apple';
  if (upper.includes('MICROSOFT')) return 'Microsoft';
  if (upper.includes('META') || upper.includes('FACEBOOK')) return 'Meta';
  if (upper.includes('NETFLIX')) return 'Netflix';
  if (upper.includes('COMCAST') || upper.includes('NBCUNIVERSAL')) return 'Comcast';
  if (upper.includes('DISNEY') || upper.includes('HULU')) return 'Disney';
  if (upper.includes('WARNER') || upper.includes('HBO')) return 'Warner Bros';
  if (upper.includes('BYTEDANCE') || upper.includes('TIKTOK')) return 'ByteDance';
  if (upper.includes('SONY')) return 'Sony';
  if (upper.includes('SAMSUNG')) return 'Samsung';
  if (upper.includes('QUALCOMM')) return 'Qualcomm';
  if (upper.includes('INTEL')) return 'Intel';
  if (upper.includes('NVIDIA')) return 'NVIDIA';
  if (upper.includes('CISCO')) return 'Cisco';
  if (upper.includes('IBM')) return 'IBM';
  return assignee;
}

// ============================================================================
// Report Generation
// ============================================================================

function generateReport(
  clusters: CoCitationCluster[],
  citationData: Map<string, CitationResult>,
  top250Ids: Set<string>,
  minOverlap: number
): void {
  const dateStr = new Date().toISOString().split('T')[0];

  // JSON output
  const jsonOutput = {
    generated: new Date().toISOString(),
    parameters: {
      minOverlap,
      totalClusters: clusters.length,
      totalPatentsInClusters: new Set(clusters.flatMap(c => c.broadcomPatents)).size,
    },
    clusters: clusters.map(c => ({
      clusterId: c.clusterId,
      patentCount: c.broadcomPatents.length,
      broadcomPatents: c.broadcomPatents.map(pid => {
        const result = citationData.get(pid);
        return {
          patentId: pid,
          title: result?.broadcom_title || '',
          date: result?.broadcom_date || '',
          inTop250: top250Ids.has(pid),
          competitorCitations: result?.competitor_citations || 0,
        };
      }),
      coCitationCount: c.totalCoCitations,
      topCompanies: Array.from(c.companies.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([company, count]) => ({ company, patents: count })),
      sampleCitators: c.commonCitators.slice(0, 10).map(ct => ({
        patentId: ct.patentId,
        title: ct.title,
        assignee: ct.assignee,
      })),
    })),
  };

  const jsonPath = `./output/cocitation-clusters-${dateStr}.json`;
  fs.writeFileSync(jsonPath, JSON.stringify(jsonOutput, null, 2));
  console.log(`\nExported: ${jsonPath}`);

  // CSV summary
  const csvRows = ['cluster_id,patent_count,cocitation_count,top_company,top_company_patents,patents_in_top250,patent_ids'];
  for (const c of clusters) {
    const topCompany = Array.from(c.companies.entries()).sort((a, b) => b[1] - a[1])[0];
    const inTop250 = c.broadcomPatents.filter(p => top250Ids.has(p)).length;
    csvRows.push([
      c.clusterId,
      c.broadcomPatents.length,
      c.totalCoCitations,
      topCompany?.[0] || '',
      topCompany?.[1] || 0,
      inTop250,
      `"${c.broadcomPatents.join('; ')}"`,
    ].join(','));
  }

  const csvPath = `./output/cocitation-clusters-${dateStr}.csv`;
  fs.writeFileSync(csvPath, csvRows.join('\n'));
  console.log(`Exported: ${csvPath}`);

  // Also export to excel folder for easy access
  const excelCsvPath = `./excel/COCITATION-CLUSTERS-${dateStr}.csv`;
  fs.writeFileSync(excelCsvPath, csvRows.join('\n'));
  console.log(`Exported: ${excelCsvPath}`);

  // Print summary
  console.log('\n' + '='.repeat(70));
  console.log('CO-CITATION CLUSTER REPORT');
  console.log('='.repeat(70));
  console.log(`\nClusters found: ${clusters.length}`);
  console.log(`Patents in clusters: ${jsonOutput.parameters.totalPatentsInClusters}`);
  console.log(`Minimum overlap threshold: ${minOverlap} shared citators\n`);

  // Top 10 clusters
  console.log('TOP 10 CLUSTERS (by size):');
  console.log('-'.repeat(70));

  for (const c of clusters.slice(0, 10)) {
    const topCompany = Array.from(c.companies.entries()).sort((a, b) => b[1] - a[1])[0];
    const inTop250 = c.broadcomPatents.filter(p => top250Ids.has(p)).length;

    console.log(`\nCluster #${c.clusterId}: ${c.broadcomPatents.length} patents, ${c.totalCoCitations} co-citators`);
    console.log(`  Top company: ${topCompany?.[0]} (${topCompany?.[1]} patents)`);
    console.log(`  In Top 250: ${inTop250}/${c.broadcomPatents.length}`);
    console.log(`  Patents: ${c.broadcomPatents.slice(0, 5).join(', ')}${c.broadcomPatents.length > 5 ? '...' : ''}`);
  }

  // Company summary
  console.log('\n' + '-'.repeat(70));
  console.log('COMPANY SUMMARY (across all clusters):');
  console.log('-'.repeat(70));

  const globalCompanies = new Map<string, { clusters: number; patents: number }>();
  for (const c of clusters) {
    for (const [company, count] of c.companies) {
      const existing = globalCompanies.get(company) || { clusters: 0, patents: 0 };
      existing.clusters++;
      existing.patents += count;
      globalCompanies.set(company, existing);
    }
  }

  const sortedCompanies = Array.from(globalCompanies.entries())
    .sort((a, b) => b[1].clusters - a[1].clusters)
    .slice(0, 10);

  for (const [company, stats] of sortedCompanies) {
    console.log(`  ${company}: ${stats.clusters} clusters, ${stats.patents} total citator patents`);
  }
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const args = process.argv.slice(2);

  // Parse arguments
  let minOverlap = 2;
  let limitClusters = 100;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--min-overlap' && args[i + 1]) {
      minOverlap = parseInt(args[i + 1], 10);
    }
    if (args[i] === '--top' && args[i + 1]) {
      limitClusters = parseInt(args[i + 1], 10);
    }
  }

  console.log('='.repeat(70));
  console.log('Citation Co-occurrence Analysis');
  console.log('='.repeat(70));
  console.log(`Parameters: min-overlap=${minOverlap}`);

  // Load data
  const citationData = loadAllCitationData();
  const top250Ids = loadTop250PatentIds();

  if (citationData.size === 0) {
    console.error('No citation data found. Run citation overlap analysis first.');
    process.exit(1);
  }

  // Build analysis
  const inverted = buildInvertedIndex(citationData);
  const pairs = findPairwiseOverlaps(inverted, citationData, minOverlap);
  const clusters = buildClusters(pairs, citationData, inverted);

  // Generate report
  generateReport(clusters.slice(0, limitClusters), citationData, top250Ids, minOverlap);

  console.log('\n' + '='.repeat(70));
  console.log('DONE');
  console.log('='.repeat(70));
}

main().catch(console.error);
