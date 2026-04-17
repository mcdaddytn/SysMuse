# Prior Art Invalidity Risk Scoring — System Specification

**Project:** IP Portfolio Analytics — Prior Art Risk Module
**Status:** Draft v1.0
**Scope:** Short-term focus-area implementation + long-term taxonomy-based design
**Intended audience:** Claude Code project implementation

---

## 1. Background and Objective

Our IP portfolio analytics system identifies high-value patents for potential litigation, builds claim charts through third-party tools (e.g., Patlytics), and constructs litigation packages. We frequently encounter patents that score well on initial analysis (claim coverage, damages potential, design-around difficulty, § 101 eligibility) but later fail during prior art review when adversaries or IPR challengers surface invalidating references.

This module adds **prior art invalidity risk** as a scored dimension, integrated into our existing LLM-question + rating + reasoning architecture. The goal is to flag patents with high invalidity risk **before** investing in downstream claim charting and external prior art search, reducing wasted cost on patents that will ultimately fail.

### Legal doctrines covered

1. **§ 102 anticipation** — a single prior art reference disclosing every claim element
2. **§ 103 obviousness** — combinations obvious to a PHOSITA; post-*KSR* flexible standard
3. **§ 102 statutory bars** — on-sale bar, public use, printed publication before critical date; post-*Helsinn* (2019) covers secret sales
4. **§ 112 enablement / written description** — particularly post-*Amgen v. Sanofi* (2023) for functional genus claims
5. **Priority chain vulnerability** — CIP/continuation scope expansion causing loss of earliest priority date

---

## 2. Architectural Approach

### 2.1 Short-term: Focus Area Implementation

**Rationale:** Deploying new questions at the taxonomy level requires re-running the full portfolio to normalize scores. For an immediate value delivery, we leverage the existing **Focus Area** construct — user-defined or system-generated patent groupings, often aligned with litigation target sectors — to run a localized, tailored question set per focus area.

**Benefits:**
- Immediate deployment without portfolio-wide rescoring
- Tailored question set per tech area (no one-size-fits-all compromises)
- Questions refined based on focus area results can be promoted to taxonomy questions later
- Export-to-CSV aggregation enables use in third-party tools

**Tradeoffs:**
- Scores not directly comparable across focus areas
- Question drift risk without governance (mitigated by maintaining a canonical question bank — see Section 5)
- Not intended as the permanent solution

### 2.2 Long-term: Taxonomy-Inheritance Implementation

**Rationale:** The permanent solution places questions at the **correct level** of our CPC-derived taxonomy (super-sector → sector → sub-sector), with inheritance and annotation. Questions live at the highest level where their rubric is stable; sub-sector annotations inject tech-specific context (standards lists, reference implementations, product landscapes) to sharpen inference.

**Migration path:**
1. Short-term focus-area questions are authored in a canonical, inheritance-ready format from day one
2. Once proven, questions promote to super-sector or universal level
3. Tech-specific context captured in focus area definitions promotes to sub-sector annotations
4. Portfolio re-scoring happens once at promotion time, not per question

---

## 3. Data Sources

### 3.1 Available Now

| Source | Coverage | Access |
|---|---|---|
| USPTO ODP (Open Data Portal) | Bibliographic data, file wrapper events, citation data, examiner identity, prosecution timeline | Existing API integration |
| EPO OPS | INPADOC family data, foreign search reports, foreign prosecution outcomes | Free with registration; add integration |
| Patent text (claims, spec) | Full text, in-system | Existing |
| Product intelligence layer | Commercial products with inferred implementations | Existing |
| Web search (Google/Bing/Serper) | General web, date-bounded queries | Via existing integration or to be added |
| Semantic Scholar | Academic papers, author search, citation graph | Free API; add integration |
| arXiv | Preprints, date-filterable | Free API; add integration |
| GitHub Search | Code, commits, repos with date filters | Free API; add integration |
| Internet Archive (Wayback / CDX API) | Historical snapshots of web pages by date | Free API; add integration |

### 3.2 Deferred (Paid) — See Section 9

- Patent Bots or equivalent for structured office action text and claim amendment diffs
- Lex Machina / Docket Navigator for IPR outcome calibration
- IEEE Xplore full-text (abstracts free)
- IP.com defensive publications database

---

## 4. ODP-Derived Metrics (API-Sourced Ratings)

These are **deterministic ratings** computed from ODP data, stored alongside LLM-question ratings using the same `rating + reasoning` pattern. The reasoning field is machine-generated from the underlying metrics to explain the rating. These metrics extend the existing ODP-sourced metric set.

### 4.1 Metrics to Extract from ODP

For each patent, pull and cache:

**Bibliographic and priority**
- Application filing date, publication date, grant date
- Priority chain (foreign priority claims, domestic continuations/CIPs/divisionals)
- Computed "effective filing date" for each independent claim (requires claim-to-priority mapping; use conservative default of earliest application containing matching disclosure)
- Critical dates: (effective filing date − 365 days) pre-AIA; effective filing date post-AIA
- AIA status (first-to-file vs. first-to-invent based on filing date and transition rules)

**Prosecution events**
- Count of non-final office actions
- Count of final office actions
- Count of RCEs filed
- Count of examiner interviews
- Count of amendments filed
- Count of appeals and appeal outcomes
- Total prosecution time (filing to allowance)
- Time between each event (to detect long gaps vs. rapid back-and-forth)
- Presence of terminal disclaimers
- Notice of Allowance → issue fee timing

**Cited references (examiner vs. applicant)**
- Count of examiner-cited US patents, foreign patents, NPL
- Count of applicant-cited (IDS) references by type
- CPC class diversity of examiner-cited references (Shannon entropy across CPC sub-classes)
- Ratio of NPL to total examiner citations
- Ratio of foreign to total examiner citations
- Examiner's self-reported search class/subclass/CPC coverage (from search notes if available)

**Examiner data**
- Examiner name, art unit
- Examiner allowance rate (computed from historical ODP data)
- Examiner's average citation count per case
- Examiner's NPL citation rate

**Family data** (augmented by EPO OPS for foreign)
- Number of family members
- Grant status of each family member
- Foreign prosecution outcomes (rejected, narrowed, granted, abandoned)
- Foreign oppositions and outcomes

### 4.2 ODP-Sourced Rating Questions

These follow the existing `rating (1–5) + reasoning` pattern. Rating 5 = highest risk.

**Q-API-1: Prosecution Turbulence Score**
- **Input:** prosecution event counts and timing
- **Computation:**
  - Start at 1
  - +1 per RCE (cap at +2)
  - +1 if ≥3 non-final OAs
  - +1 if ≥2 final OAs
  - +1 if total prosecution time > 5 years
  - −1 if allowed on first action and no amendments
  - Clamp to 1–5
- **Reasoning (auto-generated):** "Prosecution included N office actions (M finals), X RCEs, total Y years from filing to allowance. [High/Moderate/Low] turbulence suggests examiner identified close prior art requiring substantial negotiation."

**Q-API-2: Examiner Search Depth Proxy**
- **Input:** cited reference profile
- **Computation:**
  - Score starts at 3 (neutral)
  - +1 if NPL ratio < 0.05 in CPC classes where NPL is prevalent (software, ML, comms)
  - +1 if foreign patent ratio < 0.10 in CPC classes with active foreign prosecution
  - +1 if examiner cited ≤ 5 references total
  - −1 if examiner cited ≥ 20 references with ≥ 3 distinct CPC subclasses
  - −1 if examiner cited ≥ 3 NPL references
  - Clamp to 1–5
- **Reasoning (auto-generated):** "Examiner cited N references (X US patents, Y foreign, Z NPL) spanning M CPC subclasses. [Shallow/Moderate/Thorough] search relative to CPC-class norms suggests [high/moderate/low] likelihood of missed prior art."

**Q-API-3: Family Invalidation Signal**
- **Input:** EPO OPS family prosecution data
- **Computation:**
  - Start at 3 (neutral)
  - +1 per family member rejected on prior art grounds (cap +2)
  - +1 if EPO search report cites references not considered by USPTO
  - +1 if opposition filed and sustained against any family member
  - −1 if all major jurisdiction counterparts (EP, JP, CN, KR) granted with similar scope
  - Return 3 with confidence=none if no foreign family exists
  - Clamp to 1–5
- **Reasoning (auto-generated):** Summarize foreign outcomes and any art that drove rejections.
- **Confidence field:** `{none, weak, moderate, strong}` based on family size and data completeness.

**Q-API-4: Priority Date Vulnerability Indicator**
- **Input:** priority chain structure
- **Computation:**
  - Start at 1
  - +2 if patent claims priority through a CIP (high risk of added matter)
  - +1 if chain depth > 3 (continuation stacking)
  - +1 if foreign priority is claimed but the foreign application has a different disclosure size than the first US filing (proxy for added matter)
  - Clamp to 1–5
- **Reasoning (auto-generated):** Describe the priority chain and specific concerns.
- **Note:** This is an indicator, not a determination. Actual priority vulnerability requires claim-to-disclosure mapping (see Q-U6 LLM question).

**Q-API-5: Foreign Search Report Differential**
- **Input:** EPO OPS search report references vs. USPTO-cited references
- **Computation:**
  - Compute set difference: references cited by EPO examiner but not USPTO examiner
  - Start at 1
  - +1 per X-category (novelty-destroying) EPO reference not considered by USPTO
  - +1 per Y-category (obviousness-relevant) EPO reference not considered by USPTO (cap +2)
  - Return 3 with confidence=none if no EPO counterpart
  - Clamp to 1–5
- **Reasoning (auto-generated):** List the differential references with EPO categorization.
- **Confidence field:** `{none, weak, moderate, strong}`.

### 4.3 ODP-Derived Metrics as Non-Rated Features

Not all ODP data needs to be a rating. Some should be stored as raw features for use in reasoning fields, CSV export, and downstream LLM question context:

- Cited references full list with publication dates (used as LLM context for obviousness questions)
- Examiner name (for human analyst reference)
- Allowance path (straight allowance, post-RCE, post-appeal, etc.)
- Key dates (effective filing, critical date pre-AIA, critical date post-AIA)

---

## 5. LLM Question Bank — Canonical Definitions

All questions follow the system pattern: **rating (1–5) + reasoning text**. Rating 5 = highest risk. Questions marked with **[Neutral-default]** return rating 3 with `confidence=none` when evidence is inconclusive, to preserve score calibration.

Each question includes:
- **ID** — stable identifier for migration to taxonomy
- **Target level** — where the question belongs in the long-term taxonomy (Universal, Super-sector, Sub-sector annotation)
- **Applicability** — which technology areas it applies to
- **Input context** — what data the LLM receives
- **Rubric** — anchored rating descriptions
- **Reasoning requirements** — what the reasoning field must contain
- **Short-term focus area tailoring notes** — how it might be customized per focus area

### 5.1 Universal Questions (apply to all patents)

#### Q-U1: Claim Breadth and Functional Language Risk
- **Target level:** Universal
- **Input:** Independent claims, specification
- **Rubric:**
  - 1 — Claims narrowly tied to specific structures with clear antecedent basis in spec; no functional language in critical elements
  - 2 — Mostly structural; minor functional language with structural backing
  - 3 — Balanced structural and functional language; spec supports functional elements
  - 4 — Significant functional/result-oriented language; some structural backing but gaps present
  - 5 — Claims rely primarily on functional language ("configured to," "means for," "such that") without corresponding structural disclosure; claims appear broader than enabled
- **Reasoning requirements:** Identify specific functional terms with claim element references; pair each functional element with corresponding spec disclosure or note absence.

#### Q-U2: Predictable Combination Risk (KSR)
- **Target level:** Universal
- **Input:** Independent claims, spec background section, examiner-cited art, applicant-cited art
- **Rubric:**
  - 1 — Combination produces genuinely unexpected synergy; spec documents unexpected results with data
  - 2 — Non-obvious combination; some supporting rationale in spec
  - 3 — Plausible but not clearly obvious; neutral
  - 4 — Combination appears straightforward; finite predictable solution space
  - 5 — Clear application of known techniques to known problem; "obvious to try" with predictable results
- **Reasoning requirements:** Identify the core inventive combination, what elements were known (with reference to cited art), and whether the spec articulates unexpected results with evidence.

#### Q-U3: Problem-Solution Obviousness
- **Target level:** Universal
- **Input:** Spec background, claims, cited art
- **Rubric:**
  - 1 — Novel problem identified in spec OR non-obvious solution
  - 2 — Known problem; solution requires non-trivial insight
  - 3 — Known problem; solution is one of several plausible approaches
  - 4 — Well-known problem; solution space is finite and predictable
  - 5 — Well-known problem with well-known solution approach
- **Reasoning requirements:** Quote problem statement from spec, identify solution approach, assess both against the background art.

#### Q-U4: Secondary Considerations Evidence (reverse-coded; 5 = LOW evidence = HIGH risk)
- **Target level:** Universal
- **Input:** Spec, prosecution history events, any associated commercial product data
- **Rubric:**
  - 1 — Strong specific evidence: unexpected results with data, documented long-felt need, prior failures of others, commercial success tied to claimed features
  - 2 — Moderate evidence in at least two categories
  - 3 — Some evidence but generic or weakly tied to claimed features
  - 4 — Minimal evidence; generic spec boilerplate
  - 5 — No secondary considerations evidence; purely technical disclosure without context
- **Reasoning requirements:** Quote or paraphrase specific passages; for absence, note that the spec lacks these indicators.

#### Q-U5: Claim Element Novelty Concentration
- **Target level:** Universal
- **Input:** Independent claims, cited art
- **Rubric:**
  - 1 — Multiple elements individually novel; novelty distributed across claim
  - 2 — Two or three elements contribute meaningfully to novelty
  - 3 — Novelty concentrated in one or two elements with others well-known
  - 4 — Novelty rests almost entirely on one element
  - 5 — Single-point-of-novelty claim; vulnerable to single anticipating reference
- **Reasoning requirements:** Decompose independent claim into elements; mark each as novel/known/uncertain with brief rationale.

#### Q-U6: Priority Chain Vulnerability (LLM-assessed, complementary to Q-API-4)
- **Target level:** Universal
- **Input:** Asserted independent claims, earliest priority document disclosure (text excerpt), full priority chain
- **Rubric:**
  - 1 — All claim features clearly supported in earliest priority document
  - 2 — Minor terminology shifts but substantive support present
  - 3 — Some claim features rely on later disclosure; partial priority
  - 4 — Significant claim scope appears added in continuations
  - 5 — Asserted claims substantially broader than earliest disclosure; likely loss of earliest priority date
- **Reasoning requirements:** Map each claim feature to earliest priority disclosure; flag gaps with quoted excerpts.

#### Q-U7: Written Description for Functional Features
- **Target level:** Universal
- **Input:** Claims, specification
- **Rubric:**
  - 1 — Each functional element backed by specific structure/algorithm/species disclosure
  - 2 — Most functional elements have structural support; minor gaps
  - 3 — Some functional elements adequately described; others weakly supported
  - 4 — Multiple functional elements lack corresponding structural disclosure
  - 5 — Functional language restated in spec without implementation detail; high § 112(a) risk
- **Reasoning requirements:** Pair each functional element with corresponding spec disclosure; note absences specifically.

#### Q-U8: Numerical Range Criticality
- **Target level:** Universal
- **Input:** Claims, specification
- **Applicability:** Return N/A (stored as neutral 3 with confidence=none) if claims contain no numerical ranges
- **Rubric:**
  - 1 — Ranges supported by experimental data, criticality explained, comparative examples outside range
  - 2 — Ranges supported by rationale and some data
  - 3 — Ranges supported by rationale but no comparative data
  - 4 — Ranges recited with minimal justification
  - 5 — Ranges recited without any criticality support; obviousness-vulnerable per MPEP 2144.05
- **Reasoning requirements:** Quote the ranges from claims; describe spec's supporting data or note absence.

### 5.2 Super-Sector Questions

#### Q-S1 (Software/ICT): § 101 Abstract Idea Overlap with Prior Art Risk
- **Target level:** Super-sector (Software/ICT)
- **Input:** Claims, spec, background
- **Rubric:**
  - 1 — Claim recites specific technical improvement (per *Enfish*, *DDR Holdings*, *McRO* patterns); technical problem-solution clearly articulated
  - 2 — Technical improvement present but could be narrower
  - 3 — Mixed — some technical content but abstract elements present
  - 4 — Claim primarily applies abstract idea to generic computing; limited technical improvement
  - 5 — Claim could be performed mentally or with pen and paper; "do it on a computer" pattern (*Alice* pattern)
- **Reasoning requirements:** Apply *Alice* two-step framework; cite analogous Federal Circuit pattern.
- **Note:** This question intersects with § 103 risk because abstract claims are typically broader and more combination-vulnerable. Keep as distinct question for clarity but feed into composite.

#### Q-S2 (Software/ICT): Standards Relevance and Overlap
- **Target level:** Super-sector (Software/ICT), annotated at sub-sector
- **Input:** Claims, spec, **sub-sector annotation: relevant standards corpus with publication dates**
- **Rubric:**
  - 1 — No substantial overlap with published standards predating priority
  - 2 — Tangential overlap with general-purpose standards
  - 3 — Some overlap but standards address different problem or different scope
  - 4 — Substantial overlap; standards disclose similar approach but not all elements
  - 5 — Published standards before priority date appear to disclose the claimed approach
- **Reasoning requirements:** Identify specific standards from sub-sector annotation that may be relevant; compare publication dates to priority date; analyze overlap with claim elements.
- **Sub-sector annotations required:**
  - H04L 9/* → TLS (RFC 5246, RFC 8446), IPsec, SSH, Kerberos, PKCS standards, NIST FIPS 186 series, RFC 7748 (Curve25519)
  - H04W → 3GPP specifications by release, IEEE 802.11 amendments, Bluetooth SIG specs
  - G06F 16 → SQL standards, XQuery, SPARQL, graph query standards
  - H04N 19 → video codec standards (H.264/AVC, H.265/HEVC, AV1, VP9) with ratification dates
  - *(expand per sub-sector as needed)*

#### Q-S3 (Software/ICT): Open Source Implementation Risk
- **Target level:** Super-sector (Software/ICT), annotated at sub-sector
- **Input:** Claims, spec, **sub-sector annotation: relevant OSS project landscape with vintage data**
- **Rubric:**
  - 1 — No known OSS implementation of the claimed functionality predates priority
  - 2 — OSS projects address related functionality with material differences
  - 3 — OSS projects cover partial functionality
  - 4 — OSS projects cover most of the claimed functionality with some gaps
  - 5 — Well-known OSS project implements the claimed functionality before priority date
- **Reasoning requirements:** Identify specific OSS projects from sub-sector annotation; estimate feature introduction vintage; note specific repos/versions/commits where possible.
- **Sub-sector annotations required:**
  - Cryptography → OpenSSL, libsodium, NaCl, BoringSSL, Bouncy Castle (version history)
  - ML/AI → scikit-learn, TensorFlow, PyTorch, Keras, Caffe, Theano (feature introduction dates)
  - Databases → PostgreSQL, MySQL, SQLite, MongoDB, Redis (feature version history)
  - Distributed systems → Hadoop, Spark, Kafka, etcd, Zookeeper, Raft/Paxos implementations
  - *(expand per sub-sector)*

#### Q-S4 (Biotech/Chem): Genus Claim Enablement (Amgen)
- **Target level:** Super-sector (Biotech/Chem)
- **Input:** Claims, specification, working examples
- **Rubric:**
  - 1 — Narrow genus with many working species disclosed and strong structural commonality
  - 2 — Moderate genus with multiple species and identifiable structural features
  - 3 — Genus claim with some species disclosure but structural guidance is incomplete
  - 4 — Broad functional genus with limited species; structural guidance weak
  - 5 — Functional genus (e.g., antibodies by binding, compounds by activity) with few working examples and no unifying structural feature; *Amgen v. Sanofi* vulnerable
- **Reasoning requirements:** Count disclosed species, identify structural commonalities, assess PHOSITA's ability to reach full claim scope without undue experimentation.

#### Q-S5 (Mechanical/Hardware): Design-Around and Substitution Obviousness
- **Target level:** Super-sector (Mechanical/Hardware)
- **Input:** Claims, spec, cited art
- **Rubric:**
  - 1 — Claims capture novel mechanical principle not reducible to simple substitution
  - 2 — Novel configuration with some known elements
  - 3 — Claim combines known mechanical elements with non-obvious configuration
  - 4 — Claim relies on known elements in predictable configuration
  - 5 — Claim reads on specific implementation of well-known mechanical approach; vulnerable to substitution obviousness
- **Reasoning requirements:** Identify core mechanical principle; list known equivalents for each key feature.

### 5.3 Web-Search-Augmented Questions [Neutral-default]

These questions execute a web search stage and then LLM-rate based on evidence quality. If searches return nothing dispositive, return rating 3 with `confidence=none`. Distinguish "confident neutral" (searched thoroughly, nothing found) from "default neutral" (searches failed or inconclusive).

#### Q-U12: On-Sale Bar Exposure [Neutral-default]
- **Target level:** Universal
- **Search stage:** Queries assignee name + product category + year-range ending at critical date; SEC filings (10-K product listings); press releases; trade show archives; archived product announcement pages
- **Search sources:** Web search, SEC EDGAR, Internet Archive CDX API for product pages
- **Rubric:**
  - 1 — Strong evidence of no pre-critical-date offering (company founded after critical date; product line launched post-priority; documented first-ship dates post-critical)
  - 2 — Circumstantial evidence against pre-critical-date offering
  - 3 — Inconclusive (default neutral)
  - 4 — Some evidence of pre-critical-date product activity; feature match unclear
  - 5 — Clear documented evidence of pre-critical-date offering with features matching claim elements
- **Reasoning requirements:** List URLs consulted with dates; quote or describe specific evidence; if 3, describe what was searched and why inconclusive.
- **Confidence field required.**

#### Q-U13: Printed Publication Bar (Inventor Publications) [Neutral-default]
- **Target level:** Universal
- **Search stage:** Semantic Scholar and Google Scholar author search on each named inventor; date-filter to publications before critical date; filter by topical relevance using LLM classification of titles/abstracts
- **Search sources:** Semantic Scholar API, arXiv API, Google Scholar (scraped with care), DBLP for CS inventors
- **Rubric:**
  - 1 — Inventor publications clearly post-critical-date or on unrelated topics
  - 2 — Pre-critical inventor publications exist but on clearly unrelated subjects
  - 3 — Inconclusive — pre-critical publications exist with uncertain topical overlap (default neutral)
  - 4 — Pre-critical inventor publications on closely related subjects; partial disclosure concern
  - 5 — Pre-critical inventor publication appears to disclose the claimed subject matter; § 102(a)/(b) bar concern
- **Reasoning requirements:** List publications consulted with dates and titles; for any rated 4–5, quote abstracts and map to claim elements.
- **Confidence field required.**

#### Q-U14: Pre-Priority Commercial Implementation Risk [Neutral-default]
- **Target level:** Universal (may annotate at sub-sector with product landscape)
- **Search stage:** Cross-reference internal product intelligence layer for pre-priority products in CPC-adjacent categories; Wayback Machine CDX API to verify product page snapshots before priority date; LLM assessment of feature overlap between claimed elements and archived product descriptions
- **Search sources:** Internal product database, Wayback Machine CDX API, web search with `before:` operators
- **Rubric:**
  - 1 — Claimed technology clearly ahead of commercial state of art; no comparable products before priority
  - 2 — Products existed in adjacent space but with material feature gaps
  - 3 — Inconclusive — similar products existed with unclear feature overlap (default neutral)
  - 4 — Products with substantial but not complete feature overlap documented before priority
  - 5 — Commercial products with matching feature set documented before priority date via archived pages
- **Reasoning requirements:** List products from internal DB and archived URLs consulted; include Wayback snapshot dates; element-by-element analysis for any 4–5 rating.
- **Confidence field required.**

#### Q-U15: Candidate Anticipatory References [Neutral-default]
- **Target level:** Universal
- **Search stage:** LLM decomposes independent claim into searchable element combinations; generates queries; executes against Google Patents, Semantic Scholar, arXiv, GitHub (pre-priority-date filter), IEEE abstracts; LLM assesses top candidates for claim-element coverage
- **Search sources:** Google Patents, Semantic Scholar, arXiv, GitHub search API, IEEE metadata
- **Rubric:**
  - 1 — Searches thorough; no close candidates found
  - 2 — Candidates exist but with substantial gaps across multiple claim elements
  - 3 — Inconclusive — candidates found with uncertain element overlap (default neutral)
  - 4 — One or more candidates cover most claim elements with minor gaps
  - 5 — Candidate reference appears to disclose all or nearly all claim elements before priority
- **Reasoning requirements:** List candidate references with URLs, publication dates, and element-by-element analysis for ratings 3+.
- **Confidence field required.**
- **Note:** This is a red-flag detector, not a defensible prior art search. High false-positive tolerance acceptable.

### 5.4 Sub-Sector Annotation Types

Rather than new questions, sub-sectors contribute **annotations** that sharpen super-sector question answers:

- **`standards_context`** — authoritative standards list with publication dates (feeds Q-S2)
- **`oss_reference_implementations`** — OSS projects and feature vintage (feeds Q-S3)
- **`product_landscape`** — commercial products in the narrow tech area before common priority dates (feeds Q-U14, Q-S5)
- **`art_specific_obviousness_patterns`** — e.g., in pharma: bioequivalence rationales, enantiomer obviousness; in mechanical: material/fastener substitution patterns; in electronics: well-known circuit equivalents
- **`claim_construction_hot_spots`** — terms that tend to be construed narrowly or broadly in this sub-sector, informing Q-U1 and Q-U7

---

## 6. Composite Scoring

### 6.1 Risk Dimension Aggregation

Individual question ratings aggregate into a **Prior Art Risk composite** for each patent. Proposed structure:

**Four sub-dimensions:**
1. **Anticipation risk** — weighted avg of Q-U5, Q-U15, Q-U14 (commercial implementation), Q-API-5 (foreign search differential)
2. **Obviousness risk** — weighted avg of Q-U2, Q-U3, Q-U4, Q-S1 (for software), Q-S3 (OSS), Q-S5 (mech substitution), Q-API-1 (prosecution turbulence), Q-API-2 (search depth)
3. **§ 112 / priority risk** — weighted avg of Q-U1, Q-U6, Q-U7, Q-U8, Q-S4, Q-API-4
4. **Statutory bar risk** — weighted avg of Q-U12, Q-U13

**Confidence weighting:** Questions returning `confidence=none` contribute with reduced weight (suggested 0.25x) so that default neutrals don't dilute high-confidence signals.

**Family signal (Q-API-3)** feeds as a multiplier on the composite — strong foreign invalidation signals are the closest thing we have to ground truth and should influence the whole risk score, not just one sub-dimension.

### 6.2 Integration with Overall Patent Score

Recommended: Prior Art Risk enters the overall patent score as a **multiplicative penalty above a threshold** rather than additive.

**Rationale:** Invalidity in litigation is effectively binary — a patent with high invalidity risk is worth a small fraction of a clean patent given IPR defense costs and enforcement uncertainty, not a proportionally reduced amount.

**Proposed mechanic:**
- Composite prior art risk ≤ 2.5: no penalty (multiplier = 1.0)
- Composite 2.5 – 3.5: linear penalty (multiplier 1.0 → 0.7)
- Composite 3.5 – 4.5: steeper penalty (multiplier 0.7 → 0.3)
- Composite > 4.5: flag for manual review before any litigation investment (multiplier 0.2)

Weights and thresholds are hypotheses for initial deployment; calibrate with IPR outcome data (see Section 9).

---

## 7. Short-Term Focus Area Implementation

### 7.1 Scope

Deploy the question bank **within focus areas only**, not portfolio-wide. Each focus area is typically aligned with a litigation target sector (e.g., "Cloud Security Litigation Targets," "Video Codec SEP Candidates").

### 7.2 Per-Focus-Area Configuration

Each focus area maintains:

- **`pa_risk_question_set`** — the subset of the canonical question bank applicable to this focus area's technology
- **`focus_area_annotations`** — tech-specific annotations (standards lists, OSS projects, product landscape) that would be sub-sector annotations in the long-term design
- **`web_search_enabled`** — flag per web-search question (Q-U12, Q-U13, Q-U14, Q-U15); may disable for cost control in large focus areas
- **`confidence_threshold`** — minimum evidence quality required for non-neutral ratings on web-search questions

### 7.3 Canonical IDs Preserved

All questions use canonical IDs from Section 5 even when tailored in focus area context. This ensures:

- Focus area results can promote to taxonomy without relabeling
- Cross-focus-area analysis remains possible for shared questions
- Audit trail of which version of the question rubric was used when

### 7.4 Focus Area Question Tailoring Allowed

Per-focus-area customizations:

- Rubric refinement (e.g., clarifying language for a specific tech area) — must preserve 1–5 scale semantics
- Additional reasoning requirements (e.g., "cite specific OSS repo URLs" for a software focus area)
- Annotation injection (e.g., pre-loaded standards list for a crypto focus area)

Tailoring NOT allowed:

- Changing the rating semantics (5 must always = highest risk)
- Renaming or re-scoping questions (would break the promotion path)
- Adding questions that don't map to the canonical bank — if a net-new question emerges in a focus area, add it to the canonical bank first with a new ID, then use it

### 7.5 Execution Flow

For each patent in a focus area:

1. **ODP metric refresh** — ensure ODP data is current; compute/refresh Q-API-1 through Q-API-5
2. **EPO OPS enrichment** — pull family data if not cached; refresh Q-API-3 and Q-API-5
3. **Universal LLM questions** — run Q-U1 through Q-U8 with patent text + ODP context
4. **Super-sector LLM questions** — run applicable Q-S* based on focus area tech
5. **Web-search-augmented questions** — run Q-U12 through Q-U15 with focus-area-provided context
6. **Compute composite** — per Section 6
7. **Persist results** — ratings, reasoning, confidence, source URLs, search queries used

### 7.6 CSV Export

Focus area CSV export extends to include:

**Per patent rows:**
- All canonical question ratings with reasoning (columns: `Q-U1_rating`, `Q-U1_reasoning`, `Q-U1_confidence`, ...)
- ODP-derived features (cited reference counts, prosecution event counts, examiner, key dates)
- Focus area annotations that were injected (for provenance)
- Composite sub-dimension scores
- Overall prior art risk composite
- Search URLs consulted for web-search questions

**Purpose:** enables input to third-party tools (Patlytics, prior art search vendors, outside counsel review) with full reasoning and provenance.

---

## 8. Long-Term Taxonomy Implementation (Target Architecture)

### 8.1 Design Principles

1. **Questions at the highest stable level** — Universal questions live at the root; super-sector questions in sector branches; no duplication
2. **Sub-sector provides annotations, not new questions** — keeps the question count manageable and preserves cross-sector comparability
3. **Inheritance aggregates at evaluation time** — for any patent, traverse taxonomy from root to its finest classification and collect all questions and annotations
4. **Rubrics versioned** — question rubric changes create new versions; old ratings preserved for audit; re-rating triggered when rubric version advances
5. **Question bank is the source of truth** — focus area questions are views into the question bank, not copies

### 8.2 Migration Path from Focus Area to Taxonomy

Once focus area results demonstrate stable signal:

1. **Promote questions** — a question showing consistent signal across multiple focus areas is promoted to its target level (Universal or Super-sector)
2. **Backfill portfolio** — when a question promotes, run it across the entire portfolio of applicable patents; this is the re-scoring event
3. **Promote annotations** — focus-area annotations become sub-sector annotations in the taxonomy
4. **Retire focus-area-specific versions** — after backfill, focus areas inherit the taxonomy question rather than using a local copy

### 8.3 Governance

- **Question bank review cadence** — quarterly review of question rubrics against observed outcomes
- **Calibration cycles** — when IPR outcome data or litigation outcome data is available, tune weights and thresholds
- **Rubric change protocol** — any rubric change requires version increment and re-scoring of affected patents

---

## 9. Deferred and Missing Data Sources

Document these gaps in the implementation so they can be filled as budget and priority allow.

### 9.1 High-Value Deferred Sources

**Claim-level prosecution text (office action content, amendment diffs, examiner remarks)**
- **Why it matters:** enables precise answers on prosecution history estoppel, claim narrowing, and which references drove specific amendments; would substantially improve Q-API-1, Q-U2, Q-U5
- **Options:**
  - **Patent Bots** — fastest onboarding (days), REST API, prosecution-focused, accessible pricing (~low hundreds/month starting). Recommended first commercial source.
  - **Juristat** — enterprise-grade examiner and prosecution analytics, slower onboarding, annual contracts
  - **LexisNexis PatentAdvisor** — similar to Juristat; enterprise
  - **USPTO ODP + in-house OCR/LLM pipeline** — free, full control, but requires build effort (2–4 weeks for MVP including QA). Recommended for bulk coverage; complement with Patent Bots for convenience on high-priority patents.

**IPR and litigation outcome data**
- **Why it matters:** ground truth for calibrating risk scores; enables modeling "IPR institution probability" and "invalidity-on-merits probability" as separate dimensions
- **Options:**
  - **PTAB end-to-end data (free, USPTO)** — requires parsing; covers IPR filings, institutions, final written decisions
  - **Lex Machina** — structured litigation outcomes; enterprise pricing
  - **Docket Navigator** — similar scope
  - **RPX** — focused on NPE and aggregator litigation

**Full-text technical publications**
- **Why it matters:** abstracts miss the specific disclosures that matter for anticipation
- **Options:**
  - **IEEE Xplore subscription** — critical for electronics/comms
  - **ACM Digital Library subscription** — critical for software and CS
  - **IP.com prior art database** — defensive publications, often missed by examiners

**Standards full text**
- **Why it matters:** standards documents are often dispositive prior art in SEP-adjacent tech
- **Options:**
  - **IETF RFCs (free)** — already accessible
  - **3GPP specs (free from 3GPP.org)** — accessible, sometimes fiddly to parse
  - **IEEE 802 standards (paid individually or subscription)**
  - **ETSI (varies; many free)**

**Historical product databases**
- **Why it matters:** dated product specs strengthen on-sale bar analysis
- **Options:**
  - **S&P Global (formerly IHS Markit)** — consumer electronics, automotive
  - **Industry-specific databases** per sub-sector

### 9.2 Free Sources to Add to Integration Roadmap

- **EPO OPS** — high priority; enables Q-API-3, Q-API-5, and improves Q-U11
- **Semantic Scholar API** — high priority; enables Q-U13, Q-U15
- **arXiv API** — medium priority; strong for ML/AI patents
- **GitHub Search API** — medium priority; strong for software patents
- **Internet Archive CDX API** — high priority; enables Q-U12, Q-U14
- **DBLP** — medium priority for CS inventors

---

## 10. Complete Question Inventory (Ultimate Target Set)

For reference, the complete question set the system should ultimately support, across all implementation stages:

### Available now (LLM + current data)
- Q-U1 Claim Breadth and Functional Language Risk
- Q-U2 Predictable Combination Risk (KSR)
- Q-U3 Problem-Solution Obviousness
- Q-U4 Secondary Considerations Evidence
- Q-U5 Claim Element Novelty Concentration
- Q-U6 Priority Chain Vulnerability (LLM-assessed)
- Q-U7 Written Description for Functional Features
- Q-U8 Numerical Range Criticality
- Q-S1 § 101 Abstract Idea Overlap (Software)
- Q-S4 Genus Claim Enablement — Amgen (Biotech/Chem)
- Q-S5 Design-Around Substitution Obviousness (Mechanical)

### Available now (ODP API + EPO OPS)
- Q-API-1 Prosecution Turbulence Score
- Q-API-2 Examiner Search Depth Proxy
- Q-API-3 Family Invalidation Signal (requires EPO OPS)
- Q-API-4 Priority Date Vulnerability Indicator
- Q-API-5 Foreign Search Report Differential (requires EPO OPS)

### Available now (web search + free APIs)
- Q-U12 On-Sale Bar Exposure (Wayback, SEC, web search)
- Q-U13 Printed Publication Bar (Semantic Scholar, arXiv, Scholar)
- Q-U14 Pre-Priority Commercial Implementation Risk (Wayback, internal product DB)
- Q-U15 Candidate Anticipatory References (Google Patents, Semantic Scholar, arXiv, GitHub)
- Q-S2 Standards Relevance (Software) — requires sub-sector annotation
- Q-S3 Open Source Implementation Risk (Software) — requires sub-sector annotation

### Deferred pending paid data
- **Q-PROS-1** Prosecution Amendment Narrowing — requires claim amendment text; rates the degree to which claims were narrowed from original filing, informing prosecution history estoppel and nearness of prior art
- **Q-PROS-2** Examiner Argument Quality — requires office action text; rates whether the examiner's rejection arguments were robust (suggesting the art is close) or weak (suggesting the patent survived a thin review)
- **Q-PROS-3** Interview Summary Signals — requires examiner interview summaries; rates whether interview amendments were substantive
- **Q-IPR-1** IPR Target Profile — requires PTAB data; rates likelihood of IPR filing based on patent characteristics and historical patterns
- **Q-IPR-2** Invalidation Base Rate (CPC + claim characteristics) — requires PTAB and litigation outcome data; provides actuarial baseline

### Future expansion (taxonomy sub-sector annotations)
- Standards corpora by sub-sector (for Q-S2)
- OSS project landscape by sub-sector (for Q-S3)
- Product landscape by sub-sector (for Q-U14, Q-S5)
- Art-specific obviousness patterns by sub-sector
- Claim construction hot spots by sub-sector

---

## 11. Implementation Phases

### Phase 1 (short-term, focus area delivery) — Weeks 1–4
- Implement Q-API-1, Q-API-2, Q-API-4 (ODP-only, no new integration)
- Implement Q-U1, Q-U2, Q-U3, Q-U4, Q-U5, Q-U7, Q-U8 (universal LLM, no external data)
- Implement focus-area-tailored versions of applicable super-sector questions (Q-S1, Q-S4, Q-S5) as relevant to launched focus areas
- CSV export extension
- Composite scoring v1

### Phase 2 — Weeks 5–8
- EPO OPS integration
- Q-API-3, Q-API-5
- Q-U6 (LLM priority chain assessment; requires priority document text)
- Q-U11 family invalidation LLM assessment complementing Q-API-3

### Phase 3 — Weeks 9–14
- Web search question infrastructure with confidence framework
- Semantic Scholar, arXiv, GitHub, Wayback Machine CDX integrations
- Q-U12, Q-U13, Q-U14, Q-U15
- Q-S2, Q-S3 with initial focus-area annotations for launched areas

### Phase 4 — Weeks 15+
- Taxonomy promotion of stable focus-area questions
- Sub-sector annotation framework
- Portfolio-wide backfill
- Patent Bots evaluation and integration (or USPTO ODP OCR/LLM pipeline) for deferred Q-PROS-* questions

### Phase 5 — Quarter+
- PTAB data integration
- Calibration against IPR outcomes
- Q-IPR-* questions

---

## 12. Open Design Questions

These are worth discussing before or during implementation:

1. **Neutral-default weighting in composite** — current proposal is 0.25x weight for `confidence=none`; validate against early results
2. **Question rubric versioning storage** — should rubric versions be in-code, in-database, or both?
3. **Search cost controls** — web-search questions incur API costs; per-focus-area budget caps vs. per-patent caps?
4. **Manual override path** — how do analysts override an LLM rating when they have domain knowledge the LLM lacks? Preserve LLM rating as separate field; add `analyst_rating` + `analyst_reasoning`?
5. **Reasoning field quality enforcement** — should we require structured reasoning fields (e.g., must include URL for web-search questions, must quote spec passages for written description questions)?
6. **Composite multiplier shape** — the multiplicative penalty curve is a hypothesis; worth revisiting after 50–100 patents of results.

---

## Appendix A: Legal Reference Summary

Key cases and statutes referenced in question rubrics:

- **35 U.S.C. § 101** — patent-eligible subject matter
- **35 U.S.C. § 102** — novelty and statutory bars
- **35 U.S.C. § 103** — obviousness
- **35 U.S.C. § 112(a)** — written description and enablement
- **35 U.S.C. § 112(b)** — definiteness
- ***KSR v. Teleflex***, 550 U.S. 398 (2007) — flexible obviousness standard
- ***Graham v. John Deere Co.***, 383 U.S. 1 (1966) — obviousness factors
- ***Alice Corp. v. CLS Bank***, 573 U.S. 208 (2014) — § 101 two-step framework
- ***Enfish v. Microsoft***, 822 F.3d 1327 (Fed. Cir. 2016) — technical improvement pattern
- ***DDR Holdings v. Hotels.com***, 773 F.3d 1245 (Fed. Cir. 2014) — internet-specific technical problem
- ***Helsinn v. Teva***, 586 U.S. ___ (2019) — on-sale bar includes secret sales
- ***Amgen v. Sanofi***, 598 U.S. 594 (2023) — genus claim enablement
- ***Nautilus v. Biosig***, 572 U.S. 898 (2014) — definiteness standard
- **MPEP 2144.05** — obviousness of ranges

This appendix is informational; the system does not render legal advice. Scoring reflects risk probabilities for triage, not legal conclusions.

---

**End of Specification**
