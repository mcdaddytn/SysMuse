# Feature 1: Phase 1 Transcript Parser Bulk Load

## Overview
*** This is a contrived feature to layout template ***

Enhance the phase 1 parsing of the judicial transcripts to include bulk loading for faster performance.  We had implemented this previously, where we inserted lines from an entire page (~25) at a time.  We can do this or choose a bulk quantity that can be configured, but the main need is for the performance of phase 1 parsing to be substanitally increased.

Check first to see that Line records are no longer inserted in bulk, it used to be that way.  There is a parameter in the input configuration (see example-trial-config-mac.json) called batchSize that could be used for this purpose, but it does not appear to be used.  We just want a bulk sql insert for now. Later we will be bulk inserting to both postgres and elastic search, just to keep in mind when creating parameters to control the process.            

## Input Sources
- Plain text files (.txt) from Lexis Nexis, converted with the pdf-text-extract library
- PDF files from court systems
- See `samples/transcripts/` for examples
- Samples beginning with "ExcerptN" where N is integer 1 to 73 are ordered excerpts of a full case
- Sample TRANSCRIPT 219-CV-123-JRG 10_1_20 AM.txt is the first full morning session of the same case
- Sample TRANSCRIPT 216-cv-00230-JRG 10_10_17 AM.txt is a full morning session of another case with slightly different conventions (e.g., no timestamps on individual lines in proceedings, different spacing, etc.)


## Requirements
1. Enhance inserts into database of Line records to do bulk inserts either a page at a time or a configured batchSize (there is a parameter in the input configuration json called batchSize)
2. Log each batch inserted, and show stats at end of phase 1 of rate of inserts and totals


## Expected Output Format
Same output as before, just faster