# Packet Trial Parsing Workarounds

## Issue Description
The Packet Netscout trial (Trial ID 50) uses a unique file naming convention that doesn't include dates:
- Pattern: `US_DIS_TXED_2_16cv230_d74990699e[NUMBER]_NOTICE_OF_FILING_OF_OFFICIAL_TRANSCRIPT_of_Proceed.txt`
- The document IDs (16592, 16620, 16686, 16714, 16742, 16799) indicate sequence but not dates

## Actual Session Dates and Types
Based on manual inspection of transcript content:

| Document ID | Session Date | Session Type |
|------------|--------------|--------------|
| 16592      | 10/10/2017   | AM           |
| 16620      | 10/10/2017   | PM           |
| 16686      | 10/11/2017   | PM           |
| 16714      | 10/12/2017   | AM           |
| 16742      | 10/12/2017   | PM           |
| 16799      | 10/13/2017   | AM           |

## Workaround Options

### Option 1: Manual File Renaming (Simplest)
Rename the files to include dates before processing:
```bash
# Example renaming pattern
US_DIS_TXED_2_16cv230_d74990699e16592_NOTICE_OF_FILING_OF_OFFICIAL_TRANSCRIPT_of_Proceed.txt
→ Packet_October 10, 2017 AM.txt
```

### Option 2: Override via trialstyle.json
Add an `overrides` section to the trialstyle.json file:

```json
{
  "fileConvention": "DOCID",
  "orderedFiles": [...],
  "overrides": {
    "sessions": [
      {
        "fileName": "US_DIS_TXED_2_16cv230_d74990699e16592_NOTICE_OF_FILING_OF_OFFICIAL_TRANSCRIPT_of_Proceed.txt",
        "sessionDate": "2017-10-10",
        "sessionType": "MORNING"
      },
      {
        "fileName": "US_DIS_TXED_2_16cv230_d74990699e16620_NOTICE_OF_FILING_OF_OFFICIAL_TRANSCRIPT_of_Proceed.txt",
        "sessionDate": "2017-10-10",
        "sessionType": "AFTERNOON"
      },
      {
        "fileName": "US_DIS_TXED_2_16cv230_d74990699e16686_NOTICE_OF_FILING_OF_OFFICIAL_TRANSCRIPT_of_Proceed.txt",
        "sessionDate": "2017-10-11",
        "sessionType": "AFTERNOON"
      },
      {
        "fileName": "US_DIS_TXED_2_16cv230_d74990699e16714_NOTICE_OF_FILING_OF_OFFICIAL_TRANSCRIPT_of_Proceed.txt",
        "sessionDate": "2017-10-12",
        "sessionType": "MORNING"
      },
      {
        "fileName": "US_DIS_TXED_2_16cv230_d74990699e16742_NOTICE_OF_FILING_OF_OFFICIAL_TRANSCRIPT_of_Proceed.txt",
        "sessionDate": "2017-10-12",
        "sessionType": "AFTERNOON"
      },
      {
        "fileName": "US_DIS_TXED_2_16cv230_d74990699e16799_NOTICE_OF_FILING_OF_OFFICIAL_TRANSCRIPT_of_Proceed.txt",
        "sessionDate": "2017-10-13",
        "sessionType": "MORNING"
      }
    ]
  }
}
```

### Option 3: Enhanced Date Extraction from Content
The parser attempts to extract dates from transcript content when filename extraction fails.
Current patterns searched:
1. Trial header date (e.g., "OCTOBER 13, 2017")
2. Document filing date from headers
3. Date references in proceedings section

### Option 4: Document ID to Date Mapping
Since this is the only trial with this convention among 60+ trials, maintain a simple mapping:
```javascript
const packetDateMap = {
  '16592': { date: '2017-10-10', type: 'MORNING' },
  '16620': { date: '2017-10-10', type: 'AFTERNOON' },
  '16686': { date: '2017-10-11', type: 'AFTERNOON' },
  '16714': { date: '2017-10-12', type: 'MORNING' },
  '16742': { date: '2017-10-12', type: 'AFTERNOON' },
  '16799': { date: '2017-10-13', type: 'MORNING' }
};
```

## Implementation Status

### Fixed Issues
- ✅ Session uniqueness now includes fileName to prevent duplicate overwrites
- ✅ Parser correctly creates 6 separate sessions for Packet trial

### Remaining Issues
- ⚠️ Dates still showing as 1900-01-01 (placeholder)
- ⚠️ Session types all default to MORNING without time extraction

## Recommendations

For the 60+ trial demo set:
1. **Short-term**: Use Option 1 (file renaming) for Packet trial only
2. **Medium-term**: Implement Option 2 (override system via trialstyle.json)
3. **Long-term**: Focus parsing improvements on the majority pattern (trials with dates in filenames)

The Packet trial represents < 2% of the dataset with a unique convention. Manual intervention for this edge case is acceptable to maintain simplicity in the parser for the 98% majority case.