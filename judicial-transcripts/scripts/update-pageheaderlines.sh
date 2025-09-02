#!/bin/bash

# Update pageHeaderLines for specific trials based on analysis

# Function to update pageHeaderLines in a trialstyle.json file
update_trial() {
  local trial_dir="$1"
  local header_lines="$2"
  local trial_name="$3"
  
  echo "Updating $trial_name to pageHeaderLines=$header_lines"
  
  # Update in output directory
  if [ -f "./output/multi-trial/$trial_dir/trialstyle.json" ]; then
    sed -i.bak "s/\"pageHeaderLines\": [0-9]*/\"pageHeaderLines\": $header_lines/" "./output/multi-trial/$trial_dir/trialstyle.json"
    echo "  Updated in output directory"
  fi
  
  # Update in config/trial-configs
  local safe_name=$(echo "$trial_dir" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9-]/-/g' | sed 's/-\+/-/g')
  local prefix=$(echo "$trial_dir" | grep -o '^[0-9]*')
  if [ -f "./config/trial-configs/${prefix}-${safe_name}.json" ]; then
    sed -i.bak "s/\"pageHeaderLines\": [0-9]*/\"pageHeaderLines\": $header_lines/" "./config/trial-configs/${prefix}-${safe_name}.json"
    echo "  Updated in config directory"
  fi
}

# Set defaults to 1 for all trials first
echo "Setting default pageHeaderLines=1 for all trials..."
for file in ./output/multi-trial/*/trialstyle.json; do
  if [ -f "$file" ]; then
    sed -i.bak 's/"pageHeaderLines": [0-9]*/"pageHeaderLines": 1/' "$file"
  fi
done

for file in ./config/trial-configs/*.json; do
  if [ -f "$file" ]; then
    sed -i.bak 's/"pageHeaderLines": [0-9]*/"pageHeaderLines": 1/' "$file"
  fi
done

echo ""
echo "Applying specific pageHeaderLines configurations..."

# Apply specific configurations based on your analysis
update_trial "04 Intellectual Ventures" 3 "04 Intellectual Ventures"
update_trial "05 Personalized Media v Zynga" 2 "05 Personalized Media v Zynga"
update_trial "12 Gree Supercell" 2 "12 Gree Supercell"
update_trial "23 Flexuspine V. Globus Medical" 1 "23 Flexuspine V. Globus Medical (keeping at 1 for now)"
update_trial "28 Implicit V Netscout" 2 "28 Implicit V Netscout"
update_trial "32 Netlist V Samsung" 2 "32 Netlist V Samsung"
update_trial "33 Personal Audio V. Cbs" 3 "33 Personal Audio V. Cbs"
update_trial "34 Personalized Media V Google" 2 "34 Personalized Media V Google"
update_trial "36 Salazar V. Htc" 2 "36 Salazar V. Htc"
update_trial "40 USAA V Wells" 2 "40 USAA V Wells"

echo ""
echo "Cleaning up backup files..."
rm -f ./output/multi-trial/*/trialstyle.json.bak
rm -f ./config/trial-configs/*.json.bak

echo ""
echo "Done! All pageHeaderLines configurations have been updated."