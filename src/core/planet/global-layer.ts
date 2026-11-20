/**
 * The planet-wide layer: continents, mountain belts, ocean depth and climate as
 * one continuous function of a point on the unit sphere. Every later chunk
 * generator conditions on this, so neighbouring chunks agree at their borders
 * by construction. Today it feeds only the static globe.
 *
 * Tectonics: K seeded plates (spherical Voronoi on a warped point). Continental
 * plates sit high, oceanic plates low; converging plate edges raise mountain
 * belts on land and trenches at sea. Heights use the world's metre scale
 * (`terrain.ts`: −4000 trench, −2500 abyss, +3000 peaks).
 *
 * Home: the hand-tuned world is an island inside its own ocean margin, so the
 * layer sinks a disc of sea around the home chunk. Its neighbours then meet the
 * home map in open water, which is what the home map already has at its edges.
 */
import { Biome } from '../world/models';
import { Rng } from '../world/noise';
import { angleBetween, chunkToSphere, type ChunkAddr, type Vec3 } from './cube-sphere';
import { fbm3, ridged3 } from './noise3';

export interface PlanetSample {
  /** Metres above sea level. */
  elevM: number;
  biome: Biome;
  /** 0 polar … 1 equatorial heat, after altitude. */
  temp: number;
  /** 0 dry … 1 wet. */
  moist: number;
  /** 0..1 mountain-belt strength from plate collisions. */
  belt: number;
}

interface Plate {
  p: Vec3;
  continental: boolean;
  drift: Vec3;
}

export interface PlanetLayerOptions {
  seed: number;
  /** Chunks per cube-face edge. */
  n: number;
  /** The hand-tuned world's chunk. Omit for a planet with no home override. */
  home?: ChunkAddr;
  plates?: number;
}

const BELT_WIDTH = 0.07;
const PEAK_M = 3000;
const TRENCH_M = -4000;
const ABYSS_M = -2500;

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function norm(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

function smooth(e0: number, e1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

export class PlanetLayer {
  readonly seed: number;
  readonly n: number;
  readonly home: ChunkAddr | null;
  private readonly plates: Plate[];
  private readonly homeCentre: Vec3 | null;
  /** Angular half-width of one chunk at the face centre. */
  private readonly chunkHalf: number;

  constructor(opts: PlanetLayerOptions) {
    this.seed = opts.seed >>> 0;
    this.n = Math.max(1, Math.floor(opts.n));
    this.home = opts.home ?? null;
    this.homeCentre = opts.home ? chunkToSphere(this.n, opts.home) : null;
    this.chunkHalf = Math.PI / 4 / this.n;
    const rng = new Rng((this.seed ^ 0x2c1b3c6d) >>> 0 || 1);
    const count = opts.plates ?? 22;
    this.plates = [];
    for (let i = 0; i < count; i++) {
      const z = rng.range(-1, 1);
      const a = rng.range(0, Math.PI * 2);
      const r = Math.sqrt(1 - z * z);
      const p: Vec3 = [r * Math.cos(a), z, r * Math.sin(a)];
      const axis = norm([rng.range(-1, 1), rng.range(-1, 1), rng.range(-1, 1)]);
      this.plates.push({
        p,
        // About 40% of plates carry continents, so roughly a third is land.
        continental: rng.chance(0.4),
        drift: norm(cross(axis, p)),
      });
    }
  }

  sample(v: Vec3): PlanetSample {
    const s = this.seed;
    // Warp so plate edges wander instead of running as great-circle arcs.
    const wx = v[0] + (fbm3(v[0] * 2.1, v[1] * 2.1, v[2] * 2.1, s + 11, 2) - 0.5) * 0.5;
    const wy = v[1] + (fbm3(v[0] * 2.1 + 5.2, v[1] * 2.1, v[2] * 2.1, s + 23, 2) - 0.5) * 0.5;
    const wz = v[2] + (fbm3(v[0] * 2.1, v[1] * 2.1 + 9.7, v[2] * 2.1, s + 37, 2) - 0.5) * 0.5;
    const w = norm([wx, wy, wz]);
    let d1 = -2;
    let d2 = -2;
    let i1 = 0;
    let i2 = 0;
    for (let i = 0; i < this.plates.length; i++) {
      const pl = this.plates[i]!;
      const d = w[0] * pl.p[0] + w[1] * pl.p[1] + w[2] * pl.p[2];
      if (d > d1) {
        d2 = d1;
        i2 = i1;
        d1 = d;
        i1 = i;
      } else if (d > d2) {
        d2 = d;
        i2 = i;
      }
    }
    const a = this.plates[i1]!;
    const b = this.plates[i2]!;
    const gap = Math.acos(Math.max(-1, Math.min(1, d2))) - Math.acos(Math.max(-1, Math.min(1, d1)));
    const toB = norm([b.p[0] - a.p[0], b.p[1] - a.p[1], b.p[2] - a.p[2]]);
    const closing =
      (a.drift[0] - b.drift[0]) * toB[0] +
      (a.drift[1] - b.drift[1]) * toB[1] +
      (a.drift[2] - b.drift[2]) * toB[2];
    const edge = Math.exp(-gap / BELT_WIDTH);

    let base = a.continental ? 0.3 : -0.55;
    const other = b.continental ? 0.3 : -0.55;
    base += (other - base) * edge * 0.35;
    base += (fbm3(v[0] * 1.7, v[1] * 1.7, v[2] * 1.7, s + 101, 4) - 0.5) * 0.95;
    base += (fbm3(v[0] * 5.5, v[1] * 5.5, v[2] * 5.5, s + 131, 3) - 0.5) * 0.32;
    base += (fbm3(v[0] * 17, v[1] * 17, v[2] * 17, s + 151, 2) - 0.5) * 0.1;

    let belt = 0;
    if (closing > 0) {
      const kind = a.continental && b.continental ? 1 : a.continental || b.continental ? 0.75 : 0.4;
      belt = Math.min(1, edge * Math.min(1, closing * 1.4) * kind);
    }
    const crag = ridged3(v[0] * 9, v[1] * 9, v[2] * 9, s + 171, 3);

    let elevM: number;
    if (base + belt * 0.35 > 0) {
      const lift = Math.max(0, base);
      const inland = Math.min(1, lift * 2.2);
      elevM =
        8 + Math.pow(lift, 1.25) * 1300 + belt * (1500 + crag * 1200) + crag * crag * 900 * inland;
      elevM = Math.min(3200, elevM);
    } else {
      const depth = Math.min(1, -(base + belt * 0.35) / 0.55);
      elevM = -60 - Math.pow(depth, 0.7) * (-ABYSS_M - 60);
      if (!a.continental && closing > 0) elevM -= edge * Math.min(1, closing) * 1500;
      elevM = Math.max(TRENCH_M, elevM);
    }

    // Home: open sea around the hand-tuned island.
    if (this.homeCentre) {
      const d = angleBetween(v, this.homeCentre);
      const sea = 1 - smooth(this.chunkHalf * 1.8, this.chunkHalf * 3, d);
      // Sink land and shelf to open water; leave deeper sea as it is.
      if (sea > 0) elevM = elevM * (1 - sea) + Math.min(elevM, -450) * sea;
    }

    const lat = Math.asin(Math.max(-1, Math.min(1, v[1])));
    const absLat = Math.abs(lat) / (Math.PI / 2);
    let temp = Math.pow(Math.cos(lat), 0.85);
    temp += (fbm3(v[0] * 3, v[1] * 3, v[2] * 3, s + 211, 2) - 0.5) * 0.3;
    temp -= Math.max(0, elevM) / 4200;
    temp = Math.max(0, Math.min(1, temp));

    const deg = absLat * 90;
    let moist = 0.52 + (fbm3(v[0] * 3.4, v[1] * 3.4, v[2] * 3.4, s + 241, 4) - 0.5) * 1.3;
    // Soft climate belts: wet tropics, a drier horse-latitude band, wetter westerlies.
    moist += 0.14 * Math.exp(-((deg / 12) ** 2));
    moist -= 0.12 * Math.exp(-(((deg - 27) / 9) ** 2));
    moist += 0.05 * Math.exp(-(((deg - 52) / 10) ** 2));
    // Coasts are wetter than interiors.
    moist += Math.max(0, 0.25 - Math.abs(base)) * 0.6;
    moist = Math.max(0, Math.min(1, moist));

    return { elevM, biome: classify(elevM, temp, moist, belt, a.continental), temp, moist, belt };
  }

  sampleChunk(addr: ChunkAddr, x = 0.5, y = 0.5): PlanetSample {
    return this.sample(chunkToSphere(this.n, addr, x, y));
  }
}

export function classify(
  elevM: number,
  temp: number,
  moist: number,
  belt: number,
  continental: boolean,
): Biome {
  if (elevM < 0) return Biome.Water;
  if (temp < 0.1 || elevM > PEAK_M * 0.78) return Biome.Snow;
  if (elevM > 1500) return Biome.Mountain;
  if (!continental && belt > 0.55 && temp > 0.45) return Biome.Ashlands;
  if (elevM < 22 && temp > 0.35) return Biome.Sand;
  if (temp < 0.27) return moist > 0.38 ? Biome.Taiga : Biome.Snow;
  if (elevM > 850) return moist < 0.3 ? Biome.Badlands : Biome.Hills;
  if (temp > 0.72) {
    if (moist > 0.66) return Biome.Jungle;
    if (moist < 0.3) return Biome.Desert;
    if (moist < 0.4) return Biome.Badlands;
    return Biome.Plains;
  }
  if (moist > 0.78 && elevM < 120) return Biome.Marsh;
  if (moist > 0.66) return Biome.DarkForest;
  if (moist > 0.52) return Biome.Forest;
  if (moist > 0.4) return Biome.Meadow;
  if (moist < 0.24) return Biome.Desert;
  return Biome.Plains;
}
