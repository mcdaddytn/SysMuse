#!/usr/bin/env ts-node
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const attorneys = await prisma.attorney.findMany({
    select: { name: true, attorneyFingerprint: true }
  });
  
  const bad = attorneys.filter(a => {
    const n = (a.name || '').toUpperCase();
    // Skip proper attorney names
    if (n.startsWith('MR.') || n.startsWith('MS.') || n.startsWith('MRS.') || n.startsWith('DR.')) return false;
    if (n.startsWith('JUDGE') || n.startsWith('THE HONORABLE')) return false;
    // Allow all-caps names
    if (n.match(/^[A-Z]+(\s+[A-Z]+)+$/)) return false;
    return true;
  });
  
  console.log('Bad attorney entries (likely addresses/law firms):');
  console.log('===================================================');
  bad.forEach(a => console.log('  -', a.name));
  console.log('\nTotal bad:', bad.length, 'out of', attorneys.length, 'attorneys');
  
  // Show some samples with fingerprints
  console.log('\nSample with fingerprints:');
  bad.slice(0, 10).forEach(a => console.log(`  - ${a.name} (${a.attorneyFingerprint})`));
  
  await prisma.$disconnect();
}

main().catch(console.error);