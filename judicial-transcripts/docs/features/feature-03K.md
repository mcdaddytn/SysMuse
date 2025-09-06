# Feature-03K: Phase2 Attorney Matching and Speaker Association

## Overview
Fix Phase2 to properly match existing attorneys by speakerPrefix instead of creating duplicates. This enables the override workflow where attorneys are pre-loaded with speaker prefixes from LLM extraction.

## Problem Statement
Currently Phase2:
1. Creates new attorneys from session metadata without checking for existing ones
2. Ignores attorneys that were imported via overrides with speaker prefixes
3. Doesn't create proper TrialAttorney associations
4. Results in duplicate attorneys with same speaker prefixes

## Requirements

### 1. Attorney Matching by Speaker Prefix
When Phase2 encounters an attorney in session metadata:
- Extract the speaker prefix (e.g., "MR. BAXTER" from "Jeffery D. Baxter")
- Search for existing attorney with matching speakerPrefix
- If found: Use existing attorney
- If not found: Create new attorney

### 2. Speaker Creation and Association
For each matched or created attorney:
- Create Speaker record with proper type
- Link Speaker to Attorney (update attorney.speakerId)
- Ensure speaker prefix is consistent

### 3. TrialAttorney Association
Always create TrialAttorney record to link:
- Attorney to Trial
- Include role (PLAINTIFF/DEFENDANT)
- Include lawFirm association if available

### 4. Anonymous Speaker Handling
When a speaker prefix has no matching attorney:
- Create AnonymousSpeaker record
- Log for review after Phase2 completion
- Include prefix and context for later resolution

### 5. Witness Called Event Associations
Ensure WitnessCalledEvent records have proper:
- Attorney associations (who called the witness)
- Speaker associations (witness speaker)
- Trial associations

## Implementation Details

### Phase2Processor Changes

#### 1. Modify createAttorney() method
```typescript
private async createAttorney(attorneyData: any, side: string, tx: any) {
  // Generate speaker prefix from name
  const speakerPrefix = this.generateSpeakerPrefix(attorneyData.name);
  
  // Check for existing attorney with this prefix
  let attorney = await tx.attorney.findFirst({
    where: { 
      speakerPrefix: speakerPrefix 
    }
  });
  
  if (!attorney) {
    // Check by fingerprint as fallback
    const fingerprint = this.generateAttorneyFingerprint(attorneyData.name);
    attorney = await tx.attorney.findFirst({
      where: { 
        attorneyFingerprint: fingerprint 
      }
    });
  }
  
  // Create speaker
  const speaker = await tx.speaker.create({
    data: {
      trialId: this.trialId,
      speakerPrefix: speakerPrefix,
      speakerHandle: generateSpeakerHandle(attorneyData.name),
      speakerType: 'ATTORNEY',
      isGeneric: false
    }
  });
  
  if (attorney) {
    // Update existing attorney with speaker
    attorney = await tx.attorney.update({
      where: { id: attorney.id },
      data: { speakerId: speaker.id }
    });
    logger.info(`Matched existing attorney: ${attorney.name} with prefix: ${speakerPrefix}`);
  } else {
    // Create new attorney
    attorney = await tx.attorney.create({
      data: {
        name: attorneyData.name,
        speakerPrefix: speakerPrefix,
        attorneyFingerprint: this.generateAttorneyFingerprint(attorneyData.name),
        speakerId: speaker.id
      }
    });
    logger.info(`Created new attorney: ${attorney.name} with prefix: ${speakerPrefix}`);
  }
  
  // Always create TrialAttorney association
  await tx.trialAttorney.create({
    data: {
      trialId: this.trialId,
      attorneyId: attorney.id,
      role: side as AttorneyRole,
      lawFirmId: attorneyData.lawFirmId || null
    }
  });
  
  return attorney;
}
```

#### 2. Add speaker prefix generation
```typescript
private generateSpeakerPrefix(name: string): string {
  // Extract title and last name
  const parts = name.trim().split(/\s+/);
  let title = '';
  let lastName = '';
  
  // Check for common titles
  if (parts[0].match(/^(MR\.|MS\.|MRS\.|DR\.|JUDGE)/i)) {
    title = parts[0].toUpperCase().replace('.', '');
    lastName = parts[parts.length - 1].toUpperCase();
  } else {
    // Assume first name, use MR. as default
    title = 'MR.';
    lastName = parts[parts.length - 1].toUpperCase();
  }
  
  return `${title} ${lastName}`;
}

private generateAttorneyFingerprint(name: string): string {
  const parts = name.trim().split(/\s+/);
  const lastName = parts[parts.length - 1].toLowerCase();
  const firstName = parts[0].toLowerCase().replace(/^(mr|ms|mrs|dr)\.?$/i, '');
  return `${lastName}_${firstName}`.replace(/[^a-z_]/g, '');
}
```

#### 3. Handle Anonymous Speakers
```typescript
private async createAnonymousSpeaker(speakerPrefix: string, tx: any) {
  const speaker = await tx.speaker.create({
    data: {
      trialId: this.trialId,
      speakerPrefix: speakerPrefix,
      speakerHandle: generateSpeakerHandle(speakerPrefix),
      speakerType: 'ANONYMOUS',
      isGeneric: false
    }
  });
  
  await tx.anonymousSpeaker.create({
    data: {
      speakerId: speaker.id,
      trialId: this.trialId,
      originalPrefix: speakerPrefix,
      context: 'Unmatched attorney speaker from Phase2',
      needsReview: true
    }
  });
  
  logger.warn(`Created AnonymousSpeaker for unmatched prefix: ${speakerPrefix}`);
  return speaker;
}
```

## Success Criteria
1. No duplicate attorneys created when speaker prefixes match
2. All attorneys properly linked to trials via TrialAttorney
3. Speakers correctly associated with attorneys
4. Anonymous speakers created for unmatched prefixes
5. Review log shows any anonymous speakers needing resolution

## Testing Requirements
1. Reset database
2. Import override metadata with attorneys having speaker prefixes
3. Run Phase1 to parse lines
4. Run Phase2 and verify:
   - Existing attorneys are matched, not duplicated
   - TrialAttorney records created
   - Speakers properly linked
   - Anonymous speakers created for unknowns
5. Verify witness events have proper associations

## Migration Notes
- This change should not affect existing data
- Can be run on trials that already have Phase2 data (will update associations)
- Anonymous speakers can be resolved manually after review