# Tactical Examination Patterns for Marker Detection

## Overview
This document synthesizes tactical and strategic patterns in witness examinations to enhance marker detection accuracy. Understanding attorney motivations and decision points helps identify examination boundaries and types.

## Strategic Context by Party Role

### Plaintiff Attorneys (Calling Party for Plaintiff Witnesses)
- **Role**: Risk managers - balancing persuasive narrative against minimizing attack vectors
- **Direct Examination Goals**:
  - Tell coherent story that advances burden of proof
  - Keep scope narrow to reduce cross-examination exposure
  - Avoid leading questions (procedural requirement)
  - Strategic decision: Broader narrative vs. laser-focused technical points

### Defense Attorneys (Opposing Party for Plaintiff Witnesses)
- **Role**: Opportunists - strongest chance to weaken plaintiff's case is on cross
- **Cross-Examination Goals**:
  - Undermine witness credibility
  - Expose bias or inconsistencies
  - Use short, leading questions to control testimony
  - Strategic decision: Aggressive cross (risk jury backlash) vs. surgical cross (minimize redirect opportunities)

## Examination Patterns by Witness Type

### 1. Technical/Infringement Experts
**Most Iterative - Expect Extended Sequences**

#### Direct Examination Markers
- Lengthy setup explaining patent claims
- Use of demonstratives (source code, schematics)
- Phrases: "Can you explain to the jury...", "What is your opinion on..."
- Duration: 60-180 minutes typical

#### Cross-Examination Markers  
- Attack methodology: "You cherry-picked...", "You didn't review all..."
- Highlight gaps and suggest bias
- Surgical cross usually preferred (jurors dislike over-complexity)
- Duration: 45-120 minutes typical

#### Redirect/Recross Frequency
- **High** - Technical clarification often needed
- Multiple cycles common (Direct→Cross→Redirect→Recross→Re-redirect)
- Judge tolerance higher for complex technical matters

### 2. Damages Experts
**Cross is Centerpiece - Redirect Critical**

#### Direct Examination Markers
- Foundation for royalty calculations
- Georgia-Pacific factors discussion
- Walk through economic models
- Duration: 45-90 minutes typical

#### Cross-Examination Markers
- Attack assumptions: "You assumed X% - why?"
- Undercut comparables: "Those licenses weren't litigated..."
- Show exaggeration: "More than defendant's annual profits..."
- Aggressive cross more common (money gets jury attention)
- Duration: 60-90 minutes typical

#### Redirect/Recross Frequency
- **Moderate to High** - Redirect can salvage credibility but risks recross
- Jurors dislike extended "math fights"

### 3. Fact Witnesses (Inventors/Engineers)
**Usually Limited Cycles**

#### Direct Examination Markers
- Humanizing narrative (origin story)
- Simple language, avoid over-technicalization
- Duration: 30-60 minutes typical

#### Cross-Examination Markers
- Attack memory: "This was 15 years ago..."
- Light, respectful tone often preferred
- Duration: 20-45 minutes typical

#### Redirect/Recross Frequency
- **Low** - Usually ends after cross or single redirect
- Extended cycles rare and often counterproductive

### 4. Industry/Market Experts
**Similar to Damages but Shorter**

#### Pattern Recognition
- Jurors fatigue faster with market data
- Cross focuses on data relevance and expertise
- Redirect used sparingly
- Total examination time typically < 2 hours

## Detection Patterns for LLM/Parser

### Strategic Decision Points (Helps Identify Transitions)

#### When Redirect is Likely
- Cross-examination lasted > 45 minutes
- Technical expert testimony involved
- Audible jury reaction during cross
- Phrases: "Just to clarify...", "You were asked about...", "Let me follow up..."

#### When Redirect is Skipped
- Cross was brief (< 20 minutes)
- Fact witness (not expert)
- Defense cross was weak/ineffective
- Time pressure (end of day/week)

#### When Recross is Likely
- Redirect introduced new explanations
- Technical clarifications were attempted
- Redirect lasted > 15 minutes
- Phrases: "You just said...", "But earlier you testified..."

#### When Extended Cycles Occur
- Complex IP/technical testimony
- Source code or damages models disputed
- Judge explicitly allows continuation
- Both sides have significant time remaining

## Tactical Phrases by Examination Type

### Direct Examination Start Indicators
- "Please state your name for the record"
- "What is your educational background?"
- "Are you familiar with the patents at issue?"
- "What did you do to prepare for your testimony?"

### Cross-Examination Start Indicators
- "Good [morning/afternoon], Mr./Ms. [Name]"
- "You work for the plaintiff, correct?"
- "You're being paid for your testimony?"
- "Isn't it true that..."

### Redirect Start Indicators
- "Just a few follow-up questions"
- "Counsel asked you about..."
- "Let me direct your attention back to..."
- "Can you explain what you meant when..."

### Recross Start Indicators
- "Very briefly, Your Honor"
- "You just testified that..."
- "But you would agree..."
- "One final point..."

## Time Allocation Patterns (E.D. Texas)

### Typical Time Splits
- Total trial time often split 50/50 between parties
- Direct examination: 40-50% of party's witness time
- Cross examination: 30-40% of opposing party's time
- Redirect: 5-10% of original direct time
- Recross: 3-5% of redirect time

### Strategic Time Management
- Parties may "bank" time by shortened examinations
- Extended redirect/recross depletes time budget
- Judges enforce time limits strictly
- Final witnesses often rushed due to time pressure

## Pattern Recognition for Automated Detection

### High Confidence Markers (>90% accuracy)
1. Explicit announcements: "We call [Name] to the stand"
2. Court reporter labels: "DIRECT EXAMINATION BY MR. SMITH"
3. Judge instructions: "You may cross-examine"
4. Witness dismissal: "The witness is excused"

### Medium Confidence Markers (70-90% accuracy)
1. Attorney name changes in transcript
2. Question style shifts (open-ended → leading)
3. Time gaps suggesting examination change
4. "No further questions" followed by new attorney

### Low Confidence/Manual Review Required (<70% accuracy)
1. Multiple attorneys for same party alternating
2. Interrupted examinations (objections, sidebars)
3. Recalled witnesses (new sequence starts)
4. Technical difficulties causing breaks

## Edge Cases Requiring Special Handling

### Voir Dire During Testimony
- Mini-examination about evidence admissibility
- Occurs outside main sequence
- Mark separately from main examination flow
- Usually brief (5-10 minutes)

### Judge Questioning
- Can occur at any point
- Not part of formal examination sequence
- Mark as separate event type
- Usually brief but can extend in complex matters

### Multiple Attorney Examinations
- Common in large trial teams
- Each attorney may handle specific topics
- Maintain same examination type despite attorney change
- Track primary examiner for each examination phase

## Validation Metrics

### Expected Patterns by Trial Phase
- **Early Trial**: More fact witnesses, shorter examinations
- **Mid Trial**: Expert witnesses, extended sequences common
- **Late Trial**: Cleanup witnesses, time pressure affects length

### Warning Signs of Misclassification
- Direct examination < 10 minutes (too short)
- Cross examination > 3x direct (unusual ratio)
- More than 3 redirect/recross cycles (very rare)
- Total witness examination > 6 hours (extremely long)

## Implementation Notes for Feature 07C

1. **Witness Type Classification**: First identify witness type to set expectations
2. **Party Role Tracking**: Know who called witness to predict sequence
3. **Time Budget Monitoring**: Track remaining time to predict examination decisions
4. **Strategic Context**: Use tactical understanding to resolve ambiguous boundaries
5. **Confidence Scoring**: Weight detection confidence by pattern type and context

This tactical understanding should be incorporated into:
- LLM prompts for examination detection
- Parser rules for automated marking
- Validation logic for marker sequences
- User guidance for manual override