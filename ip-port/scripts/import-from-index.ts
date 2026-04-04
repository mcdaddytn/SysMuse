/**
 * Import patents from USPTO index database.
 * Single-step import — no hydration needed.
 *
 * Usage:
 *   npx tsx scripts/import-from-index.ts --portfolio broadcom-core
 *   npx tsx scripts/import-from-index.ts --portfolio nutanix-all --max 1000
 */
import 'dotenv/config';
import { importPatents } from '../src/api/services/uspto-import-service.js';
import { disconnectUsptoPrisma } from '../src/lib/uspto-prisma.js';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const args = process.argv.slice(2);
  const portfolioName = args.includes('--portfolio')
    ? args[args.indexOf('--portfolio') + 1]
    : null;
  const maxPatents = args.includes('--max')
    ? parseInt(args[args.indexOf('--max') + 1])
    : 50000;

  if (!portfolioName) {
    console.error('Usage: npx tsx scripts/import-from-index.ts --portfolio <name> [--max N]');
    console.error('\nAvailable portfolios:');
    const portfolios = await prisma.portfolio.findMany({
      select: { name: true, displayName: true, patentCount: true },
      orderBy: { name: 'asc' },
    });
    for (const p of portfolios) {
      console.error(`  ${p.name} (${p.displayName}) — ${p.patentCount} patents`);
    }
    await prisma.$disconnect();
    process.exit(1);
  }

  try {
    const result = await importPatents({
      portfolioName,
      maxPatents,
      onProgress: (msg) => console.log(msg),
    });

    process.exit(result.failed > 0 ? 1 : 0);
  } finally {
    await disconnectUsptoPrisma();
    await prisma.$disconnect();
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
