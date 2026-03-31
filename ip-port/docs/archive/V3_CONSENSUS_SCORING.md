# V3 Consensus Scoring Design

## Overview

V3 extends V2's single-user scoring to multi-role consensus scoring. Multiple stakeholders (roles) each have their own scoring preferences (V2 presets), and V3 combines them into a weighted consensus.

## Core Concepts

### Roles/Profiles
Different stakeholder perspectives, each representing a different way of valuing patents.

| Role                 | Default V2 Preset  | Default Weight |
|----------------------|-------------------|----------------|
| Executive            | Default Balanced  | 25%            |
| Defensive Counsel    | Defensive         | 20%            |
| Balanced Strategist  | Default Balanced  | 20%            |
| Licensing Focus      | Licensing Focus   | 15%            |
| Aggressive Litigator | Litigation Focus  | 10%            |
| Quick Wins           | Quick Wins        | 10%            |

### Role Configuration
- **V2 Preset**: Which scoring weights this role uses (selected from V2 presets - built-in or custom)
- **Consensus Weight**: How much this role's opinion counts in the overall consensus (e.g., 30%)

### Views
| View | Shows | Rank Deltas Based On |
|------|-------|---------------------|
| Consensus (default) | Combined weighted scores | Changes to any role's preset or weight |
| Individual (toggle) | Single role's perspective | Changes to that role's preset |

## Consensus Calculation

```
consensus_score = Σ (role_weight × role_score) / Σ role_weights
```

Where `role_score` = V2 scoring formula using that role's preset weights

## V3 Preset Structure

A V3 preset captures the complete multi-role configuration:

```typescript
interface V3ConsensusRole {
  roleId: string;           // e.g., 'executive', 'litigation', 'licensing'
  roleName: string;         // Display name
  v2PresetId: string;       // Which V2 preset they're using
  consensusWeight: number;  // 0-100, their weight in consensus
}

interface V3ConsensusPreset {
  id: string;
  name: string;
  description: string;
  isBuiltIn: boolean;
  roles: V3ConsensusRole[];
}
```

## Built-in V3 Presets

### 1. Balanced Team (Default)
Uses the default role weights above - balances all perspectives.

### 2. Executive-Led
- Executive: 40%
- Defensive Counsel: 15%
- Balanced Strategist: 15%
- Licensing Focus: 15%
- Aggressive Litigator: 10%
- Quick Wins: 5%

### 3. Litigation Ready
- Executive: 15%
- Defensive Counsel: 15%
- Balanced Strategist: 15%
- Licensing Focus: 10%
- Aggressive Litigator: 25%
- Quick Wins: 20%

### 4. Licensing Campaign
- Executive: 15%
- Defensive Counsel: 15%
- Balanced Strategist: 15%
- Licensing Focus: 30%
- Aggressive Litigator: 10%
- Quick Wins: 15%

## UI Layout

```
+------------------------------------------+----------------------------------+
| ROLE CONFIGURATION                       |        RANKINGS TABLE            |
+------------------------------------------+                                  |
| View: [Consensus v] / [Individual: ___]  | Rank | +/- | Patent | Score ... |
|                                          |                                  |
| +--------------------------------------+ |                                  |
| | Role              | V2 Preset  | Wt% | |                                  |
| |-------------------|------------|-----| |                                  |
| | Executive         | [Balanced v] | 25 | |                                  |
| | Defensive Counsel | [Defensive v]| 20 | |                                  |
| | Balanced Strat.   | [Balanced v] | 20 | |                                  |
| | Licensing Focus   | [Licensing v]| 15 | |                                  |
| | Aggr. Litigator   | [Litigation]| 10 | |                                  |
| | Quick Wins        | [QuickWins v]| 10 | |                                  |
| +--------------------------------------+ |                                  |
|                                          |                                  |
| Total: 100%  [Normalize]                 |                                  |
|                                          |                                  |
| [Recalculate]  *unsaved*                 |                                  |
|                                          |                                  |
| V3 Presets: [Balanced Team v] [Save As]  |                                  |
| Snapshots: [___v] [ ] Compare            |                                  |
+------------------------------------------+----------------------------------+
```

## UI Elements

1. **Role Table**: Shows all 6 roles with:
   - V2 preset dropdown (built-in + custom presets)
   - Weight input (0-100)

2. **Weight Display**: Shows total with [Normalize] button to auto-adjust to 100%

3. **Top N + Complete Data Filter**: Carried over from V2

4. **Patent Detail Tooltip**: Same as V2 - hover shows metrics breakdown

5. **V3 Preset Management**:
   - Built-in presets (4)
   - Custom presets (save/load from localStorage)

6. **Snapshots + CSV Export**: Same as V2

## Features Removed

- Sector filter (was buggy in previous implementation)

## Features Deferred

- Add/delete custom roles (future enhancement)

## Implementation Notes

1. V3 page reuses V2's scoring infrastructure on the backend
2. For consensus view: call V2 scoring API once per role, then combine client-side
3. For individual view: call V2 scoring API for selected role only
4. Rank deltas tracked between recalculations
5. Snapshots store full consensus config + rankings
