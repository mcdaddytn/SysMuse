/**
 * Company management routes — CRUD for companies, competitors, and affiliates.
 * Companies are the first-class entity; portfolios and affiliates belong to companies.
 */

import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const router = Router();
const prisma = new PrismaClient();

// =============================================================================
// COMPANY CRUD
// =============================================================================

/** GET /api/companies — list all companies with counts */
router.get('/', async (req: Request, res: Response) => {
  try {
    const companies = await prisma.company.findMany({
      include: {
        _count: {
          select: { affiliates: true, portfolios: true, competitorsOf: true },
        },
      },
      orderBy: { displayName: 'asc' },
    });
    res.json(companies);
  } catch (err: unknown) {
    console.error('[Companies] List error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

/** GET /api/companies/:id — company detail with affiliates, portfolios, competitors */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const company = await prisma.company.findUnique({
      where: { id: req.params.id },
      include: {
        affiliates: {
          include: { patterns: true, children: { select: { id: true, name: true } } },
          orderBy: { name: 'asc' },
        },
        portfolios: {
          orderBy: { createdAt: 'asc' },
          include: { _count: { select: { patents: true } } },
        },
        _count: { select: { competitorsOf: true, competitorTo: true } },
      },
    });
    if (!company) {
      return res.status(404).json({ error: 'Company not found' });
    }
    res.json(company);
  } catch (err: unknown) {
    console.error('[Companies] Get error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

/** POST /api/companies — create company */
router.post('/', async (req: Request, res: Response) => {
  try {
    const { name, displayName, description, website } = req.body;
    if (!name || !displayName) {
      return res.status(400).json({ error: 'name and displayName are required' });
    }
    const company = await prisma.company.create({
      data: { name, displayName, description: description || null, website: website || null },
    });
    res.status(201).json(company);
  } catch (err: unknown) {
    console.error('[Companies] Create error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

/** PUT /api/companies/:id — update company */
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { displayName, description, website } = req.body;
    const company = await prisma.company.update({
      where: { id: req.params.id },
      data: {
        ...(displayName !== undefined && { displayName }),
        ...(description !== undefined && { description }),
        ...(website !== undefined && { website }),
      },
    });
    res.json(company);
  } catch (err: unknown) {
    console.error('[Companies] Update error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

/** DELETE /api/companies/:id — delete company (cascades) */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    await prisma.company.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err: unknown) {
    console.error('[Companies] Delete error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// =============================================================================
// COMPETITOR MANAGEMENT
// =============================================================================

/** GET /api/companies/:id/competitors — list competitor relationships */
router.get('/:id/competitors', async (req: Request, res: Response) => {
  try {
    const relationships = await prisma.competitorRelationship.findMany({
      where: { companyId: req.params.id },
      include: {
        competitor: {
          include: { _count: { select: { portfolios: true, affiliates: true } } },
        },
      },
      orderBy: { competitor: { displayName: 'asc' } },
    });
    res.json(relationships);
  } catch (err: unknown) {
    console.error('[Companies] List competitors error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

/** POST /api/companies/:id/competitors — add competitor relationship */
router.post('/:id/competitors', async (req: Request, res: Response) => {
  try {
    const { competitorId, sectors, discoverySource, strength, notes } = req.body;
    if (!competitorId) {
      return res.status(400).json({ error: 'competitorId is required' });
    }
    const relationship = await prisma.competitorRelationship.create({
      data: {
        companyId: req.params.id,
        competitorId,
        sectors: sectors || [],
        discoverySource: discoverySource || 'MANUAL',
        strength: strength || null,
        notes: notes || null,
      },
      include: { competitor: true },
    });
    res.status(201).json(relationship);
  } catch (err: unknown) {
    console.error('[Companies] Add competitor error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

/** DELETE /api/companies/:id/competitors/:competitorId — remove relationship */
router.delete('/:id/competitors/:competitorId', async (req: Request, res: Response) => {
  try {
    await prisma.competitorRelationship.delete({
      where: {
        companyId_competitorId: {
          companyId: req.params.id,
          competitorId: req.params.competitorId,
        },
      },
    });
    res.json({ success: true });
  } catch (err: unknown) {
    console.error('[Companies] Remove competitor error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

/** POST /api/companies/:id/discover-competitors — LLM-assisted competitor discovery */
router.post('/:id/discover-competitors', async (req: Request, res: Response) => {
  try {
    const company = await prisma.company.findUnique({
      where: { id: req.params.id },
      include: {
        competitorsOf: { include: { competitor: true } },
        affiliates: { select: { displayName: true, description: true } },
      },
    });
    if (!company) {
      return res.status(404).json({ error: 'Company not found' });
    }

    const { companyName } = req.body;
    const nameToSearch = companyName || company.displayName;

    const existingNames = company.competitorsOf.map(r => r.competitor.displayName);

    // Build division context from affiliates with descriptions
    const affiliatesWithDesc = company.affiliates.filter(a => a.description);
    let divisionContext = '';
    if (affiliatesWithDesc.length > 0) {
      divisionContext = `\n\n${nameToSearch} operates through multiple divisions/subsidiaries, each with distinct technology focus areas:\n${affiliatesWithDesc.map(a => `  - ${a.displayName}: ${a.description}`).join('\n')}\n\nIMPORTANT: Find competitors FOR EACH division/subsidiary listed above. For example, if one division focuses on virtualization, find virtualization competitors. If another focuses on enterprise security, find enterprise security competitors. Include a "competingDivisions" array in each result indicating which division(s) each competitor competes with.`;
    }

    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const client = new Anthropic();

    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      tools: [{ type: 'web_search_20250305', name: 'web_search' } as any],
      messages: [{
        role: 'user',
        content: `Search the web for competitors of "${nameToSearch}" in the technology/patent space. Focus on companies that would have overlapping patent portfolios — companies working in the same technology areas, filing similar patents, or competing in the same markets.${divisionContext}

Already known competitors: ${existingNames.slice(0, 30).join(', ')}${existingNames.length > 30 ? ` (and ${existingNames.length - 30} more)` : ''}

Return JSON array: [{ "name": "Company Name", "slug": "company-slug", "sectors": ["sector1"], "competingDivisions": ["Division Name 1", "Division Name 2"], "notes": "1-2 sentences: what technology areas they compete in, what types of patent overlap exists" }]

The "competingDivisions" field should list the specific ${nameToSearch} divisions/subsidiaries this company competes with. If division info is not available, omit the field or set to an empty array.

Only return NEW companies not in the known list. Return raw JSON array, no markdown.`,
      }],
    });

    // Extract text from response (may include web search tool_use blocks)
    const textBlocks = message.content.filter(b => b.type === 'text');
    const responseText = textBlocks.map(b => (b as any).text).join('');
    let suggestions;
    try {
      suggestions = JSON.parse(responseText);
    } catch {
      // Try to extract JSON array from response text (model may include preamble)
      const jsonMatch = responseText.match(/\[[\s\S]*\]/);
      suggestions = jsonMatch ? JSON.parse(jsonMatch[0]) : [];
    }

    res.json({ suggestions, companyName: nameToSearch, existingCount: existingNames.length });
  } catch (err: unknown) {
    console.error('[Companies] Discover competitors error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

/** POST /api/companies/:id/discover-competitors-data — data-driven competitor discovery from citing patents */
router.post('/:id/discover-competitors-data', async (req: Request, res: Response) => {
  try {
    const company = await prisma.company.findUnique({
      where: { id: req.params.id },
      include: {
        affiliates: { include: { patterns: true } },
      },
    });
    if (!company) {
      return res.status(404).json({ error: 'Company not found' });
    }

    const { portfolioId } = req.body;
    if (!portfolioId) {
      return res.status(400).json({ error: 'portfolioId is required' });
    }

    // Get all patents in the portfolio
    const portfolioPatents = await prisma.portfolioPatent.findMany({
      where: { portfolioId },
      select: { patentId: true },
    });

    if (portfolioPatents.length === 0) {
      return res.status(400).json({ error: 'Portfolio has no patents' });
    }

    // Build self/affiliate patterns to exclude
    const selfPatterns = company.affiliates.flatMap(a =>
      a.patterns.map(p => p.pattern.toLowerCase())
    );
    // Also add company name variants
    selfPatterns.push(company.displayName.toLowerCase());
    selfPatterns.push(company.name.toLowerCase());

    // Common suffixes to strip for normalization
    const SUFFIXES = /,?\s*\b(inc\.?|llc\.?|ltd\.?|l\.?t\.?d\.?|corp\.?|corporation|company|co\.?|plc|s\.?a\.?|a\.?g\.?|gmbh|n\.?v\.?|b\.?v\.?|s\.?r\.?l\.?|s\.?p\.?a\.?|pty\.?|pte\.?|limited)\s*$/i;

    function normalizeName(name: string): string {
      return name.replace(SUFFIXES, '').trim().replace(/\s+/g, ' ');
    }

    function isSelfOrAffiliate(assignee: string): boolean {
      const lower = assignee.toLowerCase();
      return selfPatterns.some(p => lower.includes(p) || p.includes(lower.replace(SUFFIXES, '').trim()));
    }

    // Read citing patent cache files
    const citingDir = path.join(process.cwd(), 'cache/api/patentsview/citing-patent-details');
    const assigneeMap = new Map<string, {
      totalCitations: number;
      patentsCited: Set<string>;
      variants: Set<string>;
    }>();

    let patentsWithCitingData = 0;
    let patentsWithoutCitingData = 0;
    let totalCitingPatentsAnalyzed = 0;

    for (const { patentId } of portfolioPatents) {
      const cacheFile = path.join(citingDir, `${patentId}.json`);
      if (!fs.existsSync(cacheFile)) {
        patentsWithoutCitingData++;
        continue;
      }

      patentsWithCitingData++;

      let data: any;
      try {
        data = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
      } catch {
        continue;
      }

      const citingPatents = data.citing_patents || [];
      totalCitingPatentsAnalyzed += citingPatents.length;

      for (const cp of citingPatents) {
        for (const assignee of cp.assignees || []) {
          const org = assignee.assignee_organization;
          if (!org) continue;

          // Skip self/affiliates
          if (isSelfOrAffiliate(org)) continue;

          const normalized = normalizeName(org).toLowerCase();
          if (!normalized) continue;

          let entry = assigneeMap.get(normalized);
          if (!entry) {
            entry = { totalCitations: 0, patentsCited: new Set(), variants: new Set() };
            assigneeMap.set(normalized, entry);
          }
          entry.totalCitations++;
          entry.patentsCited.add(patentId);
          entry.variants.add(org);
        }
      }
    }

    // Sort by totalCitations descending, take top 30
    const sorted = Array.from(assigneeMap.entries())
      .sort((a, b) => b[1].totalCitations - a[1].totalCitations)
      .slice(0, 30);

    const maxCitations = sorted.length > 0 ? sorted[0][1].totalCitations : 1;

    const suggestions = sorted.map(([slug, info]) => {
      // Use most common variant as display name
      const variantArr = Array.from(info.variants);
      const displayName = variantArr.sort((a, b) => b.length - a.length)[0]; // longest variant usually most complete

      return {
        name: displayName,
        slug,
        sectors: [] as string[],
        notes: `${info.totalCitations} citations across ${info.patentsCited.size} patents`,
        strength: Math.round((info.totalCitations / maxCitations) * 100) / 100,
        citationCount: info.totalCitations,
        patentsCited: info.patentsCited.size,
        variants: variantArr.slice(0, 5),
      };
    });

    res.json({
      suggestions,
      portfolioId,
      totalCitingPatentsAnalyzed,
      patentsWithCitingData,
      patentsWithoutCitingData,
    });
  } catch (err: unknown) {
    console.error('[Companies] Discover competitors (data) error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

/** POST /api/companies/:id/discover-affiliates — LLM-assisted affiliate discovery */
router.post('/:id/discover-affiliates', async (req: Request, res: Response) => {
  try {
    const company = await prisma.company.findUnique({
      where: { id: req.params.id },
      include: {
        affiliates: {
          include: {
            patterns: true,
            parent: { select: { name: true, displayName: true } },
            children: { select: { name: true, displayName: true } },
          },
        },
      },
    });
    if (!company) {
      return res.status(404).json({ error: 'Company not found' });
    }

    const { companyName } = req.body;
    const nameToSearch = companyName || company.displayName;

    // Build hierarchy context for existing affiliates
    const existingAffiliates = company.affiliates.map(a => {
      const parts = [`${a.displayName} (slug: ${a.name})`];
      if (a.description) parts.push(`focus: ${a.description}`);
      if ((a as any).parent) parts.push(`parent: ${(a as any).parent.displayName}`);
      const children = (a as any).children as Array<{ displayName: string }>;
      if (children?.length) parts.push(`children: ${children.map((c: { displayName: string }) => c.displayName).join(', ')}`);
      parts.push(`patterns: ${a.patterns.map(p => p.pattern).join(', ')}`);
      return parts.join(' | ');
    });

    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const client = new Anthropic();

    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      tools: [{ type: 'web_search_20250305', name: 'web_search' } as any],
      messages: [{
        role: 'user',
        content: `I need to find all USPTO assignee name variants and subsidiaries for "${nameToSearch}" to import their patent portfolio.

Search the web for "${nameToSearch}" subsidiaries, acquisitions, and patent assignee information.

IMPORTANT — RECURSIVE TRAVERSAL: For each configured affiliate below, also search for THEIR prior acquisitions and subsidiaries before they were acquired. For example, if "Avago Technologies" is already configured, search for companies Avago acquired (Emulex, PLX Technology, CyOptics, etc.) and include those with parent="avago-technologies". If "VMware" is configured, search for VMware's acquisitions (Nicira, Carbon Black, etc.) with parent="vmware".

For the parent company and each known subsidiary/acquisition:
1. List the exact assignee name strings used in USPTO records (e.g., "Netflix, Inc.", "Netflix Inc", "NETFLIX INC")
2. Include any subsidiaries, acquired companies, or divisions that file patents separately
3. For acquisitions, include the year acquired if known

Already configured affiliates (with hierarchy context):
${existingAffiliates.length ? existingAffiliates.map(a => `  - ${a}`).join('\n') : '  None'}

Return a JSON array of NEW entities not already configured:
[{
  "name": "slug-name",
  "displayName": "Human Readable Name",
  "acquiredYear": 2019,
  "parent": "parent-slug-or-null",
  "patterns": ["Pattern 1", "Pattern 2"],
  "notes": "Brief context about this entity",
  "description": "1-2 sentence description of this entity's technology focus areas and what types of patents it files"
}]

The "parent" field should be the slug name of the IMMEDIATE parent entity that acquired this company. Set to null if the entity is a direct subsidiary of "${nameToSearch}" itself. For example, if Emulex was acquired by Avago (slug "avago-technologies"), set parent to "avago-technologies", NOT to the top-level company.

For the parent company itself (if not already configured), use acquiredYear: null and parent: null.
Include all known assignee name variants as separate patterns.
Return raw JSON array, no markdown.`,
      }],
    });

    // Extract text from response (may include web search tool_use blocks)
    const textBlocks = message.content.filter(b => b.type === 'text');
    const responseText = textBlocks.map(b => (b as any).text).join('');
    let suggestions;
    try {
      suggestions = JSON.parse(responseText);
    } catch {
      // Try to extract JSON array from response text (model may include preamble)
      const jsonMatch = responseText.match(/\[[\s\S]*\]/);
      suggestions = jsonMatch ? JSON.parse(jsonMatch[0]) : [];
    }

    res.json({ suggestions, companyName: nameToSearch, existingCount: existingAffiliates.length });
  } catch (err: unknown) {
    console.error('[Companies] Discover affiliates error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

/** POST /api/companies/:id/validate-patterns — test assignee patterns against PatentsView */
router.post('/:id/validate-patterns', async (req: Request, res: Response) => {
  try {
    const company = await prisma.company.findUnique({ where: { id: req.params.id } });
    if (!company) {
      return res.status(404).json({ error: 'Company not found' });
    }

    const { patterns, cpcPrefixes } = req.body as { patterns: string[]; cpcPrefixes?: string[] };
    if (!patterns?.length) {
      return res.status(400).json({ error: 'patterns array is required' });
    }

    const { createPatentsViewClient } = await import('../../../clients/patentsview-client.js');
    const pvClient = createPatentsViewClient();

    const results: Array<{
      pattern: string;
      totalCount: number;
      filteredCount: number | null;
      sampleAssignees: string[];
    }> = [];

    for (const pattern of patterns) {
      try {
        // Total count for this pattern
        const baseQuery = {
          _and: [{ _contains: { 'assignees.assignee_organization': pattern } }],
        };
        const totalResult = await pvClient.searchPatents({
          query: baseQuery,
          fields: ['patent_id', 'assignees.assignee_organization'],
          options: { size: 25 },
        });
        const totalCount = totalResult.total_hits || 0;

        // Collect sample assignee names from results
        const assigneeNames = new Set<string>();
        for (const patent of totalResult.patents || []) {
          for (const assignee of patent.assignees || []) {
            if (assignee.assignee_organization) {
              assigneeNames.add(assignee.assignee_organization);
            }
          }
        }

        // Filtered count with CPC prefixes
        let filteredCount: number | null = null;
        if (cpcPrefixes?.length) {
          const cpcFilters = cpcPrefixes.map(prefix => ({
            _begins: { 'cpc_current.cpc_group_id': prefix },
          }));
          const cpcQuery = {
            _and: [
              { _contains: { 'assignees.assignee_organization': pattern } },
              ...(cpcFilters.length === 1 ? cpcFilters : [{ _or: cpcFilters }]),
            ],
          };
          const cpcResult = await pvClient.searchPatents({
            query: cpcQuery,
            fields: ['patent_id'],
            options: { size: 1 },
          });
          filteredCount = cpcResult.total_hits || 0;
        }

        results.push({
          pattern,
          totalCount,
          filteredCount,
          sampleAssignees: [...assigneeNames].slice(0, 10),
        });
      } catch (err) {
        console.warn(`[ValidatePatterns] Error for pattern "${pattern}":`, (err as Error).message);
        results.push({ pattern, totalCount: 0, filteredCount: null, sampleAssignees: [] });
      }
    }

    res.json({ results, cpcPrefixes: cpcPrefixes || null });
  } catch (err: unknown) {
    console.error('[Companies] Validate patterns error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// =============================================================================
// AFFILIATE & COMPETITOR DESCRIPTIONS (LLM)
// =============================================================================

/** POST /api/companies/:id/describe-affiliates — LLM-generated descriptions for all affiliates */
router.post('/:id/describe-affiliates', async (req: Request, res: Response) => {
  try {
    const company = await prisma.company.findUnique({
      where: { id: req.params.id },
      include: { affiliates: { orderBy: { name: 'asc' } } },
    });
    if (!company) {
      return res.status(404).json({ error: 'Company not found' });
    }
    if (!company.affiliates.length) {
      return res.status(400).json({ error: 'No affiliates to describe' });
    }

    const affiliateList = company.affiliates
      .map((a, i) => `${i + 1}. ${a.displayName}${a.acquiredYear ? ` (acquired ${a.acquiredYear})` : ''}${a.notes ? ` — ${a.notes}` : ''}`)
      .join('\n');

    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const client = new Anthropic();

    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      tools: [{ type: 'web_search_20250305', name: 'web_search' } as any],
      messages: [{
        role: 'user',
        content: `For company "${company.displayName}", describe each of the following subsidiaries/affiliates.
For each, provide a 1-2 sentence description of:
- What the entity does / its technology focus areas
- What types of patents it would file (technology domains)
- When it was acquired (if known)

Affiliates:
${affiliateList}

Return JSON array: [{ "name": "${company.affiliates[0].name}", "description": "..." }]
Use the affiliate's slug name (the "name" field, not displayName). Return raw JSON array, no markdown.`,
      }],
    });

    const textBlocks = message.content.filter(b => b.type === 'text');
    const responseText = textBlocks.map(b => (b as any).text).join('');
    let descriptions: Array<{ name: string; description: string }>;
    try {
      descriptions = JSON.parse(responseText);
    } catch {
      const jsonMatch = responseText.match(/\[[\s\S]*\]/);
      descriptions = jsonMatch ? JSON.parse(jsonMatch[0]) : [];
    }

    // Update each affiliate's description
    const nameMap = new Map(descriptions.map(d => [d.name, d.description]));
    for (const affiliate of company.affiliates) {
      const desc = nameMap.get(affiliate.name);
      if (desc) {
        await prisma.affiliate.update({
          where: { id: affiliate.id },
          data: { description: desc },
        });
      }
    }

    // Return updated affiliates
    const updated = await prisma.affiliate.findMany({
      where: { companyId: company.id },
      include: { patterns: true, children: { select: { id: true, name: true } } },
      orderBy: { name: 'asc' },
    });

    res.json(updated);
  } catch (err: unknown) {
    console.error('[Companies] Describe affiliates error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

/** POST /api/companies/:id/describe-competitors — LLM-generated descriptions for competitors */
router.post('/:id/describe-competitors', async (req: Request, res: Response) => {
  try {
    const company = await prisma.company.findUnique({
      where: { id: req.params.id },
    });
    if (!company) {
      return res.status(404).json({ error: 'Company not found' });
    }

    const relationships = await prisma.competitorRelationship.findMany({
      where: { companyId: req.params.id },
      include: { competitor: true },
      orderBy: { competitor: { displayName: 'asc' } },
    });

    if (!relationships.length) {
      return res.status(400).json({ error: 'No competitors to describe' });
    }

    const competitorList = relationships
      .map((r, i) => `${i + 1}. ${r.competitor.displayName}${r.sectors.length ? ` — sectors: ${r.sectors.join(', ')}` : ''}`)
      .join('\n');

    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const client = new Anthropic();

    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      tools: [{ type: 'web_search_20250305', name: 'web_search' } as any],
      messages: [{
        role: 'user',
        content: `For company "${company.displayName}", describe each competitor's technology overlap.
For each competitor, provide a 1-2 sentence description of:
- What technology areas they compete in
- What types of patents overlap with ${company.displayName}

Competitors:
${competitorList}

Return JSON array: [{ "id": "${relationships[0].id}", "description": "..." }]
Use the relationship ID provided. Return raw JSON array, no markdown.`,
      }],
    });

    const textBlocks = message.content.filter(b => b.type === 'text');
    const responseText = textBlocks.map(b => (b as any).text).join('');
    let descriptions: Array<{ id: string; description: string }>;
    try {
      descriptions = JSON.parse(responseText);
    } catch {
      const jsonMatch = responseText.match(/\[[\s\S]*\]/);
      descriptions = jsonMatch ? JSON.parse(jsonMatch[0]) : [];
    }

    // Update each competitor relationship's notes
    const idMap = new Map(descriptions.map(d => [d.id, d.description]));
    for (const rel of relationships) {
      const desc = idMap.get(rel.id);
      if (desc) {
        await prisma.competitorRelationship.update({
          where: { id: rel.id },
          data: { notes: desc },
        });
      }
    }

    // Return updated relationships
    const updated = await prisma.competitorRelationship.findMany({
      where: { companyId: req.params.id },
      include: {
        competitor: {
          include: { _count: { select: { portfolios: true, affiliates: true } } },
        },
      },
      orderBy: { competitor: { displayName: 'asc' } },
    });

    res.json(updated);
  } catch (err: unknown) {
    console.error('[Companies] Describe competitors error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

/** PUT /api/companies/:id/affiliates-bulk-active — toggle all affiliates active/inactive */
router.put('/:id/affiliates-bulk-active', async (req: Request, res: Response) => {
  try {
    const { isActive } = req.body;
    if (typeof isActive !== 'boolean') {
      return res.status(400).json({ error: 'isActive (boolean) is required' });
    }
    const result = await prisma.affiliate.updateMany({
      where: { companyId: req.params.id },
      data: { isActive },
    });
    res.json({ count: result.count, isActive });
  } catch (err: unknown) {
    console.error('[Companies] Bulk toggle affiliates error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// =============================================================================
// AFFILIATE CRUD (under company)
// =============================================================================

/** POST /api/companies/:id/affiliates — add affiliate with optional patterns */
router.post('/:id/affiliates', async (req: Request, res: Response) => {
  try {
    const { name, displayName, acquiredYear, parentId, notes, description, patterns } = req.body;
    if (!name || !displayName) {
      return res.status(400).json({ error: 'name and displayName are required' });
    }

    const affiliate = await prisma.affiliate.create({
      data: {
        companyId: req.params.id,
        name,
        displayName,
        acquiredYear: acquiredYear || null,
        parentId: parentId || null,
        notes: notes || null,
        description: description || null,
        patterns: patterns?.length
          ? { create: patterns.map((p: string) => ({ pattern: p, isExact: false })) }
          : undefined,
      },
      include: { patterns: true },
    });

    res.status(201).json(affiliate);
  } catch (err: unknown) {
    console.error('[Companies] Add affiliate error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

/** PUT /api/companies/:id/affiliates/:aid — update affiliate */
router.put('/:id/affiliates/:aid', async (req: Request, res: Response) => {
  try {
    const { displayName, acquiredYear, parentId, notes, isActive } = req.body;
    const affiliate = await prisma.affiliate.update({
      where: { id: req.params.aid },
      data: {
        ...(displayName !== undefined && { displayName }),
        ...(acquiredYear !== undefined && { acquiredYear }),
        ...(parentId !== undefined && { parentId }),
        ...(notes !== undefined && { notes }),
        ...(isActive !== undefined && { isActive }),
      },
      include: { patterns: true },
    });
    res.json(affiliate);
  } catch (err: unknown) {
    console.error('[Companies] Update affiliate error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

/** DELETE /api/companies/:id/affiliates/:aid — delete affiliate (cascades patterns) */
router.delete('/:id/affiliates/:aid', async (req: Request, res: Response) => {
  try {
    await prisma.affiliate.delete({ where: { id: req.params.aid } });
    res.json({ success: true });
  } catch (err: unknown) {
    console.error('[Companies] Delete affiliate error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// =============================================================================
// AFFILIATE PATTERN CRUD (under company)
// =============================================================================

/** POST /api/companies/:id/affiliates/:aid/patterns — add pattern */
router.post('/:id/affiliates/:aid/patterns', async (req: Request, res: Response) => {
  try {
    const { pattern, isExact } = req.body;
    if (!pattern) {
      return res.status(400).json({ error: 'pattern is required' });
    }
    const created = await prisma.affiliatePattern.create({
      data: {
        affiliateId: req.params.aid,
        pattern,
        isExact: isExact || false,
      },
    });
    res.status(201).json(created);
  } catch (err: unknown) {
    console.error('[Companies] Add pattern error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

/** DELETE /api/companies/:id/affiliates/:aid/patterns/:pid — delete pattern */
router.delete('/:id/affiliates/:aid/patterns/:pid', async (req: Request, res: Response) => {
  try {
    await prisma.affiliatePattern.delete({ where: { id: req.params.pid } });
    res.json({ success: true });
  } catch (err: unknown) {
    console.error('[Companies] Delete pattern error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
