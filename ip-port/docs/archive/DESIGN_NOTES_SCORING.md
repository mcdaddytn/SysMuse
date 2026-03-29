# Scoring & LLM Views — Design Notes

## Date: 2025-02-17

### LLM Scores Page Identity Problem
- "LLM Scores" is a misnomer — almost ALL scoring in the system uses LLM data
- Scoring runs in successive phases: base score → LLM enrichment → v2/v3 scoring → sector scoring
- Each phase reranks from previous scores to decide what detail to extract next
- The LLM Scores page currently serves two purposes: export results + see what's been run
- This overlaps with sector enrichment in the Job Queue tab (which is out of date)
- **Action needed**: Reconcile LLM Scores, Job Queue enrichment, and Sector Scoring views
- Many views were built against previous versions of sector/LLM scoring and need updating

### Snapshot Overwrite Problem
- Snapshotting v2/v3 scores for "all" patents, then re-snapshotting for top N < all, overwrites only the top N
- This creates a **mixed snapshot** with different scoring parameters across patents
- Current state: this is acceptable but potentially confusing
- **Design options**:
  1. Zero out non-top-N scores when re-snapshotting (clean slate approach)
  2. Make mixed snapshots a deliberate feature — rescore top N with different params for analysis
  3. Track snapshot batch metadata (timestamp, params, scope) so mixed state is visible
- Generally we care most about top N for performance — can rescore those with different weights/params for exploration
- This is core to the iterative exploration workflow throughout the system

### V2/V3 Score Gaps Investigation (2026-02-17)

**Root cause: `config.llmEnhancedOnly = true`**

The active V2 snapshot ("v2DefaultAll", created 2026-02-15) was created with `llmEnhancedOnly: true`, which means only patents that had portfolio-level LLM structured data (eligibility_score, validity_score, etc.) were included. This filtered the 29,474-patent portfolio down to 17,936 patents.

The remaining 11,538 patents never had LLM enrichment run on them — confirmed by:
- 0 of 200 sampled gap patents have prosecution-scores cache files
- All gap patents have low base scores (avg 17.4, max 97.0) vs snapshot patents (avg 33.3, max 190.5)
- Only 81 gap patents have base score > 50; none > 100

**Data flow causing the mismatch:**
```
Sector scoring pipeline: scores ALL patents assigned to a sector (28,424 scored)
V2/V3 snapshot: only patents WITH LLM enrichment data (17,936 patents)
Gap: 11,001 sector-scored patents lack V2/V3 scores
```

Sector scoring runs independently via LLM templates — it does NOT require prior portfolio-level LLM enrichment. But V2/V3 scoring relies on those enrichment fields as inputs (eligibility, validity, claim_breadth, etc.).

**Per-sector gap severity (worst first):**
| Sector | Gap | Total | Missing % |
|--------|-----|-------|-----------|
| test-measurement | 273 | 335 | 81% |
| memory-storage | 316 | 397 | 80% |
| network-error-control | 192 | 266 | 72% |
| wireless-transmission | 903 | 1,297 | 70% |
| network-signal-processing | 888 | 1,285 | 69% |
| wireless-infrastructure | 440 | 759 | 58% |
| analog-circuits | 802 | 1,414 | 57% |

**To close the gap:** Run LLM enrichment on the ~11.5k unenriched patents, then re-snapshot V2/V3 for all. Most are low-base-score patents that were deprioritized during earlier enrichment runs. Whether they're worth enriching depends on whether sector scoring reveals high-value patents among them.

**Snapshot overwrite note confirmed:** The active V2 snapshot has `topN: 0` (meaning "all"), so it was a full run. Re-snapshotting with a smaller topN would only overwrite those N entries — creating a mixed snapshot. The old V2 snapshot (100 patents, now inactive) shows this happened previously.

### View Reconciliation TODO
- [ ] Rename or repurpose "LLM Scores" page
- [ ] Update Job Queue sector enrichment tab to match current pipeline
- [ ] Ensure Sector Rankings, LLM Scores, and Job Queue views are consistent
- [ ] Add snapshot metadata visibility (when scored, with what params, scope)
- [ ] Consider a unified "Scoring Pipeline" view showing all phases
