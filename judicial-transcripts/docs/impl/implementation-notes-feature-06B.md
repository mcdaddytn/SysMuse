# Feature 06B Implementation Notes

## Completed Successfully
1. **Schema Changes**: Added `rawText` field to `TrialEvent` entity (VARCHAR 255) to store truncated text
2. **MTI Pattern**: Moved `rawText` from child entities (WitnessCalledEvent, CourtDirectiveEvent) to parent TrialEvent
3. **Hierarchical Query Support**: TrialEventHierarchy query properly returns nested trial→sessions→events structure
4. **Template Engine Fix**: Fixed MustacheTemplateEngine to preserve section tags while still disabling HTML escaping for variables
5. **Judge Statements Query**: Successfully filters to show judge statements with 3 surrounding events before/after

## Current Output
- Query produces ~13,875 lines of transcript excerpts
- Shows 836 judge statements out of 11,980 total events
- With surroundingEvents=3, includes ~4,251 total events (judge + context)
- All rawText fields properly truncated to 255 chars
- Preserves quotes and special characters without HTML escaping

## Current Limitations

### 1. Text Search in Hierarchical Queries
**Problem**: The TrialEventHierarchy query doesn't support text search or ElasticSearch integration
- Cannot filter for specific text patterns (e.g., "objection", "sustained", "overruled")
- The objections-rulings-hierarchy query returns ALL 11,980 events instead of just relevant ones
- No way to combine hierarchical structure with text search capabilities

**Workaround**: Currently must return all events and filter client-side, or use flat queries

### 2. ElasticSearch Integration
**Current State**: 
- ElasticSearch ONLY works with StatementEvent queries (flat structure)
- When using `templateQuery: "StatementEvent"`, ElasticSearch filtering via `elasticSearchQueries` parameter works
- When using `templateQuery: "TrialEventHierarchy"`, ElasticSearch is bypassed entirely

**Impact**: Cannot get hierarchical output (sessions→events) with ElasticSearch filtering

## Future Improvements Needed

### 1. DateTime Handling
**Problem**: Sessions have dates (DateTime), but TrialEvents only have time strings (e.g., "09:15:45")
**Solution**: During parsing, construct full DateTime for TrialEvents by combining:
- Session date (from context)
- Event time string
- Store as proper DateTime in database

**Benefits**:
- Enable proper date/time range filtering
- Support queries like "events between Oct 1 2:30pm and Oct 7 6:00pm"
- Better chronological ordering across sessions

### 2. ElasticSearch Integration with Hierarchical Queries
**Design Needed**:
1. First run ElasticSearch to get matching statement IDs
2. Use those IDs to filter TrialEvents (via statement relation)
3. Apply surrounding events logic
4. Build hierarchical structure
5. Return as nested trial→sessions→events

**Alternative Approach**:
- Add a `textSearch` parameter to TrialEventHierarchy query
- Use SQL LIKE or full-text search on rawText field
- Less powerful than ElasticSearch but simpler to implement

### 3. Surrounding Events Overlap Detection
**Problem**: When multiple judge statements are close together, their surrounding contexts overlap, causing duplicate events in output
**Solution**: 
- Track which events have already been included
- Merge overlapping ranges
- Or mark events as "context" vs "primary" to allow filtering

### 3. Template Improvements
Consider adding:
- Better date formatting in templates
- Options to show/hide context events
- Ability to highlight judge statements vs context
- Summary statistics (e.g., "Showing 836 judge statements with context")

### 4. Performance Optimization
For large trials:
- Consider pagination of results
- Add indexing on speakerHandle for faster filtering
- Cache frequently used hierarchical queries

## Query Examples

### Judge Statements with Context
```json
{
  "templateQuery": "TrialEventHierarchy",
  "queryParams": {
    "caseNumber": "2:19-CV-00123-JRG",
    "speakerHandle": "JUDGE_1",
    "surroundingEvents": 3
  }
}
```

### All Events (No Filter)
```json
{
  "templateQuery": "TrialEventHierarchy",
  "queryParams": {
    "caseNumber": "2:19-CV-00123-JRG"
  }
}
```

## Template Pattern for Hierarchical Data
```mustache
{{#sessions}}
  {{#events}}
    {{eventType}}: {{rawText}}
  {{/events}}
{{/sessions}}
```

Note: Section tags (`{{#...}}`, `{{/...}}`) must remain as double braces for Mustache iteration.
Variable interpolations use triple braces (`{{{...}}}`) to prevent HTML escaping.