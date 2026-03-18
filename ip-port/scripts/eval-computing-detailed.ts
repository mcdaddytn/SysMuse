import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const portfolio = await prisma.portfolio.findUnique({ where: { name: 'broadcom-core' } });
  if (portfolio === null) return;
  const ss = await prisma.superSector.findFirst({ where: { name: 'COMPUTING' } });
  if (ss === null) return;

  const sectors = await prisma.sector.findMany({
    where: { superSectorId: ss.id },
    select: { name: true, displayName: true, description: true },
    orderBy: { name: 'asc' }
  });

  console.log('=== COMPUTING Sectors - Detailed Breakdown ===\n');

  for (const s of sectors) {
    const bPatents = await prisma.patent.findMany({
      where: {
        primarySector: s.name,
        superSector: 'COMPUTING',
        isQuarantined: false,
        portfolios: { some: { portfolioId: portfolio.id } }
      },
      select: { patentId: true }
    });
    const bIds = bPatents.map(p => p.patentId);
    if (bIds.length === 0) continue;

    const scores = await prisma.patentSubSectorScore.findMany({
      where: { patentId: { in: bIds } },
      select: { compositeScore: true, patentId: true, withClaims: true }
    });

    // Deduplicate to best per patent
    const bestByPatent = new Map<string, { compositeScore: number; withClaims: boolean }>();
    for (const sc of scores) {
      const existing = bestByPatent.get(sc.patentId);
      if (existing === undefined || sc.compositeScore > existing.compositeScore) {
        bestByPatent.set(sc.patentId, sc);
      }
    }

    const scoreValues = [...bestByPatent.values()];
    const composites = scoreValues.map(sv => sv.compositeScore);
    const avg = composites.length > 0 ? composites.reduce((a, b) => a + b, 0) / composites.length : 0;
    const top = composites.length > 0 ? Math.max(...composites) : 0;
    const gt45 = composites.filter(v => v >= 45).length;
    const gt50 = composites.filter(v => v >= 50).length;
    const gt55 = composites.filter(v => v >= 55).length;
    const gt60 = composites.filter(v => v >= 60).length;
    const gt65 = composites.filter(v => v >= 65).length;
    const gt70 = composites.filter(v => v >= 70).length;
    const withClaims = scoreValues.filter(sv => sv.withClaims).length;

    console.log('--- ' + s.name + ' ---');
    console.log('  Display: ' + s.displayName);
    console.log('  Description: ' + (s.description || 'n/a'));
    console.log('  Broadcom patents: ' + bIds.length + ' | Scored: ' + bestByPatent.size + ' | With claims: ' + withClaims);
    console.log('  Avg: ' + avg.toFixed(1) + ' | Top: ' + top.toFixed(1));
    console.log('  >45: ' + gt45 + ' | >50: ' + gt50 + ' | >55: ' + gt55 + ' | >60: ' + gt60 + ' | >65: ' + gt65 + ' | >70: ' + gt70);

    // Show top 5 patents
    const sorted = [...bestByPatent.entries()].sort((a, b) => b[1].compositeScore - a[1].compositeScore);
    const topIds = sorted.slice(0, 5).map(([id]) => id);
    const details = await prisma.patent.findMany({
      where: { patentId: { in: topIds } },
      select: { patentId: true, title: true, assignee: true }
    });
    const detMap = new Map(details.map(p => [p.patentId, p]));
    console.log('  Top 5:');
    for (const [id, sc] of sorted.slice(0, 5)) {
      const d = detMap.get(id);
      console.log('    ' + sc.compositeScore.toFixed(1) + ' | ' + id + ' | ' + (d?.title || '').substring(0, 65));
    }
    console.log('');
  }

  // Also check sectors NOT yet exported (exclude computing-runtime, computing-systems, data-retrieval)
  console.log('\n=== SECTORS ALREADY EXPORTED ===');
  console.log('  computing-runtime, computing-systems, data-retrieval');
  console.log('\n=== REMAINING CANDIDATES (not yet exported) ===');
  const remaining = sectors.filter(s =>
    s.name !== 'computing-runtime' && s.name !== 'computing-systems' && s.name !== 'data-retrieval'
  );
  for (const s of remaining) {
    console.log('  ' + s.name + ' (' + s.displayName + ')');
  }

  // Check "general" sector - what super-sector is it in?
  console.log('\n=== Checking "general" sector ===');
  const generalSector = await prisma.sector.findFirst({ where: { name: 'general' } });
  if (generalSector) {
    const genSS = await prisma.superSector.findFirst({ where: { id: generalSector.superSectorId || '' } });
    console.log('  general sector is in super-sector: ' + (genSS?.name || 'none'));
    console.log('  Description: ' + (generalSector.description || 'n/a'));

    const bPatents = await prisma.patent.findMany({
      where: {
        primarySector: 'general',
        isQuarantined: false,
        portfolios: { some: { portfolioId: portfolio.id } }
      },
      select: { patentId: true }
    });
    const bIds = bPatents.map(p => p.patentId);
    console.log('  Broadcom patents: ' + bIds.length);

    if (bIds.length > 0) {
      const scores = await prisma.patentSubSectorScore.findMany({
        where: { patentId: { in: bIds } },
        select: { compositeScore: true, patentId: true, withClaims: true }
      });
      const bestByPatent = new Map<string, { compositeScore: number; withClaims: boolean }>();
      for (const sc of scores) {
        const existing = bestByPatent.get(sc.patentId);
        if (existing === undefined || sc.compositeScore > existing.compositeScore) {
          bestByPatent.set(sc.patentId, sc);
        }
      }
      const composites = [...bestByPatent.values()].map(sv => sv.compositeScore);
      const avg = composites.length > 0 ? composites.reduce((a, b) => a + b, 0) / composites.length : 0;
      const top = composites.length > 0 ? Math.max(...composites) : 0;
      const gt45 = composites.filter(v => v >= 45).length;
      const gt50 = composites.filter(v => v >= 50).length;
      const gt60 = composites.filter(v => v >= 60).length;
      const gt70 = composites.filter(v => v >= 70).length;
      console.log('  Scored: ' + bestByPatent.size);
      console.log('  Avg: ' + avg.toFixed(1) + ' | Top: ' + top.toFixed(1));
      console.log('  >45: ' + gt45 + ' | >50: ' + gt50 + ' | >60: ' + gt60 + ' | >70: ' + gt70);

      // Top 10 general patents
      const sorted = [...bestByPatent.entries()].sort((a, b) => b[1].compositeScore - a[1].compositeScore);
      const topIds = sorted.slice(0, 10).map(([id]) => id);
      const details = await prisma.patent.findMany({
        where: { patentId: { in: topIds } },
        select: { patentId: true, title: true, assignee: true }
      });
      const detMap = new Map(details.map(p => [p.patentId, p]));
      console.log('  Top 10:');
      for (const [id, sc] of sorted.slice(0, 10)) {
        const d = detMap.get(id);
        console.log('    ' + sc.compositeScore.toFixed(1) + ' | ' + id + ' | ' + (d?.assignee || '').substring(0, 25).padEnd(25) + ' | ' + (d?.title || '').substring(0, 55));
      }
    }
  } else {
    console.log('  "general" sector not found in DB');
  }

  await prisma.$disconnect();
}

main().catch(err => { console.error(err); process.exit(1); });
