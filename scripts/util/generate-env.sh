#!/bin/bash

EXAMPLE_FILE=".env.example"
CONFIG_FILE="env-config.json"
OUTPUT_FILE=".env"

if [[ ! -f "$EXAMPLE_FILE" || ! -f "$CONFIG_FILE" ]]; then
  echo "Missing $EXAMPLE_FILE or $CONFIG_FILE"
  exit 1
fi

declare -A SUBS

# Read JSON keys
while IFS="=" read -r key default; do
  prompt="Enter value for $key [$default]: "
  read -rp "$prompt" input
  value="${input:-$default}"
  SUBS["$key"]="$value"
done < <(jq -r 'to_entries[] | "\(.key)=\(.value)"' "$CONFIG_FILE")

# Create .env
{
  while IFS= read -r line || [ -n "$line" ]; do
    updated_line="$line"
    for key in "${!SUBS[@]}"; do
      envvar="${key%%.*}"
      literal="${key#*.}"
      if [[ "$line" == "$envvar="* ]]; then
        updated_line="${updated_line//$literal/${SUBS[$key]}}"
      fi
    done
    echo "$updated_line"
  done < "$EXAMPLE_FILE"
} > "$OUTPUT_FILE"

echo "Success .env generated successfully."
