#!/bin/bash

# Update additional pageHeaderLines configurations based on sampling analysis

# Function to update pageHeaderLines in a trialstyle.json file
update_trial() {
  local trial_dir="$1"
  local header_lines="$2"
  
  echo "Updating $trial_dir to pageHeaderLines=$header_lines"
  
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

echo "Applying additional pageHeaderLines=2 configurations based on sampling..."
echo ""

# Apply configurations for trials identified as likely needing pageHeaderLines=2
update_trial "42 Vocalife Amazon" 2
update_trial "49 Luvncare V Royal King" 2
update_trial "55 SSL V Citrix" 2
update_trial "61 Nichia Corporation V. Everlight Electronics" 2
update_trial "63 Solas Oled Ltd. V. Samsung" 2

echo ""
echo "Cleaning up backup files..."
rm -f ./output/multi-trial/*/trialstyle.json.bak
rm -f ./config/trial-configs/*.json.bak

echo ""
echo "Done! Additional pageHeaderLines configurations have been updated."
echo ""
echo "Summary of updates:"
echo "  42 Vocalife Amazon → pageHeaderLines=2"
echo "  49 Luvncare V Royal King → pageHeaderLines=2"
echo "  55 SSL V Citrix → pageHeaderLines=2"
echo "  61 Nichia Corporation V. Everlight Electronics → pageHeaderLines=2"
echo "  63 Solas Oled Ltd. V. Samsung → pageHeaderLines=2"