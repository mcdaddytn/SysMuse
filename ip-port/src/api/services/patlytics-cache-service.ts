import * as fs from 'fs';
import * as path from 'path';

// ── Types ──────────────────────────────────────────────────────────────────

export interface PatentProductScore {
  score: number;
  sourceFile: string;
  importedAt: string;
}

export interface PatentProduct {
  companySlug: string;
  companyName: string;
  productSlug: string;
  productName: string;
  scores: PatentProductScore[];
  maxScore: number;
  isHot: boolean;
}

export interface PatentCache {
  patentId: string;
  fullPatentId: string;
  title: string;
  inventors: string;
  patlyticsLink: string | null;
  products: PatentProduct[];
  hotProductCount: number;
  maxScoreOverall: number;
  sourceFiles: string[];
  importedAt: string;
  updatedAt: string;
}

export interface DocumentPatentScore {
  score: number;
  narrative: string | null;
  sourceFile?: string;  // e.g. "internal-v1" for internal scoring, or Patlytics source slug
}

export interface ProductDocument {
  documentName: string;
  documentUrl: string | null;
  patlyticsStoredUrl: string | null;
  localPath: string | null;
  downloadStatus: 'pending' | 'completed' | 'failed' | 'skipped';
  downloadError?: string;
  patentScores: Record<string, DocumentPatentScore>;
}

export interface ProductPatentEntry {
  maxScore: number;
  isHot: boolean;
}

export interface ProductCache {
  companySlug: string;
  companyName: string;
  productSlug: string;
  productName: string;
  docsFoundCount: number;
  documents: ProductDocument[];
  patents: Record<string, ProductPatentEntry>;
  sourceFiles: string[];
  importedAt: string;
  updatedAt: string;
}

export interface SourceManifestEntry {
  fileName: string;
  sourceSlug: string;
  filePath: string;
  patentCount: number;
  productCount: number;
  documentCount: number;
  importedAt: string;
}

export interface Manifest {
  sources: SourceManifestEntry[];
  totalPatents: number;
  totalProducts: number;
  totalDocuments: number;
  lastImportAt: string;
}

export interface CompanyEntry {
  companyName: string;
  companySlug: string;
  competitorMatch: string | null;
  competitorCategory: string | null;
  productCount: number;
  products: string[];
}

export interface CompaniesIndex {
  companies: CompanyEntry[];
  updatedAt: string;
}

export interface ParsedPatentId {
  patentId: string;
  fullId: string;
}

export interface ParsedProductHeader {
  productName: string;
  companyName: string;
  docsFoundCount: number;
}

// ── Constants ──────────────────────────────────────────────────────────────

const CACHE_BASE = path.join(process.cwd(), 'cache', 'patlytics');
const PATENTS_DIR = path.join(CACHE_BASE, 'patents');
const PRODUCTS_DIR = path.join(CACHE_BASE, 'products');
const SOURCES_DIR = path.join(CACHE_BASE, 'sources');
const MANIFEST_PATH = path.join(CACHE_BASE, 'manifest.json');
const COMPANIES_PATH = path.join(CACHE_BASE, 'companies.json');

const HOT_THRESHOLD = 0.80;

// ── Helpers ────────────────────────────────────────────────────────────────

export function slugify(name: string): string {
  return name.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

export function normalizePatentId(raw: string): ParsedPatentId {
  // Input: "US-9154111-B2" or "US9154111B2" or just "9154111"
  const cleaned = raw.replace(/\s+/g, '').trim();

  // Extract digits from patterns like US-9154111-B2, US9154111B2, etc.
  const match = cleaned.match(/(?:US[-\s]?)?(\d{6,8})(?:[-\s]?[AB]\d)?/i);
  if (match) {
    return { patentId: match[1], fullId: cleaned };
  }

  // If it's already just digits
  if (/^\d+$/.test(cleaned)) {
    return { patentId: cleaned, fullId: cleaned };
  }

  // Fallback: return as-is
  return { patentId: cleaned, fullId: cleaned };
}

export function parseProductHeader(header: string): ParsedProductHeader {
  // Header format: "ProductName\nCompanyName\nN docs found"
  const lines = header.split('\n').map(l => l.trim()).filter(Boolean);

  const productName = lines[0] || 'Unknown Product';
  const companyName = lines[1] || 'Unknown Company';
  let docsFoundCount = 0;

  if (lines.length >= 3) {
    const docsMatch = lines[2].match(/(\d+)\s+docs?\s+found/i);
    if (docsMatch) {
      docsFoundCount = parseInt(docsMatch[1], 10);
    }
  }

  return { productName, companyName, docsFoundCount };
}

// ── Directory Setup ────────────────────────────────────────────────────────

export function ensureCacheDirs(): void {
  for (const dir of [CACHE_BASE, PATENTS_DIR, PRODUCTS_DIR, SOURCES_DIR]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

// ── Patent Cache I/O ───────────────────────────────────────────────────────

function patentCachePath(patentId: string): string {
  return path.join(PATENTS_DIR, `${patentId}.json`);
}

export function readPatentCache(patentId: string): PatentCache | null {
  const filePath = patentCachePath(patentId);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

export function writePatentCache(patentId: string, data: PatentCache): void {
  ensureCacheDirs();
  fs.writeFileSync(patentCachePath(patentId), JSON.stringify(data, null, 2));
}

// ── Product Cache I/O ──────────────────────────────────────────────────────

function productCacheDir(companySlug: string): string {
  return path.join(PRODUCTS_DIR, companySlug);
}

function productCachePath(companySlug: string, productSlug: string): string {
  return path.join(productCacheDir(companySlug), `${productSlug}.json`);
}

export function readProductCache(companySlug: string, productSlug: string): ProductCache | null {
  const filePath = productCachePath(companySlug, productSlug);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

export function writeProductCache(companySlug: string, productSlug: string, data: ProductCache): void {
  const dir = productCacheDir(companySlug);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(productCachePath(companySlug, productSlug), JSON.stringify(data, null, 2));
}

export function getAllProductCacheFiles(): string[] {
  if (!fs.existsSync(PRODUCTS_DIR)) return [];
  const files: string[] = [];
  for (const company of fs.readdirSync(PRODUCTS_DIR)) {
    const companyDir = path.join(PRODUCTS_DIR, company);
    if (!fs.statSync(companyDir).isDirectory()) continue;
    for (const file of fs.readdirSync(companyDir)) {
      if (file.endsWith('.json')) {
        files.push(path.join(companyDir, file));
      }
    }
  }
  return files;
}

// ── Source Cache I/O ───────────────────────────────────────────────────────

export function writeSourceCache(sourceSlug: string, data: unknown): void {
  ensureCacheDirs();
  fs.writeFileSync(path.join(SOURCES_DIR, `${sourceSlug}.json`), JSON.stringify(data, null, 2));
}

// ── Manifest I/O ───────────────────────────────────────────────────────────

export function readManifest(): Manifest {
  if (fs.existsSync(MANIFEST_PATH)) {
    try {
      return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8'));
    } catch { /* fall through */ }
  }
  return {
    sources: [],
    totalPatents: 0,
    totalProducts: 0,
    totalDocuments: 0,
    lastImportAt: '',
  };
}

export function writeManifest(data: Manifest): void {
  ensureCacheDirs();
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(data, null, 2));
}

// ── Companies Index I/O ────────────────────────────────────────────────────

export function readCompaniesIndex(): CompaniesIndex {
  if (fs.existsSync(COMPANIES_PATH)) {
    try {
      return JSON.parse(fs.readFileSync(COMPANIES_PATH, 'utf-8'));
    } catch { /* fall through */ }
  }
  return { companies: [], updatedAt: '' };
}

export function writeCompaniesIndex(data: CompaniesIndex): void {
  ensureCacheDirs();
  fs.writeFileSync(COMPANIES_PATH, JSON.stringify(data, null, 2));
}

// ── Competitor Matching ────────────────────────────────────────────────────

interface CompetitorInfo {
  name: string;
  category: string;
}

let competitorCache: CompetitorInfo[] | null = null;

function loadCompetitors(): CompetitorInfo[] {
  if (competitorCache) return competitorCache;

  const configPath = path.join(process.cwd(), 'config', 'competitors.json');
  if (!fs.existsSync(configPath)) {
    competitorCache = [];
    return competitorCache;
  }

  try {
    const data = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    const results: CompetitorInfo[] = [];

    if (data.categories) {
      for (const [category, catData] of Object.entries(data.categories)) {
        const cat = catData as { companies?: Array<{ name: string; patterns?: string[] }> };
        if (cat.companies) {
          for (const company of cat.companies) {
            results.push({ name: company.name, category });
            // Also add patterns as matchable names
            if (company.patterns) {
              for (const pattern of company.patterns) {
                results.push({ name: pattern, category });
              }
            }
          }
        }
      }
    }

    competitorCache = results;
    return results;
  } catch {
    competitorCache = [];
    return [];
  }
}

export function matchCompanyToCompetitor(companyName: string): { name: string; category: string } | null {
  const competitors = loadCompetitors();
  const normalized = companyName.toLowerCase().replace(/[^a-z0-9]/g, '');

  for (const comp of competitors) {
    const compNorm = comp.name.toLowerCase().replace(/[^a-z0-9]/g, '');
    // Exact match or substring containment
    if (normalized === compNorm || normalized.includes(compNorm) || compNorm.includes(normalized)) {
      return comp;
    }
  }

  return null;
}

// ── Query Helpers ──────────────────────────────────────────────────────────

export function getHotPatents(threshold: number = HOT_THRESHOLD): PatentCache[] {
  if (!fs.existsSync(PATENTS_DIR)) return [];

  const hotPatents: PatentCache[] = [];
  for (const file of fs.readdirSync(PATENTS_DIR)) {
    if (!file.endsWith('.json')) continue;
    try {
      const data: PatentCache = JSON.parse(
        fs.readFileSync(path.join(PATENTS_DIR, file), 'utf-8')
      );
      if (data.maxScoreOverall >= threshold) {
        hotPatents.push(data);
      }
    } catch {
      // Skip unreadable files
    }
  }

  return hotPatents.sort((a, b) => b.maxScoreOverall - a.maxScoreOverall);
}

export function getAllPatentCaches(): PatentCache[] {
  if (!fs.existsSync(PATENTS_DIR)) return [];

  const patents: PatentCache[] = [];
  for (const file of fs.readdirSync(PATENTS_DIR)) {
    if (!file.endsWith('.json')) continue;
    try {
      patents.push(JSON.parse(fs.readFileSync(path.join(PATENTS_DIR, file), 'utf-8')));
    } catch {
      // Skip
    }
  }
  return patents;
}

export function getAllProductCaches(): ProductCache[] {
  const files = getAllProductCacheFiles();
  const products: ProductCache[] = [];
  for (const filePath of files) {
    try {
      products.push(JSON.parse(fs.readFileSync(filePath, 'utf-8')));
    } catch {
      // Skip
    }
  }
  return products;
}
