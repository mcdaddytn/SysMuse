/**
 * Composable for CPC code description lookups with caching
 *
 * Provides efficient batch lookups for CPC code descriptions with:
 * - In-memory cache to avoid redundant API calls
 * - Batch lookups for multiple codes at once
 * - Reactive description retrieval
 */

import { ref, computed } from 'vue';
import { cpcApi, type CpcDescription } from '@/services/api';

// Global cache shared across all component instances
const cpcCache = ref<Map<string, CpcDescription | null>>(new Map());
const pendingLookups = ref<Set<string>>(new Set());
const isLoading = ref(false);

// Debounce timer for batch lookups
let batchTimeout: ReturnType<typeof setTimeout> | null = null;
const pendingCodes: Set<string> = new Set();

/**
 * Normalize CPC code for consistent lookups
 * Handles variations like "H04N19/" vs "H04N19"
 */
function normalizeCode(code: string): string {
  // Remove trailing slash for lookup, but keep original for display
  return code.replace(/\/$/, '').toUpperCase();
}

/**
 * Extract the best prefix for lookup when exact code not found
 * e.g., "H04N19/00" -> try "H04N19" -> try "H04N"
 */
function getParentPrefixes(code: string): string[] {
  const normalized = normalizeCode(code);
  const prefixes: string[] = [];

  // Try progressively shorter prefixes
  // H04N19/00 -> H04N19 -> H04N1 -> H04N -> H04 -> H
  let current = normalized;
  while (current.length > 1) {
    // Remove last character or segment
    if (current.includes('/')) {
      current = current.split('/')[0];
    } else {
      current = current.slice(0, -1);
    }
    if (current.length >= 3) {
      prefixes.push(current);
    }
  }

  return prefixes;
}

/**
 * Schedule a batch lookup for pending codes
 */
function scheduleBatchLookup() {
  if (batchTimeout) {
    clearTimeout(batchTimeout);
  }

  batchTimeout = setTimeout(async () => {
    if (pendingCodes.size === 0) return;

    const codesToLookup = Array.from(pendingCodes);
    pendingCodes.clear();

    // Filter out codes we already have cached
    const uncachedCodes = codesToLookup.filter(code => !cpcCache.value.has(normalizeCode(code)));

    if (uncachedCodes.length === 0) return;

    isLoading.value = true;
    try {
      const results = await cpcApi.batchLookup(uncachedCodes.map(normalizeCode));

      // Store results in cache
      for (const [code, description] of Object.entries(results)) {
        cpcCache.value.set(code.toUpperCase(), description);
      }

      // For codes that returned null, try parent prefixes
      for (const code of uncachedCodes) {
        const normalized = normalizeCode(code);
        if (!cpcCache.value.get(normalized)) {
          // Try parent prefixes
          const prefixes = getParentPrefixes(code);
          for (const prefix of prefixes) {
            const cached = cpcCache.value.get(prefix);
            if (cached) {
              // Store the parent's description for this code
              cpcCache.value.set(normalized, cached);
              break;
            }
          }
        }
      }
    } catch (error) {
      console.error('CPC batch lookup failed:', error);
    } finally {
      isLoading.value = false;
    }
  }, 50); // 50ms debounce for batching
}

export function useCpcDescriptions() {
  /**
   * Get description for a single CPC code
   * Returns cached value or schedules a lookup
   */
  function getDescription(code: string): string | null {
    if (!code) return null;

    const normalized = normalizeCode(code);

    // Check cache first
    const cached = cpcCache.value.get(normalized);
    if (cached !== undefined) {
      return cached?.title || null;
    }

    // Check parent prefixes in cache
    const prefixes = getParentPrefixes(code);
    for (const prefix of prefixes) {
      const parentCached = cpcCache.value.get(prefix);
      if (parentCached) {
        return parentCached.title;
      }
    }

    // Schedule lookup
    pendingCodes.add(code);
    scheduleBatchLookup();

    return null; // Will be available on next render
  }

  /**
   * Get full CpcDescription object for a code
   */
  function getCpcInfo(code: string): CpcDescription | null {
    if (!code) return null;

    const normalized = normalizeCode(code);
    const cached = cpcCache.value.get(normalized);

    if (cached !== undefined) {
      return cached;
    }

    // Check parent prefixes
    const prefixes = getParentPrefixes(code);
    for (const prefix of prefixes) {
      const parentCached = cpcCache.value.get(prefix);
      if (parentCached) {
        return parentCached;
      }
    }

    // Schedule lookup
    pendingCodes.add(code);
    scheduleBatchLookup();

    return null;
  }

  /**
   * Pre-load descriptions for multiple codes at once
   */
  async function preloadCodes(codes: string[]): Promise<void> {
    if (codes.length === 0) return;

    const uncachedCodes = codes.filter(code => !cpcCache.value.has(normalizeCode(code)));
    if (uncachedCodes.length === 0) return;

    isLoading.value = true;
    try {
      const results = await cpcApi.batchLookup(uncachedCodes.map(normalizeCode));

      for (const [code, description] of Object.entries(results)) {
        cpcCache.value.set(code.toUpperCase(), description);
      }
    } catch (error) {
      console.error('CPC preload failed:', error);
    } finally {
      isLoading.value = false;
    }
  }

  /**
   * Format a tooltip string for a CPC code
   */
  function formatTooltip(code: string): string {
    const description = getDescription(code);
    if (description) {
      return `${code}: ${description}`;
    }
    return code;
  }

  /**
   * Clear the cache (useful for testing or refresh)
   */
  function clearCache() {
    cpcCache.value.clear();
  }

  return {
    // Methods
    getDescription,
    getCpcInfo,
    preloadCodes,
    formatTooltip,
    clearCache,

    // Reactive state
    isLoading: computed(() => isLoading.value),
    cacheSize: computed(() => cpcCache.value.size),
  };
}
