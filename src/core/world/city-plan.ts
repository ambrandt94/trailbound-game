/**
 * City plans for settlement generation 2. A plan is deterministic from its seed,
 * cached in memory, and never written to a save. World generation places the
 * footprints; this cutter is what the World Gen debug overlay draws. Layout
 * still comes later.
 */
import type { Vec2 } from './models';
import { fbm, hash2, Rng } from './noise';
import {
  boundingBox,
  quadrantsToFine,
  sortQuads,
  thinnestWidth,
  toKeySet,
  quadKey,
} from './city-mask';
import {
  cleanFootprint,
  partitionFootprint,
  type CutWarning,
  type CutWard,
  WARD_BOX,
  WARD_MAX,
  WARD_MIN,
} from './ward-partition';

export type SettlementClass = 'hamlet' | 'village' | 'town' | 'city' | 'capital' | 'metropolis';

export const SETTLEMENT_CLASSES: readonly SettlementClass[] = [
  'hamlet',
  'village',
  'town',
  'city',
  'capital',
  'metropolis',
];

export interface SizeClass {
  id: SettlementClass;
  /**
   * Quadrants of clearance a later generator keeps between this class and a
   * chunk edge, measured in display tiles (16 fine tiles, 128 m).
   */
  chunkEdgeMargin: number;
  /** Hamlet, village, and town are a single ward. */
  singleWard: boolean;
}

export const SIZE_CLASS: Record<SettlementClass, SizeClass> = {
  hamlet: { id: 'hamlet', chunkEdgeMargin: 2, singleWard: true },
  village: { id: 'village', chunkEdgeMargin: 2, singleWard: true },
  town: { id: 'town', chunkEdgeMargin: 4, singleWard: true },
  city: { id: 'city', chunkEdgeMargin: 8, singleWard: false },
  capital: { id: 'capital', chunkEdgeMargin: 8, singleWard: false },
  metropolis: { id: 'metropolis', chunkEdgeMargin: 12, singleWard: false },
};

/** Target blob radius in quadrants, before the irregular outline and the clean. */
const CLASS_RADIUS: Record<SettlementClass, number> = {
  hamlet: 3.1,
  village: 3.35,
  town: 3.55,
  city: 7.2,
  capital: 8.6,
  metropolis: 10.4,
};

export interface DistrictStub {
  id: string;
  kind: string;
  /** Quadrant the ward cutter biases a seed toward. */
  centre: Vec2;
  /** Stub outline. Empty in C0. */
  polygon: Vec2[];
}

export interface StreetCell {
  x: number;
  y: number;
  /** Street direction through this quadrant. Junctions are `j`. */
  axis: 'h' | 'v' | 'j';
}

export interface WardNeighbour {
  wardId: number;
  seamLength: number;
  crossings: Vec2[];
}

export interface Ward {
  wardId: number;
  /** Fine tiles (8 m) covered by this ward's quadrants. */
  tiles: Vec2[];
  quadrants: Vec2[];
  neighbours: WardNeighbour[];
}

export interface PlanWarning {
  kind: 'sliver' | 'invariant';
  quadrant: Vec2;
  message: string;
}

export interface CityPlan {
  seed: number;
  settlementClass: SettlementClass;
  /** Fine-tile masks. Core, outskirts, and docks together are the cleaned footprint. */
  core: Vec2[];
  outskirts: Vec2[];
  docks: Vec2[];
  footprint: Vec2[];
  /** Cleaned footprint in quadrants. Ward quadrants partition this set. */
  quadrants: Vec2[];
  /** Wall polyline, one entry per quadrant in ring order, with gaps at the gates. */
  wall: Vec2[];
  gates: Vec2[];
  /** Keep quadrants. Wholly inside one ward. */
  keep: Vec2[];
  /** Wall runs between gates. Each run is wholly inside one ward. */
  wallSegments: Vec2[][];
  streets: StreetCell[];
  /** Lot footprints. A ward seam never cuts one. */
  lots: Vec2[][];
  /**
   * Street-centre quadrants plus their two curbs, for straight runs away from
   * a junction. A seam must not run along these.
   */
  streetBundles: Vec2[][];
  districts: DistrictStub[];
  wards: Ward[];
  warnings: PlanWarning[];
  /** Sliver-repair iterations that changed the cut. */
  passes: number;
  /** True when the cutter fell back to a regular 4×4-quadrant grid. */
  fallback: boolean;
}

const cache = new Map<string, CityPlan>();

export function cityPlan(seed: number, settlementClass: SettlementClass): CityPlan {
  const key = `${settlementClass}:${seed >>> 0}`;
  const hit = cache.get(key);
  if (hit) return hit;
  if (cache.size > 32) cache.clear();
  const plan = buildCityPlan(seed >>> 0 || 1, settlementClass);
  cache.set(key, plan);
  return plan;
}

/** Drop cached plans. Tests use this so a process does not keep every seed. */
export function clearCityPlanCache(): void {
  cache.clear();
}

function buildCityPlan(seed: number, settlementClass: SettlementClass): CityPlan {
  const spec = SIZE_CLASS[settlementClass];
  const carved = carveFootprint(seed, settlementClass);
  const cut = partitionFootprint({
    quadrants: carved.quadrants,
    roads: carved.streets.map((cell) => ({ x: cell.x, y: cell.y })),
    // Lots, the keep, and short street bundles are whole aligned blocks or sit
    // inside one ward. Groups that would cross a ward are dropped below.
    groups: featureGroups(carved),
    districtCentres: carved.districts.map((district) => district.centre),
    singleWard: spec.singleWard,
  });
  const wards = cut.wards.map((ward) => toWard(ward));
  const wardOf = new Map<number, number>();
  for (const ward of wards) {
    for (const cell of ward.quadrants) wardOf.set(quadKey(cell.x, cell.y), ward.wardId);
  }
  const monoGroup = (group: Vec2[]): boolean => {
    let id: number | undefined;
    for (const cell of group) {
      const got = wardOf.get(quadKey(cell.x, cell.y));
      if (got === undefined) return false;
      if (id === undefined) id = got;
      else if (id !== got) return false;
    }
    return group.length > 0;
  };
  const streetBundles = featureGroups(carved).filter(
    (group) =>
      group.some((cell) =>
        carved.streets.some((street) => street.x === cell.x && street.y === cell.y),
      ) &&
      group.every((cell) => wardOf.has(quadKey(cell.x, cell.y))) &&
      monoGroup(group),
  );
  const footprint = quadrantsToFine(cut.quadrants);
  const coreSet = toKeySet(carved.core);
  const dockSet = toKeySet(carved.docks);
  const coreQuads = cut.quadrants.filter((cell) => coreSet.has(quadKey(cell.x, cell.y)));
  const dockQuads = cut.quadrants.filter((cell) => dockSet.has(quadKey(cell.x, cell.y)));
  const outskirtsQuads = cut.quadrants.filter(
    (cell) => !coreSet.has(quadKey(cell.x, cell.y)) && !dockSet.has(quadKey(cell.x, cell.y)),
  );
  return {
    seed,
    settlementClass,
    core: quadrantsToFine(coreQuads),
    outskirts: quadrantsToFine(outskirtsQuads),
    docks: quadrantsToFine(dockQuads),
    footprint,
    quadrants: cut.quadrants,
    wall: carved.wall.filter((cell) => wardOf.has(quadKey(cell.x, cell.y))),
    gates: carved.gates.filter((cell) => wardOf.has(quadKey(cell.x, cell.y))),
    keep: monoGroup(carved.keep) ? carved.keep : stampKeep(wards),
    wallSegments: carved.wallSegments
      .map((group) => group.filter((cell) => wardOf.has(quadKey(cell.x, cell.y))))
      .filter(monoGroup),
    streets: carved.streets.filter((cell) => wardOf.has(quadKey(cell.x, cell.y))),
    lots: carved.lots.filter(monoGroup),
    streetBundles,
    districts: carved.districts,
    wards,
    warnings: cut.warnings.map(toWarning),
    passes: cut.passes,
    fallback: cut.fallback,
  };
}

function stampKeep(wards: readonly { quadrants: Vec2[] }[]): Vec2[] {
  for (const ward of wards) {
    const set = toKeySet(ward.quadrants);
    for (const cell of ward.quadrants) {
      const block = [
        cell,
        { x: cell.x + 1, y: cell.y },
        { x: cell.x, y: cell.y + 1 },
        { x: cell.x + 1, y: cell.y + 1 },
      ];
      if (block.every((item) => set.has(quadKey(item.x, item.y)))) return block;
    }
  }
  return wards[0]?.quadrants.slice(0, 1) ?? [];
}

function toWard(ward: CutWard): Ward {
  return {
    wardId: ward.wardId,
    tiles: quadrantsToFine(ward.quadrants),
    quadrants: ward.quadrants,
    neighbours: ward.neighbours.map((neighbour) => ({
      wardId: neighbour.wardId,
      seamLength: neighbour.seamLength,
      crossings: neighbour.crossings,
    })),
  };
}

function toWarning(warning: CutWarning): PlanWarning {
  return {
    kind: warning.kind,
    quadrant: { x: warning.x, y: warning.y },
    message: warning.message,
  };
}

interface Carved {
  quadrants: Vec2[];
  core: Vec2[];
  docks: Vec2[];
  wall: Vec2[];
  wallSegments: Vec2[][];
  gates: Vec2[];
  keep: Vec2[];
  streets: StreetCell[];
  lots: Vec2[][];
  districts: DistrictStub[];
}

function carveFootprint(seed: number, settlementClass: SettlementClass): Carved {
  const spec = SIZE_CLASS[settlementClass];
  const radius = CLASS_RADIUS[settlementClass];
  const water = !spec.singleWard && hash2(seed, 9, 4) > 0.35;
  let best: Vec2[] = [];
  let dockCells: Vec2[] = [];
  let radiusNow = radius;
  for (let attempt = 0; attempt < 8; attempt++) {
    const blob = rasterBlob(seed, radiusNow, water);
    const pier = dockBlock(seed, blob, water);
    const cleaned = cleanFootprint(unionCells(blob, pier), []);
    best = cleaned;
    dockCells = pier.filter((cell) => toKeySet(cleaned).has(quadKey(cell.x, cell.y)));
    if (footprintFits(cleaned, spec.singleWard)) break;
    const box = boundingBox(cleaned);
    const tooBig =
      (spec.singleWard && (cleaned.length > WARD_MAX || box.w > WARD_BOX || box.h > WARD_BOX)) ||
      (!spec.singleWard && cleaned.length > radius * radius * 4.2);
    radiusNow *= tooBig ? 0.9 : 1.1;
  }
  if (spec.singleWard && !footprintFits(best, true)) {
    best = fittedSingle(seed);
    dockCells = [];
  }
  if (!spec.singleWard && best.length < 48) {
    const blob = rasterBlob(seed, radius * 1.25, water);
    const pier = dockBlock(seed, blob, water);
    best = cleanFootprint(unionCells(blob, pier), []);
    dockCells = pier.filter((cell) => toKeySet(best).has(quadKey(cell.x, cell.y)));
  }

  const inF = toKeySet(best);
  const coreRadius = spec.singleWard ? radiusNow * 0.55 : radius * 0.42;
  const core = best.filter((cell) => cell.x * cell.x + cell.y * cell.y <= coreRadius * coreRadius);
  const docks = dockCells.filter((cell) => inF.has(quadKey(cell.x, cell.y)));
  const dockSet = toKeySet(docks);
  const keep = placeKeep(best);
  const streets = placeStreets(best, keep);
  const streetSet = toKeySet(streets);
  const lots = placeLots(seed, best, streetSet, toKeySet(keep));
  const { wall, gates, wallSegments } = placeWall(best, core.length ? core : best, keep);
  const districts = placeDistricts(
    keep,
    docks.filter((cell) => dockSet.has(quadKey(cell.x, cell.y))),
    gates,
  );
  return {
    quadrants: best,
    core: core.length ? core : best.slice(0, Math.max(1, Math.floor(best.length / 3))),
    docks,
    wall,
    wallSegments,
    gates,
    keep,
    streets,
    lots,
    districts,
  };
}

function footprintFits(cells: readonly Vec2[], single: boolean): boolean {
  if (cells.length < WARD_MIN) return false;
  if (thinnestWidth(cells) < 2) return false;
  const box = boundingBox(cells);
  if (single) return cells.length <= WARD_MAX && box.w <= WARD_BOX && box.h <= WARD_BOX;
  return cells.length >= 48 && box.w >= 8 && box.h >= 8;
}

/**
 * 4×4 block. It is a fixed point of a radius-1 open, width 2, and 16 quadrants,
 * so it is a legal single ward when an irregular blob will not fit in one.
 */
function fittedSingle(_seed: number): Vec2[] {
  const cells: Vec2[] = [];
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) cells.push({ x, y });
  }
  return cells;
}

function unionCells(body: readonly Vec2[], extra: readonly Vec2[]): Vec2[] {
  const set = toKeySet(body);
  const out = body.slice();
  for (const cell of extra) {
    const key = quadKey(cell.x, cell.y);
    if (set.has(key)) continue;
    set.add(key);
    out.push(cell);
  }
  return out;
}

function rasterBlob(seed: number, radius: number, water: boolean): Vec2[] {
  const reach = Math.ceil(radius + 3);
  const bay = hash2(seed, 11, 2) * Math.PI * 2;
  const bayX = Math.cos(bay);
  const bayY = Math.sin(bay);
  const inside = (x: number, y: number): boolean => {
    const angle = Math.atan2(y, x);
    const n = fbm(Math.cos(angle) * 1.7 + 2, Math.sin(angle) * 1.7 + 2, seed + 17, 3);
    const limit = radius * (0.84 + 0.32 * n);
    const dist = Math.hypot(x + 0.5, y + 0.5);
    if (dist > limit) return false;
    if (water) {
      const along = x * bayX + y * bayY;
      const side = Math.abs(-x * bayY + y * bayX);
      if (along > radius * 0.2 && side < radius * 0.45 && dist > radius * 0.55) return false;
    }
    return true;
  };
  // Whole aligned 2×2 blocks only, so the footprint is a union of squares and
  // the ward cut never has to split a square to stay two quadrants thick.
  const cells: Vec2[] = [];
  for (let y = -reach; y <= reach; y += 2) {
    for (let x = -reach; x <= reach; x += 2) {
      const cx = x + 0.5;
      const cy = y + 0.5;
      if (!inside(cx, cy) && !inside(x, y) && !inside(x + 1, y) && !inside(x, y + 1)) continue;
      if (!inside(cx, cy)) continue;
      for (let dy = 0; dy < 2; dy++)
        for (let dx = 0; dx < 2; dx++) cells.push({ x: x + dx, y: y + dy });
    }
  }
  return cells;
}

function dockBlock(seed: number, cells: readonly Vec2[], water: boolean): Vec2[] {
  if (!water || !cells.length) return [];
  const box = boundingBox(cells);
  const rng = new Rng(seed ^ 0x51ed);
  const edge = rng.int(0, 3);
  let x = 0;
  let y = 0;
  if (edge === 0) {
    x = box.x0 - 3;
    y = Math.round((box.y0 + box.y1) / 2) - 1;
  } else if (edge === 1) {
    x = box.x1;
    y = Math.round((box.y0 + box.y1) / 2) - 1;
  } else if (edge === 2) {
    x = Math.round((box.x0 + box.x1) / 2) - 1;
    y = box.y0 - 3;
  } else {
    x = Math.round((box.x0 + box.x1) / 2) - 1;
    y = box.y1;
  }
  const block: Vec2[] = [];
  for (let dy = 0; dy < 4; dy++) {
    for (let dx = 0; dx < 4; dx++) block.push({ x: x + dx, y: y + dy });
  }
  // Keep the pier only when it actually touches the footprint, so it joins F.
  const body = toKeySet(cells);
  const touches = block.some((cell) =>
    [1, -1, 0, 0].some((_, index) => {
      const dirs: ReadonlyArray<readonly [number, number]> = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ];
      const dir = dirs[index]!;
      return body.has(quadKey(cell.x + dir[0], cell.y + dir[1]));
    }),
  );
  return touches ? block : [];
}

function placeKeep(cells: readonly Vec2[]): Vec2[] {
  const set = toKeySet(cells);
  const candidates = [
    { x: 0, y: 0 },
    { x: -1, y: -1 },
    { x: 0, y: -1 },
    { x: -1, y: 0 },
  ];
  for (const origin of candidates) {
    const block: Vec2[] = [];
    let ok = true;
    for (let y = 0; y < 2 && ok; y++) {
      for (let x = 0; x < 2; x++) {
        const cell = { x: origin.x + x, y: origin.y + y };
        if (!set.has(quadKey(cell.x, cell.y))) ok = false;
        else block.push(cell);
      }
    }
    if (ok) return block;
  }
  return cells.slice(0, 1);
}

function placeStreets(cells: readonly Vec2[], keep: readonly Vec2[]): StreetCell[] {
  const set = toKeySet(cells);
  const blocked = toKeySet(keep);
  const box = boundingBox(cells);
  const streets: StreetCell[] = [];
  const taken = new Set<number>();
  const addLine = (horizontal: boolean, at: number) => {
    const run: StreetCell[] = [];
    if (horizontal) {
      for (let x = box.x0; x <= box.x1; x++) {
        const cell = { x, y: at };
        if (!set.has(quadKey(cell.x, cell.y)) || blocked.has(quadKey(cell.x, cell.y))) {
          if (run.length >= 3) commit(run);
          run.length = 0;
          continue;
        }
        const up = set.has(quadKey(x, at - 1));
        const down = set.has(quadKey(x, at + 1));
        if (!up || !down) {
          if (run.length >= 3) commit(run);
          run.length = 0;
          continue;
        }
        run.push({ x, y: at, axis: 'h' });
      }
    } else {
      for (let y = box.y0; y <= box.y1; y++) {
        const cell = { x: at, y };
        if (!set.has(quadKey(cell.x, cell.y)) || blocked.has(quadKey(cell.x, cell.y))) {
          if (run.length >= 3) commit(run);
          run.length = 0;
          continue;
        }
        const left = set.has(quadKey(at - 1, y));
        const right = set.has(quadKey(at + 1, y));
        if (!left || !right) {
          if (run.length >= 3) commit(run);
          run.length = 0;
          continue;
        }
        run.push({ x: at, y, axis: 'v' });
      }
    }
    if (run.length >= 3) commit(run);
  };
  const commit = (run: StreetCell[]) => {
    for (const cell of run) {
      const key = quadKey(cell.x, cell.y);
      if (taken.has(key)) {
        const prev = streets.find((street) => street.x === cell.x && street.y === cell.y);
        if (prev && prev.axis !== cell.axis) prev.axis = 'j';
        continue;
      }
      taken.add(key);
      streets.push(cell);
    }
  };
  const midY = Math.round((box.y0 + box.y1) / 2);
  const midX = Math.round((box.x0 + box.x1) / 2);
  addLine(true, midY);
  addLine(false, midX);
  if (box.w >= 10) addLine(true, box.y0 + 3);
  if (box.h >= 10) addLine(false, box.x0 + 3);
  return streets;
}

function placeLots(
  seed: number,
  cells: readonly Vec2[],
  streets: ReadonlySet<number>,
  keep: ReadonlySet<number>,
): Vec2[][] {
  const set = toKeySet(cells);
  const used = new Set<number>([...streets, ...keep]);
  const lots: Vec2[][] = [];
  const rng = new Rng(seed ^ 0x10c5);
  const ordered = sortQuads(cells);
  // Walk in seed-rotated order so lot placement is deterministic but not always the corner.
  const start = rng.int(0, Math.max(0, ordered.length - 1));
  const sequence = ordered.slice(start).concat(ordered.slice(0, start));
  for (const origin of sequence) {
    if (lots.length >= (ordered.length > 80 ? 8 : 3)) break;
    const block: Vec2[] = [];
    let ok = true;
    for (let y = 0; y < 2 && ok; y++) {
      for (let x = 0; x < 2; x++) {
        const cell = { x: origin.x + x, y: origin.y + y };
        const key = quadKey(cell.x, cell.y);
        if (!set.has(key) || used.has(key)) ok = false;
        else block.push(cell);
      }
    }
    if (!ok) continue;
    // Leave the street curb free so a street bundle and a lot do not share a quadrant.
    const touchesStreet = block.some((cell) =>
      [1, -1, 0, 0].some((_, index) => {
        const dirs: ReadonlyArray<readonly [number, number]> = [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ];
        const dir = dirs[index]!;
        return streets.has(quadKey(cell.x + dir[0], cell.y + dir[1]));
      }),
    );
    if (touchesStreet) continue;
    for (const cell of block) used.add(quadKey(cell.x, cell.y));
    lots.push(block);
  }
  return lots;
}

function placeWall(
  cells: readonly Vec2[],
  core: readonly Vec2[],
  keep: readonly Vec2[],
): { wall: Vec2[]; gates: Vec2[]; wallSegments: Vec2[][] } {
  const body = toKeySet(cells);
  const inside = toKeySet(core);
  const keepSet = toKeySet(keep);
  const ring: Vec2[] = [];
  for (const cell of sortQuads(cells)) {
    if (!inside.has(quadKey(cell.x, cell.y))) continue;
    let boundary = false;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const next = { x: cell.x + dx, y: cell.y + dy };
      if (body.has(quadKey(next.x, next.y)) && !inside.has(quadKey(next.x, next.y)))
        boundary = true;
    }
    if (boundary && !keepSet.has(quadKey(cell.x, cell.y))) ring.push(cell);
  }
  if (ring.length < 4) return { wall: [], gates: [], wallSegments: [] };
  const gates = pickGates(ring);
  const gateSet = toKeySet(gates);
  const wall = ring.filter((cell) => !gateSet.has(quadKey(cell.x, cell.y)));
  const segments = chunkRuns(wall, 4);
  return { wall, gates, wallSegments: segments };
}

function pickGates(ring: readonly Vec2[]): Vec2[] {
  const box = boundingBox(ring);
  const targets = [
    { x: (box.x0 + box.x1) / 2, y: box.y0 },
    { x: box.x1, y: (box.y0 + box.y1) / 2 },
    { x: (box.x0 + box.x1) / 2, y: box.y1 },
    { x: box.x0, y: (box.y0 + box.y1) / 2 },
  ];
  const used = new Set<number>();
  const gates: Vec2[] = [];
  for (const target of targets) {
    let best: Vec2 | null = null;
    let bestD = Infinity;
    for (const cell of ring) {
      const key = quadKey(cell.x, cell.y);
      if (used.has(key)) continue;
      const d = (cell.x - target.x) ** 2 + (cell.y - target.y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = cell;
      }
    }
    if (best) {
      used.add(quadKey(best.x, best.y));
      gates.push(best);
    }
  }
  return gates;
}

/** Consecutive 4-connected cells, in runs no longer than `limit`. */
function chunkRuns(cells: readonly Vec2[], limit: number): Vec2[][] {
  const set = toKeySet(cells);
  const seen = new Set<number>();
  const runs: Vec2[][] = [];
  for (const start of sortQuads(cells)) {
    const key = quadKey(start.x, start.y);
    if (seen.has(key)) continue;
    const run: Vec2[] = [];
    let cursor = start;
    while (run.length < limit) {
      const cursorKey = quadKey(cursor.x, cursor.y);
      if (!set.has(cursorKey) || seen.has(cursorKey)) break;
      seen.add(cursorKey);
      run.push(cursor);
      let next: Vec2 | null = null;
      for (const [dx, dy] of [
        [1, 0],
        [0, 1],
        [-1, 0],
        [0, -1],
      ] as const) {
        const candidate = { x: cursor.x + dx, y: cursor.y + dy };
        const candidateKey = quadKey(candidate.x, candidate.y);
        if (!set.has(candidateKey) || seen.has(candidateKey)) continue;
        next = candidate;
        break;
      }
      if (!next) break;
      cursor = next;
    }
    if (run.length > 1) runs.push(run);
  }
  return runs;
}

function placeDistricts(
  keep: readonly Vec2[],
  docks: readonly Vec2[],
  gates: readonly Vec2[],
): DistrictStub[] {
  const centreOf = (cells: readonly Vec2[], fallback: Vec2): Vec2 => {
    if (!cells.length) return fallback;
    let x = 0;
    let y = 0;
    for (const cell of cells) {
      x += cell.x;
      y += cell.y;
    }
    return { x: Math.round(x / cells.length), y: Math.round(y / cells.length) };
  };
  const keepCentre = centreOf(keep, { x: 0, y: 0 });
  const districts: DistrictStub[] = [
    { id: 'keep', kind: 'keep', centre: keepCentre, polygon: [] },
    { id: 'market', kind: 'market', centre: { x: keepCentre.x + 3, y: keepCentre.y }, polygon: [] },
  ];
  if (gates[0]) districts.push({ id: 'gate', kind: 'gate', centre: gates[0], polygon: [] });
  if (docks.length) {
    districts.push({
      id: 'docks',
      kind: 'docks',
      centre: centreOf(docks, keepCentre),
      polygon: [],
    });
  }
  return districts;
}

function featureGroups(carved: Carved): Vec2[][] {
  const groups: Vec2[][] = [];
  if (carved.keep.length > 1) groups.push(carved.keep);
  for (const lot of carved.lots) if (lot.length > 1) groups.push(lot);
  for (const segment of carved.wallSegments) if (segment.length > 1) groups.push(segment);
  const foot = toKeySet(carved.quadrants);
  const streetAt = new Set(carved.streets.map((cell) => quadKey(cell.x, cell.y)));
  const junctions = carved.streets.filter((cell) => cell.axis === 'j');
  for (const street of carved.streets) {
    if (street.axis === 'j') continue;
    // Bundles next to a crossing share curb quadrants and would fuse the whole
    // street net into one atom. Straight runs away from crossings do not.
    const nearJunction = junctions.some(
      (gate) => Math.max(Math.abs(gate.x - street.x), Math.abs(gate.y - street.y)) <= 1,
    );
    if (nearJunction) continue;
    const bundle =
      street.axis === 'h'
        ? [
            { x: street.x, y: street.y },
            { x: street.x, y: street.y - 1 },
            { x: street.x, y: street.y + 1 },
          ]
        : [
            { x: street.x, y: street.y },
            { x: street.x - 1, y: street.y },
            { x: street.x + 1, y: street.y },
          ];
    if (bundle.some((cell) => !foot.has(quadKey(cell.x, cell.y)))) continue;
    if (bundle.some((cell, index) => index > 0 && streetAt.has(quadKey(cell.x, cell.y)))) continue;
    const overlaps = groups.some((group) =>
      group.some((cell) => bundle.some((item) => item.x === cell.x && item.y === cell.y)),
    );
    if (overlaps) continue;
    groups.push(bundle);
  }
  return groups;
}
