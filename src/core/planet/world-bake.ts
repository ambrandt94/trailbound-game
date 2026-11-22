/**
 * World Gen's whole-planet images: one equirectangular raster per layer
 * (biomes with hillshade, hypsometric height, and a flags image for the land
 * mask and ice). Equirect is what both views need: the globe wraps it on a
 * sphere and the flat world map shows it as is, so WG4 can morph one into the
 * other with the same texture. Pure data; it runs in a worker.
 *
 * Column 0 is longitude −180°, the middle column is longitude 0 (face 0's
 * centre, like the Trailbound mask). Row 0 is the north pole.
 */
import { Biome } from '../world/models';
import { biomeRgb, oceanRgb } from './atlas';
import { latLonToSphere } from './cube-sphere';
import type { PlanetField } from './field';
import type { PlanetSample } from './global-layer';

export interface WorldBake {
  w: number;
  h: number;
  /** Biome colours, ocean depth and hillshade (RGBA). */
  biome: Uint8ClampedArray;
  /** Hypsometric tint: blue depths, green lowlands to white peaks (RGBA). */
  height: Uint8ClampedArray;
  /** R = land (255) or sea (0); G = ice cover 0..255; A = 255. */
  flags: Uint8ClampedArray;
  /** Land share by area on the sphere, 0..1. */
  landShare: number;
  /** Lowest and highest elevation, metres. */
  minM: number;
  maxM: number;
}

/** A field with polar ice of its own (Trailbound); others read ice from snow on sea. */
interface IceField {
  iceAt(v: readonly [number, number, number]): number;
}

function hasIce(field: PlanetField): field is PlanetField & IceField {
  return typeof (field as Partial<IceField>).iceAt === 'function';
}

type Rgb = readonly [number, number, number];

const HYPSO: ReadonlyArray<readonly [number, Rgb]> = [
  [0, [70, 140, 80]],
  [250, [130, 178, 92]],
  [700, [214, 204, 120]],
  [1400, [178, 132, 84]],
  [2200, [132, 104, 88]],
  [3000, [244, 244, 248]],
];

/** Hypsometric colour of an elevation (sea uses the globe's depth ramp). */
export function hypsoRgb(elevM: number): Rgb {
  if (elevM <= 0) return oceanRgb(Math.min(-1, elevM));
  for (let i = 1; i < HYPSO.length; i++) {
    const [m1, c1] = HYPSO[i]!;
    if (elevM <= m1) {
      const [m0, c0] = HYPSO[i - 1]!;
      const t = (elevM - m0) / (m1 - m0);
      return [
        c0[0] + (c1[0] - c0[0]) * t,
        c0[1] + (c1[1] - c0[1]) * t,
        c0[2] + (c1[2] - c0[2]) * t,
      ];
    }
  }
  return HYPSO[HYPSO.length - 1]![1];
}

/** Latitude (radians) at the centre of row `y` of an `h`-row equirect raster. */
export function rowLat(y: number, h: number): number {
  return (0.5 - (y + 0.5) / h) * Math.PI;
}

/** Longitude (radians) at the centre of column `x` of a `w`-column raster. */
export function colLon(x: number, w: number): number {
  return ((x + 0.5) / w - 0.5) * 2 * Math.PI;
}

/**
 * Bake the planet into `w`×`h` equirect layers. `onRows` (optional) hears
 * progress after each band of rows, for a worker that reports it.
 */
export function bakeWorld(
  field: PlanetField,
  w: number,
  h: number,
  onRows?: (done: number) => void,
): WorldBake {
  const n = w * h;
  const elev = new Float32Array(n);
  const biomes = new Uint8Array(n);
  const flags = new Uint8ClampedArray(n * 4);
  const ice = hasIce(field) ? field : null;
  let landArea = 0;
  let area = 0;
  let minM = Infinity;
  let maxM = -Infinity;
  for (let y = 0; y < h; y++) {
    const lat = rowLat(y, h);
    const weight = Math.cos(lat);
    for (let x = 0; x < w; x++) {
      const v = latLonToSphere(lat, colLon(x, w));
      const s: PlanetSample = field.sample(v);
      const i = y * w + x;
      elev[i] = s.elevM;
      biomes[i] = s.biome;
      const land = s.elevM > 0;
      const iceCover = ice ? ice.iceAt(v) : s.biome === Biome.Snow && !land ? 1 : 0;
      flags[i * 4] = land ? 255 : 0;
      flags[i * 4 + 1] = Math.round(Math.max(0, Math.min(1, iceCover)) * 255);
      flags[i * 4 + 3] = 255;
      area += weight;
      if (land) landArea += weight;
      if (s.elevM < minM) minM = s.elevM;
      if (s.elevM > maxM) maxM = s.elevM;
    }
    if (onRows && (y & 31) === 31) onRows(y + 1);
  }
  const biome = new Uint8ClampedArray(n * 4);
  const height = new Uint8ClampedArray(n * 4);
  // Texel size in metres: a degree of latitude is ~111 km; longitude shrinks by cos(lat).
  const rowM = (Math.PI * 6_371_000) / h;
  for (let y = 0; y < h; y++) {
    const colM = Math.max(rowM * 0.05, ((2 * Math.PI * 6_371_000) / w) * Math.cos(rowLat(y, h)));
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const e = elev[i]!;
      const col = biomeRgb(biomes[i]!, e);
      const hyp = hypsoRgb(e);
      let shade = 1;
      if (e > 0) {
        const xl = (x + w - 1) % w;
        const xr = (x + 1) % w;
        const yu = Math.max(0, y - 1);
        const yd = Math.min(h - 1, y + 1);
        const gx = (Math.max(0, elev[y * w + xr]!) - Math.max(0, elev[y * w + xl]!)) / (2 * colM);
        const gy = (Math.max(0, elev[yd * w + x]!) - Math.max(0, elev[yu * w + x]!)) / (2 * rowM);
        shade = Math.max(0.62, Math.min(1.25, 1 - (gx + gy) * 6));
      }
      biome[i * 4] = col[0] * shade;
      biome[i * 4 + 1] = col[1] * shade;
      biome[i * 4 + 2] = col[2] * shade;
      biome[i * 4 + 3] = 255;
      height[i * 4] = hyp[0] * shade;
      height[i * 4 + 1] = hyp[1] * shade;
      height[i * 4 + 2] = hyp[2] * shade;
      height[i * 4 + 3] = 255;
    }
  }
  return { w, h, biome, height, flags, landShare: area > 0 ? landArea / area : 0, minM, maxM };
}
