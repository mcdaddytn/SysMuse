/**
 * Create Nutanix Litigation Focus Area
 *
 * 1. Adds Densify/Cirba patents (8209687, 9654367) to DB + broadcom-core portfolio
 * 2. Creates consolidated "Nutanix Litigation Targets" focus area with all 37 patents
 * 3. Creates sub-focus areas:
 *    - Tier 1 Crown Jewels (>=0.80 infringement score)
 *    - Tier 2 Strong Signal (>=0.50)
 *    - Densify/Cirba Cross-Assert (VMware precedent patents)
 *
 * Usage: npx tsx scripts/create-nutanix-litigation-focus-area.ts [--dry-run]
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const OWNER_ID = 'default-user';
const BROADCOM_PORTFOLIO_NAME = 'broadcom-core';

// All 37 patents from the Nutanix litigation package, with max infringement scores
const NUTANIX_PATENTS: Array<{
  patentId: string;
  title: string;
  maxScore: number;
  bestProduct: string;
  isDensify: boolean;
  superSector: string;
}> = [
  { patentId: '8966035', title: 'Method and apparatus for implementing and managing distributed virtual switches in several hosts and physical forwarding elements', maxScore: 0.940, bestProduct: 'Flow Network Security', isDensify: false, superSector: 'NETWORKING' },
  { patentId: '8291159', title: 'Monitoring and updating mapping of physical storage allocation of virtual machine without changing identifier of the storage volume assigned to virtual machine', maxScore: 0.938, bestProduct: 'Nutanix Prism Central', isDensify: false, superSector: 'COMPUTING' },
  { patentId: '9785455', title: 'Logical router', maxScore: 0.919, bestProduct: 'Flow Network Security', isDensify: false, superSector: 'NETWORKING' },
  { patentId: '11811859', title: 'High availability management for a hierarchy of resources in an SDDC', maxScore: 0.915, bestProduct: 'Nutanix Cloud Infrastructure (NCI)', isDensify: false, superSector: 'NETWORKING' },
  { patentId: '10103939', title: 'Network control apparatus and method for populating logical datapath sets', maxScore: 0.913, bestProduct: 'Flow Virtual Networking', isDensify: false, superSector: 'NETWORKING' },
  { patentId: '7603670', title: 'Virtual machine transfer between computer systems', maxScore: 0.911, bestProduct: 'Nutanix Cloud Infrastructure (NCI)', isDensify: false, superSector: 'COMPUTING' },
  { patentId: '8886705', title: 'Goal-oriented storage management for a distributed data storage network', maxScore: 0.909, bestProduct: 'Nutanix AHV', isDensify: false, superSector: 'COMPUTING' },
  { patentId: '7945436', title: 'Pass-through and emulation in a virtual machine environment', maxScore: 0.867, bestProduct: 'Nutanix Prism Central', isDensify: false, superSector: 'COMPUTING' },
  { patentId: '7412702', title: 'System software displacement in a virtual computer system', maxScore: 0.856, bestProduct: 'Nutanix Cloud Infrastructure (NCI)', isDensify: false, superSector: 'COMPUTING' },
  { patentId: '10700996', title: 'Logical router with multiple routing components', maxScore: 0.814, bestProduct: 'Flow Network Security', isDensify: false, superSector: 'NETWORKING' },
  { patentId: '10375121', title: 'Micro-segmentation in virtualized computing environments', maxScore: 0.800, bestProduct: 'Flow Virtual Networking', isDensify: false, superSector: 'SECURITY' },
  { patentId: '7853744', title: 'Handling interrupts when virtual machines have direct access to a hardware device', maxScore: 0.799, bestProduct: 'Flow Network Security', isDensify: false, superSector: 'COMPUTING' },
  { patentId: '9654367', title: 'System and method for determining and visualizing efficiencies and risks in computing environments', maxScore: 0.785, bestProduct: 'Nutanix Prism Central', isDensify: true, superSector: 'COMPUTING' },
  { patentId: '7533229', title: 'Disaster recovery and backup using virtual machines', maxScore: 0.743, bestProduct: 'Nutanix AHV', isDensify: false, superSector: 'COMPUTING' },
  { patentId: '8209687', title: 'Method and system for evaluating virtualized environments', maxScore: 0.698, bestProduct: 'Nutanix Prism Central', isDensify: true, superSector: 'COMPUTING' },
  { patentId: '11343283', title: 'Multi-tenant network virtualization infrastructure', maxScore: 0.636, bestProduct: 'Nutanix AHV', isDensify: false, superSector: 'SECURITY' },
  { patentId: '7783779', title: 'Storage multipath management in a virtual computer system', maxScore: 0.442, bestProduct: 'Nutanix AHV', isDensify: false, superSector: 'COMPUTING' },
  { patentId: '9760443', title: 'Using a recovery snapshot during live migration', maxScore: 0.368, bestProduct: 'Nutanix AHV', isDensify: false, superSector: 'COMPUTING' },
  { patentId: '8104083', title: 'Virtual machine file system content protection system and method', maxScore: 0.351, bestProduct: 'Nutanix AHV', isDensify: false, superSector: 'SECURITY' },
  { patentId: '11726807', title: 'Safe execution of virtual machine callbacks in a hypervisor', maxScore: 0.300, bestProduct: 'Nutanix AHV', isDensify: false, superSector: 'SECURITY' },
  { patentId: '8825591', title: 'Dynamic storage mechanism', maxScore: 0.285, bestProduct: 'Nutanix Cloud Infrastructure (NCI)', isDensify: false, superSector: 'COMPUTING' },
  { patentId: '9952887', title: 'Device simulation in a secure mode supported by hardware architectures', maxScore: 0.265, bestProduct: 'Nutanix AHV', isDensify: false, superSector: 'SECURITY' },
  { patentId: '8635493', title: 'High availability system allowing conditionally reserved computing resource use and reclamation upon a failover', maxScore: 0.261, bestProduct: 'Nutanix AHV', isDensify: false, superSector: 'COMPUTING' },
  { patentId: '11436112', title: 'Remote direct memory access (RDMA)-based recovery of dirty data in remote memory', maxScore: 0.245, bestProduct: 'Nutanix Cloud Infrastructure (NCI)', isDensify: false, superSector: 'COMPUTING' },
  { patentId: '11422840', title: 'Partitioning a hypervisor into virtual hypervisors', maxScore: 0.239, bestProduct: 'Nutanix AHV', isDensify: false, superSector: 'COMPUTING' },
  { patentId: '8763115', title: 'Impeding progress of malicious guest software', maxScore: 0.192, bestProduct: 'Nutanix AHV', isDensify: false, superSector: 'SECURITY' },
  { patentId: '8387046', title: 'Security driver for hypervisors and operating systems of virtualized datacenters', maxScore: 0.190, bestProduct: 'Nutanix AHV', isDensify: false, superSector: 'SECURITY' },
  { patentId: '9077664', title: 'One-hop packet processing in a network with managed switching elements', maxScore: 0.175, bestProduct: 'Nutanix AHV', isDensify: false, superSector: 'NETWORKING' },
  { patentId: '12086084', title: 'IOMMU-based direct memory access (DMA) tracking for enabling live migration of virtual machines (VMS) using passthrough physical devices', maxScore: 0.175, bestProduct: 'Nutanix AHV', isDensify: false, superSector: 'COMPUTING' },
  { patentId: '8966623', title: 'Managing execution of a running-page in a virtual machine', maxScore: 0.174, bestProduct: 'Nutanix AHV', isDensify: false, superSector: 'SECURITY' },
  { patentId: '11182196', title: 'Unified resource management for containers and virtual machines', maxScore: 0.172, bestProduct: 'Nutanix AHV', isDensify: false, superSector: 'COMPUTING' },
  { patentId: '11693952', title: 'System and method for providing secure execution environments using virtualization technology', maxScore: 0.137, bestProduct: 'Nutanix AHV', isDensify: false, superSector: 'SECURITY' },
  { patentId: '10592267', title: 'Tree structure for storing monitored memory page data', maxScore: 0.120, bestProduct: 'Nutanix AHV', isDensify: false, superSector: 'SECURITY' },
  { patentId: '10942759', title: 'Seamless virtual standard switch to virtual distributed switch migration for hyper-converged infrastructure', maxScore: 0.070, bestProduct: 'Nutanix Prism Central', isDensify: false, superSector: 'NETWORKING' },
  { patentId: '11201808', title: 'Tracing logical network packets through physical network', maxScore: 0.070, bestProduct: 'Nutanix Prism Central', isDensify: false, superSector: 'NETWORKING' },
  { patentId: '11637833', title: 'Unified workspace for thin, remote, and SAAS applications', maxScore: 0.060, bestProduct: 'Nutanix AHV', isDensify: false, superSector: 'SECURITY' },
  { patentId: '11917083', title: 'Automated methods and systems for performing host attestation using a smart network interface controller', maxScore: 0.020, bestProduct: 'Nutanix Cloud Infrastructure (NCI)', isDensify: false, superSector: 'SECURITY' },
];

// Densify patent metadata for DB insertion
const DENSIFY_PATENTS = [
  {
    patentId: '9654367',
    title: 'System and method for determining and visualizing efficiencies and risks in computing environments',
    assignee: 'Densify (f/k/a Cirba Inc.)',
    grantDate: '2017-05-23',
    filingDate: '2013-10-29',
    primaryCpc: 'H04L43/08',
    superSector: 'COMPUTING',
    primarySector: 'computing-runtime',
  },
  {
    patentId: '8209687',
    title: 'Method and system for evaluating virtualized environments',
    assignee: 'Densify (f/k/a Cirba Inc.)',
    grantDate: '2012-06-26',
    filingDate: '2008-08-05',
    primaryCpc: 'G06F9/455',
    superSector: 'COMPUTING',
    primarySector: 'computing-runtime',
  },
];

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  console.log(`\nCreating Nutanix Litigation Focus Area${dryRun ? ' (DRY RUN)' : ''}...\n`);

  // ── Step 1: Get broadcom-core portfolio ──
  const portfolio = await prisma.portfolio.findUnique({ where: { name: BROADCOM_PORTFOLIO_NAME } });
  if (!portfolio) throw new Error(`Portfolio "${BROADCOM_PORTFOLIO_NAME}" not found`);
  console.log(`Portfolio: ${portfolio.id} (${BROADCOM_PORTFOLIO_NAME})`);

  // ── Step 2: Add Densify patents to DB if missing ──
  for (const dp of DENSIFY_PATENTS) {
    const existing = await prisma.patent.findUnique({ where: { patentId: dp.patentId } });
    if (existing) {
      console.log(`Patent ${dp.patentId} already in DB (${existing.assignee})`);
    } else {
      console.log(`Adding patent ${dp.patentId} to DB: "${dp.title}"`);
      if (!dryRun) {
        // Calculate remaining years (20 years from filing for utility patents)
        const filingYear = parseInt(dp.filingDate.split('-')[0]);
        const expiryYear = filingYear + 20;
        const remainingYears = Math.max(0, expiryYear - 2026 + (parseInt(dp.filingDate.split('-')[1]) / 12));
        const patentIdNumeric = parseInt(dp.patentId);

        await prisma.patent.create({
          data: {
            patentId: dp.patentId,
            title: dp.title,
            assignee: dp.assignee,
            affiliate: 'Densify',
            grantDate: dp.grantDate,
            filingDate: dp.filingDate,
            primaryCpc: dp.primaryCpc,
            superSector: dp.superSector,
            primarySector: dp.primarySector,
            remainingYears,
            isExpired: remainingYears <= 0,
            patentIdNumeric,
            hasXmlData: true,
          },
        });
        console.log(`  Created patent record (remaining years: ${remainingYears.toFixed(1)})`);
      }
    }

    // Add to broadcom-core portfolio if not already there
    const inPortfolio = await prisma.portfolioPatent.findFirst({
      where: { portfolioId: portfolio.id, patentId: dp.patentId },
    });
    if (inPortfolio) {
      console.log(`  Patent ${dp.patentId} already in broadcom-core portfolio`);
    } else {
      console.log(`  Adding patent ${dp.patentId} to broadcom-core portfolio`);
      if (!dryRun) {
        await prisma.portfolioPatent.create({
          data: {
            portfolioId: portfolio.id,
            patentId: dp.patentId,
            source: 'MANUAL',
          },
        });
      }
    }
  }

  // ── Step 3: Verify all 37 patents are now in DB ──
  const allPatentIds = NUTANIX_PATENTS.map(p => p.patentId);
  const dbPatents = await prisma.patent.findMany({
    where: { patentId: { in: allPatentIds } },
    select: { patentId: true },
  });
  const dbPatentIds = new Set(dbPatents.map(p => p.patentId));
  const stillMissing = allPatentIds.filter(id => !dbPatentIds.has(id));
  if (stillMissing.length > 0) {
    console.error(`\nERROR: Still missing from DB: ${stillMissing.join(', ')}`);
    if (!dryRun) {
      await prisma.$disconnect();
      process.exit(1);
    }
  } else {
    console.log(`\nAll ${allPatentIds.length} patents confirmed in DB`);
  }

  if (dryRun) {
    console.log('\n--- DRY RUN: Focus area creation preview ---');
  }

  // ── Step 4: Create parent focus area ──
  const tier1Patents = NUTANIX_PATENTS.filter(p => p.maxScore >= 0.80);
  const tier2Patents = NUTANIX_PATENTS.filter(p => p.maxScore >= 0.50 && p.maxScore < 0.80);
  const densifyPatents = NUTANIX_PATENTS.filter(p => p.isDensify);

  console.log(`\nParent FA: ${allPatentIds.length} patents`);
  console.log(`  Tier 1 (>=0.80): ${tier1Patents.length} patents`);
  console.log(`  Tier 2 (0.50-0.79): ${tier2Patents.length} patents`);
  console.log(`  Densify/Cirba: ${densifyPatents.length} patents`);

  if (dryRun) {
    console.log('\nDry run complete — no focus areas created.');
    await prisma.$disconnect();
    return;
  }

  // Check for existing parent to avoid duplicates
  const existingParent = await prisma.focusArea.findFirst({
    where: { name: 'Nutanix Litigation Targets' },
  });
  if (existingParent) {
    console.log(`\nWARNING: "Nutanix Litigation Targets" already exists (${existingParent.id}). Skipping creation.`);
    console.log('Delete it first if you want to recreate.');
    await prisma.$disconnect();
    return;
  }

  const parentFA = await prisma.focusArea.create({
    data: {
      name: 'Nutanix Litigation Targets',
      description: `All ${allPatentIds.length} broadcom-core patents scored against Nutanix products. 11 patents >=0.80, 15 patents >=0.65. Max score 0.940 (US8966035). Includes 2 Densify/Cirba patents previously asserted vs VMware ($236M verdict). Products: AHV, NCI, Flow Network Security, Flow Virtual Networking, Prism Central.`,
      ownerId: OWNER_ID,
      status: 'ACTIVE',
      patentCount: allPatentIds.length,
    },
  });
  console.log(`\nCreated parent FA: ${parentFA.id}`);

  // Add all patents to parent
  await prisma.focusAreaPatent.createMany({
    data: allPatentIds.map(patentId => ({
      focusAreaId: parentFA.id,
      patentId,
      membershipType: 'MANUAL' as const,
    })),
  });

  // ── Step 5: Create sub-focus areas ──

  // Tier 1: Crown Jewels (>=0.80)
  const tier1FA = await prisma.focusArea.create({
    data: {
      name: 'Nutanix Tier 1 — Crown Jewels (>=0.80)',
      description: `${tier1Patents.length} patents with infringement score >=0.80 against Nutanix products. These represent the strongest assertion candidates with clear technical overlap.`,
      ownerId: OWNER_ID,
      parentId: parentFA.id,
      status: 'ACTIVE',
      patentCount: tier1Patents.length,
    },
  });
  await prisma.focusAreaPatent.createMany({
    data: tier1Patents.map(p => ({
      focusAreaId: tier1FA.id,
      patentId: p.patentId,
      membershipType: 'MANUAL' as const,
      matchScore: p.maxScore,
    })),
  });
  console.log(`  Created Tier 1: ${tier1FA.id} (${tier1Patents.length} patents)`);

  // Tier 2: Strong Signal (0.50-0.79)
  const tier2FA = await prisma.focusArea.create({
    data: {
      name: 'Nutanix Tier 2 — Strong Signal (0.50-0.79)',
      description: `${tier2Patents.length} patents with infringement score 0.50-0.79 against Nutanix products. Good assertion candidates that may benefit from additional documentation or claim chart development.`,
      ownerId: OWNER_ID,
      parentId: parentFA.id,
      status: 'ACTIVE',
      patentCount: tier2Patents.length,
    },
  });
  await prisma.focusAreaPatent.createMany({
    data: tier2Patents.map(p => ({
      focusAreaId: tier2FA.id,
      patentId: p.patentId,
      membershipType: 'MANUAL' as const,
      matchScore: p.maxScore,
    })),
  });
  console.log(`  Created Tier 2: ${tier2FA.id} (${tier2Patents.length} patents)`);

  // Densify/Cirba Cross-Assert
  const densifyFA = await prisma.focusArea.create({
    data: {
      name: 'Nutanix — Densify/Cirba Cross-Assert',
      description: `${densifyPatents.length} Densify/Cirba patents (now Broadcom IP via VMware acquisition) previously asserted against VMware in $236M verdict. Scored against Nutanix: US9654367 (0.785 vs Prism Central), US8209687 (0.698 vs Prism Central). Strong precedent for Nutanix assertion.`,
      ownerId: OWNER_ID,
      parentId: parentFA.id,
      status: 'ACTIVE',
      patentCount: densifyPatents.length,
    },
  });
  await prisma.focusAreaPatent.createMany({
    data: densifyPatents.map(p => ({
      focusAreaId: densifyFA.id,
      patentId: p.patentId,
      membershipType: 'MANUAL' as const,
      matchScore: p.maxScore,
    })),
  });
  console.log(`  Created Densify/Cirba: ${densifyFA.id} (${densifyPatents.length} patents)`);

  // ── Summary ──
  console.log('\n=== Summary ===');
  console.log(`Parent: ${parentFA.id} — ${allPatentIds.length} patents`);
  console.log(`  Tier 1 Crown Jewels: ${tier1FA.id} — ${tier1Patents.length} patents`);
  console.log(`  Tier 2 Strong Signal: ${tier2FA.id} — ${tier2Patents.length} patents`);
  console.log(`  Densify/Cirba: ${densifyFA.id} — ${densifyPatents.length} patents`);

  await prisma.$disconnect();
}

main().catch(err => {
  console.error('Focus area creation failed:', err);
  process.exit(1);
});
