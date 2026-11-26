/**
 * Which people laid a settlement out. Derived from the world seed and the
 * node. It is written onto the node at siting and never stored in a save.
 */
import { hash2 } from './noise';
import { Biome } from './models';

export type CultureId = 'human' | 'orc' | 'mouse';

/** Villages and towns in these biomes roll an orc camp about 1 time in 8. */
const ORC_BIOMES = new Set<Biome>([Biome.Badlands, Biome.Ashlands, Biome.DarkForest]);

export const ORC_VILLAGE_RATE = 1 / 8;

export function isCultureId(value: unknown): value is CultureId {
  return value === 'human' || value === 'orc' || value === 'mouse';
}

function hashId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * Human everywhere, except about one in eight villages and towns in the
 * Badlands, Ashlands, and Shadowwood. An override forces the pick.
 */
export function rollCulture(
  worldSeed: number,
  node: { id: string; biome: Biome; settlementClass?: string },
  override?: string,
): CultureId {
  if (isCultureId(override)) return override;
  const cls = node.settlementClass;
  if (cls !== 'village' && cls !== 'town') return 'human';
  if (!ORC_BIOMES.has(node.biome)) return 'human';
  const roll = hash2(hashId(node.id), worldSeed >>> 0, 0x0c2);
  return roll < ORC_VILLAGE_RATE ? 'orc' : 'human';
}
