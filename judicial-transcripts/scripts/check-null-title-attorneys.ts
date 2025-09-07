#!/usr/bin/env ts-node
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

async function checkNullTitleAttorneys() {
  // Get all attorneys with null titles from database
  const nullTitleAttorneys = await prisma.attorney.findMany({
    where: { title: null },
    include: { 
      trialAttorneys: {
        include: { trial: true }
      }
    },
    orderBy: { name: 'asc' }
  });

  console.log(`\n=== ATTORNEYS WITH NULL TITLES IN DATABASE ===`);
  console.log(`Total: ${nullTitleAttorneys.length} attorneys\n`);

  // Load all attorney names from trial-metadata.json files
  const metadataAttorneys = new Set<string>();
  const outputDir = './output/multi-trial';
  
  for (const trialDir of fs.readdirSync(outputDir)) {
    const metadataPath = path.join(outputDir, trialDir, 'trial-metadata.json');
    if (fs.existsSync(metadataPath)) {
      const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
      if (metadata.Attorney) {
        for (const attorney of metadata.Attorney) {
          metadataAttorneys.add(attorney.name);
        }
      }
    }
  }

  console.log(`Found ${metadataAttorneys.size} attorneys in trial-metadata.json files\n`);

  // Categorize attorneys
  const inMetadata: any[] = [];
  const notInMetadata: any[] = [];
  const looksLikeLawFirm: any[] = [];
  const looksLikeAddress: any[] = [];

  for (const attorney of nullTitleAttorneys) {
    const name = attorney.name;
    
    // Check if it's in metadata
    const isInMetadata = metadataAttorneys.has(name);
    
    // Check if it looks like a law firm
    const isLawFirm = /LLP|LLC|P\.C\.|L\.L\.P\.|INC\.|& |PLLC/.test(name);
    
    // Check if it looks like an address
    const isAddress = /[0-9]+ [A-Z][a-z]+ (Street|St\.|Avenue|Ave\.|Drive|Dr\.|Road|Rd\.|Boulevard|Blvd\.|Lane|Ln\.|Court|Ct\.|Plaza|Suite|Floor)|^[0-9]+\s+|CA   [0-9]|TX   [0-9]|D\.C\.|^\d+$/.test(name);
    
    const trials = attorney.trialAttorneys.map(ta => ta.trial.shortName || ta.trial.name).join(', ');
    
    const info = {
      name,
      trials: trials || 'No trials',
      inMetadata: isInMetadata
    };
    
    if (isLawFirm) {
      looksLikeLawFirm.push(info);
    } else if (isAddress) {
      looksLikeAddress.push(info);
    } else if (isInMetadata) {
      inMetadata.push(info);
    } else {
      notInMetadata.push(info);
    }
  }

  // Print results
  console.log(`\n1. ATTORNEYS IN trial-metadata.json (${inMetadata.length}):`);
  for (const att of inMetadata) {
    console.log(`   - ${att.name} [Trials: ${att.trials}]`);
  }

  console.log(`\n2. NOT IN ANY trial-metadata.json (${notInMetadata.length}): ⚠️`);
  for (const att of notInMetadata) {
    console.log(`   - ${att.name} [Trials: ${att.trials}]`);
  }

  console.log(`\n3. LOOKS LIKE LAW FIRM (${looksLikeLawFirm.length}): ❌`);
  for (const att of looksLikeLawFirm) {
    console.log(`   - ${att.name} [In metadata: ${att.inMetadata}] [Trials: ${att.trials}]`);
  }

  console.log(`\n4. LOOKS LIKE ADDRESS (${looksLikeAddress.length}): ❌`);
  for (const att of looksLikeAddress) {
    console.log(`   - ${att.name} [In metadata: ${att.inMetadata}] [Trials: ${att.trials}]`);
  }

  // Check which trials these attorneys are associated with
  const trialCounts = new Map<string, number>();
  for (const attorney of nullTitleAttorneys) {
    for (const ta of attorney.trialAttorneys) {
      const trialName = ta.trial.shortName || ta.trial.name;
      trialCounts.set(trialName, (trialCounts.get(trialName) || 0) + 1);
    }
  }

  console.log(`\n=== TRIAL BREAKDOWN ===`);
  for (const [trial, count] of Array.from(trialCounts.entries()).sort((a, b) => b[1] - a[1])) {
    console.log(`   ${trial}: ${count} attorneys with null title`);
  }

  // Get total counts
  const totalAttorneys = await prisma.attorney.count();
  const totalLawFirms = await prisma.lawFirm.count();
  const totalTrials = await prisma.trial.count();
  
  console.log(`\n=== DATABASE TOTALS ===`);
  console.log(`   Total Attorneys: ${totalAttorneys}`);
  console.log(`   Total Law Firms: ${totalLawFirms}`);
  console.log(`   Total Trials: ${totalTrials}`);
}

checkNullTitleAttorneys()
  .catch(error => {
    console.error('Error:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });