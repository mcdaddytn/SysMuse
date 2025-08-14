#!/bin/bash

# Elasticsearch Reset Script (Unix/Mac)
# This script deletes and recreates the judicial_statements index

ES_URL="${ELASTICSEARCH_URL:-http://localhost:9200}"
INDEX_NAME="judicial_statements"

echo "====================================================="
echo "ELASTICSEARCH INDEX RESET (Shell Script)"
echo "====================================================="
echo ""
echo "Elasticsearch URL: $ES_URL"
echo "Index Name: $INDEX_NAME"
echo ""

# Check if Elasticsearch is reachable
echo "Checking Elasticsearch connection..."
if ! curl -s -o /dev/null -w "%{http_code}" "$ES_URL" | grep -q "200"; then
    echo "❌ ERROR: Cannot connect to Elasticsearch at $ES_URL"
    exit 1
fi
echo "✅ Connected to Elasticsearch"
echo ""

# Check if index exists and get document count
echo "Checking current index status..."
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "$ES_URL/$INDEX_NAME")
if [ "$RESPONSE" == "200" ]; then
    DOC_COUNT=$(curl -s "$ES_URL/$INDEX_NAME/_count" | grep -o '"count":[0-9]*' | cut -d: -f2)
    echo "⚠️  Index '$INDEX_NAME' exists with $DOC_COUNT documents"
    
    # Prompt for confirmation
    read -p "Are you sure you want to DELETE all data? (yes/no): " -r
    if [[ ! $REPLY =~ ^[Yy]es$ ]]; then
        echo "Operation cancelled."
        exit 0
    fi
    
    # Delete the index
    echo ""
    echo "Deleting index '$INDEX_NAME'..."
    DELETE_RESPONSE=$(curl -s -X DELETE "$ES_URL/$INDEX_NAME" -w "\nHTTP_STATUS:%{http_code}")
    HTTP_STATUS=$(echo "$DELETE_RESPONSE" | grep "HTTP_STATUS" | cut -d: -f2)
    
    if [ "$HTTP_STATUS" == "200" ]; then
        echo "✅ Index deleted successfully"
    else
        echo "❌ Failed to delete index"
        echo "$DELETE_RESPONSE"
        exit 1
    fi
else
    echo "Index '$INDEX_NAME' does not exist"
fi

echo ""
echo "Creating new index with mappings..."

# Create index with proper mappings
CREATE_RESPONSE=$(curl -s -X PUT "$ES_URL/$INDEX_NAME" \
  -H "Content-Type: application/json" \
  -d '{
    "mappings": {
      "properties": {
        "text": {
          "type": "text",
          "analyzer": "standard"
        },
        "trialId": {
          "type": "integer"
        },
        "sessionId": {
          "type": "integer"
        },
        "speakerId": {
          "type": "integer"
        },
        "speakerType": {
          "type": "keyword"
        },
        "speakerPrefix": {
          "type": "keyword"
        },
        "speakerHandle": {
          "type": "keyword"
        },
        "startLineNumber": {
          "type": "integer"
        },
        "endLineNumber": {
          "type": "integer"
        },
        "startTime": {
          "type": "text"
        },
        "endTime": {
          "type": "text"
        },
        "sessionDate": {
          "type": "date"
        },
        "sessionType": {
          "type": "keyword"
        },
        "caseNumber": {
          "type": "keyword"
        },
        "trialName": {
          "type": "text"
        }
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
  }' -w "\nHTTP_STATUS:%{http_code}")

HTTP_STATUS=$(echo "$CREATE_RESPONSE" | grep "HTTP_STATUS" | cut -d: -f2)

if [ "$HTTP_STATUS" == "200" ]; then
    echo "✅ Index created successfully with mappings"
else
    echo "❌ Failed to create index"
    echo "$CREATE_RESPONSE"
    exit 1
fi

# Check index health
echo ""
echo "Checking index health..."
HEALTH=$(curl -s "$ES_URL/_cluster/health/$INDEX_NAME?pretty" | grep '"status"' | cut -d'"' -f4)
echo "Index health status: $HEALTH"

# Final verification
echo ""
echo "Verifying index..."
DOC_COUNT=$(curl -s "$ES_URL/$INDEX_NAME/_count" | grep -o '"count":[0-9]*' | cut -d: -f2)
echo "Document count in new index: $DOC_COUNT"

echo ""
echo "====================================================="
echo "ELASTICSEARCH RESET COMPLETE"
echo "====================================================="
echo ""
echo "To resync data from the database, run:"
echo "  npm run es:reset:sync"
echo ""