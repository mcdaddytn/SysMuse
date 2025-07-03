// prisma/seed.ts

import { PrismaClient, Urgency, TimeIncrementType } from '@prisma/client';
import * as clientsData from './seeds/clients.json';
import * as mattersData from './seeds/matters.json';
import * as teamMembersData from './seeds/teamMembers.json';
import * as tasksData from './seeds/tasks.json';

const prisma = new PrismaClient();

// Validate and correct time increment values
function validateTimeIncrement(timeIncrementType: string, timeIncrement: number): number {
  const validHourMinuteIncrements = [1, 2, 3, 5, 6, 10, 12, 15, 20, 30];
  
  if (timeIncrementType === 'PERCENT') {
    return 1; // Only valid value for percent
  } else if (timeIncrementType === 'HOURS_MINUTES') {
    // Find the closest valid increment
    if (validHourMinuteIncrements.includes(timeIncrement)) {
      return timeIncrement;
    }
    
    // Find the closest valid value
    let closest = validHourMinuteIncrements[0];
    let minDiff = Math.abs(timeIncrement - closest);
    
    for (const validIncrement of validHourMinuteIncrements) {
      const diff = Math.abs(timeIncrement - validIncrement);
      if (diff < minDiff) {
        minDiff = diff;
        closest = validIncrement;
      }
    }
    
    console.log(`Warning: Invalid time increment ${timeIncrement} for HOURS_MINUTES, using ${closest} instead`);
    return closest;
  }
  
  return 1; // Default fallback
}

async function main() {
  console.log('Start seeding...');

  // Clear existing data
  await prisma.timesheetEntry.deleteMany();
  await prisma.timesheet.deleteMany();
  await prisma.task.deleteMany();
  await prisma.matter.deleteMany();
  await prisma.client.deleteMany();
  await prisma.teamMember.deleteMany();

  // Seed clients
  const clients = await Promise.all(
    clientsData.clients.map(async (client) => {
      return prisma.client.create({
        data: client,
      });
    })
  );
  console.log(`Created ${clients.length} clients`);

  // Seed matters
  const matters = await Promise.all(
    mattersData.matters.map(async (matter) => {
      return prisma.matter.create({
        data: matter,
      });
    })
  );
  console.log(`Created ${matters.length} matters`);

  // Seed team members with validation
  const teamMembers = await Promise.all(
    teamMembersData.teamMembers.map(async (member) => {
      const validatedTimeIncrement = validateTimeIncrement(
        member.timeIncrementType,
        member.timeIncrement
      );
      
      return prisma.teamMember.create({
        data: {
          ...member,
          timeIncrementType: member.timeIncrementType as TimeIncrementType,
          timeIncrement: validatedTimeIncrement,
        },
      });
    })
  );
  console.log(`Created ${teamMembers.length} team members`);

  // Seed tasks
  const tasks = await Promise.all(
    tasksData.tasks.map(async (task) => {
      return prisma.task.create({
        data: task,
      });
    })
  );
  console.log(`Created ${tasks.length} tasks`);

  console.log('Seeding finished.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
  
