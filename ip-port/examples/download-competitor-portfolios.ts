/**
 * Download Competitor Patent Portfolios
 *
 * Downloads patents from major streaming competitors for overlap analysis.
 * Designed for overnight batch runs.
 *
 * Usage:
 *   npx tsx examples/download-competitor-portfolios.ts [--competitor NAME]
 *
 * Run all overnight:
 *   nohup npx tsx examples/download-competitor-portfolios.ts > competitor-download.log 2>&1 &
 */

import { createPatentsViewClient, Patent } from '../clients/patentsview-client.js';
import * as fs from 'fs/promises';
import * as dotenv from 'dotenv';
dotenv.config();

const client = createPatentsViewClient();

interface CompetitorConfig {
  name: string;
  assigneeVariants: string[];
  focus: string; // Brief description
}

const COMPETITORS: CompetitorConfig[] = [
  {
    name: 'Netflix',
    assigneeVariants: [
      'Netflix, Inc.',
      'Netflix Inc.',
      'Netflix',
    ],
    focus: 'Streaming platform, video encoding, recommendation',
  },
  {
    name: 'Google-YouTube',
    assigneeVariants: [
      'Google LLC',
      'Google Inc.',
      'YouTube, LLC',
      'YouTube LLC',
    ],
    focus: 'Video streaming, codecs (VP9, AV1), infrastructure',
  },
  {
    name: 'Amazon',
    assigneeVariants: [
      'Amazon Technologies, Inc.',
      'Amazon.com, Inc.',
      'Amazon Technologies Inc.',
    ],
    focus: 'Prime Video, AWS streaming infrastructure',
  },
  {
    name: 'Apple',
    assigneeVariants: [
      'Apple Inc.',
    ],
    focus: 'Apple TV+, FairPlay DRM, HLS streaming',
  },
  {
    name: 'Disney',
    assigneeVariants: [
      'Disney Enterprises, Inc.',
      'The Walt Disney Company',
      'Disney Enterprises',
      'Hulu, LLC',
      'Hulu LLC',
    ],
    focus: 'Disney+, Hulu, ESPN+',
  },
  {
    name: 'Roku',
    assigneeVariants: [
      'Roku, Inc.',
      'Roku Inc.',
    ],
    focus: 'Streaming devices, platform',
  },
  {
    name: 'Comcast',
    assigneeVariants: [
      'Comcast Cable Communications, LLC',
      'Comcast Corporation',
      'Comcast Cable Communications LLC',
    ],
    focus: 'Peacock, Xfinity streaming',
  },
  {
    name: 'Microsoft',
    assigneeVariants: [
      'Microsoft Corporation',
      'Microsoft Technology Licensing, LLC',
    ],
    focus: 'Azure Media Services, Xbox streaming',
  },
  // === NEW COMPETITORS (from citation mining 2026-01-17) ===
  {
    name: 'IBM',
    assigneeVariants: [
      'International Business Machines Corporation',
      'IBM Corporation',
    ],
    focus: 'Enterprise computing, cloud, AI - 226 citations found',
  },
  {
    name: 'Cisco',
    assigneeVariants: [
      'Cisco Technology, Inc.',
      'Cisco Systems, Inc.',
    ],
    focus: 'Networking, security - 392 citations found (top citator)',
  },
  {
    name: 'Forcepoint',
    assigneeVariants: [
      'Forcepoint LLC',
      'Forcepoint Federal LLC',
    ],
    focus: 'Data security, user protection - 149 citations found',
  },
  {
    name: 'Palantir',
    assigneeVariants: [
      'Palantir Technologies Inc.',
      'Palantir Technologies, Inc.',
    ],
    focus: 'Data analytics - 104 citations found',
  },
  {
    name: 'Darktrace',
    assigneeVariants: [
      'Darktrace Holdings Limited',
      'Darktrace PLC',
      'Darktrace, Inc.',
    ],
    focus: 'AI cybersecurity - 81 citations found',
  },
  {
    name: 'Dropbox',
    assigneeVariants: [
      'Dropbox, Inc.',
    ],
    focus: 'Cloud storage - 59 citations found',
  },
  {
    name: 'McAfee',
    assigneeVariants: [
      'McAfee, LLC',
      'McAfee Corp.',
      'McAfee, Inc.',
    ],
    focus: 'Cybersecurity - 49 citations found',
  },
  {
    name: 'Sophos',
    assigneeVariants: [
      'Sophos Limited',
      'Sophos Group plc',
    ],
    focus: 'Endpoint security - 33 citations found',
  },
  {
    name: 'Samsung',
    assigneeVariants: [
      'SAMSUNG ELECTRONICS CO., LTD.',
      'Samsung Electronics Co., Ltd.',
      'Samsung Electronics America, Inc.',
    ],
    focus: 'Consumer electronics, semiconductors - 56 citations found',
  },
  {
    name: 'Citrix',
    assigneeVariants: [
      'Citrix Systems, Inc.',
      'Citrix Technology Solutions, Inc.',
    ],
    focus: 'Virtual desktop, enterprise - 19 citations found',
  },
  {
    name: 'Red Hat',
    assigneeVariants: [
      'Red Hat, Inc.',
    ],
    focus: 'Enterprise Linux, cloud - 16 citations found',
  },
  {
    name: 'FireEye',
    assigneeVariants: [
      'FireEye, Inc.',
      'Mandiant, Inc.',
      'Trellix Holdings, Inc.',
    ],
    focus: 'Threat intelligence - 15 citations found',
  },
  {
    name: 'Huawei',
    assigneeVariants: [
      'Huawei Technologies Co., Ltd.',
      'Huawei Device Co., Ltd.',
    ],
    focus: 'Telecom equipment, 5G - 11 citations found',
  },
];

// CPC codes relevant to streaming video
const STREAMING_CPC_CODES = [
  'H04N', // Video coding/transmission
  'H04L', // Digital information transmission
  'H04W', // Wireless communication
  'G06F', // Computing
  'G11B', // Information storage
  'G06T', // Image processing
];

interface DownloadProgress {
  competitor: string;
  startedAt: string;
  completedAt?: string;
  totalPatents: number;
  status: 'running' | 'completed' | 'error';
  error?: string;
}

async function downloadCompetitorPortfolio(competitor: CompetitorConfig): Promise<Patent[]> {
  console.log(`\n${'═'.repeat(65)}`);
  console.log(`  Downloading: ${competitor.name}`);
  console.log(`  Focus: ${competitor.focus}`);
  console.log(`  Variants: ${competitor.assigneeVariants.join(', ')}`);
  console.log('═'.repeat(65) + '\n');

  const allPatents: Patent[] = [];

  // Build OR query for all assignee variants
  const query = {
    _or: competitor.assigneeVariants.map(variant => ({
      'assignees.assignee_organization': variant
    }))
  };

  let pageCount = 0;

  try {
    for await (const page of client.searchPaginated(
      {
        query,
        fields: [
          'patent_id',
          'patent_title',
          'patent_date',
          'patent_abstract',
          'assignees',
          'cpc_current',
          'patent_num_times_cited_by_us_patents',
          'patent_num_us_patents_cited',
        ],
        sort: [{ patent_date: 'desc' }],
      },
      500
    )) {
      pageCount++;
      allPatents.push(...page);

      process.stdout.write(`\r  Progress: ${allPatents.length.toLocaleString()} patents (${pageCount} pages)...`);

      // Rate limiting delay
      await new Promise(r => setTimeout(r, 100));
    }

    console.log(`\n  ✓ Downloaded ${allPatents.length.toLocaleString()} patents for ${competitor.name}`);

  } catch (error: any) {
    console.log(`\n  ✗ Error downloading ${competitor.name}: ${error.message}`);
    throw error;
  }

  return allPatents;
}

async function filterStreamingPatents(patents: Patent[]): Promise<Patent[]> {
  // Filter to patents in streaming-related CPC codes
  return patents.filter(patent => {
    const cpc = (patent as any).cpc_current?.[0]?.cpc_group_id || '';
    return STREAMING_CPC_CODES.some(code => cpc.startsWith(code));
  });
}

async function saveCompetitorData(
  competitor: CompetitorConfig,
  allPatents: Patent[],
  streamingPatents: Patent[]
) {
  const outputDir = './output/competitors';
  await fs.mkdir(outputDir, { recursive: true });

  const timestamp = new Date().toISOString().split('T')[0];
  const safeName = competitor.name.toLowerCase().replace(/[^a-z0-9]/g, '-');

  // Save all patents
  const allFile = `${outputDir}/${safeName}-all-${timestamp}.json`;
  await fs.writeFile(allFile, JSON.stringify({
    metadata: {
      competitor: competitor.name,
      assigneeVariants: competitor.assigneeVariants,
      downloadedAt: new Date().toISOString(),
      totalPatents: allPatents.length,
      streamingPatents: streamingPatents.length,
    },
    patents: allPatents,
  }, null, 2));

  // Save streaming subset
  if (streamingPatents.length > 0) {
    const streamingFile = `${outputDir}/${safeName}-streaming-${timestamp}.json`;
    await fs.writeFile(streamingFile, JSON.stringify({
      metadata: {
        competitor: competitor.name,
        filteredBy: STREAMING_CPC_CODES,
        totalPatents: streamingPatents.length,
      },
      patents: streamingPatents,
    }, null, 2));
  }

  // Save citation summary (for quick overlap analysis later)
  const citedPatents = allPatents
    .filter(p => (p as any).patent_num_us_patents_cited > 0)
    .map(p => ({
      patent_id: p.patent_id,
      title: p.patent_title,
      date: p.patent_date,
      citations_made: (p as any).patent_num_us_patents_cited,
      times_cited: (p as any).patent_num_times_cited_by_us_patents,
    }));

  const summaryFile = `${outputDir}/${safeName}-summary-${timestamp}.json`;
  await fs.writeFile(summaryFile, JSON.stringify({
    competitor: competitor.name,
    totalPatents: allPatents.length,
    streamingPatents: streamingPatents.length,
    patentsWithCitations: citedPatents.length,
    topCited: citedPatents
      .sort((a, b) => (b.times_cited || 0) - (a.times_cited || 0))
      .slice(0, 50),
  }, null, 2));

  console.log(`  Saved to ${outputDir}/`);
  console.log(`    - ${safeName}-all-${timestamp}.json (${allPatents.length} patents)`);
  console.log(`    - ${safeName}-streaming-${timestamp}.json (${streamingPatents.length} streaming)`);
  console.log(`    - ${safeName}-summary-${timestamp}.json`);
}

async function downloadAll() {
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('     COMPETITOR PORTFOLIO DOWNLOAD');
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log(`\nStarted: ${new Date().toISOString()}`);
  console.log(`Competitors: ${COMPETITORS.map(c => c.name).join(', ')}\n`);

  const progressFile = './output/competitors/download-progress.json';
  const progress: DownloadProgress[] = [];

  for (const competitor of COMPETITORS) {
    const competitorProgress: DownloadProgress = {
      competitor: competitor.name,
      startedAt: new Date().toISOString(),
      totalPatents: 0,
      status: 'running',
    };
    progress.push(competitorProgress);

    try {
      const allPatents = await downloadCompetitorPortfolio(competitor);
      const streamingPatents = await filterStreamingPatents(allPatents);

      console.log(`  Streaming-related patents: ${streamingPatents.length.toLocaleString()} (${(streamingPatents.length/allPatents.length*100).toFixed(1)}%)`);

      await saveCompetitorData(competitor, allPatents, streamingPatents);

      competitorProgress.totalPatents = allPatents.length;
      competitorProgress.completedAt = new Date().toISOString();
      competitorProgress.status = 'completed';

    } catch (error: any) {
      competitorProgress.status = 'error';
      competitorProgress.error = error.message;
    }

    // Save progress after each competitor
    await fs.mkdir('./output/competitors', { recursive: true });
    await fs.writeFile(progressFile, JSON.stringify(progress, null, 2));
  }

  // Final summary
  console.log('\n' + '═'.repeat(65));
  console.log('DOWNLOAD SUMMARY');
  console.log('═'.repeat(65) + '\n');

  let totalPatents = 0;
  for (const p of progress) {
    const status = p.status === 'completed' ? '✓' : '✗';
    console.log(`${status} ${p.competitor}: ${p.totalPatents.toLocaleString()} patents`);
    totalPatents += p.totalPatents;
  }

  console.log(`\nTotal patents downloaded: ${totalPatents.toLocaleString()}`);
  console.log(`Completed: ${new Date().toISOString()}`);
}

async function downloadSingle(competitorName: string) {
  const competitor = COMPETITORS.find(
    c => c.name.toLowerCase() === competitorName.toLowerCase()
  );

  if (!competitor) {
    console.log(`Unknown competitor: ${competitorName}`);
    console.log(`Available: ${COMPETITORS.map(c => c.name).join(', ')}`);
    process.exit(1);
  }

  const allPatents = await downloadCompetitorPortfolio(competitor);
  const streamingPatents = await filterStreamingPatents(allPatents);
  await saveCompetitorData(competitor, allPatents, streamingPatents);
}

// Main
const args = process.argv.slice(2);
const competitorArg = args.indexOf('--competitor');

if (competitorArg !== -1 && args[competitorArg + 1]) {
  downloadSingle(args[competitorArg + 1]).catch(console.error);
} else {
  downloadAll().catch(console.error);
}
