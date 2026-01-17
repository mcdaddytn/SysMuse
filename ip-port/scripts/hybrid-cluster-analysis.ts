/**
 * Hybrid Cluster Analysis
 *
 * Combines citation overlap results with term extraction to create
 * technology-focused clusters for targeted competitor discovery.
 *
 * Usage: npx tsx scripts/hybrid-cluster-analysis.ts [maxPatents] [targetClusters]
 * Example: npx tsx scripts/hybrid-cluster-analysis.ts 75 10
 */

import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { isStopWord } from '../services/stopwords-service.js';

dotenv.config();

const ES_URL = process.env.ELASTICSEARCH_URL || 'http://localhost:9200';
const INDEX_NAME = 'patents';
const OUTPUT_DIR = './output/clusters';

interface SourcePatent {
  patent_id: string;
  title: string;
  assignee: string;
  forward_citations: number;
  competitor_citations: number;
  competitors: string[];
  litigationScore: number;
  overallActionableScore: number;
  isActionable: boolean;
}

interface TermVector {
  patent_id: string;
  title: string;
  terms: Map<string, number>;
  cpc_codes: string[];
}

interface Cluster {
  id: number;
  name: string;
  patents: TermVector[];
  centroidTerms: Array<{ term: string; weight: number }>;
  dominantCPCs: string[];
  intraClusterSimilarity: number;
  totalCompetitorCitations: number;
  uniqueCompetitors: string[];
}

interface ClusterStrategy {
  id: string;
  name: string;
  type: string;
  dateAdded: string;
  parameters: {
    sourceStrategy: string;
    clusterMethod: string;
    patentCount: number;
    patentIds: string[];
    extractedTerms: string[];
    dominantCPCs: string[];
    clusterStrength: number;
    totalCompetitorCitations: number;
  };
}

/**
 * Make a request to ElasticSearch
 */
async function esRequest<T>(path: string, method: string = 'GET', body?: any): Promise<T> {
  const url = `${ES_URL}${path}`;
  const options: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`ES request failed: ${response.status} - ${error}`);
  }

  return response.json() as Promise<T>;
}

/**
 * Load top patents from Strategy 1 results
 */
function loadSourcePatents(maxPatents: number): SourcePatent[] {
  // Find most recent tier-litigation file
  const files = fs.readdirSync('./output')
    .filter(f => f.startsWith('tier-litigation-') && f.endsWith('.json'))
    .sort()
    .reverse();

  if (files.length === 0) {
    throw new Error('No tier-litigation files found in output/');
  }

  const filePath = path.join('./output', files[0]);
  console.log(`Loading source patents from: ${filePath}`);

  const data: SourcePatent[] = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

  // Filter actionable and sort by score
  return data
    .filter(p => p.isActionable)
    .sort((a, b) => b.litigationScore - a.litigationScore)
    .slice(0, maxPatents);
}

/**
 * Extract terms for a single patent from ElasticSearch
 */
async function extractPatentTerms(patentId: string): Promise<{ terms: Map<string, number>; cpc_codes: string[] }> {
  // Get patent document
  const response = await esRequest<any>(`/${INDEX_NAME}/_doc/${patentId}`);

  if (!response.found) {
    return { terms: new Map(), cpc_codes: [] };
  }

  const doc = response._source;
  const abstract = doc.abstract || '';
  const title = doc.title || '';
  const cpc_codes = doc.cpc_codes || [];

  // Use ES term vectors API for term extraction
  const termVectorResponse = await esRequest<any>(
    `/${INDEX_NAME}/_termvectors/${patentId}`,
    'POST',
    {
      fields: ['abstract', 'title'],
      term_statistics: true,
      field_statistics: true,
      positions: false,
      offsets: false
    }
  );

  const terms = new Map<string, number>();

  // Process abstract terms
  const abstractTerms = termVectorResponse.term_vectors?.abstract?.terms || {};
  for (const [term, stats] of Object.entries(abstractTerms) as [string, any][]) {
    if (term.length > 2 && !isStopWord(term)) {
      const tf = stats.term_freq || 1;
      const docFreq = stats.doc_freq || 1;
      // TF-IDF-like weighting
      const weight = tf * Math.log(22706 / (docFreq + 1));
      terms.set(term, (terms.get(term) || 0) + weight);
    }
  }

  // Process title terms (boost by 1.5x)
  const titleTerms = termVectorResponse.term_vectors?.title?.terms || {};
  for (const [term, stats] of Object.entries(titleTerms) as [string, any][]) {
    if (term.length > 2 && !isStopWord(term)) {
      const tf = stats.term_freq || 1;
      const docFreq = stats.doc_freq || 1;
      const weight = tf * Math.log(22706 / (docFreq + 1)) * 1.5;
      terms.set(term, (terms.get(term) || 0) + weight);
    }
  }

  return { terms, cpc_codes };
}

// isStopWord is imported from ../services/stopwords-service.js

/**
 * Calculate cosine similarity between two term vectors
 */
function cosineSimilarity(a: Map<string, number>, b: Map<string, number>): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (const [term, weightA] of a) {
    normA += weightA * weightA;
    const weightB = b.get(term) || 0;
    dotProduct += weightA * weightB;
  }

  for (const [_, weightB] of b) {
    normB += weightB * weightB;
  }

  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Agglomerative clustering
 */
function agglomerativeClustering(
  vectors: TermVector[],
  targetClusters: number
): Cluster[] {
  // Initialize each patent as its own cluster
  let clusters: Cluster[] = vectors.map((v, i) => ({
    id: i,
    name: `Cluster ${i}`,
    patents: [v],
    centroidTerms: [],
    dominantCPCs: [],
    intraClusterSimilarity: 1.0,
    totalCompetitorCitations: 0,
    uniqueCompetitors: []
  }));

  // Pre-compute similarity matrix
  console.log('Computing similarity matrix...');
  const similarities = new Map<string, number>();
  for (let i = 0; i < vectors.length; i++) {
    for (let j = i + 1; j < vectors.length; j++) {
      const sim = cosineSimilarity(vectors[i].terms, vectors[j].terms);
      similarities.set(`${i}-${j}`, sim);
    }
  }

  // Iteratively merge clusters
  while (clusters.length > targetClusters) {
    let bestI = 0, bestJ = 1, bestSim = -1;

    // Find two most similar clusters
    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        const sim = clusterSimilarity(clusters[i], clusters[j], similarities, vectors);
        if (sim > bestSim) {
          bestSim = sim;
          bestI = i;
          bestJ = j;
        }
      }
    }

    // Merge clusters
    const merged: Cluster = {
      id: clusters[bestI].id,
      name: `Cluster ${clusters[bestI].id}`,
      patents: [...clusters[bestI].patents, ...clusters[bestJ].patents],
      centroidTerms: [],
      dominantCPCs: [],
      intraClusterSimilarity: bestSim,
      totalCompetitorCitations: 0,
      uniqueCompetitors: []
    };

    clusters = clusters.filter((_, idx) => idx !== bestI && idx !== bestJ);
    clusters.push(merged);

    if (clusters.length % 5 === 0) {
      console.log(`  Clusters remaining: ${clusters.length}`);
    }
  }

  return clusters;
}

/**
 * Calculate average linkage similarity between two clusters
 */
function clusterSimilarity(
  a: Cluster,
  b: Cluster,
  precomputed: Map<string, number>,
  allVectors: TermVector[]
): number {
  let total = 0;
  let count = 0;

  for (const pa of a.patents) {
    for (const pb of b.patents) {
      const idxA = allVectors.findIndex(v => v.patent_id === pa.patent_id);
      const idxB = allVectors.findIndex(v => v.patent_id === pb.patent_id);
      const key = idxA < idxB ? `${idxA}-${idxB}` : `${idxB}-${idxA}`;
      total += precomputed.get(key) || 0;
      count++;
    }
  }

  return count > 0 ? total / count : 0;
}

/**
 * Compute cluster centroid and metadata
 */
function computeClusterProfile(
  cluster: Cluster,
  sourcePatents: Map<string, SourcePatent>
): void {
  // Aggregate term weights
  const termWeights = new Map<string, number>();
  const cpcCounts = new Map<string, number>();
  let totalCompetitorCites = 0;
  const competitors = new Set<string>();

  for (const patent of cluster.patents) {
    for (const [term, weight] of patent.terms) {
      termWeights.set(term, (termWeights.get(term) || 0) + weight);
    }

    for (const cpc of patent.cpc_codes) {
      const cpcClass = cpc.substring(0, 4); // e.g., H04N
      cpcCounts.set(cpcClass, (cpcCounts.get(cpcClass) || 0) + 1);
    }

    const source = sourcePatents.get(patent.patent_id);
    if (source) {
      totalCompetitorCites += source.competitor_citations;
      source.competitors.forEach(c => competitors.add(c));
    }
  }

  // Top terms (normalized by cluster size)
  cluster.centroidTerms = Array.from(termWeights.entries())
    .map(([term, weight]) => ({ term, weight: weight / cluster.patents.length }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 15);

  // Dominant CPCs
  cluster.dominantCPCs = Array.from(cpcCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([cpc]) => cpc);

  cluster.totalCompetitorCitations = totalCompetitorCites;
  cluster.uniqueCompetitors = Array.from(competitors);

  // Generate cluster name from top terms
  const topTerms = cluster.centroidTerms.slice(0, 3).map(t => t.term);
  cluster.name = generateClusterName(topTerms, cluster.dominantCPCs);
}

/**
 * Generate a readable cluster name
 */
function generateClusterName(topTerms: string[], cpcs: string[]): string {
  const cpcNames: Record<string, string> = {
    'H04L': 'Network/Communication',
    'H04N': 'Video/Image',
    'G06F': 'Computing/Data',
    'G06Q': 'Business Systems',
    'H04W': 'Wireless',
    'G06N': 'AI/ML',
    'H04B': 'Transmission',
    'G11B': 'Storage',
    'H03M': 'Coding/Encoding',
    'G06K': 'Recognition',
  };

  let cpcHint = cpcs[0] ? (cpcNames[cpcs[0]] || cpcs[0]) : '';
  const termHint = topTerms.slice(0, 2).join('/');

  return `${cpcHint}: ${termHint}`.substring(0, 50);
}

/**
 * Generate strategy definitions for each cluster
 */
function generateStrategies(clusters: Cluster[]): ClusterStrategy[] {
  const timestamp = new Date().toISOString().split('T')[0];

  return clusters.map((cluster, idx) => ({
    id: `cluster-hybrid-${idx + 1}-${timestamp}`,
    name: `Hybrid Cluster ${idx + 1}: ${cluster.name}`,
    type: 'term-extraction',
    dateAdded: timestamp,
    parameters: {
      sourceStrategy: 'citation-overlap-broadcom-streaming',
      clusterMethod: 'agglomerative-term-affinity',
      patentCount: cluster.patents.length,
      patentIds: cluster.patents.map(p => p.patent_id),
      extractedTerms: cluster.centroidTerms.slice(0, 10).map(t => t.term),
      dominantCPCs: cluster.dominantCPCs,
      clusterStrength: cluster.intraClusterSimilarity,
      totalCompetitorCitations: cluster.totalCompetitorCitations,
    }
  }));
}

/**
 * Main execution
 */
async function main() {
  console.log('='.repeat(60));
  console.log('Hybrid Cluster Analysis');
  console.log('='.repeat(60));

  // Parse args
  const args = process.argv.slice(2);
  const maxPatents = args[0] ? parseInt(args[0]) : 75;
  const targetClusters = args[1] ? parseInt(args[1]) : 10;

  console.log(`Configuration: maxPatents=${maxPatents}, targetClusters=${targetClusters}`);

  // Ensure output directory exists
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // Step 1: Load source patents
  console.log('\n1. Loading source patents from Strategy 1 results...');
  const sourcePatents = loadSourcePatents(maxPatents);
  console.log(`   Loaded ${sourcePatents.length} actionable patents`);

  // Create lookup map
  const sourcePatentMap = new Map<string, SourcePatent>();
  for (const p of sourcePatents) {
    sourcePatentMap.set(p.patent_id, p);
  }

  // Step 2: Extract terms from ElasticSearch
  console.log('\n2. Extracting terms from ElasticSearch...');
  const termVectors: TermVector[] = [];

  for (let i = 0; i < sourcePatents.length; i++) {
    const patent = sourcePatents[i];
    if (i % 10 === 0) {
      console.log(`   Processing patent ${i + 1}/${sourcePatents.length}...`);
    }

    const { terms, cpc_codes } = await extractPatentTerms(patent.patent_id);
    termVectors.push({
      patent_id: patent.patent_id,
      title: patent.title,
      terms,
      cpc_codes
    });
  }

  console.log(`   Extracted terms for ${termVectors.length} patents`);

  // Step 3: Cluster patents
  console.log('\n3. Clustering patents by term affinity...');
  const clusters = agglomerativeClustering(termVectors, targetClusters);
  console.log(`   Created ${clusters.length} clusters`);

  // Step 4: Compute cluster profiles
  console.log('\n4. Computing cluster profiles...');
  for (const cluster of clusters) {
    computeClusterProfile(cluster, sourcePatentMap);
  }

  // Sort clusters by competitor citations (strength indicator)
  clusters.sort((a, b) => b.totalCompetitorCitations - a.totalCompetitorCitations);

  // Step 5: Display results
  console.log('\n' + '='.repeat(60));
  console.log('CLUSTER ANALYSIS RESULTS');
  console.log('='.repeat(60));

  for (let i = 0; i < clusters.length; i++) {
    const cluster = clusters[i];
    console.log(`\nCluster ${i + 1}: ${cluster.name}`);
    console.log(`  Patents: ${cluster.patents.length}`);
    console.log(`  Competitor Citations: ${cluster.totalCompetitorCitations}`);
    console.log(`  Competitors: ${cluster.uniqueCompetitors.join(', ') || 'none'}`);
    console.log(`  Top Terms: ${cluster.centroidTerms.slice(0, 8).map(t => t.term).join(', ')}`);
    console.log(`  CPCs: ${cluster.dominantCPCs.join(', ')}`);
    console.log(`  Similarity: ${cluster.intraClusterSimilarity.toFixed(3)}`);
  }

  // Step 6: Generate strategies
  console.log('\n5. Generating strategy definitions...');
  const strategies = generateStrategies(clusters);

  // Save results
  const timestamp = new Date().toISOString().split('T')[0];

  // Save cluster definitions
  const clusterFile = path.join(OUTPUT_DIR, `cluster-definitions-${timestamp}.json`);
  fs.writeFileSync(clusterFile, JSON.stringify({
    generated_at: new Date().toISOString(),
    source: 'tier-litigation',
    patentCount: sourcePatents.length,
    clusterCount: clusters.length,
    clusters: clusters.map(c => ({
      id: c.id,
      name: c.name,
      patentCount: c.patents.length,
      patentIds: c.patents.map(p => p.patent_id),
      centroidTerms: c.centroidTerms,
      dominantCPCs: c.dominantCPCs,
      intraClusterSimilarity: c.intraClusterSimilarity,
      totalCompetitorCitations: c.totalCompetitorCitations,
      uniqueCompetitors: c.uniqueCompetitors
    }))
  }, null, 2));
  console.log(`   Saved cluster definitions to: ${clusterFile}`);

  // Save strategies for competitors.json
  const strategyFile = path.join(OUTPUT_DIR, `cluster-strategies-${timestamp}.json`);
  fs.writeFileSync(strategyFile, JSON.stringify({
    generated_at: new Date().toISOString(),
    strategies: strategies
  }, null, 2));
  console.log(`   Saved strategies to: ${strategyFile}`);

  // Save ranked clusters for competitor discovery
  const rankedFile = path.join(OUTPUT_DIR, `cluster-ranked-for-discovery-${timestamp}.json`);
  fs.writeFileSync(rankedFile, JSON.stringify({
    generated_at: new Date().toISOString(),
    description: 'Clusters ranked by competitor citation count - run competitor discovery in this order',
    rankedClusters: clusters.map((c, i) => ({
      rank: i + 1,
      name: c.name,
      patentCount: c.patents.length,
      competitorCitations: c.totalCompetitorCitations,
      searchTerms: c.centroidTerms.slice(0, 10).map(t => t.term),
      cpcs: c.dominantCPCs
    }))
  }, null, 2));
  console.log(`   Saved ranked clusters to: ${rankedFile}`);

  console.log('\n' + '='.repeat(60));
  console.log('Analysis Complete');
  console.log('Next: Run competitor discovery on Cluster 1 (highest citations)');
  console.log(`  npx tsx scripts/cluster-competitor-discovery.ts 1`);
  console.log('='.repeat(60));
}

main().catch(console.error);
