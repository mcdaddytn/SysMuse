# Scoring Snapshots & Normalization

## Current State

<!-- Describe current snapshot implementation -->

## Problems with Current Approach

<!-- What's not working? Limitations? -->

## Proposed Changes

### Snapshot Types

<!-- Different kinds of snapshots and their purposes -->

### Snapshot Scope

<!-- Portfolio, super-sector, sector, sub-sector scoping -->

### Normalization Strategies

<!-- How scores are normalized across different populations -->

- Z-Score normalization
- Percentile normalization
- Aggregate-based normalization

### Leveraging Non-Latest LLM Data

<!-- How to use LLM scores that aren't from the latest template version -->

### Freshness Tracking

<!-- How staleness is detected and tracked -->

### Snapshot Comparison

<!-- Comparing rankings between snapshots -->

## Data Model Changes

<!-- Schema changes needed -->

```prisma
// Example schema changes
```

## When Snapshots Are Created

<!-- Triggers for snapshot creation -->

## Snapshot Lifecycle

<!-- Creation, activation, archival, deletion -->
