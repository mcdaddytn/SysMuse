/**
 * Cache Service
 *
 * Manages caching of API and LLM responses with:
 * - File system storage for response data
 * - Database metadata for lookups and tracking
 * - Support for export/import between dev machines
 */

import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

// Base directory for cache files (relative to project root)
const CACHE_BASE_DIR = path.join(process.cwd(), 'cache');

/**
 * Get the base cache directory path
 */
export function getCachePath(...subPaths: string[]): string {
  return path.join(CACHE_BASE_DIR, ...subPaths);
}

// =============================================================================
// API CACHE
// =============================================================================

export interface ApiCacheEntry {
  endpoint: string;      // patentsview, file-wrapper, ptab
  requestType: string;   // patent, citations, application, ipr
  requestKey: string;    // patent_id, application_number, etc.
  data: unknown;
  statusCode?: number;
  errorMessage?: string;
}

/**
 * Get the file path for an API cache entry
 */
function getApiCacheFilePath(endpoint: string, requestType: string, requestKey: string): string {
  // Sanitize requestKey for filesystem (replace slashes, etc.)
  const safeKey = requestKey.replace(/[\/\\:*?"<>|]/g, '_');
  return path.join('api', endpoint, requestType, `${safeKey}.json`);
}

/**
 * Check if an API response is cached
 */
export async function isApiCached(
  endpoint: string,
  requestType: string,
  requestKey: string
): Promise<boolean> {
  const entry = await prisma.apiRequestCache.findUnique({
    where: {
      endpoint_requestType_requestKey: { endpoint, requestType, requestKey }
    }
  });
  return entry !== null;
}

/**
 * Get a cached API response
 * Returns null if not cached or file doesn't exist
 */
export async function getApiCache<T = unknown>(
  endpoint: string,
  requestType: string,
  requestKey: string
): Promise<T | null> {
  const entry = await prisma.apiRequestCache.findUnique({
    where: {
      endpoint_requestType_requestKey: { endpoint, requestType, requestKey }
    }
  });

  if (!entry) return null;

  const fullPath = path.join(CACHE_BASE_DIR, entry.filePath);
  if (!fs.existsSync(fullPath)) {
    console.warn(`Cache file missing: ${fullPath}`);
    return null;
  }

  const data = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
  return data as T;
}

/**
 * Save an API response to cache
 */
export async function setApiCache(entry: ApiCacheEntry): Promise<void> {
  const { endpoint, requestType, requestKey, data, statusCode = 200, errorMessage } = entry;
  const relativePath = getApiCacheFilePath(endpoint, requestType, requestKey);
  const fullPath = path.join(CACHE_BASE_DIR, relativePath);

  // Ensure directory exists
  const dir = path.dirname(fullPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Write data to file
  const jsonData = JSON.stringify(data, null, 2);
  fs.writeFileSync(fullPath, jsonData, 'utf-8');
  const fileSize = Buffer.byteLength(jsonData, 'utf-8');

  // Upsert metadata to database
  await prisma.apiRequestCache.upsert({
    where: {
      endpoint_requestType_requestKey: { endpoint, requestType, requestKey }
    },
    create: {
      endpoint,
      requestType,
      requestKey,
      filePath: relativePath,
      fileSize,
      statusCode,
      errorMessage,
    },
    update: {
      filePath: relativePath,
      fileSize,
      statusCode,
      errorMessage,
    }
  });
}

// =============================================================================
// LLM CACHE
// =============================================================================

export interface LlmCacheEntry {
  promptType: string;    // patent-analysis, sector-classification
  entityKey: string;     // patent_id or other identifier
  model: string;         // claude-sonnet-4-20250514, etc.
  data: unknown;
  inputTokens?: number;
  outputTokens?: number;
}

/**
 * Get the file path for an LLM cache entry
 */
function getLlmCacheFilePath(promptType: string, entityKey: string, model: string): string {
  const safeKey = entityKey.replace(/[\/\\:*?"<>|]/g, '_');
  const safeModel = model.replace(/[\/\\:*?"<>|]/g, '_');
  return path.join('llm', promptType, `${safeKey}_${safeModel}.json`);
}

/**
 * Check if an LLM response is cached
 */
export async function isLlmCached(
  promptType: string,
  entityKey: string,
  model: string
): Promise<boolean> {
  const entry = await prisma.llmResponseCache.findUnique({
    where: {
      promptType_entityKey_model: { promptType, entityKey, model }
    }
  });
  return entry !== null;
}

/**
 * Get a cached LLM response
 */
export async function getLlmCache<T = unknown>(
  promptType: string,
  entityKey: string,
  model: string
): Promise<T | null> {
  const entry = await prisma.llmResponseCache.findUnique({
    where: {
      promptType_entityKey_model: { promptType, entityKey, model }
    }
  });

  if (!entry) return null;

  const fullPath = path.join(CACHE_BASE_DIR, entry.filePath);
  if (!fs.existsSync(fullPath)) {
    console.warn(`Cache file missing: ${fullPath}`);
    return null;
  }

  const data = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
  return data as T;
}

/**
 * Save an LLM response to cache
 */
export async function setLlmCache(entry: LlmCacheEntry): Promise<void> {
  const { promptType, entityKey, model, data, inputTokens, outputTokens } = entry;
  const relativePath = getLlmCacheFilePath(promptType, entityKey, model);
  const fullPath = path.join(CACHE_BASE_DIR, relativePath);

  // Ensure directory exists
  const dir = path.dirname(fullPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Write data to file
  const jsonData = JSON.stringify(data, null, 2);
  fs.writeFileSync(fullPath, jsonData, 'utf-8');
  const fileSize = Buffer.byteLength(jsonData, 'utf-8');

  // Upsert metadata to database
  await prisma.llmResponseCache.upsert({
    where: {
      promptType_entityKey_model: { promptType, entityKey, model }
    },
    create: {
      promptType,
      entityKey,
      model,
      filePath: relativePath,
      fileSize,
      inputTokens,
      outputTokens,
    },
    update: {
      filePath: relativePath,
      fileSize,
      inputTokens,
      outputTokens,
    }
  });
}

// =============================================================================
// SYNC / IMPORT UTILITIES
// =============================================================================

/**
 * Sync database metadata from existing cache files
 * Run this after copying cache folder to a new machine
 */
export async function syncApiCacheFromFiles(): Promise<{ found: number; synced: number }> {
  const apiDir = path.join(CACHE_BASE_DIR, 'api');
  let found = 0;
  let synced = 0;

  if (!fs.existsSync(apiDir)) {
    return { found, synced };
  }

  // Walk through api/{endpoint}/{requestType}/*.json
  const endpoints = fs.readdirSync(apiDir);
  for (const endpoint of endpoints) {
    const endpointPath = path.join(apiDir, endpoint);
    if (!fs.statSync(endpointPath).isDirectory()) continue;

    const requestTypes = fs.readdirSync(endpointPath);
    for (const requestType of requestTypes) {
      const typePath = path.join(endpointPath, requestType);
      if (!fs.statSync(typePath).isDirectory()) continue;

      const files = fs.readdirSync(typePath).filter(f => f.endsWith('.json'));
      for (const file of files) {
        found++;
        const requestKey = file.replace('.json', '');
        const relativePath = path.join('api', endpoint, requestType, file);
        const fullPath = path.join(CACHE_BASE_DIR, relativePath);
        const stats = fs.statSync(fullPath);

        // Check if already in DB
        const existing = await prisma.apiRequestCache.findUnique({
          where: {
            endpoint_requestType_requestKey: { endpoint, requestType, requestKey }
          }
        });

        if (!existing) {
          await prisma.apiRequestCache.create({
            data: {
              endpoint,
              requestType,
              requestKey,
              filePath: relativePath,
              fileSize: stats.size,
              statusCode: 200,
            }
          });
          synced++;
        }
      }
    }
  }

  return { found, synced };
}

/**
 * Sync LLM cache database from existing files
 */
export async function syncLlmCacheFromFiles(): Promise<{ found: number; synced: number }> {
  const llmDir = path.join(CACHE_BASE_DIR, 'llm');
  let found = 0;
  let synced = 0;

  if (!fs.existsSync(llmDir)) {
    return { found, synced };
  }

  // Walk through llm/{promptType}/*.json
  const promptTypes = fs.readdirSync(llmDir);
  for (const promptType of promptTypes) {
    const typePath = path.join(llmDir, promptType);
    if (!fs.statSync(typePath).isDirectory()) continue;

    const files = fs.readdirSync(typePath).filter(f => f.endsWith('.json'));
    for (const file of files) {
      found++;

      // Parse filename: {entityKey}_{model}.json
      const baseName = file.replace('.json', '');
      const lastUnderscore = baseName.lastIndexOf('_');
      if (lastUnderscore === -1) continue;

      const entityKey = baseName.substring(0, lastUnderscore);
      const model = baseName.substring(lastUnderscore + 1);

      const relativePath = path.join('llm', promptType, file);
      const fullPath = path.join(CACHE_BASE_DIR, relativePath);
      const stats = fs.statSync(fullPath);

      const existing = await prisma.llmResponseCache.findUnique({
        where: {
          promptType_entityKey_model: { promptType, entityKey, model }
        }
      });

      if (!existing) {
        await prisma.llmResponseCache.create({
          data: {
            promptType,
            entityKey,
            model,
            filePath: relativePath,
            fileSize: stats.size,
          }
        });
        synced++;
      }
    }
  }

  return { found, synced };
}

/**
 * Get cache statistics
 */
export async function getCacheStats(): Promise<{
  apiCache: { count: number; totalSize: number };
  llmCache: { count: number; totalSize: number; totalTokens: { input: number; output: number } };
}> {
  const apiStats = await prisma.apiRequestCache.aggregate({
    _count: true,
    _sum: { fileSize: true }
  });

  const llmStats = await prisma.llmResponseCache.aggregate({
    _count: true,
    _sum: { fileSize: true, inputTokens: true, outputTokens: true }
  });

  return {
    apiCache: {
      count: apiStats._count,
      totalSize: apiStats._sum.fileSize || 0
    },
    llmCache: {
      count: llmStats._count,
      totalSize: llmStats._sum.fileSize || 0,
      totalTokens: {
        input: llmStats._sum.inputTokens || 0,
        output: llmStats._sum.outputTokens || 0
      }
    }
  };
}

// =============================================================================
// CLI INTERFACE
// =============================================================================

async function main() {
  const command = process.argv[2];

  switch (command) {
    case 'stats':
      const stats = await getCacheStats();
      console.log('\nCache Statistics:');
      console.log('─────────────────');
      console.log(`API Cache: ${stats.apiCache.count} entries, ${(stats.apiCache.totalSize / 1024 / 1024).toFixed(2)} MB`);
      console.log(`LLM Cache: ${stats.llmCache.count} entries, ${(stats.llmCache.totalSize / 1024 / 1024).toFixed(2)} MB`);
      console.log(`  Tokens: ${stats.llmCache.totalTokens.input.toLocaleString()} input, ${stats.llmCache.totalTokens.output.toLocaleString()} output`);
      break;

    case 'sync':
      console.log('Syncing cache files to database...');
      const apiResult = await syncApiCacheFromFiles();
      console.log(`API Cache: Found ${apiResult.found} files, synced ${apiResult.synced} new entries`);
      const llmResult = await syncLlmCacheFromFiles();
      console.log(`LLM Cache: Found ${llmResult.found} files, synced ${llmResult.synced} new entries`);
      break;

    default:
      console.log('Usage: npx tsx services/cache-service.ts <command>');
      console.log('Commands:');
      console.log('  stats  - Show cache statistics');
      console.log('  sync   - Sync cache files to database (run after copying cache folder)');
  }

  await prisma.$disconnect();
}

// Run CLI if executed directly
if (process.argv[1]?.includes('cache-service')) {
  main().catch(console.error);
}
