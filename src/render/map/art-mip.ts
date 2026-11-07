import { hash2 } from '../../core/world/noise';

/** Pixels of real 48px art kept at each mip. 1 is the whole-world overview. */
export const ART_MIPS = [1, 3, 6, 12, 24, 48] as const;

export type ArtMip = (typeof ART_MIPS)[number];

/** Fewer tiles per chunk at the expensive full-resolution mip. */
export function spanForMip(px: number): number {
  if (px >= 24) return 16;
  if (px >= 12) return 24;
  return 48;
}

/** Mip whose texel size is nearest the on-screen size of one world tile. */
export function mipForScreenPx(screenPx: number): ArtMip {
  const target = Math.max(screenPx, 0.5);
  let best: ArtMip = ART_MIPS[0];
  let bestDist = Infinity;
  for (const px of ART_MIPS) {
    const dist = Math.abs(Math.log(px) - Math.log(target));
    if (dist < bestDist) {
      best = px;
      bestDist = dist;
    }
  }
  return best;
}

/** Snow tiles meet on every edge, so a quarter-turn does not open a seam. */
export function snowRotation(x: number, y: number, seed: number): 0 | 1 | 2 | 3 {
  return (Math.floor(hash2(x + 3, y + 5, seed + 2501) * 4) % 4) as 0 | 1 | 2 | 3;
}

/** Source texel for a screen texel, after rotation and flips. */
export function orientedTexel(
  px: number,
  py: number,
  size: number,
  flipX: boolean,
  flipY: boolean,
  rot: number,
): { u: number; v: number } {
  let x = px;
  let y = py;
  if (rot === 1) {
    x = py;
    y = size - 1 - px;
  } else if (rot === 2) {
    x = size - 1 - px;
    y = size - 1 - py;
  } else if (rot === 3) {
    x = size - 1 - py;
    y = px;
  }
  if (flipX) x = size - 1 - x;
  if (flipY) y = size - 1 - y;
  return { u: x, v: y };
}

/**
 * Area reduction that stays inside the source palette: each output texel is
 * the source texel nearest the box average, not a new blended colour.
 */
export function areaReduce(
  src: Uint8ClampedArray,
  srcSize: number,
  dstSize: number,
  orient?: { flipX?: boolean; flipY?: boolean; rot?: number },
): Uint8ClampedArray {
  const box = srcSize / dstSize;
  const out = new Uint8ClampedArray(dstSize * dstSize * 4);
  const flipX = orient?.flipX ?? false;
  const flipY = orient?.flipY ?? false;
  const rot = orient?.rot ?? 0;
  for (let dy = 0; dy < dstSize; dy++) {
    for (let dx = 0; dx < dstSize; dx++) {
      const x0 = Math.floor(dx * box);
      const y0 = Math.floor(dy * box);
      const x1 = Math.max(x0 + 1, Math.floor((dx + 1) * box));
      const y1 = Math.max(y0 + 1, Math.floor((dy + 1) * box));
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const { u, v } = orientedTexel(x, y, srcSize, flipX, flipY, rot);
          const o = (v * srcSize + u) * 4;
          r += src[o] ?? 0;
          g += src[o + 1] ?? 0;
          b += src[o + 2] ?? 0;
          n += 1;
        }
      }
      const inv = n > 0 ? 1 / n : 0;
      const ar = r * inv;
      const ag = g * inv;
      const ab = b * inv;
      let best = 0;
      let bestD = Infinity;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const { u, v } = orientedTexel(x, y, srcSize, flipX, flipY, rot);
          const o = (v * srcSize + u) * 4;
          const dr = (src[o] ?? 0) - ar;
          const dg = (src[o + 1] ?? 0) - ag;
          const db = (src[o + 2] ?? 0) - ab;
          const dist = dr * dr + dg * dg + db * db;
          if (dist < bestD) {
            bestD = dist;
            best = o;
          }
        }
      }
      const di = (dy * dstSize + dx) * 4;
      out[di] = src[best] ?? 0;
      out[di + 1] = src[best + 1] ?? 0;
      out[di + 2] = src[best + 2] ?? 0;
      out[di + 3] = 255;
    }
  }
  return out;
}
