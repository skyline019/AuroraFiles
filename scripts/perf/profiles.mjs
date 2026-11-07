/**
 * Extreme-matrix profiles for Aurora Files perf baseline.
 * Counts can be capped via AURORA_PERF_FILES_CAP (applies to S-files only).
 */

const filesCap = Number(process.env.AURORA_PERF_FILES_CAP) || 50_000;

/** @typedef {{ id: string, label: string, files: number, depth: number, maxScan: number, uiItems: number, previewImages: number, query: string }} PerfProfile */

/** @type {Record<string, PerfProfile>} */
export const PROFILES = {
  'S-mem': {
    id: 'S-mem',
    label: 'Small-memory / mid folder',
    files: 5_000,
    depth: 4,
    maxScan: 12_000,
    uiItems: 5_000,
    previewImages: 24,
    query: 'report',
  },
  'S-files': {
    id: 'S-files',
    label: 'Huge directory',
    files: Math.min(50_000, filesCap),
    depth: 5,
    maxScan: 80_000,
    uiItems: Math.min(20_000, filesCap),
    previewImages: 8,
    query: 'needle',
  },
  'S-search': {
    id: 'S-search',
    label: 'Cold→hot search convergence',
    files: 4_000,
    depth: 5,
    maxScan: 40_000,
    uiItems: 2_000,
    previewImages: 4,
    query: 'needle_',
  },
  'S-preview': {
    id: 'S-preview',
    label: 'Preview quality + reclaim',
    files: 1_500,
    depth: 3,
    maxScan: 20_000,
    uiItems: 800,
    previewImages: 64,
    query: 'IMG_',
  },
};

export function selectedProfiles() {
  const raw = process.env.AURORA_PERF_PROFILES;
  if (!raw || !raw.trim()) return Object.values(PROFILES);
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((id) => PROFILES[id])
    .filter(Boolean);
}
