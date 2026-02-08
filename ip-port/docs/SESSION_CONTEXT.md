# Session Context - February 8, 2026

## Current Status

### VIDEO_STREAMING Batch - IN PROGRESS
Running 2 sectors in parallel with concurrency=4 per sector.

**Completed sectors (all 100% with claims):**
- display-control: 68/68
- video-drm-conditional: 121/121
- video-storage: 212/212
- video-broadcast: 229/229
- video-codec: 377/377

**In progress:**
- video-client-processing: ~394 target
- video-server-cdn: ~456 target

**Total VIDEO_STREAMING target:** 1,857 patents

### Parallelism Settings
Changed from sequential to parallel execution:
- **concurrency=4** per sector (was 2) in `llm-scoring-service.ts` lines 668 and 757
- Running **2 sectors simultaneously** via separate curl requests
- Throughput: ~10.5 patents/min with 2 parallel sectors
- No rate limit errors observed

### Claims Tracking
- Added `with_claims` column to `patent_sub_sector_scores` table
- All VIDEO_STREAMING patents scored with claims (100%)
- SECURITY and WIRELESS previously scored WITHOUT claims - need rescore

## Patents Needing Claims XML

**Export files created:**
- `exports/missing-claims/all-needs-xml-fixed.csv` - 7,826 patents (post-2005)
- `exports/missing-claims/pre-2005-cannot-get-claims.csv` - 213 patents
- `exports/missing-claims/previously-missing-dates.csv` - 41 patents (fixed dates)

**Claims drive currently offline** - user copying 7,826 patent XMLs to drive

## Portfolio Cache Stats
- Total patents in cache: 29,507
- Post-2005 (can get claims): 26,093 (88%)
- Pre-2005 (no claims available): 3,414 (12%)

## Scoring Status by Super-Sector

| Super-Sector | Scored | With Claims | Status |
|--------------|--------|-------------|--------|
| VIDEO_STREAMING | ~1,700 | 100% | In Progress |
| SECURITY | 3,790 | 0% | Needs rescore with claims |
| WIRELESS | 3,040 | 0% | Needs rescore with claims |
| NETWORKING | 0 | - | Not started |
| COMPUTING | 0 | - | Not started |
| SEMICONDUCTOR | 0 | - | Not started |
| IMAGING | 0 | - | Not started |
| AI_ML | 0 | - | Not started |

**Note:** The super-sector patent counts from sub_sectors table may have bad joins - need to verify actual counts.

## Scripts Created This Session

- `scripts/run-video-streaming-sectors.sh` - VIDEO_STREAMING batch with claims+rescore
- `scripts/export-patents-needing-xml.sh` - Export patents needing XML claims
- `scripts/export-sample-prompts.ts` - Export actual LLM prompts for review (fixed ES module issue)
- `scripts/check-claims-availability.sh` - Pre-flight check for claims

## Key Code Changes

### llm-scoring-service.ts
- Line 668: `concurrency: 4` (was 2)
- Line 757: `concurrency = 4` (was 2)
- Added `withClaims` flag to score saving

### scoring-template-service.ts
- Added `withClaims?: boolean` to `ScoreCalculationResult` interface
- Updated `savePatentScore` to save `with_claims` column

### prisma/schema.prisma
- Added `withClaims Boolean @default(false) @map("with_claims")` to patentSubSectorScore model

## Next Steps

1. **Check VIDEO_STREAMING completion** - Should finish soon
2. **Bring claims drive online** - After XML copy completes
3. **Rescore SECURITY with claims** - 3,790 patents
4. **Rescore WIRELESS with claims** - 3,040 patents
5. **Verify super-sector patent counts** - Fix SQL joins
6. **Start unscored super-sectors** - IMAGING (small), AI_ML (tiny), then larger ones

## Commands Reference

```bash
# Check VIDEO_STREAMING progress
tail -20 /tmp/api-server.log

# Get scored counts by sector
docker exec ip-port-postgres psql -U ip_admin -d ip_portfolio -c "
SELECT template_config_id, COUNT(*), SUM(CASE WHEN with_claims THEN 1 ELSE 0 END) as with_claims
FROM patent_sub_sector_scores
WHERE template_config_id IS NOT NULL
GROUP BY template_config_id ORDER BY template_config_id;"

# Start a sector with claims
curl -X POST "http://localhost:3001/api/scoring-templates/llm/score-sector/{sector}?useClaims=true&rescore=true"

# Export sample prompts
npx tsx scripts/export-sample-prompts.ts {sector} {limit}
```

## Rate/Cost Estimates

- **Throughput:** ~10.5 patents/min (2 parallel sectors @ concurrency=4)
- **Cost:** ~$0.015 per patent (Claude Sonnet 4)
- **Model:** claude-sonnet-4-20250514
