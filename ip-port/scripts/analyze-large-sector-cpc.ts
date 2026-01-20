#!/usr/bin/env npx tsx
/**
 * Analyze Large Sector CPC Distribution
 *
 * Examines CPC codes within large sectors (>500 patents) to identify
 * potential sub-sector breakout opportunities.
 *
 * Usage: npx tsx scripts/analyze-large-sector-cpc.ts
 */

import * as fs from 'fs';

interface SectorAssignment {
  sector: string;
  sectorName: string;
  cpc_codes?: string[];
  source?: string;
}

// CPC code descriptions for common prefixes
const CPC_DESCRIPTIONS: Record<string, string> = {
  // H04L - Transmission of digital information
  'H04L63': 'Network security (authentication, firewalls, intrusion detection)',
  'H04L9': 'Cryptographic mechanisms/protocols',
  'H04L67': 'Network protocols (client-server, peer-to-peer)',
  'H04L65': 'Network services (streaming, conferencing)',
  'H04L69': 'Protocol layers (transport, network)',
  'H04L61': 'Network addressing (DHCP, DNS)',
  'H04L45': 'Packet routing (forwarding, path selection)',
  'H04L47': 'Traffic control (QoS, congestion)',
  'H04L49': 'Packet switching (switching elements)',
  'H04L41': 'Network management (configuration, monitoring)',
  'H04L43': 'Network monitoring (traffic analysis)',
  'H04L12': 'Data switching networks (LANs, buses)',
  'H04L1': 'Error detection/correction',
  'H04L5': 'Multiplexing (OFDM, time division)',
  'H04L7': 'Synchronization (clock recovery)',
  'H04L25': 'Baseband systems',
  'H04L27': 'Modulation systems',

  // G06F - Computing/Data processing
  'G06F9/45': 'Virtual machines (emulation, translation)',
  'G06F9/455': 'Hypervisors/VMMs',
  'G06F9/5': 'Resource management (scheduling, allocation)',
  'G06F9/44': 'Software development (compilers, interpreters)',
  'G06F9/46': 'Multiprogramming (threads, processes)',
  'G06F9/48': 'Program scheduling',
  'G06F9/50': 'Resource allocation',
  'G06F9/54': 'Inter-process communication',
  'G06F3/06': 'Storage interfaces (RAID, SAN)',
  'G06F11': 'Error detection/recovery (fault tolerance)',
  'G06F12': 'Memory management',
  'G06F13': 'Interconnection (buses, bridges)',
  'G06F15': 'Digital computing (multiprocessor)',
  'G06F16': 'Information retrieval (databases, search)',
  'G06F17': 'Data processing (mathematical)',
  'G06F18': 'Pattern recognition',
  'G06F21': 'Security (access control, authentication)',
  'G06F8': 'Software engineering',
  'G06F7': 'Arithmetic/logic operations',
  'G06F1': 'Details (power management, packaging)',
  'G06F3': 'I/O interfaces',

  // H04W - Wireless communications
  'H04W4': 'Services (location, messaging)',
  'H04W12': 'Security (access control)',
  'H04W24': 'Supervisory/monitoring (network management)',
  'H04W28': 'Network traffic management',
  'H04W36': 'Handoff/reselection',
  'H04W40': 'Routing',
  'H04W48': 'Access restriction (congestion)',
  'H04W52': 'Power management',
  'H04W56': 'Synchronization',
  'H04W64': 'Locating users',
  'H04W72': 'Resource management',
  'H04W74': 'Channel access (ALOHA)',
  'H04W76': 'Connection management',
  'H04W8': 'Network management (mobility)',
  'H04W80': 'Protocol stacks',
  'H04W84': 'Network topologies (mesh, ad-hoc)',
  'H04W88': 'Devices (base stations, terminals)',
  'H04W92': 'Interfaces (air interface)',

  // H04N - Video/Image
  'H04N19': 'Video coding (compression, MPEG)',
  'H04N21': 'Selective content distribution (streaming)',
  'H04N1': 'Scanning/facsimile',
  'H04N5': 'Details of television',
  'H04N7': 'Television systems',
  'H04N9': 'Color television',
  'H04N13': '3D television',
  'H04N23': 'Cameras',
  'H04N25': 'Image sensors',

  // G06T - Image processing
  'G06T1': 'General purpose image processing',
  'G06T3': 'Geometric image transformation',
  'G06T5': 'Image enhancement',
  'G06T7': 'Image analysis',
  'G06T9': 'Image coding',
  'G06T11': 'Image generation (rendering)',
  'G06T13': 'Animation',
  'G06T15': '3D image rendering',
  'G06T17': '3D modeling',
  'G06T19': 'Manipulating 3D models',

  // Semiconductor
  'H01L21': 'Manufacturing processes',
  'H01L23': 'Semiconductor packages',
  'H01L25': 'Assembly of multiple devices',
  'H01L27': 'Integrated circuit devices',
  'H01L29': 'Semiconductor devices',
  'H01L31': 'Photoelectric devices (solar cells)',
  'H01L33': 'LEDs',
};

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('        LARGE SECTOR CPC DISTRIBUTION ANALYSIS');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Load sector assignments
  const assignments: Record<string, SectorAssignment> = JSON.parse(
    fs.readFileSync('./output/patent-sector-assignments.json', 'utf-8')
  );

  const totalPatents = Object.keys(assignments).length;
  console.log(`Total patents: ${totalPatents.toLocaleString()}\n`);

  // Group patents by sector
  const sectorPatents = new Map<string, Array<{ patentId: string; cpcCodes: string[] }>>();

  for (const [patentId, data] of Object.entries(assignments)) {
    const sector = data.sector || 'general';
    if (!sectorPatents.has(sector)) {
      sectorPatents.set(sector, []);
    }
    sectorPatents.get(sector)!.push({
      patentId,
      cpcCodes: data.cpc_codes || [],
    });
  }

  // Sort by count
  const sortedSectors = Array.from(sectorPatents.entries())
    .sort((a, b) => b[1].length - a[1].length);

  // Analyze large sectors (>500)
  const largeSectors = sortedSectors.filter(([_, patents]) => patents.length > 500);

  console.log(`Found ${largeSectors.length} large sectors (>500 patents)\n`);

  for (const [sector, patents] of largeSectors) {
    console.log('═'.repeat(70));
    console.log(`SECTOR: ${sector.toUpperCase()} (${patents.length.toLocaleString()} patents)`);
    console.log('═'.repeat(70));

    // Count CPC prefixes at different granularities
    const cpcPrefixes4 = new Map<string, number>();
    const cpcPrefixes5 = new Map<string, number>();
    const cpcPrefixes6 = new Map<string, number>();

    for (const { cpcCodes } of patents) {
      const seen4 = new Set<string>();
      const seen5 = new Set<string>();
      const seen6 = new Set<string>();

      for (const cpc of cpcCodes) {
        // 4-char prefix (e.g., H04L, G06F)
        const p4 = cpc.substring(0, 4);
        if (!seen4.has(p4)) {
          cpcPrefixes4.set(p4, (cpcPrefixes4.get(p4) || 0) + 1);
          seen4.add(p4);
        }

        // 5-char prefix (e.g., H04L6, G06F9)
        const p5 = cpc.substring(0, 5);
        if (!seen5.has(p5)) {
          cpcPrefixes5.set(p5, (cpcPrefixes5.get(p5) || 0) + 1);
          seen5.add(p5);
        }

        // 6-char prefix (e.g., H04L63, G06F9/)
        const p6 = cpc.substring(0, 6);
        if (!seen6.has(p6)) {
          cpcPrefixes6.set(p6, (cpcPrefixes6.get(p6) || 0) + 1);
          seen6.add(p6);
        }
      }
    }

    // Show 4-char distribution
    console.log('\n4-CHAR CPC PREFIX DISTRIBUTION:');
    const sorted4 = Array.from(cpcPrefixes4.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);

    for (const [prefix, count] of sorted4) {
      const pct = ((count / patents.length) * 100).toFixed(1);
      console.log(`  ${prefix.padEnd(6)} ${count.toLocaleString().padStart(6)}  (${pct}%)`);
    }

    // Show 5-6 char distribution (more granular)
    console.log('\nDETAILED CPC BREAKDOWN (potential sub-sectors):');
    console.log('─'.repeat(70));

    // Combine 5 and 6 char prefixes for analysis
    const detailedPrefixes = new Map<string, number>();
    for (const [prefix, count] of cpcPrefixes6) {
      // Normalize to the more meaningful prefix
      const cleanPrefix = prefix.replace(/[/\\]$/, '');
      detailedPrefixes.set(cleanPrefix, (detailedPrefixes.get(cleanPrefix) || 0) + count);
    }

    const sortedDetailed = Array.from(detailedPrefixes.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20);

    for (const [prefix, count] of sortedDetailed) {
      const pct = ((count / patents.length) * 100).toFixed(1);
      const desc = CPC_DESCRIPTIONS[prefix] || CPC_DESCRIPTIONS[prefix.substring(0, 5)] || '';
      console.log(`  ${prefix.padEnd(8)} ${count.toLocaleString().padStart(6)}  (${pct.padStart(5)}%)  ${desc}`);
    }

    // Suggest sub-sectors based on distribution
    console.log('\n💡 SUB-SECTOR SUGGESTIONS:');
    console.log('─'.repeat(70));

    const suggestions = analyzeSectorBreakout(sector, sortedDetailed, patents.length);
    for (const suggestion of suggestions) {
      console.log(`  • ${suggestion}`);
    }

    console.log('\n');
  }

  // Summary recommendations
  console.log('═'.repeat(70));
  console.log('SUMMARY: RECOMMENDED SUB-SECTOR BREAKOUTS');
  console.log('═'.repeat(70));

  for (const [sector, patents] of largeSectors) {
    console.log(`\n${sector} (${patents.length.toLocaleString()}):`);
    const summary = getSectorSummary(sector);
    for (const line of summary) {
      console.log(`  ${line}`);
    }
  }

  console.log('\n' + '═'.repeat(70) + '\n');
}

function analyzeSectorBreakout(sector: string, cpcDist: Array<[string, number]>, total: number): string[] {
  const suggestions: string[] = [];
  const MIN_SUBSECTOR_SIZE = 100;
  const MIN_SUBSECTOR_PCT = 5;

  // Find potential breakouts (groups with >5% and >100 patents)
  const potentialBreakouts = cpcDist.filter(([_, count]) =>
    count >= MIN_SUBSECTOR_SIZE && (count / total) * 100 >= MIN_SUBSECTOR_PCT
  );

  switch (sector) {
    case 'network-security':
      if (potentialBreakouts.some(([p]) => p.startsWith('H04L63'))) {
        suggestions.push('H04L63 → "network-security-protocol" (authentication, firewalls, intrusion detection)');
      }
      if (potentialBreakouts.some(([p]) => p.startsWith('H04L9'))) {
        suggestions.push('H04L9 → "cryptography" (encryption, key exchange, digital signatures)');
      }
      if (potentialBreakouts.some(([p]) => p.startsWith('G06F21'))) {
        suggestions.push('G06F21 → "system-security" (access control, secure boot, DRM)');
      }
      if (potentialBreakouts.some(([p]) => p.startsWith('H04L67'))) {
        suggestions.push('H04L67 → "network-protocols" (client-server, middleware)');
      }
      break;

    case 'computing':
      if (potentialBreakouts.some(([p]) => p.startsWith('G06F16'))) {
        suggestions.push('G06F16 → "database-search" (databases, information retrieval)');
      }
      if (potentialBreakouts.some(([p]) => p.startsWith('G06F9'))) {
        suggestions.push('G06F9 → "systems-software" (OS, scheduling, resource management)');
      }
      if (potentialBreakouts.some(([p]) => p.startsWith('G06F11'))) {
        suggestions.push('G06F11 → "fault-tolerance" (error detection, recovery)');
      }
      if (potentialBreakouts.some(([p]) => p.startsWith('G06F8'))) {
        suggestions.push('G06F8 → "software-engineering" (compilers, development tools)');
      }
      break;

    case 'wireless':
      if (potentialBreakouts.some(([p]) => p.startsWith('H04W72'))) {
        suggestions.push('H04W72 → "wireless-resource-mgmt" (spectrum, channel allocation)');
      }
      if (potentialBreakouts.some(([p]) => p.startsWith('H04W4'))) {
        suggestions.push('H04W4 → "wireless-services" (location services, messaging)');
      }
      if (potentialBreakouts.some(([p]) => p.startsWith('H04W12'))) {
        suggestions.push('H04W12 → "wireless-security" (authentication, access control)');
      }
      if (potentialBreakouts.some(([p]) => p.startsWith('H04W76'))) {
        suggestions.push('H04W76 → "wireless-connection" (call setup, handoff)');
      }
      break;

    case 'video-image':
      if (potentialBreakouts.some(([p]) => p.startsWith('H04N19'))) {
        suggestions.push('H04N19 → "video-coding" (compression, MPEG, AVC)');
      }
      if (potentialBreakouts.some(([p]) => p.startsWith('H04N21'))) {
        suggestions.push('H04N21 → "video-streaming" (content distribution, DRM)');
      }
      if (potentialBreakouts.some(([p]) => p.startsWith('G06T'))) {
        suggestions.push('G06T → "image-processing" (enhancement, analysis, 3D)');
      }
      break;

    case 'virtualization':
      if (potentialBreakouts.some(([p]) => p.startsWith('G06F9/455'))) {
        suggestions.push('G06F9/455 → "hypervisor" (VMM, hardware virtualization)');
      }
      if (potentialBreakouts.some(([p]) => p.startsWith('G06F9/5'))) {
        suggestions.push('G06F9/5 → "resource-virtualization" (scheduling, allocation)');
      }
      break;

    case 'sdn-networking':
      if (potentialBreakouts.some(([p]) => p.startsWith('H04L45'))) {
        suggestions.push('H04L45 → "packet-routing" (path selection, forwarding)');
      }
      if (potentialBreakouts.some(([p]) => p.startsWith('H04L49'))) {
        suggestions.push('H04L49 → "packet-switching" (switch elements, buffers)');
      }
      break;

    case 'cloud-orchestration':
      if (potentialBreakouts.some(([p]) => p.startsWith('H04L41'))) {
        suggestions.push('H04L41 → "network-config" (provisioning, configuration)');
      }
      if (potentialBreakouts.some(([p]) => p.startsWith('H04L43'))) {
        suggestions.push('H04L43 → "network-monitoring" (traffic analysis, telemetry)');
      }
      break;
  }

  if (suggestions.length === 0) {
    suggestions.push('No clear sub-sector breakouts identified - may be cohesive enough');
  }

  return suggestions;
}

function getSectorSummary(sector: string): string[] {
  switch (sector) {
    case 'network-security':
      return [
        '→ RECOMMEND BREAKOUT into:',
        '  • network-auth: Authentication, access control (H04L63)',
        '  • cryptography: Encryption, key management (H04L9)',
        '  • threat-detection: IDS/IPS, malware detection',
      ];
    case 'computing':
      return [
        '→ RECOMMEND BREAKOUT into:',
        '  • database: Data storage, retrieval, SQL (G06F16)',
        '  • systems: OS, kernels, scheduling (G06F9)',
        '  • middleware: Application servers, messaging',
      ];
    case 'wireless':
      return [
        '→ CONSIDER BREAKOUT by technology:',
        '  • wireless-infra: Base stations, network (H04W88)',
        '  • wireless-protocol: PHY, MAC layers (H04W72-80)',
        '  • wireless-apps: Location, messaging (H04W4)',
      ];
    case 'video-image':
      return [
        '→ RECOMMEND BREAKOUT into:',
        '  • video-codec: Compression, encoding (H04N19)',
        '  • video-streaming: Distribution, DRM (H04N21)',
        '  • image-analysis: Computer vision (G06T)',
      ];
    case 'virtualization':
      return [
        '→ MAY BE COHESIVE - core VMware technology',
        '  Consider keeping unified unless term-based analysis shows clear splits',
      ];
    case 'sdn-networking':
      return [
        '→ MAY BE COHESIVE - SDN/NFV technology area',
        '  Consider keeping unified - strong product overlap',
      ];
    case 'cloud-orchestration':
      return [
        '→ MAY BE COHESIVE - management/orchestration',
        '  Consider keeping unified - vRealize product family',
      ];
    default:
      return ['→ Analyze CPC distribution for breakout opportunities'];
  }
}

main().catch(console.error);
