# Phase 3 Implementation: Marker Discovery and Accumulator Processing

## Overview
Phase 3 introduces marker discovery and accumulator-based activity detection to the Judicial Transcripts system. This phase processes trial events from Phase 2 to identify and mark significant periods within transcripts.

## Key Components

### 1. Schema Updates
- **Marker**: Individual timestamp markers for events
- **MarkerSection**: Paired markers defining transcript periods
- **MarkerTemplate**: Pattern-based naming for markers
- **ElasticSearchExpression**: Predefined search patterns
- **AccumulatorExpression**: Complex pattern detection logic
- **AccumulatorResult**: Results from accumulator evaluations

### 2. Core Classes

#### AccumulatorEngine (`src/phase3/AccumulatorEngine.ts`)
- Evaluates ElasticSearch expressions against statements
- Processes accumulator expressions using sliding windows
- Combines scores using various strategies (ADD, MULTIPLY, OR, AND)
- Generates confidence levels and boolean results

#### WitnessMarkerDiscovery (`src/phase3/WitnessMarkerDiscovery.ts`)
- Discovers witness examination boundaries
- Creates markers for examination start/end
- Groups examinations into complete witness testimony
- Handles continued examinations across sessions

#### ActivityMarkerDiscovery (`src/phase3/ActivityMarkerDiscovery.ts`)
- Uses accumulator results to identify activity clusters
- Creates activity markers for objections, sidebars, interactions
- Merges overlapping activities of the same type
- Cleans up orphaned markers

#### MarkerUpsert (`src/phase3/MarkerUpsert.ts`)
- Import/export markers to/from JSON
- Flexible event reference matching
- Manual marker correction support

### 3. Data Processing Flow

1. **ElasticSearch Expression Evaluation**
   - Load expressions from seed data
   - Evaluate against all statements
   - Store results for accumulator use

2. **Accumulator Processing**
   - Slide windows through statement events
   - Evaluate conditions within windows
   - Generate activity indicators

3. **Witness Marker Discovery**
   - Process WitnessCalledEvent records
   - Find examination boundaries
   - Create testimony markers

4. **Activity Marker Discovery**
   - Process accumulator results
   - Create activity markers
   - Merge overlapping activities

## Usage

### Running Phase 3

```bash
# Generate Prisma client after schema changes
npx prisma generate

# Apply schema changes to database
npx prisma db push

# Seed Phase 3 data
npm run seed

# Run Phase 3 for all trials
npm run phase3 process

# Run Phase 3 for specific trial
npm run phase3 process --trial 1

# Clean and reprocess
npm run phase3 process --trial 1 --clean
```

### CLI Commands

```bash
# Process markers
npm run phase3 process [options]
  -t, --trial <id>    Process specific trial by ID
  -c, --case <number> Process by case number
  --clean             Clean existing markers first

# Export markers
npm run phase3 export -t <trial-id> [-o output.json]

# Import/upsert markers
npm run phase3 import -t <trial-id> -i input.json

# View statistics
npm run phase3 stats [-t trial-id]
```

## Seed Data Files

### elasticsearch-expressions.json
Generated from CSV containing courtroom phrases and search strategies:
- Objection handling patterns
- Witness handling phrases
- Phase transition markers
- Judicial directions

### marker-templates.json
Templates for generating marker names:
- Witness testimony patterns
- Examination patterns
- Activity patterns

### accumulator-expressions.json
Complex pattern detection configurations:
- Judge-attorney interactions
- Opposing counsel interactions
- Objection patterns (sustained/overruled)
- Sidebar requests

## Accumulator Configuration

### Expression Types
- **BOOLEAN**: Returns true/false based on threshold
- **CONFIDENCE**: Returns confidence level (HIGH, MEDIUM, LOW, NONE)
- **FLOAT**: Returns numeric score

### Combination Types
- **ADD**: Sum all component scores
- **MULTIPLY**: Product of component scores
- **OR**: Maximum score (any match)
- **AND**: Minimum score (all must match)

### Window Configuration
- `windowSize`: Number of statements to evaluate together
- `thresholdValue`: Numeric threshold for boolean conversion
- `minConfidenceLevel`: Minimum confidence for true result

## Manual Marker Correction

Export markers for manual editing:
```bash
npm run phase3 export -t 1 -o markers.json
```

Edit the JSON file to:
- Adjust event references
- Modify marker positions
- Add/remove markers
- Update metadata

Import corrected markers:
```bash
npm run phase3 import -t 1 -i markers-corrected.json
```

## Marker Types

### Witness Markers
- `WITNESS_TESTIMONY_START/END`: Complete witness testimony
- `WITNESS_EXAMINATION_START/END`: Individual examination segments

### Activity Markers
- `ACTIVITY_START/END`: Activity cluster boundaries

## Marker Section Types
- `WITNESS_TESTIMONY`: Complete witness testimony
- `WITNESS_EXAMINATION`: Single examination type
- `COMPLETE_WITNESS_TESTIMONY`: All witness testimony in trial
- `ACTIVITY`: Activity clusters (objections, sidebars, etc.)

## Integration with Other Phases

### Prerequisites
- Phase 1: Trial data must be parsed and loaded
- Phase 2: Events must be processed and classified

### Downstream Usage
- Markers enable targeted transcript export
- MarkerSections support ElasticSearch indexing
- Activity markers inform synopsis generation

## Performance Considerations

- ElasticSearch expression evaluation is cached per statement
- Accumulator windows slide incrementally
- Overlapping activities are merged to reduce redundancy
- Orphaned markers are cleaned up automatically

## Troubleshooting

### No markers generated
1. Verify Phase 2 has completed successfully
2. Check seed data is loaded
3. Ensure ElasticSearch expressions evaluated

### Incorrect boundaries
1. Export markers and review event references
2. Adjust witness examination end detection logic
3. Modify accumulator window sizes

### Missing activities
1. Review accumulator thresholds
2. Check ElasticSearch expression patterns
3. Adjust confidence level requirements