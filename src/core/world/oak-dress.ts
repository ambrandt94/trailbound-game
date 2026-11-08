import { Biome } from './models';
import { hash2 } from './noise';

/**
 * Temperate broadleaf kits that draw as authored oaks.
 * Conifers, palms, snags, willows, and other biomes stay on their placeholders.
 */
const OAK_KITS = new Set([
  'tree_oak_s',
  'tree_oak_m',
  'tree_oak_l',
  'tree_birch_s',
  'tree_birch_m',
  'tree_birch_l',
  'tree_beech_s',
  'tree_beech_m',
  'tree_beech_l',
  'tree_maple_s',
  'tree_maple_m',
  'tree_maple_l',
  'tree_hawthorn_s',
  'tree_fruit_apple_s',
]);

export const OAK_VARIANTS = ['base', 'spreading', 'upright', 'windswept'] as const;
export type OakVariantId = (typeof OAK_VARIANTS)[number];

/** Base is half the weight. The other three silhouettes share the rest. */
const VARIANT_WEIGHTS = [5, 2, 2, 1] as const;

export const OAK_MORPH_KEYS = [
  'crown_spread',
  'crown_height',
  'trunk_lean',
  'trunk_thickness',
] as const;
export type OakMorphKey = (typeof OAK_MORPH_KEYS)[number];
export type OakMorphs = Record<OakMorphKey, number>;

/** Safe subset of the authored [-1, 1] sliders. Trunk lean stays modest. */
export const OAK_MORPH_RANGES: Record<OakMorphKey, readonly [number, number]> = {
  crown_spread: [-0.6, 0.6],
  crown_height: [-0.55, 0.7],
  trunk_lean: [-0.25, 0.25],
  trunk_thickness: [-0.4, 0.5],
};

const MORPH_STEP = 0.05;
const SCALE_MIN = 0.85;
const SCALE_MAX = 1.15;
/** Occasional dark bark from the wood pool. Not a fifth mesh. */
const IRONBARK_CHANCE = 0.12;

/**
 * Horizontal trunk half-extent at scale 1, in metres.
 * Blockers use this, not the crown.
 */
export const OAK_TRUNK_RADIUS_M = 0.55;

/**
 * Rest-pose horizontal crown radius, in metres, measured from each GLB's
 * foliage primitive. crown_spread at +1 adds the second value.
 */
const CROWN_REST: Record<OakVariantId, readonly [number, number]> = {
  base: [2.9, 0.725],
  spreading: [4.6, 1.15],
  upright: [1.55, 0.3875],
  windswept: [4.1, 1.025],
};

/**
 * Forest crowns may overlap by this fraction of the smaller radius.
 * 0.225 is a light overlap: centres sit at rA + rB − 0.225·min(r).
 */
export const FOREST_CROWN_OVERLAP = 0.225;

/**
 * Plains and Meadow keep this much extra gap, as a fraction of the smaller
 * radius, so trees inside a clump do not fuse into one canopy.
 */
export const OPEN_CROWN_GAP = 0.22;

/** Grove lattice for the open biomes. Seeds are scattered; each one is a copse. */
const GROVE_CELL = 24;
const GROVE_SEED = 0.52;
const GROVE_REACH = 9;

export function isOakKit(kit: string): boolean {
  return OAK_KITS.has(kit);
}

export function oakTrunkRadius(scale: number): number {
  return OAK_TRUNK_RADIUS_M * scale;
}

/** Plains and Meadow. Forest and every other biome stay on the overlap rule. */
export function oakBiomeIsOpen(biome: string | number | undefined): boolean {
  if (typeof biome === 'number') return biome === Biome.Plains || biome === Biome.Meadow;
  return biome === 'Plains' || biome === 'Meadow';
}

/** Crown radius after scale and the crown_spread morph. Trunk lean does not change it. */
export function oakCrownRadius(instance: OakInstance): number {
  const [rest, spread] = CROWN_REST[instance.variant];
  const raw = (rest + instance.morph.crown_spread * spread) * instance.scale;
  return Math.max(0.8, raw);
}

/** Minimum trunk-to-trunk distance so the crowns overlap only as the biome allows. */
export function oakMinDistance(radiusA: number, radiusB: number, open: boolean): number {
  const smaller = Math.min(radiusA, radiusB);
  const overlap = open ? -OPEN_CROWN_GAP : FOREST_CROWN_OVERLAP;
  return radiusA + radiusB - overlap * smaller;
}

/** True when this point sits in a plains/meadow copse. Deterministic for the area seed. */
export function oakInGrove(seed: number, x: number, z: number): boolean {
  const gx = Math.floor(x / GROVE_CELL);
  const gz = Math.floor(z / GROVE_CELL);
  for (let oz = -1; oz <= 1; oz++) {
    for (let ox = -1; ox <= 1; ox++) {
      const roll = hash2(gx + ox, gz + oz, seed + 701);
      if (roll < GROVE_SEED) continue;
      const cx = (gx + ox + 0.5) * GROVE_CELL;
      const cz = (gz + oz + 0.5) * GROVE_CELL;
      const reach = GROVE_REACH + (roll - GROVE_SEED) * 14;
      if (Math.hypot(x - cx, z - cz) <= reach) return true;
    }
  }
  return false;
}

export function quantizeStep(value: number, step: number, min: number, max: number): number {
  const clamped = Math.min(max, Math.max(min, value));
  const snapped = Math.round(clamped / step) * step;
  const fixed = Math.round(snapped * 1000) / 1000;
  if (fixed < min) return min;
  if (fixed > max) return max;
  return fixed;
}

export interface OakInstance {
  variant: OakVariantId;
  yaw: number;
  scale: number;
  ironbark: boolean;
  morph: OakMorphs;
}

/**
 * One oak from the area seed and the instance position.
 * The same inputs always return the same variant, yaw, scale, and morphs.
 */
export function pickOakInstance(seed: number, x: number, z: number): OakInstance {
  const ix = Math.round(x * 10);
  const iz = Math.round(z * 10);
  const variantRoll = hash2(ix, iz, seed + 101);
  const yawRoll = hash2(ix + 3, iz + 5, seed + 103);
  const scaleRoll = hash2(ix + 7, iz + 1, seed + 107);
  const ironRoll = hash2(ix + 11, iz + 13, seed + 109);
  const variant = OAK_VARIANTS[pickWeighted(variantRoll, VARIANT_WEIGHTS)] ?? 'base';
  const morph = {} as OakMorphs;
  OAK_MORPH_KEYS.forEach((key, index) => {
    const roll = hash2(ix + 17 + index, iz + 19, seed + 111 + index);
    const range = OAK_MORPH_RANGES[key];
    morph[key] = quantizeStep(
      range[0] + roll * (range[1] - range[0]),
      MORPH_STEP,
      range[0],
      range[1],
    );
  });
  return {
    variant,
    yaw: yawRoll * Math.PI * 2,
    scale: quantizeStep(
      SCALE_MIN + scaleRoll * (SCALE_MAX - SCALE_MIN),
      MORPH_STEP,
      SCALE_MIN,
      SCALE_MAX,
    ),
    ironbark: ironRoll < IRONBARK_CHANCE,
    morph,
  };
}

export interface OakSpot {
  x: number;
  z: number;
  kit: string;
  biome?: string | number;
}

export interface KeptOak extends OakSpot {
  radius: number;
  instance: OakInstance;
}

/**
 * Greedy crown spacing. The winner inside a conflict is chosen by a hash of
 * its position, so the kept set does not depend on input order.
 * Anchors are oaks already accepted (another scatter in the same area).
 * Plains and Meadow also drop anything outside a grove, which leaves glades.
 */
export function selectOaks(
  candidates: readonly OakSpot[],
  seed: number,
  anchors: readonly KeptOak[] = [],
): KeptOak[] {
  const ranked = candidates.map((spot, index) => ({
    spot,
    index,
    rank: hash2(Math.round(spot.x * 10), Math.round(spot.z * 10), seed + 809),
  }));
  ranked.sort((a, b) => a.rank - b.rank || a.index - b.index);
  const placed: KeptOak[] = anchors.map((anchor) => ({ ...anchor }));
  const fresh: KeptOak[] = [];
  for (const { spot } of ranked) {
    const instance = pickOakInstance(seed, spot.x, spot.z);
    const radius = oakCrownRadius(instance);
    const open = oakBiomeIsOpen(spot.biome);
    if (open && !oakInGrove(seed, spot.x, spot.z)) continue;
    if (placed.some((other) => conflicts(spot.x, spot.z, radius, open, other))) continue;
    const kept: KeptOak = { ...spot, radius, instance };
    placed.push(kept);
    fresh.push(kept);
  }
  return fresh;
}

function conflicts(x: number, z: number, radius: number, open: boolean, other: KeptOak): boolean {
  const distance = Math.hypot(x - other.x, z - other.z);
  const eitherOpen = open || oakBiomeIsOpen(other.biome);
  return distance < oakMinDistance(radius, other.radius, eitherOpen);
}

function pickWeighted(roll: number, weights: readonly number[]): number {
  const sum = weights.reduce((total, weight) => total + weight, 0);
  let cursor = roll * sum;
  for (let i = 0; i < weights.length; i++) {
    cursor -= weights[i] ?? 0;
    if (cursor <= 0) return i;
  }
  return weights.length - 1;
}
