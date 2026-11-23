/**
 * Cut a world map out of a planet: the land, coast and climate of one chunk
 * come from the planet field, so the map is a sample of a continent rather
 * than an island of its own. Neighbouring chunks read the same field, so
 * their coasts and climate line up across the border (M2c builds on this).
 */
import {
  chunkSeed,
  chunkToSphere,
  defaultStartChunk,
  homeChunk,
  makePlanetField,
  PLANET_PRESET_SPECS,
  sameChunk,
  type ChunkAddr,
  type PlanetField,
  type PlanetShape,
} from '../planet';
import type { WorldSettings } from './models';
import { landCut, type LatAt } from './terrain';

/** Mask value per unit of `PlanetField.landValue` (≈ mask pixels; 10 is well inland). */
const LAND_GAIN = 0.045;
/** Most land samples per chunk side; finer coarse cells read them bilinearly. */
const MAX_LAND_GRID = 385;

export interface PlanetFrame {
  field: PlanetField;
  n: number;
  home: ChunkAddr;
}

/** The planet behind a world's settings and its home chunk (picked when the settings leave it open). */
export function planetFrame(seed: number, settings: WorldSettings): PlanetFrame {
  const n = PLANET_PRESET_SPECS[settings.planet].n;
  if (settings.worldSource === 'island') {
    // The classic island sits on face 0's centre chunk inside the procedural globe.
    const home = homeChunk(n);
    return { field: makePlanetField({ source: 'island', seed, n, home }), n, home };
  }
  const field = makePlanetField({
    source: settings.worldSource,
    seed,
    n,
    shape: settingsShape(settings),
  });
  const picked = settings.homeChunk;
  // A hand-picked start must have room for towns; open sea falls back to the auto pick.
  const home =
    picked && chunkLandShare(field, picked, 12) >= MIN_HOME_LAND
      ? picked
      : defaultStartChunk(field);
  return { field, n, home };
}

/** The World Gen shape sliders stored in a world's settings. */
export function settingsShape(settings: WorldSettings): PlanetShape {
  return { sea: settings.seaLevel, temp: settings.tempBias, moist: settings.moistBias };
}

/** Least land share a picked home chunk needs (the auto pick asks for much more). */
export const MIN_HOME_LAND = 0.2;

/** Share of a chunk the planet calls land, from a `k`×`k` grid of samples. */
export function chunkLandShare(field: PlanetField, addr: ChunkAddr, k = 12): number {
  let land = 0;
  for (let j = 0; j < k; j++) {
    for (let i = 0; i < k; i++) {
      if (field.landValue(chunkToSphere(field.n, addr, (i + 0.5) / k, (j + 0.5) / k)) > 0) land++;
    }
  }
  return land / (k * k);
}

/** Terrain seed of a chunk: the home chunk keeps the world seed. */
export function chunkTerrainSeed(seed: number, frame: PlanetFrame, addr: ChunkAddr): number {
  return sameChunk(addr, frame.home) ? seed >>> 0 : chunkSeed(seed, addr, frame.home);
}

/**
 * `landAt(nx, ny)` for `buildTerrain`: the planet's land value across the
 * chunk, mapped onto the classic mask scale so land is exactly where the
 * planet says (`mask > landCut('continent')` ⇔ `landValue > 0`).
 */
export function planetLandSampler(
  field: PlanetField,
  addr: ChunkAddr,
  coarseCells: number,
): (nx: number, ny: number) => number {
  const g = Math.max(2, Math.min(MAX_LAND_GRID, coarseCells + 1));
  const cut = landCut('continent');
  const grid = new Float32Array(g * g);
  for (let j = 0; j < g; j++) {
    for (let i = 0; i < g; i++) {
      const lv = field.landValue(chunkToSphere(field.n, addr, i / (g - 1), j / (g - 1)), true);
      grid[i + j * g] = lv;
    }
  }
  return (nx, ny) => {
    const x = Math.min(g - 1.0001, Math.max(0, nx * (g - 1)));
    const y = Math.min(g - 1.0001, Math.max(0, ny * (g - 1)));
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const tx = x - x0;
    const ty = y - y0;
    const a = grid[x0 + y0 * g]!;
    const b = grid[x0 + 1 + y0 * g]!;
    const c = grid[x0 + (y0 + 1) * g]!;
    const d = grid[x0 + 1 + (y0 + 1) * g]!;
    const lv = a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
    const mask = cut + lv * LAND_GAIN;
    return mask < 0 ? 0 : mask > 1 ? 1 : mask;
  };
}

/** Real latitude (radians) to the classic 0 (polar) … 1 (tropical) climate scale. */
export function climateLatitude(latRad: number): number {
  const deg = (Math.abs(latRad) * 180) / Math.PI;
  const t = 0.97 * (1 - deg / 76);
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/**
 * Each row's climate from its real latitude on the planet (read down the
 * chunk's middle). `tempBias` (the World Gen slider, −1..1) warms or cools it.
 */
export function planetLatAt(n: number, addr: ChunkAddr, tempBias = 0): LatAt {
  const shift = tempBias * CHUNK_TEMP_GAIN;
  return (y, height) => {
    const p = chunkToSphere(n, addr, 0.5, Math.min(1, Math.max(0, y / Math.max(1, height))));
    const t = climateLatitude(Math.asin(Math.max(-1, Math.min(1, p[1])))) + shift;
    return t < 0 ? 0 : t > 1 ? 1 : t;
  };
}

/** Climate-latitude shift per unit of the temperature slider (±1 ≈ ±18° of latitude). */
const CHUNK_TEMP_GAIN = 0.23;
/** Land moisture shift per unit of the moisture slider. */
export const CHUNK_MOIST_GAIN = 0.18;
