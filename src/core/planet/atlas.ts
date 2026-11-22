/**
 * Globe textures from the planet layer: one RGBA square per cube face, biome
 * colour with an ocean depth ramp and a hillshade. Pure data, so it bakes in a
 * worker. The home chunk is overpainted from the real world map.
 */
import { Biome, type WorldData } from '../world/models';
import { FACES, faceToSphere, type FaceId, type ChunkAddr } from './cube-sphere';
import type { PlanetField } from './field';

type Rgb = readonly [number, number, number];

/** Flat globe colours, close to the map skin's ground colours. Taiga keeps its pale cyan canopy. */
export const GLOBE_BIOME_RGB: Record<number, Rgb> = {
  [Biome.Water]: [40, 92, 150],
  [Biome.Sand]: [226, 206, 150],
  [Biome.Plains]: [134, 176, 78],
  [Biome.Meadow]: [154, 196, 92],
  [Biome.Forest]: [62, 124, 62],
  [Biome.DarkForest]: [40, 88, 52],
  [Biome.Hills]: [148, 158, 96],
  [Biome.Badlands]: [184, 120, 78],
  [Biome.Marsh]: [86, 116, 84],
  [Biome.Mountain]: [128, 118, 108],
  [Biome.Snow]: [238, 242, 246],
  [Biome.Taiga]: [146, 196, 196],
  [Biome.Desert]: [224, 194, 124],
  [Biome.Jungle]: [36, 128, 58],
  [Biome.Ashlands]: [92, 82, 82],
};

/** Share of a patch's width faded into the planet at each edge (the globe's home mesh uses the same). */
export const PATCH_FEATHER = 0.12;

const SHALLOW: Rgb = [58, 128, 176];
const DEEP: Rgb = [14, 36, 78];

export function oceanRgb(elevM: number): Rgb {
  const t = Math.max(0, Math.min(1, Math.pow(-elevM / 3200, 0.6)));
  return [
    SHALLOW[0] + (DEEP[0] - SHALLOW[0]) * t,
    SHALLOW[1] + (DEEP[1] - SHALLOW[1]) * t,
    SHALLOW[2] + (DEEP[2] - SHALLOW[2]) * t,
  ];
}

export function biomeRgb(biome: number, elevM: number): Rgb {
  if (biome === Biome.Water || elevM < 0) return oceanRgb(Math.min(-1, elevM));
  return GLOBE_BIOME_RGB[biome] ?? GLOBE_BIOME_RGB[Biome.Plains]!;
}

/** A square RGBA image painted over one chunk (row 0 = the chunk's north edge). */
export interface ChunkPatch {
  addr: ChunkAddr;
  size: number;
  rgba: Uint8ClampedArray;
}

/**
 * Bake one cube face. Row 0 is the face's `t = −1` edge, matching a three.js
 * DataTexture (row 0 at uv.y = 0) with `uv.y = (t + 1) / 2`.
 */
export function bakeFace(
  layer: PlanetField,
  face: FaceId,
  size: number,
  patches: readonly ChunkPatch[] = [],
): Uint8ClampedArray {
  const elev = new Float32Array(size * size);
  const rgb = new Uint8ClampedArray(size * size * 4);
  for (let r = 0; r < size; r++) {
    const t = ((r + 0.5) / size) * 2 - 1;
    for (let c = 0; c < size; c++) {
      const s = ((c + 0.5) / size) * 2 - 1;
      const smp = layer.sample(faceToSphere(face, s, t));
      const i = r * size + c;
      elev[i] = smp.elevM;
      const col = biomeRgb(smp.biome, smp.elevM);
      rgb[i * 4] = col[0];
      rgb[i * 4 + 1] = col[1];
      rgb[i * 4 + 2] = col[2];
      rgb[i * 4 + 3] = 255;
    }
  }
  // Hillshade on land, light from the north-west. Texel spacing ≈ face arc / size.
  const texelM = ((Math.PI / 2) * 6_371_000 * (layer.n / 408)) / size;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const i = r * size + c;
      const h = elev[i]!;
      if (h <= 0) continue;
      const hl = elev[r * size + Math.max(0, c - 1)]!;
      const hr = elev[r * size + Math.min(size - 1, c + 1)]!;
      const hu = elev[Math.max(0, r - 1) * size + c]!;
      const hd = elev[Math.min(size - 1, r + 1) * size + c]!;
      const gx = (Math.max(0, hr) - Math.max(0, hl)) / (2 * texelM);
      const gy = (Math.max(0, hd) - Math.max(0, hu)) / (2 * texelM);
      const shade = Math.max(0.62, Math.min(1.25, 1 - (gx + gy) * 6));
      rgb[i * 4] = rgb[i * 4]! * shade;
      rgb[i * 4 + 1] = rgb[i * 4 + 1]! * shade;
      rgb[i * 4 + 2] = rgb[i * 4 + 2]! * shade;
    }
  }
  for (const patch of patches) {
    if (patch.addr.face === face) stampPatch(rgb, size, layer.n, patch);
  }
  return rgb;
}

function stampPatch(rgb: Uint8ClampedArray, size: number, n: number, patch: ChunkPatch): void {
  const per = size / n;
  const c0 = Math.floor(patch.addr.cx * per);
  const r0 = Math.floor(patch.addr.cy * per);
  const c1 = Math.ceil((patch.addr.cx + 1) * per);
  const r1 = Math.ceil((patch.addr.cy + 1) * per);
  for (let r = r0; r < r1 && r < size; r++) {
    const py = Math.min(patch.size - 1, Math.floor(((r + 0.5 - r0) / (r1 - r0)) * patch.size));
    for (let c = c0; c < c1 && c < size; c++) {
      const px = Math.min(patch.size - 1, Math.floor(((c + 0.5 - c0) / (c1 - c0)) * patch.size));
      const src = (py * patch.size + px) * 4;
      const dst = (r * size + c) * 4;
      // Feather the outer band so the patch's sea melts into the planet's.
      const fx = (c + 0.5 - c0) / (c1 - c0);
      const fy = (r + 0.5 - r0) / (r1 - r0);
      const edge = Math.min(fx, fy, 1 - fx, 1 - fy) / PATCH_FEATHER;
      const w = edge >= 1 ? 1 : edge <= 0 ? 0 : edge * edge * (3 - 2 * edge);
      rgb[dst] = rgb[dst]! + (patch.rgba[src]! - rgb[dst]!) * w;
      rgb[dst + 1] = rgb[dst + 1]! + (patch.rgba[src + 1]! - rgb[dst + 1]!) * w;
      rgb[dst + 2] = rgb[dst + 2]! + (patch.rgba[src + 2]! - rgb[dst + 2]!) * w;
      rgb[dst + 3] = 255;
    }
  }
}

/**
 * The home world as a globe patch: nearest-sample biomes on a `size²` grid with
 * the same palette and a light hillshade from `heightM`.
 */
export function homePatchRgba(
  world: Pick<WorldData, 'width' | 'height' | 'biomes' | 'heightM'>,
  size: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(size * size * 4);
  const { width, height } = world;
  const at = (x: number, y: number) =>
    world.heightM[
      Math.min(height - 1, Math.max(0, y)) * width + Math.min(width - 1, Math.max(0, x))
    ] ?? 0;
  const step = width / size;
  for (let r = 0; r < size; r++) {
    const y = Math.min(height - 1, Math.floor((r + 0.5) * (height / size)));
    for (let c = 0; c < size; c++) {
      const x = Math.min(width - 1, Math.floor((c + 0.5) * step));
      const i = y * width + x;
      const h = world.heightM[i] ?? 0;
      const col = biomeRgb(world.biomes[i] ?? 0, h);
      let shade = 1;
      if (h > 0) {
        const d = Math.max(1, Math.round(step));
        const gx = at(x + d, y) - at(x - d, y);
        const gy = at(x, y + d) - at(x, y - d);
        shade = Math.max(0.65, Math.min(1.25, 1 - ((gx + gy) / (16 * d)) * 0.35));
      }
      const o = (r * size + c) * 4;
      out[o] = col[0] * shade;
      out[o + 1] = col[1] * shade;
      out[o + 2] = col[2] * shade;
      out[o + 3] = 255;
    }
  }
  return out;
}

/** Face frames for renderers that build the cube-sphere mesh. */
export { FACES };
