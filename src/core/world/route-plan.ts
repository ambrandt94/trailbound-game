/**
 * Caravan routing over fine world tiles. A* with 8-way moves.
 * Roads are cheapest, open land costs more, forest, hills, and mountains
 * cost more again, and deep water is impassable. The search runs inside a
 * padded window around the two ends so a click does not walk the whole
 * 3072² continent. The window does not wrap the date line.
 */
import { Biome, type Vec2, type WorldData } from './models';

/** Step cost per tile. Road is 1, so the octile heuristic stays admissible. */
export const ROUTE_COST = {
  road: 1,
  open: 3,
  forest: 5,
  hills: 6,
  mountain: 9,
} as const;

/** Pad around the start–goal box, in fine tiles. */
const MIN_PAD = 96;
const PAD_FRACTION = 0.6;
/** Hard cap on window cells so one click cannot stall a frame forever. */
const MAX_WINDOW_CELLS = 6_000_000;
/** Simplify tolerance, fine tiles. Small so the line keeps to the road. */
const SIMPLIFY_TILES = 0.45;
const SQRT2 = Math.SQRT2;

/** Cost of entering this tile. `Infinity` for deep water or off the map. */
export function tileCost(world: WorldData, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= world.width || y >= world.height) return Infinity;
  const i = x + y * world.width;
  const biome = world.biomes[i] as Biome;
  if (biome === Biome.Water) return Infinity;
  if (world.paths[i]) return ROUTE_COST.road;
  switch (biome) {
    case Biome.Forest:
    case Biome.DarkForest:
    case Biome.Jungle:
    case Biome.Marsh:
    case Biome.Taiga:
      return ROUTE_COST.forest;
    case Biome.Hills:
      return ROUTE_COST.hills;
    case Biome.Mountain:
    case Biome.Snow:
      return ROUTE_COST.mountain;
    default:
      return ROUTE_COST.open;
  }
}

export interface RoutePlan {
  /** Polyline in fine tiles. Starts at `from`, ends at `to`. */
  points: Vec2[];
  /** Polyline length in fine tiles. */
  length: number;
  /** A* path cost. */
  cost: number;
  /** Nodes expanded. Kept for tests and the perf readout. */
  expanded: number;
}

/**
 * Cheapest land route between two fine-tile points, or null when the goal is
 * open water or cut off by it. The start tile may be water (a hero on a
 * shoreline); every later tile must be land.
 */
export function planRoute(world: WorldData, from: Vec2, to: Vec2): RoutePlan | null {
  const sx = Math.floor(from.x);
  const sy = Math.floor(from.y);
  const gx = Math.floor(to.x);
  const gy = Math.floor(to.y);
  if (!Number.isFinite(sx + sy + gx + gy)) return null;
  if (!Number.isFinite(tileCost(world, gx, gy))) return null;
  if (sx === gx && sy === gy) {
    const points = [
      { x: from.x, y: from.y },
      { x: to.x, y: to.y },
    ];
    return { points, length: polylineLength(points), cost: 0, expanded: 0 };
  }
  const span = Math.max(Math.abs(gx - sx), Math.abs(gy - sy));
  let pad = Math.max(MIN_PAD, Math.ceil(span * PAD_FRACTION));
  let x0 = 0;
  let y0 = 0;
  let w = 0;
  let h = 0;
  for (;;) {
    x0 = Math.max(0, Math.min(sx, gx) - pad);
    y0 = Math.max(0, Math.min(sy, gy) - pad);
    const x1 = Math.min(world.width - 1, Math.max(sx, gx) + pad);
    const y1 = Math.min(world.height - 1, Math.max(sy, gy) + pad);
    w = x1 - x0 + 1;
    h = y1 - y0 + 1;
    if (w * h <= MAX_WINDOW_CELLS || pad <= MIN_PAD) break;
    pad = Math.max(MIN_PAD, Math.floor(pad * 0.7));
  }
  const n = w * h;
  const g = new Float64Array(n).fill(Infinity);
  const parent = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const heap = new MinHeap();
  const local = (x: number, y: number): number => x - x0 + (y - y0) * w;
  const heuristic = (x: number, y: number): number => {
    const dx = Math.abs(x - gx);
    const dy = Math.abs(y - gy);
    return ROUTE_COST.road * (Math.max(dx, dy) + (SQRT2 - 1) * Math.min(dx, dy));
  };
  const start = local(sx, sy);
  const goal = local(gx, gy);
  g[start] = 0;
  heap.push(start, heuristic(sx, sy));
  let expanded = 0;
  while (heap.size > 0) {
    const cur = heap.pop();
    if (closed[cur]) continue;
    closed[cur] = 1;
    expanded += 1;
    if (cur === goal) break;
    const cx = (cur % w) + x0;
    const cy = Math.floor(cur / w) + y0;
    const base = g[cur]!;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < x0 || ny < y0 || nx >= x0 + w || ny >= y0 + h) continue;
        const ni = local(nx, ny);
        if (closed[ni]) continue;
        const step = tileCost(world, nx, ny);
        if (!Number.isFinite(step)) continue;
        const diagonal = dx !== 0 && dy !== 0;
        if (diagonal) {
          // No corner cutting across water.
          if (!Number.isFinite(tileCost(world, cx + dx, cy))) continue;
          if (!Number.isFinite(tileCost(world, cx, cy + dy))) continue;
        }
        const next = base + step * (diagonal ? SQRT2 : 1);
        if (next >= g[ni]!) continue;
        g[ni] = next;
        parent[ni] = cur;
        heap.push(ni, next + heuristic(nx, ny));
      }
    }
  }
  if (!closed[goal]) return null;
  const cells: Vec2[] = [];
  for (let at = goal; at !== -1; at = parent[at]!) {
    cells.push({ x: (at % w) + x0 + 0.5, y: Math.floor(at / w) + y0 + 0.5 });
    if (at === start) break;
  }
  cells.reverse();
  cells[0] = { x: from.x, y: from.y };
  cells[cells.length - 1] = { x: to.x, y: to.y };
  const points = simplifyPolyline(cells, SIMPLIFY_TILES);
  return { points, length: polylineLength(points), cost: g[goal]!, expanded };
}

export function polylineLength(points: readonly Vec2[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    total += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return total;
}

/** Ramer–Douglas–Peucker. Keeps both ends. */
export function simplifyPolyline(points: readonly Vec2[], tolerance: number): Vec2[] {
  if (points.length <= 2) return points.map((p) => ({ x: p.x, y: p.y }));
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const pa = points[a]!;
    const pb = points[b]!;
    let worst = -1;
    let worstD = tolerance;
    for (let i = a + 1; i < b; i++) {
      const d = segmentDistance(points[i]!, pa, pb);
      if (d > worstD) {
        worstD = d;
        worst = i;
      }
    }
    if (worst >= 0) {
      keep[worst] = 1;
      stack.push([a, worst], [worst, b]);
    }
  }
  const out: Vec2[] = [];
  for (let i = 0; i < points.length; i++) {
    if (keep[i]) out.push({ x: points[i]!.x, y: points[i]!.y });
  }
  return out;
}

function segmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-12) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

/** Binary min-heap of (index, priority). */
class MinHeap {
  private ids: number[] = [];
  private keys: number[] = [];

  get size(): number {
    return this.ids.length;
  }

  push(id: number, key: number): void {
    const ids = this.ids;
    const keys = this.keys;
    let i = ids.length;
    ids.push(id);
    keys.push(key);
    while (i > 0) {
      const up = (i - 1) >> 1;
      if (keys[up]! <= key) break;
      ids[i] = ids[up]!;
      keys[i] = keys[up]!;
      i = up;
    }
    ids[i] = id;
    keys[i] = key;
  }

  pop(): number {
    const ids = this.ids;
    const keys = this.keys;
    const top = ids[0]!;
    const lastId = ids.pop()!;
    const lastKey = keys.pop()!;
    const n = ids.length;
    if (n === 0) return top;
    let i = 0;
    for (;;) {
      const l = i * 2 + 1;
      if (l >= n) break;
      const r = l + 1;
      const c = r < n && keys[r]! < keys[l]! ? r : l;
      if (keys[c]! >= lastKey) break;
      ids[i] = ids[c]!;
      keys[i] = keys[c]!;
      i = c;
    }
    ids[i] = lastId;
    keys[i] = lastKey;
    return top;
  }
}
