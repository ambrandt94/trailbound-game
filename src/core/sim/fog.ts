import {
  FOG_OF_WAR_ENABLED,
  clamp,
  tileKey,
  wrapX,
  type MapNode,
  type WorldData,
} from '../world/models';

/** Cloud cover is off in the frozen map. The rules stay so a later switch matches it. */
export function fogEnabled(): boolean {
  return FOG_OF_WAR_ENABLED;
}

export function placeExplored(node: MapNode, visited: ReadonlySet<string>): boolean {
  if (!FOG_OF_WAR_ENABLED) return true;
  if (node.poiKind) return visited.has(node.id);
  if (node.origin === 'generated') return true;
  return visited.has(node.id);
}

export function exploredTileKeys(world: WorldData, visited: ReadonlySet<string>): Set<string> {
  const keys = new Set<string>();
  if (!FOG_OF_WAR_ENABLED) return keys;
  for (const node of world.nodes) {
    if (!placeExplored(node, visited)) continue;
    for (const tile of node.tiles ?? []) keys.add(tileKey(tile.x, tile.y));
  }
  return keys;
}

export function tileExplored(
  world: WorldData,
  x: number,
  y: number,
  keys: ReadonlySet<string>,
): boolean {
  if (!FOG_OF_WAR_ENABLED) return true;
  const wx = Math.floor(wrapX(x, world.width));
  const wy = Math.floor(clamp(y, 0, world.height - 0.001));
  return keys.has(tileKey(wx, wy));
}
