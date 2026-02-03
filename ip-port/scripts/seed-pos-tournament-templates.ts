/**
 * Seed POS Tournament Prompt Templates (Revised)
 *
 * Creates structured question templates for POS (Point-of-Sale) patent tournament:
 * 1. POS Round 1 Evaluation — broad screening with COMPARATIVE RANKING
 * 2. POS Round 2 Evaluation — deeper analysis, carries forward Round 1 context
 * 3. POS Final Synthesis — strategic recommendations for litigation campaign
 *
 * KEY DESIGN PRINCIPLES:
 * - Each round produces RANKINGS within clusters, not just scores
 * - Full question coverage in ALL rounds (connectivity, litigation, strategy)
 * - Questions repeat/evolve across rounds with different weights
 * - Text reasoning preserved and carried forward between rounds
 * - Looking for "dark horse" candidates in early rounds
 *
 * Usage: npx tsx scripts/seed-pos-tournament-templates.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ═══════════════════════════════════════════════════════════════════════════
// ROUND 1: BROAD SCREENING WITH COMPARATIVE RANKING
// Full question set covering all dimensions - find dark horses
// Output: Explicit ranking 1-N within cluster, top 2-3 advance
// ═══════════════════════════════════════════════════════════════════════════

const ROUND_1_QUESTIONS = [
  // ─── Ranking (Critical) ───
  {
    fieldName: 'cluster_ranking',
    question: 'Rank ALL patents in this cluster from most to least promising for POS licensing. Output as ordered array of patent IDs, best first.',
    answerType: 'TEXT_ARRAY',
    constraints: { maxItems: 15 },
    description: 'REQUIRED: Ordered ranking of all patents, best first. This drives advancement.'
  },
  {
    fieldName: 'top_candidates',
    question: 'Which 2-3 patents in this cluster are the strongest POS licensing candidates? Why do they stand out from the others?',
    answerType: 'TEXT',
    constraints: { maxSentences: 4 },
    description: 'Identify top performers with comparative reasoning'
  },

  // ─── Connectivity Layer (Primary Filter) ───
  {
    fieldName: 'connectivity_layer_score',
    question: 'Rate connectivity layer relevance: Does this patent address wireless connectivity, radio coexistence, cellular/Wi-Fi/Bluetooth coordination, handoff mechanisms, or device communication reliability?',
    answerType: 'INTEGER',
    constraints: { min: 1, max: 5 },
    description: '5=Core connectivity (radio coexistence, handoff), 4=Strong, 3=Moderate, 2=Tangential, 1=None'
  },
  {
    fieldName: 'connectivity_type',
    question: 'What connectivity technology does this patent primarily address?',
    answerType: 'ENUM',
    constraints: {
      options: ['cellular_lte_5g', 'wifi', 'bluetooth', 'multi_radio_coexistence', 'network_protocol', 'device_communication', 'not_connectivity']
    },
    description: 'Primary technology focus - helps identify patent clusters'
  },

  // ─── POS/Payment Applicability ───
  {
    fieldName: 'pos_applicability_score',
    question: 'Rate POS applicability: Could this patent apply to mobile POS terminals, handheld payment devices, or point-of-sale hardware from vendors like Toast, Square, Clover, Verifone?',
    answerType: 'INTEGER',
    constraints: { min: 1, max: 5 },
    description: '5=Direct POS device applicability, 4=Strong, 3=Moderate, 2=Weak, 1=None'
  },
  {
    fieldName: 'pos_target_fit',
    question: 'Which POS vendors/targets would this patent most likely apply to?',
    answerType: 'TEXT_ARRAY',
    constraints: { maxItems: 5 },
    description: 'e.g., Toast, Square, Clover/Fiserv, Verifone, Ingenico, Stripe Terminal, PayPal Zettle'
  },

  // ─── Operational Reliability (Key Narrative) ───
  {
    fieldName: 'operational_reliability_score',
    question: 'Rate operational reliability focus: Does this patent PREVENT device/system failure rather than ADD features? Focus on uptime, graceful degradation, avoiding downtime at critical moments.',
    answerType: 'INTEGER',
    constraints: { min: 1, max: 5 },
    description: '5=Prevents critical failure, 4=Strong reliability, 3=Some benefit, 2=Minor, 1=Feature-only'
  },

  // ─── Restaurant Stress Test ───
  {
    fieldName: 'restaurant_stress_score',
    question: 'Rate restaurant environment value: Would this technology prove critical in high-stress restaurant conditions - peak dinner rush, outdoor patios, Wi-Fi dead zones, dense Bluetooth peripherals, servers in constant motion?',
    answerType: 'INTEGER',
    constraints: { min: 1, max: 5 },
    description: '5=Critical for restaurant ops, 4=Strong value, 3=Moderate, 2=Minor, 1=No relevance'
  },

  // ─── Cross-Vertical Breadth ───
  {
    fieldName: 'cross_vertical_score',
    question: 'Rate cross-vertical applicability: Does this patent apply beyond restaurants to general retail POS, payment processors (Stripe, PayPal), mobile payment providers, or other terminal manufacturers?',
    answerType: 'INTEGER',
    constraints: { min: 1, max: 5 },
    description: '5=Broad applicability (retail, payments, processors), 4=Strong, 3=Some, 2=Limited, 1=Single vertical'
  },

  // ─── Litigation Readiness (Early Screening) ───
  {
    fieldName: 'damages_clarity_score',
    question: 'Rate damages model clarity: Can damages be tied cleanly to per-device royalties WITHOUT complex apportionment to software subscriptions, transaction fees, or restaurant-specific workflows?',
    answerType: 'INTEGER',
    constraints: { min: 1, max: 5 },
    description: '5=Clean per-device model, 4=Mostly device-tied, 3=Some apportionment, 2=Complex, 1=Problematic'
  },
  {
    fieldName: 'technical_specificity_score',
    question: 'Rate technical specificity: Is this clear engineering/technical innovation (not abstract business method)? Would it likely survive 35 USC 101 scrutiny?',
    answerType: 'INTEGER',
    constraints: { min: 1, max: 5 },
    description: '5=Clear technical innovation, 4=Strong technical, 3=Mixed, 2=Weak, 1=Abstract idea risk'
  },

  // ─── Overall Assessment ───
  {
    fieldName: 'overall_pos_potential',
    question: 'Overall POS licensing potential combining ALL factors: connectivity relevance, POS applicability, reliability value, cross-vertical breadth, and litigation readiness.',
    answerType: 'INTEGER',
    constraints: { min: 1, max: 10 },
    description: '10=Exceptional candidate, 7-9=Strong, 4-6=Moderate, 1-3=Weak or not applicable'
  },

  // ─── Text Reasoning (Preserved for Later Rounds) ───
  {
    fieldName: 'key_strength',
    question: 'What is the PRIMARY licensing strength of this patent for POS assertion? Be specific.',
    answerType: 'TEXT',
    constraints: { maxSentences: 2 },
    description: 'Main value proposition - carried forward to Round 2'
  },
  {
    fieldName: 'key_weakness',
    question: 'What is the main challenge, weakness, or risk for POS assertion with this patent?',
    answerType: 'TEXT',
    constraints: { maxSentences: 2 },
    description: 'Primary risk - carried forward to Round 2'
  },
  {
    fieldName: 'dark_horse_potential',
    question: 'Could this patent be a "dark horse" - seemingly moderate but potentially valuable for strategic reasons (fills gap, enables claim combination, targets specific defendant)?',
    answerType: 'TEXT',
    constraints: { maxSentences: 2 },
    description: 'Look for non-obvious value that scores might miss'
  }
];

// ═══════════════════════════════════════════════════════════════════════════
// ROUND 2: DEEPER ANALYSIS WITH CARRIED CONTEXT
// Same broad coverage but with Round 1 context, harder questions, refined weights
// Output: Re-ranking within new clusters, top 2-3 advance to final
// ═══════════════════════════════════════════════════════════════════════════

const ROUND_2_QUESTIONS = [
  // ─── Ranking (Critical) ───
  {
    fieldName: 'cluster_ranking',
    question: 'Rank ALL patents in this cluster from most to least promising for POS licensing. Consider the Round 1 assessments provided. Output as ordered array of patent IDs, best first.',
    answerType: 'TEXT_ARRAY',
    constraints: { maxItems: 15 },
    description: 'REQUIRED: Ordered ranking incorporating Round 1 context'
  },
  {
    fieldName: 'top_candidates',
    question: 'Which 2-3 patents should advance to final synthesis? Why do these stand out among patents that ALREADY passed Round 1 screening?',
    answerType: 'TEXT',
    constraints: { maxSentences: 4 },
    description: 'Justify advancement among pre-screened candidates'
  },
  {
    fieldName: 'round1_validation',
    question: 'Do the Round 1 assessments (key_strength, key_weakness) still hold after deeper analysis? Note any patents where your assessment differs significantly.',
    answerType: 'TEXT',
    constraints: { maxSentences: 3 },
    description: 'Validate or revise Round 1 reasoning'
  },

  // ─── Connectivity (Re-evaluated with Context) ───
  {
    fieldName: 'connectivity_layer_score',
    question: 'Re-rate connectivity layer relevance with deeper analysis. Consider specific claim language if available. Does this patent control a foundational connectivity mechanism?',
    answerType: 'INTEGER',
    constraints: { min: 1, max: 5 },
    description: '5=Foundational connectivity control, 4=Strong, 3=Moderate, 2=Tangential, 1=None'
  },
  {
    fieldName: 'connectivity_specifics',
    question: 'What SPECIFIC connectivity mechanism does this patent address? (e.g., "LTE idle interval management", "Wi-Fi/BT time-division arbitration", "cellular fallback on Wi-Fi failure")',
    answerType: 'TEXT',
    constraints: { maxSentences: 2 },
    description: 'Precise technical mechanism - important for claim mapping'
  },

  // ─── POS Applicability (Deeper) ───
  {
    fieldName: 'pos_applicability_score',
    question: 'Re-rate POS applicability. Consider: Would a POS device engineer recognize this technology in their product? Is this in the critical path for payment processing?',
    answerType: 'INTEGER',
    constraints: { min: 1, max: 5 },
    description: '5=Critical path for POS, 4=Strong, 3=Moderate, 2=Peripheral, 1=None'
  },
  {
    fieldName: 'infringement_detectability',
    question: 'How DETECTABLE would infringement be? Can we observe this technology in a POS device without source code access? (network behavior, device testing, public APIs)',
    answerType: 'INTEGER',
    constraints: { min: 1, max: 5 },
    description: '5=Externally observable, 4=Testable, 3=Requires some access, 2=Difficult, 1=Requires source code'
  },

  // ─── Restaurant/Reliability (Refined) ───
  {
    fieldName: 'restaurant_stress_score',
    question: 'Re-rate restaurant value. Consider the narrative: "If this technology fails during dinner rush, what breaks?" Is this the layer that prevents payment failure?',
    answerType: 'INTEGER',
    constraints: { min: 1, max: 5 },
    description: '5=Payment fails without this, 4=Strong degradation, 3=Some impact, 2=Minor, 1=No impact'
  },
  {
    fieldName: 'operational_reliability_score',
    question: 'Re-rate operational reliability. Key test: Does this patent describe PREVENTING a failure mode, or ADDING a feature?',
    answerType: 'INTEGER',
    constraints: { min: 1, max: 5 },
    description: '5=Prevents critical failure, 4=Strong reliability, 3=Mixed, 2=Mostly feature, 1=Pure feature'
  },

  // ─── Litigation Readiness (Harder Questions) ───
  {
    fieldName: 'damages_clarity_score',
    question: 'Re-rate damages clarity. Consider: Can we tie royalty to the DEVICE without touching software revenue, transaction fees, or subscription models?',
    answerType: 'INTEGER',
    constraints: { min: 1, max: 5 },
    description: '5=Pure device royalty, 4=Mostly clean, 3=Some complexity, 2=Significant apportionment, 1=Problematic'
  },
  {
    fieldName: 'technical_specificity_score',
    question: 'Re-rate 101 survivability. Is the claim language tied to specific technical implementation (hardware, protocols, algorithms) or abstract concepts?',
    answerType: 'INTEGER',
    constraints: { min: 1, max: 5 },
    description: '5=Concrete technical, 4=Strong technical, 3=Mixed, 2=Abstract leaning, 1=High 101 risk'
  },
  {
    fieldName: 'validity_concerns',
    question: 'Any obvious validity concerns? Prior art issues, overly broad claims, prosecution history problems suggested by the patent data?',
    answerType: 'TEXT',
    constraints: { maxSentences: 2 },
    description: 'Flag potential validity issues for deeper review'
  },

  // ─── Cross-Vertical (Strategic) ───
  {
    fieldName: 'cross_vertical_score',
    question: 'Re-rate cross-vertical applicability. Beyond restaurants: retail POS, payment kiosks, mobile payment providers, payment processors?',
    answerType: 'INTEGER',
    constraints: { min: 1, max: 5 },
    description: '5=Applies across all POS/payment, 4=Strong breadth, 3=Some, 2=Limited, 1=Single use'
  },
  {
    fieldName: 'defendant_sequence',
    question: 'If asserting this patent, which defendant type should come FIRST? (Restaurant POS, Retail POS, Payment Processor, Device Manufacturer)',
    answerType: 'ENUM',
    constraints: {
      options: ['restaurant_pos', 'retail_pos', 'payment_processor', 'device_manufacturer', 'multiple_simultaneous']
    },
    description: 'Optimal defendant sequencing for this patent'
  },

  // ─── Overall and Reasoning ───
  {
    fieldName: 'overall_pos_potential',
    question: 'Overall POS licensing potential after Round 2 deeper analysis. Be more discriminating than Round 1.',
    answerType: 'INTEGER',
    constraints: { min: 1, max: 10 },
    description: '10=Exceptional, 8-9=Strong, 6-7=Good, 4-5=Marginal, 1-3=Weak'
  },
  {
    fieldName: 'key_strength_refined',
    question: 'Refined key strength after deeper analysis. What makes this patent BETTER than others in this cluster?',
    answerType: 'TEXT',
    constraints: { maxSentences: 2 },
    description: 'Comparative strength statement'
  },
  {
    fieldName: 'litigation_readiness',
    question: 'Is this patent ready for assertion, or does it need additional work (claim construction, infringement study, validity analysis)?',
    answerType: 'TEXT',
    constraints: { maxSentences: 2 },
    description: 'Practical readiness assessment'
  }
];

// ═══════════════════════════════════════════════════════════════════════════
// FINAL SYNTHESIS: STRATEGIC CAMPAIGN PLANNING
// All finalists together, comprehensive strategic assessment
// Output: Tiered recommendations, jury narrative, campaign plan
// ═══════════════════════════════════════════════════════════════════════════

const FINAL_SYNTHESIS_QUESTIONS = [
  // ─── Tiered Patent Classification ───
  {
    fieldName: 'tier1_patents',
    question: 'TIER 1 - Lead assertion patents: Which patents should LEAD a POS licensing campaign? These must have: strong connectivity claims, clean damages, high detectability, broad applicability.',
    answerType: 'TEXT_ARRAY',
    constraints: { maxItems: 5 },
    description: 'Best 3-5 patents for lead assertions'
  },
  {
    fieldName: 'tier1_rationale',
    question: 'Why are Tier 1 patents the best choices for lead assertions? What distinguishes them from Tier 2?',
    answerType: 'TEXT',
    constraints: { maxSentences: 4 },
    description: 'Justify tier 1 selection'
  },
  {
    fieldName: 'tier2_patents',
    question: 'TIER 2 - Supporting patents: Which patents strengthen the campaign but are not lead candidates? Good for claim stacking, backup, or specific defendants.',
    answerType: 'TEXT_ARRAY',
    constraints: { maxItems: 10 },
    description: 'Supporting patents'
  },
  {
    fieldName: 'tier3_patents',
    question: 'TIER 3 - Conditional value: Which patents might be useful in specific scenarios (particular defendant, claim combination, settlement leverage)?',
    answerType: 'TEXT_ARRAY',
    constraints: { maxItems: 10 },
    description: 'Situational patents'
  },

  // ─── Portfolio Strength Assessment ───
  {
    fieldName: 'connectivity_portfolio_strength',
    question: 'Rate overall portfolio strength for CONNECTIVITY-LAYER claims (radio coexistence, handoff, multi-radio arbitration).',
    answerType: 'INTEGER',
    constraints: { min: 1, max: 10 },
    description: '10=Dominant, 7-9=Strong, 4-6=Moderate, 1-3=Weak'
  },
  {
    fieldName: 'restaurant_narrative_strength',
    question: 'Rate strength of RESTAURANT-SPECIFIC jury narrative. Can we compellingly argue "these patents keep restaurants running during dinner rush"?',
    answerType: 'INTEGER',
    constraints: { min: 1, max: 10 },
    description: '10=Compelling, 7-9=Strong, 4-6=Moderate, 1-3=Weak'
  },
  {
    fieldName: 'damages_model_clarity',
    question: 'Rate clarity of PER-DEVICE DAMAGES model across the portfolio. Can we avoid revenue apportionment fights?',
    answerType: 'INTEGER',
    constraints: { min: 1, max: 10 },
    description: '10=Clean device royalty, 1=Complex apportionment'
  },
  {
    fieldName: 'section_101_confidence',
    question: 'Rate confidence that Tier 1 patents survive 35 USC 101 challenges.',
    answerType: 'INTEGER',
    constraints: { min: 1, max: 10 },
    description: '10=Very confident, 1=Significant risk'
  },

  // ─── Strategic Recommendations ───
  {
    fieldName: 'recommended_lead_patents',
    question: 'Top 3 patents to assert FIRST. These set the campaign narrative.',
    answerType: 'TEXT_ARRAY',
    constraints: { maxItems: 3 },
    description: 'First assertion patents'
  },
  {
    fieldName: 'target_defendants_priority',
    question: 'Defendant categories in priority order. Who should be targeted first, second, third?',
    answerType: 'TEXT_ARRAY',
    constraints: { maxItems: 5 },
    description: 'e.g., Toast, Square/Block, Clover/Fiserv, Verifone, Stripe'
  },
  {
    fieldName: 'key_jury_narrative',
    question: 'Craft the ONE-SENTENCE jury narrative these patents support. This is the anchor message: "This case is about..."',
    answerType: 'TEXT',
    constraints: { maxSentences: 2 },
    description: 'Central trial message'
  },
  {
    fieldName: 'liability_focus',
    question: 'What specific DEVICE BEHAVIOR should liability arguments focus on? (e.g., LTE idle intervals, WLAN burst timing, BT arbitration logic)',
    answerType: 'TEXT',
    constraints: { maxSentences: 3 },
    description: 'Technical focus for infringement arguments'
  },
  {
    fieldName: 'damages_focus',
    question: 'What DAMAGES STORY do these patents support? (avoided downtime, avoided payment failure, expanded service footprint)',
    answerType: 'TEXT',
    constraints: { maxSentences: 3 },
    description: 'Damages narrative'
  },

  // ─── Gap Analysis ───
  {
    fieldName: 'strategic_gaps',
    question: 'What POS-relevant technology areas are NOT well covered? What gaps exist in the identified portfolio?',
    answerType: 'TEXT',
    constraints: { maxSentences: 3 },
    description: 'Portfolio gaps'
  },
  {
    fieldName: 'pairing_opportunities',
    question: 'Could these patents be PAIRED with other IP for stronger coverage? (restaurant workflow patents, payment processing patents, application-layer patents)',
    answerType: 'TEXT',
    constraints: { maxSentences: 2 },
    description: 'Portfolio combination opportunities'
  },

  // ─── Risk Assessment ───
  {
    fieldName: 'primary_campaign_risks',
    question: 'What are the TOP 3 RISKS for a POS licensing campaign using these patents?',
    answerType: 'TEXT_ARRAY',
    constraints: { maxItems: 3 },
    description: 'Key risks to address'
  },
  {
    fieldName: 'risk_mitigation',
    question: 'How can identified risks be mitigated? What additional work is needed before campaign launch?',
    answerType: 'TEXT',
    constraints: { maxSentences: 3 },
    description: 'Risk mitigation steps'
  },

  // ─── Executive Summary ───
  {
    fieldName: 'executive_summary',
    question: 'EXECUTIVE SUMMARY: Summarize the POS licensing opportunity in 3-5 sentences for senior leadership. Cover portfolio strength, recommended approach, expected challenges.',
    answerType: 'TEXT',
    constraints: { maxSentences: 5 },
    description: 'Executive-level summary'
  }
];

async function main() {
  console.log('Seeding POS Tournament prompt templates (Revised 3-Round Design)...\n');

  // ─────────────────────────────────────────────────────────────────────────
  // Template 1: Round 1 - Broad Screening with Comparative Ranking
  // ─────────────────────────────────────────────────────────────────────────

  const round1Template = await prisma.promptTemplate.upsert({
    where: { id: 'tmpl_pos_round1_eval' },
    update: {
      name: 'POS Tournament - Round 1 Evaluation',
      description: 'Broad screening with COMPARATIVE RANKING. Full question coverage across connectivity, POS fit, litigation readiness, and strategy. Identifies top 2-3 from each cluster to advance. Looks for dark horse candidates.',
      templateType: 'STRUCTURED',
      objectType: 'patent',
      executionMode: 'COLLECTIVE',
      promptText: `You are a patent licensing analyst evaluating a cluster of patents for Point-of-Sale (POS) system licensing potential.

CRITICAL: You must RANK all patents in this cluster from best to worst. This is a COMPARATIVE analysis - don't just score each patent independently, compare them to each other.

TARGET TECHNOLOGY: Connectivity and device-control layer of mobile POS systems:
- Cellular/Wi-Fi/Bluetooth radio coexistence
- Device communication reliability and handoff
- Operational uptime (PREVENTING failure, not adding features)
- Applicable to handheld payment terminals (Toast, Square, Clover, Verifone, etc.)

KEY LITIGATION FRAME: "These patents don't claim how restaurants run; they claim how mobile POS devices stay connected so restaurants can run at all."

RESTAURANT STRESS TEST: The most demanding environment for POS connectivity:
- Peak dinner rush, maximum device activity
- Outdoor patios with Wi-Fi dead zones
- Dense Bluetooth peripherals (printers, scanners, payment readers)
- Servers constantly moving between coverage zones

YOUR TASK:
1. Evaluate EACH patent against ALL questions below
2. RANK all patents from best to worst POS licensing potential
3. Identify TOP 2-3 candidates that should advance
4. Look for "DARK HORSE" candidates with non-obvious strategic value
5. Provide TEXT REASONING that will be carried forward to Round 2

Patents in this cluster:
<<cluster.patentData>>

Be discriminating - only the best 20-30% should advance.`,
      questions: ROUND_1_QUESTIONS,
      contextFields: ['patent_id', 'patent_title', 'abstract', 'cpc_codes', 'summary', 'technology_category', 'technical_solution', 'claim_type_primary', 'market_relevance_score'],
      llmModel: 'claude-sonnet-4-20250514',
      delimiterStart: '<<',
      delimiterEnd: '>>',
      status: 'DRAFT',
    },
    create: {
      id: 'tmpl_pos_round1_eval',
      name: 'POS Tournament - Round 1 Evaluation',
      description: 'Broad screening with COMPARATIVE RANKING. Full question coverage across connectivity, POS fit, litigation readiness, and strategy. Identifies top 2-3 from each cluster to advance. Looks for dark horse candidates.',
      templateType: 'STRUCTURED',
      objectType: 'patent',
      executionMode: 'COLLECTIVE',
      promptText: `You are a patent licensing analyst evaluating a cluster of patents for Point-of-Sale (POS) system licensing potential.

CRITICAL: You must RANK all patents in this cluster from best to worst. This is a COMPARATIVE analysis - don't just score each patent independently, compare them to each other.

TARGET TECHNOLOGY: Connectivity and device-control layer of mobile POS systems:
- Cellular/Wi-Fi/Bluetooth radio coexistence
- Device communication reliability and handoff
- Operational uptime (PREVENTING failure, not adding features)
- Applicable to handheld payment terminals (Toast, Square, Clover, Verifone, etc.)

KEY LITIGATION FRAME: "These patents don't claim how restaurants run; they claim how mobile POS devices stay connected so restaurants can run at all."

RESTAURANT STRESS TEST: The most demanding environment for POS connectivity:
- Peak dinner rush, maximum device activity
- Outdoor patios with Wi-Fi dead zones
- Dense Bluetooth peripherals (printers, scanners, payment readers)
- Servers constantly moving between coverage zones

YOUR TASK:
1. Evaluate EACH patent against ALL questions below
2. RANK all patents from best to worst POS licensing potential
3. Identify TOP 2-3 candidates that should advance
4. Look for "DARK HORSE" candidates with non-obvious strategic value
5. Provide TEXT REASONING that will be carried forward to Round 2

Patents in this cluster:
<<cluster.patentData>>

Be discriminating - only the best 20-30% should advance.`,
      questions: ROUND_1_QUESTIONS,
      contextFields: ['patent_id', 'patent_title', 'abstract', 'cpc_codes', 'summary', 'technology_category', 'technical_solution', 'claim_type_primary', 'market_relevance_score'],
      llmModel: 'claude-sonnet-4-20250514',
      delimiterStart: '<<',
      delimiterEnd: '>>',
      status: 'DRAFT',
    },
  });

  console.log(`  Created: ${round1Template.name} (${round1Template.id})`);
  console.log(`           ${ROUND_1_QUESTIONS.length} structured questions`);

  // ─────────────────────────────────────────────────────────────────────────
  // Template 2: Round 2 - Deeper Analysis with Context
  // ─────────────────────────────────────────────────────────────────────────

  const round2Template = await prisma.promptTemplate.upsert({
    where: { id: 'tmpl_pos_round2_eval' },
    update: {
      name: 'POS Tournament - Round 2 Evaluation',
      description: 'Deeper analysis of Round 1 survivors with carried context. Harder questions on detectability, validity, defendant sequencing. Re-ranks within new clusters. Top 25-30% advance to final synthesis.',
      templateType: 'STRUCTURED',
      objectType: 'patent',
      executionMode: 'COLLECTIVE',
      promptText: `You are conducting ROUND 2 analysis of patents that passed Round 1 POS screening.

CRITICAL: These patents already passed initial screening. Your job is to:
1. VALIDATE or REVISE the Round 1 assessments
2. Apply HARDER questions (detectability, validity, defendant sequencing)
3. RE-RANK within this cluster - compare these pre-screened candidates
4. Select TOP 2-3 for final synthesis

CONTEXT FROM ROUND 1: Each patent includes its Round 1 assessment:
- key_strength: Why it was promoted
- key_weakness: Known concerns
- dark_horse_potential: Non-obvious value

DEEPER QUESTIONS THIS ROUND:
- How DETECTABLE is infringement? (Can we prove it without source code?)
- Any VALIDITY concerns? (Prior art, prosecution history)
- Which DEFENDANT TYPE should we target first with this patent?
- Is this patent READY for assertion or needs more work?

Patents in this cluster (with Round 1 context):
<<cluster.patentData>>

Round 1 assessments for reference:
<<cluster.round1Results>>

Be MORE DISCRIMINATING than Round 1. Only the best 25-30% advance to final synthesis.`,
      questions: ROUND_2_QUESTIONS,
      contextFields: ['patent_id', 'patent_title', 'abstract', 'cpc_codes', 'summary', 'technology_category', 'technical_solution', 'claim_type_primary', 'market_relevance_score', 'round1_key_strength', 'round1_key_weakness', 'round1_dark_horse_potential', 'round1_overall_pos_potential'],
      llmModel: 'claude-sonnet-4-20250514',
      delimiterStart: '<<',
      delimiterEnd: '>>',
      status: 'DRAFT',
    },
    create: {
      id: 'tmpl_pos_round2_eval',
      name: 'POS Tournament - Round 2 Evaluation',
      description: 'Deeper analysis of Round 1 survivors with carried context. Harder questions on detectability, validity, defendant sequencing. Re-ranks within new clusters. Top 25-30% advance to final synthesis.',
      templateType: 'STRUCTURED',
      objectType: 'patent',
      executionMode: 'COLLECTIVE',
      promptText: `You are conducting ROUND 2 analysis of patents that passed Round 1 POS screening.

CRITICAL: These patents already passed initial screening. Your job is to:
1. VALIDATE or REVISE the Round 1 assessments
2. Apply HARDER questions (detectability, validity, defendant sequencing)
3. RE-RANK within this cluster - compare these pre-screened candidates
4. Select TOP 2-3 for final synthesis

CONTEXT FROM ROUND 1: Each patent includes its Round 1 assessment:
- key_strength: Why it was promoted
- key_weakness: Known concerns
- dark_horse_potential: Non-obvious value

DEEPER QUESTIONS THIS ROUND:
- How DETECTABLE is infringement? (Can we prove it without source code?)
- Any VALIDITY concerns? (Prior art, prosecution history)
- Which DEFENDANT TYPE should we target first with this patent?
- Is this patent READY for assertion or needs more work?

Patents in this cluster (with Round 1 context):
<<cluster.patentData>>

Round 1 assessments for reference:
<<cluster.round1Results>>

Be MORE DISCRIMINATING than Round 1. Only the best 25-30% advance to final synthesis.`,
      questions: ROUND_2_QUESTIONS,
      contextFields: ['patent_id', 'patent_title', 'abstract', 'cpc_codes', 'summary', 'technology_category', 'technical_solution', 'claim_type_primary', 'market_relevance_score', 'round1_key_strength', 'round1_key_weakness', 'round1_dark_horse_potential', 'round1_overall_pos_potential'],
      llmModel: 'claude-sonnet-4-20250514',
      delimiterStart: '<<',
      delimiterEnd: '>>',
      status: 'DRAFT',
    },
  });

  console.log(`  Created: ${round2Template.name} (${round2Template.id})`);
  console.log(`           ${ROUND_2_QUESTIONS.length} structured questions`);

  // ─────────────────────────────────────────────────────────────────────────
  // Template 3: Final Synthesis - Strategic Campaign Planning
  // ─────────────────────────────────────────────────────────────────────────

  const finalTemplate = await prisma.promptTemplate.upsert({
    where: { id: 'tmpl_pos_final_synthesis' },
    update: {
      name: 'POS Tournament - Final Synthesis',
      description: 'Final strategic synthesis of tournament finalists. Produces tiered patent recommendations (Tier 1/2/3), jury narrative, defendant prioritization, risk assessment, and executive summary for litigation planning.',
      templateType: 'STRUCTURED',
      objectType: 'patent',
      executionMode: 'COLLECTIVE',
      promptText: `You are producing the FINAL SYNTHESIS for a POS patent licensing campaign.

These patents have survived TWO ROUNDS of tournament evaluation. They represent the top candidates from an initial pool. Your task is STRATEGIC CAMPAIGN PLANNING.

KEY LITIGATION FRAME:
"These patents do not claim how restaurants run; they claim how mobile POS devices stay connected so restaurants can run at all."

WINNING NARRATIVE ELEMENTS:
- LIABILITY focuses on device behavior (LTE idle intervals, WLAN bursts, BT arbitration)
- DAMAGES focuses on avoided downtime, avoided payment failure, expanded service footprint
- INDUSTRY SCOPE is broad (all POS and payments), with restaurants as intuitive proof point

YOUR DELIVERABLES:
1. TIERED CLASSIFICATION: Tier 1 (lead assertions), Tier 2 (supporting), Tier 3 (conditional)
2. PORTFOLIO STRENGTH ratings across dimensions
3. STRATEGIC RECOMMENDATIONS: lead patents, defendant sequence, jury narrative
4. GAP ANALYSIS: what's not covered
5. RISK ASSESSMENT: key risks and mitigations
6. EXECUTIVE SUMMARY: for senior leadership

Tournament finalists with Round 1 and Round 2 context:
<<finalists.patentData>>

Round 1 assessments:
<<finalists.round1Results>>

Round 2 assessments:
<<finalists.round2Results>>

Produce a comprehensive strategic report suitable for litigation planning.`,
      questions: FINAL_SYNTHESIS_QUESTIONS,
      contextFields: ['patent_id', 'patent_title', 'abstract', 'cpc_codes', 'summary', 'technology_category', 'technical_solution', 'claim_type_primary', 'round1_overall_pos_potential', 'round1_key_strength', 'round1_key_weakness', 'round2_overall_pos_potential', 'round2_key_strength_refined', 'round2_litigation_readiness'],
      llmModel: 'claude-sonnet-4-20250514',
      delimiterStart: '<<',
      delimiterEnd: '>>',
      status: 'DRAFT',
    },
    create: {
      id: 'tmpl_pos_final_synthesis',
      name: 'POS Tournament - Final Synthesis',
      description: 'Final strategic synthesis of tournament finalists. Produces tiered patent recommendations (Tier 1/2/3), jury narrative, defendant prioritization, risk assessment, and executive summary for litigation planning.',
      templateType: 'STRUCTURED',
      objectType: 'patent',
      executionMode: 'COLLECTIVE',
      promptText: `You are producing the FINAL SYNTHESIS for a POS patent licensing campaign.

These patents have survived TWO ROUNDS of tournament evaluation. They represent the top candidates from an initial pool. Your task is STRATEGIC CAMPAIGN PLANNING.

KEY LITIGATION FRAME:
"These patents do not claim how restaurants run; they claim how mobile POS devices stay connected so restaurants can run at all."

WINNING NARRATIVE ELEMENTS:
- LIABILITY focuses on device behavior (LTE idle intervals, WLAN bursts, BT arbitration)
- DAMAGES focuses on avoided downtime, avoided payment failure, expanded service footprint
- INDUSTRY SCOPE is broad (all POS and payments), with restaurants as intuitive proof point

YOUR DELIVERABLES:
1. TIERED CLASSIFICATION: Tier 1 (lead assertions), Tier 2 (supporting), Tier 3 (conditional)
2. PORTFOLIO STRENGTH ratings across dimensions
3. STRATEGIC RECOMMENDATIONS: lead patents, defendant sequence, jury narrative
4. GAP ANALYSIS: what's not covered
5. RISK ASSESSMENT: key risks and mitigations
6. EXECUTIVE SUMMARY: for senior leadership

Tournament finalists with Round 1 and Round 2 context:
<<finalists.patentData>>

Round 1 assessments:
<<finalists.round1Results>>

Round 2 assessments:
<<finalists.round2Results>>

Produce a comprehensive strategic report suitable for litigation planning.`,
      questions: FINAL_SYNTHESIS_QUESTIONS,
      contextFields: ['patent_id', 'patent_title', 'abstract', 'cpc_codes', 'summary', 'technology_category', 'technical_solution', 'claim_type_primary', 'round1_overall_pos_potential', 'round1_key_strength', 'round1_key_weakness', 'round2_overall_pos_potential', 'round2_key_strength_refined', 'round2_litigation_readiness'],
      llmModel: 'claude-sonnet-4-20250514',
      delimiterStart: '<<',
      delimiterEnd: '>>',
      status: 'DRAFT',
    },
  });

  console.log(`  Created: ${finalTemplate.name} (${finalTemplate.id})`);
  console.log(`           ${FINAL_SYNTHESIS_QUESTIONS.length} structured questions`);

  // Summary
  const total = await prisma.promptTemplate.count();
  const structured = await prisma.promptTemplate.count({ where: { templateType: 'STRUCTURED' } });
  const posTemplates = await prisma.promptTemplate.count({ where: { id: { startsWith: 'tmpl_pos' } } });

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`SUMMARY`);
  console.log(`${'═'.repeat(60)}`);
  console.log(`Total prompt templates: ${total}`);
  console.log(`Structured templates: ${structured}`);
  console.log(`POS Tournament templates: ${posTemplates}`);
  console.log(`\nPOS Tournament Structure:`);
  console.log(`  Round 1: ${round1Template.id}`);
  console.log(`           ${ROUND_1_QUESTIONS.length} questions (broad screening, comparative ranking)`);
  console.log(`  Round 2: ${round2Template.id}`);
  console.log(`           ${ROUND_2_QUESTIONS.length} questions (deeper analysis, carried context)`);
  console.log(`  Final:   ${finalTemplate.id}`);
  console.log(`           ${FINAL_SYNTHESIS_QUESTIONS.length} questions (strategic synthesis)`);
  console.log(`\nTotal questions per patent through tournament:`);
  console.log(`  Round 1: ${ROUND_1_QUESTIONS.length}`);
  console.log(`  Round 2: ${ROUND_2_QUESTIONS.length} (if advances)`);
  console.log(`  Final:   ${FINAL_SYNTHESIS_QUESTIONS.length} (if advances)`);
}

main()
  .then(() => {
    console.log('\nDone.');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Error seeding POS tournament templates:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
