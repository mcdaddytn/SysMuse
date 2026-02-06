#!/bin/bash
# Claims Comparison Test Runner
# Compares LLM scoring with and without claims context

API_BASE="http://localhost:3001/api/scoring-templates"
SECTOR="video-codec"
TEST_COUNT=${1:-10}  # Default to 10 patents for cost control

echo "=========================================="
echo "Claims Comparison Test"
echo "Sector: $SECTOR"
echo "Test patents: $TEST_COUNT"
echo "=========================================="

# 1. Check claims availability for test set
echo ""
echo "Step 1: Getting test set with claims availability..."
TEST_SET=$(curl -s "$API_BASE/compare/test-set/$SECTOR?count=$TEST_COUNT")
echo "$TEST_SET" | jq '{totalPatents, claimsAvailable, coverage}'

# 2. Preview claims for first patent
FIRST_PATENT=$(echo "$TEST_SET" | jq -r '.testSet[0].patent_id')
echo ""
echo "Step 2: Preview claims for patent $FIRST_PATENT..."
curl -s "$API_BASE/claims/preview/$FIRST_PATENT?independentOnly=true&maxClaims=3" | jq '{found, estimatedTokens, extractedText: .extractedText[0:300]}'

# 3. Run single comparison (for quick validation)
echo ""
echo "Step 3: Running single patent comparison..."
echo "This will score the patent twice (with and without claims)."
echo "Starting comparison for $FIRST_PATENT..."

SINGLE_RESULT=$(curl -s -X POST "$API_BASE/compare/single/$FIRST_PATENT")
echo "$SINGLE_RESULT" | jq '{
  patentId,
  baselineComposite: .baselineScore.compositeScore,
  claimsComposite: .claimsScore.compositeScore,
  scoreDelta,
  claimsTokensUsed,
  metricDeltas
}'

echo ""
echo "=========================================="
echo "Single comparison complete!"
echo ""
echo "To run full comparison on $TEST_COUNT patents (EXPENSIVE - ~\$2):"
echo "curl -X POST '$API_BASE/compare/run/$SECTOR?count=$TEST_COUNT'"
echo "=========================================="
