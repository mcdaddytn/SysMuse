# LLM Patent Analysis Pipeline

## Overview

This document describes the approach for integrating LLM-based patent analysis into our portfolio evaluation pipeline. The system uses Claude (via Anthropic API) to perform qualitative analysis that complements our quantitative citation and term-based scoring.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                     PATENT ANALYSIS PIPELINE                        │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌──────────────────┐    ┌──────────────────┐    ┌──────────────┐ │
│  │ Quantitative     │    │ LLM Analysis     │    │ Combined     │ │
│  │ Analysis         │    │ (Batch Jobs)     │    │ Scoring      │ │
│  │                  │    │                  │    │              │ │
│  │ • Citation count │    │ • 101 Risk       │    │ • Weighted   │ │
│  │ • Competitor     │    │ • Invalidity     │    │   averages   │ │
│  │   citations      │    │ • Claim scope    │    │ • Final      │ │
│  │ • Forward cites  │    │ • Enforceability │    │   rankings   │ │
│  │ • Remaining term │    │ • Market fit     │    │              │ │
│  └────────┬─────────┘    └────────┬─────────┘    └──────┬───────┘ │
│           │                       │                      │         │
│           └───────────────────────┴──────────────────────┘         │
│                                   │                                 │
│                          ┌────────▼────────┐                       │
│                          │ Export Options  │                       │
│                          │ • CSV           │                       │
│                          │ • JSON          │                       │
│                          │ • Text files    │                       │
│                          └─────────────────┘                       │
└─────────────────────────────────────────────────────────────────────┘
```

## LLM Analysis Questions

### Qualitative Responses (Text)

1. **Summary** - High-level summary tailored to non-technical audience
2. **Prior Art Problem** - The problem in the prior art the patent addresses
3. **Technical Solution** - How the technical solution works

### Quantitative Ratings (1-5 Scale)

**All ratings use consistent scale: Higher = Better for patent holder**

4. **101 Eligibility Score** (Patent Eligibility Strength)
   - 5 = Very Strong - Clearly patent-eligible, specific technical implementation
   - 4 = Strong - Strong technical elements, minor abstract concepts
   - 3 = Moderate - Mixed technical/abstract, outcome uncertain
   - 2 = Weak - Significant abstract concepts, limited technical specificity
   - 1 = Very Weak - Likely ineligible, primarily abstract idea

5. **Validity Score** (Prior Art Strength)
   - 5 = Very Strong - Novel approach, minimal prior art concerns
   - 4 = Strong - Some prior art exists but claims are differentiated
   - 3 = Moderate - Relevant prior art exists, claims may need narrowing
   - 2 = Weak - Significant prior art overlap, validity questionable
   - 1 = Very Weak - Strong prior art, likely invalid

6. **Claim Breadth Score**
   - 5 = Very Broad - Foundational claims, wide applicability
   - 4 = Broad - Covers multiple approaches/technologies
   - 3 = Moderate - Covers a class of implementations
   - 2 = Narrow - Specific to particular use case
   - 1 = Very Narrow - Highly specific implementation details

7. **Enforcement Clarity Score**
   - 5 = Very Clear - Infringement obvious from product/service
   - 4 = Clear - Infringement readily observable
   - 3 = Moderate - Detectable with technical analysis
   - 2 = Difficult - Requires significant reverse engineering
   - 1 = Very Difficult - Infringement hard to detect/prove

8. **Design-Around Difficulty Score**
   - 5 = Very Difficult - No practical alternatives, must license
   - 4 = Difficult - Few practical alternatives
   - 3 = Moderate - Alternatives possible with effort
   - 2 = Easy - Known workarounds available
   - 1 = Very Easy - Trivial alternatives exist

## Prompt Design

### System Prompt

```
You are a patent analysis expert. Analyze patents and provide structured assessments
in JSON format. Be objective and thorough. For rating scales, use the specific
criteria provided. Base your analysis only on the patent information given.
```

### User Prompt Template

```
Analyze the following patent(s) and return a JSON response.

For each patent, provide:
1. summary: High-level summary for non-technical audience (2-3 sentences)
2. prior_art_problem: What problem in prior art does this solve? (2-3 sentences)
3. technical_solution: How does the technical solution work? (2-3 sentences)
4. eligibility_score: Patent eligibility strength under 101 (1-5, see scale)
5. validity_score: Strength against prior art invalidity (1-5, see scale)
6. claim_breadth: Claim scope/breadth (1-5, see scale)
7. enforcement_clarity: How easy to detect infringement (1-5, see scale)
8. design_around_difficulty: How hard to avoid this patent (1-5, see scale)

Rating Scales (ALL: Higher = Better for patent holder):
- 5 = Very Strong/Very Broad/Very Clear/Very Difficult to avoid
- 4 = Strong/Broad/Clear/Difficult to avoid
- 3 = Moderate
- 2 = Weak/Narrow/Unclear/Easy to avoid
- 1 = Very Weak/Very Narrow/Very Unclear/Very Easy to avoid

Patents to analyze:
{patents_json}

Return JSON in this exact format:
{
  "analyses": [
    {
      "patent_id": "string",
      "summary": "string",
      "prior_art_problem": "string",
      "technical_solution": "string",
      "eligibility_score": number,
      "validity_score": number,
      "claim_breadth": number,
      "enforcement_clarity": number,
      "design_around_difficulty": number,
      "confidence": number (1-5, your confidence in this analysis)
    }
  ]
}
```

## Batch Processing Strategy

### Batch Size
- **Recommended**: 5-10 patents per batch
- **Rationale**: Balances API efficiency with response quality
- **Context**: Each patent needs ~500 tokens input, ~300 tokens output
- **Total per batch**: ~4,000-8,000 tokens (well within limits)

### Batch Job Structure

```typescript
interface BatchJob {
  batchId: string;
  patents: string[];      // Patent IDs
  status: 'pending' | 'processing' | 'completed' | 'failed';
  createdAt: Date;
  completedAt?: Date;
  results?: LLMAnalysis[];
  error?: string;
}
```

### Execution Flow

1. **Create Batches** - Split patent list into batches of N
2. **Queue Processing** - Submit batches with rate limiting
3. **Store Results** - Save individual analyses to JSON
4. **Combine** - Merge with quantitative scores
5. **Export** - Generate CSV/reports

## Combined Scoring Formula

### LLM Quality Score

All ratings are now on same scale (higher = better), simplifying the formula:

```
llm_quality_score = (
  eligibility_score * 0.25 +        // 101 strength
  validity_score * 0.25 +           // Prior art strength
  claim_breadth * 0.20 +            // Scope
  enforcement_clarity * 0.15 +      // Detectability
  design_around_difficulty * 0.15   // Lock-in
) / 5 * 100
```

### Final Combined Score

```
final_score = (
  quantitative_score * 0.50 +    // Citation-based scoring
  llm_quality_score * 0.30 +     // LLM analysis
  remaining_term_factor * 0.20   // Time value
)
```

## File Structure

```
output/
├── llm-analysis/
│   ├── batches/
│   │   ├── batch-001-2026-01-16.json
│   │   ├── batch-002-2026-01-16.json
│   │   └── ...
│   ├── combined/
│   │   └── all-analyses-2026-01-16.json
│   └── exports/
│       ├── patent-rankings-2026-01-16.csv
│       └── patent-summaries/
│           ├── US10200706.txt
│           └── ...
├── export/                       # Existing export directory
└── ...                           # Existing output files
```

## Configuration

### Environment Variables

```bash
# .env
ANTHROPIC_API_KEY=sk-ant-...
LLM_MODEL=claude-sonnet-4-20250514
LLM_BATCH_SIZE=5
LLM_RATE_LIMIT_MS=1000
```

## Implementation Phases

### Phase 1: Core Infrastructure
- [ ] Set up LangChain with Anthropic
- [ ] Create structured prompt template
- [ ] Implement single-patent analysis
- [ ] Add JSON response parsing

### Phase 2: Batch Processing
- [ ] Implement batch job manager
- [ ] Add rate limiting
- [ ] Create progress tracking
- [ ] Handle errors/retries

### Phase 3: Integration
- [ ] Combine LLM results with quantitative scores
- [ ] Implement weighted scoring formula
- [ ] Generate combined rankings

### Phase 4: Export & Reporting
- [ ] CSV export with all fields
- [ ] Individual patent summaries
- [ ] Dashboard-ready JSON

## Usage Examples

### Run Single Patent Analysis
```bash
npx tsx services/llm-patent-analysis.ts analyze US10200706
```

### Run Batch Analysis
```bash
npx tsx services/llm-patent-analysis.ts batch --start 0 --count 50
```

### Combine Results
```bash
npx tsx services/llm-patent-analysis.ts combine
```

### Export Rankings
```bash
npx tsx services/llm-patent-analysis.ts export --format csv
```

## Cost Estimation

Using Claude Sonnet:
- Input: ~$3/M tokens
- Output: ~$15/M tokens

Per patent (estimated):
- Input: ~800 tokens = $0.0024
- Output: ~400 tokens = $0.006
- **Total per patent: ~$0.0084**

For 250 patents:
- Estimated cost: ~$2.10

For 3,000 patents:
- Estimated cost: ~$25.20

## Notes

- LLM analysis is subjective and should be treated as one input among many
- Confidence scores help identify patents needing human review
- Batch processing allows parallel execution with other analysis jobs
- Results should be cached to avoid re-running expensive analyses
