# Feature 02K: Implementation Guide

## Overview
This guide provides step-by-step instructions for implementing enhanced speaker identification with multi-trial support.

## Phase 1: Summary Section Enhancement

### Step 1.1: Update Summary Parser

1. Locate `src/parsers/TranscriptParser.ts` or create new `SummaryParser.ts`
2. Implement attorney extraction:

```typescript
private async extractAttorneysFromSummary(
  lines: string[],
  trialId: number
): Promise<void> {
  // Look for APPEARANCES: section
  const appearancesIndex = lines.findIndex(l => 
    l.includes('APPEARANCES:') || l.includes('APPEARING:')
  );
  
  if (appearancesIndex === -1) return;
  
  // Parse attorneys for plaintiff and defendant
  const attorneys = this.parseAttorneyBlock(
    lines.slice(appearancesIndex + 1)
  );
  
  // Create database records
  for (const attorney of attorneys) {
    await this.createAttorneyWithSpeaker(attorney, trialId);
  }
}
```

### Step 1.2: Law Firm Association

```typescript
private async parseLawFirms(
  attorneyBlock: string[],
  trialId: number
): Promise<LawFirm[]> {
  const lawFirms: LawFirm[] = [];
  
  // Pattern: "Smith & Jones, LLP"
  const firmPattern = /^([A-Z][A-Za-z\s&,\.]+(?:LLP|LLC|PC|PA|PLLC))/;
  
  for (const line of attorneyBlock) {
    const match = line.match(firmPattern);
    if (match) {
      const firm = await this.findOrCreateLawFirm(match[1], trialId);
      lawFirms.push(firm);
    }
  }
  
  return lawFirms;
}
```

## Phase 2: Speaker Registry Implementation

### Step 2.1: Create Speaker Registry Class

Create `src/services/SpeakerRegistry.ts`:

```typescript
export class SpeakerRegistry {
  private trialId: number;
  private speakers: Map<string, Speaker> = new Map();
  private attorneysByName: Map<string, Attorney> = new Map();
  private contextualSpeakers: Map<string, Speaker> = new Map();
  
  constructor(private prisma: PrismaClient, trialId: number) {
    this.trialId = trialId;
  }
  
  async initialize(): Promise<void> {
    // Load all speakers for this trial
    const speakers = await this.prisma.speaker.findMany({
      where: { trialId: this.trialId },
      include: {
        attorney: true,
        witness: true,
        judge: true,
        juror: true
      }
    });
    
    // Build lookup maps
    for (const speaker of speakers) {
      this.speakers.set(speaker.speakerPrefix, speaker);
      
      if (speaker.attorney) {
        const lastName = speaker.attorney.lastName || 
                        this.extractLastName(speaker.attorney.name);
        this.attorneysByName.set(lastName.toUpperCase(), speaker.attorney);
      }
    }
  }
  
  async findOrCreateSpeaker(
    prefix: string,
    type: SpeakerType = 'UNKNOWN'
  ): Promise<Speaker> {
    // Check cache first
    if (this.speakers.has(prefix)) {
      return this.speakers.get(prefix)!;
    }
    
    // Try to find in database
    let speaker = await this.prisma.speaker.findUnique({
      where: {
        trialId_speakerHandle: {
          trialId: this.trialId,
          speakerHandle: this.normalizeHandle(prefix)
        }
      }
    });
    
    if (!speaker) {
      // Create new speaker
      speaker = await this.createSpeaker(prefix, type);
    }
    
    this.speakers.set(prefix, speaker);
    return speaker;
  }
}
```

### Step 2.2: Examination Context Manager

Create `src/services/ExaminationContextManager.ts`:

```typescript
export class ExaminationContextManager {
  private currentWitness: Witness | null = null;
  private examiningAttorney: Attorney | null = null;
  private opposingAttorney: Attorney | null = null;
  private examinationType: ExaminationType | null = null;
  private isVideoDeposition: boolean = false;
  
  updateFromLine(line: ParsedLine): void {
    // Check for witness call
    const witnessMatch = line.text?.match(
      /^([A-Z\s]+),\s+(PLAINTIFF'S|DEFENDANT'S)\s+WITNESS/
    );
    
    if (witnessMatch) {
      this.currentWitness = {
        name: witnessMatch[1],
        type: witnessMatch[2].includes('PLAINTIFF') ? 
              'PLAINTIFF' : 'DEFENDANT'
      };
    }
    
    // Check for examination type
    if (line.text?.includes('DIRECT EXAMINATION')) {
      this.examinationType = 'DIRECT';
    } else if (line.text?.includes('CROSS-EXAMINATION')) {
      this.examinationType = 'CROSS';
    }
    
    // Check for BY attorney
    const byMatch = line.text?.match(
      /^BY\s+(MR\.|MS\.|MRS\.|DR\.)\s+([A-Z]+):/
    );
    
    if (byMatch) {
      this.examiningAttorney = {
        title: byMatch[1],
        lastName: byMatch[2]
      };
    }
  }
  
  resolveQSpeaker(): Speaker | null {
    return this.examiningAttorney ? 
           this.attorneyToSpeaker(this.examiningAttorney) : null;
  }
  
  resolveASpeaker(): Speaker | null {
    return this.currentWitness ? 
           this.witnessToSpeaker(this.currentWitness) : null;
  }
}
```

## Phase 3: Q&A Format Support

### Step 3.1: Update Phase2Processor

Modify `src/parsers/Phase2Processor.ts`:

```typescript
export class Phase2Processor {
  private speakerRegistry: SpeakerRegistry;
  private examinationContext: ExaminationContextManager;
  
  async initialize(trialId: number): Promise<void> {
    this.speakerRegistry = new SpeakerRegistry(this.prisma, trialId);
    await this.speakerRegistry.initialize();
    
    this.examinationContext = new ExaminationContextManager();
  }
  
  async processLine(line: ParsedLine): Promise<void> {
    // Update examination context
    this.examinationContext.updateFromLine(line);
    
    // Extract speaker
    const speaker = await this.resolveSpeaker(line);
    
    if (speaker) {
      await this.createStatementEvent(line, speaker);
    }
  }
  
  private async resolveSpeaker(line: ParsedLine): Promise<Speaker | null> {
    const text = line.text?.trim();
    if (!text) return null;
    
    // Check Q&A formats
    if (text.startsWith('Q.') || text.startsWith('QUESTION:')) {
      return this.examinationContext.resolveQSpeaker();
    }
    
    if (text.startsWith('A.') || text.startsWith('ANSWER:')) {
      return this.examinationContext.resolveASpeaker();
    }
    
    // Check for THE ATTORNEY (video deposition)
    if (text.startsWith('THE ATTORNEY:')) {
      return this.examinationContext.resolveOpposingAttorney();
    }
    
    // Standard speaker with colon
    const speakerMatch = text.match(/^([A-Z][A-Z\s\.,'-]+?):\s*/);
    if (speakerMatch) {
      return this.speakerRegistry.findOrCreateSpeaker(
        speakerMatch[1],
        this.inferSpeakerType(speakerMatch[1])
      );
    }
    
    return null;
  }
}
```

## Phase 4: Multi-Trial Support

### Step 4.1: Update Database Queries

Ensure all speaker queries include trialId:

```typescript
// Bad - can match speakers from other trials
const speaker = await prisma.speaker.findFirst({
  where: { speakerPrefix: 'MR. SMITH' }
});

// Good - scoped to specific trial
const speaker = await prisma.speaker.findFirst({
  where: { 
    trialId: currentTrialId,
    speakerPrefix: 'MR. SMITH' 
  }
});
```

### Step 4.2: Trial-Scoped Services

Create `src/services/MultiTrialSpeakerService.ts`:

```typescript
export class MultiTrialSpeakerService {
  constructor(
    private prisma: PrismaClient,
    private trialId: number
  ) {}
  
  async findSpeakerByPrefix(prefix: string): Promise<Speaker | null> {
    return this.prisma.speaker.findFirst({
      where: {
        trialId: this.trialId,
        speakerPrefix: prefix
      }
    });
  }
  
  async createSpeaker(data: CreateSpeakerData): Promise<Speaker> {
    return this.prisma.speaker.create({
      data: {
        ...data,
        trialId: this.trialId // Always include trialId
      }
    });
  }
  
  async findAttorneyByName(lastName: string): Promise<Attorney | null> {
    return this.prisma.attorney.findFirst({
      where: {
        lastName: lastName,
        trialAttorneys: {
          some: { trialId: this.trialId }
        }
      }
    });
  }
}
```

## Phase 5: Integration with Multi-Pass Parser

### Step 5.1: Update MultiPassContentParser

Modify `src/parsers/MultiPassContentParser.ts`:

```typescript
export class ContentParser {
  private speakerService: MultiTrialSpeakerService;
  private speakerRegistry: SpeakerRegistry;
  
  async parseContent(
    metadata: ParsedMetadata,
    structure: StructureAnalysis,
    sessionId: number,
    trialId: number,
    batchSize: number
  ): Promise<void> {
    // Initialize speaker services
    this.speakerService = new MultiTrialSpeakerService(
      this.prisma, 
      trialId
    );
    
    this.speakerRegistry = new SpeakerRegistry(
      this.prisma, 
      trialId
    );
    await this.speakerRegistry.initialize();
    
    // Process lines with speaker identification
    for (const line of metadata.lines.values()) {
      const speaker = await this.identifySpeaker(line);
      // ... rest of processing
    }
  }
}
```

## Testing Strategy

### Unit Tests

1. Test speaker pattern matching
2. Test Q&A format resolution
3. Test examination context tracking
4. Test multi-trial isolation

### Integration Tests

Create `src/parsers/__tests__/SpeakerIdentification.test.ts`:

```typescript
describe('Speaker Identification', () => {
  it('should identify attorneys from summary', async () => {
    // Test attorney extraction
  });
  
  it('should resolve Q&A formats correctly', async () => {
    // Test Q/A mapping
  });
  
  it('should maintain trial isolation', async () => {
    // Test multi-trial scenarios
  });
});
```

## Rollout Plan

1. **Phase 1**: Implement summary parsing enhancements
2. **Phase 2**: Add speaker registry and basic matching
3. **Phase 3**: Implement Q&A format support
4. **Phase 4**: Add multi-trial isolation
5. **Phase 5**: Full integration and testing

## Monitoring and Validation

### Metrics to Track

- Speaker match rate (% of lines with identified speakers)
- Q&A resolution accuracy
- Cross-trial contamination incidents
- Processing time impact

### Validation Queries

```sql
-- Check speaker distribution by trial
SELECT 
  t.id as trial_id,
  t.name as trial_name,
  st.speaker_type,
  COUNT(*) as speaker_count
FROM speakers s
JOIN trials t ON s.trial_id = t.id
GROUP BY t.id, t.name, s.speaker_type
ORDER BY t.id, s.speaker_type;

-- Find unmatched speakers
SELECT 
  trial_id, 
  speaker_prefix,
  COUNT(*) as occurrences
FROM speakers
WHERE speaker_type = 'UNKNOWN'
GROUP BY trial_id, speaker_prefix
ORDER BY occurrences DESC;
```

## Regression Testing

### Baseline Record Counts

The system must maintain baseline record counts after any refactoring. Reference: `docs/baseline-record-counts.md`

#### Key Baseline Metrics (Phase 1 & 2)
```
Table                    Expected Count
----------------------------------------
trial                    1
session                  12
page                     1533
line                     38550
speaker                  81
attorney                 19
lawFirm                  6
lawFirmOffice            7
trialAttorney            19
witness                  16
witnessCalledEvent       58
judge                    1
juror                    39
statementEvent           12265
trialEvent               12480
anonymousSpeaker         6
```

### Regression Test Script

Create `src/scripts/testRegression.ts`:

```typescript
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const BASELINE_COUNTS = {
  trial: 1,
  session: 12,
  page: 1533,
  line: 38550,
  speaker: 81,
  attorney: 19,
  lawFirm: 6,
  lawFirmOffice: 7,
  trialAttorney: 19,
  witness: 16,
  witnessCalledEvent: 58,
  judge: 1,
  juror: 39,
  statementEvent: 12265,
  trialEvent: 12480,
  anonymousSpeaker: 6
};

async function runRegressionTest() {
  console.log('🔍 Running Regression Tests\n');
  
  let passed = 0;
  let failed = 0;
  const failures: string[] = [];
  
  for (const [table, expectedCount] of Object.entries(BASELINE_COUNTS)) {
    try {
      const actualCount = await (prisma as any)[table].count();
      
      if (actualCount === expectedCount) {
        console.log(`✅ ${table}: ${actualCount} (expected ${expectedCount})`);
        passed++;
      } else {
        console.log(`❌ ${table}: ${actualCount} (expected ${expectedCount}, diff: ${actualCount - expectedCount})`);
        failed++;
        failures.push(`${table}: expected ${expectedCount}, got ${actualCount}`);
      }
    } catch (error) {
      console.log(`❌ ${table}: ERROR accessing table`);
      failed++;
      failures.push(`${table}: error accessing table`);
    }
  }
  
  console.log('\n📊 Summary:');
  console.log(`  Passed: ${passed}/${Object.keys(BASELINE_COUNTS).length}`);
  console.log(`  Failed: ${failed}/${Object.keys(BASELINE_COUNTS).length}`);
  
  if (failures.length > 0) {
    console.log('\n❌ Failures:');
    failures.forEach(f => console.log(`  - ${f}`));
    process.exit(1);
  } else {
    console.log('\n✅ All regression tests passed!');
  }
  
  await prisma.$disconnect();
}

runRegressionTest().catch(console.error);
```

### Running Regression Tests

#### Full Regression Test Sequence
```bash
# 1. Reset database
npx prisma db push --force-reset

# 2. Run seed
npm run seed

# 3. Run Phase 1 (legacy parser for baseline compatibility)
npx ts-node src/cli/parse.ts parse --phase1 --config config/example-trial-config-mac.json --parser-mode legacy

# 4. Run Phase 2
npx ts-node src/cli/parse.ts parse --phase2 --config config/example-trial-config-mac.json --trial-id 1

# 5. Run regression test
npx ts-node src/scripts/testRegression.ts
```

#### Quick Regression Check
```bash
# After phases complete, check counts
npx ts-node -e "
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const tables = ['attorney', 'lawFirm', 'witness', 'witnessCalledEvent', 'speaker', 'statementEvent'];
Promise.all(tables.map(async t => ({ 
  table: t, 
  count: await prisma[t].count() 
}))).then(results => {
  results.forEach(r => console.log(\`\${r.table}: \${r.count}\`));
  prisma.\$disconnect();
});
"
```

### Critical Regression Points

1. **Attorney Extraction**: Must extract 19 attorneys from summary sections
2. **Law Firm Association**: Must create 6 law firms with 7 offices
3. **Witness Events**: Must detect all 58 witness called events
4. **Speaker Creation**: Must create exactly 81 speakers (no duplicates)
5. **Statement Events**: Must create 12,265 statement events with proper speaker associations

### Acceptance Criteria for Speaker Identification

- [ ] All baseline record counts match exactly
- [ ] No duplicate speakers created
- [ ] Attorneys properly associated with law firms
- [ ] Witnesses properly associated with callers (PLAINTIFF/DEFENDANT)
- [ ] Q&A formats resolved to correct speakers
- [ ] Multi-trial isolation verified (no cross-contamination)

## Troubleshooting

### Common Issues

1. **Speakers not matching**: Check speaker prefix normalization
2. **Q&A not resolving**: Verify examination context is updating
3. **Cross-trial contamination**: Ensure all queries include trialId
4. **Missing attorneys**: Check summary parsing patterns
5. **Low record counts**: Verify all transcript files are being processed

### Debug Logging

Add comprehensive logging:

```typescript
logger.debug('Speaker identification', {
  trialId,
  lineText: line.text,
  identifiedSpeaker: speaker?.speakerPrefix,
  speakerType: speaker?.speakerType,
  examinationContext: {
    witness: this.examinationContext.currentWitness?.name,
    attorney: this.examinationContext.examiningAttorney?.name,
    type: this.examinationContext.examinationType
  }
});
```