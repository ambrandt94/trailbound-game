import type { Vec3 } from './cube-sphere';
import type { Biome } from '../world/models';
import type { PlanetSample } from './global-layer';

/**
 * World Gen shape sliders, each −1..1 (0 = as authored): sea level (+ drowns
 * coast), temperature (+ warmer, less ice) and moisture (+ wetter).
 */
export interface PlanetShape {
  sea: number;
  temp: number;
  moist: number;
}

export const NEUTRAL_SHAPE: PlanetShape = { sea: 0, temp: 0, moist: 0 };

/** Climate shift per unit of a shape slider, on the 0..1 temp / moist scales. */
export const SHAPE_CLIMATE_GAIN = 0.18;

/** Anything the globe and the chunk generator can read: a seeded function of a sphere point. */
export interface PlanetField {
  readonly seed: number;
  /** Chunks per cube-face edge. */
  readonly n: number;
  sample(v: Vec3): PlanetSample;
  /**
   * Signed land value at a sphere point: > 0 is land, < 0 is sea. Units are
   * the field's own; only the sign and smoothness matter to callers.
   * `fine` adds detail below one mask pixel, for chunk-scale sampling.
   */
  landValue(v: Vec3, fine?: boolean): number;
  /**
   * `sample` plus the slow terms seamless chunk generation interpolates
   * (`world/seamless-terrain.ts`): the same numbers the bake reads.
   */
  point(v: Vec3): FieldPoint;
  /** Signed land value with chunk-scale coast detail (sign only: > 0 is land). */
  fineLand(v: Vec3): number;
  /** Biome of a chunk tile from its (interpolated, detailed) terms, with the bake's thresholds. */
  biomeOf(
    elevM: number,
    temp: number,
    moist: number,
    belt: number,
    cont: number,
    ice: number,
  ): Biome;
}

/** A field sample with the terms chunk generation needs to stay on the bake. */
export interface FieldPoint extends PlanetSample {
  /** `landValue(v)` (coarse, the bake's), in the field's units. */
  lv: number;
  /** 1 on a continental plate, 0 oceanic (Trailbound: always 1). */
  cont: number;
  /** 0..1 polar ice cover. */
  ice: number;
}
