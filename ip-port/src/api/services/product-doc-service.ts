/**
 * Reusable service for product document processing:
 * - Text extraction from PDF/HTML files
 * - LLM-powered document summarization
 * - Product evidence retrieval (joins summaries with patent data)
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import Anthropic from '@anthropic-ai/sdk';
import {
  getAllProductCaches,
  readProductCache,
  slugify,
  type ProductCache,
  type ProductDocument,
} from './patlytics-cache-service.js';

// ── Types ─────────────────────────────────────────────────────────────────

export interface DocSummary {
  documentName: string;
  companySlug: string;
  productSlug: string;
  productName: string;
  sourceTextPath: string;
  sourceTextLength: number;
  summary: StructuredSummary;
  model: string;
  summarizedAt: string;
}

export interface StructuredSummary {
  keyTechnologies: string[];
  sdnNfvFeatures: string[];
  networkSecurityCapabilities: string[];
  virtualSwitchingRouting: string[];
  hypervisorVmManagement: string[];
  otherRelevantFeatures: string[];
  executiveSummary: string;
}

export interface ProductEvidence {
  productName: string;
  productSlug: string;
  companySlug: string;
  documents: DocSummary[];
  patentOverlaps: Array<{
    patentId: string;
    heatmapScore: number;
    narrative: string | null;
  }>;
}

// ── Constants ──���───────────────────────��──────────────────────────────────

const SUMMARIES_DIR = path.join(process.cwd(), 'cache', 'product-doc-summaries');
const MAX_TEXT_LENGTH = 100_000;

// ── Text Extraction ───────���───────────────────────────────────────────────

export function extractDocText(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === '.pdf') {
    return extractPdfText(filePath);
  }
  if (ext === '.html' || ext === '.htm') {
    return extractHtmlText(filePath);
  }
  if (ext === '.txt') {
    return fs.readFileSync(filePath, 'utf-8').trim();
  }
  // Fallback: try as text
  try {
    return fs.readFileSync(filePath, 'utf-8').trim();
  } catch {
    return '';
  }
}

function extractPdfText(filePath: string): string {
  try {
    return execSync(`pdftotext -layout "${filePath}" -`, {
      maxBuffer: 10 * 1024 * 1024,
      timeout: 30000,
    }).toString('utf-8').trim();
  } catch {
    return '';
  }
}

function extractHtmlText(filePath: string): string {
  const html = fs.readFileSync(filePath, 'utf-8');
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#\d+;/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── LLM Summarization ────────────────────────────────────────────────────

const SUMMARIZE_PROMPT = `You are a patent litigation analyst reviewing product documentation to identify technology implementations that may be relevant to patent infringement analysis.

Analyze the following product documentation and extract structured information. Focus on concrete technical implementations, not marketing language.

Respond with a JSON object (no markdown fencing) with these fields:

{
  "keyTechnologies": ["List of key technology implementations described in this document"],
  "sdnNfvFeatures": ["SDN and NFV features: software-defined networking controllers, network function virtualization, programmable data planes, overlay networks, etc."],
  "networkSecurityCapabilities": ["Network security features: firewalls, microsegmentation, intrusion detection, security policies, encryption, access control, etc."],
  "virtualSwitchingRouting": ["Virtual switching and routing: virtual switches, logical routers, VXLAN/GENEVE tunneling, BGP/OSPF, traffic forwarding, flow tables, etc."],
  "hypervisorVmManagement": ["Hypervisor and VM management: VM lifecycle, live migration, resource scheduling, memory management, CPU allocation, storage virtualization, etc."],
  "otherRelevantFeatures": ["Other potentially patent-relevant technical features not covered above"],
  "executiveSummary": "2-3 sentence summary of the document's key technical content and its relevance to SDN/NFV patent assertion"
}

If a category has no relevant content, use an empty array [].
Be specific — reference actual feature names, protocols, and implementation details from the document.`;

export async function summarizeDoc(
  text: string,
  options: { documentName: string; productName: string; companyName: string }
): Promise<StructuredSummary> {
  const anthropic = new Anthropic();

  const truncated = text.length > MAX_TEXT_LENGTH
    ? text.substring(0, MAX_TEXT_LENGTH) + '\n\n[... truncated ...]'
    : text;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    messages: [{
      role: 'user',
      content: `${SUMMARIZE_PROMPT}

Document: "${options.documentName}"
Product: ${options.productName} (${options.companyName})

--- DOCUMENT TEXT ---
${truncated}
--- END DOCUMENT TEXT ---`
    }],
  });

  const responseText = response.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('');

  try {
    return JSON.parse(responseText);
  } catch {
    const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[1]);
    }
    throw new Error(`Failed to parse LLM response as JSON`);
  }
}

// ── Summary Cache I/O ─���──────────────────���────────────────────────────────

export function readDocSummary(companySlug: string, productSlug: string, docSlug: string): DocSummary | null {
  const filePath = path.join(SUMMARIES_DIR, companySlug, productSlug, `${docSlug}.json`);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

export function writeDocSummary(companySlug: string, productSlug: string, docSlug: string, summary: DocSummary): void {
  const dir = path.join(SUMMARIES_DIR, companySlug, productSlug);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${docSlug}.json`), JSON.stringify(summary, null, 2));
}

export function getAllDocSummaries(companySlug: string): DocSummary[] {
  const companyDir = path.join(SUMMARIES_DIR, companySlug);
  if (!fs.existsSync(companyDir)) return [];

  const summaries: DocSummary[] = [];
  for (const productDir of fs.readdirSync(companyDir)) {
    const productPath = path.join(companyDir, productDir);
    if (!fs.statSync(productPath).isDirectory()) continue;
    for (const file of fs.readdirSync(productPath)) {
      if (!file.endsWith('.json')) continue;
      try {
        summaries.push(JSON.parse(fs.readFileSync(path.join(productPath, file), 'utf-8')));
      } catch { /* skip */ }
    }
  }
  return summaries;
}

// ── Product Evidence Retrieval ────────────────────────────────────────────

export function getProductEvidence(company: string, product: string): ProductEvidence | null {
  const productCache = readProductCache(company, product);
  if (!productCache) return null;

  const summaries = getAllDocSummaries(company).filter(s => s.productSlug === product);

  // Extract patent overlaps from product cache
  const patentOverlaps = Object.entries(productCache.patents).map(([patentId, entry]) => {
    // Find best narrative from any document
    let bestNarrative: string | null = null;
    for (const doc of productCache.documents) {
      const score = doc.patentScores?.[patentId];
      if (score?.narrative) {
        bestNarrative = score.narrative;
        break;
      }
    }
    return {
      patentId,
      heatmapScore: entry.maxScore,
      narrative: bestNarrative,
    };
  });

  return {
    productName: productCache.productName,
    productSlug: productCache.productSlug,
    companySlug: productCache.companySlug,
    documents: summaries,
    patentOverlaps,
  };
}
