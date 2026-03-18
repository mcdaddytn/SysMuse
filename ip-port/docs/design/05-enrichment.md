# Data Enrichment & Auto-Calculation

## Current State

<!-- Describe current enrichment pipeline -->

## Problems with Current Approach

<!-- What's not working? Limitations? -->

## Proposed Changes

### Enrichment Pipeline

<!-- Overall data enrichment flow -->

```
Raw Patent Data
    → Basic Enrichment (XML parsing, CPC codes)
    → Citation Enrichment (forward/backward citations)
    → Competitor Enrichment (competitor citations, density)
    → LLM Enrichment (structured question scoring)
    → Score Calculation (weighted composite scores)
    → Snapshot Creation
```

### Auto-Calculation

<!-- What gets calculated automatically and when -->

### Auto-Normalization

<!-- When normalization is applied automatically -->

### TopN Rerun Goals

<!-- How the system ensures top patents have fresh LLM data -->

### Batch Job Management

<!-- How enrichment jobs are queued, tracked, resumed -->

### Staleness Handling

<!-- What triggers re-enrichment -->

## Data Model Changes

<!-- Schema changes needed -->

```prisma
// Example schema changes
```

## Job Types

<!-- Different enrichment job types -->

## Priority & Scheduling

<!-- How jobs are prioritized -->
