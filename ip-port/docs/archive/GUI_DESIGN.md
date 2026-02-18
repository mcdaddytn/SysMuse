# Patent Portfolio Workstation - GUI Design Document

## Overview

A web-based workstation for patent portfolio analysis, scoring, and management. Built with Vue 3/Quasar/Express.js, supporting multi-user access with role-based permissions and consensus voting.

---

## Tech Stack

| Layer | Technology | Reference |
|-------|------------|-----------|
| Frontend | Vue 3 (Composition API) + Quasar 2.x | Both projects |
| State | Pinia | judicial-transcripts |
| Build | Vite + TypeScript | Both projects |
| Backend | Express.js + TypeScript | Both projects |
| Database | PostgreSQL + Prisma ORM | Both projects |
| Search | Elasticsearch | judicial-transcripts |
| Auth | express-session (cookie-based) | matter-tracker |
| LLM | Anthropic SDK + LangChain | judicial-transcripts |

---

## User Roles & Permissions

### Access Levels (from matter-tracker pattern)

| Level | Description | Capabilities |
|-------|-------------|--------------|
| **VIEWER** | Read-only analyst | View rankings, patent details. No weight control. |
| **ANALYST** | Standard user | View own rankings, control own weights, see own scoring view |
| **MANAGER** | Team lead | All analyst features + view team consensus, cannot see individual votes |
| **ADMIN** | Full access | All features + see all individual weights, manage users, configure system |

### Consensus Voting Visibility

| User Level | Own Weights | Own Ranking | Consensus View | Other Users' Weights |
|------------|-------------|-------------|----------------|---------------------|
| VIEWER | ❌ | ❌ (sees default) | ✅ | ❌ |
| ANALYST | ✅ | ✅ | ❌ | ❌ |
| MANAGER | ✅ | ✅ | ✅ | ❌ |
| ADMIN | ✅ | ✅ | ✅ | ✅ |

---

## Core Features

### 1. Portfolio Grid View (Priority: HIGH)

**Purpose:** Flexible table display of patent portfolio with filtering, sorting, and column customization.

**Components:**
- `PortfolioGrid.vue` - Main grid component using Q-Table with virtual scrolling
- `ColumnSelector.vue` - Show/hide columns dialog
- `FilterPanel.vue` - Multi-faceted filtering (assignee, CPC, date range, score range, sector)
- `SortControls.vue` - Multi-column sorting

**Features:**
- Virtual scrolling for 28K+ patents
- Column visibility toggle with localStorage persistence
- Multi-select for bulk operations
- Export to CSV/Excel
- Quick filters (presets for common views)
- Row expansion for quick patent details

**Default Columns:**
| Column | Type | Default | Sortable | Filterable |
|--------|------|---------|----------|------------|
| Patent ID | link | visible | ✅ | ✅ |
| Title | text | visible | ✅ | ✅ (search) |
| Grant Date | date | visible | ✅ | ✅ (range) |
| Expiration | date | hidden | ✅ | ✅ (range) |
| Remaining Years | number | visible | ✅ | ✅ (range) |
| **Affiliate** | link | **visible** | ✅ | ✅ (multi-select) |
| Assignee (raw) | text | hidden | ✅ | ✅ (search) |
| **Super-Sector** | tag | **visible** | ✅ | ✅ (multi-select) |
| Primary Sector | tag | hidden | ✅ | ✅ (multi-select) |
| Focus Areas | tags | hidden | ✅ | ✅ (multi-select) |
| Forward Citations | number | visible | ✅ | ✅ (range) |
| Competitor Cites | number | visible | ✅ | ✅ (range) |
| v2 Score | number | visible | ✅ | ✅ (range) |
| v3 Score | number | hidden | ✅ | ✅ (range) |
| Consensus Score | number | hidden | ✅ | ✅ (range) |

**Attorney Question Columns (hidden by default):**
| Column | Type | Description |
|--------|------|-------------|
| Summary | text | High-level summary for non-technical audience |
| Prior Art Problem | text | What problem in prior art does this solve? |
| Technical Solution | text | How does the technical solution work? |
| Eligibility Score | 1-5 | Patent eligibility strength (101) |
| Validity Score | 1-5 | Strength against prior art invalidity |

**LLM Analysis Columns (hidden by default):**
| Column | Type | Description |
|--------|------|-------------|
| Claim Breadth | 1-5 | Scope of patent claims |
| Enforcement Clarity | 1-5 | How easily infringement can be detected |
| Design-Around Difficulty | 1-5 | How hard to avoid infringing |
| Market Relevance | 1-5 | Current market applicability |
| LLM Confidence | 1-5 | LLM's confidence in analysis |

**Focus Area-Specific Columns:**
When a Focus Area is selected as a filter, additional columns specific to that area become available. See `docs/FACET_SYSTEM_DESIGN.md` for details.

### 2. Scoring Views (Priority: HIGH)

#### 2a. v2 Simple Scoring

**Components:**
- `V2ScoringPage.vue` - Main page
- `WeightSliders.vue` - Real-time weight adjustment
- `ScoreFormula.vue` - Display current formula

**Formula (configurable):**
```
v2_score = (citations * citation_weight) +
           (remaining_years * years_weight) +
           (competitor_cites * competitor_weight)
```

**Slider Controls:**
| Weight | Range | Default | Description |
|--------|-------|---------|-------------|
| Citation Weight | 0-100 | 50 | Forward citation importance |
| Years Weight | 0-100 | 30 | Remaining patent life importance |
| Competitor Weight | 0-100 | 20 | Competitor citation importance |

**Features:**
- Real-time ranking update as sliders move
- Show rank change indicators (↑↓ arrows with delta)
- Normalize weights to 100% automatically
- Save/load weight presets

#### 2b. v3 Consensus Scoring

**Components:**
- `V3ScoringPage.vue` - Main page with dual view
- `PersonalWeights.vue` - User's own weights
- `ConsensusView.vue` - Aggregated team view (Manager+)
- `ImpactPreview.vue` - Show how weight changes affect consensus

**Consensus Calculation:**
```
consensus_score = AVG(user_scores) weighted by user_weight_factor

where user_weight_factor can be:
  - Equal (all users = 1.0)
  - Role-based (Admin=1.5, Manager=1.2, Analyst=1.0)
  - Custom per-user
```

**UI Layout (Admin view):**
```
┌─────────────────────────────────────────────────────────────┐
│ [My Weights] [Consensus] [All Users]              [Export] │
├─────────────────────────────────────────────────────────────┤
│ ┌─────────────────┐  ┌────────────────────────────────────┐│
│ │ Weight Sliders  │  │ Patent Grid (sorted by view)       ││
│ │                 │  │                                    ││
│ │ Citations: ──●─ │  │ Rank  Patent  MyScore  Consensus   ││
│ │ Years:     ─●── │  │ 1     US123   98.5     95.2        ││
│ │ Competitor:──●─ │  │ 2     US456   92.1     94.8        ││
│ │                 │  │ ...                                ││
│ │ [Save Preset]   │  │                                    ││
│ └─────────────────┘  └────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
```

### 3. Sector & Focus Area Rankings (Priority: MEDIUM)

**Components:**
- `SectorRankingsPage.vue` - Main page (sector-based view)
- `FocusAreaPage.vue` - Focus area management and view
- `SectorSelector.vue` - Super-sector/Primary sector filter
- `FocusAreaSelector.vue` - Focus area multi-select filter
- `SectorGrid.vue` - Filtered patent grid with context-aware columns

**Hierarchy (see `docs/FACET_SYSTEM_DESIGN.md`):**
- **Super-Sector** - Top-level domain (mutually exclusive)
  - Network Technology, Computing, Wireless, Video/Image, Security, Semiconductor
- **Primary Sector** - Actionable breakout (mutually exclusive within super-sector)
  - network-security-core, network-switching, computing-general, etc.
- **Focus Areas** - User-definable interest areas (non-exclusive, multi-assign)
  - Zero Trust, 5G NR, Container Security, etc.

**Features:**
- Tab-based or dropdown sector selection
- Multi-select Focus Area filter (non-exclusive)
- Cross-sector comparison view
- Sector-specific weight presets
- Heat map visualization by sector/focus area
- Dynamic columns based on selected Focus Area(s)
- Focus Area creation from search term extraction

### 4. Patent Detail View (Priority: HIGH)

**Components:**
- `PatentDetailPage.vue` - Main detail view
- `PatentHeader.vue` - ID, title, dates, status
- `PatentScores.vue` - All scoring information
- `CitationsPanel.vue` - Forward/backward citations
- `AssigneePanel.vue` - Assignee info with link to portfolio
- `InventorsPanel.vue` - Inventor list with links
- `CPCPanel.vue` - CPC codes with descriptions
- `ProsecutionPanel.vue` - File wrapper history
- `PTABPanel.vue` - IPR/PTAB proceedings
- `LLMAnswersPanel.vue` - LLM analysis results
- `VendorDataPanel.vue` - Third-party data (Patlytics)
- `ActionButtons.vue` - Queue jobs, add to watchlist, etc.

**Linked Navigation:**
| Field | Links To |
|-------|----------|
| Assignee | Portfolio grid filtered by assignee |
| Inventor | Portfolio grid filtered by inventor |
| CPC Code | Portfolio grid filtered by CPC |
| Citing Patent | Patent detail (if in portfolio) or external link |

### 5. Job Queue System (Priority: MEDIUM)

**Components:**
- `JobQueuePage.vue` - Queue management
- `JobStatusCard.vue` - Individual job status
- `BulkJobDialog.vue` - Create jobs from grid selection

**Job Types:**
| Type | Description | Source |
|------|-------------|--------|
| `citation_analysis` | Fetch forward citations | PatentsView API |
| `prosecution_history` | Fetch file wrapper | USPTO ODP |
| `ptab_check` | Check PTAB proceedings | USPTO ODP |
| `llm_analysis` | Run LLM prompts | Anthropic API |
| `patlytics_fetch` | Get Patlytics data | Patlytics API |
| `search_term_extract` | Extract search terms | LLM |

**Queue Features:**
- View pending/running/completed jobs
- Bulk queue from grid selection
- Priority levels (normal, high)
- Rate limit awareness
- Retry failed jobs
- Job history with results

### 6. Search Term Extraction (Priority: LOW)

**Components:**
- `SearchTermPage.vue` - Main page
- `TermExtractionForm.vue` - Configure extraction
- `TermResultsGrid.vue` - View extracted terms
- `TermSearchRunner.vue` - Run terms against portfolio

**Flow:**
1. Select patent(s)
2. Extract terms from title/abstract/claims
3. Review/edit extracted terms
4. Run terms against full portfolio
5. View matching patents with relevance scores

---

## Data Models (Prisma Schema Additions)

```prisma
// User and permissions
model User {
  id          String    @id @default(uuid())
  email       String    @unique
  password    String    // bcrypt hashed
  name        String
  accessLevel AccessLevel @default(ANALYST)
  isActive    Boolean   @default(true)
  createdAt   DateTime  @default(now())
  lastLoginAt DateTime?

  weights     UserWeights?
  watchlist   WatchlistItem[]
  jobsCreated Job[]
}

enum AccessLevel {
  VIEWER
  ANALYST
  MANAGER
  ADMIN
}

// User scoring weights
model UserWeights {
  id               String   @id @default(uuid())
  userId           String   @unique
  user             User     @relation(fields: [userId], references: [id])

  citationWeight   Float    @default(50)
  yearsWeight      Float    @default(30)
  competitorWeight Float    @default(20)

  // Additional v3 weights
  sectorWeights    Json?    // { "semiconductor": 1.2, "security": 0.8 }
  customWeights    Json?    // Future extensibility

  updatedAt        DateTime @updatedAt
}

// Patent scores (computed)
model PatentScore {
  id              String   @id @default(uuid())
  patentId        String   @unique

  // Cached scores
  v2Score         Float?
  v3Score         Float?
  consensusScore  Float?

  // Raw metrics
  forwardCitations Int     @default(0)
  competitorCites  Int     @default(0)
  remainingYears   Float   @default(0)

  updatedAt       DateTime @updatedAt
}

// Job queue
model Job {
  id          String    @id @default(uuid())
  type        JobType
  status      JobStatus @default(PENDING)
  priority    Int       @default(0)

  // Target
  patentId    String?
  patentIds   String[]  // For bulk jobs

  // Execution
  params      Json?
  result      Json?
  error       String?

  // Tracking
  createdBy   String
  creator     User      @relation(fields: [createdBy], references: [id])
  createdAt   DateTime  @default(now())
  startedAt   DateTime?
  completedAt DateTime?
}

enum JobType {
  CITATION_ANALYSIS
  PROSECUTION_HISTORY
  PTAB_CHECK
  LLM_ANALYSIS
  PATLYTICS_FETCH
  SEARCH_TERM_EXTRACT
}

enum JobStatus {
  PENDING
  RUNNING
  COMPLETED
  FAILED
  CANCELLED
}

// Watchlist
model WatchlistItem {
  id        String   @id @default(uuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id])
  patentId  String
  notes     String?
  createdAt DateTime @default(now())

  @@unique([userId, patentId])
}

// LLM Analysis Results
model LLMAnalysis {
  id        String   @id @default(uuid())
  patentId  String
  promptKey String   // e.g., "sector_classification", "claim_summary"
  model     String   // e.g., "claude-sonnet-4-20250514"

  prompt    String
  response  String

  createdAt DateTime @default(now())

  @@unique([patentId, promptKey])
}

// Vendor Data (Patlytics, etc.)
model VendorData {
  id        String   @id @default(uuid())
  patentId  String
  vendor    String   // "patlytics", "innography", etc.
  dataType  String   // "validity", "valuation", etc.
  data      Json

  fetchedAt DateTime @default(now())

  @@unique([patentId, vendor, dataType])
}
```

---

## API Endpoints

### Authentication
```
POST /api/auth/login          - Login
POST /api/auth/logout         - Logout
GET  /api/auth/me             - Current user
POST /api/auth/reset-password - Reset password
```

### Portfolio
```
GET  /api/patents                    - List patents (paginated, filtered)
GET  /api/patents/:id                - Patent detail
GET  /api/patents/:id/citations      - Forward/backward citations
GET  /api/patents/:id/prosecution    - Prosecution history
GET  /api/patents/:id/ptab           - PTAB proceedings
GET  /api/patents/:id/llm            - LLM analysis results
GET  /api/patents/:id/vendor         - Vendor data
```

### Scoring
```
GET  /api/scores                     - All patent scores
GET  /api/scores/v2                  - v2 scored ranking
GET  /api/scores/v3                  - v3 scored ranking (user's weights)
GET  /api/scores/consensus           - Consensus ranking
POST /api/weights                    - Update user's weights
GET  /api/weights/presets            - Weight presets
POST /api/weights/presets            - Save weight preset
```

### Jobs
```
GET  /api/jobs                       - List jobs (filtered by status)
POST /api/jobs                       - Create job
POST /api/jobs/bulk                  - Create bulk jobs
GET  /api/jobs/:id                   - Job status/result
DELETE /api/jobs/:id                 - Cancel job
POST /api/jobs/:id/retry             - Retry failed job
```

### Sectors & Focus Areas
```
GET  /api/sectors                    - List super-sectors and primary sectors
GET  /api/sectors/:id/patents        - Patents in sector
GET  /api/sectors/:id/rankings       - Sector rankings

GET  /api/focus-areas                - List all focus areas
POST /api/focus-areas                - Create focus area
GET  /api/focus-areas/:id            - Focus area details
PUT  /api/focus-areas/:id            - Update focus area
DELETE /api/focus-areas/:id          - Delete focus area
GET  /api/focus-areas/:id/patents    - Patents in focus area
POST /api/focus-areas/:id/patents    - Add patents to focus area
GET  /api/focus-areas/:id/columns    - Columns specific to this focus area
```

### Facets
```
GET  /api/facets/schema              - Available facet definitions
GET  /api/patents/:id/facets         - All facets for patent
PUT  /api/patents/:id/facets/:key    - Update facet value
POST /api/facets/calculate           - Trigger facet recalculation
```

### Search Terms
```
POST /api/search-terms/extract       - Extract terms from patent(s)
POST /api/search-terms/search        - Search portfolio with terms
```

### Admin
```
GET  /api/admin/users                - List users
POST /api/admin/users                - Create user
PUT  /api/admin/users/:id            - Update user
DELETE /api/admin/users/:id          - Delete user
GET  /api/admin/settings             - System settings
PUT  /api/admin/settings/:key        - Update setting
GET  /api/admin/weights              - All users' weights (admin only)
```

---

## Directory Structure

```
ip-port/
├── frontend/                    # Vue/Quasar frontend
│   ├── src/
│   │   ├── components/
│   │   │   ├── grid/            # Portfolio grid components
│   │   │   │   ├── PortfolioGrid.vue
│   │   │   │   ├── ColumnSelector.vue
│   │   │   │   ├── FilterPanel.vue
│   │   │   │   └── BulkActions.vue
│   │   │   ├── scoring/         # Scoring components
│   │   │   │   ├── WeightSliders.vue
│   │   │   │   ├── ScoreFormula.vue
│   │   │   │   └── ConsensusView.vue
│   │   │   ├── patent/          # Patent detail components
│   │   │   │   ├── PatentHeader.vue
│   │   │   │   ├── CitationsPanel.vue
│   │   │   │   └── ...
│   │   │   ├── jobs/            # Job queue components
│   │   │   │   ├── JobStatusCard.vue
│   │   │   │   └── BulkJobDialog.vue
│   │   │   └── common/          # Shared components
│   │   ├── pages/
│   │   │   ├── LoginPage.vue
│   │   │   ├── PortfolioPage.vue
│   │   │   ├── V2ScoringPage.vue
│   │   │   ├── V3ScoringPage.vue
│   │   │   ├── SectorRankingsPage.vue
│   │   │   ├── PatentDetailPage.vue
│   │   │   ├── JobQueuePage.vue
│   │   │   ├── SearchTermPage.vue
│   │   │   └── admin/
│   │   │       ├── UsersPage.vue
│   │   │       └── SettingsPage.vue
│   │   ├── layouts/
│   │   │   └── MainLayout.vue
│   │   ├── stores/
│   │   │   ├── auth.ts
│   │   │   ├── patents.ts
│   │   │   ├── scores.ts
│   │   │   └── jobs.ts
│   │   ├── services/
│   │   │   ├── api.ts
│   │   │   ├── auth.ts
│   │   │   └── settings.ts
│   │   ├── types/
│   │   │   └── index.ts
│   │   └── router/
│   │       └── index.ts
│   ├── package.json
│   └── vite.config.ts
│
├── src/                         # Express backend (existing structure)
│   ├── api/
│   │   ├── server.ts            # Main Express app
│   │   └── routes/
│   │       ├── auth.routes.ts
│   │       ├── patents.routes.ts
│   │       ├── scores.routes.ts
│   │       ├── jobs.routes.ts
│   │       └── admin.routes.ts
│   ├── services/                # Existing services
│   └── ...
│
├── prisma/
│   └── schema.prisma            # Add new models
│
└── docs/
    ├── GUI_DESIGN.md            # This document
    └── NEXT_SESSION_CONTEXT.md
```

---

## Implementation Phases

### Phase 1: Foundation (Week 1-2)
1. Set up frontend project (Quasar + Vite)
2. Add authentication (login, session, roles)
3. Basic portfolio grid with pagination
4. Column visibility and basic filtering

### Phase 2: Scoring (Week 3-4)
1. v2 scoring page with weight sliders
2. Real-time score recalculation
3. User weight persistence
4. v3 scoring with personal view

### Phase 3: Patent Details (Week 5-6)
1. Patent detail page with all panels
2. Linked navigation (assignee → grid, etc.)
3. Integration with existing cache/API services
4. PTAB/prosecution history display

### Phase 4: Consensus & Collaboration (Week 7-8)
1. Consensus scoring calculation
2. Manager/Admin consensus views
3. Impact preview for weight changes
4. Sector rankings

### Phase 5: Job Queue & Automation (Week 9-10)
1. Job queue backend
2. Job queue UI
3. Bulk job creation from grid
4. LLM integration for analysis jobs

### Phase 6: Advanced Features (Week 11-12)
1. Search term extraction
2. Vendor data integration (Patlytics)
3. Sector expansion pages
4. Export and reporting

---

## Next Steps

**Immediate (this session):**
1. Create frontend project structure
2. Set up Quasar with basic layout
3. Create basic portfolio grid component
4. Connect to existing patent data

**Short-term:**
1. Add authentication from matter-tracker patterns
2. Implement column visibility toggle
3. Add basic filtering

---

## Reference Projects

| Project | Path | Key Patterns |
|---------|------|--------------|
| judicial-transcripts | `/Users/gmac/Documents/GitHub/avflegal/judicial-transcripts` | Vue/Quasar, Pinia, QVirtualScroll, faceted filters, LLM integration |
| matter-tracker | `/Users/gmac/Documents/GitHub/avflegal/matter-tracker` | Auth, RBAC, per-user settings, Q-Table with filters |

---

*Last Updated: 2026-01-24*
