/**
 * Cut a playable area from any land tile.
 * Settlements keep their own tiles. Everywhere else is a snapped window of
 * `AREA_WINDOW_TILES`, so the same spot always rebuilds the same area.
 * The window seed mixes the world seed with that origin.
 */
import { tierForKind } from '../world/settlement-tiers';
import { TOWN_OUTSKIRTS_TILES, type ZoneRect } from './zone-history';
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

/**
 * Playable side length in world tiles. 24 × 8 m = 192 m, plus the export's
 * border ring. (It was 12 tiles, 96 m: a wagon at 5 m/s crossed that in under
 * 20 s. At 192 m, with the wagon cut in near its trailing edge, it has about
 * 150 m, 30 s, of road ahead.)
 */
export const AREA_WINDOW_TILES = 24;
/**
 * Where the wagon sits along the window's heading axis when the window is cut
 * toward its direction of travel: this far in from the edge it came from, as a
 * fraction of the window. 0.5 is centred.
 */
export const CONVOY_TRAIL_FRAC = 0.22;
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
 * Where, along each axis, `anchor` should sit inside the window, as a fraction
 * from the low edge (0 = west / north edge, 1 = east / south edge).
 *
 * With no `ahead` point (no route, halted, or the point is on top of the
 * anchor) both are 0.5: centred. Otherwise the direction anchor → ahead is
 * scaled so its larger component is 1, and the anchor sits `CONVOY_TRAIL_FRAC`
 * in from the trailing edge on that axis (east-bound: x = 0.22, y = 0.5;
 * north-bound: y = 0.78; a diagonal trails in the corner it came from).
 */
export function convoyAnchorFractions(
  anchor: Vec2,
  ahead: Vec2 | null | undefined,
  trailFrac = CONVOY_TRAIL_FRAC,
): { fx: number; fy: number } {
  if (!ahead) return { fx: 0.5, fy: 0.5 };
  const dx = ahead.x - anchor.x;
  const dy = ahead.y - anchor.y;
  const big = Math.max(Math.abs(dx), Math.abs(dy));
  if (!(big > 1e-6) || !Number.isFinite(big)) return { fx: 0.5, fy: 0.5 };
  const lean = 0.5 - trailFrac;
  return { fx: 0.5 - (dx / big) * lean, fy: 0.5 - (dy / big) * lean };
}

/**
 * Origin tile of a `span`-tile window that holds `anchor` at the biased spot of
 * `convoyAnchorFractions`, clamped to the world. (A window the clamp pushes
 * back keeps the anchor in it, just nearer the edge than asked.)
 */
export function convoyWindowOrigin(
  anchor: Vec2,
  ahead: Vec2 | null | undefined,
  span: number,
  worldWidth: number,
  worldHeight: number,
): { x0: number; y0: number } {
  const { fx, fy } = convoyAnchorFractions(anchor, ahead);
  const x0 = Math.round(anchor.x - span * fx);
  const y0 = Math.round(anchor.y - span * fy);
  return {
    x0: Math.min(worldWidth - span, Math.max(0, x0)),
    y0: Math.min(worldHeight - span, Math.max(0, y0)),
  };
}

/**
 * A window placed around a point rather than snapped to the grid. The 3D
 * convoy cuts these around the rolling wagon. Centred on the point by default;
 * with an `ahead` point on the route (about a zone-width down the road) the
 * window is pushed that way, so the wagon sits near the edge it came from and
 * most of the zone lies ahead of it. Same size, biome pick, and seed mix as
 * `cutAreaWindow`.
 */
export function cutConvoyWindow(
  world: WorldData,
  x: number,
  y: number,
  ahead?: Vec2 | null,
): AreaWindow {
  const span = Math.max(1, Math.min(AREA_WINDOW_TILES, world.width, world.height));
  const { x0, y0 } = convoyWindowOrigin({ x, y }, ahead, span, world.width, world.height);
  return cutWindowAt(world, x0, y0);
}

/**
 * The window with this exact origin (clamped to the world): how a remembered
 * zone is rebuilt. The same origin always gives the same biome and seed, so
 * going back to a zone rebuilds the zone that was there.
 */
export function cutWindowAt(world: WorldData, x0: number, y0: number): AreaWindow {
  const span = Math.max(1, Math.min(AREA_WINDOW_TILES, world.width, world.height));
  const ox = Math.min(world.width - span, Math.max(0, Math.round(x0)));
  const oy = Math.min(world.height - span, Math.max(0, Math.round(y0)));
  const x1 = ox + span;
  const y1 = oy + span;
  const tiles: Vec2[] = [];
  for (let yy = oy; yy < y1; yy++) {
    for (let xx = ox; xx < x1; xx++) tiles.push({ x: xx, y: yy });
  }
  return {
    id: `convoy-${ox}-${oy}`,
    x0: ox,
    y0: oy,
    x1,
    y1,
    tiles,
    biome: dominantLandBiome(world, tiles),
    seed: windowSeed(world.seed, ox, oy),
  };
}

/**
 * The box a settlement's zone fills on the map: the footprint the 3D town
 * export plays on (`boundsFromTiles` of its tiles), plus the ring of outskirts
 * the export draws around it, clamped to the world.
 */
export function settlementZoneRect(world: WorldData, node: MapNode): ZoneRect {
  const b = boundsFromTiles(node.tiles ?? []);
  const m = TOWN_OUTSKIRTS_TILES;
  return {
    x0: Math.max(0, b.x0 - m),
    y0: Math.max(0, b.y0 - m),
    x1: Math.min(world.width, b.x1 + m),
    y1: Math.min(world.height, b.y1 + m),
  };
}

/** The rectangle `cutConvoyWindow` would cut, without building its tiles. */
export function convoyWindowRect(
  world: WorldData,
  x: number,
  y: number,
  ahead?: Vec2 | null,
): ZoneRect {
  const span = Math.max(1, Math.min(AREA_WINDOW_TILES, world.width, world.height));
  const { x0, y0 } = convoyWindowOrigin({ x, y }, ahead, span, world.width, world.height);
  return { x0, y0, x1: x0 + span, y1: y0 + span };
}

/** The rectangle `cutAreaWindow` would cut, without building its tiles. */
export function gridWindowRect(world: WorldData, x: number, y: number): ZoneRect {
  const span = Math.max(1, Math.min(AREA_WINDOW_TILES, world.width, world.height));
  const tx = Math.floor(wrapX(x, world.width));
  const ty = Math.min(world.height - 1, Math.max(0, Math.floor(y)));
  let x0 = Math.floor(tx / span) * span;
  let y0 = Math.floor(ty / span) * span;
  if (x0 + span > world.width) x0 = world.width - span;
  if (y0 + span > world.height) y0 = world.height - span;
  return { x0, y0, x1: x0 + span, y1: y0 + span };
}

/** Land to stand on at a point (shore water clamps to land), or null on deep water. */
export function landStandAt(
  world: WorldData,
  x: number,
  y: number,
): { x: number; y: number; clamped: boolean } | null {
  return landStand(world, x, y);
}

/** Convoy area for a window with this exact origin. */
export function resolveConvoyWindowAt(world: WorldData, x0: number, y0: number): ResolvedArea {
  const window = cutWindowAt(world, x0, y0);
  return {
    node: nodeFromWindow(window),
    cacheKey: `convoy:${window.x0}:${window.y0}`,
    minX: window.x0,
    minY: window.y0,
    maxX: window.x1 - 1,
    maxY: window.y1 - 1,
  };
}

/** Convoy area around a point. Null on deep water or inside a settlement. */
export function resolveConvoyArea(
  world: WorldData,
  x: number,
  y: number,
  ahead?: Vec2 | null,
): ResolvedArea | null {
  if (settlementNodeAt(world, x, y)) return null;
  if (!landStand(world, x, y)) return null;
  const window = cutConvoyWindow(world, x, y, ahead);
  return {
    node: nodeFromWindow(window),
    cacheKey: `convoy:${window.x0}:${window.y0}`,
    minX: window.x0,
    minY: window.y0,
    maxX: window.x1 - 1,
    maxY: window.y1 - 1,
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
