/**
 * Seed POS Tournament V2 Templates
 *
 * 4-round tournament with:
 * - Rankings (ordinals) instead of ratings
 * - Dark horse preservation through rounds
 * - More finalists (~30 instead of ~5)
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface StructuredQuestion {
  fieldName: string;
  question: string;
  answerType: 'INTEGER' | 'TEXT' | 'ENUM' | 'TEXT_ARRAY';
  constraints?: {
    min?: number;
    max?: number;
    options?: string[];
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Round 1: Initial Screening - LAYERED TECH STACK APPROACH
//
// Instead of asking "Is this POS relevant?", we ask:
// "Does this patent live where POS devices must live?"
//
// 4 Layers of POS tech stack:
//   Layer 1: Device & Mobility (handheld/mobile computing)
//   Layer 2: Multi-Radio Connectivity (WiFi/cellular/BT coexistence)
//   Layer 3: Peripheral + Transaction Interaction (peripherals, payment)
//   Layer 4: Operational Stress/Reliability (adverse conditions)
// ─────────────────────────────────────────────────────────────────────────────

const round1Questions: StructuredQuestion[] = [
  // ═══ LAYER 1: Device & Mobility ═══
  {
    fieldName: 'mobility_score',
    question: 'LAYER 1 - DEVICE & MOBILITY: Rate 0-5. Does this patent involve mobile/handheld computing, portable devices, tablets, or battery-powered equipment? 0=not at all, 5=core focus.',
    answerType: 'INTEGER',
    constraints: { min: 0, max: 5 },
  },
  {
    fieldName: 'mobility_reasoning',
    question: 'Quote the patent title, then explain your mobility score. Format: "[title]" - [reasoning about device/mobility aspects or lack thereof].',
    answerType: 'TEXT',
  },

  // ═══ LAYER 2: Multi-Radio Connectivity/Coexistence ═══
  {
    fieldName: 'connectivity_score',
    question: 'LAYER 2 - MULTI-RADIO CONNECTIVITY: Rate 0-5. Does this patent involve WiFi/cellular/Bluetooth management, radio coexistence, or wireless switching? 0=not at all, 5=core focus.',
    answerType: 'INTEGER',
    constraints: { min: 0, max: 5 },
  },
  {
    fieldName: 'connectivity_reasoning',
    question: 'Quote the patent title, then explain your connectivity score. Format: "[title]" - [reasoning about multi-radio/coexistence aspects or lack thereof].',
    answerType: 'TEXT',
  },

  // ═══ LAYER 3: Peripheral + Transaction Interaction ═══
  {
    fieldName: 'peripheral_score',
    question: 'LAYER 3 - PERIPHERAL INTERACTION: Rate 0-5. Does this patent involve device-to-peripheral communication, payment terminals, card readers, printers, or transaction processing? 0=not at all, 5=core focus.',
    answerType: 'INTEGER',
    constraints: { min: 0, max: 5 },
  },
  {
    fieldName: 'peripheral_reasoning',
    question: 'Quote the patent title, then explain your peripheral score. Format: "[title]" - [reasoning about peripheral/transaction aspects or lack thereof].',
    answerType: 'TEXT',
  },

  // ═══ LAYER 4: Operational Stress / Reliability ═══
  {
    fieldName: 'reliability_score',
    question: 'LAYER 4 - OPERATIONAL RELIABILITY: Rate 0-5. Does this patent address operation under stress (interference, congestion, power constraints, failover)? 0=not at all, 5=core focus.',
    answerType: 'INTEGER',
    constraints: { min: 0, max: 5 },
  },
  {
    fieldName: 'reliability_reasoning',
    question: 'Quote the patent title, then explain your reliability score. Format: "[title]" - [reasoning about operational stress/reliability aspects or lack thereof].',
    answerType: 'TEXT',
  },

  // ═══ COMPOSITE SCORE ═══
  {
    fieldName: 'stack_composite_score',
    question: 'Sum of all 4 layer scores (mobility + connectivity + peripheral + reliability). Range 0-20.',
    answerType: 'INTEGER',
    constraints: { min: 0, max: 20 },
  },

  // ═══ CLUSTER RANKING ═══
  {
    fieldName: 'cluster_ranking',
    question: 'Rank ALL patents by stack_composite_score (highest to lowest). Patents with score 0 should be at the bottom. Return array of patent keys.',
    answerType: 'TEXT_ARRAY',
  },
  {
    fieldName: 'qualified_count',
    question: 'How many patents have stack_composite_score >= 4? (At least moderate relevance in one layer or spread across multiple). May be 0.',
    answerType: 'INTEGER',
    constraints: { min: 0, max: 20 },
  },

  // ═══ LATENT ADJACENT VALUE (replaces "dark horse" to avoid inviting hallucination) ═══
  {
    fieldName: 'latent_value_candidate',
    question: 'LATENT ADJACENT VALUE: Is there a patent NOT in top 5 that has value not captured by the 4 layers? This must reference ACTUAL patent technology. Return patent key or "NONE".',
    answerType: 'TEXT',
  },
  {
    fieldName: 'latent_value_reasoning',
    question: 'If latent_value_candidate != NONE: Quote its title and explain what adjacent technology value it has. If NONE: "No latent value candidates identified".',
    answerType: 'TEXT',
  },
  {
    fieldName: 'latent_value_score',
    question: 'Rate the strength of latent/adjacent value 0-5. 0 if no candidate or weak value.',
    answerType: 'INTEGER',
    constraints: { min: 0, max: 5 },
  },

  // ═══ PER-PATENT TECHNOLOGY SUMMARY ═══
  {
    fieldName: 'actual_technology',
    question: 'What technology does this patent ACTUALLY cover? Quote the title and summarize in 10 words or less.',
    answerType: 'TEXT',
  },
  {
    fieldName: 'strongest_layer',
    question: 'Which layer (1-4) is this patent strongest in? Or "none" if all scores are 0.',
    answerType: 'ENUM',
    constraints: { options: ['layer1_mobility', 'layer2_connectivity', 'layer3_peripheral', 'layer4_reliability', 'none'] },
  },
];

const round1Prompt = `You are evaluating patents using a LAYERED TECH STACK approach.

KEY INSIGHT: Instead of asking "Is this POS relevant?", ask:
"Does this patent live where POS devices must live?"

POS systems (Toast, Square, Clover in restaurants) operate on a specific tech stack.
Patents that address ANY layer of this stack have potential value, even if they
don't mention "POS" or "payment" directly.

PATENT IDENTIFICATION:
Each patent is identified by a numbered key: PATENT_1, PATENT_2, etc.
The valid keys for this cluster are: {{cluster.patentIdList}}

═══════════════════════════════════════════════════════════════════════════════
THE 4 LAYERS OF POS TECH STACK
═══════════════════════════════════════════════════════════════════════════════

LAYER 1 - DEVICE & MOBILITY (0-5 points):
  • Mobile/handheld computing devices
  • Tablets, portable terminals
  • Battery-powered equipment
  • Touch interfaces
  Example: POS terminals are handheld tablets carried by servers

LAYER 2 - MULTI-RADIO CONNECTIVITY (0-5 points):
  • WiFi/cellular/Bluetooth management
  • Radio coexistence (managing interference between radios)
  • Wireless switching and handoff
  • Antenna management
  Example: POS devices must maintain WiFi while using Bluetooth for peripherals

LAYER 3 - PERIPHERAL + TRANSACTION INTERACTION (0-5 points):
  • Device-to-peripheral communication
  • Card readers, payment terminals, printers
  • NFC/contactless protocols
  • Transaction processing
  Example: POS tablets connect to card readers and receipt printers

LAYER 4 - OPERATIONAL STRESS/RELIABILITY (0-5 points):
  • Operation under interference/congestion
  • Power management, low battery operation
  • Failover, reconnection
  • Throughput under adverse conditions
  Example: Restaurant WiFi is congested; POS must work reliably anyway

═══════════════════════════════════════════════════════════════════════════════

SCORING INSTRUCTIONS:
1. READ each patent's "title" and "summary" carefully
2. QUOTE the title in each reasoning field
3. Score EACH layer independently (0-5)
4. Be HONEST - most patents will score 0 in most layers
5. Sum all 4 layers for stack_composite_score (0-20)

WHAT SCORES POINTS:
- Layer 1: Patents about portable devices, tablets, handheld computing
- Layer 2: Patents about WiFi/cellular coexistence, multi-radio management
- Layer 3: Patents about peripheral communication, payment protocols
- Layer 4: Patents about reliability under stress, power management, failover

WHAT SCORES ZERO:
- Data center infrastructure (SERDES, high-speed server interconnects)
- Base station / cell tower technology (not end-user devices)
- Semiconductor manufacturing processes
- Pure backend/cloud technology

LATENT ADJACENT VALUE:
Instead of "dark horse" (which invites hallucination), identify patents with
"latent adjacent value" - technology that doesn't fit the 4 layers but has
genuine adjacent utility. This MUST reference the patent's ACTUAL technology.

═══════════════════════════════════════════════════════════════════════════════
CRITICAL: ANTI-HALLUCINATION REQUIREMENT
═══════════════════════════════════════════════════════════════════════════════

⚠️ YOU MUST USE THE EXACT "TITLE" FIELD FROM EACH PATENT'S JSON DATA ⚠️

DO NOT:
- Invent or fabricate patent titles
- Assume what a patent might be about based on sector
- Make up technology descriptions that sound POS-related

DO:
- Copy the EXACT "TITLE" string from each patent's JSON
- Score based ONLY on what the actual title describes
- Score 0 if the title shows technology unrelated to the 4 layers

Example: If TITLE says "SERDES architecture for data centers", this is
NOT about mobile devices - score ALL layers 0.

=== PATENT DATA (READ THE "TITLE" FIELD FOR EACH PATENT) ===
{{cluster.patentData}}

RESPONSE FORMAT:
- Use patent keys: {{cluster.patentIdList}}
- In mobility_reasoning, connectivity_reasoning etc., COPY THE EXACT TITLE first
- Rank by stack_composite_score (highest first)
- Patents with score 0 go at the BOTTOM
- If no patents qualify, set qualified_count = 0 and latent_value_candidate = "NONE"`;

// ─────────────────────────────────────────────────────────────────────────────
// Round 2: Intermediate Screening (similar structure, with carried context)
// ─────────────────────────────────────────────────────────────────────────────

const round2Questions: StructuredQuestion[] = [
  // ═══ VERIFICATION OF ROUND 1 LAYER SCORES ═══
  {
    fieldName: 'verification_flags',
    question: 'List any patents where Round 1 layer scores appear inflated vs actual title/summary. Format: ["PATENT_X: layer Y scored Z but title shows..."]. Return empty array [] if all scores are accurate.',
    answerType: 'TEXT_ARRAY',
  },

  // ═══ RE-SCORE ALL 4 LAYERS (verification) ═══
  {
    fieldName: 'verified_mobility_score',
    question: 'LAYER 1 - MOBILITY: Re-score 0-5 after reading actual title/summary. Be stricter than Round 1.',
    answerType: 'INTEGER',
    constraints: { min: 0, max: 5 },
  },
  {
    fieldName: 'verified_connectivity_score',
    question: 'LAYER 2 - CONNECTIVITY: Re-score 0-5 after reading actual title/summary. Be stricter than Round 1.',
    answerType: 'INTEGER',
    constraints: { min: 0, max: 5 },
  },
  {
    fieldName: 'verified_peripheral_score',
    question: 'LAYER 3 - PERIPHERAL: Re-score 0-5 after reading actual title/summary. Be stricter than Round 1.',
    answerType: 'INTEGER',
    constraints: { min: 0, max: 5 },
  },
  {
    fieldName: 'verified_reliability_score',
    question: 'LAYER 4 - RELIABILITY: Re-score 0-5 after reading actual title/summary. Be stricter than Round 1.',
    answerType: 'INTEGER',
    constraints: { min: 0, max: 5 },
  },
  {
    fieldName: 'verified_composite_score',
    question: 'Sum of verified layer scores (0-20). This becomes the authoritative composite score.',
    answerType: 'INTEGER',
    constraints: { min: 0, max: 20 },
  },

  // ═══ TECHNOLOGY VERIFICATION ═══
  {
    fieldName: 'actual_technology_verified',
    question: 'Quote the patent title and state what it ACTUALLY covers in 10 words.',
    answerType: 'TEXT',
  },
  {
    fieldName: 'primary_layer',
    question: 'Which layer (1-4) does this patent fit best? Or "none" if all verified scores are 0.',
    answerType: 'ENUM',
    constraints: { options: ['layer1_mobility', 'layer2_connectivity', 'layer3_peripheral', 'layer4_reliability', 'none'] },
  },

  // ═══ RANKINGS ═══
  {
    fieldName: 'cluster_ranking',
    question: 'Rank patents by verified_composite_score (highest first). Demote any with inflated Round 1 scores.',
    answerType: 'TEXT_ARRAY',
  },
  {
    fieldName: 'demoted_patents',
    question: 'List patents demoted due to inflated Round 1 layer scores. Return patent keys or empty array.',
    answerType: 'TEXT_ARRAY',
  },

  // ═══ LATENT ADJACENT VALUE (carried forward) ═══
  {
    fieldName: 'latent_value_candidate',
    question: 'From patents with verified_composite_score < 8: is there one with genuine adjacent value? Return key or "NONE".',
    answerType: 'TEXT',
  },
  {
    fieldName: 'latent_value_reasoning',
    question: 'Quote the latent candidate title and explain its adjacent technology value. Or "No latent value" if NONE.',
    answerType: 'TEXT',
  },

  // ═══ VALIDITY ASSESSMENT ═══
  {
    fieldName: 'validity_concerns',
    question: 'Any validity concerns (prior art, 101 issues)? State briefly or "None identified".',
    answerType: 'TEXT',
  },
];

const round2Prompt = `Round 2: VERIFICATION of layer scores from Round 1.

PATENT IDENTIFICATION:
Valid keys for this cluster: {{cluster.patentIdList}}

═══════════════════════════════════════════════════════════════════════════════
VERIFICATION TASK
═══════════════════════════════════════════════════════════════════════════════

Round 1 scored each patent on 4 layers of the POS tech stack:
  Layer 1: Device & Mobility (0-5)
  Layer 2: Multi-Radio Connectivity (0-5)
  Layer 3: Peripheral + Transaction (0-5)
  Layer 4: Operational Reliability (0-5)

Your job is to VERIFY these scores match the actual patent technology.

FOR EACH PATENT:
1. READ the actual "title" and "summary" fields
2. COMPARE Round 1 layer scores to actual technology
3. RE-SCORE all 4 layers (be stricter than Round 1)
4. FLAG any patents with inflated Round 1 scores

THE 4 LAYERS (for reference):
- Layer 1 MOBILITY: Handheld devices, tablets, portable terminals
- Layer 2 CONNECTIVITY: WiFi/cellular/BT management, radio coexistence
- Layer 3 PERIPHERAL: Card readers, payment terminals, printers, NFC
- Layer 4 RELIABILITY: Operation under stress, power management, failover

SCORING GUIDANCE:
- Only score points where the patent ACTUALLY addresses that layer
- A patent about server infrastructure scores 0 in all mobile-focused layers
- Be honest - many patents will score 0 across all layers
- Your verified_composite_score becomes the authoritative score

ROUND 1 CONTEXT (layer scores may be inflated - verify against actual data):
{{cluster.round1Results}}

═══════════════════════════════════════════════════════════════════════════════
CRITICAL: VERIFY USING ACTUAL TITLES
═══════════════════════════════════════════════════════════════════════════════

⚠️ COPY THE EXACT "TITLE" FIELD FROM EACH PATENT'S JSON ⚠️

If Round 1 quoted a different title than what appears in the JSON, that's hallucination.
Flag it in verification_flags and set all layer scores to 0.

=== ACTUAL PATENT DATA (GROUND TRUTH) ===
{{cluster.patentData}}

RESPONSE REQUIREMENTS:
- Copy the exact TITLE from each patent's JSON into your assessments
- Flag patents where Round 1 quoted a fabricated/different title
- Demote hallucinated patents to bottom of ranking with score 0
- Use keys: {{cluster.patentIdList}}`;

// ─────────────────────────────────────────────────────────────────────────────
// Round 3: Semi-Final (deeper analysis before final)
// ─────────────────────────────────────────────────────────────────────────────

const round3Questions: StructuredQuestion[] = [
  // ═══ FINAL LAYER SCORES ═══
  {
    fieldName: 'final_mobility_score',
    question: 'LAYER 1 - MOBILITY: Final score 0-5 after two rounds of verification.',
    answerType: 'INTEGER',
    constraints: { min: 0, max: 5 },
  },
  {
    fieldName: 'final_connectivity_score',
    question: 'LAYER 2 - CONNECTIVITY: Final score 0-5 after two rounds of verification.',
    answerType: 'INTEGER',
    constraints: { min: 0, max: 5 },
  },
  {
    fieldName: 'final_peripheral_score',
    question: 'LAYER 3 - PERIPHERAL: Final score 0-5 after two rounds of verification.',
    answerType: 'INTEGER',
    constraints: { min: 0, max: 5 },
  },
  {
    fieldName: 'final_reliability_score',
    question: 'LAYER 4 - RELIABILITY: Final score 0-5 after two rounds of verification.',
    answerType: 'INTEGER',
    constraints: { min: 0, max: 5 },
  },
  {
    fieldName: 'final_composite_score',
    question: 'Sum of all final layer scores (0-20). This is the definitive tech stack relevance score.',
    answerType: 'INTEGER',
    constraints: { min: 0, max: 20 },
  },

  // ═══ TECHNOLOGY SUMMARY ═══
  {
    fieldName: 'technology_summary',
    question: 'In 15 words max: "[QUOTED TITLE]" - [technology]. Layers: [which layers scored > 0].',
    answerType: 'TEXT',
  },
  {
    fieldName: 'primary_pos_use_case',
    question: 'If composite >= 8: specific POS use case (e.g., "WiFi coexistence for restaurant tablet POS"). If < 8: "Below threshold".',
    answerType: 'TEXT',
  },

  // ═══ FINAL RANKING ═══
  {
    fieldName: 'cluster_ranking',
    question: 'Final ranking by final_composite_score (highest first). Patents with score < 4 at bottom.',
    answerType: 'TEXT_ARRAY',
  },
  {
    fieldName: 'qualified_for_final',
    question: 'How many patents have final_composite_score >= 8? These advance to final round. May be 0.',
    answerType: 'INTEGER',
    constraints: { min: 0, max: 15 },
  },

  // ═══ ASSERTION ANALYSIS (for qualified patents) ═══
  {
    fieldName: 'assertion_readiness',
    question: 'If final_composite_score >= 8: assertion readiness 1-10. If < 8: score 0.',
    answerType: 'INTEGER',
    constraints: { min: 0, max: 10 },
  },
  {
    fieldName: 'best_defendant_type',
    question: 'Best defendant type based on strongest layer.',
    answerType: 'ENUM',
    constraints: { options: ['device_manufacturer', 'restaurant_pos', 'payment_processor', 'wireless_chip_vendor', 'peripheral_maker', 'not_qualified'] },
  },

  // ═══ FINAL RECOMMENDATION ═══
  {
    fieldName: 'final_recommendation',
    question: 'Recommendation based on final_composite_score.',
    answerType: 'ENUM',
    constraints: { options: ['tier_1_advance', 'tier_2_advance', 'tier_3_conditional', 'drop_below_threshold'] },
  },
  {
    fieldName: 'recommendation_reasoning',
    question: 'Quote title and explain recommendation. Format: "[title]" - [reasoning with layer scores].',
    answerType: 'TEXT',
  },

  // ═══ LATENT ADJACENT VALUE (final assessment) ═══
  {
    fieldName: 'latent_value_candidate',
    question: 'Final latent value assessment: is there a patent with composite < 8 but genuine adjacent value? Return key or "NONE".',
    answerType: 'TEXT',
  },
  {
    fieldName: 'latent_value_final_reasoning',
    question: 'If latent candidate exists: quote title and explain adjacent value that justifies advancement. Else "No latent value candidates".',
    answerType: 'TEXT',
  },
];

const round3Prompt = `Round 3 (SEMI-FINAL): Final layer verification before strategic synthesis.

PATENT IDENTIFICATION:
Valid keys: {{cluster.patentIdList}}

═══════════════════════════════════════════════════════════════════════════════
FINAL LAYER ASSESSMENT
═══════════════════════════════════════════════════════════════════════════════

These patents survived two rounds of screening. Now provide FINAL scores.

THE 4 LAYERS (apply strictly):
  Layer 1 MOBILITY (0-5): Handheld/portable devices, tablets, battery-powered
  Layer 2 CONNECTIVITY (0-5): WiFi/cellular/BT management, radio coexistence
  Layer 3 PERIPHERAL (0-5): Card readers, printers, NFC, payment terminals
  Layer 4 RELIABILITY (0-5): Operation under stress, power management, failover

SCORING GUIDELINES:
- Score based on ACTUAL technology in title/summary
- Be strict - only score points where patent clearly addresses that layer
- Composite score (0-20) determines advancement
- Patents with composite >= 8 advance to final strategic synthesis
- Patents with composite < 8 but strong adjacent value may still advance

ADVANCEMENT THRESHOLDS:
- Tier 1 Advance: composite >= 12 (strong in multiple layers)
- Tier 2 Advance: composite >= 8 (solid in at least 2 layers)
- Tier 3 Conditional: composite 4-7 with specific use case
- Drop: composite < 4 (no significant tech stack relevance)

DEFENDANT MAPPING (based on strongest layer):
- Layer 1 strong → device_manufacturer (Apple, Samsung)
- Layer 2 strong → wireless_chip_vendor (Qualcomm, Broadcom)
- Layer 3 strong → payment_processor, peripheral_maker
- Layer 4 strong → restaurant_pos (Toast, Square)

PREVIOUS ROUNDS (use as reference, but score based on actual patent data):
{{cluster.round1Results}}

═══════════════════════════════════════════════════════════════════════════════
CRITICAL: USE EXACT TITLES FROM JSON
═══════════════════════════════════════════════════════════════════════════════

⚠️ COPY THE EXACT "TITLE" FIELD - DO NOT INVENT TITLES ⚠️

=== ACTUAL PATENT DATA (GROUND TRUTH) ===
{{cluster.patentData}}

RESPONSE REQUIREMENTS:
- Copy the exact TITLE from each patent's JSON into technology_summary
- Score 0 for any patent where previous rounds used fabricated titles
- It is OK if qualified_for_final = 0
- Use keys: {{cluster.patentIdList}}`;

// ─────────────────────────────────────────────────────────────────────────────
// Final Round: Strategic Synthesis (~30 finalists)
// ─────────────────────────────────────────────────────────────────────────────

const finalQuestions: StructuredQuestion[] = [
  {
    fieldName: 'tier1_patents',
    question: 'Which patents should be Tier 1 (lead assertion candidates)? Aim for 3-5 patents. Return array of patent keys (PATENT_1, PATENT_2, etc.).',
    answerType: 'TEXT_ARRAY',
  },
  {
    fieldName: 'tier1_rationale',
    question: 'Why are these patents Tier 1? What makes them lead assertion candidates?',
    answerType: 'TEXT',
  },
  {
    fieldName: 'tier2_patents',
    question: 'Which patents should be Tier 2 (strong support)? Aim for 8-12 patents. Return patent keys.',
    answerType: 'TEXT_ARRAY',
  },
  {
    fieldName: 'tier2_rationale',
    question: 'What role do Tier 2 patents play in the campaign?',
    answerType: 'TEXT',
  },
  {
    fieldName: 'tier3_patents',
    question: 'Which patents should be Tier 3 (conditional value)? Return patent keys.',
    answerType: 'TEXT_ARRAY',
  },
  {
    fieldName: 'dark_horse_winners',
    question: 'Which dark horse candidates proved their worth? Did any surprise you?',
    answerType: 'TEXT_ARRAY',
  },
  {
    fieldName: 'dark_horse_analysis',
    question: 'Analyze the dark horse journey - what did we learn from preserving them through rounds?',
    answerType: 'TEXT',
  },
  {
    fieldName: 'portfolio_connectivity_strength',
    question: 'Rate overall portfolio connectivity coverage (1-10).',
    answerType: 'INTEGER',
    constraints: { min: 1, max: 10 },
  },
  {
    fieldName: 'restaurant_narrative_strength',
    question: 'Rate strength of restaurant operational narrative (1-10).',
    answerType: 'INTEGER',
    constraints: { min: 1, max: 10 },
  },
  {
    fieldName: 'assertion_readiness',
    question: 'Rate overall assertion readiness (1-10).',
    answerType: 'INTEGER',
    constraints: { min: 1, max: 10 },
  },
  {
    fieldName: 'recommended_lead_patents',
    question: 'Top 3 patents to lead assertion campaign, in priority order.',
    answerType: 'TEXT_ARRAY',
  },
  {
    fieldName: 'recommended_defendant_sequence',
    question: 'Recommended defendant targeting sequence.',
    answerType: 'TEXT_ARRAY',
  },
  {
    fieldName: 'key_jury_narrative',
    question: 'One-paragraph jury narrative for this portfolio.',
    answerType: 'TEXT',
  },
  {
    fieldName: 'portfolio_gaps',
    question: 'What connectivity areas are NOT covered by this portfolio?',
    answerType: 'TEXT',
  },
  {
    fieldName: 'campaign_risks',
    question: 'Top 3 risks to a licensing campaign using this portfolio.',
    answerType: 'TEXT_ARRAY',
  },
  {
    fieldName: 'executive_summary',
    question: 'Executive summary of portfolio strength and recommended approach (2-3 paragraphs).',
    answerType: 'TEXT',
  },
];

const finalPrompt = `You are conducting the FINAL strategic synthesis for a POS licensing campaign.

PATENT IDENTIFICATION:
Each patent is identified by a numbered key: PATENT_1, PATENT_2, etc.
The valid keys for this evaluation are: {{cluster.patentIdList}}

You MUST use these exact keys (PATENT_1, PATENT_2, etc.) in your response.
Do NOT use patent numbers or any other identifiers.

SELECTION TASK:
From the finalist patents below, select the TOP ~30 patents for the final portfolio:
- Tier 1: 3-5 lead assertion patents (highest value, strongest claims)
- Tier 2: 8-12 strong support patents
- Tier 3: 10-15 conditional value patents
- Total should be approximately 30 patents

DARK HORSE EVALUATION:
- Some patents advanced as "dark horses" through the rounds
- Only include dark horses in the final 30 if they truly merit inclusion on their own merits
- Do not include a dark horse just because it was preserved - it must compete fairly now

TOURNAMENT CONTEXT:
- Started with patents from {{super_sector}} super-sector
- Round 1: Initial screening
- Round 2: Intermediate comparison
- Round 3: Semi-final
- Now: Final selection of top ~30

FINALIST PATENTS (each patent has an "ID" field like PATENT_1, PATENT_2, etc.):
{{cluster.patentData}}

PREVIOUS ROUND ASSESSMENTS:
{{cluster.round1Results}}

Your tier arrays and all patent references MUST use: {{cluster.patentIdList}}

Provide your strategic synthesis in JSON format.`;

// ─────────────────────────────────────────────────────────────────────────────
// Main Seeding Function
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// DIAGNOSTIC TEMPLATE - Test if model can read titles correctly
// ─────────────────────────────────────────────────────────────────────────────

const diagnosticQuestions: StructuredQuestion[] = [
  {
    fieldName: 'patent_title_echo',
    question: 'Copy the EXACT "TITLE" field from this patent\'s JSON data. Do not paraphrase or interpret - just copy the title verbatim.',
    answerType: 'TEXT',
  },
  {
    fieldName: 'title_first_three_words',
    question: 'What are the first 3 words of the title?',
    answerType: 'TEXT',
  },
  {
    fieldName: 'title_character_count',
    question: 'How many characters are in the title (approximate)?',
    answerType: 'INTEGER',
    constraints: { min: 0, max: 500 },
  },
  {
    fieldName: 'has_abstract',
    question: 'Does the patent JSON include an ABSTRACT field with content?',
    answerType: 'ENUM',
    constraints: { options: ['yes', 'no', 'empty'] },
  },
];

const diagnosticPrompt = `DIAGNOSTIC TEST: Can you read the patent data correctly?

This is a simple test to verify you can read and copy patent titles from the provided JSON.

PATENT IDENTIFICATION:
Each patent has a numbered key: PATENT_1, PATENT_2, etc.
Valid keys: {{cluster.patentIdList}}

=== PATENT DATA ===
{{cluster.patentData}}

TASK:
For EACH patent, simply read the JSON and copy the information requested.
DO NOT interpret, paraphrase, or make assumptions - just copy what you see.

Return a JSON object with each patent key (PATENT_1, etc.) as keys.`;

// ─────────────────────────────────────────────────────────────────────────────
// SIMPLIFIED TEMPLATE - Fewer questions, no ranking, no problematic examples
// ─────────────────────────────────────────────────────────────────────────────

const simplifiedQuestions: StructuredQuestion[] = [
  // Echo title first - verify model is reading data
  {
    fieldName: 'title_verbatim',
    question: 'Copy the EXACT "TITLE" field from this patent\'s JSON. Do not change any words.',
    answerType: 'TEXT',
  },
  // Simple 4-layer scores
  {
    fieldName: 'mobility_score',
    question: 'LAYER 1 - MOBILITY: Is this about portable/handheld devices? Score 0-5. Most patents score 0.',
    answerType: 'INTEGER',
    constraints: { min: 0, max: 5 },
  },
  {
    fieldName: 'connectivity_score',
    question: 'LAYER 2 - CONNECTIVITY: Is this about WiFi/Bluetooth/cellular management? Score 0-5. Most patents score 0.',
    answerType: 'INTEGER',
    constraints: { min: 0, max: 5 },
  },
  {
    fieldName: 'peripheral_score',
    question: 'LAYER 3 - PERIPHERAL: Is this about device-to-peripheral communication (card readers, printers)? Score 0-5. Most patents score 0.',
    answerType: 'INTEGER',
    constraints: { min: 0, max: 5 },
  },
  {
    fieldName: 'reliability_score',
    question: 'LAYER 4 - RELIABILITY: Is this about operation under stress (interference, low power)? Score 0-5. Most patents score 0.',
    answerType: 'INTEGER',
    constraints: { min: 0, max: 5 },
  },
  {
    fieldName: 'total_score',
    question: 'Sum of all 4 layer scores (0-20).',
    answerType: 'INTEGER',
    constraints: { min: 0, max: 20 },
  },
  // Misc tech relevance (replaces dark horse)
  {
    fieldName: 'misc_tech_relevance',
    question: 'Does this patent have relevance to restaurant/retail technology NOT captured by the 4 layers? Brief explanation or "none".',
    answerType: 'TEXT',
  },
];

const simplifiedPrompt = `Evaluate patents for POS technology relevance.

IMPORTANT - READ THE DATA BELOW CAREFULLY:
Each patent has a TITLE field. You MUST copy this exact title in your response.
Do NOT invent or assume titles - use only what is provided in the JSON.

SCORING (be honest - most patents score 0):
- Layer 1 MOBILITY: Portable/handheld devices, tablets
- Layer 2 CONNECTIVITY: WiFi/Bluetooth/cellular management
- Layer 3 PERIPHERAL: Card readers, printers, NFC terminals
- Layer 4 RELIABILITY: Operation under stress, power issues

PATENT IDENTIFICATION:
Keys: {{cluster.patentIdList}}

=== PATENT DATA (READ THE "TITLE" FIELD) ===
{{cluster.patentData}}

RESPONSE FORMAT:
Return JSON with patent keys (PATENT_1, PATENT_2, etc.) as top-level keys.
For each patent: copy title_verbatim FIRST, then provide scores.
It is NORMAL for patents to score 0 in all layers.`;

async function seedTemplates() {
  console.log('Seeding POS Tournament V2 templates...');

  // Diagnostic Template
  await prisma.promptTemplate.upsert({
    where: { id: 'tmpl_diagnostic' },
    update: {
      name: 'Diagnostic - Title Echo Test',
      description: 'Tests if model can read and echo patent titles correctly',
      templateType: 'STRUCTURED',
      promptText: diagnosticPrompt,
      questions: diagnosticQuestions as any,
      llmModel: 'claude-sonnet-4-20250514',
      status: 'DRAFT',
    },
    create: {
      id: 'tmpl_diagnostic',
      name: 'Diagnostic - Title Echo Test',
      description: 'Tests if model can read and echo patent titles correctly',
      templateType: 'STRUCTURED',
      promptText: diagnosticPrompt,
      questions: diagnosticQuestions as any,
      llmModel: 'claude-sonnet-4-20250514',
      status: 'DRAFT',
    },
  });
  console.log('  Created: tmpl_diagnostic');

  // Simplified Template
  await prisma.promptTemplate.upsert({
    where: { id: 'tmpl_simplified_r1' },
    update: {
      name: 'Simplified - Round 1 (No Ranking)',
      description: 'Simplified scoring without ranking or complex examples',
      templateType: 'STRUCTURED',
      promptText: simplifiedPrompt,
      questions: simplifiedQuestions as any,
      llmModel: 'claude-sonnet-4-20250514',
      status: 'DRAFT',
    },
    create: {
      id: 'tmpl_simplified_r1',
      name: 'Simplified - Round 1 (No Ranking)',
      description: 'Simplified scoring without ranking or complex examples',
      templateType: 'STRUCTURED',
      promptText: simplifiedPrompt,
      questions: simplifiedQuestions as any,
      llmModel: 'claude-sonnet-4-20250514',
      status: 'DRAFT',
    },
  });
  console.log('  Created: tmpl_simplified_r1');

  // Round 1 Template
  await prisma.promptTemplate.upsert({
    where: { id: 'tmpl_pos_v2_round1' },
    update: {
      name: 'POS Tournament V2 - Round 1 (Initial Screening)',
      description: '20 patents per cluster, advance top 5 + dark horse, use rankings not ratings',
      templateType: 'STRUCTURED',
      promptText: round1Prompt,
      questions: round1Questions as any,
      llmModel: 'claude-sonnet-4-20250514',
      status: 'DRAFT',
    },
    create: {
      id: 'tmpl_pos_v2_round1',
      name: 'POS Tournament V2 - Round 1 (Initial Screening)',
      description: '20 patents per cluster, advance top 5 + dark horse, use rankings not ratings',
      templateType: 'STRUCTURED',
      promptText: round1Prompt,
      questions: round1Questions as any,
      llmModel: 'claude-sonnet-4-20250514',
      status: 'DRAFT',
    },
  });
  console.log('  Created: tmpl_pos_v2_round1');

  // Round 2 Template
  await prisma.promptTemplate.upsert({
    where: { id: 'tmpl_pos_v2_round2' },
    update: {
      name: 'POS Tournament V2 - Round 2 (Intermediate)',
      description: 'Intermediate screening with carried context and dark horse preservation',
      templateType: 'STRUCTURED',
      promptText: round2Prompt,
      questions: round2Questions as any,
      llmModel: 'claude-sonnet-4-20250514',
      status: 'DRAFT',
    },
    create: {
      id: 'tmpl_pos_v2_round2',
      name: 'POS Tournament V2 - Round 2 (Intermediate)',
      description: 'Intermediate screening with carried context and dark horse preservation',
      templateType: 'STRUCTURED',
      promptText: round2Prompt,
      questions: round2Questions as any,
      llmModel: 'claude-sonnet-4-20250514',
      status: 'DRAFT',
    },
  });
  console.log('  Created: tmpl_pos_v2_round2');

  // Round 3 Template
  await prisma.promptTemplate.upsert({
    where: { id: 'tmpl_pos_v2_round3' },
    update: {
      name: 'POS Tournament V2 - Round 3 (Semi-Final)',
      description: 'Semi-final with lead patent assessment and pairing analysis',
      templateType: 'STRUCTURED',
      promptText: round3Prompt,
      questions: round3Questions as any,
      llmModel: 'claude-sonnet-4-20250514',
      status: 'DRAFT',
    },
    create: {
      id: 'tmpl_pos_v2_round3',
      name: 'POS Tournament V2 - Round 3 (Semi-Final)',
      description: 'Semi-final with lead patent assessment and pairing analysis',
      templateType: 'STRUCTURED',
      promptText: round3Prompt,
      questions: round3Questions as any,
      llmModel: 'claude-sonnet-4-20250514',
      status: 'DRAFT',
    },
  });
  console.log('  Created: tmpl_pos_v2_round3');

  // Final Template
  await prisma.promptTemplate.upsert({
    where: { id: 'tmpl_pos_v2_final' },
    update: {
      name: 'POS Tournament V2 - Final (Strategic Synthesis)',
      description: 'Final synthesis with ~30 finalists, dark horse evaluation, and campaign strategy',
      templateType: 'STRUCTURED',
      promptText: finalPrompt,
      questions: finalQuestions as any,
      llmModel: 'claude-sonnet-4-20250514',
      status: 'DRAFT',
    },
    create: {
      id: 'tmpl_pos_v2_final',
      name: 'POS Tournament V2 - Final (Strategic Synthesis)',
      description: 'Final synthesis with ~30 finalists, dark horse evaluation, and campaign strategy',
      templateType: 'STRUCTURED',
      promptText: finalPrompt,
      questions: finalQuestions as any,
      llmModel: 'claude-sonnet-4-20250514',
      status: 'DRAFT',
    },
  });
  console.log('  Created: tmpl_pos_v2_final');

  console.log('\nPOS Tournament V2 templates seeded successfully!');
  console.log('\nTemplate IDs:');
  console.log('  Round 1: tmpl_pos_v2_round1');
  console.log('  Round 2: tmpl_pos_v2_round2');
  console.log('  Round 3: tmpl_pos_v2_round3');
  console.log('  Final:   tmpl_pos_v2_final');
}

seedTemplates()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
