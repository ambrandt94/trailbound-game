/**
 * Ward labels and wall lines for capitals and metropolises. The street graph
 * stays in layout-v3. This module only cuts the footprint and names the pieces.
 */
import type { BuildingRole } from './building-roles';
import { fineToQuadrant, quadKey } from './city-mask';
import { Biome, ZONE_SCALE, type Vec2 } from './models';
import { partitionFootprint, type CutWard } from './ward-partition';

const QUADRANT_M = 8 * ZONE_SCALE;

export interface LayoutWard {
  id: number;
  kind: string;
  quadrants: Vec2[];
  weights: Map<BuildingRole, number>;
}

export interface PlannedWards {
  wards: LayoutWard[];
  wardIdAt: (x: number, y: number) => number | undefined;
}

const WEIGHTS: Record<string, Array<[BuildingRole, number]>> = {
  market: [
    ['market', 5],
    ['shop', 4],
    ['inn', 3],
    ['bakery', 2],
  ],
  temple: [
    ['temple', 5],
    ['shrine', 2],
    ['healer', 3],
  ],
  noble: [
    ['manor', 5],
    ['guildhall', 3],
    ['bank', 3],
    ['home', 1],
  ],
  craft: [
    ['smithy', 4],
    ['workshop', 4],
    ['warehouse', 3],
    ['stables', 2],
    ['wagonwright', 2],
  ],
  docks: [
    ['dock', 5],
    ['warehouse', 3],
    ['shop', 2],
  ],
  slums: [
    ['home', 6],
    ['workshop', 2],
  ],
  keep: [
    ['keep', 6],
    ['town_hall', 4],
    ['barracks', 3],
    ['guard_post', 2],
  ],
  residential: [
    ['home', 6],
    ['shop', 1],
    ['farmstead', 1],
  ],
};

function weightMap(kind: string): Map<BuildingRole, number> {
  const map = new Map<BuildingRole, number>();
  for (const [role, w] of WEIGHTS[kind] ?? WEIGHTS.residential!) map.set(role, w);
  return map;
}

function quadrantsOf(tiles: readonly Vec2[]): Vec2[] {
  const seen = new Set<number>();
  const out: Vec2[] = [];
  for (const tile of tiles) {
    const q = fineToQuadrant(tile);
    const key = quadKey(q.x, q.y);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(q);
  }
  out.sort((a, b) => a.y - b.y || a.x - b.x);
  return out;
}

function centroid(quads: readonly Vec2[]): { x: number; y: number } {
  let x = 0;
  let y = 0;
  for (const q of quads) {
    x += (q.x + 0.5) * QUADRANT_M;
    y += (q.y + 0.5) * QUADRANT_M;
  }
  const n = Math.max(1, quads.length);
  return { x: x / n, y: y / n };
}

function meanHeight(quads: readonly Vec2[], heightAt: (x: number, y: number) => number): number {
  let sum = 0;
  for (const q of quads) {
    sum += heightAt(q.x * 8 + 4, q.y * 8 + 4);
  }
  return sum / Math.max(1, quads.length);
}

/**
 * Name the cutter's wards. Keep takes the high ground near the middle, docks
 * only a ward that touches water, and the rest follow the avenues.
 */
export function planWards(
  tiles: readonly Vec2[],
  centre: { x: number; y: number },
  entries: readonly { x: number; y: number }[],
  heightAt: (x: number, y: number) => number,
  waterAt: (qx: number, qy: number) => boolean,
): PlannedWards {
  const quadrants = quadrantsOf(tiles);
  const cut = partitionFootprint({
    quadrants,
    singleWard: quadrants.length < 16,
  });
  const raw = cut.wards.length
    ? cut.wards
    : [{ wardId: 0, quadrants, neighbours: [] } satisfies CutWard];
  const info = raw.map((ward) => ({
    ward,
    at: centroid(ward.quadrants),
    h: meanHeight(ward.quadrants, heightAt),
    water: ward.quadrants.some((q) => waterAt(q.x, q.y)),
  }));
  const taken = new Set<number>();
  const kindOf = new Map<number, string>();
  const claim = (id: number, kind: string) => {
    if (taken.has(id)) return false;
    taken.add(id);
    kindOf.set(id, kind);
    return true;
  };
  const open = () => info.filter((item) => !taken.has(item.ward.wardId));
  const nearest = (list: typeof info, x: number, y: number): (typeof info)[number] | undefined => {
    let best: (typeof info)[number] | undefined;
    let dist = Infinity;
    for (const item of list) {
      const d = Math.hypot(item.at.x - x, item.at.y - y);
      if (d < dist) {
        dist = d;
        best = item;
      }
    }
    return best;
  };

  let keep = info[0]!;
  let keepScore = -Infinity;
  for (const item of info) {
    const score = item.h * 40 - Math.hypot(item.at.x - centre.x, item.at.y - centre.y);
    if (score > keepScore) {
      keepScore = score;
      keep = item;
    }
  }
  claim(keep.ward.wardId, 'keep');

  const dock = open().filter((item) => item.water);
  if (dock.length) {
    dock.sort(
      (a, b) => b.ward.quadrants.length - a.ward.quadrants.length || a.ward.wardId - b.ward.wardId,
    );
    claim(dock[0]!.ward.wardId, 'docks');
  }

  const gate = entries[0] ?? centre;
  const marketAt = {
    x: centre.x + (gate.x - centre.x) * 0.42,
    y: centre.y + (gate.y - centre.y) * 0.42,
  };
  const market = nearest(open(), marketAt.x, marketAt.y);
  if (market) claim(market.ward.wardId, 'market');

  const neighbourIds = new Set((market?.ward.neighbours ?? []).map((n) => n.wardId));
  const templePool = open().filter((item) => neighbourIds.has(item.ward.wardId));
  const temple = nearest(
    templePool.length ? templePool : open(),
    market?.at.x ?? centre.x,
    market?.at.y ?? centre.y,
  );
  if (temple) claim(temple.ward.wardId, 'temple');

  const keepNeighbours = new Set(keep.ward.neighbours.map((n) => n.wardId));
  const noblePool = open().filter((item) => keepNeighbours.has(item.ward.wardId));
  const noble = nearest(noblePool.length ? noblePool : open(), keep.at.x, keep.at.y);
  if (noble) claim(noble.ward.wardId, 'noble');

  const craftAt = entries[1] ?? entries[0] ?? centre;
  const craft = nearest(open(), craftAt.x, craftAt.y);
  if (craft) claim(craft.ward.wardId, 'craft');

  let far = 1;
  for (const item of info) {
    far = Math.max(far, Math.hypot(item.at.x - centre.x, item.at.y - centre.y));
  }
  for (const item of open()) {
    const d = Math.hypot(item.at.x - centre.x, item.at.y - centre.y);
    claim(item.ward.wardId, d > far * 0.72 ? 'slums' : 'residential');
  }

  const index = new Map<number, number>();
  const wards: LayoutWard[] = raw.map((ward) => {
    const kind = kindOf.get(ward.wardId) ?? 'residential';
    const laid: LayoutWard = {
      id: ward.wardId,
      kind,
      quadrants: ward.quadrants,
      weights: weightMap(kind),
    };
    for (const q of ward.quadrants) index.set(quadKey(q.x, q.y), ward.wardId);
    return laid;
  });
  wards.sort((a, b) => a.id - b.id);

  return {
    wards,
    wardIdAt: (x, y) => {
      const q = fineToQuadrant({ x: Math.floor(x / ZONE_SCALE), y: Math.floor(y / ZONE_SCALE) });
      return index.get(quadKey(q.x, q.y));
    },
  };
}

/** A ward touches water when a fine tile just outside it is water. */
export function waterBeside(
  tiles: readonly Vec2[],
  biomeAt: (x: number, y: number) => number,
): (qx: number, qy: number) => boolean {
  const inside = new Set(tiles.map((t) => `${t.x},${t.y}`));
  return (qx, qy) => {
    const x0 = qx * 8;
    const y0 = qy * 8;
    for (let y = y0; y < y0 + 8; y++) {
      for (let x = x0; x < x0 + 8; x++) {
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ] as const) {
          const nx = x + dx;
          const ny = y + dy;
          if (inside.has(`${nx},${ny}`)) continue;
          if (biomeAt(nx, ny) === Biome.Water) return true;
        }
      }
    }
    return false;
  };
}

function cornerKey(x: number, y: number): string {
  return `${x},${y}`;
}

/**
 * Outer loop of a cell mask, in metres, smoothed so a stair-stepped tile edge
 * reads as a wall. The longest loop wins when a mask has a hole.
 */
export function traceCellLoop(
  cells: readonly Vec2[],
  metersPerCell: number,
): Array<[number, number]> {
  if (cells.length < 4) return [];
  const set = new Set(cells.map((c) => cornerKey(c.x, c.y)));
  const next = new Map<string, string>();
  const add = (x0: number, y0: number, x1: number, y1: number) => {
    next.set(cornerKey(x0, y0), cornerKey(x1, y1));
  };
  const ordered = cells.slice().sort((a, b) => a.y - b.y || a.x - b.x);
  for (const c of ordered) {
    if (!set.has(cornerKey(c.x, c.y - 1))) add(c.x, c.y, c.x + 1, c.y);
    if (!set.has(cornerKey(c.x + 1, c.y))) add(c.x + 1, c.y, c.x + 1, c.y + 1);
    if (!set.has(cornerKey(c.x, c.y + 1))) add(c.x + 1, c.y + 1, c.x, c.y + 1);
    if (!set.has(cornerKey(c.x - 1, c.y))) add(c.x, c.y + 1, c.x, c.y);
  }
  const starts = [...next.keys()].sort();
  let best: string[] = [];
  const seen = new Set<string>();
  for (const start of starts) {
    if (seen.has(start)) continue;
    const loop = [start];
    seen.add(start);
    let cur = start;
    for (let n = 0; n < next.size + 2; n++) {
      const nxt = next.get(cur);
      if (!nxt || nxt === start) break;
      if (seen.has(nxt)) break;
      seen.add(nxt);
      loop.push(nxt);
      cur = nxt;
    }
    if (loop.length > best.length) best = loop;
  }
  if (best.length < 4) return [];
  const raw: Array<[number, number]> = best.map((key) => {
    const [x, y] = key.split(',').map(Number);
    return [Math.round(x! * metersPerCell * 100) / 100, Math.round(y! * metersPerCell * 100) / 100];
  });
  raw.push(raw[0]!);
  return chaikinClosed(chaikinClosed(raw));
}

function chaikinClosed(points: Array<[number, number]>): Array<[number, number]> {
  const src = points.slice();
  if (src.length > 1) {
    const a = src[0]!;
    const b = src[src.length - 1]!;
    if (a[0] === b[0] && a[1] === b[1]) src.pop();
  }
  if (src.length < 3) return points;
  const out: Array<[number, number]> = [];
  for (let i = 0; i < src.length; i++) {
    const p = src[i]!;
    const n = src[(i + 1) % src.length]!;
    out.push([
      Math.round((p[0] * 0.75 + n[0] * 0.25) * 100) / 100,
      Math.round((p[1] * 0.75 + n[1] * 0.25) * 100) / 100,
    ]);
    out.push([
      Math.round((p[0] * 0.25 + n[0] * 0.75) * 100) / 100,
      Math.round((p[1] * 0.25 + n[1] * 0.75) * 100) / 100,
    ]);
  }
  out.push(out[0]!);
  return out;
}

/** Where a rank-1 avenue crosses into the keep ward. At least one gate. */
export function keepGatePoints(
  roads: readonly { rank: number; points: Array<[number, number]> }[],
  loop: readonly [number, number][],
  inside: (x: number, y: number) => boolean,
): Array<{ x: number; y: number }> {
  const gates: Array<{ x: number; y: number }> = [];
  for (const road of roads) {
    if (road.rank !== 1) continue;
    let prev = false;
    let prevPt: [number, number] | null = null;
    for (const p of road.points) {
      const now = inside(p[0], p[1]);
      if (prevPt && now !== prev) {
        const snap = loopHit(prevPt, p, loop) ?? nearest(loop, p[0], p[1]);
        if (!gates.some((g) => Math.hypot(g.x - snap[0], g.y - snap[1]) < 12)) {
          gates.push({ x: snap[0], y: snap[1] });
        }
      }
      prev = now;
      prevPt = p;
    }
  }
  if (!gates.length && loop.length) {
    let best = loop[0]!;
    let dist = Infinity;
    for (const p of loop) {
      let d = Infinity;
      for (const road of roads) {
        if (road.rank !== 1) continue;
        for (const q of road.points) d = Math.min(d, Math.hypot(q[0] - p[0], q[1] - p[1]));
      }
      if (d < dist) {
        dist = d;
        best = p;
      }
    }
    gates.push({ x: best[0], y: best[1] });
  }
  return gates;
}

function loopHit(
  a: readonly [number, number],
  b: readonly [number, number],
  loop: readonly [number, number][],
): [number, number] | null {
  const rx = b[0] - a[0];
  const ry = b[1] - a[1];
  for (let i = 1; i < loop.length; i++) {
    const c = loop[i - 1]!;
    const d = loop[i]!;
    const sx = d[0] - c[0];
    const sy = d[1] - c[1];
    const den = rx * sy - ry * sx;
    if (Math.abs(den) < 1e-8) continue;
    const t = ((c[0] - a[0]) * sy - (c[1] - a[1]) * sx) / den;
    const u = ((c[0] - a[0]) * ry - (c[1] - a[1]) * rx) / den;
    if (t < -0.02 || t > 1.02 || u < -0.02 || u > 1.02) continue;
    return [a[0] + rx * t, a[1] + ry * t];
  }
  return null;
}

function nearest(loop: readonly [number, number][], x: number, y: number): [number, number] {
  let best = loop[0] ?? [x, y];
  let dist = Infinity;
  for (const p of loop) {
    const d = Math.hypot(p[0] - x, p[1] - y);
    if (d < dist) {
      dist = d;
      best = p;
    }
  }
  return best;
}
