#!/bin/bash
#
# List all patent IDs in cache (for delta comparison)
#
# Usage: ./scripts/list-cache-ids.sh > my-cache-ids.json
#
# This creates a JSON file that can be transferred to the source machine
# and used with export-delta.sh --manifest to create a targeted delta.
#

echo "{"
echo "  \"generated_at\": \"$(date -Iseconds)\","
echo "  \"machine\": \"$(hostname)\","
echo "  \"cache_contents\": {"

# LLM scores
echo "    \"llm_scores\": ["
if [ -d "cache/llm-scores" ]; then
  ls cache/llm-scores/*.json 2>/dev/null | xargs -I{} basename {} .json | sort | awk '{printf "      \"%s\"", $0; if (NR>1) printf ","; printf "\n"}' | tac | awk 'NR==1{print; next}{printf "%s,\n", $0}' | tac
fi
echo "    ],"

# Prosecution scores
echo "    \"prosecution_scores\": ["
if [ -d "cache/prosecution-scores" ]; then
  ls cache/prosecution-scores/*.json 2>/dev/null | xargs -I{} basename {} .json | sort | awk '{printf "      \"%s\"", $0; if (NR>1) printf ","; printf "\n"}' | tac | awk 'NR==1{print; next}{printf "%s,\n", $0}' | tac
fi
echo "    ],"

# IPR scores
echo "    \"ipr_scores\": ["
if [ -d "cache/ipr-scores" ]; then
  ls cache/ipr-scores/*.json 2>/dev/null | xargs -I{} basename {} .json | sort | awk '{printf "      \"%s\"", $0; if (NR>1) printf ","; printf "\n"}' | tac | awk 'NR==1{print; next}{printf "%s,\n", $0}' | tac
fi
echo "    ],"

# Patent families
echo "    \"patent_families\": ["
if [ -d "cache/patent-families/parents" ]; then
  ls cache/patent-families/parents/*.json 2>/dev/null | xargs -I{} basename {} .json | sort | awk '{printf "      \"%s\"", $0; if (NR>1) printf ","; printf "\n"}' | tac | awk 'NR==1{print; next}{printf "%s,\n", $0}' | tac
fi
echo "    ]"

echo "  },"
echo "  \"counts\": {"
echo "    \"llm_scores\": $(ls cache/llm-scores/*.json 2>/dev/null | wc -l | tr -d ' '),"
echo "    \"prosecution_scores\": $(ls cache/prosecution-scores/*.json 2>/dev/null | wc -l | tr -d ' '),"
echo "    \"ipr_scores\": $(ls cache/ipr-scores/*.json 2>/dev/null | wc -l | tr -d ' '),"
echo "    \"patent_families\": $(ls cache/patent-families/parents/*.json 2>/dev/null | wc -l | tr -d ' ')"
echo "  }"
echo "}"
