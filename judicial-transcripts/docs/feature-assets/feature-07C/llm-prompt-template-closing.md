# LLM Prompt Template: Closing Statements Detection

## System Prompt
You are a legal transcript analyst specializing in identifying closing arguments in trial proceedings. You will analyze transcript excerpts to identify the exact boundaries of closing statements.

## Task Template
```
Analyze the following transcript excerpt to identify closing statements/arguments.

CONTEXT:
- Trial: {{trialName}}
- Case Number: {{caseNumber}}
- Date: {{sessionDate}}
- Known Information:
  - Last witness testimony ended at line {{lastWitnessLine}}
  - Closing statements should occur after line {{lastWitnessLine}}
  - Jury instructions may follow closing statements

SEARCH CRITERIA:
1. Look for phrases like:
   - "closing argument"
   - "closing statement"
   - "summation"
   - "In conclusion"
   - "The evidence has shown"
   - "You have heard testimony"
   - "I ask you to find"
   - "render a verdict"

2. Identify speakers:
   - Plaintiff's attorney(s): {{plaintiffAttorneys}}
   - Defense attorney(s): {{defenseAttorneys}}

3. Structure indicators:
   - Judge introducing closing arguments
   - Reference to evidence already presented
   - Argument about jury instructions
   - Request for specific verdict/damages
   - Rebuttal arguments (plaintiff may have final word)

TRANSCRIPT EXCERPT:
{{transcriptExcerpt}}

TASK:
Identify the following markers with high confidence (0.0-1.0):
1. Closing Statements Period Begin (judge introduces)
2. Plaintiff Closing Statement Begin
3. Plaintiff Closing Statement End
4. Defense Closing Statement Begin
5. Defense Closing Statement End
6. Plaintiff Rebuttal Begin (if applicable)
7. Plaintiff Rebuttal End (if applicable)
8. Closing Statements Period End (transition to jury instructions)

OUTPUT FORMAT:
Return a JSON object with the following structure:
{
  "markers": [
    {
      "name": "marker name",
      "markerType": "CLOSING_BEGIN|CLOSING_END|SECTION_BEGIN|SECTION_END",
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
      "sectionType": "CLOSING_STATEMENTS_PERIOD|CLOSING_STATEMENT_PLAINTIFF|CLOSING_STATEMENT_DEFENSE",
      "startMarker": "marker name",
      "endMarker": "marker name",
      "metadata": {
        "attorney": "name",
        "includesRebuttal": true/false,
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
Last witness at line 5000
Plaintiff attorneys: MR. FABRICANT, MR. LAMBRIANAKOS
Defense attorneys: MS. JONES, MR. CHEN
```

### Expected Output Structure
```json
{
  "markers": [
    {
      "name": "Closing Statements Period Begin",
      "markerType": "SECTION_BEGIN",
      "sessionLineNumber": 5001,
      "confidence": 0.93,
      "speaker": "THE COURT",
      "contextQuote": "We will now hear closing arguments",
      "reasoning": "Judge explicitly introduces closing arguments phase"
    },
    {
      "name": "Plaintiff Closing Begin",
      "markerType": "CLOSING_BEGIN",
      "sessionLineNumber": 5010,
      "confidence": 0.91,
      "speaker": "MR. FABRICANT",
      "contextQuote": "Ladies and gentlemen, the evidence has shown",
      "reasoning": "Plaintiff's counsel begins with reference to presented evidence"
    }
  ]
}
```

## Closing Argument Structure

### Typical Order
1. **Plaintiff's Initial Closing** (30-90 minutes)
2. **Defense Closing** (30-90 minutes)  
3. **Plaintiff's Rebuttal** (15-30 minutes)

### Key Differences from Opening
- References specific evidence presented
- Argues credibility of witnesses
- Applies law to facts
- Requests specific verdict/findings
- May include damages calculations

## Confidence Guidelines

- **0.95-1.0**: Explicit mention of "closing argument" with clear structure
- **0.85-0.94**: Strong indicators with evidence summation
- **0.75-0.84**: Probable based on position and argumentative content
- **0.60-0.74**: Possible but requires validation
- **< 0.60**: Too uncertain, do not include

## Edge Cases to Consider

1. **Split Closing**: May be split across sessions/days
2. **Waived Closing**: Rare but party may waive
3. **Time Limits**: Judge may enforce strict time limits
4. **Multiple Attorneys**: May divide closing between counsel
5. **Directed Verdict**: May replace traditional closing
6. **Bench Trial**: No jury address, argument to judge only

## Validation Checks

1. Must occur after all evidence presented
2. Should reference testimony/exhibits from trial
3. Typically longer than opening statements
4. Plaintiff usually gets first and last word (rebuttal)
5. Should precede jury instructions
6. Contains argumentative language (vs. factual in openings)

## Rebuttal Detection

Look for:
- Plaintiff speaking after defense closing
- References to defense arguments
- Shorter duration than initial closing
- Phrases like "Defense counsel said" or "In response"
- Final appeal before jury instructions