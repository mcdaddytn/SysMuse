# GUI Integration Plan: Sector Scoring Templates

## Overview

This document outlines the integration of sector-specific LLM scoring into the frontend GUI.

## Current Backend Capabilities

### Scoring Templates API (`/api/scoring-templates/*`)
- `GET /config` - List all template config files (portfolio, super-sector, sector, sub-sector)
- `GET /config/merged/:superSectorName` - Get merged questions for a super-sector
- `POST /sync` - Sync templates from JSON config to database
- `POST /seed` - Seed default templates
- `POST /llm/score-sector/:sectorName` - Score all patents in a sector
- `GET /llm/sector-preview/:sectorName` - Preview patents ready for scoring
- `GET /scores/patent/:patentId` - Get LLM score for a patent
- `GET /export/:superSector` - Export patents with LLM metrics

### Template Hierarchy (3-tier, working)
1. **Portfolio-default** - 5 base questions for all patents
2. **Super-sector** - 5+ additional questions per super-sector
3. **Sector** - 3-4 targeted questions per sector (44 sectors defined)
4. **Sub-sector** - Created (14 templates) but NOT integrated yet

## Required Frontend Changes

### Phase 1: API Layer (Day 1)

Add to `frontend/src/services/api.ts`:

```typescript
// Scoring Templates API
export interface ScoringQuestion {
  fieldName: string;
  displayName: string;
  question: string;
  answerType: 'numeric';
  scale: { min: number; max: number };
  weight: number;
  requiresReasoning: boolean;
  reasoningPrompt?: string;
}

export interface ScoringTemplateConfig {
  id: string;
  name: string;
  description: string;
  level: 'portfolio' | 'super_sector' | 'sector' | 'sub_sector';
  questions: ScoringQuestion[];
  scoringGuidance?: string[];
  contextDescription?: string;
}

export interface MergedTemplate {
  superSectorName: string;
  questionCount: number;
  totalWeight: number;
  questions: ScoringQuestion[];
}

export interface SectorScoringProgress {
  sectorName: string;
  total: number;
  scored: number;
  remaining: number;
  percentComplete: number;
}

export interface ScoringJobResult {
  total: number;
  successful: number;
  failed: number;
  totalTokens: { input: number; output: number };
}

export const scoringTemplatesApi = {
  // Config
  async getConfig(): Promise<{
    portfolioDefault: ScoringTemplateConfig;
    superSectors: Array<{ filename: string; template: ScoringTemplateConfig }>;
    sectors: Array<{ filename: string; template: ScoringTemplateConfig }>;
    subSectors: Array<{ filename: string; template: ScoringTemplateConfig }>;
    summary: { superSectorCount: number; sectorCount: number; subSectorCount: number };
  }> {
    const { data } = await api.get('/scoring-templates/config');
    return data;
  },

  async getMergedTemplate(superSectorName: string): Promise<MergedTemplate> {
    const { data } = await api.get(`/scoring-templates/config/merged/${superSectorName}`);
    return data;
  },

  // Sync
  async syncTemplates(): Promise<{ updated: number; created: number; errors: string[] }> {
    const { data } = await api.post('/scoring-templates/sync');
    return data;
  },

  // Scoring
  async scoreSector(
    sectorName: string,
    options?: { useClaims?: boolean; rescore?: boolean; minYear?: number }
  ): Promise<ScoringJobResult> {
    const params = new URLSearchParams();
    if (options?.useClaims) params.append('useClaims', 'true');
    if (options?.rescore) params.append('rescore', 'true');
    if (options?.minYear) params.append('minYear', options.minYear.toString());

    const { data } = await api.post(`/scoring-templates/llm/score-sector/${sectorName}?${params}`);
    return data;
  },

  async getSectorPreview(sectorName: string): Promise<{
    sectorName: string;
    unscoredCount: number;
    patents: Array<{ patent_id: string; patent_title: string }>;
  }> {
    const { data } = await api.get(`/scoring-templates/llm/sector-preview/${sectorName}`);
    return data;
  },

  async getPatentScore(patentId: string): Promise<{
    patentId: string;
    scored: boolean;
    compositeScore?: number;
    metrics?: Record<string, { score: number; reasoning: string; confidence: number }>;
  }> {
    const { data } = await api.get(`/scoring-templates/scores/patent/${patentId}`);
    return data;
  },

  // Export
  async exportSuperSector(
    superSector: string,
    options?: { format?: 'csv' | 'json'; includeReasoning?: boolean; minScore?: number }
  ): Promise<void> {
    const params = new URLSearchParams();
    if (options?.format) params.append('format', options.format);
    if (options?.includeReasoning !== undefined) params.append('includeReasoning', String(options.includeReasoning));
    if (options?.minScore) params.append('minScore', options.minScore.toString());

    const response = await api.get(`/scoring-templates/export/${superSector}?${params}`, {
      responseType: 'blob'
    });

    // Download file
    const blob = new Blob([response.data], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${superSector}-scored-patents.csv`;
    link.click();
    URL.revokeObjectURL(url);
  },

  // Claims
  async getClaimsStats(patentId: string): Promise<{
    patentId: string;
    found: boolean;
    independentClaims?: number;
    dependentClaims?: number;
    estimatedTokens?: number;
  }> {
    const { data } = await api.get(`/scoring-templates/claims/stats/${patentId}`);
    return data;
  }
};
```

### Phase 2: Sector Management Enhancement (Day 2-3)

Add "LLM Scoring" tab to `SectorManagementPage.vue`:

```
Sector Management
├── Overview tab (existing)
├── Rules tab (existing)
├── Patents tab (existing)
└── LLM Scoring tab (NEW)
    ├── Template Info
    │   ├── Inherited from: [portfolio-default → COMPUTING → computing-runtime]
    │   ├── Question count: 14
    │   └── Total weight: 1.0
    ├── Questions List
    │   └── Expandable cards showing each question with:
    │       - Field name, weight
    │       - Question text
    │       - Reasoning prompt
    │       - Source level (portfolio/super-sector/sector)
    ├── Scoring Progress
    │   ├── Progress bar: 85/3868 (2.2%)
    │   ├── With claims: Yes
    │   └── Last scored: 2 mins ago
    └── Actions
        ├── [Start Scoring] - useClaims toggle, minYear filter
        ├── [Export Scores] - CSV with metrics
        └── [View Top Scored] - Link to filtered patent list
```

### Phase 3: Job Queue Enhancement (Day 3)

Enhance `JobQueuePage.vue` to show scoring template jobs:
- Display active sector scoring jobs
- Show progress (X/Y patents, X% complete)
- Token usage tracking
- Rate limit warnings
- Cancel/retry controls

### Phase 4: Patent Detail Enhancement (Day 4)

Add LLM Scores section to `PatentDetailPage.vue`:
- Show composite score
- Expandable metrics with reasoning
- Claims availability indicator
- Score history if re-scored

### Phase 5: New Components (Day 5)

Create reusable components:

1. **ScoringTemplateViewer.vue**
   - Display merged template questions
   - Show inheritance chain
   - Highlight source level for each question

2. **SectorScoringProgress.vue**
   - Real-time progress bar
   - Auto-refresh every 10s
   - Token usage display

3. **PatentScoreCard.vue**
   - Compact score display with metrics
   - Expandable reasoning
   - Used in tables and detail views

## Database Queries for Progress

```sql
-- Get scoring progress by sector
SELECT
  sec.name as sector,
  COUNT(DISTINCT ps.patent_id) as scored,
  sec.patent_count as total,
  ROUND(100.0 * COUNT(DISTINCT ps.patent_id) / NULLIF(sec.patent_count, 0), 1) as pct
FROM sectors sec
LEFT JOIN sub_sectors ss ON ss.sector_id = sec.id
LEFT JOIN patent_sub_sector_scores ps ON ps.sub_sector_id = ss.id
WHERE sec.super_sector_id = :superSectorId
GROUP BY sec.name, sec.patent_count
ORDER BY pct DESC;
```

## API Endpoints to Add (Backend)

1. `GET /api/scoring-templates/progress/:sectorName`
   - Returns scoring progress for a sector
   - Used for real-time progress tracking

2. `GET /api/scoring-templates/progress/super-sector/:superSectorName`
   - Returns aggregate progress for all sectors in super-sector

3. `GET /api/scoring-templates/active-jobs`
   - Returns list of currently running scoring jobs

## Priority Order

1. **High Priority** (needed for basic operation)
   - API layer (`scoringTemplatesApi`)
   - Sector scoring tab in SectorManagementPage
   - Progress display

2. **Medium Priority** (improves usability)
   - Patent detail LLM scores
   - Job queue enhancement
   - Export functionality

3. **Lower Priority** (nice to have)
   - Sub-sector template editing UI
   - Score comparison over time
   - Batch scoring scheduler

## Estimated Effort

| Phase | Description | Effort |
|-------|-------------|--------|
| 1 | API Layer | 2-3 hours |
| 2 | Sector Management Tab | 4-6 hours |
| 3 | Job Queue Enhancement | 2-3 hours |
| 4 | Patent Detail | 2-3 hours |
| 5 | Reusable Components | 3-4 hours |

**Total: ~15-20 hours of frontend development**

## Notes

- All scoring jobs run with `useClaims=true` to ensure claims are included
- Template inheritance is automatic (portfolio → super-sector → sector)
- Sub-sector templates exist but are not yet integrated into scoring engine
- 8 parallel jobs can run without hitting rate limits
