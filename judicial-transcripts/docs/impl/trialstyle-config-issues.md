# TrialStyle Configuration Issues - Witness/Answer Patterns

## Overview
Multiple trials are failing Phase 2 processing due to incorrect witness answer patterns in their trialstyle.json configurations. The parser is unable to resolve "A" speaker references because the answer patterns don't match the actual transcript format.

## Trials Requiring Configuration Updates

### Batch 2 - Phase 2 Failed Trials

#### Trial 3: 19 Alfonso Cioffi Et Al V. Google
- **Issue**: "Unable to resolve A speaker - no current witness" warnings
- **Current Config**: Default answer patterns
- **Action Needed**: Check actual answer format in transcripts
- **Files to Review**: 
  - `output/multi-trial/19 Alfonso Cioffi Et Al V. Google/trialstyle.json`
  - Sample transcript files to identify actual Q&A patterns

#### Trial 4: 20 Biscotti Inc. V. Microsoft Corp
- **Issue**: Phase 2 did not process events
- **Current Config**: Default patterns
- **Action Needed**: Verify question/answer patterns
- **Files to Review**:
  - `output/multi-trial/20 Biscotti Inc. V. Microsoft Corp/trialstyle.json`

#### Trial 5: 21 Cassidian V Microdata
- **Issue**: Phase 2 did not process events
- **Current Config**: Default patterns
- **Action Needed**: Check Q&A format
- **Files to Review**:
  - `output/multi-trial/21 Cassidian V Microdata/trialstyle.json`

### Previously Identified Issues

#### Trial 4: Optis Wireless Technology V. Huawei (Batch 1)
- **Issue**: 0 witness events despite 8,465 total events
- **Likely Cause**: Answer patterns not matching transcript format
- **Action Needed**: Review and update answer patterns

## Common Pattern Variations to Check

### Question Patterns
Currently checking for:
- `Q.`
- `Q:`
- `Q`

May need to add:
- `QUESTION:`
- `Q `
- Pattern with different spacing

### Answer Patterns  
Currently checking for:
- `A.`
- `A:`
- `A`

May need to add:
- `ANSWER:`
- `A ` (with space)
- `THE WITNESS:`
- Witness name directly (e.g., `MR. SMITH:`)

### Attorney Indicator Patterns
Currently checking for:
- `BY MR\\. ([A-Z]+)`
- `BY MS\\. ([A-Z]+)`
- `BY MRS\\. ([A-Z]+)`
- `BY DR\\. ([A-Z]+)`

May need variations for:
- Different spacing
- Different titles
- Direct attorney names without "BY"

## Configuration Update Process

1. **Examine Transcript**: Open actual .txt files to see Q&A format
2. **Update trialstyle.json**: Modify these fields:
   ```json
   {
     "questionPatterns": ["Q.", "Q:", "Q", "QUESTION:"],
     "answerPatterns": ["A.", "A:", "A", "ANSWER:", "THE WITNESS:"],
     "attorneyIndicatorPatterns": [...]
   }
   ```
3. **Test Phase 2**: Re-run Phase 2 for the specific trial
4. **Verify Events**: Check that witness events are being created

## Trials Working Correctly (for reference)

### Successful Pattern Detection
- **17 Wi-Lan V. Apple**: 98 witness events
- **18 Wi-Lan V. Htc**: 25 witness events
- **Core Wireless** (Batch 1): 27 witness events
- **Metaswitch** (Batch 1): 45 witness events

These trials can be used as references for proper configuration.

## Delimiter Issues (Separate from Q&A Patterns)

### Trials with Known Delimiter Issues
- **Trial 83 (Koninklijke)**: Mixed delimiters
- **Trial 86 (Ollnova)**: Mixed delimiters  
- **Trial 101 (Netlist)**: Mixed delimiters
- **Trial 73 (Tq Delta)**: Variable delimiter (switches between "(" and ")")

## Next Steps

1. **Batch Review**: Open transcripts for failed trials to identify actual patterns
2. **Update Configs**: Modify trialstyle.json files with correct patterns
3. **Test Individually**: Run Phase 2 for each updated trial
4. **Document Patterns**: Create a pattern library for common variations
5. **Consider Auto-Detection**: Enhance parser to detect patterns automatically

## Notes
- The "Unable to resolve A speaker" warning specifically indicates the answer pattern is not being recognized
- Some trials may use witness names directly instead of "A" for answers
- Attorney examination patterns may also need adjustment for proper context switching