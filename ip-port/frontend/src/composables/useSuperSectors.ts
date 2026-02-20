/**
 * Shared composable for super-sector data (loaded from DB via API).
 *
 * Replaces hardcoded sectorColors and superSectorOptions across pages.
 * Uses a singleton cache so the API is called at most once per session.
 */

import { ref, computed } from 'vue';
import { sectorApi } from '@/services/api';
import type { SuperSectorDetail } from '@/types';

// ─────────────────────────────────────────────────────────────────────────────
// Singleton state (shared across all components that call useSuperSectors)
// ─────────────────────────────────────────────────────────────────────────────

const superSectors = ref<SuperSectorDetail[]>([]);
const loaded = ref(false);
const loading = ref(false);

// Default color assignments by canonical name.
// These are fallbacks — the DB could eventually store colors per super-sector.
const COLOR_BY_NAME: Record<string, string> = {
  VIDEO_STREAMING: 'orange-7',
  SECURITY: 'red-7',
  NETWORKING: 'blue-7',
  COMPUTING: 'grey-7',
  SEMICONDUCTOR: 'indigo-7',
  IMAGING: 'cyan-7',
  WIRELESS: 'teal-7',
  AI_ML: 'green-7',
  VIRTUALIZATION: 'purple-7',
  SDN_NETWORK: 'blue-7',
  FAULT_TOLERANCE: 'amber-7',
  AUDIO: 'pink-7',
};

const DEFAULT_COLOR = 'grey-6';

// ─────────────────────────────────────────────────────────────────────────────
// Build reverse maps (canonical → display, display → canonical, both → color)
// ─────────────────────────────────────────────────────────────────────────────

// Eagerly-rebuilt color lookup keyed by both canonical name AND displayName,
// so getSectorColor() works regardless of which format a patent row stores.
const colorLookup = computed(() => {
  const map: Record<string, string> = { ...COLOR_BY_NAME };
  for (const ss of superSectors.value) {
    // canonical name → color
    if (!map[ss.name]) {
      map[ss.name] = DEFAULT_COLOR;
    }
    // display name → same color
    if (ss.displayName && ss.displayName !== ss.name) {
      map[ss.displayName] = map[ss.name] || DEFAULT_COLOR;
    }
  }
  return map;
});

// ─────────────────────────────────────────────────────────────────────────────
// API
// ─────────────────────────────────────────────────────────────────────────────

let loadPromise: Promise<void> | null = null;

async function ensureLoaded(): Promise<void> {
  if (loaded.value) return;
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    loading.value = true;
    try {
      superSectors.value = await sectorApi.getSuperSectors();
      loaded.value = true;
    } catch (err) {
      console.error('[useSuperSectors] Failed to load:', err);
    } finally {
      loading.value = false;
    }
  })();
  return loadPromise;
}

/** Force-reload from API (e.g., after creating a new super-sector). */
async function reload(): Promise<void> {
  loaded.value = false;
  loadPromise = null;
  await ensureLoaded();
}

// ─────────────────────────────────────────────────────────────────────────────
// Composable
// ─────────────────────────────────────────────────────────────────────────────

export function useSuperSectors() {
  // Kick off load on first use
  ensureLoaded();

  /** Color for any super-sector string (canonical or display name). */
  function getSectorColor(sector: string): string {
    return colorLookup.value[sector] || DEFAULT_COLOR;
  }

  /**
   * Resolve any super-sector string (canonical or display) to display name.
   * Handles mixed DB states where some patents store "COMPUTING" and others
   * store "Computing & Data".
   */
  function getDisplayName(sector: string): string {
    if (!sector) return 'Unknown';
    // Try canonical match first
    const byName = superSectors.value.find(s => s.name === sector);
    if (byName) return byName.displayName;
    // Already a display name?
    const byDisplay = superSectors.value.find(s => s.displayName === sector);
    if (byDisplay) return byDisplay.displayName;
    // Unknown — return as-is
    return sector;
  }

  /** Options list suitable for q-select dropdowns (display names as labels). */
  const superSectorOptions = computed(() =>
    superSectors.value.map(ss => ss.displayName)
  );

  /** Options list with {label, value} for more structured dropdowns. */
  const superSectorSelectOptions = computed(() =>
    superSectors.value.map(ss => ({ label: ss.displayName, value: ss.name }))
  );

  return {
    superSectors,
    loading,
    loaded,
    getSectorColor,
    getDisplayName,
    superSectorOptions,
    superSectorSelectOptions,
    reload,
    ensureLoaded,
  };
}
