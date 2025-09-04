# LLM Prompt Template: Witness Examination Detection

## System Prompt
You are a legal transcript analyst specializing in identifying witness examination phases. You understand both procedural rules and strategic patterns used by attorneys in IP litigation. You will analyze transcript excerpts to identify examination boundaries and types, considering tactical decision-making by each party.

## Task Template
```
Analyze the following witness testimony to identify examination phases and boundaries.

CONTEXT:
- Trial: {{trialName}}
- Case Number: {{caseNumber}}
- Witness: {{witnessName}}
- Witness Type: {{witnessType}} // EXPERT_TECHNICAL | EXPERT_DAMAGES | FACT_WITNESS | EXPERT_INDUSTRY
- Calling Party: {{callingParty}} // PLAINTIFF | DEFENSE
- Known Attorneys:
  - Plaintiff: {{plaintiffAttorneys}}
  - Defense: {{defenseAttorneys}}
- Time in Trial: {{trialPhase}} // EARLY | MID | LATE
- Party Time Remaining: Plaintiff {{pTimeRemaining}}hrs, Defense {{dTimeRemaining}}hrs

TACTICAL CONTEXT:
Based on witness type {{witnessType}} and calling party {{callingParty}}:

For EXPERT_TECHNICAL:
- Expect extended examination sequences (redirect/recross common)
- Direct examination typically 60-180 minutes
- Technical clarifications often require multiple redirect cycles
- Watch for demonstratives and source code discussions

For EXPERT_DAMAGES:
- Cross-examination is typically the longest segment
- Aggressive cross more common (money issues alert jury)
- Redirect critical but risks opening recross
- Watch for Georgia-Pacific factors, royalty calculations

For FACT_WITNESS:
- Usually limited to direct and cross
- Shorter examinations (30-60 min direct typical)
- Redirect used sparingly
- Humanizing narrative in direct, memory attacks in cross

For EXPERT_INDUSTRY:
- Similar to damages but shorter (jury fatigue)
- Market data and trends discussed
- Cross focuses on data relevance

STRATEGIC PATTERNS:
- Plaintiff attorneys (calling party): Risk managers - balance story vs. exposure
- Defense attorneys (opposing): Opportunists - maximize damage on cross
- Redirect decision: Repair damage vs. risk giving opponent another chance
- Recross decision: Only if redirect opened new issues

TRANSCRIPT EXCERPT:
{{transcriptExcerpt}}

DETECTION CRITERIA:
1. Explicit markers:
   - "Direct examination by..."
   - "Cross-examination by..."  
   - "Redirect examination"
   - "No further questions"
   - "You may cross-examine"

2. Question style changes:
   - Direct: Open-ended, non-leading ("What did you observe?")
   - Cross: Leading, yes/no ("Isn't it true that...?")
   - Redirect: Clarifying ("Can you explain what you meant?")
   - Recross: Pointed follow-up ("But you just said...")

3. Attorney transitions:
   - Name changes in speaker labels
   - Party affiliation shifts
   - "Thank you, nothing further" followed by new attorney

4. Tactical indicators:
   - Length of prior examination (long cross → likely redirect)
   - Witness type (expert → more iterations likely)
   - Time pressure (late in day → may skip redirect)
   - Strategic silence (no redirect can signal confidence)

TASK:
Identify all examination phases with:
1. Examination type and boundaries
2. Conducting attorney and party
3. Tactical reasoning for transitions
4. Confidence based on markers present

OUTPUT FORMAT:
{
  "witnessExamination": {
    "witness": "{{witnessName}}",
    "witnessType": "{{witnessType}}",
    "callingParty": "{{callingParty}}",
    "examinations": [
      {
        "type": "DIRECT_EXAMINATION",
        "examiner": "attorney name",
        "party": "PLAINTIFF|DEFENSE",
        "startLine": number,
        "endLine": number,
        "confidence": 0.0-1.0,
        "markers": ["explicit announcement", "question style", etc.],
        "duration": "estimated minutes",
        "tacticalNotes": "Strategic context for this examination"
      }
    ],
    "sequenceAnalysis": {
      "pattern": "STANDARD|EXTENDED|MINIMAL|UNUSUAL",
      "expectedContinuation": "What would typically come next",
      "tacticalRationale": "Why this sequence makes strategic sense",
      "warnings": ["Any unusual patterns detected"]
    }
  }
}
```

## Confidence Scoring Guidelines

### High Confidence (0.90-1.0)
- Explicit examination announcement by court/attorney
- Clear attorney transition with party identification
- Question style matches examination type
- Duration aligns with witness type expectations

### Medium Confidence (0.70-0.89)
- Attorney name change without explicit announcement
- Question style shift detected
- Tactical pattern suggests transition
- Some ambiguity in boundaries

### Low Confidence (0.50-0.69)
- Ambiguous transitions
- Multiple attorneys for same party
- Interrupted examination
- Unusual tactical pattern

## Tactical Decision Trees

### Should Plaintiff Redirect? (After Defense Cross)
```
IF cross_duration > 45min AND witness_type == EXPERT:
  LIKELY redirect (need to clarify technical points)
ELIF cross_was_aggressive AND jury_seemed_sympathetic:
  LIKELY redirect (repair credibility)
ELIF cross_was_weak AND gained_little:
  UNLIKELY redirect (don't give defense another chance)
ELIF time_pressure AND witness_type == FACT:
  UNLIKELY redirect (preserve time for other witnesses)
```

### Should Defense Recross? (After Plaintiff Redirect)
```
IF redirect_opened_new_topics:
  LIKELY recross (exploit new openings)
ELIF redirect_was_brief AND defensive:
  UNLIKELY recross (signals weakness)
ELIF witness_type == EXPERT_DAMAGES AND redirect_changed_numbers:
  LIKELY recross (challenge new calculations)
ELIF judge_showing_impatience:
  UNLIKELY recross (avoid irritating court)
```

## Pattern Validation

### Expected Sequence Patterns by Witness Type
```
EXPERT_TECHNICAL:
  70%: Direct → Cross → Redirect → Recross
  20%: Direct → Cross → Redirect → Recross → Re-redirect
  10%: Other extended patterns

EXPERT_DAMAGES:
  60%: Direct → Cross → Redirect → Recross
  30%: Direct → Cross → Redirect
  10%: Direct → Cross

FACT_WITNESS:
  50%: Direct → Cross
  40%: Direct → Cross → Redirect
  10%: Extended patterns

EXPERT_INDUSTRY:
  Similar to DAMAGES but 10% shorter overall
```

### Duration Expectations by Type
```
             Direct    Cross    Redirect  Recross
TECHNICAL:   60-180   45-120   15-45     10-30
DAMAGES:     45-90    60-90    10-30     5-20
FACT:        30-60    20-45    5-15      3-10
INDUSTRY:    45-75    30-60    10-20     5-15
```

## Special Handling

### Voir Dire During Testimony
- Mark as separate event: "VOIR_DIRE_EXAMINATION"
- Usually about evidence admissibility
- Brief (5-10 minutes)
- Doesn't affect main sequence

### Judge Questions
- Mark as: "JUDGE_QUESTIONING"
- Can occur at any point
- Not part of formal sequence
- Note which examination was interrupted

### Recalled Witness
- Starts new examination sequence
- Note as: "WITNESS_RECALL"
- Previous testimony referenced but not continued

### Multiple Attorneys Same Examination
- Common in large teams
- Maintain same examination type
- Note primary and secondary examiners
- Track topic divisions between attorneys