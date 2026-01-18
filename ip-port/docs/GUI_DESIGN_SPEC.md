# Patent Portfolio Analysis - GUI Design Specification

## Overview

This document specifies the user interface design for the Patent Portfolio Analysis Platform. The GUI enables users to explore patent data, adjust scoring parameters, manage analysis configurations, and export results.

**Target Stack:** Quasar Framework + Vue.js 3 + TypeScript

---

## Primary Views

### 1. Dashboard (Home)

**Purpose:** High-level portfolio overview and quick access to key insights

**Components:**

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  DASHBOARD                                                    [User] [Help] │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐             │
│  │ Total Patents   │  │ Priority 250    │  │ Active Sectors  │             │
│  │    10,276       │  │     250         │  │      16         │             │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘             │
│                                                                             │
│  ┌─────────────────────────────────────┐  ┌─────────────────────────────┐  │
│  │ Top 10 Patents by Score             │  │ Competitor Exposure         │  │
│  │ ┌────────────────────────────────┐  │  │ ┌─────────────────────────┐ │  │
│  │ │ 1. 9569605 - Biometric...  50% │  │  │ │ Apple     ████████ 67  │ │  │
│  │ │ 2. 10200706 - Video dec... 46% │  │  │ │ ByteDance ██████   45  │ │  │
│  │ │ 3. 11516311 - ML resour... 42% │  │  │ │ Microsoft █████    38  │ │  │
│  │ │ ...                            │  │  │ │ Amazon    ████     24  │ │  │
│  │ └────────────────────────────────┘  │  │ └─────────────────────────┘ │  │
│  └─────────────────────────────────────┘  └─────────────────────────────┘  │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ Sector Distribution (Donut Chart)              │ Years Remaining   │   │
│  │                                                │ Distribution      │   │
│  │   [Video Codec] [Cloud/Auth] [Security]        │ (Histogram)       │   │
│  │   [RF/Acoustic] [Bluetooth] [Other]            │                   │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Key Metrics Cards:**
- Total Patents Analyzed
- Priority Patents (Top 250)
- Active Sectors
- Patents with IPR Risk
- Average Score
- Coverage % (LLM, IPR, Prosecution)

---

### 2. Patent Grid View

**Purpose:** Full data grid with filtering, sorting, and column customization

**Components:**

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  PATENT GRID                                              [Export] [Filter] │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Filters: [Sector ▼] [Score > ___] [Years > ___] [Competitor ▼] [Search...] │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │ # │ Patent ID │ Title        │ Score │ Yr │ Sector    │ Competitors    ││
│  ├───┼───────────┼──────────────┼───────┼────┼───────────┼────────────────┤│
│  │ 1 │ 9569605   │ Biometric... │ 50.3% │ 8.1│ Security  │ Apple (67)     ││
│  │ 2 │ 10200706  │ Video dec... │ 46.0% │10.1│ Video     │ ByteDance (20) ││
│  │ 3 │ 11516311  │ ML resour... │ 42.5% │13.9│ Cloud     │ Amazon (2)     ││
│  │ 4 │ 11425134  │ Secure ac... │ 42.4% │13.6│ Cloud     │ Microsoft (1)  ││
│  │ ...                                                                     ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                                                             │
│  Showing 1-50 of 250    [< Prev] [Page 1 of 5] [Next >]                    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Grid Features:**
- **Sortable columns** - Click header to sort
- **Column visibility** - Show/hide columns via menu
- **Quick filters** - Dropdowns for sector, competitor, score ranges
- **Full-text search** - Search titles, abstracts
- **Row selection** - Multi-select for bulk actions
- **Row click** - Opens Patent Detail panel
- **Export** - CSV, Excel, JSON

**Available Columns:**
- Rank, Patent ID, Title, Grant Date, Assignee
- Years Remaining, Forward Citations, Competitor Citations
- Sector, CPC Codes, Competitors Citing
- V2 Score, Damages Score, Success Score, Risk Factor
- Eligibility, Validity, Claim Breadth, Enforcement
- IPR Risk, Prosecution Quality
- LLM Summary, Products, Implementers

---

### 3. Sector View

**Purpose:** Analyze patents grouped by technology sector

**Components:**

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  SECTOR VIEW                                              [Add Sector] [⋮]  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │ Sector                │ Patents │ Avg Score │ Top Competitor │ Action│  │
│  ├───────────────────────┼─────────┼───────────┼────────────────┼───────┤  │
│  │ ▼ Video Codec         │   154   │   38.2%   │ ByteDance (45) │ [View]│  │
│  │   ├─ video-codec-exp  │   200   │   35.1%   │                │       │  │
│  │   └─ cluster-2        │     5   │   42.0%   │                │       │  │
│  │ ▼ Cloud/Auth          │    43   │   41.5%   │ Cisco (308)    │ [View]│  │
│  │ ▼ RF/Acoustic         │   148   │   36.8%   │ Murata (140)   │ [View]│  │
│  │ ▼ Cybersecurity       │    30   │   39.2%   │ Microsoft (38) │ [View]│  │
│  │ ▼ Bluetooth/Wireless  │    25   │   35.5%   │ Apple (17)     │ [View]│  │
│  │ ...                                                                   │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│  [Click sector for detailed view with patent grid]                          │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Sector Detail Panel:**
- Patents in sector (grid view)
- Sector statistics
- Top competitors in sector
- Sector damages estimate (editable)
- Run sector-specific analysis actions

---

### 4. Patent Detail View

**Purpose:** Deep dive into individual patent with all metrics and analysis

**Components:**

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  PATENT: 9569605                                              [Back] [Edit] │
│  "Systems and methods for enabling biometric authentication options"        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────┬─────────────────┬─────────────────┬─────────────────┐ │
│  │ V2 Score        │ Years Remaining │ Competitor Cites│ Forward Cites   │ │
│  │    50.3%        │      8.1        │       67        │      78         │ │
│  └─────────────────┴─────────────────┴─────────────────┴─────────────────┘ │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │ CORE INFO                                                               ││
│  │ Patent ID: 9569605          Grant Date: 2017-02-14                      ││
│  │ Assignee: Symantec Corp     Expiration: 2035-02-14                      ││
│  │ Sector: Security            CPC: H04L63/0861, G06F21/32                 ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                                                             │
│  ┌─────────────────────────────────┐ ┌─────────────────────────────────────┐│
│  │ LLM ANALYSIS                    │ │ THREE-FACTOR BREAKDOWN              ││
│  │ Eligibility: 4/5               │ │ ┌─────────────────────────────────┐ ││
│  │ Validity: 4/5                  │ │ │ Damages:  ████████░░ 80%       │ ││
│  │ Claim Breadth: 3/5             │ │ │ Success:  ██████████ 95%       │ ││
│  │ Enforcement: 5/5               │ │ │ Risk:     ████████░░ 85%       │ ││
│  │ Design Around: 4/5             │ │ └─────────────────────────────────┘ ││
│  │ Implementation: software       │ │ Year Multiplier: 0.73               ││
│  │ Standards: FIDO Alliance       │ │                                     ││
│  └─────────────────────────────────┘ └─────────────────────────────────────┘│
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │ COMPETITORS CITING THIS PATENT                                          ││
│  │ Apple (67 citations) | Microsoft (5) | Google (3)                       ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │ LLM SUMMARY                                                             ││
│  │ This patent covers biometric authentication methods for mobile devices. ││
│  │ Strong claims around fingerprint + facial recognition combination.      ││
│  │ Likely implementers: Apple Face ID, Samsung Knox, Google Pixel Auth     ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                                                             │
│  [View Full Abstract] [View Claims] [USPTO Link] [Add Note]                 │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

### 5. Configuration Panel

**Purpose:** Manage scoring weights, search terms, stopwords, and analysis settings

**Sub-panels:**

#### 5a. User Weights Configuration

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  SCORING WEIGHTS                                     [Save] [Reset Default] │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Profile: [Litigation ▼]                                                    │
│                                                                             │
│  DAMAGES FACTORS                                    WEIGHT                  │
│  ├─ Sector Damages Estimate      ─────────────────○───── 40%               │
│  ├─ Competitor Citations         ───────────○───────────  25%               │
│  ├─ Market Relevance             ─────────○─────────────  20%               │
│  └─ Forward Citations            ───────○───────────────  15%               │
│                                                                             │
│  SUCCESS FACTORS                                                            │
│  ├─ Eligibility Score            ─────────────○─────────  30%               │
│  ├─ Validity Score               ─────────────○─────────  30%               │
│  ├─ Claim Breadth                ───────────○───────────  20%               │
│  └─ Prosecution Quality          ───────────○───────────  20%               │
│                                                                             │
│  RISK FACTORS                                                               │
│  ├─ IPR Risk Score               ─────────────○─────────  35%               │
│  ├─ Design-Around Difficulty     ───────────○───────────  30%               │
│  └─ Enforcement Clarity          ─────────────○─────────  35%               │
│                                                                             │
│  [Preview Impact on Top 250]                                                │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### 5b. Sector Damages Configuration

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  SECTOR DAMAGES ESTIMATES                                           [Save]  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  │ Sector          │ Rating │ Market Size │ Key Infringers         │ Edit │ │
│  ├─────────────────┼────────┼─────────────┼────────────────────────┼──────┤ │
│  │ Video Codec     │ ████ 4 │ $200B+      │ ByteDance, Apple       │  ✎  │ │
│  │ RF/Acoustic     │ ████ 4 │ $50B+       │ Murata, Skyworks       │  ✎  │ │
│  │ Cloud/Auth      │ ███░ 3 │ $20B        │ Microsoft, Amazon      │  ✎  │ │
│  │ Cybersecurity   │ ███░ 3 │ $180B       │ CrowdStrike, Palo Alto │  ✎  │ │
│  │ Bluetooth       │ ███░ 3 │ $10B        │ Apple, Qualcomm        │  ✎  │ │
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                                                             │
│  Rating Scale: 1=Low (<$1B), 2=Med ($1-10B), 3=High ($10-100B), 4=VHigh     │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### 5c. Search Terms & Stopwords

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  SEARCH CONFIGURATION                                                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  CURATED SEARCH TERMS                                    [Add Term]         │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ video codec | transcoding | macroblock | HEVC | H.264 | bitrate     │   │
│  │ authentication | biometric | encryption | token | OAuth | SAML      │   │
│  │ BAW | FBAR | resonator | piezoelectric | acoustic filter           │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  STOPWORDS (Excluded from analysis)                      [Add Stopword]     │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ method | apparatus | comprising | plurality | configured | coupled  │   │
│  │ wherein | thereto | embodiment | invention | claim | patent         │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### 5d. Competitor Management

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  COMPETITOR CONFIGURATION                                   [Add Competitor]│
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Filter by Category: [All ▼]                                                │
│                                                                             │
│  │ Company          │ Category     │ Patterns           │ Citations │ Edit ││
│  ├──────────────────┼──────────────┼────────────────────┼───────────┼──────┤│
│  │ Apple            │ consumer     │ Apple Inc, Apple.. │    67     │  ✎  ││
│  │ ByteDance        │ social       │ ByteDance, TikTok  │    45     │  ✎  ││
│  │ Microsoft        │ software     │ Microsoft Corp...  │    38     │  ✎  ││
│  │ Murata           │ rfAcoustic   │ Murata Manufactu.. │   140     │  ✎  ││
│  │ ...                                                                     ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                                                             │
│  Total: 93 companies across 16 categories                                   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

### 6. Analysis Jobs Panel

**Purpose:** Run and monitor analysis jobs (citation overlap, LLM analysis, etc.)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  ANALYSIS JOBS                                              [New Job ▼]     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  RUNNING JOBS                                                               │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ LLM V3 Analysis - Video Codec Sector     ████████░░░░ 75%  [Cancel] │   │
│  │ Started: 10 min ago | ETA: 5 min | 150/200 patents                  │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  RECENT JOBS                                                                │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ ✓ IPR Risk Check - Top 250        Completed 2 hours ago    [View]   │   │
│  │ ✓ Citation Overlap - Video Codec  Completed 3 hours ago    [View]   │   │
│  │ ✓ LLM V3 Analysis - Top 250       Completed 5 hours ago    [View]   │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  AVAILABLE JOBS                                                             │
│  [Citation Overlap] [LLM Analysis] [IPR Check] [Prosecution] [Export CSV]   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Navigation Structure

```
┌─────────────────┐
│ Patent Analysis │
├─────────────────┤
│ ► Dashboard     │
│ ► Patent Grid   │
│ ► Sectors       │
│   ├─ Video      │
│   ├─ Cloud      │
│   ├─ Security   │
│   └─ ...        │
│ ► Search        │
│ ► Analysis Jobs │
├─────────────────┤
│ CONFIGURATION   │
│ ► Weights       │
│ ► Sector Damages│
│ ► Search Terms  │
│ ► Competitors   │
│ ► Mining Strat. │
├─────────────────┤
│ ► Export        │
│ ► Settings      │
│ ► Help          │
└─────────────────┘
```

---

## Key Interactions

### 1. Score Preview
When user adjusts weights, show real-time preview of impact on top 250 rankings.

### 2. Quick Filters
One-click filters: "Show only patents with IPR risk" | "Show high-damage sectors"

### 3. Bulk Actions
Select multiple patents → Add to watch list, Export, Run analysis, Add notes

### 4. Compare Mode
Select 2-3 patents to compare side-by-side

### 5. What-If Analysis
"What would this patent score with different sector damages rating?"

---

## Data Requirements

### API Endpoints Needed

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/patents` | GET | List patents with pagination, filtering |
| `/api/patents/:id` | GET | Single patent detail |
| `/api/sectors` | GET/PUT | Sector list and damages |
| `/api/weights` | GET/PUT | User weight profiles |
| `/api/competitors` | GET/POST/PUT | Competitor management |
| `/api/jobs` | GET/POST | Analysis job management |
| `/api/search` | POST | Full-text search |
| `/api/export` | POST | Generate exports |

---

## Technology Notes

### Recommended Libraries
- **Quasar Framework** - Vue 3 component library
- **AG Grid** or **Quasar Table** - Data grid
- **Chart.js** or **ApexCharts** - Visualizations
- **Pinia** - State management
- **Axios** - API client

### Responsive Design
- Desktop-first (primary use case)
- Tablet support for grid views
- Mobile: Dashboard and patent detail only

---

## Open Design Questions

1. **Dark mode?** - Common in data-heavy applications

2. **Multi-user support?** - Separate weight profiles per user?

3. **Notifications?** - Alert when analysis jobs complete?

4. **Saved views?** - Let users save filtered grid configurations?

5. **Patent notes?** - Allow users to add notes to patents?

6. **Export templates?** - Pre-configured export formats?

---

*Document created: 2026-01-17*
*Status: INITIAL DRAFT for review*
*Feedback welcome on layout, features, and priorities*
