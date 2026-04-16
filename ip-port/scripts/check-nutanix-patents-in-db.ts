import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const patentIds = [
  '8966035','8291159','9785455','11811859','10103939','7603670','8886705',
  '7945436','7412702','10700996','10375121','7853744','9654367','7533229',
  '8209687','11343283','7783779','9760443','8104083','11726807','8825591',
  '9952887','8635493','11436112','11422840','8763115','8387046','9077664',
  '12086084','8966623','11182196','11693952','10592267','10942759','11201808',
  '11637833','11917083'
];

async function main() {
  const found = await prisma.patent.findMany({
    where: { patentId: { in: patentIds } },
    select: { patentId: true, title: true, assignee: true, affiliate: true, superSector: true }
  });

  const foundIds = new Set(found.map(p => p.patentId));
  const missing = patentIds.filter(id => !foundIds.has(id));

  console.log(`=== FOUND IN DB (${found.length}) ===`);
  for (const p of found) {
    console.log(`${p.patentId} | ${p.affiliate || p.assignee || 'NO ASSIGNEE'} | ${p.superSector || 'NO SS'}`);
  }

  console.log('');
  console.log(`=== MISSING FROM DB (${missing.length}) ===`);
  for (const id of missing) {
    console.log(id);
  }

  // Check portfolio membership
  const portfolio = await prisma.portfolio.findUnique({ where: { name: 'broadcom-core' } });
  if (portfolio) {
    const inPortfolio = await prisma.portfolioPatent.findMany({
      where: { portfolioId: portfolio.id, patentId: { in: patentIds } },
      select: { patentId: true }
    });
    const portfolioIds = new Set(inPortfolio.map(p => p.patentId));
    const notInPortfolio = patentIds.filter(id => foundIds.has(id) && !portfolioIds.has(id));
    console.log('');
    console.log(`=== IN broadcom-core PORTFOLIO (${inPortfolio.length}) ===`);
    console.log(inPortfolio.map(p => p.patentId).join(', '));
    console.log('');
    console.log(`=== IN DB BUT NOT IN broadcom-core (${notInPortfolio.length}) ===`);
    console.log(notInPortfolio.join(', '));
  }

  // Check existing focus areas for Nutanix
  const focusAreas = await prisma.focusArea.findMany({
    where: { name: { contains: 'utanix', mode: 'insensitive' } },
    select: { id: true, name: true, status: true, patentCount: true, parentId: true }
  });
  console.log('');
  console.log(`=== EXISTING NUTANIX FOCUS AREAS (${focusAreas.length}) ===`);
  for (const fa of focusAreas) {
    console.log(`${fa.id} | ${fa.name} | ${fa.status} | ${fa.patentCount} patents | parent: ${fa.parentId || 'none'}`);
  }

  await prisma.$disconnect();
}
main();
