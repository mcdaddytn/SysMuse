/**
 * Broadcom Patent Portfolio Builder
 * 
 * Builds a comprehensive patent portfolio for Broadcom Inc. including
 * all acquired entities (Avago, LSI, Brocade, CA, Symantec, VMware)
 * 
 * Usage:
 *   npx ts-node --esm examples/broadcom-portfolio-builder.ts
 */

import { createPatentsViewClient, Patent } from '../clients/patentsview-client.js';
import { createFileWrapperClient } from '../clients/odp-file-wrapper-client.js';
import { createPTABClient } from '../clients/odp-ptab-client.js';
import * as fs from 'fs/promises';
import * as dotenv from 'dotenv';

dotenv.config();

// Load configuration
const assigneeConfig = JSON.parse(
  await fs.readFile('./config/broadcom-assignees.json', 'utf-8')
);

interface PortfolioResults {
  metadata: {
    generatedDate: string;
    totalPatents: number;
    dateRange: { earliest: string; latest: string };
    configUsed: string;
  };
  patents: Patent[];
  byEntity: EntityBreakdown[];
  byTechnology: TechnologyBreakdown[];
  recentActivity: RecentActivity;
}

interface EntityBreakdown {
  entity: string;
  patentCount: number;
  percentage: number;
  samplePatents: string[];
}

interface TechnologyBreakdown {
  cpcSection: string;
  description: string;
  patentCount: number;
  percentage: number;
}

interface RecentActivity {
  last12Months: number;
  last24Months: number;
  trendingAreas: string[];
}

/**
 * Step 1: Build complete patent list using PatentsView
 */
async function buildPatentList(): Promise<Patent[]> {
  console.log('=== Phase 1: Patent Discovery ===\n');
  
  const client = createPatentsViewClient();
  
  // Extract all assignee name variants
  const allVariants = assigneeConfig.assignees
    .flatMap((entity: any) => entity.variants);
  
  console.log(`Searching for patents across ${assigneeConfig.assignees.length} entities`);
  console.log(`Total name variants: ${allVariants.length}\n`);
  
  // Build comprehensive OR query
  const query = {
    _or: allVariants.map((variant: string) => ({
      'assignees.assignee_organization': variant
    }))
  };
  
  const allPatents: Patent[] = [];
  let pageCount = 0;
  
  console.log('Fetching patents (this may take several minutes)...');
  
  for await (const page of client.searchPaginated(
    {
      query,
      fields: [
        'patent_id',
        'patent_title',
        'patent_date',
        'patent_abstract',
        'patent_type',
        'assignees',
        'inventors',
        'cpc_current',
        'patent_num_us_patents_cited',
        'patent_num_times_cited_by_us_patents',
      ],
      sort: [{ patent_date: 'desc' }],
    },
    1000
  )) {
    pageCount++;
    allPatents.push(...page);
    
    if (pageCount % 10 === 0) {
      console.log(`  Retrieved ${allPatents.length.toLocaleString()} patents (${pageCount} pages)...`);
    }
  }
  
  console.log(`\n✓ Total patents found: ${allPatents.length.toLocaleString()}\n`);
  
  return allPatents;
}

/**
 * Step 2: Analyze and categorize the portfolio
 */
function analyzePortfolio(patents: Patent[]): PortfolioResults {
  console.log('=== Phase 2: Portfolio Analysis ===\n');
  
  // Group by entity
  const byEntity = new Map<string, number>();
  const entityPatents = new Map<string, string[]>();
  
  patents.forEach(patent => {
    const assignee = patent.assignees?.[0]?.assignee_organization || 'Unknown';
    const parentEntity = findParentEntity(assignee);
    
    byEntity.set(parentEntity, (byEntity.get(parentEntity) || 0) + 1);
    
    if (!entityPatents.has(parentEntity)) {
      entityPatents.set(parentEntity, []);
    }
    entityPatents.get(parentEntity)!.push(patent.patent_id!);
  });
  
  // Group by technology (CPC section)
  const byTech = new Map<string, number>();
  
  patents.forEach(patent => {
    const cpcSection = (patent as any).cpc_current?.[0]?.cpc_section_id;
    if (cpcSection) {
      byTech.set(cpcSection, (byTech.get(cpcSection) || 0) + 1);
    }
  });
  
  // Recent activity analysis
  const now = new Date();
  const twelveMonthsAgo = new Date(now);
  twelveMonthsAgo.setMonth(now.getMonth() - 12);
  const twentyFourMonthsAgo = new Date(now);
  twentyFourMonthsAgo.setMonth(now.getMonth() - 24);
  
  const last12Months = patents.filter(p => 
    new Date(p.patent_date!) >= twelveMonthsAgo
  ).length;
  
  const last24Months = patents.filter(p =>
    new Date(p.patent_date!) >= twentyFourMonthsAgo
  ).length;
  
  // Find trending technology areas (high recent activity)
  const recentPatents = patents.filter(p =>
    new Date(p.patent_date!) >= twentyFourMonthsAgo
  );
  
  const recentTechCounts = new Map<string, number>();
  recentPatents.forEach(p => {
    const section = (p as any).cpc_current?.[0]?.cpc_section_id;
    if (section) {
      recentTechCounts.set(section, (recentTechCounts.get(section) || 0) + 1);
    }
  });
  
  const trendingAreas = Array.from(recentTechCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([section]) => getCPCDescription(section));
  
  // Build entity breakdown
  const entityBreakdown: EntityBreakdown[] = Array.from(byEntity.entries())
    .map(([entity, count]) => ({
      entity,
      patentCount: count,
      percentage: (count / patents.length) * 100,
      samplePatents: (entityPatents.get(entity) || []).slice(0, 5),
    }))
    .sort((a, b) => b.patentCount - a.patentCount);
  
  // Build technology breakdown
  const technologyBreakdown: TechnologyBreakdown[] = Array.from(byTech.entries())
    .map(([cpcSection, count]) => ({
      cpcSection,
      description: getCPCDescription(cpcSection),
      patentCount: count,
      percentage: (count / patents.length) * 100,
    }))
    .sort((a, b) => b.patentCount - a.patentCount)
    .slice(0, 10); // Top 10
  
  const results: PortfolioResults = {
    metadata: {
      generatedDate: new Date().toISOString(),
      totalPatents: patents.length,
      dateRange: {
        earliest: patents[patents.length - 1]?.patent_date || '',
        latest: patents[0]?.patent_date || '',
      },
      configUsed: assigneeConfig.portfolio,
    },
    patents,
    byEntity: entityBreakdown,
    byTechnology: technologyBreakdown,
    recentActivity: {
      last12Months,
      last24Months,
      trendingAreas,
    },
  };
  
  return results;
}

/**
 * Map assignee name to parent entity
 */
function findParentEntity(assigneeName: string): string {
  for (const entity of assigneeConfig.assignees) {
    for (const variant of entity.variants) {
      if (assigneeName.toLowerCase().includes(variant.toLowerCase())) {
        return entity.entity;
      }
    }
  }
  return 'Other';
}

/**
 * Get CPC section description
 */
function getCPCDescription(section: string): string {
  const descriptions: { [key: string]: string } = {
    'A': 'Human Necessities',
    'B': 'Performing Operations; Transporting',
    'C': 'Chemistry; Metallurgy',
    'D': 'Textiles; Paper',
    'E': 'Fixed Constructions',
    'F': 'Mechanical Engineering',
    'G': 'Physics',
    'H': 'Electricity',
    'G06': 'Computing; Calculating',
    'H04': 'Electric Communication',
    'H01': 'Basic Electric Elements',
    'G11': 'Information Storage',
    'H04L': 'Transmission of Digital Information',
    'G06F': 'Electric Digital Data Processing',
  };
  
  return descriptions[section] || section;
}

/**
 * Step 3: Check for IPR challenges on high-value patents
 */
async function checkIPRChallenges(patents: Patent[], limit: number = 100): Promise<any[]> {
  console.log('\n=== Phase 3: IPR Challenge Analysis ===\n');
  
  const ptabClient = createPTABClient();
  
  // Focus on recent high-value patents
  const twoYearsAgo = new Date();
  twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
  
  const candidatePatents = patents
    .filter(p => {
      const patentDate = new Date(p.patent_date!);
      return patentDate >= twoYearsAgo;
    })
    .slice(0, limit);
  
  console.log(`Checking ${candidatePatents.length} recent patents for IPR challenges...`);
  
  const challengedPatents = [];
  let checkedCount = 0;
  
  for (const patent of candidatePatents) {
    try {
      const iprs = await ptabClient.searchIPRsByPatent(patent.patent_id!);

      if (iprs.trials.length > 0) {
        challengedPatents.push({
          patent_id: patent.patent_id,
          patent_title: patent.patent_title,
          challenges: iprs.trials.length,
          trials: iprs.trials.map(t => ({
            trialNumber: t.trialNumber,
            status: t.trialStatusText,
            petitioner: t.petitionerPartyName,
            institution: t.institutionDecision,
          })),
        });
        
        console.log(`  ⚠ ${patent.patent_id} - ${iprs.trials.length} IPR(s)`);
      }
      
      checkedCount++;
      if (checkedCount % 10 === 0) {
        console.log(`  Checked ${checkedCount}/${candidatePatents.length} patents...`);
      }
      
      // Rate limit
      await new Promise(resolve => setTimeout(resolve, 500));
      
    } catch (error) {
      // Continue on error
    }
  }
  
  console.log(`\n✓ Found ${challengedPatents.length} patents with IPR challenges\n`);
  
  return challengedPatents;
}

/**
 * Generate text report
 */
function generateReport(results: PortfolioResults, challenges: any[]): string {
  let report = '';
  
  report += '═══════════════════════════════════════════════════════════════\n';
  report += '           BROADCOM PATENT PORTFOLIO ANALYSIS REPORT           \n';
  report += '═══════════════════════════════════════════════════════════════\n\n';
  
  report += `Generated: ${new Date(results.metadata.generatedDate).toLocaleString()}\n`;
  report += `Configuration: ${results.metadata.configUsed}\n\n`;
  
  report += '─────────────────────────────────────────────────────────────\n';
  report += '  PORTFOLIO SUMMARY\n';
  report += '─────────────────────────────────────────────────────────────\n\n';
  
  report += `Total Patents: ${results.metadata.totalPatents.toLocaleString()}\n`;
  report += `Date Range: ${results.metadata.dateRange.earliest} to ${results.metadata.dateRange.latest}\n\n`;
  
  report += '─────────────────────────────────────────────────────────────\n';
  report += '  BREAKDOWN BY ACQUISITION\n';
  report += '─────────────────────────────────────────────────────────────\n\n';
  
  results.byEntity.forEach(entity => {
    report += `${entity.entity.padEnd(35)} ${entity.patentCount.toLocaleString().padStart(8)} (${entity.percentage.toFixed(1)}%)\n`;
  });
  
  report += '\n─────────────────────────────────────────────────────────────\n';
  report += '  TOP TECHNOLOGY AREAS (CPC)\n';
  report += '─────────────────────────────────────────────────────────────\n\n';
  
  results.byTechnology.forEach(tech => {
    report += `${tech.cpcSection} - ${tech.description.padEnd(35)} ${tech.patentCount.toLocaleString().padStart(8)} (${tech.percentage.toFixed(1)}%)\n`;
  });
  
  report += '\n─────────────────────────────────────────────────────────────\n';
  report += '  RECENT ACTIVITY\n';
  report += '─────────────────────────────────────────────────────────────\n\n';
  
  report += `Last 12 Months: ${results.recentActivity.last12Months.toLocaleString()} patents\n`;
  report += `Last 24 Months: ${results.recentActivity.last24Months.toLocaleString()} patents\n\n`;
  
  report += 'Trending Technology Areas:\n';
  results.recentActivity.trendingAreas.forEach((area, i) => {
    report += `  ${i + 1}. ${area}\n`;
  });
  
  if (challenges.length > 0) {
    report += '\n─────────────────────────────────────────────────────────────\n';
    report += '  IPR CHALLENGES\n';
    report += '─────────────────────────────────────────────────────────────\n\n';
    
    report += `Patents with IPR Challenges: ${challenges.length}\n\n`;
    
    challenges.slice(0, 10).forEach(c => {
      report += `${c.patent_id} - ${c.challenges} IPR(s)\n`;
      report += `  ${c.patent_title?.substring(0, 70)}...\n`;
      c.trials.forEach((t: any) => {
        report += `    ${t.trialNumber}: ${t.status} (${t.petitioner})\n`;
      });
      report += '\n';
    });
  }
  
  report += '═══════════════════════════════════════════════════════════════\n';
  
  return report;
}

/**
 * Save results to JSON file
 */
async function saveResults(
  results: PortfolioResults,
  challenges: any[],
  outputDir: string = './output'
) {
  // Create output directory
  await fs.mkdir(outputDir, { recursive: true });
  
  const timestamp = new Date().toISOString().split('T')[0];
  
  // Save full results
  await fs.writeFile(
    `${outputDir}/broadcom-portfolio-${timestamp}.json`,
    JSON.stringify({ ...results, iprChallenges: challenges }, null, 2)
  );
  
  // Save patent list (CSV)
  const csvLines = ['Patent ID,Title,Date,Assignee,CPC Section'];
  results.patents.forEach(p => {
    const assignee = p.assignees?.[0]?.assignee_organization || '';
    const cpc = (p as any).cpc_current?.[0]?.cpc_section_id || '';
    csvLines.push(
      `"${p.patent_id}","${p.patent_title?.replace(/"/g, '""')}","${p.patent_date}","${assignee}","${cpc}"`
    );
  });
  
  await fs.writeFile(
    `${outputDir}/broadcom-patents-${timestamp}.csv`,
    csvLines.join('\n')
  );
  
  console.log(`\n✓ Results saved to ${outputDir}/`);
  console.log(`  - broadcom-portfolio-${timestamp}.json`);
  console.log(`  - broadcom-patents-${timestamp}.csv`);
}

/**
 * Main execution
 */
async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('        BROADCOM COMPLETE PATENT PORTFOLIO BUILDER              ');
  console.log('═══════════════════════════════════════════════════════════════\n');
  
  try {
    // Phase 1: Discover all patents
    const patents = await buildPatentList();
    
    // Phase 2: Analyze portfolio
    const results = analyzePortfolio(patents);
    
    // Phase 3: Check for IPR challenges (sample)
    const challenges = await checkIPRChallenges(patents, 50);
    
    // Generate report
    const report = generateReport(results, challenges);
    console.log('\n' + report);
    
    // Save results
    await saveResults(results, challenges);
    
    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('                    BUILD COMPLETE                              ');
    console.log('═══════════════════════════════════════════════════════════════\n');
    
  } catch (error) {
    console.error('\n✗ Error during portfolio build:', error);
    process.exit(1);
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export {
  buildPatentList,
  analyzePortfolio,
  checkIPRChallenges,
  generateReport,
  saveResults,
};
