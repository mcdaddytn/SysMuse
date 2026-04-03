# Stable-Demo Feature Additions

Features added to the `stable-demo` branch that should be reapplied to the refactored `main` branch.

---

## Feature 1: Hierarchical Affiliate Discovery

**Commit:** `e97533e` — "Enhance affiliate discovery with recursive acquisition chain traversal"

**Files changed:**
- `src/api/routes/companies.routes.ts` (discover-affiliates endpoint)
- `frontend/src/services/api.ts` (AffiliateSuggestion interface)
- `frontend/src/pages/AdminPage.vue` (accept logic + dialog display)

**What changed:**
- **Backend:** Expanded Prisma query to include `parent`, `children`, and `description` for each existing affiliate. Rewrote the LLM prompt to pass hierarchy context and explicitly instruct recursive traversal — "for each configured affiliate, also search for THEIR prior acquisitions." The prompt now requests a `parent` slug field in the returned JSON.
- **Frontend type:** Added `parent: string | null` to `AffiliateSuggestion` interface.
- **Accept logic:** Resolves parent slug to parentId by looking up the affiliate in companyDetail. Bulk accepts are sorted parents-first so parentId lookups succeed for children.
- **Dialog:** Shows a parent badge (e.g., "← avago-technologies") on each suggestion.

**How to reapply:** The core change is the LLM prompt and Prisma include expansion in the backend route. The frontend changes are mechanical — add the `parent` field to the type, resolve it on accept, and display it in the dialog.

---

## Feature 2: Division-Aware Competitor Discovery

**Commit:** `dec438b` — "Enhance competitor discovery with division-aware prompts"

**Files changed:**
- `src/api/routes/companies.routes.ts` (discover-competitors endpoint)
- `frontend/src/services/api.ts` (discoverCompetitors return type)
- `frontend/src/pages/AdminPage.vue` (suggestion type + dialog + accept logic)

**What changed:**
- **Backend:** Expanded Prisma query to also fetch affiliates with descriptions. Builds a division context string listing each subsidiary's technology focus. The LLM prompt now includes this division list and asks for competitors FOR EACH division. Requests a `competingDivisions` array in the returned JSON.
- **Frontend type:** Added `competingDivisions?: string[]` to the competitor suggestion inline type.
- **Dialog:** Shows a "Competes with: VMware, Symantec" line (in blue) for each suggestion that has competing divisions.
- **Accept logic:** Merges competingDivisions into both the sectors array and the notes string when saving.
- **Graceful degradation:** If affiliates have no descriptions (describe-affiliates has not been run), the division context is empty and the prompt falls back to generic discovery.

**How to reapply:** The core change is the backend prompt expansion. Frontend changes add one optional field and one display line.

---

## Feature 3: LLM Reasoning Display in SectorScoreTooltip

**Commit:** `d182504` — "Add LLM reasoning display to sector score tooltips"

**Files changed:**
- `frontend/src/components/SectorScoreTooltip.vue`

**What changed:**
- The component already captured `reasoning` in `metricsMap` (line 34-36) but did not render it. Added a reasoning text div below each metric row that displays when reasoning is available.
- Styled with: left-border indicator (`border-left: 2px solid #555`), 0.78em font size, 2-line clamp — compact enough for tooltip use, consistent with the existing `.tooltip-title` clamping pattern.
- Added `flex-wrap: wrap` to `.question-row` so the full-width reasoning div wraps below the score badges.
- **No changes** to V2ScoringPage tooltip — it uses formula-based scoring (Raw/Norm/Wt) with no reasoning field.

**How to reapply:** Small, self-contained change. Add the reasoning div after the score badge div, add the CSS class, and add flex-wrap to question-row.

---

## Bugfix: Robust JSON Fallback Parsing

**Commit:** `97033d9` — "Add robust JSON fallback parsing for LLM discovery endpoints"

**Files changed:**
- `src/api/routes/companies.routes.ts` (both discover-affiliates and discover-competitors endpoints)

**What changed:**
- When the LLM produces slightly malformed JSON (common with very long responses listing 100+ existing competitors), the regex-extracted JSON also failed to parse, causing a 500 error. Added a repair step that truncates at the last complete object (`}`) before re-parsing. Applied to both discovery endpoints for consistency.

**How to reapply:** Replace the simple `jsonMatch ? JSON.parse(jsonMatch[0]) : []` fallback with the nested try/catch repair logic.

---

## Notes

- All features are on the `stable-demo` branch
- The existing tooltip work from commits `80cda3b` and `da564f7` is already present in both `main` and `stable-demo` — no cherry-pick needed
- Features 1 and 2 depend on the Anthropic SDK with web search tool support
- Feature 2 benefits from running "Describe Affiliates" first to populate affiliate descriptions
