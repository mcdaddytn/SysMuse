# Design Overview

## Vision

<!-- High-level vision for the system redesign -->

## Problem Statement

<!-- What problems are we solving? What's wrong with the current approach? -->

## Design Principles

<!-- Guiding principles for the redesign -->

## Component Relationships

<!-- How do the major components (taxonomy, scoring, snapshots, enrichment) relate? -->

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│    Taxonomy     │────▶│    Scoring      │────▶│   Snapshots     │
│  (01-taxonomy)  │     │  (02-scoring)   │     │  (04-snapshots) │
└─────────────────┘     └─────────────────┘     └─────────────────┘
         │                      │                        │
         │              ┌───────┴───────┐               │
         │              │   Consensus   │               │
         │              │ (03-consensus)│               │
         │              └───────────────┘               │
         │                                              │
         └──────────────┬───────────────────────────────┘
                        │
                ┌───────▼───────┐
                │  Enrichment   │
                │(05-enrichment)│
                └───────────────┘
```

## Data Flow

<!-- How does data flow through the system? -->

## Key Decisions

<!-- Major architectural decisions and rationale -->

## Open Questions

<!-- Unresolved design questions that need discussion -->
