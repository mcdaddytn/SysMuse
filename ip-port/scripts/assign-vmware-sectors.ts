/**
 * Assign Sectors to VMware Patents
 *
 * Assigns sectors based on CPC codes directly in the multi-score-analysis file.
 * Uses the new sector mappings for virtualization, SDN, cloud-orchestration, etc.
 */

import * as fs from 'fs/promises';
import * as fsSync from 'fs';

// CPC code prefix to sector mapping (same as assign-cpc-sectors.ts)
const CPC_SECTOR_MAP: Record<string, { sector: string; sectorName: string }> = {
  // VMware-specific sectors (more specific prefixes matched first)
  'G06F9/455': { sector: 'virtualization', sectorName: 'Virtualization/Containers' },
  'G06F9/45': { sector: 'virtualization', sectorName: 'Virtualization/Containers' },
  'G06F9/5': { sector: 'virtualization', sectorName: 'Virtualization/Containers' },
  'H04L45': { sector: 'sdn-networking', sectorName: 'SDN/Network Switching' },
  'H04L47': { sector: 'sdn-networking', sectorName: 'SDN/Network Switching' },
  'H04L49': { sector: 'sdn-networking', sectorName: 'SDN/Network Switching' },
  'H04L41': { sector: 'cloud-orchestration', sectorName: 'Cloud Orchestration/Management' },
  'H04L43': { sector: 'cloud-orchestration', sectorName: 'Cloud Orchestration/Management' },
  'G06F3/06': { sector: 'storage-virtualization', sectorName: 'Storage Virtualization' },
  'H04L63': { sector: 'network-security', sectorName: 'Network Security' },
  'H04L9': { sector: 'network-security', sectorName: 'Network Security' },

  // Broader fallbacks
  'H04N': { sector: 'video-image', sectorName: 'Video/Image Processing' },
  'G06T': { sector: 'video-image', sectorName: 'Video/Image Processing' },
  'G11B': { sector: 'video-image', sectorName: 'Video/Image Processing' },
  'H04L': { sector: 'network-security', sectorName: 'Network/Security' },
  'H04W': { sector: 'wireless', sectorName: 'Wireless Communications' },
  'H04B': { sector: 'wireless', sectorName: 'Wireless Communications' },
  'G06F': { sector: 'computing', sectorName: 'Computing/Data Processing' },
  'G06N': { sector: 'ai-ml', sectorName: 'AI/Machine Learning' },
  'G06Q': { sector: 'computing', sectorName: 'Computing/Data Processing' },
  'H01L': { sector: 'semiconductor', sectorName: 'Semiconductor/Hardware' },
  'H03': { sector: 'semiconductor', sectorName: 'Semiconductor/Hardware' },
  'G10L': { sector: 'audio', sectorName: 'Audio Processing' },
  'H04R': { sector: 'audio', sectorName: 'Audio Processing' },
  'H04S': { sector: 'audio', sectorName: 'Audio Processing' },
  'H03H': { sector: 'rf-acoustic', sectorName: 'RF/Acoustic Resonators' },
  'H04K': { sector: 'security-crypto', sectorName: 'Security/Cryptography' },
  'G02': { sector: 'optics', sectorName: 'Optics/Photonics' },
  'H04J': { sector: 'optics', sectorName: 'Optics/Photonics' },
};

// Sort prefixes by length (longest first) for matching
const CPC_PREFIXES = Object.keys(CPC_SECTOR_MAP).sort((a, b) => b.length - a.length);

function getSectorFromCPC(cpcCodes: string[]): { sector: string; sectorName: string } {
  if (!cpcCodes || cpcCodes.length === 0) {
    return { sector: 'general', sectorName: 'General' };
  }

  for (const cpc of cpcCodes) {
    // Normalize CPC code
    // Handle URL format: https://...cpc_group/H04L47:781/ -> H04L47/781
    // Handle direct format: H04L47/781 -> H04L47/781
    let normalizedCpc = cpc;
    if (cpc.includes('cpc_group/')) {
      // Extract from URL format
      const match = cpc.match(/cpc_group\/([^/]+)/);
      normalizedCpc = match ? match[1].replace(':', '/') : cpc;
    }
    // CPC codes like H04L47/781 are already in correct format

    for (const prefix of CPC_PREFIXES) {
      if (normalizedCpc.startsWith(prefix)) {
        return CPC_SECTOR_MAP[prefix];
      }
    }
  }

  return { sector: 'general', sectorName: 'General' };
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('        ASSIGN SECTORS TO VMWARE PATENTS');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Load multi-score-analysis
  const msaFile = './output/multi-score-analysis-LATEST.json';
  console.log(`Loading: ${msaFile}`);
  const msaData = JSON.parse(await fs.readFile(msaFile, 'utf-8'));

  // Load existing sector assignments
  const sectorFile = './output/patent-sector-assignments.json';
  let existingSectors: Record<string, any> = {};
  if (fsSync.existsSync(sectorFile)) {
    existingSectors = JSON.parse(await fs.readFile(sectorFile, 'utf-8'));
    console.log(`Loaded existing sector assignments: ${Object.keys(existingSectors).length}`);
  }

  // Load VMware patent metadata for CPC codes
  const vmwareFile = './output/vmware-patents-2026-01-19.json';
  console.log(`Loading VMware metadata: ${vmwareFile}`);
  const vmwareData = JSON.parse(await fs.readFile(vmwareFile, 'utf-8'));

  // Create CPC lookup from VMware patents
  const vmwareCpcMap = new Map<string, string[]>();
  for (const patent of vmwareData.patents) {
    const cpcCodes = (patent.cpc_current || []).map((c: any) => {
      // Use cpc_group_id directly if available (e.g., "H04L47/781")
      if (typeof c === 'object' && c.cpc_group_id) {
        return c.cpc_group_id;
      }
      // Fallback: Extract from URL format
      if (typeof c === 'object' && c.cpc_group) {
        const match = c.cpc_group.match(/cpc_group\/([^/]+)/);
        return match ? match[1].replace(':', '/') : '';
      }
      return c;
    }).filter(Boolean);

    if (cpcCodes.length > 0) {
      vmwareCpcMap.set(patent.patent_id, cpcCodes);
    }
  }
  console.log(`  VMware patents with CPC codes: ${vmwareCpcMap.size}`);

  // Debug: show sample CPC codes
  const samplePatent = vmwareCpcMap.keys().next().value;
  if (samplePatent) {
    console.log(`  Sample CPC codes for ${samplePatent}: ${vmwareCpcMap.get(samplePatent)?.slice(0, 3).join(', ')}`);
  }

  // Assign sectors
  const sectorCounts: Record<string, number> = {};
  let assigned = 0;
  let alreadyAssigned = 0;

  const patents = msaData.patents || msaData.results || [];
  for (const patent of patents) {
    const patentId = patent.patent_id;

    // Skip if already has a non-general sector
    if (existingSectors[patentId] && existingSectors[patentId].sector !== 'general') {
      alreadyAssigned++;
      const sector = existingSectors[patentId].sector;
      sectorCounts[sector] = (sectorCounts[sector] || 0) + 1;
      continue;
    }

    // Get CPC codes
    let cpcCodes = patent.cpc_codes || [];

    // If no CPC codes in multi-score, try VMware metadata
    if (cpcCodes.length === 0 && vmwareCpcMap.has(patentId)) {
      cpcCodes = vmwareCpcMap.get(patentId) || [];
    }

    // Assign sector
    const { sector, sectorName } = getSectorFromCPC(cpcCodes);

    existingSectors[patentId] = {
      sector,
      sectorName,
      cpc_codes: cpcCodes.slice(0, 5), // Keep first 5 CPCs
      source: 'cpc-auto',
    };

    sectorCounts[sector] = (sectorCounts[sector] || 0) + 1;
    assigned++;
  }

  // Save updated sector assignments
  await fs.writeFile(sectorFile, JSON.stringify(existingSectors, null, 2));
  console.log(`\nSaved: ${sectorFile}`);

  // Print summary
  console.log('\n' + '═'.repeat(60));
  console.log('SECTOR ASSIGNMENT SUMMARY');
  console.log('═'.repeat(60));
  console.log(`Total patents: ${patents.length}`);
  console.log(`Already assigned: ${alreadyAssigned}`);
  console.log(`Newly assigned: ${assigned}`);

  console.log('\nSector Distribution:');
  const sortedSectors = Object.entries(sectorCounts)
    .sort((a, b) => b[1] - a[1]);

  for (const [sector, count] of sortedSectors) {
    console.log(`  ${sector}: ${count}`);
  }

  // Highlight new VMware-related sectors
  console.log('\nNew VMware-Related Sectors:');
  const vmwareSectors = ['virtualization', 'sdn-networking', 'cloud-orchestration', 'storage-virtualization'];
  for (const sector of vmwareSectors) {
    console.log(`  ${sector}: ${sectorCounts[sector] || 0}`);
  }

  console.log('\n' + '═'.repeat(60) + '\n');
}

main().catch(console.error);
