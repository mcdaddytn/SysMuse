# Design: Claim-Level Prosecution Analysis Enrichment

*Created: 2026-02-23*
*Status: PROPOSED — Priority enrichment step for litigation analysis*

## Problem

Our current prosecution data is **aggregate-level only** — we know patent 9900608 had 2 non-final rejections and scored 4/5 ("smooth"), but we don't know:
- Which claims were rejected
- On what statutory grounds (101, 102, 103)
- What prior art the examiner cited
- How the applicant amended claims to overcome rejections
- What arguments the applicant made (prosecution history estoppel risk)
- Whether the examiner narrowed claim construction during prosecution

This detail is critical for litigation because:
1. **Examiner-cited prior art** predicts invalidity challenges at trial
2. **Claim amendments** create prosecution history estoppel — arguments made to get a patent allowed can limit claim scope in litigation
3. **Rejection patterns across family members** reveal systemic weaknesses
4. **Survived challenges** (especially at PTAB) are strong positive signals

## Proposed Architecture

### Data Flow

```
USPTO File Wrapper API (ODP)
    ↓
FileWrapperClient (existing — needs extension)
    ↓
Office Action Document Fetcher (NEW — downloads PDFs/XML)
    ↓
LLM Document Analyzer (NEW — extracts structured prosecution events)
    ↓
Prosecution Timeline DB Tables (NEW)
    ↓
Enrichment available to:
  - Prompt templates (<<patent.prosecution_history>>)
  - Family expansion context
  - Scoring template questions
  - PatentDetailPage prosecution tab
```

### Phase 1: Office Action Extraction (~3 days)

**Extend `FileWrapperClient`** to retrieve individual documents, not just metadata.

The USPTO File Wrapper API returns document metadata including `documentCode` and `documentUrl`. Currently we only count documents — we need to download the actual content.

**Key document types to extract:**
| Code | Document | Value |
|------|----------|-------|
| CTNF | Non-Final Office Action | Rejections, cited prior art |
| CTFR | Final Office Action | Hardened rejections |
| N417 | Notice of Allowance | What was allowed and why |
| A.AP / AREF | Applicant Response/Amendment | Claim changes, arguments |
| RCEX | Request for Continued Examination | Prosecution restart signal |
| SRNT / SRFW | Search Report (non-final/final) | Examiner's prior art search |

**Output per document:**
```typescript
interface ProsecutionDocument {
  patentId: string;
  applicationNumber: string;
  documentCode: string;
  documentDate: string;
  documentUrl: string;
  rawText: string;              // OCR'd or extracted text
  // Populated by LLM in Phase 2:
  structuredContent?: ProsecutionEvent;
}
```

### Phase 2: LLM-Powered Prosecution Analysis (~3 days)

**Create `prosecution-analyzer-service.ts`** that processes office action text through an LLM to extract structured data.

**Per Office Action (CTNF/CTFR), extract:**
```typescript
interface OfficeActionAnalysis {
  patentId: string;
  documentDate: string;
  documentType: 'NON_FINAL' | 'FINAL';

  rejections: Array<{
    claimNumbers: number[];         // Which claims rejected
    statutoryBasis: '101' | '102' | '103' | '112';
    rejectionType: string;          // "anticipation", "obviousness", "abstract_idea", etc.
    citedReferences: Array<{
      referenceId: string;          // Patent number or publication
      referenceTitle: string;
      relevance: string;            // What teaching the examiner found
    }>;
    examinerReasoning: string;      // Key argument summary
  }>;

  restrictions?: Array<{
    claimGroups: number[][];        // Groups of claims with different inventions
    electedGroup: number[];
  }>;

  allowedClaims?: number[];         // Claims allowed in this action
  objectionsOnly?: number[];        // Formality objections (not rejections)
}
```

**Per Applicant Response (A.AP/AREF), extract:**
```typescript
interface ApplicantResponseAnalysis {
  patentId: string;
  documentDate: string;

  amendments: Array<{
    claimNumber: number;
    amendmentType: 'NARROWED' | 'BROADENED' | 'CANCELLED' | 'NEW' | 'REWRITTEN';
    beforeLanguage?: string;        // Key changed phrase
    afterLanguage?: string;
    significantNarrowing: boolean;  // Creates estoppel risk
  }>;

  arguments: Array<{
    addressedRejection: string;     // Which rejection this rebuts
    argumentSummary: string;        // Applicant's key argument
    estoppelRisk: 'HIGH' | 'MEDIUM' | 'LOW';
    // HIGH = explicitly disclaimed scope
    // MEDIUM = distinguished prior art on narrow grounds
    // LOW = general traversal
  }>;
}
```

### Phase 3: Database Schema (~1 day)

```prisma
model ProsecutionTimeline {
  id              String   @id @default(cuid())
  patentId        String
  applicationNum  String

  // Aggregate (replaces current cache file)
  totalActions    Int
  totalRejections Int
  totalRCEs       Int
  timeToGrantMonths Int?
  prosecutionScore  Float   // 1-5 as before, but now informed by detail

  // Detailed events (JSON arrays — more flexible than normalized tables)
  officeActions   Json     // Array<OfficeActionAnalysis>
  responses       Json     // Array<ApplicantResponseAnalysis>

  // Derived litigation intelligence
  citedPriorArt       Json    // Deduplicated array of all examiner-cited refs
  narrowedClaims      Json    // Claims that were amended to overcome rejections
  estoppelArguments   Json    // Arguments with HIGH/MEDIUM estoppel risk
  survivedBases       Json    // Statutory bases that were overcome (positive signal)

  // Metadata
  analyzedAt      DateTime
  llmModel        String
  documentCount   Int

  patent          Patent   @relation(fields: [patentId], references: [id])

  @@unique([patentId])
  @@map("prosecution_timelines")
}
```

### Phase 4: Integration with Existing Systems (~2 days)

**Template variable exposure:**
```
<<patent.prosecution_rejections>>     — Count and types of rejections
<<patent.prosecution_cited_art>>      — Prior art references cited by examiner
<<patent.prosecution_narrowed_claims>> — Claims that were amended/narrowed
<<patent.prosecution_estoppel_risk>>  — Summary of estoppel-creating arguments
<<patent.prosecution_survived>>       — Challenges overcome (positive signal)
```

**Scoring template question (add to portfolio-default at weight 0 initially):**
```json
{
  "fieldName": "prosecution_strength",
  "displayName": "Prosecution Strength",
  "question": "Based on the prosecution history, how robust are this patent's claims? Consider: Were claims significantly narrowed during prosecution? What prior art did the examiner cite? Were any 101/Alice rejections overcome? Is there prosecution history estoppel risk?",
  "answerType": "numeric",
  "scale": {"min": 1, "max": 10},
  "weight": 0,
  "requiresReasoning": true
}
```

**Family expansion integration:**
When expanding families, compare prosecution timelines across relatives:
- Sibling had claims narrowed on same basis → our patent may face same challenge
- Cousin survived IPR → positive signal for our patent's validity
- Parent's cited prior art → check if it also applies to our patent

**PatentDetailPage:**
New "Prosecution" tab showing timeline visualization:
- Office actions with rejection details
- Amendments with before/after claim language
- Cited prior art with links
- Estoppel risk flags

## Implementation Order

1. **Extend FileWrapperClient** — download document text from ODP API
2. **Build LLM analyzer** — process office actions and responses
3. **Schema + storage** — ProsecutionTimeline model, cache structure
4. **Batch enrichment** — Job queue integration for portfolio-scale processing
5. **Template variables** — Expose to prompt templates
6. **Family context** — Cross-reference prosecution data across family members
7. **GUI** — PatentDetailPage prosecution tab

## Cost Estimate

- **API calls**: USPTO ODP is free (rate-limited)
- **LLM analysis**: ~$0.02-0.05 per patent (2-5 office actions × ~2K tokens each)
- **For Tier 1 (9 patents)**: ~$0.50
- **For full VIDEO_STREAMING (1,857 patents)**: ~$50-90
- **Storage**: ~5KB per patent in prosecution_timelines table

## Dependencies

- USPTO ODP API access (already configured via `FileWrapperClient`)
- LLM scoring pipeline (already working)
- Job queue (already working)
- Prompt template variable system (already working)

## Related Documents

- `scripts/check-prosecution-history.ts` — current aggregate prosecution data collector
- `src/api/clients/odp-file-wrapper-client.ts` — existing USPTO API client
- `LITIGATION_TARGET_EXECUTION_PLAN.md` — execution context
- `DEVELOPMENT_QUEUE_V5.md` — development priority
