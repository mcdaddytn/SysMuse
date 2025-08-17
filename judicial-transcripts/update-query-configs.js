#!/usr/bin/env node

// Script to update all query configuration files to use new parameter names
// and place SQL query parameters in queryParams sub-node

const fs = require('fs');
const path = require('path');

const queriesDir = path.join(__dirname, 'config', 'queries');

// Parameters that should be in queryParams
const queryParamFields = [
  'trialName',
  'caseNumber', 
  'sessionDate',
  'sessionType',
  'speakerType',
  'speakerPrefix',
  'speakerHandle'
];

// Parameter name mappings
const renameMappings = {
  'surroundingStatements': 'surroundingEvents',
  'outputFileNameTemplate': 'fileNameTemplate',
  'outputFileTemplate': 'fileTemplate'
};

function updateQueryFile(filePath) {
  console.log(`Updating ${path.basename(filePath)}...`);
  
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    let config = JSON.parse(content);
    
    // Skip if it's already updated (has queryParams or uses new names)
    if (config.queryParams || config.templateQuery) {
      console.log(`  Already updated or uses templateQuery, skipping`);
      return;
    }
    
    // Create queryParams object
    const queryParams = {};
    let hasQueryParams = false;
    
    // Move SQL query parameters to queryParams
    for (const field of queryParamFields) {
      if (config[field] !== undefined) {
        queryParams[field] = config[field];
        delete config[field];
        hasQueryParams = true;
      }
    }
    
    // Only add queryParams if there are any
    if (hasQueryParams) {
      config.queryParams = queryParams;
    }
    
    // Rename old parameter names
    for (const [oldName, newName] of Object.entries(renameMappings)) {
      if (config[oldName] !== undefined) {
        config[newName] = config[oldName];
        delete config[oldName];
      }
    }
    
    // Write updated config
    fs.writeFileSync(filePath, JSON.stringify(config, null, 2) + '\n');
    console.log(`  ✓ Updated successfully`);
    
  } catch (error) {
    console.error(`  ✗ Error updating file: ${error.message}`);
  }
}

// Get all JSON files in queries directory
const files = fs.readdirSync(queriesDir).filter(f => f.endsWith('.json'));

console.log(`Found ${files.length} query configuration files\n`);

// Update each file
for (const file of files) {
  updateQueryFile(path.join(queriesDir, file));
}

console.log('\nUpdate complete!');