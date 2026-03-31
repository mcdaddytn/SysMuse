/**
 * Migration Script: v1 → v2 Schema
 *
 * Migrates from hardcoded SuperSector/Sector/SubSector to abstract TaxonomyType/TaxonomyNode.
 *
 * Steps:
 * 1. Apply schema changes (new tables)
 * 2. Create TaxonomyType for current CPC-based patent taxonomy
 * 3. Migrate SuperSector → TaxonomyNode (level=1)
 * 4. Migrate Sector → TaxonomyNode (level=2)
 * 5. Migrate SubSector → TaxonomyNode (level=3)
 * 6. Migrate SectorRule → TaxonomyRule
 * 7. Create default PortfolioGroup with all portfolios
 * 8. Populate ObjectClassification from patent→sector assignments
 * 9. Sync pragmatic fields on Patent (primaryLevel1, etc.)
 *
 * Usage:
 *   npx ts-node scripts/migrate-to-v2-schema.ts [--dry-run] [--step=N]
 *
 * Options:
 *   --dry-run    Show what would be done without making changes
 *   --step=N     Run only step N (1-9)
 *   --skip-schema Skip schema application (if already applied)
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Parse command line args
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const skipSchema = args.includes('--skip-schema');
const stepArg = args.find(a => a.startsWith('--step='));
const onlyStep = stepArg ? parseInt(stepArg.split('=')[1]) : null;

// Migration state
interface MigrationState {
  taxonomyTypeId: string | null;
  defaultPortfolioGroupId: string | null;
  nodeIdMap: Map<string, string>; // oldId → newNodeId
  ruleIdMap: Map<string, string>; // oldRuleId → newRuleId
  stats: {
    taxonomyTypes: number;
    nodesCreated: number;
    rulesCreated: number;
    portfolioGroupsCreated: number;
    membersCreated: number;
    classificationsCreated: number;
    patentsUpdated: number;
  };
}

const state: MigrationState = {
  taxonomyTypeId: null,
  defaultPortfolioGroupId: null,
  nodeIdMap: new Map(),
  ruleIdMap: new Map(),
  stats: {
    taxonomyTypes: 0,
    nodesCreated: 0,
    rulesCreated: 0,
    portfolioGroupsCreated: 0,
    membersCreated: 0,
    classificationsCreated: 0,
    patentsUpdated: 0,
  },
};

function log(message: string, indent = 0) {
  const prefix = '  '.repeat(indent);
  console.log(`${prefix}${message}`);
}

function logStep(step: number, name: string) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Step ${step}: ${name}`);
  console.log('='.repeat(60));
}

// Helper to check if a table exists
async function tableExists(tableName: string): Promise<boolean> {
  const result = await prisma.$queryRaw<{ exists: boolean }[]>`
    SELECT EXISTS (
      SELECT FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_name = ${tableName}
    ) as exists
  `;
  return result[0]?.exists ?? false;
}

// Track which new tables exist (for dry-run mode)
let newTablesExist = false;

// =============================================================================
// Step 1: Apply Schema Changes
// =============================================================================

async function step1_applySchema(): Promise<void> {
  logStep(1, 'Apply Schema Changes');

  if (skipSchema) {
    log('Skipping schema application (--skip-schema flag)');
    return;
  }

  log('Checking if new tables exist...');

  // Check if taxonomy_types table exists
  newTablesExist = await tableExists('taxonomy_types');

  if (newTablesExist) {
    log('New tables already exist, skipping schema application');
    return;
  }

  if (dryRun) {
    log('[DRY RUN] Would apply schema changes via prisma db push');
    return;
  }

  log('Applying schema changes...');
  log('Run: npx prisma db push --schema prisma/schema-v2.prisma');
  log('');
  log('NOTE: This script assumes you have already applied the schema.');
  log('      Run the above command first, then re-run this script with --skip-schema');
  process.exit(1);
}

// =============================================================================
// Step 2: Create TaxonomyType
// =============================================================================

async function step2_createTaxonomyType(): Promise<void> {
  logStep(2, 'Create TaxonomyType for CPC-based Patent Taxonomy');

  // In dry-run mode without new tables, just log what would happen
  if (dryRun && !newTablesExist) {
    log('[DRY RUN] Would create TaxonomyType: patent-cpc-tech');
    state.taxonomyTypeId = 'dry-run-taxonomy-type-id';
    state.stats.taxonomyTypes = 1;
    return;
  }

  // Check if already exists (only if table exists)
  if (newTablesExist) {
    const existing = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM taxonomy_types WHERE name = 'patent-cpc-tech' LIMIT 1
    `;

    if (existing.length > 0) {
      state.taxonomyTypeId = existing[0].id;
      log(`TaxonomyType already exists: ${state.taxonomyTypeId}`);
      return;
    }
  }

  if (dryRun) {
    log('[DRY RUN] Would create TaxonomyType: patent-cpc-tech');
    state.taxonomyTypeId = 'dry-run-taxonomy-type-id';
    state.stats.taxonomyTypes = 1;
    return;
  }

  const id = `tax_cpc_tech_${Date.now()}`;
  await prisma.$executeRaw`
    INSERT INTO taxonomy_types (
      id, name, display_name, description, object_type, max_depth, level_labels,
      rule_type, is_active, is_default, version, created_at, updated_at
    ) VALUES (
      ${id},
      'patent-cpc-tech',
      'Technology Classification',
      'CPC-based technology classification for patents. Levels: Super-Sector, Sector, Sub-Sector.',
      'patent',
      3,
      ARRAY['Super-Sector', 'Sector', 'Sub-Sector'],
      'cpc-based',
      true,
      true,
      1,
      NOW(),
      NOW()
    )
  `;

  state.taxonomyTypeId = id;
  state.stats.taxonomyTypes = 1;
  log(`Created TaxonomyType: ${id}`);
}

// =============================================================================
// Step 3: Migrate SuperSector → TaxonomyNode (level=1)
// =============================================================================

async function step3_migrateSuperSectors(): Promise<void> {
  logStep(3, 'Migrate SuperSector → TaxonomyNode (level=1)');

  if (!state.taxonomyTypeId) {
    throw new Error('TaxonomyType not created yet');
  }

  const superSectors = await prisma.$queryRaw<{
    id: string;
    name: string;
    display_name: string;
    description: string | null;
  }[]>`
    SELECT id, name, display_name, description FROM super_sectors
  `;

  log(`Found ${superSectors.length} super-sectors to migrate`);

  for (const ss of superSectors) {
    // Check if already migrated (only if new tables exist)
    if (newTablesExist) {
      const existing = await prisma.$queryRaw<{ id: string }[]>`
        SELECT id FROM taxonomy_nodes
        WHERE taxonomy_type_id = ${state.taxonomyTypeId}
        AND code = ${ss.name}
        AND level = 1
        LIMIT 1
      `;

      if (existing.length > 0) {
        state.nodeIdMap.set(ss.id, existing[0].id);
        log(`Already migrated: ${ss.name} → ${existing[0].id}`, 1);
        continue;
      }
    }

    if (dryRun) {
      const fakeId = `dry-run-node-${ss.name}`;
      state.nodeIdMap.set(ss.id, fakeId);
      log(`[DRY RUN] Would create node: ${ss.name} (level=1)`, 1);
      state.stats.nodesCreated++;
      continue;
    }

    const nodeId = `node_${ss.name.toLowerCase()}_${Date.now()}`;
    const path = ss.name;

    await prisma.$executeRaw`
      INSERT INTO taxonomy_nodes (
        id, taxonomy_type_id, parent_id, level, path, code, name, description,
        metadata, child_count, object_count, is_active, created_at, updated_at
      ) VALUES (
        ${nodeId},
        ${state.taxonomyTypeId},
        NULL,
        1,
        ${path},
        ${ss.name},
        ${ss.display_name},
        ${ss.description},
        NULL,
        0,
        0,
        true,
        NOW(),
        NOW()
      )
    `;

    state.nodeIdMap.set(ss.id, nodeId);
    state.stats.nodesCreated++;
    log(`Migrated: ${ss.name} → ${nodeId}`, 1);
  }
}

// =============================================================================
// Step 4: Migrate Sector → TaxonomyNode (level=2)
// =============================================================================

async function step4_migrateSectors(): Promise<void> {
  logStep(4, 'Migrate Sector → TaxonomyNode (level=2)');

  if (!state.taxonomyTypeId) {
    throw new Error('TaxonomyType not created yet');
  }

  const sectors = await prisma.$queryRaw<{
    id: string;
    name: string;
    display_name: string;
    description: string | null;
    super_sector_id: string | null;
    cpc_prefixes: string[];
    damages_tier: string | null;
    damages_rating: number | null;
    facets: any;
  }[]>`
    SELECT id, name, display_name, description, super_sector_id,
           cpc_prefixes, damages_tier, damages_rating, facets
    FROM sectors
  `;

  log(`Found ${sectors.length} sectors to migrate`);

  for (const s of sectors) {
    // Get parent node ID
    const parentNodeId = s.super_sector_id ? state.nodeIdMap.get(s.super_sector_id) : null;

    // Check if already migrated (only if new tables exist)
    if (newTablesExist) {
      const existing = await prisma.$queryRaw<{ id: string }[]>`
        SELECT id FROM taxonomy_nodes
        WHERE taxonomy_type_id = ${state.taxonomyTypeId}
        AND code = ${s.name}
        AND level = 2
        LIMIT 1
      `;

      if (existing.length > 0) {
        state.nodeIdMap.set(s.id, existing[0].id);
        log(`Already migrated: ${s.name} → ${existing[0].id}`, 1);
        continue;
      }
    }

    // Build metadata JSON
    const metadata = {
      cpcPrefixes: s.cpc_prefixes || [],
      damagesTier: s.damages_tier,
      damagesRating: s.damages_rating,
      facets: s.facets,
      legacySectorId: s.id,
    };

    // Build path
    let path = s.name;
    if (parentNodeId && newTablesExist) {
      const parentPath = await prisma.$queryRaw<{ path: string }[]>`
        SELECT path FROM taxonomy_nodes WHERE id = ${parentNodeId} LIMIT 1
      `;
      if (parentPath.length > 0) {
        path = `${parentPath[0].path}/${s.name}`;
      }
    } else if (parentNodeId) {
      // In dry-run without tables, construct path from nodeIdMap
      // Parent path would be the super-sector name
      const parentSs = Array.from(state.nodeIdMap.entries()).find(([k, v]) => v === parentNodeId);
      if (parentSs) {
        // Get super-sector name from database
        const ssResult = await prisma.$queryRaw<{ name: string }[]>`
          SELECT name FROM super_sectors WHERE id = ${parentSs[0]} LIMIT 1
        `;
        if (ssResult.length > 0) {
          path = `${ssResult[0].name}/${s.name}`;
        }
      }
    }

    if (dryRun) {
      const fakeId = `dry-run-node-${s.name}`;
      state.nodeIdMap.set(s.id, fakeId);
      log(`[DRY RUN] Would create node: ${s.name} (level=2, parent=${parentNodeId || 'none'})`, 1);
      state.stats.nodesCreated++;
      continue;
    }

    const nodeId = `node_${s.name.replace(/-/g, '_')}_${Date.now()}`;

    await prisma.$executeRaw`
      INSERT INTO taxonomy_nodes (
        id, taxonomy_type_id, parent_id, level, path, code, name, description,
        metadata, child_count, object_count, is_active, created_at, updated_at
      ) VALUES (
        ${nodeId},
        ${state.taxonomyTypeId},
        ${parentNodeId},
        2,
        ${path},
        ${s.name},
        ${s.display_name},
        ${s.description},
        ${JSON.stringify(metadata)}::jsonb,
        0,
        0,
        true,
        NOW(),
        NOW()
      )
    `;

    state.nodeIdMap.set(s.id, nodeId);
    state.stats.nodesCreated++;
    log(`Migrated: ${s.name} → ${nodeId}`, 1);
  }

  // Update child counts for level 1 nodes
  if (!dryRun) {
    await prisma.$executeRaw`
      UPDATE taxonomy_nodes n1
      SET child_count = (
        SELECT COUNT(*) FROM taxonomy_nodes n2 WHERE n2.parent_id = n1.id
      )
      WHERE n1.taxonomy_type_id = ${state.taxonomyTypeId} AND n1.level = 1
    `;
  }
}

// =============================================================================
// Step 5: Migrate SubSector → TaxonomyNode (level=3)
// =============================================================================

async function step5_migrateSubSectors(): Promise<void> {
  logStep(5, 'Migrate SubSector → TaxonomyNode (level=3)');

  if (!state.taxonomyTypeId) {
    throw new Error('TaxonomyType not created yet');
  }

  const subSectors = await prisma.$queryRaw<{
    id: string;
    sector_id: string;
    name: string;
    display_name: string;
    description: string | null;
    grouping_type: string;
    cpc_code: string | null;
    cpc_prefix: string | null;
    date_range_start: string | null;
    date_range_end: string | null;
    status: string;
    patent_count: number;
  }[]>`
    SELECT id, sector_id, name, display_name, description, grouping_type,
           cpc_code, cpc_prefix, date_range_start, date_range_end, status, patent_count
    FROM sub_sectors
  `;

  log(`Found ${subSectors.length} sub-sectors to migrate`);

  let migrated = 0;
  let skipped = 0;

  for (const ss of subSectors) {
    const parentNodeId = state.nodeIdMap.get(ss.sector_id);
    if (!parentNodeId) {
      log(`Skipping ${ss.name}: parent sector not found`, 1);
      skipped++;
      continue;
    }

    // Check if already migrated (only if new tables exist)
    if (newTablesExist) {
      const existing = await prisma.$queryRaw<{ id: string }[]>`
        SELECT id FROM taxonomy_nodes
        WHERE taxonomy_type_id = ${state.taxonomyTypeId}
        AND code = ${ss.name}
        AND level = 3
        LIMIT 1
      `;

      if (existing.length > 0) {
        state.nodeIdMap.set(ss.id, existing[0].id);
        skipped++;
        continue;
      }
    }

    // Build metadata JSON
    const metadata = {
      groupingType: ss.grouping_type,
      cpcCode: ss.cpc_code,
      cpcPrefix: ss.cpc_prefix,
      dateRangeStart: ss.date_range_start,
      dateRangeEnd: ss.date_range_end,
      legacyStatus: ss.status,
      legacySubSectorId: ss.id,
    };

    // Build path - need to construct from parent info in dry-run mode
    let path = ss.name;
    if (newTablesExist) {
      const parentPath = await prisma.$queryRaw<{ path: string }[]>`
        SELECT path FROM taxonomy_nodes WHERE id = ${parentNodeId} LIMIT 1
      `;
      if (parentPath.length > 0) {
        path = `${parentPath[0].path}/${ss.name}`;
      }
    } else {
      // In dry-run without tables, try to construct path from sector data
      const sectorResult = await prisma.$queryRaw<{ name: string; super_sector_id: string | null }[]>`
        SELECT name, super_sector_id FROM sectors WHERE id = ${ss.sector_id} LIMIT 1
      `;
      if (sectorResult.length > 0) {
        const sectorName = sectorResult[0].name;
        if (sectorResult[0].super_sector_id) {
          const ssResult = await prisma.$queryRaw<{ name: string }[]>`
            SELECT name FROM super_sectors WHERE id = ${sectorResult[0].super_sector_id} LIMIT 1
          `;
          if (ssResult.length > 0) {
            path = `${ssResult[0].name}/${sectorName}/${ss.name}`;
          }
        } else {
          path = `${sectorName}/${ss.name}`;
        }
      }
    }

    if (dryRun) {
      const fakeId = `dry-run-node-${ss.name}`;
      state.nodeIdMap.set(ss.id, fakeId);
      state.stats.nodesCreated++;
      migrated++;
      continue;
    }

    const nodeId = `node_ss_${ss.name.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 30)}_${Date.now()}`;

    // Use path as code to ensure uniqueness (same CPC code can be in multiple sectors)
    const uniqueCode = path;

    await prisma.$executeRaw`
      INSERT INTO taxonomy_nodes (
        id, taxonomy_type_id, parent_id, level, path, code, name, description,
        metadata, child_count, object_count, is_active, created_at, updated_at
      ) VALUES (
        ${nodeId},
        ${state.taxonomyTypeId},
        ${parentNodeId},
        3,
        ${path},
        ${uniqueCode},
        ${ss.display_name},
        ${ss.description},
        ${JSON.stringify(metadata)}::jsonb,
        0,
        ${ss.patent_count},
        ${ss.status === 'APPLIED'},
        NOW(),
        NOW()
      )
    `;

    state.nodeIdMap.set(ss.id, nodeId);
    state.stats.nodesCreated++;
    migrated++;

    if (migrated % 1000 === 0) {
      log(`Progress: ${migrated} sub-sectors migrated...`, 1);
    }
  }

  log(`Migrated ${migrated} sub-sectors, skipped ${skipped}`);

  // Update child counts for level 2 nodes
  if (!dryRun) {
    await prisma.$executeRaw`
      UPDATE taxonomy_nodes n1
      SET child_count = (
        SELECT COUNT(*) FROM taxonomy_nodes n2 WHERE n2.parent_id = n1.id
      )
      WHERE n1.taxonomy_type_id = ${state.taxonomyTypeId} AND n1.level = 2
    `;
  }
}

// =============================================================================
// Step 6: Migrate SectorRule → TaxonomyRule
// =============================================================================

async function step6_migrateSectorRules(): Promise<void> {
  logStep(6, 'Migrate SectorRule → TaxonomyRule');

  if (!state.taxonomyTypeId) {
    throw new Error('TaxonomyType not created yet');
  }

  const rules = await prisma.$queryRaw<{
    id: string;
    sector_id: string;
    rule_type: string;
    expression: string;
    priority: number;
    is_exclusion: boolean;
    scope: string;
    portfolio_id: string | null;
    description: string | null;
    is_active: boolean;
    match_count: number;
  }[]>`
    SELECT id, sector_id, rule_type, expression, priority, is_exclusion,
           scope, portfolio_id, description, is_active, match_count
    FROM sector_rules
  `;

  log(`Found ${rules.length} sector rules to migrate`);

  let migrated = 0;
  let skipped = 0;

  for (const r of rules) {
    const targetNodeId = state.nodeIdMap.get(r.sector_id);
    if (!targetNodeId) {
      log(`Skipping rule ${r.id}: target sector not found`, 1);
      skipped++;
      continue;
    }

    // Check if already migrated (only if new tables exist)
    if (newTablesExist) {
      const existing = await prisma.$queryRaw<{ id: string }[]>`
        SELECT id FROM taxonomy_rules
        WHERE taxonomy_type_id = ${state.taxonomyTypeId}
        AND target_node_id = ${targetNodeId}
        AND expression = ${r.expression}
        LIMIT 1
      `;

      if (existing.length > 0) {
        state.ruleIdMap.set(r.id, existing[0].id);
        skipped++;
        continue;
      }
    }

    if (dryRun) {
      const fakeId = `dry-run-rule-${r.id}`;
      state.ruleIdMap.set(r.id, fakeId);
      state.stats.rulesCreated++;
      migrated++;
      continue;
    }

    const ruleId = `rule_${Date.now()}_${Math.random().toString(36).substring(7)}`;

    // Map scope: LIBRARY → GLOBAL, PORTFOLIO → PORTFOLIO_GROUP
    const newScope = r.scope === 'PORTFOLIO' ? 'PORTFOLIO_GROUP' : 'GLOBAL';

    await prisma.$executeRaw`
      INSERT INTO taxonomy_rules (
        id, taxonomy_type_id, target_node_id, rule_type, expression,
        priority, is_exclusion, scope, portfolio_group_id, is_active,
        match_count, description, created_at, updated_at
      ) VALUES (
        ${ruleId},
        ${state.taxonomyTypeId},
        ${targetNodeId},
        ${r.rule_type}::"TaxonomyRuleType",
        ${r.expression},
        ${r.priority},
        ${r.is_exclusion},
        ${newScope}::"TaxonomyRuleScope",
        NULL,
        ${r.is_active},
        ${r.match_count},
        ${r.description},
        NOW(),
        NOW()
      )
    `;

    state.ruleIdMap.set(r.id, ruleId);
    state.stats.rulesCreated++;
    migrated++;
  }

  log(`Migrated ${migrated} rules, skipped ${skipped}`);
}

// =============================================================================
// Step 7: Create Default PortfolioGroup
// =============================================================================

async function step7_createDefaultPortfolioGroup(): Promise<void> {
  logStep(7, 'Create Default PortfolioGroup');

  if (!state.taxonomyTypeId) {
    throw new Error('TaxonomyType not created yet');
  }

  // In dry-run mode without new tables, just simulate
  if (dryRun && !newTablesExist) {
    state.defaultPortfolioGroupId = 'dry-run-portfolio-group-id';
    log('[DRY RUN] Would create default PortfolioGroup');
    state.stats.portfolioGroupsCreated = 1;

    // Count portfolios to add
    const portfolios = await prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*) as count FROM portfolios
    `;
    state.stats.membersCreated = Number(portfolios[0].count);
    log(`[DRY RUN] Would add ${state.stats.membersCreated} portfolio members`);
    return;
  }

  // Check if already exists (only if new tables exist)
  let existing: { id: string }[] = [];
  if (newTablesExist) {
    existing = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM portfolio_groups WHERE name = 'default' LIMIT 1
    `;
  }

  if (existing.length > 0) {
    state.defaultPortfolioGroupId = existing[0].id;
    log(`Default PortfolioGroup already exists: ${state.defaultPortfolioGroupId}`);
  } else {
    if (dryRun) {
      state.defaultPortfolioGroupId = 'dry-run-portfolio-group-id';
      log('[DRY RUN] Would create default PortfolioGroup');
      state.stats.portfolioGroupsCreated = 1;
    } else {
      const groupId = `pg_default_${Date.now()}`;
      const config = {
        privilegedAssociationCount: 3,
        inventiveSourceWeight: 1.0,
        additionalSourceWeight: 0.3,
        associationWeights: { 1: 1.0, 2: 0.7, 3: 0.4 },
        reinforcementBonus: 0.2,
        clusteringEnabled: false,
        clusterThreshold: 0.30,
        llmModelTier: 'standard',
        llmQuestionsPerAssociation: 3,
        sourceCodeFilterPatterns: ['^Y', '^[A-H]\\d{2}[A-Z]2\\d{3}'],
        configVersion: 1,
        configUpdatedAt: new Date().toISOString(),
      };

      await prisma.$executeRaw`
        INSERT INTO portfolio_groups (
          id, name, display_name, description, taxonomy_type_id, tier, config,
          status, created_at, updated_at
        ) VALUES (
          ${groupId},
          'default',
          'Default Portfolio Group',
          'Default portfolio group containing all portfolios. Uses standard CPC-based technology classification.',
          ${state.taxonomyTypeId},
          'STANDARD'::"PortfolioGroupTier",
          ${JSON.stringify(config)}::jsonb,
          'ACTIVE'::"PortfolioGroupStatus",
          NOW(),
          NOW()
        )
      `;

      state.defaultPortfolioGroupId = groupId;
      state.stats.portfolioGroupsCreated = 1;
      log(`Created default PortfolioGroup: ${groupId}`);
    }
  }

  // Add all portfolios as members
  const portfolios = await prisma.$queryRaw<{ id: string; name: string }[]>`
    SELECT id, name FROM portfolios
  `;

  log(`Adding ${portfolios.length} portfolios as members...`);

  for (const p of portfolios) {
    // Check if already member (only if new tables exist)
    if (newTablesExist) {
      const existingMember = await prisma.$queryRaw<{ id: string }[]>`
        SELECT id FROM portfolio_group_members
        WHERE portfolio_group_id = ${state.defaultPortfolioGroupId}
        AND portfolio_id = ${p.id}
        LIMIT 1
      `;

      if (existingMember.length > 0) {
        continue;
      }
    }

    if (dryRun) {
      state.stats.membersCreated++;
      continue;
    }

    const memberId = `pgm_${p.id}_${Date.now()}`;
    await prisma.$executeRaw`
      INSERT INTO portfolio_group_members (
        id, portfolio_group_id, portfolio_id, added_at, added_by, classified_count
      ) VALUES (
        ${memberId},
        ${state.defaultPortfolioGroupId},
        ${p.id},
        NOW(),
        'migration-script',
        0
      )
    `;
    state.stats.membersCreated++;
  }

  log(`Added ${state.stats.membersCreated} portfolio members`);
}

// =============================================================================
// Step 8: Populate ObjectClassification from Patent Assignments
// =============================================================================

async function step8_populateClassifications(): Promise<void> {
  logStep(8, 'Populate ObjectClassification from Patent Assignments');

  if (!state.defaultPortfolioGroupId || !state.taxonomyTypeId) {
    throw new Error('PortfolioGroup or TaxonomyType not created yet');
  }

  // Get patents with sector assignments
  const patentCount = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*) as count FROM patents
    WHERE primary_sector IS NOT NULL
  `;

  log(`Found ${patentCount[0].count} patents with sector assignments`);

  // In dry-run mode without new tables, just estimate
  if (dryRun && !newTablesExist) {
    state.stats.classificationsCreated = Number(patentCount[0].count);
    log(`[DRY RUN] Would create ~${state.stats.classificationsCreated} ObjectClassification records`);
    return;
  }

  // Process in batches
  const batchSize = 1000;
  let offset = 0;
  let created = 0;

  // Build sector name → node ID map
  const sectorNodeMap = new Map<string, string>();
  const sectors = await prisma.$queryRaw<{ id: string; name: string }[]>`
    SELECT id, name FROM sectors
  `;
  for (const s of sectors) {
    const nodeId = state.nodeIdMap.get(s.id);
    if (nodeId) {
      sectorNodeMap.set(s.name, nodeId);
    }
  }

  while (true) {
    const patents = await prisma.$queryRaw<{
      patent_id: string;
      primary_sector: string | null;
      super_sector: string | null;
      primary_sub_sector_id: string | null;
    }[]>`
      SELECT patent_id, primary_sector, super_sector, primary_sub_sector_id
      FROM patents
      WHERE primary_sector IS NOT NULL
      ORDER BY patent_id
      LIMIT ${batchSize} OFFSET ${offset}
    `;

    if (patents.length === 0) break;

    for (const p of patents) {
      if (!p.primary_sector) continue;

      const taxonomyNodeId = sectorNodeMap.get(p.primary_sector);
      if (!taxonomyNodeId) {
        continue;
      }

      // Check if already exists (only if new tables exist)
      if (newTablesExist) {
        const existing = await prisma.$queryRaw<{ id: string }[]>`
          SELECT id FROM object_classifications
          WHERE portfolio_group_id = ${state.defaultPortfolioGroupId}
          AND object_id = ${p.patent_id}
          AND association_rank = 1
          LIMIT 1
        `;

        if (existing.length > 0) continue;
      }

      if (dryRun) {
        created++;
        continue;
      }

      const classId = `oc_${p.patent_id}_${Date.now()}`;
      await prisma.$executeRaw`
        INSERT INTO object_classifications (
          id, portfolio_group_id, object_type, object_id, taxonomy_node_id,
          association_rank, weight, confidence, source_codes, inventive_source_count,
          assigned_at, assigned_by, config_version
        ) VALUES (
          ${classId},
          ${state.defaultPortfolioGroupId},
          'patent',
          ${p.patent_id},
          ${taxonomyNodeId},
          1,
          1.0,
          NULL,
          ARRAY[]::text[],
          0,
          NOW(),
          'migration-script',
          1
        )
      `;
      created++;
    }

    offset += batchSize;
    if (offset % 10000 === 0) {
      log(`Progress: ${offset} patents processed, ${created} classifications created...`);
    }
  }

  state.stats.classificationsCreated = created;
  log(`Created ${created} ObjectClassification records`);

  // Update object_count on nodes
  if (!dryRun) {
    log('Updating node object counts...');
    await prisma.$executeRaw`
      UPDATE taxonomy_nodes tn
      SET object_count = (
        SELECT COUNT(*) FROM object_classifications oc
        WHERE oc.taxonomy_node_id = tn.id
      )
      WHERE tn.taxonomy_type_id = ${state.taxonomyTypeId}
    `;
  }
}

// =============================================================================
// Step 9: Sync Pragmatic Fields on Patent
// =============================================================================

async function step9_syncPragmaticFields(): Promise<void> {
  logStep(9, 'Sync Pragmatic Fields on Patent (primaryLevel1, primaryLevel2, primaryLevel3)');

  // Get patent count
  const patentCount = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*) as count FROM patents
  `;

  log(`Syncing pragmatic fields for ${patentCount[0].count} patents...`);

  if (dryRun) {
    log('[DRY RUN] Would update pragmatic fields based on existing sector assignments');
    state.stats.patentsUpdated = Number(patentCount[0].count);
    return;
  }

  // Update primaryLevel1 from super_sector
  await prisma.$executeRaw`
    UPDATE patents
    SET primary_level1 = super_sector
    WHERE super_sector IS NOT NULL
  `;

  // Update primaryLevel2 from primary_sector
  await prisma.$executeRaw`
    UPDATE patents
    SET primary_level2 = primary_sector
    WHERE primary_sector IS NOT NULL
  `;

  // Update primaryLevel3 from primary_sub_sector_name
  await prisma.$executeRaw`
    UPDATE patents
    SET primary_level3 = primary_sub_sector_name
    WHERE primary_sub_sector_name IS NOT NULL
  `;

  // Update node IDs (requires joining with taxonomy_nodes)
  // Level 2 node IDs
  await prisma.$executeRaw`
    UPDATE patents p
    SET primary_level2_node_id = tn.id
    FROM taxonomy_nodes tn
    WHERE tn.code = p.primary_sector
    AND tn.level = 2
    AND tn.taxonomy_type_id = ${state.taxonomyTypeId}
  `;

  // Level 1 node IDs
  await prisma.$executeRaw`
    UPDATE patents p
    SET primary_level1_node_id = tn.id
    FROM taxonomy_nodes tn
    WHERE tn.code = p.super_sector
    AND tn.level = 1
    AND tn.taxonomy_type_id = ${state.taxonomyTypeId}
  `;

  const updated = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*) as count FROM patents WHERE primary_level2 IS NOT NULL
  `;

  state.stats.patentsUpdated = Number(updated[0].count);
  log(`Updated pragmatic fields for ${state.stats.patentsUpdated} patents`);
}

// =============================================================================
// Main
// =============================================================================

async function main() {
  console.log('\n');
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║     Schema Migration: v1 → v2 (Abstract Taxonomy Model)    ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log('');

  if (dryRun) {
    console.log('🔍 DRY RUN MODE - No changes will be made\n');
  }

  if (onlyStep) {
    console.log(`Running only step ${onlyStep}\n`);
  }

  const steps = [
    { num: 1, fn: step1_applySchema },
    { num: 2, fn: step2_createTaxonomyType },
    { num: 3, fn: step3_migrateSuperSectors },
    { num: 4, fn: step4_migrateSectors },
    { num: 5, fn: step5_migrateSubSectors },
    { num: 6, fn: step6_migrateSectorRules },
    { num: 7, fn: step7_createDefaultPortfolioGroup },
    { num: 8, fn: step8_populateClassifications },
    { num: 9, fn: step9_syncPragmaticFields },
  ];

  try {
    for (const step of steps) {
      if (onlyStep && step.num !== onlyStep) continue;
      await step.fn();
    }

    console.log('\n');
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║                    Migration Complete!                      ║');
    console.log('╚════════════════════════════════════════════════════════════╝');
    console.log('');
    console.log('Summary:');
    console.log(`  Taxonomy Types created:  ${state.stats.taxonomyTypes}`);
    console.log(`  Nodes created:           ${state.stats.nodesCreated}`);
    console.log(`  Rules migrated:          ${state.stats.rulesCreated}`);
    console.log(`  Portfolio Groups:        ${state.stats.portfolioGroupsCreated}`);
    console.log(`  Members added:           ${state.stats.membersCreated}`);
    console.log(`  Classifications created: ${state.stats.classificationsCreated}`);
    console.log(`  Patents updated:         ${state.stats.patentsUpdated}`);
    console.log('');

    if (dryRun) {
      console.log('This was a dry run. Run without --dry-run to apply changes.');
    }
  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
