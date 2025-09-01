# Feature 02S: Critical Parsing Fixes and Data Override System

## Overview
Address critical parsing issues discovered during multi-trial processing and implement a JSON-based override system to ensure data quality for production deployment.

## Background
After implementing feature-02R (multi-trial parsing), testing on 5 trials revealed several critical issues:
- Complex multi-party plaintiffs parsed incorrectly
- Session dates not extracted properly
- Missing start times and document numbers
- No pageId extraction
- No mechanism to fix bad data manually

With a production deadline approaching for 60+ trials, we need both parsing improvements and a safety net override system.

## Requirements

### Part A: Critical Parsing Fixes

#### 1. Multi-Party Plaintiff/Defendant Parsing
**Problem**: Trials with multiple plaintiff entities separated by commas are incorrectly parsed.

**Current Code Location**: `src/parsers/MultiPassContentParser.ts:997-1042`

**Solution**:
```typescript
// Before aggregating left side, detect multi-entity patterns
const leftSideEntities: string[] = [];
let currentEntity = '';
let inVS = false;

for (const line of leftSideLines) {
  if (line.trim() === 'VS.' || line.trim() === 'V.') {
    if (currentEntity) {
      leftSideEntities.push(currentEntity);
      currentEntity = '';
    }
    inVS = true;
  } else if (inVS) {
    // After VS., everything is defendant
    if (currentEntity) currentEntity += ' ';
    currentEntity += line.replace(/,$/, '').trim();
  } else {
    // Before VS., accumulate plaintiff entities
    if (line.endsWith(',') || line.includes(' AND ')) {
      currentEntity += ' ' + line.replace(/,$/, '').trim();
      if (line.includes(' AND ')) {
        leftSideEntities.push(currentEntity);
        currentEntity = '';
      }
    } else {
      currentEntity += ' ' + line.trim();
    }
  }
}
```

**Expected Result**:
- Plaintiff: "OPTIS WIRELESS TECHNOLOGY, LLC, OPTIS CELLULAR TECHNOLOGY, LLC, UNWIRED PLANET, LLC, UNWIRED PLANET INTERNATIONAL LIMITED, AND PANOPTIS PATENT MANAGEMENT, LLC"
- Defendant: "APPLE INC."

#### 2. Session Date Extraction Enhancement
**Problem**: Many sessions have placeholder dates instead of actual dates.

**Solution Hierarchy**:
1. Extract from filename pattern "held on MM_DD_YY"
2. Extract from summary TRIAL_DATE section
3. For files without dates, use the trial's first known date
4. Smart year detection (if YY < 50 then 20YY else 19YY)

**Implementation**:
```typescript
private extractSessionDateFromFilename(filename: string): Date | null {
  // Pattern 1: "held on MM_DD_YY"
  const match = filename.match(/held on (\d{1,2})_(\d{1,2})_(\d{2})/);
  if (match) {
    const month = parseInt(match[1]) - 1;
    const day = parseInt(match[2]);
    let year = parseInt(match[3]);
    
    // Smart year detection
    if (year < 50) {
      year = 2000 + year; // 00-49 = 2000-2049
    } else {
      year = 1900 + year; // 50-99 = 1950-1999
    }
    
    // But our trials are 2014-2020, so adjust if needed
    if (year < 2000) year = 2000 + (year - 1900);
    
    return new Date(year, month, day);
  }
  
  return null;
}
```

#### 3. Start Time Extraction Fix
**Problem**: Start times extracted but not properly stored.

**Location**: `src/parsers/MultiPassContentParser.ts:913-938`

**Fix**: Ensure timezone handling and proper date object creation.

#### 4. Document Number Extraction
**New Implementation Required**

**Pattern in headers**: "Document (\d+) Filed"

**Storage**: Add to Session model or Page metadata

#### 5. PageId Extraction
**New Implementation Required**

**Location**: During page creation in `parsePages()`

**Pattern**: "PageID #?: ?(\d+)"

**Update**:
```typescript
// In parsePages method
const pageIdMatch = headerText?.match(/PageID\s*#?:?\s*(\d+)/i);
const pageId = pageIdMatch ? parseInt(pageIdMatch[1]) : null;

await this.prisma.page.create({
  data: {
    sessionId,
    pageNumber,
    pageId, // Add this
    headerText,
    footerText
  }
});
```

### Part B: JSON Override System

#### 1. Override File Structure
Create a standardized JSON format for data corrections:

```json
{
  "version": "1.0",
  "description": "Manual corrections for trial data",
  "timestamp": "2025-09-01T12:00:00Z",
  "overrides": {
    "trials": [
      {
        "id": 4,
        "fields": {
          "plaintiff": "corrected plaintiff name",
          "defendant": "corrected defendant name",
          "name": "corrected full name"
        }
      }
    ],
    "sessions": [
      {
        "id": 35,
        "fields": {
          "sessionDate": "2020-08-03",
          "startTime": "08:30:00",
          "documentNumber": "1423"
        }
      }
    ],
    "pages": [
      {
        "where": {
          "sessionId": 35,
          "pageNumber": 1
        },
        "fields": {
          "pageId": 16220
        }
      }
    ]
  }
}
```

#### 2. Override CLI Command
Create new command: `npm run apply-overrides <file.json>`

**Implementation**: `src/cli/override.ts`

```typescript
import { Command } from 'commander';
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';

const program = new Command();

program
  .name('override')
  .description('Apply manual data corrections from JSON file')
  .argument('<file>', 'Path to override JSON file')
  .option('--dry-run', 'Preview changes without applying')
  .action(async (file, options) => {
    const prisma = new PrismaClient();
    
    try {
      const overrides = JSON.parse(fs.readFileSync(file, 'utf-8'));
      
      // Validate schema
      validateOverrideSchema(overrides);
      
      // Apply trial overrides
      for (const trial of overrides.overrides.trials || []) {
        if (options.dryRun) {
          console.log(`Would update Trial ${trial.id}:`, trial.fields);
        } else {
          await prisma.trial.update({
            where: { id: trial.id },
            data: trial.fields
          });
          console.log(`Updated Trial ${trial.id}`);
        }
      }
      
      // Apply session overrides
      for (const session of overrides.overrides.sessions || []) {
        if (session.fields.sessionDate) {
          session.fields.sessionDate = new Date(session.fields.sessionDate);
        }
        if (session.fields.startTime) {
          // Convert time string to full datetime
          const timeMatch = session.fields.startTime.match(/(\d+):(\d+):(\d+)/);
          if (timeMatch) {
            const sessionDate = await prisma.session.findUnique({
              where: { id: session.id },
              select: { sessionDate: true }
            });
            
            if (sessionDate?.sessionDate) {
              const startTime = new Date(sessionDate.sessionDate);
              startTime.setHours(parseInt(timeMatch[1]), parseInt(timeMatch[2]), parseInt(timeMatch[3]));
              session.fields.startTime = startTime;
            }
          }
        }
        
        if (options.dryRun) {
          console.log(`Would update Session ${session.id}:`, session.fields);
        } else {
          await prisma.session.update({
            where: { id: session.id },
            data: session.fields
          });
          console.log(`Updated Session ${session.id}`);
        }
      }
      
      // Apply page overrides
      for (const page of overrides.overrides.pages || []) {
        if (page.where && page.fields) {
          if (options.dryRun) {
            console.log(`Would update Pages matching:`, page.where, 'with:', page.fields);
          } else {
            await prisma.page.updateMany({
              where: page.where,
              data: page.fields
            });
            console.log(`Updated pages matching criteria`);
          }
        }
      }
      
      console.log('✅ Overrides applied successfully');
      
    } catch (error) {
      console.error('❌ Override failed:', error);
      process.exit(1);
    } finally {
      await prisma.$disconnect();
    }
  });

program.parse();
```

#### 3. Validation System
Implement schema validation to prevent bad overrides:

```typescript
function validateOverrideSchema(data: any): void {
  // Check version
  if (!data.version || data.version !== '1.0') {
    throw new Error('Invalid or missing version');
  }
  
  // Check structure
  if (!data.overrides) {
    throw new Error('Missing overrides section');
  }
  
  // Validate trial overrides
  if (data.overrides.trials) {
    for (const trial of data.overrides.trials) {
      if (!trial.id || typeof trial.id !== 'number') {
        throw new Error('Invalid trial id');
      }
      if (!trial.fields || typeof trial.fields !== 'object') {
        throw new Error('Invalid trial fields');
      }
    }
  }
  
  // Similar validation for sessions and pages...
}
```

#### 4. Override Files Organization
```
overrides/
  ├── 01-genband-corrections.json
  ├── 02-contentguard-corrections.json
  ├── 14-optis-corrections.json
  ├── 42-vocalife-corrections.json
  ├── 50-packet-corrections.json
  └── README.md
```

## Implementation Plan

### Phase 1: Parser Fixes (Day 1)
1. Fix multi-party plaintiff parsing
2. Improve session date extraction
3. Fix start time storage
4. Add pageId extraction

### Phase 2: Override System (Day 1-2)
1. Create override CLI command
2. Implement validation
3. Test with sample data
4. Create override files for known issues

### Phase 3: Testing (Day 2)
1. Reset database
2. Run Phase 1 parsing
3. Apply overrides
4. Verify all data correct

## Testing Checklist

- [ ] Optis trial has correct plaintiff (multiple entities)
- [ ] Optis trial has correct defendant (just "APPLE INC.")
- [ ] All sessions have non-placeholder dates
- [ ] All sessions have start times
- [ ] Pages have pageId values
- [ ] Override system can fix remaining issues
- [ ] Dry-run mode works correctly
- [ ] Invalid override files are rejected

## Success Metrics

1. **Party Names**: 100% correct across all trials
2. **Session Dates**: 95%+ correct (remainder fixed by overrides)
3. **Start Times**: 90%+ populated
4. **Page IDs**: 100% extracted where present
5. **Override System**: Can fix any data issue within 5 minutes

## Rollback Plan

If parsing fixes cause issues:
1. Keep original parsing code
2. Use override system exclusively for corrections
3. Document all manual corrections needed

## Production Deployment

1. Run Phase 1 parsing on all 60+ trials
2. Generate report of issues
3. Create override files for each trial as needed
4. Apply overrides
5. Validate data quality
6. Export for production use

## Dependencies

- Existing Phase 1 parser
- Prisma database schema
- Node.js filesystem access
- JSON validation library (optional)

## Files to Modify

1. `src/parsers/MultiPassContentParser.ts` - Parser fixes
2. `src/cli/override.ts` - New override command (create)
3. `package.json` - Add override script
4. `overrides/*.json` - Override data files (create)

## Documentation Updates

1. Update `docs/database-testing-guide.md` with override process
2. Create `docs/override-system-guide.md`
3. Update `CLAUDE.md` with override command