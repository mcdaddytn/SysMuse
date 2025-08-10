# Feature 1: Basic Transcript Parser

## Overview
*** This is a contrived feature to layout template ***

Parse judicial transcripts from text and PDF files into structured JSON format, extracting key metadata and content sections.

## Input Sources
- Plain text files (.txt) from Lexis Nexis
- PDF files from court systems
- See `samples/transcripts/` for examples

## Requirements
1. Parse header metadata (case name, date, court, participants)
2. Extract speaker identification and dialogue
3. Preserve line numbers and timestamps where present
4. Handle common formatting variations
5. Output structured JSON with consistent schema

## Expected Output Format
```json
{
  "metadata": {
    "case_name": "State v. Smith",
    "court": "Superior Court of California",
    "date": "2024-03-15",
    "participants": [
      {"name": "Judge Johnson", "role": "judge"},
      {"name": "Attorney Davis", "role": "prosecutor"}
    ]
  },
  "content": [
    {
      "line_number": 1,
      "timestamp": "09:00:00",
      "speaker": "Judge Johnson",
      "text": "Court is now in session."
    }
  ]
}