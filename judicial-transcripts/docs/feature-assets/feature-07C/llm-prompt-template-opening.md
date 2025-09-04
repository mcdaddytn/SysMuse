# LLM Prompt Template: Opening Statements Detection

## System Prompt
You are a legal transcript analyst specializing in identifying key sections of trial proceedings. You will analyze transcript excerpts to identify the exact boundaries of opening statements.

## Task Template
```
Analyze the following transcript excerpt to identify opening statements.

CONTEXT:
- Trial: {{trialName}}
- Case Number: {{caseNumber}}
- Date: {{sessionDate}}
- Known Information:
  - First witness testimony begins at line {{firstWitnessLine}}
  - Opening statements should occur before line {{firstWitnessLine}}

SEARCH CRITERIA:
1. Look for phrases like:
   - "opening statement"
   - "opening argument"
   - "Ladies and gentlemen of the jury"
   - "The evidence will show"
   - "What we intend to prove"
   - "May it please the Court"

2. Identify speakers:
   - Plaintiff's attorney(s): {{plaintiffAttorneys}}
   - Defense attorney(s): {{defenseAttorneys}}

3. Structure indicators:
   - Judge introducing opening statements
   - Attorney beginning their statement
   - Attorney concluding their statement
   - Transition between plaintiff and defense

TRANSCRIPT EXCERPT:
{{transcriptExcerpt}}

TASK:
Identify the following markers with high confidence (0.0-1.0):
1. Opening Statements Period Begin (judge introduces)
2. Plaintiff Opening Statement Begin
3. Plaintiff Opening Statement End
4. Defense Opening Statement Begin
5. Defense Opening Statement End
6. Opening Statements Period End (transition to next phase)

OUTPUT FORMAT:
Return a JSON object with the following structure:
{
  "markers": [
    {
      "name": "marker name",
      "markerType": "OPENING_BEGIN|OPENING_END|SECTION_BEGIN|SECTION_END",
      "sessionLineNumber": number,
      "confidence": 0.0-1.0,
      "speaker": "speaker name if applicable",
      "contextQuote": "relevant quote from transcript",
      "reasoning": "brief explanation"
    }
  ],
  "markerSections": [
    {
      "name": "section name",
      "sectionType": "OPENING_STATEMENTS_PERIOD|OPENING_STATEMENT_PLAINTIFF|OPENING_STATEMENT_DEFENSE",
      "startMarker": "marker name",
      "endMarker": "marker name",
      "metadata": {
        "attorney": "name",
        "estimatedDuration": "minutes"
      }
    }
  ]
}
```

## Example Analysis

### Input Context
```
Trial: VOCALIFE LLC VS. AMAZON.COM, INC.
First witness at line 801
Plaintiff attorneys: MR. FABRICANT, MR. LAMBRIANAKOS
Defense attorneys: MS. JONES, MR. CHEN
```

### Expected Output Structure
```json
{
  "markers": [
    {
      "name": "Opening Statements Period Begin",
      "markerType": "SECTION_BEGIN",
      "sessionLineNumber": 501,
      "confidence": 0.95,
      "speaker": "THE COURT",
      "contextQuote": "We will now proceed with opening statements",
      "reasoning": "Judge explicitly introduces opening statements phase"
    },
    {
      "name": "Plaintiff Opening Begin",
      "markerType": "OPENING_BEGIN",
      "sessionLineNumber": 511,
      "confidence": 0.92,
      "speaker": "MR. FABRICANT",
      "contextQuote": "May it please the Court, counsel, ladies and gentlemen of the jury",
      "reasoning": "Standard opening statement introduction by plaintiff's counsel"
    }
  ]
}
```

## Confidence Guidelines

- **0.95-1.0**: Explicit mention of "opening statement" with clear speaker identification
- **0.85-0.94**: Strong contextual indicators with standard legal phrases
- **0.75-0.84**: Probable based on position and content
- **0.60-0.74**: Possible but requires validation
- **< 0.60**: Too uncertain, do not include

## Edge Cases to Consider

1. **Split Opening**: Sometimes opening statements are split across sessions
2. **Reserved Opening**: Defense may reserve opening until their case
3. **Joint Opening**: Multiple attorneys may share opening
4. **Interrupted Opening**: Judge may interrupt for procedural matters
5. **No Opening**: Rare cases may proceed without formal openings

## Validation Checks

1. Opening statements should occur before first witness testimony
2. Duration typically 30-90 minutes per side
3. Should follow jury selection (if jury trial)
4. Should precede any evidence presentation
5. Both sides usually present (unless reserved)