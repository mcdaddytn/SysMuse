// prisma/seed.ts

import { PrismaClient, Urgency } from '@prisma/client';
import * as clientsData from './seeds/clients.json';
import * as mattersData from './seeds/matters.json';
import * as teamMembersData from './seeds/teamMembers.json';
import * as tasksData from './seeds/tasks.json';

const prisma = new PrismaClient();

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

  // Seed team members
  const teamMembers = await Promise.all(
    teamMembersData.teamMembers.map(async (member) => {
      return prisma.teamMember.create({
        data: member,
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
