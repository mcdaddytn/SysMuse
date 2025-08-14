#!/bin/bash

# Elasticsearch Force Reset Script (Unix/Mac)
# This script deletes and recreates the judicial_statements index WITHOUT prompting

ES_URL="${ELASTICSEARCH_URL:-http://localhost:9200}"
INDEX_NAME="judicial_statements"

echo "====================================================="
echo "ELASTICSEARCH INDEX FORCE RESET"
echo "====================================================="
echo ""
echo "Elasticsearch URL: $ES_URL"
echo "Index Name: $INDEX_NAME"
echo ""

# Delete the index if it exists (ignore errors if it doesn't exist)
echo "Deleting index '$INDEX_NAME' if it exists..."
curl -s -X DELETE "$ES_URL/$INDEX_NAME" > /dev/null 2>&1
echo "✅ Delete operation completed"

echo ""
echo "Creating new index with mappings..."

# Create index with proper mappings
curl -s -X PUT "$ES_URL/$INDEX_NAME" \
  -H "Content-Type: application/json" \
  -d '{
    "mappings": {
      "properties": {
        "text": {"type": "text", "analyzer": "standard"},
        "trialId": {"type": "integer"},
        "sessionId": {"type": "integer"},
        "speakerId": {"type": "integer"},
        "speakerType": {"type": "keyword"},
        "speakerPrefix": {"type": "keyword"},
        "speakerHandle": {"type": "keyword"},
        "startLineNumber": {"type": "integer"},
        "endLineNumber": {"type": "integer"},
        "startTime": {"type": "text"},
        "endTime": {"type": "text"},
        "sessionDate": {"type": "date"},
        "sessionType": {"type": "keyword"},
        "caseNumber": {"type": "keyword"},
        "trialName": {"type": "text"}
      }
    },
    "settings": {
      "number_of_shards": 1,
      "number_of_replicas": 0,
      "analysis": {
        "analyzer": {
          "standard": {
            "type": "standard",
            "stopwords": "_none_"
          }
        }
      }
    }
  }' > /dev/null

echo "✅ Index created"

# Final verification
DOC_COUNT=$(curl -s "$ES_URL/$INDEX_NAME/_count" 2>/dev/null | grep -o '"count":[0-9]*' | cut -d: -f2)
echo ""
echo "Document count in new index: ${DOC_COUNT:-0}"
echo ""
echo "✅ RESET COMPLETE - Index is empty and ready for use"