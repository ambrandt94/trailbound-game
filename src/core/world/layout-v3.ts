/**
 * Settlement layout generation 3. Streets are continuous polylines, lots are
 * oriented boxes at any yaw, and every building has a role. Deterministic
 * from the node seed. Capitals and metropolises use the same graph, cut into wards.
 */
import { ROLE_STYLE, type BuildingRole, type RoleDemand } from './building-roles';
import {
  biomeSetFor,
  blendCurviness,
  resolveBiomeSet,
  resolveBuilding,
  roofMaterialForSet,
  urbanForm,
  type BiomeSetId,
} from './biome-building-sets';
import { SIZE_CLASS, type SettlementClass } from './city-plan';
import { rollCulture } from './culture';
import { resolveLayoutStyle, type DefenceRule, type LayoutStyle } from './layout-styles';
import type {
  PlanBuilding,
  PlanProp,
  PlanRoad,
  PlanSegment,
  PlanWard,
  PlanZone,
  RoadPaint,
  SettlementPlan,
} from './layout-v2';
import { keepGatePoints, planWards, traceCellLoop, waterBeside } from './layout-wards';
import { type BuildingRotation, type Cardinal, placedMaskAtYaw } from './building-templates';
import { ensureKitTemplate, kitBuilding, resolveKit } from './kit-catalog';
import { fbm, hash2, Rng } from './noise';
import { Biome, type MapNode, type WorldData, ZONE_SCALE } from './models';
import { worldHeightSampler } from './world-gen';
import { type SettlementTier, roadForRank, tierById, tierForKind } from './settlement-tiers';

const V3_CLASS = new Set<SettlementClass>([
  'hamlet',
  'village',
  'town',
  'city',
  'capital',
  'metropolis',
]);

export function usesLayoutV3(world: WorldData, node: MapNode): boolean {
  if (world.settings.settlementGen !== 3) return false;
  if (node.poiKind) return false;
  const cls = node.settlementClass;
  return cls !== undefined && V3_CLASS.has(cls);
}

interface Obb {
  cx: number;
  cy: number;
  w: number;
  d: number;
  yawDeg: number;
}

interface Edge {
  id: string;
  rank: number;
  widthM: number;
  points: Array<[number, number]>;
  samples: Array<[number, number]>;
}

interface Lot {
  edge: string;
  rank: number;
  arc: number;
  obb: Obb;
  district: string;
  weights: Map<BuildingRole, number>;
}

interface Field {
  originX: number;
  originY: number;
  step: number;
  w: number;
  h: number;
  blocked: Uint8Array;
  cost: Float32Array;
}

function nowMs(): number {
  const perf = (globalThis as { performance?: { now(): number } }).performance;
  return perf ? perf.now() : Date.now();
}

function stageSeed(placeSeed: number, stage: string): number {
  let h = (placeSeed >>> 0) ^ 0x811c9dc5;
  for (let i = 0; i < stage.length; i++) h = Math.imul(h ^ stage.charCodeAt(i), 16777619);
  return (h ^ (h >>> 16)) >>> 0 || 1;
}

function q(n: number): number {
  return Math.round(n * 100) / 100;
}

function qYaw(deg: number): number {
  const y = Math.round(deg) % 360;
  return y < 0 ? y + 360 : y;
}

function keyOf(x: number, y: number): string {
  return `${x},${y}`;
}

export function buildLayoutV3(world: WorldData, node: MapNode): SettlementPlan {
  const started = nowMs();
  const cls = (node.settlementClass ?? 'village') as SettlementClass;
  const cultureId = rollCulture(world.seed, node, world.settings.cultureOverride);
  const resolved = resolveLayoutStyle(cultureId);
  const style = resolved.style;
  const setId = biomeSetFor(node.biome);
  const setResolved = resolveBiomeSet(setId);
  const set = setResolved.set;
  const curviness = blendCurviness(style, node.biome);
  const tier = tierForKind(node.kind) ?? 'village';
  const row = tierById(tier);
  const notes: string[] = [];
  const dropNotes: string[] = [];
  const warnings: string[] = [];
  if (resolved.stubbed) notes.push(`${resolved.requested} layout is stubbed onto ${style.id}.`);
  if (setResolved.stubbed) notes.push(`${setId} buildings are stubbed onto ${set.id}.`);
  notes.push(`curviness ${curviness.toFixed(2)} from ${style.id} and biome ${node.biome}.`);

  const tiles = node.tiles ?? [];
  const inside = new Set(tiles.map((t) => keyOf(t.x, t.y)));
  const contains = (x: number, y: number): boolean => {
    const tx = Math.floor(x / ZONE_SCALE);
    const ty = Math.floor(y / ZONE_SCALE);
    return inside.has(keyOf(tx, ty));
  };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const t of tiles) {
    minX = Math.min(minX, t.x * ZONE_SCALE);
    minY = Math.min(minY, t.y * ZONE_SCALE);
    maxX = Math.max(maxX, (t.x + 1) * ZONE_SCALE);
    maxY = Math.max(maxY, (t.y + 1) * ZONE_SCALE);
  }
  if (!Number.isFinite(minX)) {
    minX = node.cx * ZONE_SCALE - 16;
    minY = node.cy * ZONE_SCALE - 16;
    maxX = minX + 32;
    maxY = minY + 32;
  }
  const cx = q(node.cx * ZONE_SCALE);
  const cy = q(node.cy * ZONE_SCALE);
  const centre = contains(cx, cy) ? { x: cx, y: cy } : nearestInside(cx, cy, contains);

  const rngRoad = new Rng(stageSeed(node.seed, 'v3-roads'));
  const rngLot = new Rng(stageSeed(node.seed, 'v3-lots'));
  const rngRole = new Rng(stageSeed(node.seed, 'v3-roles'));
  const heightAt = worldHeightSampler(world);
  const field = buildField(minX, minY, maxX, maxY, contains, heightAt, curviness, node.seed);

  let entries = findEntries(world, tiles, inside, contains);
  entries = fillEntries(entries, centre, contains, cls);
  const size = SIZE_CLASS[cls];
  const target = Math.min(
    size.buildings[1],
    Math.max(
      size.buildings[0],
      rngRoad.int(size.buildings[0], Math.min(size.buildings[1], placeCap(cls))),
    ),
  );

  const edges = buildEdges(
    style,
    field,
    centre,
    entries,
    curviness,
    cls,
    size.roadRanks,
    rngRoad,
    contains,
  );
  const span = Math.max(8, Math.min(maxX - minX, maxY - minY));
  const big = cls === 'capital' || cls === 'metropolis';
  const lotTarget = big ? (cls === 'metropolis' ? 9000 : 6000) : target;
  let wards: PlanWard[] | undefined;
  let seedLots: Lot[] = [];
  let plazas: Array<{ x: number; y: number; r: number }> = [];
  let planned: ReturnType<typeof planWards> | undefined;
  if (big && tiles.length) {
    const biomeAt = (x: number, y: number) => {
      if (x < 0 || y < 0 || x >= world.width || y >= world.height) return Biome.Water;
      return world.biomes[x + y * world.width] ?? Biome.Plains;
    };
    planned = planWards(tiles, centre, entries, heightAt, waterBeside(tiles, biomeAt));
    if (style.streets.kind === 'organic') {
      layWardStreets(planned, edges, field, contains, curviness);
    }
    const seeded = plazaLots(planned, edges, contains);
    seedLots = seeded.lots;
    plazas = seeded.plazas;
  }
  let lots = placeLots(
    style,
    edges,
    contains,
    centre,
    cls,
    lotTarget,
    curviness,
    rngLot,
    span,
    seedLots,
    plazas,
    (x, y) => {
      if (!planned) return undefined;
      const id = planned.wardIdAt(x, y);
      return id === undefined ? undefined : planned.wards.find((ward) => ward.id === id)?.kind;
    },
  );
  const districts = seedDistricts(style, centre, entries, tiles, heightAt);
  if (big && tiles.length && planned) {
    const byId = new Map(planned.wards.map((ward) => [ward.id, ward]));
    const kept: Lot[] = [];
    for (const lot of lots) {
      const id = planned.wardIdAt(lot.obb.cx, lot.obb.cy);
      const ward = id === undefined ? undefined : byId.get(id);
      if (!ward) continue;
      let cross = false;
      for (const [x, y] of cornersOf(lot.obb)) {
        const other = planned.wardIdAt(x, y);
        if (other !== undefined && other !== id) {
          cross = true;
          break;
        }
      }
      if (cross) continue;
      lot.district = ward.kind;
      lot.weights = ward.weights;
      kept.push(lot);
    }
    if (kept.length) lots = kept;
    wards = planned.wards.map((ward) => ({
      id: ward.id,
      kind: ward.kind,
      quadrants: ward.quadrants,
    }));
    notes.push(`${wards.length} wards across the core.`);
  } else {
    for (const lot of lots) {
      lot.district = nearestDistrict(lot.obb, districts);
      lot.weights = districts.find((d) => d.id === lot.district)?.weights ?? new Map();
    }
  }

  const gateCount = Math.max(1, entries.length);
  const assigned = assignRoles(style, cls, lots, target, gateCount, rngRole, dropNotes, big);
  const buildings = assigned.flatMap((role, index) => {
    const lot = lots[index];
    if (!lot || !role) return [];
    const built = makeBuilding(role, lot, style, set, index, big && style.id !== 'orc');
    return built ? [built] : [];
  });

  const defence = defenceFor(style, cls, size.defence);
  const wall =
    defence.kind === 'none'
      ? []
      : big
        ? traceCellLoop(tiles, ZONE_SCALE)
        : outlineOf(centre, contains);
  const gates = pierceAvenues(edges, entries, wall);
  const roads = edges.map((edge, index) => roadOf(edge, index, row));
  const roadCells = rasterRoads(edges);
  const segments = wallSegments(defence, wall, gates);
  const keep = wards?.find((ward) => ward.kind === 'keep');
  if (big && keep && keep.quadrants.length >= 4) {
    const loop = traceCellLoop(keep.quadrants, 8 * ZONE_SCALE);
    const keepKeys = new Set(keep.quadrants.map((q) => `${q.x},${q.y}`));
    const insideKeep = (x: number, y: number) => {
      const qx = Math.floor(x / (8 * ZONE_SCALE));
      const qy = Math.floor(y / (8 * ZONE_SCALE));
      return keepKeys.has(`${qx},${qy}`);
    };
    const innerGates = keepGatePoints(edges, loop, insideKeep).map((gate) => ({
      ...gate,
      rot: gateRot(edges, gate.x, gate.y),
    }));
    const inner = wallSegments(
      { kind: 'curtain', towers: 'every_n', gates: [1, 2] },
      loop,
      innerGates,
    ).map((segment, index) => ({ ...segment, id: `keep${index}` }));
    segments.push(...inner);
    gates.push(...innerGates);
    notes.push(`inner keep wall, ${innerGates.length} gate${innerGates.length === 1 ? '' : 's'}.`);
  }
  const placed = buildings.filter((building) => {
    const box = building.obb;
    if (!box) return true;
    return !gates.some((gate) => Math.hypot(gate.x - box.cx, gate.y - box.cy) < 12);
  });
  const props = propsFor(style, centre, gates, defence, placed, segments, rngLot);
  const zoneDistricts: Seed[] = wards
    ? [...new Set(wards.map((ward) => ward.kind))].map((id) => ({
        id,
        x: centre.x,
        y: centre.y,
        weights: new Map(),
      }))
    : districts;
  const zones = zonesFor(style, centre, cls, zoneDistricts, placed);
  const respawn = respawnFor(placed, centre, style);

  const planMs = Math.round((nowMs() - started) * 10) / 10;
  notes.push(`plan ${planMs} ms, ${placed.length} buildings, ${edges.length} streets.`);

  return {
    tier,
    style: set.kitSuffix,
    variant: 'default',
    buildingCount: placed.length,
    dropped: dropNotes.length,
    dropNotes,
    districts: zoneDistricts.map((d) => ({ id: d.id, kind: d.id })),
    respawnAnchor: respawn,
    roads,
    roadCells,
    zones,
    buildings: placed,
    props,
    segments,
    warnings,
    plaza: zones.find((z) => z.kind === 'plaza' || z.kind === 'green')?.rect ?? null,
    notes,
    layoutGen: 3,
    culture: cultureId,
    biomeSet: set.id as BiomeSetId,
    curviness,
    planMs,
    wallLoop: wall,
    gates,
    ...(wards ? { wards } : {}),
  };
}

function placeCap(cls: SettlementClass): number {
  if (cls === 'hamlet') return 8;
  if (cls === 'village') return 24;
  if (cls === 'town') return 56;
  if (cls === 'city') return 84;
  if (cls === 'capital') return 400;
  return 900;
}

function nearestInside(
  x: number,
  y: number,
  contains: (x: number, y: number) => boolean,
): { x: number; y: number } {
  if (contains(x, y)) return { x: q(x), y: q(y) };
  for (let r = 4; r <= 80; r += 4) {
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const px = x + Math.cos(a) * r;
      const py = y + Math.sin(a) * r;
      if (contains(px, py)) return { x: q(px), y: q(py) };
    }
  }
  return { x: q(x), y: q(y) };
}

function pathAt(world: WorldData, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= world.width || y >= world.height) return false;
  return world.paths[x + y * world.width] === 1;
}

function findEntries(
  world: WorldData,
  tiles: { x: number; y: number }[],
  inside: Set<string>,
  contains: (x: number, y: number) => boolean,
): Array<{ x: number; y: number }> {
  const gates: Array<{ x: number; y: number; score: number }> = [];
  for (const tile of tiles) {
    let edge = false;
    let score = pathAt(world, tile.x, tile.y) ? 1 : 0;
    for (const [dx, dy] of [
      [0, -1],
      [1, 0],
      [0, 1],
      [-1, 0],
    ] as const) {
      if (inside.has(keyOf(tile.x + dx, tile.y + dy))) continue;
      edge = true;
      if (pathAt(world, tile.x + dx, tile.y + dy)) score += 2;
    }
    if (!edge || score <= 0) continue;
    gates.push({ x: (tile.x + 0.5) * ZONE_SCALE, y: (tile.y + 0.5) * ZONE_SCALE, score });
  }
  gates.sort((a, b) => b.score - a.score || a.y - b.y || a.x - b.x);
  const picked: Array<{ x: number; y: number }> = [];
  for (const gate of gates) {
    if (picked.length >= 4) break;
    if (!contains(gate.x, gate.y)) continue;
    if (picked.some((p) => Math.hypot(p.x - gate.x, p.y - gate.y) < 20)) continue;
    picked.push({ x: q(gate.x), y: q(gate.y) });
  }
  return picked;
}

function syntheticEntries(
  centre: { x: number; y: number },
  contains: (x: number, y: number) => boolean,
  rng: Rng,
): Array<{ x: number; y: number }> {
  const angles = [rng.range(0, 0.4), Math.PI * 0.55, Math.PI, Math.PI * 1.45];
  const out: Array<{ x: number; y: number }> = [];
  for (const a of angles) {
    let last = centre;
    for (let r = 6; r <= 180; r += 4) {
      const x = centre.x + Math.cos(a) * r;
      const y = centre.y + Math.sin(a) * r;
      if (!contains(x, y)) break;
      last = { x, y };
    }
    if (Math.hypot(last.x - centre.x, last.y - centre.y) > 8)
      out.push({ x: q(last.x), y: q(last.y) });
    if (out.length >= 3) break;
  }
  return out.length ? out : [{ x: q(centre.x + 12), y: q(centre.y) }];
}

function buildField(
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  contains: (x: number, y: number) => boolean,
  heightAt: (x: number, y: number) => number,
  curviness: number,
  seed: number,
): Field {
  let step = 2;
  let w = Math.max(2, Math.ceil((maxX - minX) / step));
  let h = Math.max(2, Math.ceil((maxY - minY) / step));
  while (w > 128 || h > 128) {
    step *= 2;
    w = Math.max(2, Math.ceil((maxX - minX) / step));
    h = Math.max(2, Math.ceil((maxY - minY) / step));
  }
  const blocked = new Uint8Array(w * h);
  const cost = new Float32Array(w * h);
  for (let iy = 0; iy < h; iy++) {
    for (let ix = 0; ix < w; ix++) {
      const x = minX + ix * step;
      const y = minY + iy * step;
      const i = iy * w + ix;
      if (!contains(x, y)) {
        blocked[i] = 1;
        cost[i] = 8;
        continue;
      }
      const h0 = heightAt(x / ZONE_SCALE, y / ZONE_SCALE);
      const h1 = heightAt((x + step) / ZONE_SCALE, y / ZONE_SCALE);
      const slope = Math.min(4, Math.abs(h1 - h0) * 40);
      const noise = (fbm(x * 0.012, y * 0.012, seed + 17, 3) - 0.5) * curviness * 7;
      cost[i] = Math.max(0.35, 1 + slope + noise);
    }
  }
  return { originX: minX, originY: minY, step, w, h, blocked, cost };
}

function cellIndex(field: Field, x: number, y: number): number {
  const ix = Math.max(0, Math.min(field.w - 1, Math.round((x - field.originX) / field.step)));
  const iy = Math.max(0, Math.min(field.h - 1, Math.round((y - field.originY) / field.step)));
  return iy * field.w + ix;
}

function nearestOpen(field: Field, index: number): number {
  if (!field.blocked[index]) return index;
  const w = field.w;
  const sx = index % w;
  const sy = (index / w) | 0;
  for (let r = 1; r <= 8; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const ix = sx + dx;
        const iy = sy + dy;
        if (ix < 0 || iy < 0 || ix >= w || iy >= field.h) continue;
        const i = iy * w + ix;
        if (!field.blocked[i]) return i;
      }
    }
  }
  return index;
}

function astar(
  field: Field,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): Array<[number, number]> {
  const w = field.w;
  const n = w * field.h;
  const start = nearestOpen(field, cellIndex(field, ax, ay));
  const goal = nearestOpen(field, cellIndex(field, bx, by));
  if (field.blocked[start] || field.blocked[goal]) return straight(ax, ay, bx, by);
  const dist = new Float64Array(n);
  dist.fill(Infinity);
  dist[start] = 0;
  const prev = new Int32Array(n);
  prev.fill(-1);
  const seen = new Uint8Array(n);
  const score = new Float64Array(n);
  const gx = goal % w;
  const gy = (goal / w) | 0;
  score[start] = Math.hypot((start % w) - gx, ((start / w) | 0) - gy);
  const heap = new MinHeap(score);
  heap.push(start);
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const;
  let guard = n;
  while (heap.size && guard-- > 0) {
    const cur = heap.pop();
    if (cur === undefined || seen[cur]) continue;
    seen[cur] = 1;
    if (cur === goal) break;
    const cx = cur % w;
    const cy = (cur / w) | 0;
    for (const [dx, dy] of dirs) {
      const ix = cx + dx;
      const iy = cy + dy;
      if (ix < 0 || iy < 0 || ix >= w || iy >= field.h) continue;
      const ni = iy * w + ix;
      if (field.blocked[ni]) continue;
      const nd = dist[cur]! + field.cost[ni]!;
      if (nd >= dist[ni]!) continue;
      dist[ni] = nd;
      prev[ni] = cur;
      score[ni] = nd + Math.hypot(ix - gx, iy - gy) * 0.3 + ni * 1e-8;
      heap.push(ni);
    }
  }
  if (dist[goal] === Infinity) return straight(ax, ay, bx, by);
  const idx: number[] = [];
  let c = goal;
  let spin = 0;
  while (c >= 0 && spin++ < n) {
    idx.push(c);
    if (c === start) break;
    c = prev[c]!;
  }
  idx.reverse();
  return idx.map((i) => {
    const ix = i % w;
    const iy = (i / w) | 0;
    return [q(field.originX + ix * field.step), q(field.originY + iy * field.step)] as [
      number,
      number,
    ];
  });
}

function straight(ax: number, ay: number, bx: number, by: number): Array<[number, number]> {
  return [
    [q(ax), q(ay)],
    [q((ax + bx) / 2), q((ay + by) / 2)],
    [q(bx), q(by)],
  ];
}

class MinHeap {
  private a: number[] = [];
  constructor(private score: Float64Array) {}
  get size(): number {
    return this.a.length;
  }
  push(i: number): void {
    const a = this.a;
    a.push(i);
    let n = a.length - 1;
    while (n > 0) {
      const p = (n - 1) >> 1;
      const an = a[n]!;
      const ap = a[p]!;
      if (this.score[an]! >= this.score[ap]!) break;
      a[n] = ap;
      a[p] = an;
      n = p;
    }
  }
  pop(): number | undefined {
    const a = this.a;
    if (!a.length) return undefined;
    const top = a[0]!;
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let n = 0;
      for (;;) {
        const l = n * 2 + 1;
        const r = l + 1;
        let s = n;
        if (l < a.length && this.score[a[l]!]! < this.score[a[s]!]!) s = l;
        if (r < a.length && this.score[a[r]!]! < this.score[a[s]!]!) s = r;
        if (s === n) break;
        const t = a[n]!;
        a[n] = a[s]!;
        a[s] = t;
        n = s;
      }
    }
    return top;
  }
}

function smooth(
  points: Array<[number, number]>,
  curviness: number,
  closed = false,
): Array<[number, number]> {
  const eps = 1.1 + (1 - curviness) * 2.4;
  let pts = rdp(points, eps);
  pts = chaikin(pts, closed);
  pts = chaikin(pts, closed);
  return pts.map((p) => [q(p[0]), q(p[1])]);
}

function rdp(points: Array<[number, number]>, eps: number): Array<[number, number]> {
  if (points.length < 3) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length) {
    const span = stack.pop()!;
    const a = points[span[0]]!;
    const b = points[span[1]]!;
    let best = 0;
    let at = -1;
    for (let i = span[0] + 1; i < span[1]; i++) {
      const d = pointLineDist(points[i]!, a, b);
      if (d > best) {
        best = d;
        at = i;
      }
    }
    if (at >= 0 && best > eps) {
      keep[at] = 1;
      stack.push([span[0], at], [at, span[1]]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

function pointLineDist(p: [number, number], a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  return Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / len;
}

function chaikin(points: Array<[number, number]>, closed: boolean): Array<[number, number]> {
  if (points.length < 3) return points.slice();
  const out: Array<[number, number]> = [];
  const n = points.length;
  const last = closed ? n : n - 1;
  if (!closed) out.push(points[0]!);
  for (let i = 0; i < last; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % n]!;
    out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
    out.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
  }
  if (!closed) out.push(points[n - 1]!);
  return out;
}

function samplePolyline(points: Array<[number, number]>, step: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  if (!points.length) return out;
  out.push(points[0]!);
  let carry = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 0.01) continue;
    let d = step - carry;
    while (d <= len) {
      const t = d / len;
      out.push([q(a[0] + (b[0] - a[0]) * t), q(a[1] + (b[1] - a[1]) * t)]);
      d += step;
    }
    carry = len - (d - step);
  }
  const last = points[points.length - 1]!;
  const prev = out[out.length - 1]!;
  if (Math.hypot(last[0] - prev[0], last[1] - prev[1]) > 0.5) out.push(last);
  return out;
}

function buildEdges(
  style: LayoutStyle,
  field: Field,
  centre: { x: number; y: number },
  entries: Array<{ x: number; y: number }>,
  curviness: number,
  cls: SettlementClass,
  ranks: 1 | 2 | 3,
  rng: Rng,
  contains: (x: number, y: number) => boolean,
): Edge[] {
  const edges: Edge[] = [];
  const push = (rank: number, width: number, points: Array<[number, number]>): void => {
    if (points.length < 2) {
      if (!points.length) return;
      points = [points[0]!, [q(points[0]![0] + 4), q(points[0]![1])]];
    }
    edges.push({
      id: `e${edges.length}`,
      rank,
      widthM: width,
      points,
      samples: samplePolyline(points, 2),
    });
  };
  const wide = cls === 'city' || cls === 'town' || cls === 'capital' || cls === 'metropolis';
  for (const entry of entries) {
    const raw = astar(field, entry.x, entry.y, centre.x, centre.y);
    push(1, wide ? 4.5 : 3, smooth(raw, curviness));
  }
  if ((cls === 'capital' || cls === 'metropolis') && style.streets.kind === 'organic') {
    const reach = reachOf(centre, contains, 640);
    for (const piece of ringPieces(centre, contains, reach * 0.55, curviness)) {
      if (piece.length >= 4) push(1, 4.5, piece);
    }
    return edges;
  }
  if (style.streets.kind === 'radial') {
    const reach = reachOf(centre, contains);
    const rings =
      cls === 'hamlet'
        ? 1
        : cls === 'city'
          ? Math.min(3, style.streets.rings + 1)
          : style.streets.rings;
    const jitter = style.streets.ringJitter * (0.45 + curviness);
    for (let r = 1; r <= rings; r++) {
      const radius = reach * (r / (rings + 0.35));
      const pts: Array<[number, number]> = [];
      const n = 32;
      for (let i = 0; i <= n; i++) {
        const a = (i / n) * Math.PI * 2;
        const wobble =
          1 + (fbm(Math.cos(a) * 3, Math.sin(a) * 3, field.w + r * 19) - 0.5) * 2 * jitter;
        const x = centre.x + Math.cos(a) * radius * wobble;
        const y = centre.y + Math.sin(a) * radius * wobble;
        if (!contains(x, y)) continue;
        pts.push([q(x), q(y)]);
      }
      if (pts.length >= 8) push(2, 3, pts);
    }
    return edges;
  }
  if (ranks >= 2 && style.streets.kind === 'organic') {
    const count =
      cls === 'metropolis'
        ? 110
        : cls === 'capital'
          ? 72
          : cls === 'city'
            ? 14
            : cls === 'town'
              ? 8
              : cls === 'village'
                ? 4
                : 1;
    const scaled = Math.max(1, Math.round(count * style.streets.laneDensity));
    const reach =
      cls === 'metropolis'
        ? 460
        : cls === 'capital'
          ? 300
          : cls === 'city'
            ? 78
            : cls === 'town'
              ? 52
              : 34;
    const fromAll = cls === 'capital' || cls === 'metropolis';
    for (let i = 0; i < scaled; i++) {
      growBranch(
        edges,
        style,
        curviness,
        field,
        rng,
        contains,
        i < scaled - 3 ? 2 : 3,
        reach,
        fromAll,
      );
    }
  }
  return edges;
}

function reachOf(
  centre: { x: number; y: number },
  contains: (x: number, y: number) => boolean,
  max = 160,
): number {
  let reach = 12;
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    for (let r = 8; r <= max; r += 4) {
      if (!contains(centre.x + Math.cos(a) * r, centre.y + Math.sin(a) * r)) break;
      reach = Math.max(reach, r);
    }
  }
  return reach;
}

function fillEntries(
  entries: Array<{ x: number; y: number }>,
  centre: { x: number; y: number },
  contains: (x: number, y: number) => boolean,
  cls: SettlementClass,
): Array<{ x: number; y: number }> {
  const want =
    cls === 'city' || cls === 'town' || cls === 'capital' || cls === 'metropolis'
      ? 4
      : cls === 'village'
        ? 3
        : 2;
  const have = entries.slice();
  for (let i = 0; i < 8 && have.length < want; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.4;
    let last = centre;
    for (let r = 8; r <= 220; r += 4) {
      const x = centre.x + Math.cos(a) * r;
      const y = centre.y + Math.sin(a) * r;
      if (!contains(x, y)) break;
      last = { x, y };
    }
    if (Math.hypot(last.x - centre.x, last.y - centre.y) < 10) continue;
    if (have.some((p) => Math.hypot(p.x - last.x, p.y - last.y) < 16)) continue;
    have.push({ x: q(last.x), y: q(last.y) });
  }
  return have.length ? have : syntheticEntries(centre, contains, new Rng(1));
}

/**
 * One ring. A gap where the circle leaves the footprint starts a new piece.
 * Pieces are never joined across that gap, which is what drew the spiral.
 */
function orient(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  return (by - ay) * (cx - bx) - (bx - ax) * (cy - by);
}

/** Proper crossing. Shared endpoints are junctions, not intersections. */
function segmentsCross(
  a: [number, number],
  b: [number, number],
  c: [number, number],
  d: [number, number],
): boolean {
  const o1 = orient(a[0], a[1], b[0], b[1], c[0], c[1]);
  const o2 = orient(a[0], a[1], b[0], b[1], d[0], d[1]);
  const o3 = orient(c[0], c[1], d[0], d[1], a[0], a[1]);
  const o4 = orient(c[0], c[1], d[0], d[1], b[0], b[1]);
  return o1 * o2 < 0 && o3 * o4 < 0;
}

export function polylineCrossesSelf(points: Array<[number, number]>): boolean {
  const n = points.length - 1;
  if (n < 3) return false;
  const closed =
    points[0]![0] === points[points.length - 1]![0] &&
    points[0]![1] === points[points.length - 1]![1];
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (closed && i === 0 && j === n - 1) continue;
      if (segmentsCross(points[i]!, points[i + 1]!, points[j]!, points[j + 1]!)) return true;
    }
  }
  return false;
}

function polylineHitsEdges(points: Array<[number, number]>, edges: Edge[], skip: string): boolean {
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    for (const edge of edges) {
      if (edge.id === skip) continue;
      for (let j = 0; j < edge.points.length - 1; j++) {
        if (segmentsCross(a, b, edge.points[j]!, edge.points[j + 1]!)) return true;
      }
    }
  }
  return false;
}

function ringPieces(
  centre: { x: number; y: number },
  contains: (x: number, y: number) => boolean,
  radius: number,
  curviness: number,
): Array<Array<[number, number]>> {
  const n = 72;
  const samples: Array<[number, number] | null> = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const wobble = 1 + (fbm(Math.cos(a) * 2, Math.sin(a) * 2, 41) - 0.5) * Math.min(0.2, curviness);
    const x = centre.x + Math.cos(a) * radius * wobble;
    const y = centre.y + Math.sin(a) * radius * wobble;
    samples.push(contains(x, y) ? [q(x), q(y)] : null);
  }
  const pieces: Array<Array<[number, number]>> = [];
  let current: Array<[number, number]> = [];
  const flush = () => {
    if (current.length >= 4) pieces.push(current);
    current = [];
  };
  for (const sample of samples) {
    if (!sample) flush();
    else current.push(sample);
  }
  // The circle started and ended inside, so the first and last runs are one arc.
  if (samples[0] && samples[n - 1] && pieces.length && current.length) {
    const first = pieces[0]!;
    pieces[0] = current.concat(first);
    current = [];
  }
  flush();
  if (pieces.length === 1 && samples[0] && samples[n - 1]) {
    const only = pieces[0]!;
    const a = only[0]!;
    const b = only[only.length - 1]!;
    if (a[0] !== b[0] || a[1] !== b[1]) only.push(a);
  }
  return pieces;
}

interface StreetSample {
  x: number;
  y: number;
  tx: number;
  ty: number;
  id: string;
}

interface WardStreetSpec {
  gap: [number, number];
  bend: number;
  /** Share of cross-streets that stop at the next through-street and restart offset. */
  stagger: number;
}

/** Craft and slums pack tight and crooked. Noble blocks leave room for gardens. */
function wardStreetSpec(kind: string): WardStreetSpec {
  switch (kind) {
    case 'slums':
      return { gap: [18, 27], bend: 1, stagger: 0.62 };
    case 'craft':
      return { gap: [20, 32], bend: 0.85, stagger: 0.48 };
    case 'noble':
      return { gap: [38, 54], bend: 0.35, stagger: 0.22 };
    case 'market':
    case 'temple':
      return { gap: [32, 46], bend: 0.4, stagger: 0.2 };
    case 'keep':
      return { gap: [36, 50], bend: 0.28, stagger: 0.12 };
    case 'docks':
      return { gap: [22, 34], bend: 0.7, stagger: 0.4 };
    default:
      return { gap: [26, 40], bend: 0.55, stagger: 0.36 };
  }
}

function lotSpec(kind: string): {
  frontage: [number, number];
  depth: [number, number];
  setback: number;
  yaw: number;
} {
  switch (kind) {
    case 'slums':
      return { frontage: [4.4, 6.2], depth: [5.4, 6.6], setback: 0.28, yaw: 8 };
    case 'craft':
      return { frontage: [5, 7.2], depth: [5.8, 7.2], setback: 0.32, yaw: 6 };
    case 'noble':
      return { frontage: [8, 12], depth: [9, 12], setback: 1.7, yaw: 3 };
    default:
      return { frontage: [5.4, 7.4], depth: [6.4, 8.2], setback: 0.42, yaw: 4 };
  }
}

/**
 * Side streets per ward. Each ward picks its own angle off the nearest avenue,
 * then lays two bent families with uneven gaps. Cross-streets often stop and
 * restart a few metres aside, so the plan is T-junctions rather than one lattice.
 */
function layWardStreets(
  planned: ReturnType<typeof planWards>,
  edges: Edge[],
  field: Field,
  contains: (x: number, y: number) => boolean,
  curviness: number,
): void {
  const cell = 10;
  const index = new Map<string, StreetSample[]>();
  const remember = (edge: Edge) => {
    const pts = edge.points;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]!;
      const b = pts[i]!;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const tx = (b[0] - a[0]) / len;
      const ty = (b[1] - a[1]) / len;
      const steps = Math.max(1, Math.ceil(len / 4));
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const sample: StreetSample = {
          x: a[0] + (b[0] - a[0]) * t,
          y: a[1] + (b[1] - a[1]) * t,
          tx,
          ty,
          id: edge.id,
        };
        const key = `${Math.floor(sample.x / cell)},${Math.floor(sample.y / cell)}`;
        const list = index.get(key);
        if (list) list.push(sample);
        else index.set(key, [sample]);
      }
    }
  };
  for (const edge of edges) remember(edge);
  const nearSample = (x: number, y: number, dist: number, skip: string): StreetSample | null => {
    let best: StreetSample | null = null;
    let bestD = dist;
    const cx = Math.floor(x / cell);
    const cy = Math.floor(y / cell);
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        const list = index.get(`${cx + ox},${cy + oy}`);
        if (!list) continue;
        for (const sample of list) {
          if (sample.id === skip) continue;
          const d = Math.hypot(sample.x - x, sample.y - y);
          if (d < bestD) {
            bestD = d;
            best = sample;
          }
        }
      }
    }
    return best;
  };
  const pushRun = (points: Array<[number, number]>, width: number) => {
    if (points.length < 4 || polylineLength(points) < 18) return;
    if (polylineCrossesSelf(points)) return;
    let crowded = 0;
    let seen = 0;
    for (let i = 1; i < points.length - 1; i += 2) {
      seen += 1;
      if (nearSample(points[i]![0], points[i]![1], 7, '')) crowded += 1;
    }
    if (seen > 3 && crowded / seen > 0.6) return;
    const edge: Edge = {
      id: `e${edges.length}`,
      rank: width < 2.4 ? 3 : 2,
      widthM: width,
      points,
      samples: samplePolyline(points, 2),
    };
    edges.push(edge);
    remember(edge);
  };
  const costAt = (x: number, y: number): number => {
    const ix = Math.max(0, Math.min(field.w - 1, Math.round((x - field.originX) / field.step)));
    const iy = Math.max(0, Math.min(field.h - 1, Math.round((y - field.originY) / field.step)));
    return field.cost[iy * field.w + ix] ?? 1;
  };

  for (const ward of planned.wards) {
    if (ward.quadrants.length < 2 && ward.kind !== 'keep') continue;
    const spec = wardStreetSpec(ward.kind);
    const at = wardCentre(ward.quadrants);
    let tx = 1;
    let ty = 0;
    let best = Infinity;
    const probe = (x: number, y: number) => {
      const cx = Math.floor(x / cell);
      const cy = Math.floor(y / cell);
      for (let oy = -2; oy <= 2; oy++) {
        for (let ox = -2; ox <= 2; ox++) {
          const list = index.get(`${cx + ox},${cy + oy}`);
          if (!list) continue;
          for (const sample of list) {
            if (!sample.id.startsWith('e')) continue;
            const d = Math.hypot(sample.x - x, sample.y - y);
            if (d < best) {
              best = d;
              tx = sample.tx;
              ty = sample.ty;
            }
          }
        }
      }
    };
    probe(at.x, at.y);
    const spin = (hash2(ward.id, ward.quadrants.length, 5) - 0.5) * 0.7;
    const ang = Math.atan2(ty, tx) + spin;
    const dx = Math.cos(ang);
    const dy = Math.sin(ang);
    const px = -dy;
    const py = dx;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const quad of ward.quadrants) {
      minX = Math.min(minX, quad.x * 64);
      minY = Math.min(minY, quad.y * 64);
      maxX = Math.max(maxX, (quad.x + 1) * 64);
      maxY = Math.max(maxY, (quad.y + 1) * 64);
    }
    const span = Math.max(maxX - minX, maxY - minY, 36);
    const inside = (x: number, y: number): boolean => {
      if (!contains(x, y)) return false;
      if (planned.wardIdAt(x, y) === ward.id) return true;
      return Math.hypot(x - at.x, y - at.y) < span * 0.62;
    };
    const walk = (
      ox: number,
      oy: number,
      hx: number,
      hy: number,
      limit: number,
      salt: number,
    ): Array<[number, number]> => {
      const pts: Array<[number, number]> = [[q(ox), q(oy)]];
      let x = ox;
      let y = oy;
      let vx = hx;
      let vy = hy;
      let turned = 0;
      for (let walked = 0; walked < limit; walked += 5) {
        const left = costAt(x - vy * 6, y + vx * 6);
        const right = costAt(x + vy * 6, y - vx * 6);
        const terrain = Math.max(-0.07, Math.min(0.07, (right - left) * 0.03));
        const bend =
          (fbm(x * 0.02, y * 0.02, ward.id * 19 + salt) - 0.5) *
          spec.bend *
          (0.22 + curviness * 0.15);
        const turn = Math.max(-0.1, Math.min(0.1, bend + terrain));
        turned += turn;
        if (Math.abs(turned) > 0.85) break;
        const c = Math.cos(turn);
        const s = Math.sin(turn);
        const nx = vx * c - vy * s;
        const ny = vx * s + vy * c;
        vx = nx;
        vy = ny;
        x += vx * 5;
        y += vy * 5;
        if (!inside(x, y)) break;
        pts.push([q(x), q(y)]);
        if (walked > 14) {
          const hit = nearSample(x, y, 6.5, '');
          if (hit && Math.hypot(hit.x - ox, hit.y - oy) > 12) {
            pts.push([q(hit.x), q(hit.y)]);
            break;
          }
        }
      }
      return pts;
    };

    let cursor = -span * 0.55;
    let line = 0;
    while (cursor < span * 0.55 && line < 14) {
      const gap = spec.gap[0] + hash2(ward.id, line, 11) * (spec.gap[1] - spec.gap[0]);
      cursor += gap;
      const slide = (hash2(ward.id, line, 13) - 0.5) * gap * 0.35;
      const ox = at.x + px * cursor + dx * slide;
      const oy = at.y + py * cursor + dy * slide;
      if (!contains(ox, oy)) {
        line += 1;
        continue;
      }
      pushRun(walk(ox, oy, dx, dy, span * 0.85, line + 1), ward.kind === 'slums' ? 2.6 : 3.1);
      pushRun(walk(ox, oy, -dx, -dy, span * 0.85, line + 40), ward.kind === 'slums' ? 2.6 : 3.1);
      line += 1;
    }

    cursor = -span * 0.55;
    line = 0;
    while (cursor < span * 0.55 && line < 14) {
      const gap = spec.gap[0] + hash2(ward.id, line, 17) * (spec.gap[1] - spec.gap[0]);
      cursor += gap;
      const stagger = hash2(ward.id, line, 19) < spec.stagger;
      const slide = (hash2(ward.id, line, 23) - 0.5) * (stagger ? 14 : 6);
      const ox = at.x + dx * cursor + px * slide;
      const oy = at.y + dy * cursor + py * slide;
      if (!contains(ox, oy)) {
        line += 1;
        continue;
      }
      const reach = span * (stagger ? 0.42 : 0.7);
      pushRun(walk(ox, oy, px, py, reach, line + 80), 2.4);
      if (!stagger) pushRun(walk(ox, oy, -px, -py, reach, line + 120), 2.4);
      line += 1;
    }
  }
}

function growBranch(
  edges: Edge[],
  style: LayoutStyle,
  curviness: number,
  field: Field,
  rng: Rng,
  contains: (x: number, y: number) => boolean,
  rank: number,
  maxLen: number,
  fromAll = false,
): void {
  if (style.streets.kind !== 'organic' || !edges.length) return;
  const pool = fromAll ? edges.length : Math.min(edges.length, 4);
  const edge = edges[rng.int(0, Math.max(0, pool - 1))]!;
  const samples = edge.samples;
  if (samples.length < 4) return;
  const at = samples[rng.int(1, samples.length - 2)]!;
  const i = Math.max(1, samples.indexOf(at));
  const prev = samples[Math.max(0, i - 1)]!;
  const next = samples[Math.min(samples.length - 1, i + 1)]!;
  let tx = next[0] - prev[0];
  let ty = next[1] - prev[1];
  const len = Math.hypot(tx, ty) || 1;
  tx /= len;
  ty /= len;
  const side = rng.chance(0.5) ? 1 : -1;
  const ang =
    ((rng.range(style.streets.branchAngleDeg[0], style.streets.branchAngleDeg[1]) * Math.PI) /
      180) *
    side;
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  let hx = tx * c - ty * s;
  let hy = tx * s + ty * c;
  const pts: Array<[number, number]> = [[q(at[0]), q(at[1])]];
  let x = at[0];
  let y = at[1];
  for (let walked = 0; walked < maxLen; walked += 4) {
    const turn = (fbm(x * 0.05, y * 0.05, field.w * 13 + walked) - 0.5) * curviness * 1.4;
    const tc = Math.cos(turn);
    const ts = Math.sin(turn);
    const nx = hx * tc - hy * ts;
    const ny = hx * ts + hy * tc;
    hx = nx;
    hy = ny;
    x += hx * 4;
    y += hy * 4;
    if (!contains(x, y)) break;
    pts.push([q(x), q(y)]);
    const snapAt = fromAll ? 16 : 0;
    if (walked > snapAt && nearOther(edges, x, y, 6, edge.id)) break;
  }
  if (pts.length < 3) return;
  const smoothPts = smooth(pts, curviness);
  if (polylineCrossesSelf(smoothPts) || polylineHitsEdges(smoothPts, edges, edge.id)) return;
  edges.push({
    id: `e${edges.length}`,
    rank,
    widthM: rank === 2 ? 3 : 1.8,
    points: smoothPts,
    samples: samplePolyline(smoothPts, 2),
  });
}

function nearOther(edges: Edge[], x: number, y: number, dist: number, skip: string): boolean {
  for (const edge of edges) {
    if (edge.id === skip) continue;
    for (const s of edge.samples) {
      if (Math.hypot(s[0] - x, s[1] - y) <= dist) return true;
    }
  }
  return false;
}

function roadCells(edges: Edge[]): Map<string, Array<[number, number]>> {
  const grid = new Map<string, Array<[number, number]>>();
  const cell = 8;
  for (const edge of edges) {
    for (const sample of edge.samples) {
      const key = `${Math.floor(sample[0] / cell)},${Math.floor(sample[1] / cell)}`;
      const list = grid.get(key);
      if (list) list.push(sample);
      else grid.set(key, [sample]);
    }
  }
  return grid;
}

function nearRoad(obb: Obb, grid: Map<string, Array<[number, number]>>, pad: number): boolean {
  const grown: Obb = { ...obb, w: obb.w + pad * 2, d: obb.d + pad * 2 };
  const box = aabbOf(grown);
  const cell = 8;
  for (let y = box.y; y <= box.y + box.d; y += cell) {
    for (let x = box.x; x <= box.x + box.w; x += cell) {
      const list = grid.get(`${Math.floor(x / cell)},${Math.floor(y / cell)}`);
      if (!list) continue;
      for (const sample of list) {
        if (pointInObb(sample[0], sample[1], grown)) return true;
      }
    }
  }
  return false;
}

function wardCentre(quads: ReadonlyArray<{ x: number; y: number }>): { x: number; y: number } {
  let x = 0;
  let y = 0;
  for (const quad of quads) {
    x += (quad.x + 0.5) * 64;
    y += (quad.y + 0.5) * 64;
  }
  const n = Math.max(1, quads.length);
  return { x: x / n, y: y / n };
}

function lotFitsWard(
  obb: Obb,
  wardId: number,
  wardIdAt: (x: number, y: number) => number | undefined,
): boolean {
  if (wardIdAt(obb.cx, obb.cy) !== wardId) return false;
  return cornersOf(obb).every(([x, y]) => {
    const other = wardIdAt(x, y);
    return other === undefined || other === wardId;
  });
}

/** A wide lot on the market, temple, and keep, and an open circle around the two plazas. */
function plazaLots(
  planned: ReturnType<typeof planWards>,
  edges: Edge[],
  contains: (x: number, y: number) => boolean,
): { lots: Lot[]; plazas: Array<{ x: number; y: number; r: number }> } {
  const lots: Lot[] = [];
  const plazas: Array<{ x: number; y: number; r: number }> = [];
  for (const ward of planned.wards) {
    if (ward.kind !== 'market' && ward.kind !== 'temple' && ward.kind !== 'keep') continue;
    const at = wardCentre(ward.quadrants);
    const open = ward.kind === 'keep' ? 0 : ward.kind === 'market' ? 22 : 18;
    if (open) plazas.push({ x: at.x, y: at.y, r: open });
    const size = ward.kind === 'keep' ? 16 : 14;
    let yaw = 0;
    let best = Infinity;
    for (const edge of edges) {
      if (edge.rank !== 1) continue;
      for (let i = 1; i < edge.points.length; i++) {
        const a = edge.points[i - 1]!;
        const b = edge.points[i]!;
        const dx = b[0] - a[0];
        const dy = b[1] - a[1];
        const len2 = dx * dx + dy * dy || 1;
        const t = Math.max(0, Math.min(1, ((at.x - a[0]) * dx + (at.y - a[1]) * dy) / len2));
        const px = a[0] + dx * t;
        const py = a[1] + dy * t;
        const dist = Math.hypot(px - at.x, py - at.y);
        if (dist < best) {
          best = dist;
          yaw = yawToward(dx, dy);
        }
      }
    }
    const obb: Obb = {
      cx: q(at.x),
      cy: q(at.y),
      w: size,
      d: size,
      yawDeg: qYaw(yaw),
    };
    if (!lotFitsWard(obb, ward.id, planned.wardIdAt)) continue;
    if (!lotInside(obb, contains)) continue;
    if (hitsRoad(obb, edges, 1.2)) continue;
    lots.push({
      edge: 'plaza',
      rank: 1,
      arc: 0,
      obb,
      district: ward.kind,
      weights: ward.weights,
    });
  }
  return { lots, plazas };
}

function placeLots(
  style: LayoutStyle,
  edges: Edge[],
  contains: (x: number, y: number) => boolean,
  centre: { x: number; y: number },
  cls: SettlementClass,
  target: number,
  curviness: number,
  rng: Rng,
  span: number,
  seedLots: Lot[] = [],
  plazas: Array<{ x: number; y: number; r: number }> = [],
  wardAt: (x: number, y: number) => string | undefined = () => undefined,
): Lot[] {
  const lots: Lot[] = seedLots.slice();
  const rule = style.lots;
  const fit = Math.min(1, Math.max(0.42, span / 64));
  const clear = Math.min(
    cls === 'hamlet' ? 6 : cls === 'village' ? 8 : cls === 'town' ? 11 : 14,
    span * 0.16,
  );
  const buckets = new Map<string, number[]>();
  const cell = 16;
  const bucket = (x: number, y: number) => `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
  const indexLot = (index: number) => {
    const box = aabbOf(lots[index]!.obb);
    for (let y = box.y; y <= box.y + box.d; y += cell) {
      for (let x = box.x; x <= box.x + box.w; x += cell) {
        const k = bucket(x, y);
        const list = buckets.get(k);
        if (list) list.push(index);
        else buckets.set(k, [index]);
      }
    }
  };
  lots.forEach((_, index) => indexLot(index));
  const tight = cls === 'capital' || cls === 'metropolis';
  const roads = tight ? roadCells(edges) : null;
  const ordered = edges.slice().sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id));
  for (const edge of ordered) {
    const length = polylineLength(edge.points);
    let arc = 6;
    while (arc < length - 5 && lots.length < target) {
      const along = pointAt(edge.points, arc);
      if (!along) break;
      const plotKind = tight ? (wardAt(along.x, along.y) ?? 'residential') : '';
      const plot = tight ? lotSpec(plotKind) : null;
      const roll = tight ? hash2(Math.floor(along.x * 2), Math.floor(arc), edge.rank + 7) : 0;
      const frontage = plot
        ? plot.frontage[0] + roll * (plot.frontage[1] - plot.frontage[0])
        : rng.range(rule.frontage[0], rule.frontage[1]) * style.scale * fit;
      const depth = plot
        ? plot.depth[0] + hash2(Math.floor(arc), edge.rank, 3) * (plot.depth[1] - plot.depth[0])
        : rng.range(rule.depth[0], rule.depth[1]) * style.scale * fit;
      const setback = plot ? plot.setback : rng.range(rule.setback[0], rule.setback[1]);
      const at = pointAt(edge.points, arc + frontage / 2);
      const tan = tangentAt(edge.points, arc + frontage / 2);
      if (!at || !tan) break;
      for (const side of [1, -1] as const) {
        if (lots.length >= target) break;
        const nx = tan.y * side;
        const ny = -tan.x * side;
        const obbCx = at.x + nx * (setback + depth / 2 + edge.widthM / 2);
        const obbCy = at.y + ny * (setback + depth / 2 + edge.widthM / 2);
        if (Math.hypot(obbCx - centre.x, obbCy - centre.y) < clear) continue;
        if (plazas.some((plaza) => Math.hypot(obbCx - plaza.x, obbCy - plaza.y) < plaza.r))
          continue;
        let yaw = yawToward(-nx, -ny);
        if (!tight && rule.facing === 'centre') {
          yaw = yawToward(centre.x - obbCx, centre.y - obbCy);
        } else if (!tight && rule.facing === 'free') {
          yaw += rng.range(-40, 40);
        }
        if (plot) {
          yaw += (hash2(Math.floor(obbCx), Math.floor(obbCy), side + 5) - 0.5) * plot.yaw;
        } else if (!tight) {
          yaw += rng.range(-rule.yawJitterDeg, rule.yawJitterDeg) * (0.35 + curviness);
        }
        const obb: Obb = {
          cx: q(obbCx),
          cy: q(obbCy),
          w: q(frontage),
          d: q(depth),
          yawDeg: qYaw(yaw),
        };
        if (!lotInside(obb, contains)) continue;
        if (
          roads
            ? nearRoad(obb, roads, edge.widthM * 0.35 + 0.6)
            : hitsRoad(obb, edges, edge.widthM * 0.35 + 0.6)
        )
          continue;
        if (hitsLots(obb, lots, buckets, bucket)) continue;
        const index = lots.length;
        lots.push({
          edge: edge.id,
          rank: edge.rank,
          arc: q(arc),
          obb,
          district: 'residential',
          weights: new Map(),
        });
        indexLot(index);
      }
      const passage =
        tight && hash2(Math.floor(arc * 2), edge.rank, 29) < (plotKind === 'slums' ? 0.2 : 0.1);
      arc += frontage + (tight ? (passage ? 2.4 : 0.18) : rng.range(1.2, 2.4));
    }
  }
  if (!lots.length && contains(centre.x, centre.y)) {
    lots.push({
      edge: edges[0]?.id ?? 'centre',
      rank: 1,
      arc: 0,
      obb: { cx: q(centre.x), cy: q(centre.y), w: q(5 * fit), d: q(5 * fit), yawDeg: 18 },
      district: 'residential',
      weights: new Map(),
    });
  }
  lots.sort((a, b) => a.rank - b.rank || a.edge.localeCompare(b.edge) || a.arc - b.arc);
  return lots;
}

function polylineLength(points: Array<[number, number]>): number {
  let n = 0;
  for (let i = 1; i < points.length; i++) {
    n += Math.hypot(points[i]![0] - points[i - 1]![0], points[i]![1] - points[i - 1]![1]);
  }
  return n;
}

function pointAt(points: Array<[number, number]>, dist: number): { x: number; y: number } | null {
  let left = dist;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 0.001) continue;
    if (left <= len) {
      const t = left / len;
      return { x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * t };
    }
    left -= len;
  }
  const last = points[points.length - 1];
  return last ? { x: last[0], y: last[1] } : null;
}

function tangentAt(points: Array<[number, number]>, dist: number): { x: number; y: number } | null {
  let left = dist;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 0.001) continue;
    if (left <= len) {
      return { x: (b[0] - a[0]) / len, y: (b[1] - a[1]) / len };
    }
    left -= len;
  }
  return points.length >= 2
    ? {
        x: points[points.length - 1]![0] - points[points.length - 2]![0],
        y: points[points.length - 1]![1] - points[points.length - 2]![1],
      }
    : null;
}

function yawToward(dx: number, dy: number): number {
  return (Math.atan2(dx, dy) * 180) / Math.PI;
}

function lotInside(obb: Obb, contains: (x: number, y: number) => boolean): boolean {
  if (!contains(obb.cx, obb.cy)) return false;
  return cornersOf(obb).every(([x, y]) => contains(x, y));
}

function cornersOf(o: Obb): Array<[number, number]> {
  const rad = (o.yawDeg * Math.PI) / 180;
  const fx = Math.sin(rad);
  const fy = Math.cos(rad);
  const rx = fy;
  const ry = -fx;
  const hw = o.w / 2;
  const hd = o.d / 2;
  const out: Array<[number, number]> = [];
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      out.push([o.cx + rx * hw * sx + fx * hd * sy, o.cy + ry * hw * sx + fy * hd * sy]);
    }
  }
  return out;
}

function aabbOf(o: Obb): { x: number; y: number; w: number; d: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of cornersOf(o)) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { x: minX, y: minY, w: maxX - minX, d: maxY - minY };
}

function hitsRoad(obb: Obb, edges: Edge[], pad: number): boolean {
  const grown: Obb = { ...obb, w: obb.w + pad * 2, d: obb.d + pad * 2 };
  for (const edge of edges) {
    for (const s of edge.samples) {
      if (pointInObb(s[0], s[1], grown)) return true;
    }
  }
  return false;
}

function pointInObb(x: number, y: number, o: Obb): boolean {
  const rad = (o.yawDeg * Math.PI) / 180;
  const fx = Math.sin(rad);
  const fy = Math.cos(rad);
  const rx = fy;
  const ry = -fx;
  const dx = x - o.cx;
  const dy = y - o.cy;
  const lx = dx * rx + dy * ry;
  const ly = dx * fx + dy * fy;
  return Math.abs(lx) <= o.w / 2 && Math.abs(ly) <= o.d / 2;
}

function hitsLots(
  obb: Obb,
  lots: Lot[],
  buckets: Map<string, number[]>,
  bucket: (x: number, y: number) => string,
): boolean {
  const seen = new Set<number>();
  const box = aabbOf(obb);
  for (let y = box.y; y <= box.y + box.d; y += 16) {
    for (let x = box.x; x <= box.x + box.w; x += 16) {
      const list = buckets.get(bucket(x, y));
      if (!list) continue;
      for (const index of list) {
        if (seen.has(index)) continue;
        seen.add(index);
        const other = lots[index];
        if (other && obbOverlap(obb, other.obb)) return true;
      }
    }
  }
  return false;
}

function obbOverlap(a: Obb, b: Obb): boolean {
  const axes = axesOf(a).concat(axesOf(b));
  const ac = cornersOf(a);
  const bc = cornersOf(b);
  for (const axis of axes) {
    let a0 = Infinity;
    let a1 = -Infinity;
    let b0 = Infinity;
    let b1 = -Infinity;
    for (const p of ac) {
      const t = p[0] * axis[0] + p[1] * axis[1];
      a0 = Math.min(a0, t);
      a1 = Math.max(a1, t);
    }
    for (const p of bc) {
      const t = p[0] * axis[0] + p[1] * axis[1];
      b0 = Math.min(b0, t);
      b1 = Math.max(b1, t);
    }
    if (a1 < b0 || b1 < a0) return false;
  }
  return true;
}

function axesOf(o: Obb): Array<[number, number]> {
  const rad = (o.yawDeg * Math.PI) / 180;
  const fx = Math.sin(rad);
  const fy = Math.cos(rad);
  return [
    [fy, -fx],
    [fx, fy],
  ];
}

interface Seed {
  id: string;
  x: number;
  y: number;
  weights: Map<BuildingRole, number>;
}

function seedDistricts(
  style: LayoutStyle,
  centre: { x: number; y: number },
  entries: Array<{ x: number; y: number }>,
  tiles: { x: number; y: number }[],
  heightAt: (x: number, y: number) => number,
): Seed[] {
  let high = centre;
  let best = -Infinity;
  const step = Math.max(1, Math.floor(tiles.length / 12));
  for (let i = 0; i < tiles.length; i += step) {
    const t = tiles[i]!;
    const h = heightAt(t.x, t.y);
    if (h > best) {
      best = h;
      high = { x: (t.x + 0.5) * ZONE_SCALE, y: (t.y + 0.5) * ZONE_SCALE };
    }
  }
  const edge = entries[entries.length - 1] ?? { x: centre.x + 20, y: centre.y };
  return style.districts.map((d) => {
    const at =
      d.seedAt === 'centre'
        ? centre
        : d.seedAt === 'main_gate'
          ? (entries[0] ?? centre)
          : d.seedAt === 'gates'
            ? (entries[1] ?? entries[0] ?? centre)
            : d.seedAt === 'high_ground'
              ? high
              : edge;
    const weights = new Map<BuildingRole, number>();
    for (const role of d.roles) weights.set(role.role, role.w);
    return { id: d.id, x: at.x, y: at.y, weights };
  });
}

function nearestDistrict(obb: Obb, seeds: Seed[]): string {
  let best = seeds[0]?.id ?? 'residential';
  let dist = Infinity;
  for (const seed of seeds) {
    const d = Math.hypot(seed.x - obb.cx, seed.y - obb.cy);
    if (d < dist) {
      dist = d;
      best = seed.id;
    }
  }
  return best;
}

function rewrite(style: LayoutStyle, role: BuildingRole): BuildingRole | null {
  if (Object.prototype.hasOwnProperty.call(style.roleRewrite, role)) {
    const next = style.roleRewrite[role];
    return next === undefined ? role : next;
  }
  return role;
}

function assignRoles(
  style: LayoutStyle,
  cls: SettlementClass,
  lots: Lot[],
  target: number,
  gates: number,
  rng: Rng,
  dropNotes: string[],
  wideCivic = false,
): Array<BuildingRole | null> {
  const roles: Array<BuildingRole | null> = lots.map(() => null);
  const queue: BuildingRole[] = [];
  const push = (role: BuildingRole, count: number) => {
    const next = rewrite(style, role);
    if (!next || count <= 0) return;
    for (let i = 0; i < count; i++) queue.push(next);
  };
  for (const need of demandFor(cls, target, gates)) push(need.role, need.count ?? 0);
  for (const extra of style.extraDemand) {
    if (extra.minBuildings && target < extra.minBuildings) continue;
    push(extra.role, extra.count ?? 1);
  }
  const used = new Set<number>();
  for (const role of queue) {
    const index = pickLot(lots, used, role, wideCivic);
    if (index < 0) {
      dropNotes.push(`dropped ${role}: no lot`);
      continue;
    }
    used.add(index);
    roles[index] = role;
  }
  const homeBudget = wideCivic ? lots.length : Math.max(0, Math.round(lots.length * 0.82));
  let homes = roles.filter((role) => role === 'home').length;
  for (let i = 0; i < lots.length; i++) {
    if (roles[i]) continue;
    if (homes < homeBudget) {
      roles[i] = 'home';
      homes += 1;
    } else roles[i] = 'unassigned';
  }
  void rng;
  return roles;
}

function demandFor(cls: SettlementClass, count: number, gates: number): RoleDemand[] {
  const base = SIZE_CLASS[cls].roleDemand.filter(
    (need) => !need.minBuildings || count >= need.minBuildings,
  );
  const guards = { role: 'guard_post' as const, count: Math.max(1, Math.min(6, gates)) };
  if (cls === 'town' || cls === 'city') return [...base, guards];
  if (cls === 'capital' || cls === 'metropolis') {
    return [
      ...base,
      guards,
      { role: 'keep', count: 1 },
      { role: 'manor', count: cls === 'metropolis' ? 4 : 2 },
      { role: 'barracks', count: cls === 'metropolis' ? 3 : 2 },
      { role: 'temple', count: 1 },
      { role: 'market', count: 1 },
      { role: 'dock', count: 1 },
    ];
  }
  return base;
}

function pickLot(lots: Lot[], used: Set<number>, role: BuildingRole, wideCivic = false): number {
  if (
    wideCivic &&
    (role === 'keep' ||
      role === 'temple' ||
      role === 'market' ||
      role === 'town_hall' ||
      role === 'guildhall')
  ) {
    let best = -1;
    let area = -1;
    for (let i = 0; i < lots.length; i++) {
      if (used.has(i)) continue;
      const lot = lots[i]!;
      if ((lot.weights.get(role) ?? 0) <= 0) continue;
      const next = lot.obb.w * lot.obb.d;
      if (next > area) {
        area = next;
        best = i;
      }
    }
    if (best >= 0) return best;
  }
  let fallback = -1;
  const strict = role === 'dock';
  for (let i = 0; i < lots.length; i++) {
    if (used.has(i)) continue;
    const lot = lots[i]!;
    if (fallback < 0) fallback = i;
    if ((lot.weights.get(role) ?? 0) > 0) return i;
    if (strict) continue;
    if (role === 'guard_post' && lot.rank === 1) return i;
    if (
      (role === 'market' ||
        role === 'inn' ||
        role === 'shop' ||
        role === 'town_hall' ||
        role === 'keep') &&
      lot.rank === 1
    ) {
      return i;
    }
  }
  return strict ? -1 : fallback;
}

function makeBuilding(
  role: BuildingRole,
  lot: Lot,
  style: LayoutStyle,
  set: ReturnType<typeof resolveBiomeSet>['set'],
  index: number,
  dense = false,
): PlanBuilding | null {
  const resolved = resolveBuilding(role, style, set, index);
  if (dense && style.id !== 'orc') {
    const town = urbanForm(set.id, role);
    resolved.form = town;
    resolved.placeholder = false;
    resolved.kitId = town.kit;
  }
  const spec = kitBuilding(resolved.kitId) ?? kitBuilding('cottage');
  if (!spec) return null;
  const templateId = ensureKitTemplate(spec, set.kitSuffix);
  const mask = placedMaskAtYaw(templateId, lot.obb.yawDeg);
  const maskD = mask?.d ?? lot.obb.d;
  const maskW = mask?.w ?? lot.obb.w;
  const anchorX = q(lot.obb.cx);
  const anchorY = q(lot.obb.cy + maskD / 2);
  const box = aabbOf(lot.obb);
  const facing = cardinalOf(lot.obb.yawDeg);
  const rotation = nearestQuarter(lot.obb.yawDeg);
  return {
    catalogId: spec.id,
    legacy: spec.legacy,
    label: resolved.label,
    kit: resolveKit(spec.kit, set.kitSuffix),
    family: spec.family,
    ...(spec.resTier ? { resTier: spec.resTier } : {}),
    specialty: spec.id,
    style: set.kitSuffix,
    district: lot.district,
    lot: { x: q(box.x), y: q(box.y), w: q(Math.max(3, box.w)), d: q(Math.max(3, box.d)) },
    frontageRank: lot.rank,
    frontage: facing,
    templateId,
    rotation,
    anchorX,
    anchorY,
    footW: maskW,
    footD: maskD,
    storeys: spec.storeys,
    structure: { x: q(box.x), y: q(box.y), w: q(box.w), d: q(box.d) },
    role,
    roleLabel: resolved.label,
    roofMaterial: roofMaterialForSet(set.id),
    yawDeg: lot.obb.yawDeg,
    placeholder: resolved.placeholder,
    form: resolved.form.form,
    roleColour: ROLE_STYLE[role].colour,
    obb: lot.obb,
  };
}

function cardinalOf(yaw: number): Cardinal {
  const y = qYaw(yaw);
  if (y < 45 || y >= 315) return 'S';
  if (y < 135) return 'E';
  if (y < 225) return 'N';
  return 'W';
}

function nearestQuarter(yaw: number): BuildingRotation {
  const qtr = Math.round(qYaw(yaw) / 90) % 4;
  return (qtr * 90) as BuildingRotation;
}

function roadOf(edge: Edge, index: number, row: SettlementTier): PlanRoad {
  const spec = row ? roadForRank(row, edge.rank <= 3 ? (edge.rank as 1 | 2 | 3) : 3) : null;
  return {
    id: `r${index}`,
    kind: spec?.kind ?? (edge.rank === 1 ? 'street_cobble' : 'lane_gravel'),
    rank: edge.rank,
    widthM: edge.widthM,
    surface: spec?.surface ?? (edge.rank === 1 ? 3 : 2),
    points: edge.points,
  };
}

function rasterRoads(edges: Edge[]): RoadPaint[] {
  const cells = new Map<string, RoadPaint>();
  for (const edge of edges) {
    for (const [x, y] of edge.samples) {
      const gx = Math.floor(x / 3);
      const gy = Math.floor(y / 3);
      const k = keyOf(gx, gy);
      const prev = cells.get(k);
      if (prev && prev.rank <= edge.rank) continue;
      cells.set(k, {
        gx,
        gy,
        rank: edge.rank,
        surface: edge.rank === 1 ? 3 : 2,
        widthM: edge.widthM,
      });
    }
  }
  return [...cells.values()].sort((a, b) => a.gy - b.gy || a.gx - b.gx);
}

function defenceFor(
  style: LayoutStyle,
  cls: SettlementClass,
  fallback: SizeClassDefence,
): DefenceRule {
  return (
    style.defence[cls] ?? {
      kind:
        fallback === 'curtain' || fallback === 'curtain2'
          ? 'curtain'
          : fallback === 'palisade'
            ? 'palisade'
            : fallback === 'hedge'
              ? 'hedge'
              : 'none',
      towers: 'none',
      gates: [1, 2],
    }
  );
}

type SizeClassDefence = 'none' | 'hedge' | 'palisade' | 'curtain' | 'curtain2';

function outlineOf(
  centre: { x: number; y: number },
  contains: (x: number, y: number) => boolean,
): Array<[number, number]> {
  const raw: Array<[number, number]> = [];
  const n = 48;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    let lo = 0;
    let hi = 220;
    for (let k = 0; k < 11; k++) {
      const mid = (lo + hi) / 2;
      if (contains(centre.x + Math.cos(a) * mid, centre.y + Math.sin(a) * mid)) lo = mid;
      else hi = mid;
    }
    if (lo > 2)
      raw.push([q(centre.x + Math.cos(a) * lo * 0.92), q(centre.y + Math.sin(a) * lo * 0.92)]);
  }
  if (raw.length < 6) return [];
  const loop = smooth(raw, 0.2, true);
  if (
    loop.length &&
    (loop[0]![0] !== loop[loop.length - 1]![0] || loop[0]![1] !== loop[loop.length - 1]![1])
  ) {
    loop.push(loop[0]!);
  }
  return loop;
}

/** Run each avenue through the wall and leave the road passing the opening. */
function pierceAvenues(
  edges: Edge[],
  entries: Array<{ x: number; y: number }>,
  wall: Array<[number, number]>,
): Array<{ x: number; y: number; rot: number }> {
  if (wall.length < 4) return [];
  const gates: Array<{ x: number; y: number; rot: number }> = [];
  for (const edge of edges) {
    if (edge.rank !== 1 || edge.points.length < 2) continue;
    const first = edge.points[0]!;
    const last = edge.points[edge.points.length - 1]!;
    const near = (p: [number, number]) =>
      entries.some((entry) => Math.hypot(entry.x - p[0], entry.y - p[1]) < 24);
    const nearFirst = near(first);
    const nearLast = near(last);
    if (!nearFirst && !nearLast) continue;
    const atStart = nearFirst && (!nearLast || distToLoop(first, wall) <= distToLoop(last, wall));
    const opened = openAvenue(edge.points, wall, atStart);
    if (!opened) continue;
    if (gates.some((gate) => Math.hypot(gate.x - opened.x, gate.y - opened.y) < 10)) continue;
    edge.points = opened.points;
    edge.samples = samplePolyline(edge.points, 2);
    gates.push({ x: opened.x, y: opened.y, rot: gateRot([edge], opened.x, opened.y) });
  }
  if (gates.length) return gates;
  return gatePoints(wall, entries).map((gate) => ({
    ...gate,
    rot: gateRot(edges, gate.x, gate.y),
  }));
}

function distToLoop(p: [number, number], loop: Array<[number, number]>): number {
  let best = Infinity;
  for (const q of loop) best = Math.min(best, Math.hypot(q[0] - p[0], q[1] - p[1]));
  return best;
}

function crossPoint(
  a: [number, number],
  b: [number, number],
  c: [number, number],
  d: [number, number],
): { x: number; y: number } | null {
  const rx = b[0] - a[0];
  const ry = b[1] - a[1];
  const sx = d[0] - c[0];
  const sy = d[1] - c[1];
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-8) return null;
  const t = ((c[0] - a[0]) * sy - (c[1] - a[1]) * sx) / den;
  const u = ((c[0] - a[0]) * ry - (c[1] - a[1]) * rx) / den;
  if (t < -0.02 || t > 1.02 || u < -0.02 || u > 1.02) return null;
  return { x: a[0] + rx * t, y: a[1] + ry * t };
}

function hitLoop(
  a: [number, number],
  b: [number, number],
  loop: Array<[number, number]>,
): { x: number; y: number } | null {
  for (let i = 1; i < loop.length; i++) {
    const hit = crossPoint(a, b, loop[i - 1]!, loop[i]!);
    if (hit) return hit;
  }
  return null;
}

function openAvenue(
  points: Array<[number, number]>,
  wall: Array<[number, number]>,
  atStart: boolean,
): { x: number; y: number; points: Array<[number, number]> } | null {
  const end = atStart ? points[0]! : points[points.length - 1]!;
  const prev = atStart ? points[1]! : points[points.length - 2]!;
  const dx = end[0] - prev[0];
  const dy = end[1] - prev[1];
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const far: [number, number] = [end[0] + ux * 100, end[1] + uy * 100];
  const hit = hitLoop(end, far, wall) ?? hitLoop(prev, end, wall);
  if (!hit) return null;
  const gate: [number, number] = [q(hit.x), q(hit.y)];
  const beyond: [number, number] = [q(hit.x + ux * 14), q(hit.y + uy * 14)];
  const body = atStart ? points.slice(1) : points.slice(0, -1);
  const next = (atStart ? [beyond, gate, end, ...body] : [...body, end, gate, beyond]).filter(
    (p, i, all) => i === 0 || Math.hypot(p[0] - all[i - 1]![0], p[1] - all[i - 1]![1]) > 0.4,
  );
  if (polylineCrossesSelf(next)) return null;
  return { x: gate[0], y: gate[1], points: next };
}

function gatePoints(
  wall: Array<[number, number]>,
  entries: Array<{ x: number; y: number }>,
): Array<{ x: number; y: number }> {
  return entries.map((entry) => {
    let best = wall[0] ?? [entry.x, entry.y];
    let dist = Infinity;
    for (const p of wall) {
      const d = Math.hypot(p[0] - entry.x, p[1] - entry.y);
      if (d < dist) {
        dist = d;
        best = p;
      }
    }
    return { x: q(best[0]), y: q(best[1]) };
  });
}

function wallSegments(
  defence: DefenceRule,
  wall: Array<[number, number]>,
  gates: Array<{ x: number; y: number }>,
): PlanSegment[] {
  if (defence.kind === 'none' || wall.length < 4) return [];
  const kind =
    defence.kind === 'hedge' ? 'hedge' : defence.kind === 'curtain' ? 'wall' : 'palisade';
  const kit =
    defence.kind === 'curtain'
      ? 'civ_wall_curtain_3m'
      : defence.kind === 'hedge'
        ? 'prop_fence_hedge_3m'
        : 'civ_wall_palisade_3m';
  const gap = defence.kind === 'curtain' ? 5.5 : defence.kind === 'hedge' ? 3.2 : 4.6;
  const chains: Array<Array<[number, number]>> = [];
  let current: Array<[number, number]> = [];
  for (const p of wall) {
    if (gates.some((g) => Math.hypot(g.x - p[0], g.y - p[1]) < gap)) {
      if (current.length >= 2) chains.push(current);
      current = [];
      continue;
    }
    current.push(p);
  }
  if (current.length >= 2) chains.push(current);
  return chains.map((points, index) => ({
    id: `w${index}`,
    kind,
    kit,
    points,
    gates: [],
  }));
}

function gateRot(edges: Edge[], x: number, y: number): number {
  let best = Infinity;
  let yaw = 0;
  for (const edge of edges) {
    if (edge.rank !== 1) continue;
    for (let i = 1; i < edge.points.length; i++) {
      const a = edge.points[i - 1]!;
      const b = edge.points[i]!;
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const len = Math.hypot(dx, dy) || 1;
      const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (len * len)));
      const px = a[0] + dx * t;
      const py = a[1] + dy * t;
      const d = Math.hypot(px - x, py - y);
      if (d < best) {
        best = d;
        yaw = yawToward(dx, dy);
      }
    }
  }
  // The gatehouse's long side runs with the wall, across the avenue.
  return qYaw(yaw + 90);
}

function propsFor(
  style: LayoutStyle,
  centre: { x: number; y: number },
  gates: Array<{ x: number; y: number; rot?: number }>,
  defence: DefenceRule,
  buildings: PlanBuilding[],
  segments: PlanSegment[],
  rng: Rng,
): PlanProp[] {
  const props: PlanProp[] = [];
  const push = (
    kit: string,
    sprite: string,
    x: number,
    y: number,
    propClass: PlanProp['propClass'],
    rot?: number,
  ) => {
    props.push({
      sprite,
      kit,
      x: q(x),
      y: q(y),
      rot: rot ?? rng.pick([0, 90, 180, 270]),
      variant: 'default',
      propClass,
    });
  };
  if (style.centre === 'fire_ring') {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      push(
        'prop_lantern_post',
        'lantern',
        centre.x + Math.cos(a) * 4.5,
        centre.y + Math.sin(a) * 4.5,
        'prop',
      );
    }
  }
  if (defence.towers === 'gates' || defence.towers === 'corners' || defence.towers === 'every_n') {
    for (const gate of gates) {
      const dx = centre.x - gate.x;
      const dy = centre.y - gate.y;
      const len = Math.hypot(dx, dy) || 1;
      push(
        'civ_wall_tower_6x6',
        'civ_wall_tower_6x6',
        gate.x + (dx / len) * 5,
        gate.y + (dy / len) * 5,
        'civic',
        gate.rot,
      );
      push('civ_wall_gatehouse_9x6', 'civ_wall_gatehouse_9x6', gate.x, gate.y, 'civic', gate.rot);
    }
  }
  for (const segment of segments) {
    if (segment.kind !== 'wall') continue;
    let walked = 0;
    let nextAt = 40;
    for (let i = 1; i < segment.points.length; i++) {
      const a = segment.points[i - 1]!;
      const b = segment.points[i]!;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      while (walked + len >= nextAt) {
        const t = (nextAt - walked) / (len || 1);
        const x = a[0] + (b[0] - a[0]) * t;
        const y = a[1] + (b[1] - a[1]) * t;
        const nearGate = gates.some((gate) => Math.hypot(gate.x - x, gate.y - y) < 16);
        if (!nearGate) {
          const yaw = yawToward(b[0] - a[0], b[1] - a[1]);
          push('civ_wall_tower_6x6', 'civ_wall_tower_6x6', x, y, 'civic', qYaw(yaw + 90));
        }
        nextAt += 40;
      }
      walked += len;
    }
  }
  const smith = buildings.find((b) => b.role === 'smithy');
  if (smith?.obb) push('prop_anvil', 'market', smith.obb.cx, smith.obb.cy, 'prop');
  return props;
}

function zonesFor(
  style: LayoutStyle,
  centre: { x: number; y: number },
  cls: SettlementClass,
  seeds: Seed[],
  buildings: PlanBuilding[],
): PlanZone[] {
  const zones: PlanZone[] = [];
  const span = cls === 'city' ? 16 : cls === 'town' ? 12 : 8;
  const kind =
    style.centre === 'fire_ring' ? 'plaza' : style.centre === 'green' ? 'green' : 'plaza';
  zones.push({
    id: 'centre',
    kind,
    rect: { x: q(centre.x - span / 2), y: q(centre.y - span / 2), w: span, d: span },
  });
  for (const seed of seeds) {
    const mine = buildings.filter((b) => b.district === seed.id);
    if (!mine.length) continue;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const b of mine) {
      minX = Math.min(minX, b.lot.x);
      minY = Math.min(minY, b.lot.y);
      maxX = Math.max(maxX, b.lot.x + b.lot.w);
      maxY = Math.max(maxY, b.lot.y + b.lot.d);
    }
    zones.push({
      id: seed.id,
      kind: 'district',
      subtype: seed.id,
      rect: { x: q(minX), y: q(minY), w: q(maxX - minX), d: q(maxY - minY) },
    });
  }
  return zones;
}

function respawnFor(
  buildings: PlanBuilding[],
  centre: { x: number; y: number },
  style: LayoutStyle,
): SettlementPlan['respawnAnchor'] {
  const healer = buildings.find((b) => b.role === 'healer');
  const shrine = buildings.find((b) => b.role === 'shrine' || b.role === 'temple');
  const at = healer?.obb ?? shrine?.obb;
  const kind = healer ? 'healer' : shrine ? (style.id === 'orc' ? 'shrine' : 'temple') : 'campfire';
  return { x: q(at?.cx ?? centre.x), y: q(at?.cy ?? centre.y), kind };
}

export function pointInLayoutObb(x: number, y: number, obb: Obb): boolean {
  return pointInObb(x, y, obb);
}
