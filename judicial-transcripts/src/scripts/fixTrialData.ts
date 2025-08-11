#!/usr/bin/env ts-node
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function fixTrialData() {
  console.log('Fixing trial data...');
  
  // Update the trial record with correct values
  const updated = await prisma.trial.update({
    where: { id: 1 },
    data: {
      name: 'VOCALIFE LLC, PLAINTIFF, VS. AMAZON.COM, INC. and AMAZON.COM LLC, DEFENDANTS.',
      caseNumber: '2:19-CV-00123-JRG',
      court: 'UNITED STATES DISTRICT COURT',
      courtDivision: 'MARSHALL DIVISION',
      courtDistrict: 'EASTERN DISTRICT OF TEXAS'
    }
  });
  
  console.log('Updated trial:');
  console.log('  Name:', updated.name);
  console.log('  Case Number:', updated.caseNumber);
  console.log('  Court:', updated.court);
  console.log('  Court Division:', updated.courtDivision);
  console.log('  Court District:', updated.courtDistrict);
  
  await prisma.$disconnect();
}

fixTrialData().catch(console.error);