#!/bin/bash

echo "Testing all queries in config/queries directory..."
echo "================================================"

for query_file in config/queries/*.json; do
    if [ -f "$query_file" ]; then
        filename=$(basename "$query_file")
        echo ""
        echo "Testing: $filename"
        echo "------------------------"
        
        # Run the query and capture the results
        output=$(npm run enhanced-search query -- -f "$query_file" 2>&1)
        
        # Extract key metrics
        sql_count=$(echo "$output" | grep "SQL query returned" | head -1 | grep -oE '[0-9]+' | head -1)
        es_hits=$(echo "$output" | grep "Elasticsearch query returned" | head -1 | grep -oE '[0-9]+' | head -1)
        matched=$(echo "$output" | grep "Matched statements:" | grep -oE '[0-9]+' | head -1)
        
        echo "  SQL Results: $sql_count"
        echo "  ES Total Hits: $es_hits"
        echo "  Matched Statements: $matched"
        
        # Check for individual query matches
        echo "$output" | grep "Query '.*' matched" | sed 's/^/  /'
        
        # Flag if no ES results
        if [ "$matched" == "0" ] || [ -z "$matched" ]; then
            echo "  ⚠️  WARNING: No matching results from Elasticsearch!"
        fi
    fi
done

echo ""
echo "================================================"
echo "Test complete!"