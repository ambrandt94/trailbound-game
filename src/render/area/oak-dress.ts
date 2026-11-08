import { hash2 } from '../../core/world/noise';

/**
 * Temperate broadleaf kits that currently draw as the generic icosphere canopy.
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
 * Placement and any blocker use this, not the crown (about 2.5–4.5 m).
 */
export const OAK_TRUNK_RADIUS_M = 0.55;

export function isOakKit(kit: string): boolean {
  return OAK_KITS.has(kit);
}

export function oakTrunkRadius(scale: number): number {
  return OAK_TRUNK_RADIUS_M * scale;
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

function pickWeighted(roll: number, weights: readonly number[]): number {
  const sum = weights.reduce((total, weight) => total + weight, 0);
  let cursor = roll * sum;
  for (let i = 0; i < weights.length; i++) {
    cursor -= weights[i] ?? 0;
    if (cursor <= 0) return i;
  }
  return weights.length - 1;
}
