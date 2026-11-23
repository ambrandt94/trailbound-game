/**
 * The default "Trailbound" world: continents shaped by Alex's reference map,
 * with coast detail, relief and climate from our own noise. The reference's
 * colours and biome placement are ignored; only its land/ice shape is used.
 *
 * Projection: the mask is equirectangular over the full turn of longitude
 * (lon = atan2(x, z), so its centre column is the home face's centre). The
 * source was 1920×888 (2.16:1), read as a 2:1 map cropped at ±83.25°, so its
 * rows span that band and everything poleward is ice.
 */
import { Biome } from '../world/models';
import landJson from './data/trailbound-land.json';
import iceJson from './data/trailbound-ice.json';
import type { Vec3 } from './cube-sphere';
import { NEUTRAL_SHAPE, SHAPE_CLIMATE_GAIN, type PlanetField, type PlanetShape } from './field';
import { classify, type PlanetSample } from './global-layer';
import { decodeRle, sampleField, signedDistance, type RleMask } from './mask';
import { fbm3, ridged3 } from './noise3';

/** Latitude band the mask rows cover (the 2.16:1 source read as a cropped 2:1 map). */
export const TRAILBOUND_LAT_SPAN = (Math.PI / 2) * (888 / 960);

/**
 * Default sea level in mask pixels (1 px ≈ 0.35°). Tuned so the world is
 * about 34% land by area, like the reference (tests/core/trailbound-layer.test.ts).
 */
export const TRAILBOUND_SEA_LEVEL = 0;

interface MaskFields {
  w: number;
  h: number;
  land: Float32Array;
  ice: Float32Array;
}

let fields: MaskFields | null = null;

/** Decoded once per thread (about 40 ms), shared by every layer. */
export function trailboundMasks(): MaskFields {
  if (fields) return fields;
  const land = decodeRle(landJson as RleMask);
  const ice = decodeRle(iceJson as RleMask);
  fields = { w: land.w, h: land.h, land: signedDistance(land, 64), ice: signedDistance(ice, 16) };
  return fields;
}

export interface TrailboundOptions {
  seed: number;
  n: number;
  /** Mask pixels of sea level; higher drowns more coast. */
  seaLevel?: number;
  /** Coast wobble, 0 = the reference's exact line, 1 = default. */
  roughness?: number;
  /** World Gen sliders; `shape.sea` adds `TRAILBOUND_SEA_PER_UNIT` px per unit. */
  shape?: PlanetShape;
}

/** Mask pixels of sea level per unit of the sea slider (±1 ≈ ±2.8°, the land share ±~15 points). */
export const TRAILBOUND_SEA_PER_UNIT = 8;
/** Ice-edge shift in mask pixels per unit of the temperature slider (warmer shrinks the caps). */
const ICE_PER_TEMP = 10;

function norm(x: number, y: number, z: number): Vec3 {
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export class TrailboundLayer implements PlanetField {
  readonly seed: number;
  readonly n: number;
  readonly seaLevel: number;
  readonly roughness: number;
  readonly shape: PlanetShape;
  private readonly m: MaskFields;

  constructor(opts: TrailboundOptions) {
    this.seed = opts.seed >>> 0;
    this.n = Math.max(1, Math.floor(opts.n));
    this.shape = opts.shape ?? NEUTRAL_SHAPE;
    this.seaLevel =
      (opts.seaLevel ?? TRAILBOUND_SEA_LEVEL) + this.shape.sea * TRAILBOUND_SEA_PER_UNIT;
    this.roughness = opts.roughness ?? 1;
    this.m = trailboundMasks();
  }

  /** Mask uv (pixels) of a sphere point after the seeded coast warp, or null past the mask's polar rows. */
  private maskPx(v: Vec3): { x: number; y: number } | null {
    const s = this.seed;
    const r = 0.035 * this.roughness;
    const q =
      r > 0
        ? norm(
            v[0] + (fbm3(v[0] * 9, v[1] * 9, v[2] * 9, s + 11, 3) - 0.5) * r,
            v[1] + (fbm3(v[0] * 9 + 5.1, v[1] * 9, v[2] * 9, s + 23, 3) - 0.5) * r,
            v[2] + (fbm3(v[0] * 9, v[1] * 9 + 9.7, v[2] * 9, s + 37, 3) - 0.5) * r,
          )
        : v;
    const lat = Math.asin(Math.max(-1, Math.min(1, q[1])));
    if (Math.abs(lat) >= TRAILBOUND_LAT_SPAN) return null;
    const lon = Math.atan2(q[0], q[2]);
    return {
      x: (lon / (2 * Math.PI) + 0.5) * this.m.w,
      y: (0.5 - lat / (2 * TRAILBOUND_LAT_SPAN)) * this.m.h,
    };
  }

  landValue(v: Vec3, fine = false): number {
    const px = this.maskPx(v);
    if (!px) return -30;
    const s = this.seed;
    const d = sampleField(this.m.land, this.m.w, this.m.h, px.x, px.y);
    const near = Math.exp(-((d / 6) ** 2)) * this.roughness;
    let lv = d - this.seaLevel;
    if (near > 1e-3) {
      lv += (fbm3(v[0] * 40, v[1] * 40, v[2] * 40, s + 61, 4) - 0.5) * 7 * near;
      lv += (fbm3(v[0] * 160, v[1] * 160, v[2] * 160, s + 67, 3) - 0.5) * 2.5 * near;
      if (fine) {
        // Below one mask pixel: chunk-scale coves and headlands (a chunk is ~13 px).
        lv += (fbm3(v[0] * 900, v[1] * 900, v[2] * 900, s + 71, 3) - 0.5) * 0.9 * near;
        lv += (fbm3(v[0] * 4200, v[1] * 4200, v[2] * 4200, s + 73, 2) - 0.5) * 0.3 * near;
      }
    }
    return lv;
  }

  /** 0..1 polar ice cover. */
  iceAt(v: Vec3): number {
    const px = this.maskPx(v);
    if (!px) return 1;
    const d = sampleField(this.m.ice, this.m.w, this.m.h, px.x, px.y);
    return clamp01(d + 0.5 - this.shape.temp * ICE_PER_TEMP);
  }

  sample(v: Vec3): PlanetSample {
    const s = this.seed;
    const lv = this.landValue(v);
    const inland = clamp01(lv / 40);
    const range = clamp01((fbm3(v[0] * 2.2, v[1] * 2.2, v[2] * 2.2, s + 191, 3) - 0.42) * 5);
    const belt = clamp01((ridged3(v[0] * 6, v[1] * 6, v[2] * 6, s + 171, 3) - 0.62) / 0.38) * range;
    const hills = fbm3(v[0] * 22, v[1] * 22, v[2] * 22, s + 131, 4);
    let elevM: number;
    if (lv > 0) {
      elevM =
        6 +
        Math.pow(inland, 1.1) * 650 +
        hills * 320 * inland +
        Math.pow(belt, 1.3) * 2600 * clamp01(inland * 2.5);
      elevM = Math.min(3200, elevM);
    } else {
      elevM = -40 + Math.max(-60, lv) * 42;
    }
    const ice = this.iceAt(v);
    if (ice > 0.5 && elevM < 25) elevM = 25 + (ice - 0.5) * 60;

    const lat = Math.asin(Math.max(-1, Math.min(1, v[1])));
    const deg = (Math.abs(lat) * 180) / Math.PI;
    let temp = Math.pow(Math.cos(lat), 0.85);
    temp += (fbm3(v[0] * 3, v[1] * 3, v[2] * 3, s + 211, 2) - 0.5) * 0.3;
    temp -= Math.max(0, elevM) / 4200;
    temp = clamp01(temp + this.shape.temp * SHAPE_CLIMATE_GAIN);
    let moist = 0.5 + (fbm3(v[0] * 3.4, v[1] * 3.4, v[2] * 3.4, s + 241, 4) - 0.5) * 1.3;
    moist += 0.14 * Math.exp(-((deg / 12) ** 2));
    moist -= 0.12 * Math.exp(-(((deg - 27) / 9) ** 2));
    moist += 0.05 * Math.exp(-(((deg - 52) / 10) ** 2));
    moist += clamp01(0.4 - inland) * 0.35;
    moist = clamp01(moist + this.shape.moist * SHAPE_CLIMATE_GAIN);

    const biome = ice > 0.5 ? Biome.Snow : classify(elevM, temp, moist, belt, true);
    return { elevM, biome, temp, moist, belt };
  }
}
