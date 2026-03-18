import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function evalSuperSector(ssName: string, portfolio: { id: string }) {
  const ss = await prisma.superSector.findFirst({ where: { name: ssName } });
  if (ss === null) { console.log(`Super-sector ${ssName} not found`); return; }

  const sectors = await prisma.sector.findMany({
    where: { superSectorId: ss.id },
    select: { name: true, displayName: true, description: true },
    orderBy: { name: 'asc' }
  });

  console.log(`\n${'='.repeat(60)}`);
  console.log(`=== ${ssName} Super-Sector - Detailed Breakdown ===`);
  console.log(`=== ${sectors.length} sectors found ===`);
  console.log(`${'='.repeat(60)}\n`);

  const results: Array<{ name: string; display: string; count: number; scored: number; avg: number; top: number; gt45: number; gt50: number; gt55: number; gt60: number; gt65: number; gt70: number }> = [];

  for (const s of sectors) {
    const bPatents = await prisma.patent.findMany({
      where: {
        primarySector: s.name,
        superSector: ssName,
        isQuarantined: false,
        portfolios: { some: { portfolioId: portfolio.id } }
      },
      select: { patentId: true }
    });
    const bIds = bPatents.map(p => p.patentId);
    if (bIds.length === 0) {
      console.log('--- ' + s.name + ' --- (0 broadcom patents, skipping)');
      continue;
    }

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
    const gt55 = composites.filter(v => v >= 55).length;
    const gt60 = composites.filter(v => v >= 60).length;
    const gt65 = composites.filter(v => v >= 65).length;
    const gt70 = composites.filter(v => v >= 70).length;
    const withClaims = [...bestByPatent.values()].filter(sv => sv.withClaims).length;

    results.push({ name: s.name, display: s.displayName || s.name, count: bIds.length, scored: bestByPatent.size, avg, top, gt45, gt50, gt55, gt60, gt65, gt70 });

    console.log('--- ' + s.name + ' ---');
    console.log('  Display: ' + s.displayName);
    console.log('  Description: ' + (s.description || 'n/a'));
    console.log('  Broadcom patents: ' + bIds.length + ' | Scored: ' + bestByPatent.size + ' | With claims: ' + withClaims);
    console.log('  Avg: ' + avg.toFixed(1) + ' | Top: ' + top.toFixed(1));
    console.log('  >45: ' + gt45 + ' | >50: ' + gt50 + ' | >55: ' + gt55 + ' | >60: ' + gt60 + ' | >65: ' + gt65 + ' | >70: ' + gt70);

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

  // Summary ranking
  console.log('\n--- SUMMARY RANKING (by avg score) ---');
  results.sort((a, b) => b.avg - a.avg);
  console.log('  ' + 'Sector'.padEnd(35) + 'Patents'.padStart(8) + 'Avg'.padStart(7) + 'Top'.padStart(7) + '>45'.padStart(6) + '>50'.padStart(6) + '>55'.padStart(6) + '>60'.padStart(6) + '>65'.padStart(6) + '>70'.padStart(6));
  for (const r of results) {
    console.log('  ' + r.name.padEnd(35) + String(r.count).padStart(8) + r.avg.toFixed(1).padStart(7) + r.top.toFixed(1).padStart(7) + String(r.gt45).padStart(6) + String(r.gt50).padStart(6) + String(r.gt55).padStart(6) + String(r.gt60).padStart(6) + String(r.gt65).padStart(6) + String(r.gt70).padStart(6));
  }
}

async function main() {
  const portfolio = await prisma.portfolio.findUnique({ where: { name: 'broadcom-core' } });
  if (portfolio === null) { console.log('Portfolio not found'); return; }

  const superSectors = process.argv.slice(2);
  if (superSectors.length === 0) {
    console.log('Usage: npx tsx scripts/eval-super-sectors.ts NETWORKING SECURITY [...]');
    const allSS = await prisma.superSector.findMany({ select: { name: true }, orderBy: { name: 'asc' } });
    console.log('Available super-sectors: ' + allSS.map(s => s.name).join(', '));
    return;
  }

  for (const ss of superSectors) {
    await evalSuperSector(ss, portfolio);
  }

  await prisma.$disconnect();
}

main().catch(err => { console.error(err); process.exit(1); });
