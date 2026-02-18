# Scoring & Enrichment Guide

This document covers every way to initiate scoring and enrichment jobs, what options are available, and how results flow through the system.

---

## Two Systems, Different Purposes

The platform has **two independent job systems** that serve different purposes:

| System | Purpose | Where | How It Runs |
|--------|---------|-------|-------------|
| **LLM Batch Scoring** | Score patents against sector templates using Claude | Sector Management → LLM Scoring tab | Anthropic Batch API (async, 50% cost) |
| **Enrichment Jobs** | Fill data gaps (LLM analysis, prosecution, IPR, families) | Jobs & Enrichment → Job Queue tab | Background shell processes |

They overlap on LLM analysis but differ in approach: batch scoring uses the Anthropic Batch API for cost savings and scores against a *sector template*; enrichment jobs run realtime LLM calls for general patent analysis and also cover prosecution/IPR/family data.

---

## 1. LLM Batch Scoring (Sector Templates)

### What It Does

Scores patents against a sector-specific scoring template using Claude. Each patent gets a composite score (0–10) based on weighted questions like "How relevant is this patent to video codec technology?" The template is built from a 3-level inheritance chain: `portfolio-default → super-sector → sector`.

### How to Start (GUI)

**Sector Management → select a sector → LLM Scoring tab → "Start Batch Scoring"**

Options:
- **Model**: Sonnet 4 (default, balanced), Haiku 4.5 (cheap triage), Opus 4.6 (deep analysis)
- **Use Claims**: Include patent claims in the prompt (~1.6× token cost, may improve accuracy)
- **Rescore**: Overwrite existing scores (default: skip already-scored patents)
- **Top N**: Limit to N patents per sector (0 = all candidates)

The button submits to the Anthropic Batch API and returns immediately. Results arrive within minutes to hours (typically under 30 minutes for <2000 patents). The **Batch Jobs** card on the same page shows status and allows processing results when complete.

### How to Start (CLI)

```bash
# Score all VIDEO_STREAMING sectors
npx tsx scripts/batch-score-overnight.ts --all-video

# Specific sectors
npx tsx scripts/batch-score-overnight.ts --sectors=video-codec,video-server-cdn

# With options
npx tsx scripts/batch-score-overnight.ts --all-video --model=claude-haiku-4-5-20251001 --limit=50 --use-claims

# Submit and wait for completion (polls every 60s, auto-processes)
npx tsx scripts/batch-score-overnight.ts --all-video --wait

# Check status of submitted batches
npx tsx scripts/batch-score-overnight.ts --status

# Process all completed batches
npx tsx scripts/batch-score-overnight.ts --process
```

### Processing Results

When a batch completes (status = `ended`), results need to be processed into the database:

- **GUI**: Click "Process Results" in the Batch Jobs card (on Sector Management page or Jobs & Enrichment → LLM Batch Scoring tab)
- **CLI**: `npx tsx scripts/batch-score-overnight.ts --process`
- **Auto**: The `--wait` flag auto-processes when batches complete

Processing parses each response, extracts per-question scores and reasoning, calculates the composite score, and upserts into `PatentSubSectorScore` with the model name and token usage.

### Batch Job Lifecycle

```
Submitted → In Progress → Ended → Process Results → Scores in DB
                              └→ Failed (API error)
```

### Where to Monitor

- **Sector-specific**: Sector Management → LLM Scoring tab → Batch Jobs card
- **Cross-sector overview**: Jobs & Enrichment → LLM Batch Scoring tab

Both views poll for updates (30s intervals when active jobs exist) and show: sector, model, patent count, status, result counts, and action buttons.

---

## 2. Model Selection

Three models are available for LLM scoring:

| Model | ID | Best For | Relative Cost |
|-------|----|----------|---------------|
| **Sonnet 4** | `claude-sonnet-4-20250514` | Default scoring (balanced) | 1× |
| **Haiku 4.5** | `claude-haiku-4-5-20251001` | Quick triage, large volume | ~0.1× |
| **Opus 4.6** | `claude-opus-4-6` | Deep analysis, complex patents | ~5× |

All three are available in the batch scoring dropdown on the Sector Management page and via the `--model` CLI flag.

### Multi-Model Comparison

To evaluate which model works best for a sector:

**Sector Management → LLM Scoring tab → scroll to "Multi-Model Comparison"**

1. Select 2+ models to compare
2. Choose sample size (5, 10, 20, or 50 patents)
3. Click "Run Comparison"

This scores the same patent sample through each model (realtime, not batch) and shows a side-by-side table of composite scores per patent, plus summary stats (avg score, token usage, estimated cost per 1K patents). Use this to decide whether Haiku is "good enough" for a sector or whether Opus adds meaningful signal.

---

## 3. Score Snapshots

Snapshots capture a point-in-time copy of all LLM scores for a sector. Use them before re-scoring with a different model or updated template to measure what changed.

### Creating a Snapshot

**Sector Management → LLM Scoring tab → Score Snapshots → "Create Snapshot"**

This saves every current `PatentSubSectorScore` for the sector into a `ScoreSnapshot` record along with template metadata.

### Comparing to Current

Click "Compare to Current" next to any snapshot. The comparison shows:
- How many patents improved/degraded/unchanged (threshold: ±0.5 points)
- Average score delta
- Top movers (biggest score changes)

### Typical Workflow

1. Score a sector with Sonnet 4
2. **Create a snapshot** ("Sonnet 4 baseline")
3. Rescore with Opus 4.6 (check "Rescore")
4. **Compare snapshot to current** → see which patents changed and by how much
5. Decide whether to keep the new scores or revert

---

## 4. Enrichment Jobs (Data Coverage)

### What They Do

Enrichment jobs fill data gaps across four coverage types:

| Type | What It Does | Source | Speed |
|------|-------------|--------|-------|
| **LLM** | AI-generated patent analysis (abstract, technology, claims summary) | Claude API (realtime) | ~150/hr |
| **Prosecution** | USPTO prosecution history (office actions, amendments) | USPTO PAIR API | ~600/hr |
| **IPR / PTAB** | Inter partes review proceedings | USPTO PTAB API | ~600/hr |
| **Families** | Backward citations and patent family relationships | PatentsView API | ~500/hr |

### Targeting Modes

Jobs can target patents in three ways:

| Target | Example | What Gets Enriched |
|--------|---------|-------------------|
| **Tier** | Top 6,000 | The highest-scoring N patents across all sectors |
| **Super-Sector** | "Video & Streaming" | All patents in the super-sector (optionally limited to Top N per sector) |
| **Sector** | "video-codec" | All patents in one sector |

### How to Start

**Jobs & Enrichment → Job Queue tab → "New Job"**

1. Select target type (Tier / Super-Sector / Sector)
2. Enter target value (patent count or sector name)
3. Check coverage types to fill (LLM, Prosecution, IPR, Families)
4. A gap preview shows how many patents are missing each type
5. Click "Start Jobs"

One job is spawned per coverage type as a background process. Jobs in the same submission share a `groupId` for grouped display.

**Contextual enrichment**: On the Enrichment Overview and Sector Enrichment tabs, each row has an "Enrich" button that opens the same dialog pre-targeted to that tier or super-sector.

### Monitoring

**Jobs & Enrichment → Job Queue tab**

Shows all enrichment jobs grouped by submission:
- Status (pending/running/completed/failed)
- Patent count and completion rate
- ETA and actual rate
- Duration
- Log viewer (click the log icon)
- Cancel button for running jobs

Auto-refreshes every 15 seconds.

---

## 5. Enrichment Coverage Dashboard

### Tier-Based View

**Jobs & Enrichment → Enrichment Overview**

Shows enrichment coverage broken into tiers (configurable size: 250–5,000):
- Each tier shows % coverage for LLM, Prosecution, IPR, and Families
- Color-coded progress bars (green ≥80%, yellow ≥50%, orange ≥20%, red <20%)
- "Enrich" button per tier to fill gaps

### Sector-Based View

**Jobs & Enrichment → Sector Enrichment**

Shows enrichment coverage per super-sector:
- Coverage scope selector: "All" (full coverage) or "Top N" per sector
- Same coverage bars per super-sector
- "Enrich" button per super-sector

---

## 6. Template Preview

Before scoring, you can preview exactly what prompt Claude will see for a specific patent:

**Sector Management → LLM Scoring tab → Template Preview**

Enter a patent ID and toggle "Include Claims" to see:
- The full rendered prompt
- Question list with weights
- Estimated token count
- Template inheritance chain

---

## Quick Reference: "I Want To..."

| Goal | Where to Go |
|------|-------------|
| Score a sector's patents | Sector Management → LLM Scoring → Start Batch Scoring |
| Score overnight (CLI) | `npx tsx scripts/batch-score-overnight.ts --all-video --wait` |
| Check batch job status | Sector Management → Batch Jobs card, or Jobs & Enrichment → LLM Batch Scoring |
| Process completed batch | Click "Process Results" on any ended batch |
| Change the scoring model | Select from Model dropdown before starting batch |
| Compare models side-by-side | Sector Management → Multi-Model Comparison |
| Save scores before re-scoring | Sector Management → Score Snapshots → Create Snapshot |
| See what changed after re-scoring | Score Snapshots → Compare to Current |
| Fill LLM/prosecution/IPR gaps | Jobs & Enrichment → Job Queue → New Job |
| See overall data coverage | Jobs & Enrichment → Enrichment Overview |
| See per-sector coverage | Jobs & Enrichment → Sector Enrichment |
| Preview scoring prompt | Sector Management → Template Preview |

---

## File & Cache Locations

| Data | Location |
|------|----------|
| Batch job metadata | `cache/batch-jobs/{batchId}.json` |
| LLM scores (cache) | `cache/llm-scores/{patentId}.json` |
| Prosecution history | `cache/prosecution-scores/{patentId}.json` |
| IPR data | `cache/ipr-scores/{patentId}.json` |
| Family citations | `cache/patent-families/parents/{patentId}.json` |
| API-level caches | `cache/api/patentsview/`, `cache/api/ptab/`, `cache/api/file-wrapper/` |
| LLM scores (DB) | `PatentSubSectorScore` table |
| Snapshots (DB) | `ScoreSnapshot` + `PatentScoreEntry` tables |
| Scoring templates | `config/scoring-templates/` |
