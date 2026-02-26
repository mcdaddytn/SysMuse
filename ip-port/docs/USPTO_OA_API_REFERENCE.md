# USPTO Office Action API Reference

## Overview

Four USPTO APIs provide office action and citation data. There are **two platforms**:

### Platform 1: DS-API (Developer Hub) — CURRENTLY LIVE
- **Base URL**: `https://developer.uspto.gov/ds-api`
- **Auth**: **None required** (public, no API key)
- **Pattern**: POST with `application/x-www-form-urlencoded` form data
- **Search syntax**: Solr/Lucene query syntax
- **Pagination**: `start` (offset) + `rows` (page size, max ~1000)
- **Response envelope**: `{ "response": { "numFound": N, "start": 0, "docs": [...] } }`
- **Swagger**: `https://developer.uspto.gov/ds-api-docs/index.html?url=https://developer.uspto.gov/ds-api/swagger/docs/{dataset}.json`

### Platform 2: ODP API (New) — NOT YET LIVE FOR OA DATA
- **Base URL**: `https://api.uspto.gov/api/v1/patent`
- **Auth**: `X-API-Key` header (register at https://data.uspto.gov → My ODP)
- **Status**: OA APIs have **NOT migrated** yet (only PTAB has). Scheduled for early 2026.
- **Expected paths** will be `/office-actions/rejections/search`, etc.

**Our clients try ODP first, then fall back to DS-API.**

---

## 1. Office Action Rejection API

**Highest priority** — structured per-claim rejection data, no LLM needed.

### DS-API Endpoint (LIVE)

```
GET  https://developer.uspto.gov/ds-api/oa_rejections/v1/fields
POST https://developer.uspto.gov/ds-api/oa_rejections/v1/records
```

**POST body** (form-urlencoded):
```
criteria=applicationId:14509643&start=0&rows=100
```

**v1 Fields (27):**
| Field | Description |
|-------|-------------|
| `applicationId` | Application serial number |
| `mailDate` | Date OA was mailed (ISO datetime) |
| `documentCd` | Action code: CTNF (non-final), CTFR (final), NOA (allowance) |
| `actionType` | State: objected, rejected, allowed, cancelled, withdrawn |
| `claimNumbers` | Comma-separated claim numbers affected |
| `rejection101` | Binary 0/1 — has §101 rejection |
| `rejection102` | Binary 0/1 — has §102 rejection |
| `rejection103` | Binary 0/1 — has §103 rejection |
| `rejection112` | Binary 0/1 — has §112 rejection |
| `rejectionDp` | Binary 0/1 — has double patenting rejection |
| `cite103Max` | Max references in any single §103 rejection |
| `cite103Gt3` | 1 if >3 references in a §103 rejection |
| `cite102Gt1` | 1 if >1 reference in a §102 rejection |
| `cite103Eq1` | 1 if exactly 1 reference in a §103 rejection |
| `allowedClaims` | 0/1 indicator |
| `objection` | 0/1 has objection |
| `artUnit` | Art unit number |
| `ifwNumber` | IFW document identifier |
| `signatureType` | Examiner signature type |

**Sample record:**
```json
{
  "applicationId": ["14509643"],
  "mailDate": ["2016-04-14T00:00:00"],
  "documentCd": ["CTNF"],
  "actionType": ["objected"],
  "claimNumbers": ["7,14,19"],
  "rejection101": ["1"],
  "rejection102": ["0"],
  "rejection103": ["1"],
  "rejection112": ["0"],
  "rejectionDp": ["0"],
  "cite103Max": ["3"],
  "artUnit": ["2431"]
}
```

**Note:** Fields are returned as single-element arrays (Solr convention).

### Coverage
- ~10.1M records
- OAs mailed from ~June 2018
- v1 data last updated 2018-03-01 (frozen on Developer Hub)

### Our Client
`clients/odp-office-action-rejection-client.ts` — tries ODP POST first, falls back to DS-API.

---

## 2. Office Action Text Retrieval API

**Medium priority** — full text of office action documents for LLM analysis.

### DS-API Endpoint (LIVE)

```
GET  https://developer.uspto.gov/ds-api/oa_actions/v1/fields
POST https://developer.uspto.gov/ds-api/oa_actions/v1/records
```

**POST body**:
```
criteria=patentApplicationNumber:14485382&start=0&rows=50
```

**Key Fields (56 total):**
| Field | Description |
|-------|-------------|
| `patentApplicationNumber` | Application serial number |
| `patentNumber` | Granted patent number (if granted) |
| `bodyText` | **Full extracted OA text** |
| `submissionDate` | OA mail date |
| `legacyDocumentCodeIdentifier` | Action code (CTNF, CTFR, NOA) |
| `inventionTitle` | Patent title |
| `groupArtUnitNumber` | Art unit |
| `grantDate` | Patent grant date |
| `filingDate` | Application filing date |
| `sections.section101RejectionText` | §101 rejection reasoning |
| `sections.section102RejectionText` | §102 anticipation rejection text |
| `sections.section103RejectionText` | §103 obviousness rejection text |
| `sections.section112RejectionText` | §112 rejection text |
| `sections.detailCitationText` | Detailed citation text |
| `sections.summaryText` | OA summary |

**Sample record (truncated):**
```json
{
  "patentApplicationNumber": ["14485382"],
  "patentNumber": ["10047236"],
  "bodyText": ["DETAILED CORRESPONDENCE\nEXAMINER'S AMENDMENT..."],
  "submissionDate": "2018-05-09T00:00:00",
  "legacyDocumentCodeIdentifier": ["NOA"],
  "grantDate": "2018-08-14T00:00:00",
  "inventionTitle": ["METHODS FOR MAKING COPPER INKS AND FILMS"]
}
```

### Coverage
- ~19M records
- 12-series applications and newer
- Daily refresh (last Developer Hub update: 2020-03-12)

### Our Client
`clients/odp-office-action-text-client.ts`

---

## 3. Office Action Citations API

**Raw citation data** — which prior art references were cited, by examiner or applicant.

### DS-API Endpoint (LIVE)

```
GET  https://developer.uspto.gov/ds-api/oa_citations/v1/fields
POST https://developer.uspto.gov/ds-api/oa_citations/v1/records
```

**Key Fields:**
| Field | Description |
|-------|-------------|
| `applicationId` | Application serial number |
| `Patent_PGPub` | Cited patent/publication number |
| `form892` | 1 if cited by examiner on PTO-892 |
| `form1449` | 1 if cited by applicant on PTO-1449 (IDS) |
| `citationInOA` | 1 if cited in OA text body |
| `mailDate` | OA mail date |
| `documentCd` | Action code |

### Coverage
- ~58.8M records
- Data frozen at 2018

---

## 4. Enriched Citation API (AI-Enhanced)

**Most useful for litigation** — AI-extracted claim-to-prior-art mapping with passage locations. Daily refresh.

### DS-API Endpoint (LIVE)

```
GET  https://developer.uspto.gov/ds-api/enriched_cited_reference_metadata/1/fields
POST https://developer.uspto.gov/ds-api/enriched_cited_reference_metadata/1/records
```

**POST body**:
```
criteria=patentApplicationNumber:15638789&start=0&rows=100
```

**Fields (20):**
| Field | Description |
|-------|-------------|
| `patentApplicationNumber` | Application serial number |
| `citedDocumentIdentifier` | Full formatted reference (e.g., "US 2007/0261094 A1") |
| `relatedClaimNumberText` | Claims rejected against this reference (e.g., "1-20") |
| `passageLocationText` | Pipe-delimited passage locations in cited ref |
| `citationCategoryCode` | X=primary (alone), Y=combined, A=general background |
| `officeActionDate` | OA mail date |
| `officeActionCategory` | CTNF, CTFR |
| `examinerCitedReferenceIndicator` | true/false — examiner cited |
| `applicantCitedExaminerReferenceIndicator` | true/false — applicant cited |
| `qualitySummaryText` | "AOK" = good quality extraction |
| `inventorNameText` | Inventor name |
| `groupArtUnitNumber` | Art unit |

**Sample record:**
```json
{
  "patentApplicationNumber": "15638789",
  "citedDocumentIdentifier": "US 2007/0261094  A1",
  "relatedClaimNumberText": "1-20",
  "passageLocationText": "Figure 6 | Fig. 6 | page 4 paragraphs [0036]-[0043] | claim 3 | claim 4",
  "citationCategoryCode": "X",
  "officeActionDate": "2018-10-04T00:00:00",
  "officeActionCategory": "CTNF",
  "examinerCitedReferenceIndicator": true,
  "qualitySummaryText": "AOK"
}
```

### Coverage
- ~1.24M records
- OAs mailed Oct 1, 2017 to 30 days before current date
- **Daily refresh** — most current of all OA APIs

### Our Client
`clients/odp-enriched-citation-client.ts`

---

## Hybrid Strategy in Our Pipeline

`prosecution-analyzer-service.ts` uses a waterfall per patent:

1. **Enriched Citation API** → AI-extracted claim-to-reference mapping (best structured data, daily refresh)
2. **OA Rejection API** → rejection flags per statutory basis (frozen at 2018 data)
3. **OA Text API** → full OA text for LLM analysis (12-series filings)
4. **PDF download + pdftotext** → fallback for older patents
5. **LLM analysis** → extract estoppel risk, examiner reasoning, amendment significance
6. **Merge all sources** → `ProsecutionTimelineData`

---

## Testing

```bash
# Enriched Citations (most useful, daily refresh, no auth)
curl -s --compressed -X POST \
  "https://developer.uspto.gov/ds-api/enriched_cited_reference_metadata/1/records" \
  -d "criteria=patentApplicationNumber:16018089&start=0&rows=10"

# OA Rejections (no auth)
curl -s --compressed -X POST \
  "https://developer.uspto.gov/ds-api/oa_rejections/v1/records" \
  -d "criteria=applicationId:16018089&start=0&rows=10"

# OA Text (no auth)
curl -s --compressed -X POST \
  "https://developer.uspto.gov/ds-api/oa_actions/v1/records" \
  -d "criteria=patentApplicationNumber:16018089&start=0&rows=5"

# OA Citations (no auth)
curl -s --compressed -X POST \
  "https://developer.uspto.gov/ds-api/oa_citations/v1/records" \
  -d "criteria=applicationId:16018089&start=0&rows=10"

# List available fields for any dataset
curl -s "https://developer.uspto.gov/ds-api/oa_rejections/v1/fields"
curl -s "https://developer.uspto.gov/ds-api/oa_actions/v1/fields"
curl -s "https://developer.uspto.gov/ds-api/enriched_cited_reference_metadata/1/fields"
```

---

## Notes

- **DS-API requires NO API key** — all endpoints are public
- **Responses may be gzip-compressed** — use `--compressed` with curl
- **All field values are arrays** in DS-API (Solr convention) — unwrap with `[0]`
- **ODP migration pending** — OA endpoints not yet on `api.uspto.gov` (only PTAB is)
- The search field for application number differs by dataset:
  - Rejections/Citations: `applicationId`
  - Text/Enriched: `patentApplicationNumber`
- Our clients try ODP first (future-proofing), then fall back to DS-API
