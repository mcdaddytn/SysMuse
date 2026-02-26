# Sector Tournament Scoring Design

## Overview

A framework for sector-specific patent scoring using tournament-style LLM enrichment with interactive weight learning. This system enables:

1. **Within-sector rankings** using sector-tuned questions and weights
2. **Cross-sector normalization** for portfolio-wide comparisons
3. **Interactive tournaments** where users can correct rankings and the system learns optimal weights
4. **Incremental refinement** starting with default formulas, improving per-sector over time

---

## Architecture

### Three-Layer Scoring Model

```
┌─────────────────────────────────────────────────────────────────┐
│                    PORTFOLIO-LEVEL SCORE                        │
│  Combines: base metrics + normalized sector scores + LLM scores │
└─────────────────────────────────────────────────────────────────┘
                              ↑
                    (cross-sector normalization)
                              ↑
┌─────────────────────────────────────────────────────────────────┐
│                   SECTOR-LEVEL SCORE                            │
│  Per-sector ranking using sector-specific questions + weights   │
│  Produces relative ranking within sector (0-100 percentile)     │
└─────────────────────────────────────────────────────────────────┘
                              ↑
                    (tournament refinement)
                              ↑
┌─────────────────────────────────────────────────────────────────┐
│                   COMPONENT SCORES                              │
│  Base metrics (citations, years) + LLM facets (V3 analysis)     │
│  + Sector-specific LLM questions (new)                          │
└─────────────────────────────────────────────────────────────────┘
```

---

## Sector-Specific Questions Framework

### Philosophy

Each super-sector defines a **consistent framework** of question categories, but with **sector-specific instantiation**:

| Question Category | Purpose | Example (Video Codec) | Example (Security) |
|-------------------|---------|----------------------|-------------------|
| **Market Position** | Who would pay for this? | "Streaming platforms, device OEMs, or chip vendors?" | "Enterprises, consumers, or government?" |
| **Implementation Barrier** | How hard to work around? | "Alternative codec standards available?" | "Fundamental crypto primitive or wrapper?" |
| **Detection Visibility** | Can we find infringers? | "Visible in encoded bitstream?" | "Observable in network traffic?" |
| **Standards Alignment** | SEP/FRAND potential? | "Required for H.265/AV1 compliance?" | "Required for TLS/OAuth compliance?" |
| **Competitive Moat** | Duration of advantage? | "Years until next-gen codec obsoletes?" | "Threat landscape evolution rate?" |

### Question Structure

```typescript
interface SectorQuestion {
  id: string;                    // e.g., "market_position"
  category: QuestionCategory;    // One of 5 standard categories
  prompt: string;                // Sector-specific wording
  responseType: 'scale_1_5' | 'enum' | 'boolean';
  enumOptions?: string[];        // For enum type
  weight: number;                // Default weight (0-1, sums to 1)
  description: string;           // Explains what this measures
}

interface SectorScoringConfig {
  sectorId: string;
  superSectorId: string;
  questions: SectorQuestion[];
  baseMetricWeights: {
    forwardCitations: number;
    competitorCitations: number;
    remainingYears: number;
    claimBreadth: number;        // From V3 LLM
    validityScore: number;       // From V3 LLM
  };
  version: number;
  lastUpdated: string;
}
```

---

## Tournament System

### Tournament Flow

```
┌──────────────────────────────────────────────────────────────────┐
│ ROUND 0: Initial Scoring                                         │
│ - Apply sector questions via LLM to all patents in sector        │
│ - Calculate initial sector score using default weights           │
│ - Rank patents 1..N                                              │
└──────────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────────┐
│ ROUND 1: Bracket Formation                                       │
│ - Divide into brackets (16-32 patents each)                      │
│ - Mix high/medium/low ranked patents per bracket                 │
│ - Present brackets to user for review                            │
└──────────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────────┐
│ USER INTERVENTION (Optional)                                     │
│ - View bracket rankings                                          │
│ - Drag to reorder based on intuition                            │
│ - Adjust weights manually per bracket                            │
│ - Or approve and continue                                        │
└──────────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────────┐
│ WEIGHT OPTIMIZATION                                              │
│ - If user reordered: fit weights to minimize ranking error       │
│ - Constrained optimization: weights ∈ [0,1], sum = 1             │
│ - Apply learned weights to subsequent rounds                     │
└──────────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────────┐
│ ROUNDS 2..N: Progressive Elimination                             │
│ - Advance top K from each bracket                                │
│ - Re-bracket survivors                                           │
│ - User can intervene at any round                                │
│ - Final round produces sector Top 10/20                          │
└──────────────────────────────────────────────────────────────────┘
```

### Weight Learning Algorithm

When user reorders patents in a bracket:

```typescript
interface BracketCorrection {
  bracketId: string;
  originalOrder: string[];     // Patent IDs in computed order
  userOrder: string[];         // Patent IDs after user drag-drop
  patentScores: Map<string, ComponentScores>;
}

// Optimization objective:
// Find weights W that minimize:
//   Σ |rank(p, W) - userRank(p)|²
// Subject to:
//   Σ W_i = 1
//   W_i ≥ 0

function optimizeWeights(correction: BracketCorrection): SectorWeights {
  // Use constrained least squares or gradient descent
  // to find weights that best reproduce user ordering
}
```

---

## Score Calculation (Facet-Based)

### Why Facet Calcs Instead of LLM

1. **Transparency**: Users can see exactly how score is computed
2. **Speed**: No LLM latency for re-scoring after weight changes
3. **Iteration**: Can adjust weights interactively without re-running LLM
4. **Audit**: Scores are reproducible and explainable

### Sector Score Formula

```typescript
function calculateSectorScore(
  patent: Patent,
  config: SectorScoringConfig,
  llmResponses: SectorLLMResponses
): number {
  let score = 0;

  // Base metrics (normalized 0-1)
  const baseWeights = config.baseMetricWeights;
  score += normalize(patent.forward_citations, 0, 500) * baseWeights.forwardCitations;
  score += normalize(patent.competitor_citations, 0, 100) * baseWeights.competitorCitations;
  score += normalize(patent.remaining_years, 0, 20) * baseWeights.remainingYears;
  score += (patent.claim_breadth || 3) / 5 * baseWeights.claimBreadth;
  score += (patent.validity_score || 3) / 5 * baseWeights.validityScore;

  // Sector-specific questions (already 1-5 scale from LLM)
  for (const question of config.questions) {
    const response = llmResponses[question.id];
    const normalized = (response - 1) / 4;  // Convert 1-5 to 0-1
    score += normalized * question.weight;
  }

  return score * 100;  // Scale to 0-100
}
```

---

## Database Schema Extensions

```prisma
model SectorScoringConfig {
  id            String   @id @default(cuid())
  sectorId      String   @unique
  sector        Sector   @relation(fields: [sectorId], references: [id])

  questions     Json     // SectorQuestion[]
  baseWeights   Json     // BaseMetricWeights

  version       Int      @default(1)
  isDefault     Boolean  @default(true)  // Using super-sector defaults

  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
}

model SectorTournament {
  id            String   @id @default(cuid())
  sectorId      String
  sector        Sector   @relation(fields: [sectorId], references: [id])

  status        TournamentStatus  // SETUP, ROUND_N, AWAITING_REVIEW, COMPLETE
  currentRound  Int      @default(0)

  brackets      Json     // Bracket[] with patent IDs and rankings
  corrections   Json     // BracketCorrection[] from user interventions
  learnedWeights Json?   // Optimized weights after corrections

  results       Json?    // Final rankings

  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
}

model PatentSectorScore {
  id            String   @id @default(cuid())
  patentId      String
  sectorId      String

  componentScores Json   // Individual question/metric scores
  totalScore    Float
  percentileRank Float   // 0-100 within sector

  tournamentId  String?  // If scored during tournament

  createdAt     DateTime @default(now())

  @@unique([patentId, sectorId])
  @@index([sectorId, totalScore])
}
```

---

## UI Components

### Tournament Management Page

```
┌─────────────────────────────────────────────────────────────────────┐
│ Sector Tournament: video-codec                    [Pause] [Reset]  │
├─────────────────────────────────────────────────────────────────────┤
│ Round 2 of 4 | 64 patents remaining | 4 brackets                   │
│ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░ 50%                              │
├───────────────────┬─────────────────────────────────────────────────┤
│ Brackets          │  Bracket A (16 patents)         [Auto-Advance] │
│                   │  ────────────────────────────────────────────── │
│ ▶ Bracket A       │  Drag to reorder:                              │
│   Bracket B       │  ┌─────────────────────────────────────────┐   │
│   Bracket C       │  │ 1. US10234567 - Video codec optimization│ ▲ │
│   Bracket D       │  │    Score: 78.3 | Cites: 45 | Years: 12  │ │ │
│                   │  │ 2. US10345678 - Frame prediction method │   │
│ Weight Adjustments│  │    Score: 76.1 | Cites: 38 | Years: 14  │   │
│ ───────────────── │  │ 3. US10456789 - Entropy coding system   │   │
│ Market: ████░ 0.25│  │    Score: 74.8 | Cites: 52 | Years: 10  │   │
│ Barrier:███░░ 0.20│  │ ...                                     │ ▼ │
│ Detect: ██░░░ 0.15│  └─────────────────────────────────────────┘   │
│ Standards:████ 0.25│                                                │
│ Moat:   ███░░ 0.15│  [Apply Corrections] [Skip to Next Round]      │
└───────────────────┴─────────────────────────────────────────────────┘
```

### Sector Scoring Config Editor

```
┌─────────────────────────────────────────────────────────────────────┐
│ Sector Scoring: video-codec                      [Save] [Reset]    │
├─────────────────────────────────────────────────────────────────────┤
│ Base Metrics                    │ Sector Questions                  │
│ ─────────────────────────────── │ ───────────────────────────────── │
│ Forward Citations    ████░ 0.15 │ ▼ Market Position         ████░   │
│ Competitor Citations ███░░ 0.10 │   "Who would license this codec?" │
│ Remaining Years      ██░░░ 0.10 │   Options: Streaming, OEM, Chip   │
│ Claim Breadth (V3)   ███░░ 0.10 │                                   │
│ Validity Score (V3)  ██░░░ 0.05 │ ▼ Implementation Barrier  ███░░   │
│                                 │   "Alternative standards exist?"  │
│ [Copy from Super-Sector]        │                                   │
│ [Import from Focus Area]        │ ▼ Detection Visibility    ██░░░   │
│                                 │   "Visible in bitstream?"         │
│                                 │                                   │
│                                 │ [+ Add Question]                  │
└─────────────────────────────────┴───────────────────────────────────┘
```

---

## Implementation Phases

### Phase 6A: Schema + Default Configs (Foundation)

1. Add `SectorScoringConfig`, `SectorTournament`, `PatentSectorScore` models
2. Create default question sets for each super-sector
3. Seed default configs for all sectors (inheriting from super-sector)
4. API: CRUD for sector scoring configs

### Phase 6B: Sector LLM Questions (Enrichment)

1. Create prompt templates for sector-specific questions
2. Extend `run-llm-top-patents.ts` to include sector questions
3. Store sector question responses in `PatentSectorScore.componentScores`
4. Compute initial sector scores using default weights

### Phase 6C: Tournament Engine (Core)

1. Tournament planning: bracket formation, round management
2. Score calculation service (facet-based, no LLM)
3. API endpoints for tournament CRUD and round advancement
4. Background job for auto-advancing unattended tournaments

### Phase 6D: Weight Learning (Intelligence)

1. Implement constrained optimization for weight fitting
2. Store learned weights per tournament/sector
3. Option to promote learned weights to sector default
4. A/B comparison: default vs. learned weights

### Phase 6E: Tournament UI (Interactive)

1. Tournament management page (status, brackets, progress)
2. Drag-drop bracket reordering
3. Weight slider adjustments
4. Round review and approval workflow
5. Results visualization and export

### Phase 6F: Cross-Sector Normalization

1. Percentile ranking within sectors
2. Sector value coefficients (relative worth of sectors)
3. Combined portfolio score incorporating sector rankings
4. Dashboard showing cross-sector comparisons

---

## Default Super-Sector Questions

### Security
- **Market Position**: Enterprise vs. consumer vs. government focus?
- **Implementation Barrier**: Fundamental cryptographic primitive or implementation detail?
- **Detection Visibility**: Observable in network traffic or requires source code?
- **Standards Alignment**: Required for NIST/ISO security standards compliance?
- **Competitive Moat**: Threat landscape evolution rate affecting relevance?

### Video & Streaming
- **Market Position**: Streaming platforms, device OEMs, or silicon vendors?
- **Implementation Barrier**: Codec-agnostic or format-specific?
- **Detection Visibility**: Visible in encoded bitstream headers?
- **Standards Alignment**: Required for H.265/AV1/VVC compliance?
- **Competitive Moat**: Years until next-gen codec obsoletes this?

### SDN & Network Infrastructure
- **Market Position**: Cloud providers, telcos, or enterprise IT?
- **Implementation Barrier**: Protocol-level or configuration optimization?
- **Detection Visibility**: Observable via network probes or requires controller access?
- **Standards Alignment**: Required for OpenFlow/EVPN/VXLAN compliance?
- **Competitive Moat**: Data center refresh cycle alignment?

### Virtualization & Cloud
- **Market Position**: Hyperscalers, enterprise private cloud, or edge?
- **Implementation Barrier**: Hypervisor-level or guest OS feature?
- **Detection Visibility**: Observable via cloud APIs or requires internal access?
- **Standards Alignment**: Required for OCI/Kubernetes conformance?
- **Competitive Moat**: Multi-cloud portability affecting lock-in value?

### Semiconductor
- **Market Position**: Foundry, fabless design, or EDA tools?
- **Implementation Barrier**: Process-dependent or architecture-level?
- **Detection Visibility**: Requires die analysis or documented in datasheets?
- **Standards Alignment**: Required for industry standard interfaces (PCIe, DDR)?
- **Competitive Moat**: Process node lifecycle and Moore's Law trajectory?

---

## Success Metrics

1. **Ranking Quality**: Correlation between tournament winners and actual licensing deals
2. **Weight Convergence**: Learned weights stabilize across tournaments
3. **User Efficiency**: Fewer corrections needed as system learns
4. **Cross-Sector Validity**: Normalized scores predict deal value across sectors

---

## Dependencies

- Phase 5 (Sector Management) - Complete
- Workflow Engine - Complete
- V3 LLM Analysis - Complete
- Focus Area system - For config inheritance

---

## Open Questions

1. Should sector questions be run during initial LLM enrichment or as separate pass?
2. How to handle patents in multiple sectors (primary vs. secondary)?
3. Minimum patents per sector to run meaningful tournament?
4. How often to re-run tournaments as new patents are added?
