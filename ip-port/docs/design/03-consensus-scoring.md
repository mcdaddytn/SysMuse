# Consensus Scoring (Generalized v3)

## Current State

<!-- Describe current v3/LLM scoring approach -->

## Problems with Current Approach

<!-- What's not working? Limitations? -->

## Proposed Changes

### Structured Questions

<!-- How questions are defined and structured -->

### Question Inheritance

<!-- How questions inherit from parent levels (portfolio → super-sector → sector → sub-sector) -->

```
Portfolio Questions
    └── Super-Sector Questions (inherit + extend)
        └── Sector Questions (inherit + extend)
            └── Sub-Sector Questions (inherit + extend)
```

### Append/Prepend Text

<!-- How inherited questions can be customized at lower levels -->

### Question Versioning

<!-- How question changes are tracked -->

### Scoring from Answers

<!-- How LLM answers map to numeric scores -->

## Data Model Changes

<!-- Schema changes needed -->

```prisma
// Example schema changes
```

## Template File Structure

<!-- How JSON templates are organized -->

## LLM Integration

<!-- How prompts are constructed, responses parsed -->
