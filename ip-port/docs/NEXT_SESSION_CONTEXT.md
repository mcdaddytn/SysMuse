# Patent Portfolio Analysis - Session Context (2026-02-06, Session 15+)

## Current State Summary

### Portfolio Data

| Metric | Value |
|--------|-------|
| **Unique Patents** | **28,913** |
| Active Patents | 24,668 (85.3%) |
| Active (3+ years) | 21,870 |
| Expired Patents | 4,245 |
| Date Range | 1982-06-29 to 2025-09-30 |
| Status | Complete + Deduplicated |

### Taxonomy Structure (Session 15)

| Level | Count | Description |
|-------|-------|-------------|
| **Super-Sectors** | 11 | VIDEO_STREAMING, AI_ML, IMAGING, NETWORKING, COMPUTING, STORAGE, WIRELESS, MEDIA, SEMICONDUCTOR, INTERFACE, SECURITY |
| **Sectors** | 53 | Primary categorization (e.g., video-codec, video-streaming, ai-inference) |
| **Sub-Sectors** | 31,025 | Fine-grained categorization |
| **Patents Assigned** | 29,474 | Patents with sector assignments |

### Enrichment Coverage

| Data Source | Count | Coverage | Notes |
|-------------|-------|----------|-------|
| **LLM total** | **8,269** | 38% | Cached analyses |
| **IPR risk scores** | **5,000** | 23% | Target reached |
| **Prosecution scores** | **4,052** | 19% | From Session 13 |
| **Citation classification** | 28,913 | 100% | Complete |
| **Abstracts (PatentsView)** | 28,869 | 99.8% | For LLM scoring |

---

## Active Jobs (Session 15)

### Video-Codec Sector LLM Scoring — IN PROGRESS

| Parameter | Value |
|-----------|-------|
| **Sector** | video-codec |
| **Total Patents** | 376 |
| **Abstract Coverage** | 373/376 (99%) |
| **Start Time** | ~08:21 CST, 2026-02-06 |
| **Estimated Duration** | ~2 hours |
| **Concurrency** | 2 |
| **Progress** | ~218/376 (58%) as of last check |

**Monitor Progress:**
```bash
# Check server output
tail -f /var/folders/qk/n6vwrmqs1qn4l05tlzdy68l00000gn/T/claude/-Users-gmcaveney-Documents-dev-SysMuse-ip-port/tasks/b8a2a17.output

# Check result file when complete
cat /tmp/video-codec-scoring-result.json
```

**Why This Job:**
- First production test of LLM scoring system
- video-codec has manageable size (376 patents) for ~2hr batch
- Will validate scoring pipeline, template inheritance, score normalization

---

## Changes Completed This Session (Session 15)

### 1. Scoring Template System — JSON Config Files

**Goal:** Extract all scoring templates from code into version-controlled JSON files for independent maintenance and revision tracking.

#### Config File Structure

```
config/scoring-templates/
├── scoring-template.schema.json    # JSON Schema for validation
├── portfolio-default.json          # Base template (7 questions)
└── super-sectors/
    ├── video-streaming.json        # 4 additional questions
    ├── ai-ml.json                  # 4 additional questions
    ├── imaging.json                # 4 additional questions
    ├── networking.json             # 3 additional questions
    ├── computing.json              # 4 additional questions
    ├── storage.json                # 3 additional questions
    ├── wireless.json               # 4 additional questions
    ├── media.json                  # 4 additional questions
    ├── semiconductor.json          # 4 additional questions
    ├── interface.json              # 3 additional questions
    └── security.json               # 4 additional questions
```

#### Template Inheritance Model

```
Portfolio Default (7 questions, weight = 1.0)
    └── Super-Sector Template (adds 3-4 questions)
        └── Sector Template (can override/add)
            └── Sub-Sector Template (can override/add)
```

Questions inherit by `fieldName` — child templates can override parent questions or add new ones.

#### Base Questions (portfolio-default.json)

| Field Name | Display Name | Weight |
|------------|--------------|--------|
| `technical_merit` | Technical Merit | 0.15 |
| `novelty` | Novelty & Non-Obviousness | 0.15 |
| `claim_breadth` | Claim Breadth | 0.15 |
| `market_relevance` | Market Relevance | 0.15 |
| `enforceability` | Enforceability | 0.10 |
| `defensive_value` | Defensive Value | 0.10 |
| `unique_value` | Unique/Hidden Value | 0.10 |

**Unique Value Question (Dark Horse):**
Captures hidden/overlooked value not covered by standard metrics — e.g., potential applications in emerging fields, strategic blocking potential, competitive moat value. This question requires reasoning to identify non-obvious value.

### 2. LLM Scoring Service

**File:** `src/api/services/llm-scoring-service.ts` (NEW)

#### Architecture

```
Patent Data → Enrichment → Prompt Builder → Claude API → Response Parser → Score Storage
    ↓              ↓            ↓              ↓              ↓              ↓
 candidates   + abstract    questions      API call      JSON parse     prisma
   JSON       + LLM data    from config    structured    scores +       PatentScore
                                            response     reasoning       table
```

#### Key Functions

| Function | Purpose |
|----------|---------|
| `enrichPatentData()` | Load abstract from PatentsView cache, LLM data from llm-scores cache |
| `enrichPatentBatch()` | Batch enrichment with file I/O |
| `buildScoringPrompt()` | Construct prompt from template questions |
| `scorePatent()` | Score single patent via Claude API |
| `scorePatentBatch()` | Score batch with concurrency control |
| `scoreSubSector()` | Score all unscored patents in sub-sector |
| `scoreSector()` | Score all unscored patents in sector (used for video-codec) |

#### Patent Data Enrichment

Patents are enriched from file caches (not database):
- **Abstract:** `cache/api/patentsview/patent/{patentId}.json` → `patent.patent_abstract`
- **LLM Data:** `cache/llm-scores/{patentId}.json` → `detailed_tech_summary`, `key_technical_features`

#### Score Output Structure

```typescript
interface ScoringResult {
  patentId: string;
  compositeScore: number;       // Weighted average (0-10)
  metrics: {
    [fieldName: string]: {
      score: number;            // 1-10 scale
      reasoning: string;        // LLM explanation
      confidence: number;       // 0-1
    }
  };
  templateId: string;
  timestamp: Date;
}
```

### 3. API Routes Updates

**File:** `src/api/routes/scoring-templates.routes.ts`

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/scoring-templates/config` | GET | List all JSON config files |
| `/api/scoring-templates/config/merged/:superSectorName` | GET | Get merged questions for super-sector |
| `/api/scoring-templates/sync` | POST | Sync database from JSON configs |
| `/api/scoring-templates/llm/score-patent` | POST | Score single patent |
| `/api/scoring-templates/llm/score-sub-sector/:subSectorId` | POST | Batch score sub-sector |
| `/api/scoring-templates/llm/score-sector/:sectorName` | POST | Batch score sector |
| `/api/scoring-templates/llm/sector-preview/:sectorName` | GET | Preview patents for scoring |
| `/api/scoring-templates/llm/preview/:subSectorId` | GET | Preview sub-sector patents |

**Route Ordering Fix:** Specific routes (`/config`, `/resolve`) moved before parameterized `/:id` route to prevent Express capture.

### 4. Bugs Fixed

| Issue | Root Cause | Fix |
|-------|------------|-----|
| `/config` returning 404 | Express `/:id` route capturing `/config` | Moved specific routes before parameterized routes |
| `candidates.filter is not a function` | Candidates file has `{candidates: [...]}` wrapper | Handle both array and object formats |
| Prisma Patent model undefined | Patents stored in JSON files, not DB | Rewrote enrichment to use file caches |
| Abstracts showing as "undefined" | Not loading from PatentsView cache | Added `loadAbstract()` from `cache/api/patentsview/` |

---

## Database Schema (Relevant Tables)

### PatentScore Table

Stores LLM scoring results:

```prisma
model PatentScore {
  id                String    @id @default(uuid())
  patentId          String    @unique
  templateId        String
  compositeScore    Float     // Weighted average
  normalizedScore   Float?    // Within sub-sector normalization
  subSectorRank     Int?      // Rank within sub-sector
  sectorRank        Int?      // Rank within sector
  rawScores         Json      // Individual metric scores
  reasoning         Json      // LLM reasoning per metric
  confidence        Float?    // Overall confidence
  scoredAt          DateTime
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt

  template          ScoringTemplate @relation(...)
}
```

### ScoringTemplate Table

```prisma
model ScoringTemplate {
  id            String    @id @default(uuid())
  name          String
  appliesTo     String    // "portfolio", "super_sector:VIDEO_STREAMING", etc.
  superSectorId String?
  sectorId      String?
  subSectorId   String?
  questions     Json      // Array of question definitions
  inheritsFrom  String?   // Parent template ID
  isActive      Boolean   @default(true)
  version       Int       @default(1)
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
}
```

---

## Quick Start for Next Session

```bash
# 1. Start infrastructure
docker compose up -d

# 2. Start backend
npm run api:dev

# 3. Check if video-codec scoring completed
curl http://localhost:3001/api/scoring-templates/scores/sub-sector/video-codec | jq '.stats'

# 4. Start frontend
cd frontend && npm run dev

# 5. Test scoring template config
curl http://localhost:3001/api/scoring-templates/config | jq '.summary'

# 6. Preview merged questions for a super-sector
curl http://localhost:3001/api/scoring-templates/config/merged/VIDEO_STREAMING | jq '.questionCount'
```

---

## Next Steps After video-codec Batch Completes

1. **Normalize Scores** — Run normalization to compute ranks within sub-sectors:
   ```bash
   curl -X POST http://localhost:3001/api/scoring-templates/scores/normalize/sector/video-codec
   ```

2. **Analyze Score Distribution** — Check composite score histogram, identify outliers

3. **Review Reasoning Quality** — Spot-check LLM reasoning for top/bottom scored patents

4. **Scale to More Sectors** — Once validated, run scoring on larger sectors (wireless, networking)

5. **Build Scoring UI** — Frontend components to view/compare patent scores

---

## Known Issues / TODO

### Immediate (Session 16)

- [ ] Verify video-codec scoring completion and results
- [ ] Normalize scores within sub-sectors
- [ ] Analyze score distribution and quality
- [ ] Consider adjusting question weights based on results

### Medium Priority

- [ ] Score additional sectors (wireless: ~3,323 patents, networking: similar)
- [ ] Build frontend scoring visualization
- [ ] Add sector-level score comparison views
- [ ] Implement score versioning (re-score with template changes)

### Design Backlog

- [ ] Multi-model scoring comparison (Claude vs other LLMs)
- [ ] Batch scoring queue management
- [ ] Cost tracking and estimation for LLM scoring
- [ ] Score calibration / human-in-the-loop validation

---

## File Reference

### New Files (Session 15)

| File | Purpose |
|------|---------|
| `config/scoring-templates/scoring-template.schema.json` | JSON Schema for template validation |
| `config/scoring-templates/portfolio-default.json` | Base template with 7 questions |
| `config/scoring-templates/super-sectors/*.json` | 11 super-sector templates |
| `src/api/services/llm-scoring-service.ts` | LLM scoring service |

### Modified Files (Session 15)

| File | Changes |
|------|---------|
| `src/api/services/scoring-template-service.ts` | Added JSON file loading, sync, merged questions |
| `src/api/routes/scoring-templates.routes.ts` | Added config, sync, LLM scoring endpoints; fixed route ordering |

---

*Last Updated: 2026-02-06 (Session 15 — Implemented scoring template system with JSON config files, template inheritance (portfolio → super-sector → sector → sub-sector), LLM scoring service with Claude API integration, patent data enrichment from file caches, and sector-level batch scoring. Currently running video-codec scoring batch (376 patents, ~58% complete).)*
