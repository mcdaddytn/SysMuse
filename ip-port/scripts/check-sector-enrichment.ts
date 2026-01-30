import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';

const db = new PrismaClient();

async function main() {
  // Get all super-sectors and their patent counts
  const sectors = await db.$queryRaw<{superSector: string, count: bigint}[]>`
    SELECT "super_sector" as "superSector", COUNT(*) as count
    FROM patents
    WHERE "super_sector" IS NOT NULL
    GROUP BY "super_sector"
    ORDER BY count DESC
  `;

  console.log("=== Super-Sector Enrichment Summary (Top 500 per sector) ===\n");
  console.log("Sector                       | Total | LLM      | Pros     | IPR");
  console.log("─────────────────────────────┼───────┼──────────┼──────────┼──────────");

  for (const sector of sectors) {
    const patents = await db.patent.findMany({
      where: { superSector: sector.superSector },
      select: { patentNumber: true },
      orderBy: { baseScoreV1: 'desc' },
      take: 500  // Check top 500 per sector
    });

    const pnums = patents.map(p => p.patentNumber);
    const checked = pnums.length;
    const llm = pnums.filter(pn => fs.existsSync(`cache/llm-scores/${pn}.json`)).length;
    const pros = pnums.filter(pn => fs.existsSync(`cache/prosecution-scores/${pn}.json`)).length;
    const ipr = pnums.filter(pn => fs.existsSync(`cache/ipr-scores/${pn}.json`)).length;

    const name = sector.superSector.padEnd(28);
    const total = String(sector.count).padStart(5);
    const llmStr = `${llm} (${(llm/checked*100).toFixed(0)}%)`.padStart(8);
    const prosStr = `${pros} (${(pros/checked*100).toFixed(0)}%)`.padStart(8);
    const iprStr = `${ipr} (${(ipr/checked*100).toFixed(0)}%)`.padStart(8);

    console.log(`${name} | ${total} | ${llmStr} | ${prosStr} | ${iprStr}`);
  }

  await db.$disconnect();
}

main().catch(console.error);
