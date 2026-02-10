<Introduction>
Note in this doc we are using XML style section delimiters like <Introduction> and </Introduction>

First order of business, lets read this document and organize it with other documents describing past learning and design issues into a more strucutre development queue.

We are evolving this application from a broadcom specific patent portfolio system using purely file storage (json, etc.) to a database based service, and ultimately to a GUI multi-tiered system.

Our immeidate goals are to formalize the file-cache of any API calls and LLM calls we do in conjunction with a database schema (that will evolve to support GUI) that starts minimally to support our request caching, so we can immediately start filling in the cache (which likely will need to run overnight to fill out portfolio).

<Introduction>



<Overall Design Goals>

We have been running this system using persisted json and now we need to change to use a database, postgres running in docker.  We will have a GUI and a server going forward, but for the next steps we simply want to persist all data that has been stored locally in json and/or other formats in the relational database.  All data we retrieve through api can be saved locally as well as the result of LLM prompts.

We already have laid a groundwork for a schema but we should consider some additional design points:

1) Any ratings/rankings we are using to create a combined score are typeically integer rankings - and we can keep that for now, but we should store as float so we have the flexibility of more precision.  Our overall score is currently a float but is calculated as some type of weighted average with variants of multiplicative terms and additive with weights.  

2) We have the notion of affiliates and competitors currently and should keep that.  We might weigh citations from competitors vs. non competitors vs. affiliates differently.  A company would be promoted to be a competitor based on a theshhold of citations over the entire portfolio, affiliates are clear from the assignee patterns of the subsidiaries of broadcom (our initial porffolio for testing the system - there could be others in the future, so this needs to be designed into the system, but for now it is all broadcom portfolio data for testing).

We will need to rerun our previous rankings but using the database oriented design - we first want to recreate our previous results to ensure functionality of the system (unless we find that previous results were incorrect), we will use those results as a baseline.

Previously we had issues merging in the VMWare patents where they were done at a later time, since we did not have complete assignees mapped.  Once we were considering VMWare patents - we had some issues running stats with them in and out of the dataset.  And once we ran with the VMWare patents in place, with the v3 calculations, they seem to dominate the set.  In recent discovery, we realize that VMWare patents often cite their own patents - and we would like concequently to have a different weight on citations within the affiliate pool. 

So for short term - we sould like to be able to recreate previous results but with data persisted in database.

Then we would like to run alternate scoring algorithms once data is downloaded, so we can experiment with scoring without additional api or LLM calls.

Also need to be able to persist in a json format that can be imported/exported into other database instances, so we can set up multiple instances of this system by exporting/importing a json dump of all data

</Overall Design Goals>




<Third Party Systems>
We want to correlate, display, and store data from 3rd party vendors such as patlytics (see patlytics Batch 1.1 9 Patents.xlsx for sample of data returned)

Our system will be a central hub to evaluate our portfolio including sending some patents to 3rd party tools to retrieve additional information that can be synthesized into our data.  The first example is patlytics with an example spreadsheet included in context.

We will also be interfacting with &AI - another patent analysis platform which should produce claim charts that might be used for an initial litigation package.

</Third Party Systems>



<LLM dependencies>

We might do 2nd order LLM questions on sector specific, workflow with the first, once we know initial LLM answers perhaps this includes establishing sector, lets re-address how this is done.

We currently have two different phases of LLM data - 1) general, across sector, and then 2) sector specific.  We will likely expand this notion into more complex workflows including continuously improving sector assignment, so with that sophistication, we will need more LLM job state management.

</LLM dependencies>



<result caching>

First, we should create a local cache of json definitions of patent data from uspto and any other endpoints we use including for IPR, PTAB, citation data, etc.

Let's create a naming convention using a unique ID like the patent id and any additional file pattern depending on which type of patent data being cached.

The format of the json should be such that we capture all data from the api, so we do not need to access it again once downloaded.

But we should also have the ability to iterate and change our database schema, mapping to this jaon format.  Thus, we can download any information from the uspto and related apis (may also apply to any other apis we access in the future), and we maintain a local cache tied to the data format at the time of the download.


We may iterate our schema design many times to support our GUI including abstracting data attributes into facets rather than fixed fields on database tables.

For the initial implementation, we want simplicity to quickly match our previous release that did calculations only based on the metrics we established for v2 and v3 scoring.  We might have separate database tables to capture these metrics that have a one to one relationship with the main patent table - so that we might replace at a later date and we do not need to change the patent table too often.  We might have several ancillary tables linked via relationships using the MTI pattern of prisma so that we do not load too many fields in the patent table - rather put different fields in related tables that might change independently of the patent table.


In addition, our LLM calls should be cached so that if I am importing the system on another machine, all responses can be re-used without execution.  We are running on development machines largely, and the results we accumulate will be exported to a server to run the actual application.

</result caching>


<Classification of Companies>
Definition of assignees


Definition of competitors - Across the portfolio, when we have passed a threshold of citations from one company, we can elevate the status of that company to a competitor.


Note that for major companies, we maintain a map of assignee names to the company name.  We should evaluate variants as we go, report on new variations, and maintain our mappings of assignee names to company names that might be affiliates or competitors.  We already have in our config assignee variants, competitors, affiliates, etc.  Let's just abstract this a bit further to have the notion of a company with assignee variants that might be an affiliate, a competitor, or a neutral party (below a threshold where they are considered a competitor).


Use the sample spreadsheets provided to show competitors that we expect to find, we just need to recreate the compatitor mappings and the affiliate mappings and pay special attention to new companies that are neither and incrementally evaluate where they belong (affiliate, competitor or neutral).  Consider in the future we might have a more continuous view of affiliates vs. competitors, may have competitors within a sector only, or have a situation specific view on whether a company is an affiliate or competitor (for example if evaulating possible patent pools with different M&A scenarios of companies).

</Classification of Companies>


<Sector Expansion>

We may over time evolve towards multiple sectors per patents with membership based on cpc code, LLM questions, and/or search terms present in title or abstract.  We might use a combination of those factors .  For now, we can assign sectors as before, having a default based on CPC codes so that all patents have a sector - but then more specific sectors may emerge based on search terms or a combination of factors.  We will likely run sector expansion or perhpas a better term would be sector refactor - since we might alter our overall sector assignements as we get more data in.  We can do more advanced search term expansion that can pull more meaningful and unique search terms from abstracts, titls, claims, associated product information, etc. over time.  For now, just document the design vision and we will recreate our previous results before doing rassignments and recalculations.

For now, we might enhance our sector expansion by observing adjacent sectors, and having additional attributes for secondary and tertiary sectors for a given patent.  We could use LLM questions to establish additional sectors based on a ranking by the LLM of how the patent may fit in various sectors.

Likely, we will have loops where we can find sectors based on search term extraction from patent abstract and other text, including defaults mapped from CPC codes.  We could then propose possible sectors for various patents based on the presence of search terms, and then have the LLM rankings measure the suitability of sectors as primary or otherwise (secondary, tertiary and beyond are more like facet style attributes that can aid with association, but not a primary category schema like the initial sector - which we want to have at least one sector and super-sector for all patents).  We might ask the LLM to suggest alternate sectors as we do the expansion as well.

Also to note in prvious efforts, we did sector expansion with individual scripts and code-embedded search terms.  We should be able to refactor all this code and just extract the search terms into metadata (can be stored ultimately in database, or json in the interim - but we do not want the search terms used embedded in code, and we do not want a proliferation of code files to expand each sector - lets refactor this.

</Sector Expansion>


<multiple schema design>

We might maintain multiple schema files:
1) ip-port-facet - facet database for ip-port project
2) ip-port-llm - llm workflow schema
3) ip-port - has patent and file cache information
4) ip-port-cache - to maintain api and llm file cache to obviate need to rerun calls on different dev machines

These schema breakouts seem logical, but lets explore the separation based on relationships, etc.

We have included in context jud-tran-schema.prisma .  This is an example schema file from another project, it has LLM workflow and facet schema elements that can be used as models - in the future these systems may coexist in a larger application.  But also, use basic patterns there (e.g., auto-increment, MTI, relationship patterns, etc.)


I am including in the context a schema from the judicial-transcripts project.  We might use as design inspriration the facet section of the schema and the workflow state for LLM jobs.  We will want to expand our ip-port projects to have both multi-stage LLM calls and facet calculations, where we can create new facets on the fly (without database schema changes), and use them in data results, GUI displays, filters, etc.

</multiple schema design>


<baseline results>

We want to recreate our previous results to make sure our changes have not adversely affected the ability to score patents - but also lets be open to the possiblity that some of our past anslysis was incorrect or incomplete and evaluate current assumptions as we move forward.  We did seem to have trouble merging VMWare data after initially missing those assignees - it was unclear whether we correctly balanced that data vs. previous data.  Also, we may have biased our sector breakout based on the natural order in which we built the system.

The baseline results are meant to just make sure we have basically maintained functionality from previous versions as we expand our capabilities.

See the following context files for results from a recent run:

heatmap-batches-v2-LATEST.json
SECTOR-MAPPING-LATEST.csv
TOPRATED-2026-01-21.csv
TOPRATED-V2-2026-01-21.csv

</baseline results>


<Competitor Classification — Formal Criteria>

Updated: 2026-01-26 (Session 13)

The system classifies every company (assignee) into exactly one of three categories:
Affiliate, Competitor, or Neutral. This classification drives citation weighting in scoring,
portfolio overlap analysis, and strategic targeting.

## Definitions

### Affiliate
An entity within the portfolio owner's corporate family. For the Broadcom portfolio:
- Direct subsidiaries: VMware, Avago, LSI, Symantec, CA Technologies
- Acquired entities: Nicira, Carbon Black, Pivotal, Brocade, Blue Coat, Avi Networks, Lastline, Nyansa
- Defined via `excludePatterns` in `config/competitors.json`
- Assignment is **deterministic** — based on known corporate structure
- Affiliates do NOT change based on analysis; they change with M&A events

### Competitor
An entity with demonstrated interest in the portfolio's technology, evidenced by citation
activity. A company becomes a competitor through any of these paths:

1. **Citation Threshold** (Primary): The company's assignee(s) cite portfolio patents
   N or more times across the portfolio. Current threshold: defined per discovery strategy
   in `config/competitors.json` (131 companies).

2. **Discovery Strategies** (how competitors were found):
   - `manual-initial`: Industry knowledge — direct market competitors (Cisco, Intel, Samsung, etc.)
   - `citation-overlap-broadcom-streaming`: Forward citation overlap on 15,276 Broadcom streaming patents
   - `term-extraction-avago-av`: ES term extraction on 923 Avago A/V patents
   - `hybrid-cluster-*`: Agglomerative clustering of top litigation patents by CPC + term affinity
   - `product-discovery-*`: Sector-specific product research identifying implementers

3. **Manual Promotion**: User designates a company as competitor based on strategic analysis

### Neutral
All other assignees — below the citation threshold, no manual designation, and not an
affiliate. The neutral pool includes:
- Small companies with incidental citations
- Academic/research institutions
- Government entities
- Individuals

## When Does a Company Become a Competitor?

The formal criteria should combine:

### Quantitative Signals
- **Forward citation count**: >=N citations of portfolio patents (portfolio-wide)
  - Proposed threshold: >=10 citations across portfolio, OR >=3 in any single sector
- **Sector citation density**: High citation rate within a specific sector even if
  portfolio-wide count is below threshold
- **Citation reciprocity**: We cite them AND they cite us (mutual awareness)

### Qualitative Signals
- **Market overlap**: Companies operating in the same product markets
- **Litigation history**: Prior patent disputes with portfolio owner
- **Industry reports**: Named as competitor in market analysis
- **LLM-identified implementers**: `likely_implementers` field from V3 analysis

### Sector-Specific Competitors
Future: A company may be a competitor in one sector but neutral in others.
- Intel may be a competitor in `network-switching` but neutral in `rf-acoustic`
- This requires per-sector competitor lists or sector-tagged competitor records
- Design: Add optional `sectors[]` to competitor definition, empty = all sectors

### Competitor Confidence Levels
Future: Rather than binary competitor/neutral, assign a confidence score:
- 1.0 = Definite competitor (litigation target, top citator)
- 0.7 = Likely competitor (moderate citation overlap, same market)
- 0.4 = Possible competitor (some citations, adjacent market)
- 0.0 = Neutral (below threshold, no market overlap)

This enables continuous weighting rather than hard cutoffs in scoring.

## Current Implementation
- `config/competitors.json` — 131 companies with discovery strategy provenance
- `config/competitors.json` `excludePatterns` — affiliate patterns
- `scripts/classify-citations.ts` — three-way classification using these lists
- Output: `cache/citation-classification/` + `output/citation-classification-*.json`

## Open Questions
- Should the citation threshold be portfolio-wide or per-sector?
- Should we auto-promote companies above a threshold in the GUI?
- Should competitor status be revocable (company acquired, exits market)?
- How to handle companies that are both affiliates AND competitors in M&A scenarios?

</Competitor Classification — Formal Criteria>


<Citation-Aware Scoring Design>

Updated: 2026-01-26 (Session 13)

## Problem Statement

The current scoring system uses `forward_citations` (total) and `competitor_citations`
as two separate scoring inputs. This fails to account for:
1. **Self-citation inflation**: VMware patents cite each other at 16.5% vs 1.7% for non-VMware
   (documented in CITATION_CATEGORIZATION_PROBLEM.md)
2. **Backward citation signals**: Patents that cite many competitor patents indicate
   the technology is rooted in competitive space
3. **Citation quality**: Not all citations carry equal strategic weight

## Current Citation Data Available

| Metric | Direction | Coverage | Source |
|--------|-----------|----------|--------|
| `total_forward_citations` | Forward | 100% | PatentsView API |
| `competitor_citations` | Forward | 100% | classify-citations.ts |
| `affiliate_citations` | Forward | 100% | classify-citations.ts |
| `neutral_citations` | Forward | 100% | classify-citations.ts |
| `competitor_count` | Forward | 100% | Distinct competitor companies citing |
| `backward_citations` (parents) | Backward | 9% (2,000 patents) | enrich-citations.ts |
| `parent_details` | Backward | 11,706 parent records | enrich-citations.ts |

## Proposed Citation Scoring Model

### Forward Citations (External Validation)

Forward citations measure external interest in a patent's technology. Different
sources of citations carry different strategic weight:

```
adjusted_forward = (
  competitor_forward × W_competitor +     // High value: competitors use this tech
  neutral_forward × W_neutral +           // Moderate: general interest
  affiliate_forward × W_affiliate         // Low: self-interest
)

Proposed weights:
  W_competitor = 1.5   (competitor citations are 50% more valuable)
  W_neutral = 1.0      (baseline)
  W_affiliate = 0.25   (deeply discounted — self-citation)
```

**Rationale**:
- Competitor citations signal that competitors are building on or around this technology —
  strong indicator of licensing/litigation potential
- Affiliate citations primarily reflect internal R&D continuity, not external market validation
- The 0.25 weight for affiliates is conservative; could go to 0.0 for pure external scoring

### Competitor Citation Density (Strategic Signal)

Beyond raw count, the **concentration** of competitor interest matters:

```
competitor_density = competitor_forward / (competitor_forward + neutral_forward)
```

High density = technology is squarely in competitive space.
Low density = broad but non-competitive interest.

This could be a standalone scoring input (0-1 normalized).

### Backward Citations (Technology Foundation)

Backward citations show what technology a patent builds upon. For scoring:

```
backward_competitive_signal = competitor_backward / total_backward
```

If a patent cites many competitor patents, it means:
- The technology area has heavy competitor activity
- The patent may be "sandwiched" between competitor prior art (risk factor)
- OR the patent improves on competitor technology (enforcement opportunity)

**Scoring impact**: Backward citations should primarily be a **risk/opportunity** signal
rather than a direct score component. Suggested use:

- `backward_competitor_ratio > 0.5`: Flag as "deep in competitive space" — high enforcement
  opportunity but also higher invalidity risk
- `backward_competitor_ratio < 0.1`: Technology is relatively unchallenged — potentially
  stronger validity but less clear infringement targets

### Combined Citation Score Proposal

```
citation_score = (
  // Primary: adjusted forward citations (external validation)
  normalized(adjusted_forward) × 0.50 +

  // Secondary: competitor count breadth (# distinct competitors citing)
  normalized(competitor_count) × 0.25 +

  // Tertiary: competitor density (how competitive is the space)
  competitor_density × 0.15 +

  // Quaternary: backward competitive signal (optional, when data available)
  backward_competitive_signal × 0.10
)
```

### Impact on VMware Dominance

The key intervention is the affiliate citation discount. With current data:
- VMware patents average 16.5% self-citation rate
- Some Nicira patents have 60-80% self-citations
- At W_affiliate = 0.25, a patent with 100 forward citations where 50 are affiliate:
  - Old: citation_input = 100
  - New: citation_input = (20 × 1.5) + (30 × 1.0) + (50 × 0.25) = 30 + 30 + 12.5 = 72.5
  - A 27.5% reduction — proportional to the self-citation inflation

### Implementation Phases

Phase 1 (Immediate):
- Use `adjusted_forward` in existing scoring service — replace raw `forward_citations`
- Add W_competitor, W_neutral, W_affiliate as configurable weights per scoring profile
- Recompute rankings and compare with current

Phase 2 (With Patent Family Data):
- Incorporate backward citation metrics as data coverage grows (currently 9%)
- Add competitor_density as a new scoring dimension
- Consider multi-generational citation metrics

Phase 3 (Advanced):
- Competitor confidence weighting (see Competitor Classification section)
- Sector-specific citation weights (competitor citations worth more in high-damages sectors)
- Time-decay on citations (recent citations more valuable than older ones)

</Citation-Aware Scoring Design>


<Conditional Facets — Sector-Specific LLM Questions via Facet System>

Updated: 2026-01-26 (Session 13)

## Design Goal

Enable sector or focus-group specific LLM questions that produce new facets.
These facets should:
1. Only appear as columns when viewing patents in the relevant sector/focus context
2. Be stored via the generic facet system (not hard-coded schema fields)
3. Support conditions that dictate when facets are expected to exist
4. Integrate with the existing V3 analysis pipeline via a decoupled second-pass approach

## Facet Condition Model

Each facet can have an optional `condition` that specifies when it is expected:

```typescript
interface FacetDefinition {
  key: string;                    // e.g., "sec_attack_vector"
  label: string;                  // "Attack Vector"
  type: 'string' | 'int' | 'float' | 'enum' | 'multi-enum' | 'bool';
  options?: string[];             // For enum/multi-enum types
  source: 'llm' | 'api' | 'user' | 'calculated';

  // Condition: when is this facet expected to be populated?
  condition?: FacetCondition;

  // Display
  group: string;                  // Column group in UI
  defaultVisible: boolean;        // Show by default when condition is met
}

interface FacetCondition {
  type: 'sector' | 'super_sector' | 'focus_area' | 'focus_group' | 'always';

  // Which sectors/groups activate this facet
  sectors?: string[];             // e.g., ["network-threat-protection", "network-auth-access"]
  superSectors?: string[];        // e.g., ["SECURITY"]
  focusAreaIds?: string[];        // Specific focus areas
  focusGroupIds?: string[];       // Specific focus groups

  // Display behavior
  showWhenFiltered: boolean;      // Show column only when filter matches condition
  showInDetail: boolean;          // Always show in patent detail (within relevant tab)
}
```

## Examples

### Security Sector Facets

```json
[
  {
    "key": "sec_attack_vector",
    "label": "Attack Vector",
    "type": "multi-enum",
    "options": ["network_intrusion", "malware", "phishing", "insider_threat",
                "data_exfiltration", "ddos", "credential_theft"],
    "source": "llm",
    "condition": {
      "type": "super_sector",
      "superSectors": ["SECURITY"],
      "showWhenFiltered": true,
      "showInDetail": true
    },
    "group": "Sector Analysis",
    "defaultVisible": true
  },
  {
    "key": "sec_zero_trust_alignment",
    "label": "Zero Trust Alignment",
    "type": "enum",
    "options": ["core_component", "compatible", "neutral", "contradictory"],
    "source": "llm",
    "condition": {
      "type": "super_sector",
      "superSectors": ["SECURITY"],
      "showWhenFiltered": true,
      "showInDetail": true
    },
    "group": "Sector Analysis",
    "defaultVisible": false
  }
]
```

### Video Codec Facets

```json
[
  {
    "key": "vid_codec_standard",
    "label": "Codec Standard",
    "type": "multi-enum",
    "options": ["h264_avc", "h265_hevc", "av1", "vp9", "vvc_h266", "none"],
    "source": "llm",
    "condition": {
      "type": "sector",
      "sectors": ["video-codec", "video-client-processing", "video-server-cdn"],
      "showWhenFiltered": true,
      "showInDetail": true
    },
    "group": "Sector Analysis",
    "defaultVisible": true
  }
]
```

## Column Visibility Rules

The GUI column selector should respect conditions:

```
1. User is viewing "All Patents" (no sector filter)
   → Show only unconditional columns (Core Info, Scores, LLM Text, Citations)
   → Sector-specific columns hidden from selector

2. User filters by sector = "network-threat-protection"
   → Show unconditional columns
   → ALSO show SECURITY super-sector facets in Column Selector
   → Facets with defaultVisible=true auto-appear

3. User selects a Focus Area with custom facets
   → Show unconditional columns
   → ALSO show focus-area-specific facets

4. Patent Detail page, LLM Analysis tab
   → Show all facets that have data for this patent, regardless of current grid filter
   → Group sector-specific facets under "Sector Analysis" sub-section
```

## LLM Execution Pipeline

Sector-specific LLM questions are executed as a **separate pass** from the generic V3
analysis (decoupled approach — see SECTOR_SPECIFIC_LLM_QUESTIONS.md):

```
Pass 1: Generic V3 (26 fields) — already running, 7,669 patents analyzed
Pass 2: Sector-specific (5-10 fields per sector) — separate LLM call per sector

Storage:
  cache/llm-scores/{patent_id}.json         → Generic V3 fields
  cache/llm-sector/{sector}/{patent_id}.json → Sector-specific fields
```

The API and GUI join these at read time. Patent detail page shows both.
The portfolio grid conditionally shows sector columns based on active filter.

## Facet Configuration Storage

Facet definitions are stored in JSON config (not code):

```
config/facet-definitions/
├── core-facets.json              # Always-available facets (from V3 analysis)
├── security-sector-facets.json   # SECURITY super-sector facets
├── video-sector-facets.json      # VIDEO super-sector facets
├── wireless-sector-facets.json   # WIRELESS super-sector facets
├── cloud-sector-facets.json      # CLOUD super-sector facets
└── custom/                       # User-created focus area facets
    └── {focus-area-id}.json
```

## Relationship to Existing Systems

- **Facet System** (FACET_SYSTEM_DESIGN.md): This extends the facet system with conditions.
  The PatentFacet table stores sector-specific facet values with source="llm" and
  sourceDetail pointing to the sector prompt version.

- **Sector-Specific LLM** (SECTOR_SPECIFIC_LLM_QUESTIONS.md): Defines the actual questions
  per sector. This design adds the UI/storage framework to make those results visible.

- **Focus Areas** (FOCUS_AREA_SYSTEM_DESIGN.md): Focus areas can define custom facets that
  follow the same conditional visibility pattern. Focus-area facets appear when viewing
  that focus area's patents.

## Implementation Priority

1. **Config-driven facet definitions** — JSON files defining available facets with conditions
2. **Backend facet API** — `GET /api/facets/schema` returns available facets for current context
3. **Frontend column resolver** — Column selector queries facet schema, shows conditional columns
4. **Sector LLM pipeline** — Run sector-specific prompts, store results in sector cache
5. **Join at read time** — Patent list/detail endpoints merge generic + sector facet data

</Conditional Facets — Sector-Specific LLM Questions via Facet System>


<GUI and Architecture Considerations — February 2026>

Updated: 2026-02-08

## Multi-Portfolio Support

The system is evolving to support multiple portfolios. Key design decisions:

1. **Portfolio Selector**: Most pages should have a portfolio selector at root level
   - Can implement incrementally as pages are enhanced
   - Initially disabled, defaulting to "broadcom" portfolio
   - Enable once end-to-end functionality is proven

2. **Data Isolation**: Each portfolio should have isolated:
   - Patent assignments
   - Sector configurations (or shared with overrides)
   - Competitor/affiliate definitions
   - LLM scores and analyses
   - Focus areas

3. **Shared Resources**: Some elements may be shared across portfolios:
   - CPC code definitions
   - Company name mappings (with portfolio-specific overrides)
   - Scoring template definitions (base templates)

## Performance Considerations

As the application scales, consider:

1. **Lazy Loading**:
   - Load patent lists with pagination, not full datasets
   - Defer loading of detailed data until needed
   - Use virtual scrolling for large lists

2. **Database Optimization**:
   - Move frequently-queried data from JSON caches to indexed database tables
   - Use materialized views for complex aggregations
   - Consider read replicas for heavy query loads

3. **Caching Layer**:
   - Introduce Redis for frequently-accessed, slowly-changing data
   - Cache API responses with appropriate TTLs
   - Cache computed aggregations (sector counts, score distributions)

4. **TopN Defaults**:
   - GUI pages should default to TopN (e.g., top 500)
   - Full dataset access via explicit "Load All" action
   - Prevents accidental loading of 28k+ patents

## Job Queue Integration

Current state:
- Job Queue page has "Sector Enrichment" functionality
- New LLM Scoring tab added to Sector Management page
- Need to clarify relationship between these features

Proposed resolution:
- **Job Queue**: For batch enrichment jobs (V2/V3 analysis, sector assignments)
- **Sector Management → LLM Scoring**: For sector-specific template scoring
- Long-term: Unify under a single "Analysis Jobs" system with different job types

## Sector Management UI Improvements

Issues identified:

1. **Icons**: Current folder/label icons look dated
   - Consider: category, folder_special, layers, workspaces for super-sectors
   - Consider: grain, memory, sensors, videocam for sector-specific icons

2. **Tree Scrolling**: Left pane scrolling loses sight of right detail pane
   - Solution: Fixed-height left pane with internal scroll
   - Or: Collapsible tree with better state management

3. **Sub-Sectors**: Not yet visible in the tree
   - Need to add expandable sub-sector level
   - Show sub-sector count, scoring progress

## Template Editor and Preview

Key features needed:

1. **Template Viewer**: Show merged questions from inheritance chain
   - Display: portfolio-default → super-sector → sector → sub-sector
   - Show which level contributed each question

2. **Template Preview**: Render prompt for a specific patent
   - Select patent from sector
   - Toggle claims inclusion
   - Show token count estimate
   - Preview full rendered prompt

3. **Template Test**: Actually send to LLM
   - Execute scoring on single patent
   - Show scores and reasoning response
   - Display token usage

</GUI and Architecture Considerations — February 2026>


<LLM Scoring Results and Template Editing — February 2026>

Updated: 2026-02-08

## Critical Priority: Viewing LLM Scoring Results

The most important near-term feature is the ability to **view and export LLM scoring results**
to verify quality. This includes:

1. **Results Table**: View scored patents with:
   - Composite score
   - Individual metric scores (from structured questions)
   - Reasoning text for each answer
   - Whether claims were included
   - Template version used

2. **Filtering and Comparison**:
   - Filter by sector, super-sector, score range
   - Compare results from runs with/without claims
   - Sort by individual metrics or composite score

3. **Export Capabilities**:
   - CSV export with all metrics and reasoning
   - Filter by score threshold before export
   - Include template metadata in export

**Backend Status**: Export endpoint exists at `GET /api/scoring-templates/export/:superSector`
which includes LLM metrics and reasoning. Scores stored in `patent_sub_sector_scores` table
with `metrics` JSON column containing per-question scores and reasoning.

## Sub-Sector Clarification

There are TWO types of "sub-sectors" in the system:

### 1. Defined Sub-Sectors (with structured questions)
Located in `config/scoring-templates/sub-sectors/`:
- virtualization.json
- packet-switching.json
- routing.json
- chip-packaging.json
- semiconductor-manufacturing.json
- semiconductor-test.json
- transistor-devices.json
- adc-dac.json
- amplifiers.json
- pll-clock.json
- modulation-demodulation.json
- baseband-equalization.json
- qos-traffic.json
- error-detection.json

These have domain-specific scoring questions that inherit from and extend their parent
sector's questions. For example, `virtualization` extends `computing-runtime` with
VM/hypervisor-specific questions.

### 2. Prospective Sub-Sectors (auto-generated CPC groupings)
These are CPC subgroup codes automatically identified as potential groupings within a sector.
Example: `analog-circuits` has 1,178 prospective sub-sectors like H03F3/45183, H03F2200/451.
These are candidates for manual review and refinement into proper sub-sectors with custom questions.

**Design Vision**: Sub-sectors should aggregate minor CPC codes (after the slash) within a sector,
similar to how sectors aggregate major CPC prefixes. Users would select which CPC subgroups
to combine into a named sub-sector, then define domain-specific scoring questions.

## Claims Integration Evolution

Current state:
- "Include Claims" toggle is temporary while backfilling scores without claims
- "Rescore Already Scored" useful for updating old scores with claims

Future state:
- Claims will be **required** for all sector scoring jobs
- Remove the include claims toggle
- Add **Context Template Selector** with options:
  - All claims (most comprehensive)
  - Independent claims only (focused)
  - Summarized claims (LLM-condensed for token efficiency)
  - Claims + product context (when available)
- May also affect base portfolio scoring to consider claims

## Interface Organization Questions

Current confusion:
1. **Sector Management** vs **Sector Enrichment** — unclear separation
2. **LLM Scoring tab** in Sector Management vs **Job Queue** for enrichment
3. **Prompt Templates page** — confusing with multi-stage templates

Proposed organization:

### Option A: Separate Concerns
- **Sector Management**: Define structure (super-sectors, sectors, sub-sectors, rules)
- **Scoring Templates**: View/edit scoring questions (read-only initially)
- **Job Queue**: Run all enrichment jobs (LLM scoring, prosecution, IPR, etc.)
- **Results Dashboard**: View scoring results, export, quality verification

### Option B: Consolidated Sector View
- Keep LLM Scoring in Sector Management for context
- Add "View Results" tab to show scored patents for selected sector
- Job Queue only shows running/queued jobs, not initiation

### Multi-Stage Template Complexity
Prompt Templates page handles multiple object types:
- Patent-level (single patent analysis)
- Focus Area (multi-patent, multi-stage summarization)
- Patent families (not yet implemented)
- Products (not yet implemented)

Each has different structure:
- Patent-level: Simple question set, one-shot
- Focus Area: Stage 1 (per-patent) → Stage 2 (group summary)
- Sector scoring: Hierarchical inheritance (portfolio → super → sector → sub)

**Recommendation**: Separate editors for different object types:
- Patent/Sector scoring: Show inheritance chain, allow question editing at each level
- Focus Area: Show multi-stage structure, stage-by-stage editing
- Keep structure definition outside GUI initially, allow text editing within

## Demo-Ready Template Editor

Simple implementation steps for demonstrating the template system:

### Phase 1: Read-Only Template Viewer
1. List all defined scoring templates (portfolio, super-sector, sector, sub-sector)
2. Show merged questions for any selected template
3. Display inheritance chain visually (which level contributed each question)
4. Show template metadata (version, last modified, etc.)

### Phase 2: Template Preview with Patent
1. Select a patent from the sector
2. Render the full prompt as it would be sent to LLM
3. Show token count, estimated cost
4. Display claims if available, show impact on prompt size

### Phase 3: Basic Editing (Admin Only)
1. Modify question text at any level
2. Add/remove questions at sector or sub-sector level
3. Adjust weights on individual questions
4. Track modifications for job re-run requirements

### Downstream Impact Tracking
- When a template is modified, flag affected scores as "stale"
- Show in GUI which patents need re-scoring
- Provide bulk re-score action for stale patents

## Results Viewing Implementation Plan

### Immediate (This Session)
1. Enhance SectorScoresPage with detailed results table
2. Add ability to view individual patent's full scoring breakdown
3. Show reasoning for each metric answer
4. Enable export with all metrics and reasoning

### Near-Term
1. Add super-sector summary view (aggregate progress across sectors)
2. Comparison view: With-claims vs without-claims scoring
3. Score distribution visualization per sector

### Future
1. Read-only template viewer showing inheritance
2. Template test runner (score single patent, show result)
3. Basic template editing with stale score tracking

</LLM Scoring Results and Template Editing — February 2026>


<LLM Scoring Prioritization Options — February 2026>

## Problem Statement

Different scoring formulas prioritize patents differently:
- **Base Score**: Emphasizes forward citations + remaining years
- **V2 Score**: Configurable weights for citations, years, and competitor citations
- **V3 Score**: Multi-metric scoring with profiles

Patents can rank highly in V2 (due to high competitor citations) but low in base score.
If LLM sector scoring only prioritizes by base score, valuable V2 top patents may not get
scored until late in the process.

**Example**: Patent 6085333
- Base score: 11.0 (low priority)
- V2 score: 1448.3 (top priority due to competitor citations)

## Solution: Prioritization Option for LLM Scoring

Added `prioritizeBy` parameter to the sector scoring endpoint:

```
POST /api/scoring-templates/llm/score-sector/:sectorName
  ?prioritizeBy=v2           # 'base' (default) or 'v2'
  &v2Citation=50             # V2 citation weight (default 50)
  &v2Years=30                # V2 years remaining weight (default 30)
  &v2Competitor=20           # V2 competitor citation weight (default 20)
  &useClaims=true
  &limit=100
```

### Prioritization Modes

**Base Score (default)**:
- Sort by existing `score` field in candidates JSON
- Formula: forward_citations + remaining_years (with scaling)
- Best for: General portfolio coverage, newer patents

**V2 Score**:
- Calculate on-the-fly using configurable weights
- Formula: weighted combination of log(citations), years, and competitor_citations
- Best for: Targeting patents with high market/competitive value
- Allows custom weights to match specific analysis needs

## Recommended Usage

### Strategy 1: Base-First, V2-Fill
1. Run full sector scoring with base priority (covers high-citation, long-life patents)
2. Run targeted V2-priority batch to fill gaps in V2 top rankings

### Strategy 2: Parallel Coverage
1. Run base-priority job with limit for broad coverage
2. Run V2-priority job with limit for competitive coverage
3. Both run simultaneously, avoiding duplicate scoring (onlyUnscored filter)

### Strategy 3: Custom V2 Weights
For specific analyses, customize V2 weights:
- **Competitor-focused**: v2Competitor=60, v2Citation=30, v2Years=10
- **Longevity-focused**: v2Years=50, v2Citation=30, v2Competitor=20
- **Citation-focused**: v2Citation=60, v2Years=20, v2Competitor=20

## Portfolio Coverage Analysis

When exporting or analyzing results, correlate:
- V2 top N patents with LLM coverage status
- Identify gaps in V2 rankings that lack LLM scores
- Run targeted batches to ensure top patents under any scoring formula have full LLM analysis

## Implementation Notes

- V2 score calculation matches the `/api/scores/v2` endpoint formula
- Both base and V2 prioritization filter out already-scored patents
- Scoring results are identical regardless of prioritization method
- Prioritization only affects which patents get scored first in limited batches

</LLM Scoring Prioritization Options — February 2026>

