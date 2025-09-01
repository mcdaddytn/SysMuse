# Witness Detection Pattern Variations

## Problem Statement
Witness detection patterns vary significantly between different court cases and jurisdictions. Current regex-based detection is too rigid to handle all variations.

## Observed Patterns

### Optis v Apple (Trial ID 9)
- **Plaintiff Format**: `BRIAN BLASIUS, PLAINTIFFS' WITNESS, SWORN`
- **Defendant Format**: `TONY BLEVINS, DEFENDANT'S WITNESS, SWORN`
- Note: Uses "PLAINTIFFS'" (plural possessive) vs "DEFENDANT'S" (singular possessive)

### Vocalife v Amazon (Trial ID 18)
- **Format 1**: `QI "PETER" LI, PLAINTIFF'S WITNESS, SWORN` (with nickname in quotes)
- **Format 2**: `MANLI ZHU, PH.D., PLAINTIFF'S WITNESS, SWORN` (with credential)
- **Format 3**: `JOSEPH C. MCALEXANDER, III, PLAINTIFF'S WITNESS, SWORN` (with suffix)
- Note: Uses "PLAINTIFF'S" (singular possessive)

### Genband v Metaswitch (Trial ID 1)
- TBD - need to examine

### Packet Intelligence v Netscout (Trial ID 29)
- TBD - need to examine

## Variations to Consider
1. **Order variations**: Name might come before or after "WITNESS"
2. **Possessive variations**: PLAINTIFF'S, PLAINTIFFS', PLAINTIFF, PLAINTIFFS
3. **Sworn status**: SWORN, PREVIOUSLY SWORN, RECALLED, etc.
4. **Titles/Credentials**: Ph.D., Dr., Mr., Ms., etc.
5. **Punctuation**: Commas may or may not be present
6. **Case variations**: Some courts use mixed case instead of all caps

## Proposed Solution for Full Dataset Analysis
1. Load all 60 cases into database
2. Extract all lines containing "WITNESS" and "SWORN"
3. Analyze patterns using NLP/clustering techniques
4. Develop a flexible parser that can:
   - Handle variable word order
   - Extract components (name, party, sworn status)
   - Use context clues from surrounding lines
   - Learn from corrections/feedback

## Temporary Solution
For now, create a more flexible pattern that handles at least Optis and Vocalife formats:

### Pattern Components to Detect:
1. **Core Pattern**: Line must contain "WITNESS" and "SWORN"
2. **Party Variations**: 
   - PLAINTIFF'S, PLAINTIFFS', PLAINTIFF, PLAINTIFFS
   - DEFENDANT'S, DEFENDANTS', DEFENDANT, DEFENDANTS
3. **Name Extraction**: Everything before the first comma (may include):
   - Simple names: TONY BLEVINS
   - Names with nicknames: QI "PETER" LI
   - Names with credentials: MANLI ZHU, PH.D.
   - Names with suffixes: JOSEPH C. MCALEXANDER, III

### Proposed Detection Algorithm:
```typescript
function detectWitness(line: string): WitnessInfo | null {
  // Check if line contains required keywords
  if (!line.includes('WITNESS') || !line.includes('SWORN')) {
    return null;
  }
  
  // Split by commas to get components
  const parts = line.split(',').map(p => p.trim());
  
  // First part is usually the name (including any nickname, credential in name)
  const namePart = parts[0];
  
  // Find party designation
  let party: 'PLAINTIFF' | 'DEFENDANT' | null = null;
  for (const part of parts) {
    if (part.match(/PLAINTIFF/i)) {
      party = 'PLAINTIFF';
      break;
    } else if (part.match(/DEFENDANT/i)) {
      party = 'DEFENDANT';
      break;
    }
  }
  
  // Extract sworn status
  const swornStatus = line.includes('PREVIOUSLY SWORN') ? 'PREVIOUSLY_SWORN' : 'SWORN';
  
  return {
    name: cleanName(namePart),
    party,
    swornStatus
  };
}

function cleanName(name: string): string {
  // Remove line numbers and timestamps
  return name.replace(/^\d+:\d+:\d+\s+\d+\s+/, '').trim();
}
```

## Future Work
- Implement machine learning-based witness detection
- Create a pattern library that can be configured per jurisdiction
- Add ability to manually correct and train the system