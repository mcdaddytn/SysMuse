// prisma/seed.ts - Fixed TypeScript imports and types

import { PrismaClient, Urgency, TimeIncrementType, ITActivityType, TeamMemberRole, AccessLevel } from '@prisma/client';
import bcrypt from 'bcrypt';
import { generateITActivities } from './seeds/itActivitiesGenerator';
const settingsData = require('./seeds/settings.json');
const clientsData = require('./seeds/clients.json');
const mattersData = require('./seeds/matters.json');
const teamMembersData = require('./seeds/teamMembers.json');
const tasksData = require('./seeds/tasks.json');

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

  // Clear existing data (including IT activities)
  await prisma.timesheetEntry.deleteMany();
  await prisma.timesheet.deleteMany();
  await prisma.iTActivity.deleteMany(); // Clear IT activities
  await prisma.task.deleteMany();
  await prisma.matter.deleteMany();
  await prisma.client.deleteMany();
  await prisma.teamMember.deleteMany();

  // Seed settings
  const settings = await Promise.all(
    settingsData.settings.map(async (setting: any) => {
      return prisma.settings.create({
        data: {
    key: setting.key,
    value: setting.value,
    description: setting.description,
        },
      });
    })
  );
  console.log(`Created ${settings.length} settings`);

  const defaultSettings = await prisma.settings.findMany({
    where: {
      key: {
        in: ['workingHours', 'timeIncrementType', 'timeIncrement']
      }
    }
  });

  const defaultWorkingHours = defaultSettings.find(s => s.key === 'workingHours')?.value || 40;
  const defaultTimeIncrementType = defaultSettings.find(s => s.key === 'timeIncrementType')?.value || 'HOURS_MINUTES';
  const defaultTimeIncrement = defaultSettings.find(s => s.key === 'timeIncrement')?.value || 15;

  // Seed clients
  const clients = await Promise.all(
    clientsData.clients.map(async (client: any) => {
      return prisma.client.create({
        data: client,
      });
    })
  );
  console.log(`Created ${clients.length} clients`);

  // Seed matters
  const matters = await Promise.all(
    mattersData.matters.map(async (matter: any) => {
      return prisma.matter.create({
        data: matter,
      });
    })
  );
  console.log(`Created ${matters.length} matters`);

  // Seed team members with validation and password hashing
  const teamMembers = await Promise.all(
    teamMembersData.teamMembers.map(async (member: any) => {
      const timeIncrementType = member.timeIncrementType || defaultTimeIncrementType;
      const timeIncrement = member.timeIncrement || defaultTimeIncrement;
      const validatedTimeIncrement = validateTimeIncrement(timeIncrementType, timeIncrement);
      
      // Hash password if provided
      let hashedPassword = null;
      if (member.password) {
        hashedPassword = await bcrypt.hash(member.password, 10);
      }
      
      return prisma.teamMember.create({
        data: {
          id: member.id,
          name: member.name,
          email: member.email,
          password: hashedPassword,
          title: member.title,
          role: member.role as TeamMemberRole,
          accessLevel: member.accessLevel as AccessLevel,
          workingHours: member.workingHours || defaultWorkingHours,
          timeIncrementType: timeIncrementType as TimeIncrementType,
          timeIncrement: validatedTimeIncrement,
          isActive: member.isActive ?? true,
        },
      });
    })
  );
  console.log(`Created ${teamMembers.length} team members`);  

  // Seed tasks
  const tasks = await Promise.all(
    tasksData.tasks.map(async (task: any) => {
      return prisma.task.create({
        data: task,
      });
    })
  );
  console.log(`Created ${tasks.length} tasks`);

  // Generate IT activities using the configurable generator
  console.log('Generating IT activities...');
  await generateITActivities();
  
  const itActivitiesCount = await prisma.iTActivity.count();
  console.log(`Generated ${itActivitiesCount} IT activities`);

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