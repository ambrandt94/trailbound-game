/**
 * Planet sizes. A planet is a cube-sphere: 6 faces, each `n × n` chunks, and
 * every chunk is one of today's world maps. Alex's call (Nov 2026): the default
 * planet is 20 maps across a face; `tiny` (4 × 4 per face, 96 chunks) is for tests.
 * No imports, so `models.ts` can use these without a cycle.
 */
export const PLANET_PRESETS = ['standard', 'tiny'] as const;
export type PlanetPreset = (typeof PLANET_PRESETS)[number];

export interface PlanetPresetSpec {
  /** Chunks along one cube-face edge. */
  n: number;
  /** Globe texture side per cube face, in texels. */
  faceTexels: number;
  label: string;
}

export const PLANET_PRESET_SPECS: Record<PlanetPreset, PlanetPresetSpec> = {
  standard: { n: 20, faceTexels: 512, label: '20 maps across (2,400 chunks)' },
  tiny: { n: 4, faceTexels: 256, label: 'Tiny test (4 across, 96 chunks)' },
};

export const DEFAULT_PLANET_PRESET: PlanetPreset = 'standard';

export function isPlanetPreset(value: unknown): value is PlanetPreset {
  return typeof value === 'string' && (PLANET_PRESETS as readonly string[]).includes(value);
}

export function planetChunkCount(preset: PlanetPreset): number {
  const n = PLANET_PRESET_SPECS[preset].n;
  return 6 * n * n;
}

/**
 * Where a world's land comes from.
 * - `island`: the classic hand-tuned home map; the globe is procedural around it.
 *   Saves from before world sources read this.
 * - `trailbound`: the default authored world (Alex's continents).
 * - `procedural`: seeded plate continents.
 */
export const WORLD_SOURCES = ['trailbound', 'procedural', 'island'] as const;
export type WorldSource = (typeof WORLD_SOURCES)[number];

export function isWorldSource(value: unknown): value is WorldSource {
  return typeof value === 'string' && (WORLD_SOURCES as readonly string[]).includes(value);
}

export const WORLD_SOURCE_LABELS: Record<WorldSource, string> = {
  trailbound: 'Trailbound (authored continents)',
  procedural: 'Procedural planet',
  island: 'Classic island',
};
