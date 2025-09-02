# Batch 5 Extended Delimiter Notes

## Trials with Known Delimiters
- **Trial 95 (Lake Cherokee)**: Uses "*" delimiter
- **Trial 103 (Smartflash)**: Uses ")" delimiter  
- **Trial 106 (Chrimar Systems V. Aerohive)**: Uses ")" delimiter

## Trials with Mixed Delimiters (Need AUTO Enhancement)
- **Trial 83 (Koninklijke)**: Mixed delimiters - varies by line
- **Trial 86 (Ollnova)**: Mixed delimiters - varies by line
- **Trial 101 (Netlist, Inc. V. Samsung)**: Mixed delimiters - varies by line

## Key Findings
1. **PM1 Session Handling**: Code updated to treat PM1 as EVENING session type to avoid unique constraint violations
2. **Trial 68 (Contentguard)**: Should now work with PM1 fix (has both PM and PM1 files for Sept 22, 2015)
3. **AUTO Mode Enhancement Needed**: Parser needs ability to detect and handle multiple delimiter patterns within same file
   - Some trials use different delimiters on different lines
   - Current AUTO mode assumes single delimiter per file

## Implementation Notes
- Fixed delimiters applied to trialstyle.json for trials 95, 103, 106
- Trials with mixed delimiters left as AUTO for now
- PM1/AM1 detection added to parse.ts to use different session types