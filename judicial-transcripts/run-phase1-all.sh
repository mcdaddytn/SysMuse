#!/bin/bash
# Script to run phase 1 parsing for all 4 trials

echo "======================================"
echo "Running Phase 1 for all 4 trials"
echo "======================================"

# Trial 1: Genband vs Metaswitch
echo ""
echo "1. Processing Genband vs Metaswitch..."
cat > config/genband-config.json << 'EOF'
{
  "inputDir": "./output/multi-trial/01 Genband",
  "outputDir": "./output/multi-trial/01 Genband",
  "logLevel": "info",
  "parserMode": "legacy"
}
EOF
npx ts-node src/cli/parse.ts parse --phase1 --config config/genband-config.json

# Trial 2: Optis vs Apple
echo ""
echo "2. Processing Optis vs Apple..."
cat > config/optis-config.json << 'EOF'
{
  "inputDir": "./output/multi-trial/14 Optis Wireless Technology V. Apple Inc",
  "outputDir": "./output/multi-trial/14 Optis Wireless Technology V. Apple Inc",
  "logLevel": "info",
  "parserMode": "legacy"
}
EOF
npx ts-node src/cli/parse.ts parse --phase1 --config config/optis-config.json

# Trial 3: Vocalife vs Amazon 
echo ""
echo "3. Processing Vocalife vs Amazon..."
cat > config/vocalife-config.json << 'EOF'
{
  "inputDir": "./output/multi-trial/42 Vocalife Amazon",
  "outputDir": "./output/multi-trial/42 Vocalife Amazon",
  "logLevel": "info",
  "parserMode": "legacy"
}
EOF
npx ts-node src/cli/parse.ts parse --phase1 --config config/vocalife-config.json

# Trial 4: Packet Intelligence vs Netscout
echo ""
echo "4. Processing Packet Intelligence vs Netscout..."
cat > config/packet-config.json << 'EOF'
{
  "inputDir": "./output/multi-trial/50 Packet Netscout",
  "outputDir": "./output/multi-trial/50 Packet Netscout",
  "logLevel": "info",
  "parserMode": "legacy"
}
EOF
npx ts-node src/cli/parse.ts parse --phase1 --config config/packet-config.json

echo ""
echo "======================================"
echo "Phase 1 parsing complete for all trials"
echo "======================================"