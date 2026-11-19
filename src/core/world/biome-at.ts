import type { WorldData } from './models';

/**
 * The world biome id under a point in world tiles, or null without a map.
 * The map wraps east to west; north and south clamp to the edge rows.
 */
export function biomeAtTile(
  data: Pick<WorldData, 'width' | 'height' | 'biomes'> | null,
  x: number,
  y: number,
): number | null {
  if (!data || data.width <= 0 || data.height <= 0 || !Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }
  const ix = ((Math.floor(x) % data.width) + data.width) % data.width;
  const iy = Math.min(data.height - 1, Math.max(0, Math.floor(y)));
  return data.biomes[ix + iy * data.width] ?? null;
}
