# POS Tournament Scoring - Implementation Plan

## Overview

Create a tournament-style LLM analysis system to identify patents from the portfolio that are most relevant to Point-of-Sale (POS) systems, with particular focus on restaurant POS applications. The tournament will evaluate patents for their applicability to the "connectivity and device-control layer" that enables mobile POS reliability.

## Tournament Strategy

### Target Outcome
- **Input**: Top N patents from V2/V3 scoring (e.g., 100 or 1000)
- **Output**: Top 5-10% patents most applicable to POS licensing strategy
- **Focus**: Connectivity layer patents (cellular/Wi-Fi/Bluetooth coexistence) applicable to mobile POS

### Key Evaluation Criteria (from chat analysis)

1. **Connectivity Layer Relevance** - Does the patent address radio coexistence, cellular/Wi-Fi handoff, Bluetooth arbitration?
2. **Operational Reliability Value** - Does the patent prevent failure rather than add features?
3. **POS/Payment Applicability** - Can this be tied to mobile payment terminals, handheld POS devices?
4. **Restaurant Stress-Test Validity** - Would this technology prove its value in high-concurrency restaurant environments?
5. **Cross-Vertical Breadth** - Does it apply beyond restaurants to general retail, payment processors?
6. **Damages Clarity** - Can damages be tied cleanly to per-device royalties without apportionment risk?
7. **Technical Specificity** - Is this engineering innovation (not abstract business method)?

---

## Tournament Structure

### Round Configuration
- **Cluster Size**: 10 patents per cluster
- **Advancement Rate**: Top 50% advance from each cluster
- **Target**: 5-10% of initial pool as finalists

### Example Flow (100 patent pool)
```
Round 1: 100 patents → 10 clusters of 10 → evaluate each cluster
         → Top 5 from each cluster advance → 50 patents

Round 2: 50 patents → 5 clusters of 10 → re-evaluate with cross-cluster context
         → Top 5 from each cluster advance → 25 patents

Round 3: 25 patents → 2-3 clusters → deeper evaluation
         → Top 3-4 from each cluster → 8-10 finalists

Final Synthesis: 8-10 patents → comprehensive ranking with licensing recommendations
```

### Example Flow (1000 patent pool)
```
Round 1: 1000 patents → 100 clusters of 10 → 500 advance
Round 2: 500 patents → 50 clusters of 10 → 250 advance
Round 3: 250 patents → 25 clusters of 10 → 125 advance
Round 4: 125 patents → 12-13 clusters → 50-60 advance
Round 5: 50-60 patents → 5-6 clusters → 25-30 advance
Final: 25-30 patents → comprehensive synthesis → top 50 (5%)
```

---

## Structured Question Templates

### Template 1: POS Cluster Evaluation (Rounds 1-N)

**Purpose**: Evaluate and rank patents within a cluster for POS relevance

**Structured Questions**:

| Field Name | Question | Type | Constraints | Description |
|------------|----------|------|-------------|-------------|
| `connectivity_layer_score` | Does this patent address wireless connectivity, radio coexistence, cellular/Wi-Fi/Bluetooth coordination, or device communication reliability? | INTEGER | 1-5 | 5=Core connectivity layer, 1=No connectivity relevance |
| `operational_reliability_score` | Does this patent prevent device/system failure rather than add business features? Focus on reliability, uptime, graceful degradation. | INTEGER | 1-5 | 5=Prevents critical failure, 1=Feature addition only |
| `pos_applicability_score` | Could this patent apply to mobile POS terminals, handheld payment devices, or point-of-sale hardware? | INTEGER | 1-5 | 5=Direct POS applicability, 1=No POS relevance |
| `restaurant_stress_score` | Would this technology prove valuable in high-stress restaurant environments (peak hours, patios, dense Bluetooth, Wi-Fi dead zones)? | INTEGER | 1-5 | 5=Critical for restaurant ops, 1=No restaurant relevance |
| `cross_vertical_score` | Does this patent apply beyond restaurants to general retail POS, payment processors, mobile payment providers? | INTEGER | 1-5 | 5=Broad cross-vertical applicability, 1=Single-vertical only |
| `damages_clarity_score` | Can damages be tied cleanly to per-device royalties without complex apportionment to software/subscriptions? | INTEGER | 1-5 | 5=Clean per-device damages, 1=Complex apportionment required |
| `technical_specificity_score` | Is this engineering/technical innovation (vs. abstract business method)? Would it survive 101 scrutiny? | INTEGER | 1-5 | 5=Clear technical innovation, 1=Abstract/business method risk |
| `overall_pos_score` | Overall score for POS licensing potential combining all factors | INTEGER | 1-10 | 10=Exceptional POS candidate, 1=Not applicable |
| `connectivity_type` | What connectivity technology does this patent primarily address? | ENUM | cellular, wifi, bluetooth, multi_radio, network_general, not_connectivity | Primary connectivity focus |
| `pos_target_fit` | Which POS targets would this patent most likely apply to? | TEXT_ARRAY | max 5 items | e.g., ["Toast", "Square", "Clover", "Verifone", "General retail"] |
| `key_strength` | What is the primary licensing strength of this patent for POS? | TEXT | max 2 sentences | Brief rationale |
| `potential_weakness` | What is the main challenge or weakness for POS assertion? | TEXT | max 2 sentences | Brief risk assessment |

### Template 2: POS Round Synthesis (Between Rounds)

**Purpose**: Aggregate results from previous round and re-rank across clusters

**Structured Questions**:

| Field Name | Question | Type | Constraints | Description |
|------------|----------|------|-------------|-------------|
| `round_summary` | Summarize the key themes and findings from this round of POS patent evaluation | TEXT | max 5 sentences | Round-level insights |
| `top_connectivity_patents` | Which patents have the strongest connectivity-layer claims? | TEXT_ARRAY | max 10 items | Patent IDs |
| `top_restaurant_patents` | Which patents would be most compelling in a restaurant POS context? | TEXT_ARRAY | max 10 items | Patent IDs |
| `top_cross_vertical_patents` | Which patents have the broadest applicability across POS verticals? | TEXT_ARRAY | max 10 items | Patent IDs |
| `advancement_rationale` | Why should these patents advance to the next round? | TEXT | max 3 sentences | Justification |
| `eliminated_themes` | What types of patents were eliminated and why? | TEXT | max 3 sentences | Patterns in non-advancing patents |

### Template 3: POS Final Synthesis

**Purpose**: Produce definitive ranking and licensing recommendations

**Structured Questions**:

| Field Name | Question | Type | Constraints | Description |
|------------|----------|------|-------------|-------------|
| `executive_summary` | Executive summary of POS-relevant patents identified through tournament | TEXT | max 5 sentences | High-level findings |
| `tier1_patents` | Top-tier patents with exceptional POS licensing potential | TEXT_ARRAY | max 10 items | Patent IDs - immediate licensing candidates |
| `tier2_patents` | Second-tier patents with strong POS relevance | TEXT_ARRAY | max 15 items | Patent IDs - strong supporting patents |
| `connectivity_portfolio_strength` | Overall assessment of portfolio strength for connectivity-layer POS claims | INTEGER | 1-10 | 10=Exceptional, 1=Weak |
| `restaurant_narrative_strength` | Strength of restaurant-specific jury narrative using these patents | INTEGER | 1-10 | 10=Compelling, 1=Weak |
| `damages_model_clarity` | Clarity of per-device damages model using identified patents | INTEGER | 1-10 | 10=Very clear, 1=Problematic |
| `recommended_lead_patents` | Which patents should lead a POS licensing campaign? | TEXT_ARRAY | max 5 items | Patent IDs for initial assertions |
| `target_defendants` | Recommended defendant categories based on patent coverage | TEXT_ARRAY | max 5 items | e.g., ["Restaurant POS", "Retail POS", "Payment processors"] |
| `key_jury_narrative` | One-sentence jury narrative that these patents support | TEXT | max 2 sentences | The anchor message |
| `strategic_gaps` | What POS-relevant technology areas are NOT covered by identified patents? | TEXT | max 3 sentences | Portfolio gaps |
| `pairing_opportunities` | Could these patents be paired with other IP for stronger coverage? | TEXT | max 2 sentences | Future strategy notes |

---

## Implementation Components

### 1. Backend: Tournament Execution Service

**New file**: `src/api/services/tournament-execution-service.ts`

```typescript
interface TournamentConfig {
  name: string;
  clusterSize: number;           // e.g., 10
  advancementRate: number;       // e.g., 0.5 (50%)
  targetFinalPct: number;        // e.g., 0.05 (5%)

  // Template IDs for each phase
  clusterTemplateId: string;     // Round evaluation template
  synthesisTemplateId: string;   // Between-round synthesis
  finalTemplateId: string;       // Final synthesis

  // Scoring formula for advancement
  advancementFormula: string;    // e.g., "0.3*connectivity + 0.2*pos + 0.2*reliability + 0.15*damages + 0.15*technical"
}

interface TournamentInput {
  sourceType: 'v2' | 'v3' | 'super_sector';
  sourceId?: string;             // super_sector name if applicable
  topN: number;                  // how many patents to pull
  llmEnhancedOnly: boolean;
}
```

**Key Functions**:
- `createTournament(config, input)` - Initialize tournament, create LlmWorkflow
- `executeRound(workflowId, round)` - Run one round of cluster evaluations
- `calculateAdvancements(roundResults, formula)` - Determine which patents advance
- `executeSynthesis(workflowId, round)` - Run synthesis between rounds
- `executeFinalSynthesis(workflowId)` - Produce final rankings

### 2. Backend: API Routes

**New endpoints** in `src/api/routes/tournaments.routes.ts`:

```
POST /api/tournaments
  - Create and start a tournament
  - Body: { config, input }
  - Returns: { tournamentId, workflowId }

GET /api/tournaments/:id
  - Get tournament status and results
  - Returns: { status, currentRound, results }

GET /api/tournaments/:id/rounds/:round
  - Get specific round results
  - Returns: { clusters, rankings, advancements }

POST /api/tournaments/:id/advance
  - Manually trigger next round (if not auto-advancing)
```

### 3. Frontend: Tournament Trigger UI

**Location**: New tab/section in Prompt Templates page

**Components**:
1. **Tournament Configuration Panel**
   - Select tournament type (POS, or future types)
   - Configure cluster size, advancement rate
   - Select templates for each phase

2. **Input Selection Panel**
   - Source dropdown: V2 Scoring, V3 Scoring, or Super-Sector
   - Top N input field
   - "Complete Data Only" toggle
   - Preview of input patents

3. **Execution Panel**
   - "Start Tournament" button
   - Progress display (current round, clusters completed)
   - Link to Job Queue for detailed tracking

4. **Results Panel** (post-completion)
   - Round-by-round summary
   - Final rankings display
   - Export to CSV/JSON
   - "Create Focus Area" button

---

## Execution Flow

### Step 1: User Initiates Tournament
1. User navigates to Prompt Templates → Tournaments tab
2. Selects "POS Tournament" configuration
3. Chooses input: "Top 100 from V2 Scoring"
4. Clicks "Start Tournament"

### Step 2: System Creates Workflow
1. Backend creates `LlmWorkflow` with type "tournament"
2. Fetches top 100 patents from V2 scoring endpoint
3. Creates `LlmJob` records for Round 1 clusters (10 jobs × 10 patents each)
4. Returns tournament ID to frontend

### Step 3: Job Queue Execution
1. Job queue worker picks up cluster evaluation jobs
2. Each job:
   - Loads 10 patents with full data
   - Executes POS Cluster Evaluation template
   - Saves structured results to `EntityAnalysisResult`
3. When all Round 1 jobs complete, triggers advancement calculation

### Step 4: Advancement Calculation
1. Load all Round 1 results
2. Apply advancement formula to calculate composite score
3. Rank all patents, select top 50%
4. Create Round 2 jobs with advancing patents
5. Execute Round 2...

### Step 5: Final Synthesis
1. When final round completes, execute Final Synthesis template
2. Save comprehensive results
3. Mark tournament as COMPLETE
4. Notify user (or update UI)

### Step 6: Results Review
1. User views tournament results in UI
2. Can export to CSV/JSON
3. Can create Focus Area from tier-1 patents

---

## Testing Plan

### Test 1: Small Pool (100 patents)
```
Input: Top 100 from V2, Complete Data Only
Expected:
  - Round 1: 10 clusters → 50 advance
  - Round 2: 5 clusters → 25 advance
  - Round 3: 2-3 clusters → 8-10 finalists
  - Final: Synthesis of 8-10 patents

Verify:
  - All jobs execute successfully
  - Structured fields are populated
  - Rankings are calculated correctly
  - Advancement logic works
  - Final synthesis produces coherent output
```

### Test 2: Medium Pool (500 patents)
```
Input: Top 500 from V2, Complete Data Only
Expected:
  - 4-5 rounds before final synthesis
  - ~25-50 finalists
```

### Test 3: Large Pool (1000 patents)
```
Input: Top 1000 from V2, Complete Data Only
Expected:
  - 5-6 rounds
  - ~50 finalists (5%)
```

---

## File Checklist

### New Files to Create
- [ ] `scripts/seed-pos-tournament-templates.ts` - Seed the 3 structured templates
- [ ] `src/api/services/tournament-execution-service.ts` - Tournament logic
- [ ] `src/api/routes/tournaments.routes.ts` - API endpoints
- [ ] `frontend/src/components/TournamentPanel.vue` - Tournament trigger UI

### Files to Modify
- [ ] `src/api/server.ts` - Mount tournament routes
- [ ] `src/api/services/workflow-engine-service.ts` - Add tournament support
- [ ] `frontend/src/pages/PromptTemplatesPage.vue` - Add tournament tab

---

## Questions for Review

1. **Cluster Size**: Is 10 patents per cluster appropriate, or should we test with 5 or 15?

2. **Advancement Rate**: 50% advancement per round - too aggressive or too conservative?

3. **Scoring Formula**: Should all metrics be equally weighted, or prioritize connectivity/POS scores?

4. **Template Customization**: Should users be able to modify questions before running, or use fixed templates?

5. **Focus Area Creation**: Automatically create focus area from finalists, or let user decide?

---

## Next Steps

1. **Review this plan** - Confirm approach and question design
2. **Create seed script** - Implement the 3 structured templates
3. **Implement backend** - Tournament execution service and routes
4. **Implement frontend** - Tournament panel in Prompt Templates
5. **Test on small pool** - Validate with 100 patents
6. **Scale up** - Test with 1000 patents

