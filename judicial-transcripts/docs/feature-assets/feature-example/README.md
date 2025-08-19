# Feature-Example Assets

## Overview
Example assets structure for demonstration purposes. This shows how to organize feature-related files.

## File Inventory

### Code (`code/`)
- `example-parser.ts` - Sample parser implementation showing IParser interface usage
- `query-example.sql` - SQL query for data extraction

### Data (`data/`)
- `attorneys-sample.csv` - Sample attorney list (10 records)
  - Format: name, bar_number, firm, role
  - Needs conversion to JSON seed format

### Seed (`seed/`)
- `attorneys.json` - Converted attorney seed data
  - Generated from `data/attorneys-sample.csv`
  - Ready for database seeding

### Samples (`samples/`)
- `witness-examination.txt` - Sample transcript excerpt showing witness Q&A format
- `court-directive.txt` - Example of court directives in transcript

## Conversion Process

### CSV to JSON Conversion
```bash
# Convert attorneys CSV to JSON seed data
npm run convert:csv -- \
  --input docs/feature-assets/feature-example/data/attorneys-sample.csv \
  --output docs/feature-assets/feature-example/seed/attorneys.json \
  --schema attorney
```

## Usage in Feature Spec

Reference these assets in your feature specification:
```markdown
## Implementation Assets
- Parser example: [`feature-assets/feature-example/code/example-parser.ts`](../feature-assets/feature-example/code/example-parser.ts)
- Attorney data: [`feature-assets/feature-example/seed/attorneys.json`](../feature-assets/feature-example/seed/attorneys.json)
```

## Dependencies
- No external dependencies
- Uses standard IParser interface
- Compatible with Prisma schema v2.x