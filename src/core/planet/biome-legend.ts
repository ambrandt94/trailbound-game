/**
 * The biome legend: every biome the generator can produce, with the colour the
 * planet views use and its legend name. Built from the `Biome` enum, its labels
 * and `GLOBE_BIOME_RGB`, so a new biome shows up here without a second list.
 */
import { BIOME_COUNT, BIOME_LABELS, Biome } from '../world/models';
import { GLOBE_BIOME_RGB } from './atlas';

export interface BiomeLegendEntry {
  id: Biome;
  name: string;
  rgb: readonly [number, number, number];
}

let cached: BiomeLegendEntry[] | null = null;
/** Veil alpha over the biomes the legend is not focused on. */
const VEIL = 165;

/** One entry per distinct biome id (enum aliases such as Heath/Badlands collapse), in id order. */
export function biomeLegend(): BiomeLegendEntry[] {
  if (cached) return cached;
  const ids = new Set<number>();
  for (const v of Object.values(Biome)) if (typeof v === 'number') ids.add(v);
  const out: BiomeLegendEntry[] = [];
  for (const id of [...ids].sort((a, b) => a - b)) {
    const rgb = GLOBE_BIOME_RGB[id];
    const name = BIOME_LABELS[id as Biome];
    if (!rgb || !name) continue;
    out.push({ id: id as Biome, name, rgb });
  }
  cached = out;
  return out;
}

/** Legend colours by biome id (`BIOME_COUNT` long; unknown ids are grey). */
export function biomeLegendRgb(): Array<readonly [number, number, number]> {
  const table: Array<readonly [number, number, number]> = [];
  for (let i = 0; i < BIOME_COUNT; i++) table.push([128, 128, 128]);
  for (const e of biomeLegend()) table[e.id] = e.rgb;
  return table;
}

/**
 * A semi-transparent wash of legend colours over a biome id grid, `maxSide`
 * pixels at most a side (nearest sample). With `focus` set, that biome is
 * washed strongly and every other one goes under a dark veil. RGBA, row 0 = north.
 */
export function biomeWashRgba(
  ids: ArrayLike<number>,
  w: number,
  h: number,
  maxSide: number,
  alpha: number,
  focus: number | null,
): { w: number; h: number; rgba: Uint8ClampedArray } {
  const k = Math.max(1, Math.max(w, h) / Math.max(1, maxSide));
  const ow = Math.max(1, Math.round(w / k));
  const oh = Math.max(1, Math.round(h / k));
  const table = biomeLegendRgb();
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255);
  const strong = Math.min(255, Math.round(a * 1.5));
  const rgba = new Uint8ClampedArray(ow * oh * 4);
  for (let y = 0; y < oh; y++) {
    const sy = Math.min(h - 1, Math.floor((y + 0.5) * k));
    for (let x = 0; x < ow; x++) {
      const sx = Math.min(w - 1, Math.floor((x + 0.5) * k));
      const id = ids[sy * w + sx] ?? 0;
      const c = table[id] ?? table[0]!;
      const o = (y * ow + x) * 4;
      if (focus !== null && id !== focus) {
        // Everything but the focused biome sits under a dark veil.
        rgba[o] = 10;
        rgba[o + 1] = 12;
        rgba[o + 2] = 18;
        rgba[o + 3] = VEIL;
        continue;
      }
      rgba[o] = c[0];
      rgba[o + 1] = c[1];
      rgba[o + 2] = c[2];
      rgba[o + 3] = focus === null ? a : strong;
    }
  }
  return { w: ow, h: oh, rgba };
}
