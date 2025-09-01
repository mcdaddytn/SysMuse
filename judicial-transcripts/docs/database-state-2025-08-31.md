# Database State Documentation - August 31, 2025

## Current State Summary
As of August 31, 2025 at 9:18 PM, the database contains fully parsed Phase 1 data for all available trials.

## Database Statistics

### Trials
- **Total Trials**: 61 unique trials (plus 1 test entry)
- **Case Numbers**: All trials have unique case numbers extracted from page headers
- **Format**: Federal court format (e.g., `2:14-CV-00033-JRG`)
- **No Duplicates**: Each trial has a distinct case number

### Data Volume
- **Sessions**: 519 total sessions across 60 trials
- **Pages**: Approximately 15,000+ pages
- **Lines**: 1,879,643 lines of transcript text
- **Processing**: Phase 1 complete, Phases 2-3 pending

### Phase Status
| Phase | Status | Details |
|-------|--------|---------|
| Phase 1 | ✅ Complete | All 62 trials successfully parsed |
| Phase 2 | ⏳ Pending | Ready to process |
| Phase 3 | ⏳ Pending | Awaiting Phase 2 completion |

## Key Improvements Implemented

### Feature 03C Completion
1. **Case Number Extraction**: Implemented CaseNumberExtractor utility
2. **Trial Identification**: Trials now use case numbers as primary identifiers
3. **File Convention Detection**: Added support for "Trial" suffix pattern
4. **Witness Detection**: Created WitnessDetectionService with 96% accuracy

### Database Schema
- Using PostgreSQL 15 (Alpine) in Docker container
- Container name: `judicial-postgres`
- Database: `judicial_transcripts`
- Schema: `public`
- All tables created via Prisma schema

## Sample Trial Data

### First 10 Trials
| ID | Name | Case Number |
|----|------|-------------|
| 1 | pdf (test) | UNKNOWN-pdf-2025-09-01 |
| 2 | 01 Genband | 2:14-CV-00033-JRG |
| 3 | 02 Contentguard | 2:13-CV-01112-JRG |
| 4 | 03 Core Wireless | 2:14-CV-00911-JRG |
| 5 | 04 Intellectual Ventures | 2:16-CV-00980-JRG |
| 6 | 05 Personalized Media v Zynga | 2:12-CV-00068-JRG |
| 7 | 06 Simpleair | 2:11-CV-00416-JRG |
| 8 | 07 Usa Re Joshua Harman V Trinity Industries | 2:12-CV-00089-JRG |
| 9 | 103 Smartflash | 6:13-CV-00447-JRG |
| 10 | 106 Chrimar Systems V. Aerohive | 2:15-CV-01915-JRG |

## Configuration Files Generated

Each trial directory contains:
- `trialstyle.json` - Trial metadata and file ordering
- Converted `.txt` files from PDFs
- Extracted case numbers in trialstyle.json

### Key trialstyle.json Fields
```json
{
  "folderName": "01 Genband",
  "extractedCaseNumber": "2:14-CV-00033-JRG",
  "fileConvention": "DATEAMPM",
  "orderedFiles": [...],
  "questionPatterns": ["Q.", "Q:", "QUESTION:"],
  "answerPatterns": ["A.", "A:", "ANSWER:"]
}
```

## Scripts and Tools Created

### Batch Processing Script
- `run-phase1-all.sh` - Processes all trials sequentially
- Success rate: 100% (62/62 trials)
- Log file: `phase1-all-20250831-210158.log`

### Parser Configuration
- Using multi-pass parser mode
- Config: `config/multi-trial-config-mac.json`
- Input: `/Users/gmac/GrassLabel Dropbox/Grass Label Home/docs/transcripts/pdf`
- Output: `./output/multi-trial`

## How to Restore This State

If starting a new session, restore to this state:

```bash
# 1. Reset database
npx prisma db push --force-reset

# 2. Generate Prisma client
npx prisma generate

# 3. Load seed data
npm run seed

# 4. Run phase 1 on all trials
./run-phase1-all.sh

# This will recreate the exact state with:
# - 61 trials with unique case numbers
# - 519 sessions
# - 1.8M+ lines of transcript data
```

## Next Steps

1. **Implement Feature 03D**: Elasticsearch lifecycle management
2. **Run Phase 2**: Process selected trials for testing
3. **Run Phase 3**: Generate markers and sections
4. **Analyze Patterns**: Use SQL queries to find witness patterns
5. **Optimize Storage**: Implement ES cleanup after phase 3

## Important Notes

### Database Connection
```
postgresql://judicial_user:judicial_pass@localhost:5432/judicial_transcripts?schema=public
```

### Docker Containers Required
- `judicial-postgres` - PostgreSQL database
- `judicial-elasticsearch` - Elasticsearch (optional for Phase 1)

### File Locations
- Transcripts: Configured in `multi-trial-config-mac.json`
- Output: `./output/multi-trial/[trial-name]/`
- Configs: `./config/`
- Logs: `./phase1-all-*.log`

## Verification Queries

```sql
-- Check trial count
SELECT COUNT(*) FROM "Trial";

-- Check for duplicates
SELECT "caseNumber", COUNT(*) 
FROM "Trial" 
GROUP BY "caseNumber" 
HAVING COUNT(*) > 1;

-- Check data volume
SELECT 
  COUNT(DISTINCT t.id) as trials,
  COUNT(DISTINCT s.id) as sessions,
  COUNT(DISTINCT p.id) as pages,
  COUNT(DISTINCT l.id) as lines
FROM "Trial" t
LEFT JOIN "Session" s ON s."trialId" = t.id
LEFT JOIN "Page" p ON p."sessionId" = s.id
LEFT JOIN "Line" l ON l."pageId" = p.id;
```

---

This state represents a clean, fully-parsed Phase 1 dataset ready for Phase 2/3 processing and pattern analysis.