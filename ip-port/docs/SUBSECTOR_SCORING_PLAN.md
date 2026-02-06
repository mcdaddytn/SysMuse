# Sub-Sector Scoring & LLM Analysis Plan

## Overview

Create a hierarchical scoring system where patents are evaluated within sub-sectors using LLM-generated metrics with reasoning text. Scores normalize up the hierarchy (sub-sector → sector → super-sector) for meaningful cross-portfolio rankings.

## Core Concepts

### Template Inheritance
```
SuperSector (default questions/weights)
    └── Sector (can override/extend)
        └── SubSector (most specific, can override/extend)
```

### Metric Types
1. **Universal Metrics** - Applied to all patents (existing: forward_citations, remaining_years, etc.)
2. **Hierarchical Metrics** - Defined at super-sector level, can be overridden lower
3. **Sub-sector Specific** - Custom metrics for specific technology areas

### Scoring Model
```
Patent Score (within sub-sector) = Σ(weight_i × normalized_metric_i)

Where metrics include:
- LLM-generated scores (1-10 scale)
- LLM reasoning text (for validation)
- Calculated scores (citations, age, etc.)
```

---

## Phase 1: Foundation (Data Model & Basic Templates)

### 1.1 Extend Data Model

**New: ScoringTemplate table**
```prisma
model ScoringTemplate {
  id              String   @id @default(cuid())

  // Hierarchy binding (one of these set, or null for portfolio-wide default)
  superSectorId   String?  @map("super_sector_id")
  sectorId        String?  @map("sector_id")
  subSectorId     String?  @map("sub_sector_id")

  // Template content
  name            String
  description     String?

  // Questions that produce metrics
  questions       Json     // Array of ScoringQuestion

  // Inheritance
  inheritsFrom    String?  @map("inherits_from")  // Template ID to inherit from

  // Status
  isActive        Boolean  @default(true)
  version         Int      @default(1)

  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}

// ScoringQuestion structure (in JSON):
{
  fieldName: "technical_complexity",
  displayName: "Technical Complexity",
  question: "Rate the technical complexity of this patent's core innovation...",
  answerType: "numeric",  // numeric, categorical, text
  scale: { min: 1, max: 10 },
  weight: 0.15,  // Default weight in overall score
  requiresReasoning: true,
  reasoningPrompt: "Explain your rating..."
}
```

**New: PatentSubSectorScore table**
```prisma
model PatentSubSectorScore {
  id              String   @id @default(cuid())

  patentId        String   @map("patent_id")
  subSectorId     String   @map("sub_sector_id")

  // Individual metric scores (from LLM)
  metrics         Json     // { fieldName: { score: number, reasoning: string } }

  // Calculated composite score
  compositeScore  Float    @map("composite_score")

  // Rank within sub-sector
  rankInSubSector Int?     @map("rank_in_sub_sector")

  // Normalized scores for rollup
  normalizedScore Float?   @map("normalized_score")  // 0-100 percentile

  // Metadata
  templateId      String   @map("template_id")
  templateVersion Int      @map("template_version")

  executedAt      DateTime @map("executed_at")
  createdAt       DateTime @default(now())
}
```

### 1.2 Create Default Super-Sector Templates

Create initial templates for each super-sector with relevant questions:

**SECURITY Super-Sector Example:**
```json
{
  "name": "Security Patent Evaluation",
  "questions": [
    {
      "fieldName": "threat_coverage",
      "displayName": "Threat Coverage",
      "question": "How comprehensive is this patent's coverage of security threats? Consider attack vectors, defensive mechanisms, and breadth of protection.",
      "answerType": "numeric",
      "scale": { "min": 1, "max": 10 },
      "weight": 0.20,
      "requiresReasoning": true
    },
    {
      "fieldName": "implementation_difficulty",
      "displayName": "Implementation Difficulty",
      "question": "How difficult would it be to design around this patent's claims?",
      "answerType": "numeric",
      "scale": { "min": 1, "max": 10 },
      "weight": 0.15,
      "requiresReasoning": true
    },
    {
      "fieldName": "market_relevance",
      "displayName": "Market Relevance",
      "question": "How relevant is this security technology to current market needs and trends?",
      "answerType": "numeric",
      "scale": { "min": 1, "max": 10 },
      "weight": 0.20,
      "requiresReasoning": true
    }
  ]
}
```

### 1.3 Template Inheritance Service

```typescript
// Resolve effective template for a sub-sector
function resolveTemplate(subSectorId: string): ScoringTemplate {
  // 1. Check for sub-sector specific template
  // 2. Fall back to sector template
  // 3. Fall back to super-sector template
  // 4. Fall back to portfolio default
  // Merge inherited questions, allowing overrides
}
```

---

## Phase 2: LLM Execution Pipeline

### 2.1 Sub-Sector Scoring Job

Create a workflow that:
1. Takes a sub-sector ID
2. Resolves the effective template
3. For each patent in sub-sector:
   - Builds prompt with patent context + questions
   - Calls LLM
   - Parses structured response (scores + reasoning)
   - Stores in PatentSubSectorScore

### 2.2 Batch Processing

- Process sub-sectors in parallel (respecting rate limits)
- Progress tracking and resumability
- Cost estimation before run

### 2.3 Score Calculation

```typescript
function calculateCompositeScore(metrics: Record<string, MetricValue>, template: ScoringTemplate): number {
  let score = 0;
  let totalWeight = 0;

  for (const question of template.questions) {
    const metric = metrics[question.fieldName];
    if (metric && question.weight) {
      score += metric.score * question.weight;
      totalWeight += question.weight;
    }
  }

  return totalWeight > 0 ? score / totalWeight : 0;
}
```

---

## Phase 3: Normalization & Rollup

### 3.1 Within Sub-Sector Normalization

```typescript
// After scoring all patents in a sub-sector
function normalizeSubSectorScores(subSectorId: string) {
  const scores = await getScoresForSubSector(subSectorId);

  // Percentile ranking within sub-sector
  scores.sort((a, b) => b.compositeScore - a.compositeScore);

  for (let i = 0; i < scores.length; i++) {
    scores[i].rankInSubSector = i + 1;
    scores[i].normalizedScore = 100 * (1 - i / scores.length);
  }
}
```

### 3.2 Sector-Level Aggregation

```typescript
// Aggregate sub-sector scores to sector level
function aggregateSectorScores(sectorId: string) {
  const subSectors = await getSubSectorsForSector(sectorId);

  // Weight by sub-sector size or equal weight
  // Combine normalized scores
  // Produce sector-level patent rankings
}
```

### 3.3 Cross-Sector Comparison

- Normalized scores allow comparison across different sub-sectors
- "Top 10% in network-switching" comparable to "Top 10% in video-codec"

---

## Phase 4: UI Components

### 4.1 Patent Grid Enhancements

- Add `sub_sector` column (display name, tooltip with CPC)
- Add `sub_sector_rank` column
- Add `sub_sector_score` column

### 4.2 Sub-Sector Mapping View

```
Sector: network-switching (2,837 patents)
├── Sub-Sectors: 1,617
├── Size Distribution: [chart]
└── [Expand to see sub-sectors]
    ├── H04L12/4633 (54 patents) [View] [Edit Mapping]
    ├── H04L45/586_2023-2024 (50 patents) [View] [Edit Mapping]
    └── ...
```

### 4.3 Scoring Template Editor

- View/edit questions at each hierarchy level
- Visual inheritance indicator
- Weight sliders (future)

### 4.4 Reasoning Display

- Patent detail page shows metric reasoning
- Expandable sections for each LLM-generated field
- "Flag as inaccurate" for feedback

---

## Phase 5: Advanced Features (Future)

### 5.1 Weight Tuning UI
- Sliders for each metric weight
- Real-time score recalculation preview
- Save as template override

### 5.2 Template Versioning
- Track template changes
- Re-run scoring on template update
- Compare rankings across versions

### 5.3 Feedback Loop
- User corrections to LLM scores
- Track accuracy over time
- Fine-tune prompts based on feedback

---

## Implementation Order

### Sprint 1: Data Model & Basic Templates
1. [ ] Add ScoringTemplate to Prisma schema
2. [ ] Add PatentSubSectorScore to Prisma schema
3. [ ] Create template inheritance service
4. [ ] Seed default super-sector templates (8 templates)
5. [ ] API endpoints: CRUD for templates

### Sprint 2: LLM Execution
1. [ ] Create sub-sector scoring service
2. [ ] Build prompt from template + patent
3. [ ] Parse structured LLM response
4. [ ] Store scores with reasoning
5. [ ] Batch processing with progress

### Sprint 3: Normalization & Rollup
1. [ ] Within sub-sector normalization
2. [ ] Ranking calculation
3. [ ] Sector-level aggregation
4. [ ] API endpoints for scores

### Sprint 4: Basic UI
1. [ ] Sub-sector column in patent grid
2. [ ] Sub-sector score column
3. [ ] Sub-sector detail page
4. [ ] Reasoning text display

### Sprint 5: Template Management UI
1. [ ] Template list/view
2. [ ] Template editor
3. [ ] Inheritance visualization
4. [ ] Weight sliders (basic)

---

## API Endpoints

```
# Templates
GET    /api/scoring-templates
GET    /api/scoring-templates/:id
POST   /api/scoring-templates
PUT    /api/scoring-templates/:id
GET    /api/scoring-templates/resolve/:subSectorId  # Get effective template

# Scoring
POST   /api/sub-sectors/:id/score              # Run scoring for sub-sector
GET    /api/sub-sectors/:id/scores             # Get scores for sub-sector
GET    /api/patents/:id/sub-sector-scores      # Get scores for patent

# Batch
POST   /api/scoring/batch                      # Score multiple sub-sectors
GET    /api/scoring/batch/:jobId/status        # Check batch progress
```

---

## Naming Conventions

To avoid collision with existing metrics:

| Existing (Portfolio-wide) | Sub-Sector Specific |
|--------------------------|---------------------|
| `score` | `ss_composite_score` |
| `forward_citations` | (use existing) |
| `remaining_years` | (use existing) |
| N/A | `ss_technical_complexity` |
| N/A | `ss_market_relevance` |
| N/A | `ss_threat_coverage` |

Prefix sub-sector specific metrics with `ss_` to distinguish.

---

## Success Metrics

1. **Coverage**: All patents have sub-sector scores
2. **Differentiation**: Good spread of scores within sub-sectors
3. **Validation**: Users find reasoning text helpful
4. **Consistency**: Similar patents get similar scores
5. **Performance**: Scoring completes in reasonable time

---

## Open Questions

1. Should we score all 31K sub-sectors or start with largest/most important?
2. What's the LLM cost estimate for full portfolio scoring?
3. How often should scores be recalculated?
4. Should users be able to create custom questions per sub-sector?
