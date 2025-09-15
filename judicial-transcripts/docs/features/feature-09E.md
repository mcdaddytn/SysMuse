# Feature-09E: LLM Summary GUI Integration

## Overview
Integrate LLM-generated summaries into the GUI with minimal disruption to existing functionality. This feature adds LLMSummary1 as a selectable summary type with fallback behavior and settings management capabilities.

## Background
Building on Feature-09D (Background LLM Summary Processing), this feature exposes the generated summaries through the GUI and provides mockups for future configuration capabilities.

## Requirements

### Core Functionality

#### 1. LLMSummary1 Integration
- Add "LLMSummary1" to the summary dropdown alongside existing options ("FullText", "Abridged1", "Abridged2")
- Display LLM-generated summaries when available
- Show configured fallback summary (e.g., Abridged1) when LLM summary is not available
- Include "Request Generation" link/button for missing summaries

#### 2. Settings Panel Extensions

##### LLM Context File Viewer
- Display LLM context files for LLMSummary1
- Show actual JSON configuration and prompts
- Present as editable (mockup only - read-only for now)
- Located in Settings → LLM Summaries tab

##### Accumulator Editors
- Display JSON data for objections accumulator
- Display JSON data for interactions accumulator
- Present as editable interface (mockup only)
- Located in Settings → Accumulators tab

##### Summary Profile Management
- UI to copy existing LLM summary profile
- Create new summary types (e.g., LLMSummary2)
- Configure output directories
- Edit context templates (mockup only)
- Located in Settings → LLM Summaries → New Profile

### Implementation Phases

#### Phase 1: Current Deliverable (Mockups)
- LLMSummary1 in dropdown with fallback display
- Read-only display of context files in settings
- Read-only display of accumulator JSON
- Non-functional "Copy Profile" UI
- "Request Generation" link shows "Feature not yet implemented" message

#### Phase 2: Future Development
- Functional editing of context files
- Functional accumulator configuration
- Working profile copying and creation
- Background generation triggered from GUI
- Real-time summary generation status

## Technical Implementation

### Data Flow
```
GUI Request → Check LLMSummary1 existence
  ├─ Exists: Display LLM summary
  └─ Missing: Display fallback + generation link
```

### File Structure
```
output/
├── LLMSummary1/          # Existing LLM summaries
│   ├── opening-statement-plaintiff-*.json
│   ├── opening-statement-defendant-*.json
│   └── ...
├── LLMSummary2/          # Future: Copied profile output
└── accumulators/
    ├── objections.json
    └── interactions.json
```

### Configuration
```json
{
  "llmSummaries": {
    "LLMSummary1": {
      "enabled": true,
      "fallbackSummary": "Abridged1",
      "contextPath": "config/llm-contexts/summary1/",
      "outputPath": "output/LLMSummary1/",
      "modelConfig": {
        "model": "gpt-4o-mini",
        "temperature": 0.3
      }
    }
  }
}
```

## User Interface

### Summary Dropdown
```
Summary Type: [▼ LLMSummary1    ]
              ├─ FullText
              ├─ Abridged1
              ├─ Abridged2
              └─ LLMSummary1 ← New option
```

### Missing Summary Display
```
┌─────────────────────────────────────┐
│ LLM Summary Not Available           │
│                                     │
│ [Showing Abridged1 as fallback]    │
│                                     │
│ [📝 Request LLM Generation]         │
│                                     │
│ [Fallback Content...]               │
└─────────────────────────────────────┘
```

### Settings Panel
```
Settings
├─ General
├─ LLM Summaries
│  ├─ LLMSummary1 Context Files
│  ├─ New Profile
│  └─ Model Configuration
├─ Accumulators
│  ├─ Objections
│  └─ Interactions
└─ Export
```

## Acceptance Criteria

### Phase 1 (Current)
- [ ] LLMSummary1 appears in summary dropdown
- [ ] Existing LLM summaries display correctly
- [ ] Missing summaries show fallback with generation link
- [ ] Settings show read-only context files
- [ ] Settings show read-only accumulator data
- [ ] Copy profile UI is visible but non-functional
- [ ] No breaking changes to existing functionality

### Phase 2 (Future)
- [ ] Context files can be edited and saved
- [ ] Accumulators can be configured
- [ ] New profiles can be created
- [ ] Generation can be triggered from GUI
- [ ] Status updates during generation

## Testing

### Manual Testing
1. Select LLMSummary1 from dropdown
2. Verify existing summaries display
3. Verify fallback displays for missing summaries
4. Click "Request Generation" - verify message
5. Open Settings → LLM Summaries
6. Verify context files display
7. Open Settings → Accumulators
8. Verify JSON data displays

### Test Cases
- Opening statements (should have LLM summaries)
- Witness testimony (should show fallback)
- Settings navigation
- Summary switching performance

## Dependencies
- Feature-09D (Background LLM processing)
- Existing GUI framework (React/Electron)
- Summary display components
- Settings panel infrastructure

## Notes
- Maintain backward compatibility with existing summary types
- Preserve existing GUI performance
- Minimal code changes to core GUI components
- Focus on demonstration capability for Phase 1