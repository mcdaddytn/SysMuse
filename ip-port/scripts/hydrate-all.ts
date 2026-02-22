/**
 * Hydrate all portfolios with incomplete patent data.
 * Processes smallest portfolios first.
 *
 * Usage: npx tsx scripts/hydrate-all.ts
 */

import { PrismaClient } from '@prisma/client';
import { hydratePortfolio } from '../src/api/services/patent-hydration-service.js';

const prisma = new PrismaClient();

async function main() {
  // Get portfolios ordered by incomplete patent count (smallest first)
  const portfolios = await prisma.$queryRaw<Array<{
    id: string;
    name: string;
    display_name: string;
    incomplete: bigint;
    total: bigint;
  }>>`
    SELECT p.id, p.name, p.display_name,
      COUNT(CASE WHEN pat.abstract IS NULL OR pat.remaining_years IS NULL
            OR pat.filing_date IS NULL OR pat.base_score IS NULL THEN 1 END) as incomplete,
      COUNT(pp.patent_id) as total
    FROM portfolios p
    JOIN portfolio_patents pp ON pp.portfolio_id = p.id
    JOIN patents pat ON pat.patent_id = pp.patent_id
    GROUP BY p.id, p.name, p.display_name
    HAVING COUNT(CASE WHEN pat.abstract IS NULL OR pat.remaining_years IS NULL
           OR pat.filing_date IS NULL OR pat.base_score IS NULL THEN 1 END) > 0
    ORDER BY COUNT(CASE WHEN pat.abstract IS NULL OR pat.remaining_years IS NULL
             OR pat.filing_date IS NULL OR pat.base_score IS NULL THEN 1 END) ASC
  `;

  console.log(`\n=== Hydrating ${portfolios.length} portfolios ===\n`);

  let totalHydrated = 0;
  let totalFailed = 0;

  for (let i = 0; i < portfolios.length; i++) {
    const p = portfolios[i];
    const incomplete = Number(p.incomplete);
    const total = Number(p.total);
    console.log(`\n[${i + 1}/${portfolios.length}] ${p.display_name} — ${incomplete} incomplete / ${total} total`);
    const start = Date.now();

    try {
      const result = await hydratePortfolio(p.id, { force: false });
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      const perPatent = result.hydrated > 0 ? ((Date.now() - start) / result.hydrated).toFixed(0) : '—';
      console.log(`  ✓ ${result.hydrated} hydrated, ${result.alreadyComplete} already complete, ${result.notFound} not found (${elapsed}s, ~${perPatent}ms/patent)`);
      if (result.failedIds.length > 0) {
        console.log(`  ⚠ Failed IDs: ${result.failedIds.slice(0, 10).join(', ')}${result.failedIds.length > 10 ? ` (+${result.failedIds.length - 10} more)` : ''}`);
      }
      totalHydrated += result.hydrated;
      totalFailed += result.failedIds.length;
    } catch (err) {
      console.error(`  ✗ Error:`, (err as Error).message);
    }
  }

  console.log(`\n=== Complete: ${totalHydrated} hydrated, ${totalFailed} failed ===\n`);
  await prisma.$disconnect();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
