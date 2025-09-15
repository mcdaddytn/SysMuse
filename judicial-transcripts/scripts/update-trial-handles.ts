import { PrismaClient } from '@prisma/client';
import { generateFileToken } from '../src/utils/fileTokenGenerator';

const prisma = new PrismaClient();

async function updateTrialHandles() {
  console.log('Updating Trial shortNameHandle values...\n');

  // Get all trials
  const trials = await prisma.trial.findMany({
    select: { id: true, shortName: true, shortNameHandle: true }
  });

  console.log(`Found ${trials.length} trials to process\n`);

  for (const trial of trials) {
    if (!trial.shortName) {
      console.log(`Trial ${trial.id}: Missing shortName, skipping`);
      continue;
    }

    const newHandle = generateFileToken(trial.shortName);

    if (trial.shortNameHandle !== newHandle) {
      console.log(`Trial ${trial.id}: "${trial.shortName}"`);
      console.log(`  Old handle: ${trial.shortNameHandle || 'NULL'}`);
      console.log(`  New handle: ${newHandle}`);

      // Update the trial record
      await prisma.trial.update({
        where: { id: trial.id },
        data: { shortNameHandle: newHandle }
      });

      console.log('  ✓ Updated\n');
    } else {
      console.log(`Trial ${trial.id}: "${trial.shortName}" - already correct (${newHandle})`);
    }
  }

  console.log('All trial handles updated successfully!');
}

updateTrialHandles()
  .catch(console.error)
  .finally(() => prisma.$disconnect());