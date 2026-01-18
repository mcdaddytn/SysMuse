/**
 * Sector-Specific LLM Analysis Service
 *
 * Uses Claude Opus for high-quality sector-specific patent analysis.
 * Includes product-focused questions and within-sector ranking signals.
 *
 * Features:
 * - Model selection: Opus (high quality) vs Sonnet (cost-effective)
 * - Sector-specific prompts with domain expertise
 * - Product identification for vendor handoff
 * - Within-sector competitive ranking
 */

import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { ChatAnthropic } from '@langchain/anthropic';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { z } from 'zod';

dotenv.config();

// Model options
export const MODELS = {
  opus: 'claude-opus-4-20250514',
  sonnet: 'claude-sonnet-4-20250514',
} as const;

export type ModelName = keyof typeof MODELS;

// Sector-specific analysis schema
const SectorAnalysisSchema = z.object({
  patent_id: z.string(),

  // Core assessment (inherited from V3)
  summary: z.string(),
  technical_solution: z.string(),

  // Legal viability
  eligibility_score: z.number().min(1).max(5),
  validity_score: z.number().min(1).max(5),
  claim_breadth: z.number().min(1).max(5),

  // Enforcement
  enforcement_clarity: z.number().min(1).max(5),
  design_around_difficulty: z.number().min(1).max(5),

  // SECTOR-SPECIFIC: Product focus
  specific_products: z.array(z.object({
    product_name: z.string(),
    company: z.string(),
    relevance: z.string(),
    evidence_type: z.string(),
  })),

  product_evidence_sources: z.array(z.string()),

  // SECTOR-SPECIFIC: Market intelligence
  revenue_model: z.string(),
  unit_volume_tier: z.string(),
  price_point_tier: z.string(),
  revenue_per_unit_estimate: z.string(),

  // SECTOR-SPECIFIC: Licensing context
  licensing_leverage_factors: z.array(z.string()),
  negotiation_strengths: z.array(z.string()),
  potential_objections: z.array(z.string()),

  // SECTOR-SPECIFIC: Within-sector ranking
  within_sector_rank_rationale: z.string(),
  litigation_grouping_candidates: z.array(z.string()),

  // Standards (sector-relevant)
  standards_relevance: z.string(),
  standards_bodies: z.array(z.string()),

  // Meta
  confidence: z.number().min(1).max(5),
});

export type SectorAnalysis = z.infer<typeof SectorAnalysisSchema>;

interface SectorPromptConfig {
  sector_id: string;
  display_name: string;
  system_prompt_additions: string;
  key_products: string[];
  key_companies: string[];
  standards_focus: string[];
  technical_focus: string[];
}

// Sector-specific prompt configurations
const SECTOR_PROMPTS: Record<string, SectorPromptConfig> = {
  'video-codec': {
    sector_id: 'video-codec',
    display_name: 'Video Codec / Transcoding',
    system_prompt_additions: `
You are an expert in video codec technology, including:
- Video compression standards: H.264/AVC, H.265/HEVC, AV1, VP9, VVC
- Transcoding architectures: hardware encoders, software codecs, cloud transcoding
- Streaming technologies: ABR streaming, DASH, HLS, low-latency streaming
- Industry players: broadcasters, streaming platforms, video conferencing, chip vendors

Key licensing context:
- HEVC patent pool licensing is complex (MPEG LA, HEVC Advance, Velos Media)
- AV1 is royalty-free but patent encumbrance risks exist
- 61% of mid-size platforms cite licensing fees as barrier
- Hardware implementation patents are particularly valuable

Focus on identifying specific products like:
- Cloud transcoding services (AWS Elemental, Azure Media Services)
- Hardware encoders (AMD, NETINT, NVIDIA)
- Video platforms (Netflix, YouTube, TikTok, Zoom)
- Consumer devices (smart TVs, streaming devices, cameras)`,
    key_products: ['streaming platforms', 'video conferencing', 'broadcast encoders', 'smart TVs', 'transcoding services'],
    key_companies: ['ByteDance', 'Netflix', 'Apple', 'Google', 'Bitmovin', 'AWS', 'NVIDIA', 'AMD'],
    standards_focus: ['H.264', 'H.265', 'HEVC', 'AV1', 'VP9', 'VVC', 'DASH', 'HLS'],
    technical_focus: ['macroblock', 'motion estimation', 'entropy coding', 'intra prediction', 'rate control']
  },

  'cloud-auth': {
    sector_id: 'cloud-auth',
    display_name: 'Cloud / Authentication',
    system_prompt_additions: `
You are an expert in cloud authentication and identity management:
- Identity protocols: OAuth 2.0, OpenID Connect, SAML, FIDO2
- Authentication methods: SSO, MFA, passwordless, biometrics
- Zero-trust architecture: ZTNA, identity-aware proxies
- Enterprise IAM: privileged access, federation, directory services

Key licensing context:
- High-growth market ($15B+, 14% CAGR)
- Enterprise customers have high willingness to pay for security
- Integration complexity makes design-around difficult
- Financial services sector is particularly security-conscious

Focus on identifying specific products like:
- Identity platforms (Okta, Auth0, Microsoft Entra)
- SSO solutions (Ping Identity, OneLogin)
- Enterprise security (CyberArk, BeyondTrust)
- Cloud IAM (AWS IAM, Azure AD, GCP IAM)`,
    key_products: ['identity platforms', 'SSO solutions', 'MFA providers', 'zero-trust', 'PAM'],
    key_companies: ['Okta', 'Microsoft', 'Auth0', 'Ping Identity', 'CyberArk', 'AWS', 'Google'],
    standards_focus: ['OAuth', 'OpenID Connect', 'SAML', 'FIDO2', 'WebAuthn'],
    technical_focus: ['token', 'authentication', 'authorization', 'identity', 'federation']
  },

  'rf-acoustic': {
    sector_id: 'rf-acoustic',
    display_name: 'RF Acoustic (BAW/FBAR)',
    system_prompt_additions: `
You are an expert in RF acoustic wave technology:
- BAW (Bulk Acoustic Wave) and FBAR (Film Bulk Acoustic Resonator) technology
- RF filters for mobile devices: duplexers, multiplexers, filters
- MEMS microphones and acoustic sensors
- 5G infrastructure RF front-end modules

Key licensing context:
- Physics-constrained technology with limited design-around options
- Every 4G/5G smartphone uses BAW filters - massive volume
- Concentrated supplier market (Broadcom/Avago, Qorvo, Skyworks, Murata)
- $10B+ annual market with strong growth from 5G

Focus on identifying specific products like:
- Smartphone RF modules (Apple iPhone, Samsung Galaxy)
- RF filter modules from Murata, Skyworks, Qorvo
- 5G infrastructure equipment (Ericsson, Nokia, Samsung)
- IoT modules with RF front-ends`,
    key_products: ['5G smartphones', 'RF filters', 'MEMS microphones', 'IoT modules', 'base stations'],
    key_companies: ['Murata', 'Skyworks', 'Qorvo', 'Qualcomm', 'Apple', 'Samsung'],
    standards_focus: ['3GPP', '5G NR', 'LTE', 'WiFi', 'Bluetooth'],
    technical_focus: ['BAW', 'FBAR', 'piezoelectric', 'resonator', 'duplexer', 'filter']
  },

  'network-threat-protection': {
    sector_id: 'network-threat-protection',
    display_name: 'Network Threat Protection',
    system_prompt_additions: `
You are an expert in cybersecurity and threat protection:
- Network security: firewalls, IDS/IPS, network segmentation
- Endpoint detection: EDR, XDR, antivirus
- Threat intelligence: SIEM, SOAR, threat feeds
- Cloud security: CASB, CWPP, CSPM

Key licensing context:
- High-growth market driven by increasing cyber threats
- Enterprise security budgets are recession-resistant
- Compliance requirements (SOC2, PCI-DSS) drive adoption
- Patent portfolios can be defensive assets for security vendors

Focus on identifying specific products like:
- Enterprise firewalls (Palo Alto, Fortinet, Cisco)
- EDR/XDR platforms (CrowdStrike, SentinelOne, Microsoft Defender)
- SIEM solutions (Splunk, IBM QRadar, Microsoft Sentinel)
- Cloud security (Zscaler, Netskope, Wiz)`,
    key_products: ['firewalls', 'EDR/XDR', 'SIEM', 'cloud security', 'threat intelligence'],
    key_companies: ['Palo Alto Networks', 'CrowdStrike', 'Fortinet', 'Cisco', 'Microsoft', 'Splunk'],
    standards_focus: ['MITRE ATT&CK', 'NIST', 'SOC2', 'ISO 27001'],
    technical_focus: ['threat detection', 'malware', 'intrusion', 'firewall', 'endpoint']
  },

  'network-switching': {
    sector_id: 'network-switching',
    display_name: 'Network Switching & Routing',
    system_prompt_additions: `
You are an expert in enterprise networking and data center infrastructure:
- Network switching: L2/L3 switches, data center fabrics, spine-leaf architectures
- Routing protocols: BGP, OSPF, MPLS, SD-WAN
- Network virtualization: VxLAN, EVPN, SDN
- Industry players: enterprise IT, cloud providers, service providers, hyperscalers

Key licensing context:
- Large enterprise market ($40B+) with high ASPs
- Mission-critical infrastructure with long replacement cycles
- Standards-based (IEEE, IETF) but proprietary enhancements matter
- Data center growth driven by cloud and AI workloads

Focus on identifying specific products like:
- Enterprise switches (Cisco Catalyst, Nexus, Arista 7000 series)
- Data center fabrics (Cisco ACI, Arista CloudVision, Juniper Apstra)
- SD-WAN solutions (Cisco Viptela, VMware VeloCloud, Fortinet)
- Cloud networking (AWS VPC, Azure Virtual Network, GCP)`,
    key_products: ['enterprise switches', 'data center routers', 'SD-WAN', 'network fabric', 'SDN controllers'],
    key_companies: ['Cisco', 'Arista', 'Juniper', 'HPE', 'Dell EMC', 'Huawei'],
    standards_focus: ['IEEE 802.1', 'BGP', 'OSPF', 'VxLAN', 'EVPN'],
    technical_focus: ['switching', 'routing', 'fabric', 'SDN', 'virtualization', 'QoS']
  },

  'network-management': {
    sector_id: 'network-management',
    display_name: 'Network Management & Orchestration',
    system_prompt_additions: `
You are an expert in network management and operations:
- Network monitoring: SNMP, NetFlow, telemetry, observability
- Configuration management: automation, orchestration, intent-based
- Service assurance: SLA monitoring, performance management
- Operations: NOC tools, troubleshooting, capacity planning

Key licensing context:
- Growing market with shift to automation and AIOps
- Enterprise IT operations budgets expanding
- Integration with cloud management increasingly important
- MSP and service provider segments have different needs

Focus on identifying specific products like:
- Network management (Cisco DNA Center, SolarWinds, Datadog)
- Observability platforms (Splunk, Dynatrace, New Relic)
- Automation tools (Ansible, Terraform, Puppet)
- Cloud management (ServiceNow, BMC)`,
    key_products: ['network monitoring', 'orchestration', 'automation', 'observability', 'ITSM'],
    key_companies: ['Cisco', 'SolarWinds', 'Datadog', 'Splunk', 'ServiceNow', 'Juniper'],
    standards_focus: ['SNMP', 'YANG', 'NETCONF', 'OpenConfig'],
    technical_focus: ['monitoring', 'telemetry', 'automation', 'orchestration', 'analytics']
  }
};

// Build sector-specific user prompt
function buildSectorUserPrompt(patent: any, config: SectorPromptConfig): string {
  return `Analyze this patent with a focus on the ${config.display_name} sector:

PATENT:
- ID: ${patent.patent_id}
- Title: ${patent.title}
- Abstract: ${patent.abstract || 'Not available'}
- CPC Codes: ${patent.cpc_codes?.join(', ') || 'Not available'}
- Grant Date: ${patent.grant_date || 'Unknown'}

SECTOR CONTEXT:
- Sector: ${config.display_name}
- Key Products: ${config.key_products.join(', ')}
- Key Companies: ${config.key_companies.join(', ')}
- Relevant Standards: ${config.standards_focus.join(', ')}
- Technical Focus Areas: ${config.technical_focus.join(', ')}

Provide a comprehensive analysis in JSON format:

{
  "patent_id": "${patent.patent_id}",
  "summary": "2-3 sentence summary for licensing discussions",
  "technical_solution": "Technical explanation of how it works",

  "eligibility_score": 1-5,
  "validity_score": 1-5,
  "claim_breadth": 1-5,
  "enforcement_clarity": 1-5,
  "design_around_difficulty": 1-5,

  "specific_products": [
    {
      "product_name": "Specific named product (e.g., 'Apple iPhone 15 Pro')",
      "company": "Company name",
      "relevance": "Why this product likely implements the patent",
      "evidence_type": "public_documentation|product_features|technical_specs|teardown_reports"
    }
  ],

  "product_evidence_sources": [
    "Where to find evidence: datasheets, teardown reports, FCC filings, etc."
  ],

  "revenue_model": "subscription|hardware_sale|licensing|freemium|enterprise",
  "unit_volume_tier": "<1M|1M-10M|10M-100M|100M-1B|>1B",
  "price_point_tier": "<$10|$10-100|$100-1000|$1000-10000|>$10000",
  "revenue_per_unit_estimate": "Estimate of patent-relevant component value",

  "licensing_leverage_factors": [
    "Factors that strengthen licensing position"
  ],
  "negotiation_strengths": [
    "Strengths for negotiation"
  ],
  "potential_objections": [
    "Objections a licensee might raise"
  ],

  "within_sector_rank_rationale": "Why this patent ranks high/low within the sector",
  "litigation_grouping_candidates": [
    "Other patent IDs that could be litigated together"
  ],

  "standards_relevance": "none|related|likely_essential|declared_essential",
  "standards_bodies": ["Relevant standards bodies"],

  "confidence": 1-5
}

List 5-10 SPECIFIC products with real product names. Focus on the ${config.display_name} sector.`;
}

export interface AnalysisOptions {
  model?: ModelName;
  batchSize?: number;
  rateLimitMs?: number;
}

export class SectorLLMAnalyzer {
  private model: ChatAnthropic;
  private sectorConfig: SectorPromptConfig;
  private outputDir: string;

  constructor(
    sector: string,
    options: AnalysisOptions = {}
  ) {
    const modelName = options.model || 'sonnet';
    const modelId = MODELS[modelName];

    if (!SECTOR_PROMPTS[sector]) {
      throw new Error(`Sector "${sector}" not configured. Available: ${Object.keys(SECTOR_PROMPTS).join(', ')}`);
    }

    this.sectorConfig = SECTOR_PROMPTS[sector];
    this.outputDir = `./output/sector-analysis/${sector}`;

    this.model = new ChatAnthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      model: modelId,
      temperature: 0.2,
      maxTokens: 6000,
    });

    console.log(`Initialized ${sector} analyzer with model: ${modelName} (${modelId})`);

    // Ensure output directory exists
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }
  }

  async analyzePatent(patent: any): Promise<SectorAnalysis | null> {
    const systemPrompt = `You are a patent analysis expert specializing in the ${this.sectorConfig.display_name} sector.

${this.sectorConfig.system_prompt_additions}

Your analysis should:
1. Identify SPECIFIC named products (not generic categories)
2. Provide actionable intelligence for licensing negotiations
3. Assess within-sector competitive position
4. Identify litigation grouping opportunities

Always return valid JSON matching the requested schema.`;

    const userPrompt = buildSectorUserPrompt(patent, this.sectorConfig);

    try {
      const response = await this.model.invoke([
        new SystemMessage(systemPrompt),
        new HumanMessage(userPrompt)
      ]);

      const content = response.content as string;
      const jsonMatch = content.match(/\{[\s\S]*\}/);

      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return SectorAnalysisSchema.parse(parsed);
      }

      console.error(`Failed to extract JSON for patent ${patent.patent_id}`);
      return null;
    } catch (error) {
      console.error(`Error analyzing patent ${patent.patent_id}:`, error);
      return null;
    }
  }

  async analyzeBatch(
    patents: any[],
    options: { saveProgress?: boolean; rateLimitMs?: number } = {}
  ): Promise<SectorAnalysis[]> {
    const results: SectorAnalysis[] = [];
    const rateLimitMs = options.rateLimitMs || 2000;

    for (let i = 0; i < patents.length; i++) {
      const patent = patents[i];
      console.log(`[${i + 1}/${patents.length}] Analyzing ${patent.patent_id}: ${patent.title?.substring(0, 50)}...`);

      const analysis = await this.analyzePatent(patent);

      if (analysis) {
        results.push(analysis);
        console.log(`   ✓ Found ${analysis.specific_products.length} products, confidence: ${analysis.confidence}`);

        // Save progress
        if (options.saveProgress) {
          const progressPath = path.join(this.outputDir, `progress-${new Date().toISOString().split('T')[0]}.json`);
          fs.writeFileSync(progressPath, JSON.stringify(results, null, 2));
        }
      } else {
        console.log(`   ✗ Analysis failed`);
      }

      // Rate limiting
      if (i < patents.length - 1) {
        await new Promise(resolve => setTimeout(resolve, rateLimitMs));
      }
    }

    return results;
  }

  saveResults(results: SectorAnalysis[], filename?: string): string {
    const timestamp = new Date().toISOString().split('T')[0];
    const outputPath = path.join(
      this.outputDir,
      filename || `${this.sectorConfig.sector_id}-analysis-${timestamp}.json`
    );

    const output = {
      sector: this.sectorConfig.sector_id,
      sector_name: this.sectorConfig.display_name,
      total_patents: results.length,
      analyses: results,
      generated_at: new Date().toISOString()
    };

    fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
    return outputPath;
  }
}

// Export available sectors
export function getAvailableSectors(): string[] {
  return Object.keys(SECTOR_PROMPTS);
}

export function getSectorConfig(sector: string): SectorPromptConfig | undefined {
  return SECTOR_PROMPTS[sector];
}
