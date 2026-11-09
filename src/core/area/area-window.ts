/**
 * Cut a playable area from any land tile.
 * Settlements keep their own tiles. Everywhere else is a snapped window of
 * `AREA_WINDOW_TILES`, so the same spot always rebuilds the same area.
 * The window seed mixes the world seed with that origin.
 */
import { tierForKind } from '../world/settlement-tiers';
import { NEAR_POI_TILES } from '../world/map-grid';
import {
  BIOME_LABELS,
  Biome,
  biomeAt,
  boundsFromTiles,
  nodeContaining,
  POI_LABELS,
  poiCovering,
  waterAt,
  wrapDeltaX,
  wrapX,
  type MapNode,
  type PointOfInterest,
  type Vec2,
  type WorldData,
} from '../world/models';

/** Playable side length in world tiles. 12 × 8 m = 96 m, plus the export's border ring. */
export const AREA_WINDOW_TILES = 12;
/**
 * Metres below sea. Shallower water on the beach lip can clamp onto land.
 * Deeper than this, entry is refused.
 */
export const DEEP_WATER_M = -8;
/** How many tiles a shallow-water stand may search for land. */
export const SHORE_CLAMP_TILES = 2;

export interface AreaWindow {
  id: string;
  x0: number;
  y0: number;
  /** Exclusive. */
  x1: number;
  /** Exclusive. */
  y1: number;
  tiles: Vec2[];
  biome: Biome;
  seed: number;
}

export interface ResolvedArea {
  node: MapNode;
  cacheKey: string;
  /** Inclusive world-tile span. Matches the footprint an exit walks back to. */
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface MapStand {
  canEnter: boolean;
  name: string;
  tier: string;
  kind: string;
  blockedReason: 'deep-water' | null;
  /** Place the traveller is standing in, or the biome when they are not. */
  standLine: string;
  /** Nearest POI when it is not the place underfoot. Empty when there is none nearby. */
  nearestLine: string;
}

export function settlementNodeAt(world: WorldData, x: number, y: number): MapNode | null {
  const node = nodeContaining(world.nodes, x, y);
  if (!node || !tierForKind(node.kind)) return null;
  return node;
}

/** Snap a world position to the area window that contains it. */
export function cutAreaWindow(world: WorldData, x: number, y: number): AreaWindow {
  const span = Math.max(1, Math.min(AREA_WINDOW_TILES, world.width, world.height));
  const tx = Math.floor(wrapX(x, world.width));
  const ty = Math.min(world.height - 1, Math.max(0, Math.floor(y)));
  let x0 = Math.floor(tx / span) * span;
  let y0 = Math.floor(ty / span) * span;
  if (x0 + span > world.width) x0 = world.width - span;
  if (y0 + span > world.height) y0 = world.height - span;
  const x1 = x0 + span;
  const y1 = y0 + span;
  const tiles: Vec2[] = [];
  for (let yy = y0; yy < y1; yy++) {
    for (let xx = x0; xx < x1; xx++) tiles.push({ x: xx, y: yy });
  }
  const biome = dominantLandBiome(world, tiles);
  return {
    id: `wild-${x0}-${y0}`,
    x0,
    y0,
    x1,
    y1,
    tiles,
    biome,
    seed: windowSeed(world.seed, x0, y0),
  };
}

/**
 * Settlement under the traveller, otherwise the snapped wilderness window.
 * Null when they are standing on deep water, or on shallow water with no land in reach.
 */
export function resolveAreaAt(world: WorldData, x: number, y: number): ResolvedArea | null {
  const settlement = settlementNodeAt(world, x, y);
  if (settlement) {
    const tiles = settlement.tiles ?? [];
    if (!tiles.length) return null;
    const bounds = boundsFromTiles(tiles);
    return {
      node: settlement,
      cacheKey: `settle:${settlement.id}`,
      minX: bounds.x0,
      minY: bounds.y0,
      maxX: bounds.x1 - 1,
      maxY: bounds.y1 - 1,
    };
  }
  const stand = landStand(world, x, y);
  if (!stand) return null;
  const window = cutAreaWindow(world, stand.x, stand.y);
  return {
    node: nodeFromWindow(window),
    cacheKey: `wild:${window.x0}:${window.y0}`,
    minX: window.x0,
    minY: window.y0,
    maxX: window.x1 - 1,
    maxY: window.y1 - 1,
  };
}

/** Place-panel copy for the tile under the traveller. */
export function describeMapStand(world: WorldData, x: number, y: number): MapStand {
  const settlement = settlementNodeAt(world, x, y);
  const poi = poiCovering(world.pois, x, y, world);
  const near = nearestPoi(world, x, y, poi);
  if (settlement) {
    return {
      canEnter: true,
      name: settlement.name,
      tier: tierForKind(settlement.kind) ?? '',
      kind: settlement.kind,
      blockedReason: null,
      standLine: `In ${settlement.name}`,
      nearestLine: near ? `Nearest: ${near.name}` : '',
    };
  }
  const stand = landStand(world, x, y);
  if (!stand) {
    return {
      canEnter: false,
      name: 'Open sea',
      tier: 'Water',
      kind: 'water',
      blockedReason: 'deep-water',
      standLine: 'Open sea',
      nearestLine: '',
    };
  }
  if (poi) {
    return {
      canEnter: true,
      name: poi.name,
      tier: POI_LABELS[poi.kind],
      kind: poi.kind,
      blockedReason: null,
      standLine: `In ${poi.name}`,
      nearestLine: '',
    };
  }
  const biome = biomeAt(world, stand.x, stand.y);
  const name = BIOME_LABELS[biome] ?? 'Wilderness';
  return {
    canEnter: true,
    name,
    tier: 'Wilderness',
    kind: 'wilderness',
    blockedReason: null,
    standLine: name,
    nearestLine: near ? `Nearest: ${near.name}` : '',
  };
}

/** Closest POI within `NEAR_POI_TILES`, skipping the one the traveller is inside. */
function nearestPoi(
  world: WorldData,
  x: number,
  y: number,
  here: PointOfInterest | null,
): PointOfInterest | null {
  let best: PointOfInterest | null = null;
  let bestD = NEAR_POI_TILES;
  for (const poi of world.pois) {
    if (here && poi.id === here.id) continue;
    const d = Math.hypot(poi.x - x, poi.y - y);
    if (d < bestD) {
      best = poi;
      bestD = d;
    }
  }
  return best;
}

export interface SettlementStep {
  dx: number;
  dy: number;
  /** Set when this step first crosses into a settlement while zoomed in. */
  holdId: string | null;
}

/**
 * Zoom at which a step that enters a settlement stops on that tile.
 * Below the map's zoom cap, so the stop is active at the closest 2D view.
 */
export const SETTLEMENT_STOP_SCALE = 2.4;

/**
 * While the map is near its zoom cap, end a step on the first settlement tile
 * it enters so a stride cannot skip the town. Already standing in one, the
 * step is unchanged.
 */
export function clampStepToSettlement(
  world: WorldData,
  x0: number,
  y0: number,
  dx: number,
  dy: number,
  scale: number,
): SettlementStep {
  if (!(scale >= SETTLEMENT_STOP_SCALE)) return { dx, dy, holdId: null };
  if (settlementNodeAt(world, x0, y0)) return { dx, dy, holdId: null };
  const dist = Math.hypot(dx, dy);
  if (!(dist > 0)) return { dx, dy, holdId: null };
  const steps = Math.max(1, Math.ceil(dist / 0.25));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x = wrapX(x0 + dx * t, world.width);
    const y = Math.min(world.height - 0.5, Math.max(0.5, y0 + dy * t));
    const node = settlementNodeAt(world, x, y);
    if (!node) continue;
    const prev = (i - 1) / steps;
    const inside = justInsideTile(x0 + dx * prev, y0 + dy * prev, x0 + dx * t, y0 + dy * t);
    return {
      dx: wrapDeltaX(x0, wrapX(inside.x, world.width), world.width),
      dy: inside.y - y0,
      holdId: node.id,
    };
  }
  return { dx, dy, holdId: null };
}

/** First point of the segment that sits inside the tile the segment enters. */
function justInsideTile(x0: number, y0: number, x1: number, y1: number): { x: number; y: number } {
  const tx = Math.floor(x1);
  const ty = Math.floor(y1);
  let lo = 0;
  let hi = 1;
  for (let k = 0; k < 16; k++) {
    const mid = (lo + hi) / 2;
    const x = x0 + (x1 - x0) * mid;
    const y = y0 + (y1 - y0) * mid;
    if (Math.floor(x) === tx && Math.floor(y) === ty) hi = mid;
    else lo = mid;
  }
  const inset = Math.min(1, hi + 1e-3);
  return { x: x0 + (x1 - x0) * inset, y: y0 + (y1 - y0) * inset };
}

function landStand(
  world: WorldData,
  x: number,
  y: number,
): { x: number; y: number; clamped: boolean } | null {
  const ix = Math.floor(wrapX(x, world.width));
  const iy = Math.min(world.height - 1, Math.max(0, Math.floor(y)));
  if (!waterAt(world, ix + 0.5, iy + 0.5)) return { x: ix + 0.5, y: iy + 0.5, clamped: false };
  if (depthAt(world, ix, iy) < DEEP_WATER_M) return null;
  let best: { x: number; y: number; d: number } | null = null;
  for (let dy = -SHORE_CLAMP_TILES; dy <= SHORE_CLAMP_TILES; dy++) {
    for (let dx = -SHORE_CLAMP_TILES; dx <= SHORE_CLAMP_TILES; dx++) {
      if (dx === 0 && dy === 0) continue;
      const xx = Math.floor(wrapX(ix + dx, world.width));
      const yy = iy + dy;
      if (yy < 0 || yy >= world.height) continue;
      if (waterAt(world, xx + 0.5, yy + 0.5)) continue;
      const d = dx * dx + dy * dy;
      if (
        !best ||
        d < best.d ||
        (d === best.d && (yy < best.y || (yy === best.y && xx < best.x)))
      ) {
        best = { x: xx + 0.5, y: yy + 0.5, d };
      }
    }
  }
  if (!best) return null;
  return { x: best.x, y: best.y, clamped: true };
}

function depthAt(world: WorldData, ix: number, iy: number): number {
  const sample = world.heightM[ix + iy * world.width];
  return sample ?? 0;
}

function dominantLandBiome(world: WorldData, tiles: readonly Vec2[]): Biome {
  const counts = new Map<number, number>();
  for (const tile of tiles) {
    const biome = biomeAt(world, tile.x + 0.5, tile.y + 0.5);
    if (biome === Biome.Water) continue;
    counts.set(biome, (counts.get(biome) ?? 0) + 1);
  }
  let best = Biome.Plains;
  let count = -1;
  for (const [biome, n] of counts) {
    if (n > count || (n === count && biome < best)) {
      best = biome as Biome;
      count = n;
    }
  }
  return count < 0 ? Biome.Water : best;
}

function nodeFromWindow(window: AreaWindow): MapNode {
  const cx = (window.x0 + window.x1) / 2;
  const cy = (window.y0 + window.y1) / 2;
  return {
    id: window.id,
    name: BIOME_LABELS[window.biome] ?? 'Wilderness',
    origin: 'generated',
    kind: 'grove',
    biome: window.biome,
    cx,
    cy,
    radius: AREA_WINDOW_TILES / 2,
    x0: window.x0,
    y0: window.y0,
    x1: window.x1,
    y1: window.y1,
    tiles: window.tiles,
    seed: window.seed,
  };
}

/** Unsigned mix of the world seed and the window origin. Never zero. */
export function windowSeed(worldSeed: number, x0: number, y0: number): number {
  let h =
    Math.imul(worldSeed >>> 0, 0x9e3779b1) ^
    Math.imul(x0 | 0, 0x85ebca6b) ^
    Math.imul(y0 | 0, 0xc2b2ae35);
  h = (h ^ (h >>> 16)) >>> 0;
  return h || 1;
}
