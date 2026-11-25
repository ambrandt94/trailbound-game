/**
 * Ward cutter. Footprint F is cleaned, then cut into 4-connected hole-free wards.
 * Small classes stay one ward. Larger footprints use farthest-point seeds and
 * balanced growth, then a sliver repair. A 4×4 grid is the fallback.
 */
import type { Vec2 } from './models';
import {
  boundingBox,
  components4,
  fillHoles,
  hasHole,
  isConnected4,
  morphClose,
  morphOpen,
  pruneThin,
  quadKey,
  sortQuads,
  thinnestWidth,
  toKeySet,
} from './city-mask';

export const WARD_MIN = 6;
export const WARD_MAX = 18;
export const WARD_BOX = 6;
const TARGET = 12;
const MAX_PASSES = 50;

const CARDINAL: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

export interface CutWarning {
  kind: 'sliver' | 'invariant';
  x: number;
  y: number;
  message: string;
}

export interface CutNeighbour {
  wardId: number;
  seamLength: number;
  crossings: Vec2[];
}

export interface CutWard {
  wardId: number;
  quadrants: Vec2[];
  neighbours: CutNeighbour[];
}

export interface CutResult {
  quadrants: Vec2[];
  wards: CutWard[];
  passes: number;
  fallback: boolean;
  warnings: CutWarning[];
}

export interface CutInput {
  quadrants: readonly Vec2[];
  /** Road quadrants. A 1-quadrant gap along a road can bridge a component smaller than 4. */
  roads?: readonly Vec2[];
  /** Quadrant groups that must not be split (lots, street bundles, wall runs, keep). */
  groups?: readonly (readonly Vec2[])[];
  /** Seed bias. Snapped onto F. */
  districtCentres?: readonly Vec2[];
  /** Hamlet, village, and town: one ward, no multi-seed cut. */
  singleWard?: boolean;
}

interface Atom {
  id: number;
  cells: Vec2[];
}

/**
 * Fill holes, drop (or road-bridge) components under 4 quadrants, open/close
 * radius 1, then drop anything that is still a 1-quadrant neck or spur.
 * Repeated until the mask stops changing so a second clean is a no-op.
 */
export function cleanFootprint(cells: readonly Vec2[], roads: readonly Vec2[] = []): Vec2[] {
  let cur = sortQuads(dedupe(cells));
  for (let i = 0; i < 4; i++) {
    const next = cleanOnce(cur, roads);
    if (i > 0 && sameCells(cur, next)) return next;
    cur = next;
  }
  return cur;
}

function cleanOnce(cells: readonly Vec2[], roads: readonly Vec2[]): Vec2[] {
  let cur = fillHoles(dedupe(cells));
  cur = bridgeOrDrop(cur, roads);
  cur = morphOpen(cur, 1);
  cur = morphClose(cur, 1);
  cur = fillHoles(cur);
  cur = pruneThin(cur);
  cur = fillHoles(cur);
  cur = bridgeOrDrop(cur, roads);
  cur = pruneThin(cur);
  const snapped = resnapAligned(cur);
  const parts = components4(snapped);
  if (parts.length <= 1) return snapped;
  parts.sort((a, b) => b.length - a.length || a[0]!.y - b[0]!.y || a[0]!.x - b[0]!.x);
  return parts[0] ?? [];
}

/** Keep only complete aligned 2×2 blocks so the ward cut has no torn squares. */
function resnapAligned(cells: readonly Vec2[]): Vec2[] {
  const groups = new Map<string, Vec2[]>();
  for (const cell of cells) {
    const bx = Math.floor(cell.x / 2) * 2;
    const by = Math.floor(cell.y / 2) * 2;
    const key = `${bx},${by}`;
    let list = groups.get(key);
    if (!list) {
      list = [];
      groups.set(key, list);
    }
    list.push(cell);
  }
  const out: Vec2[] = [];
  for (const list of groups.values()) if (list.length === 4) out.push(...list);
  return sortQuads(out);
}

export function partitionFootprint(input: CutInput): CutResult {
  const roads = input.roads ?? [];
  const cleaned = cleanFootprint(input.quadrants, roads);
  if (!cleaned.length) {
    return { quadrants: [], wards: [], passes: 0, fallback: false, warnings: [] };
  }
  const groups = clipGroups(input.groups ?? [], cleaned);
  const centres = input.districtCentres ?? [];
  // Hamlet, village, and town are one ward. A footprint that rounds to a single
  // seed (under half a target ward) is one ward too.
  if (input.singleWard === true || Math.round(cleaned.length / TARGET) <= 1) {
    return finish(cleaned, singleOwner(cleaned), 0, false, groups);
  }

  const grown = growPartition(cleaned, groups, centres, false);
  if (partitionValid(cleaned, grown, [], false)) {
    return finish(cleaned, grown, 0, false, []);
  }
  let { owner, passes } = stabilize(cleaned, grown, groups, centres, false);
  let fallback = false;
  if (!partitionValid(cleaned, owner, groups, false)) {
    fallback = true;
    const grid = gridOwner(cleaned);
    const repaired = stabilize(cleaned, grid, groups, centres, true);
    owner = repaired.owner;
    passes = repaired.passes;
    if (!partitionValid(cleaned, owner, groups, false)) {
      owner = forceBlobs(cleaned, groups);
      const again = stabilize(cleaned, owner, groups, centres, true);
      owner = again.owner;
      passes += again.passes;
    }
  }
  return finish(cleaned, owner, passes, fallback, groups);
}

function singleOwner(cells: readonly Vec2[]): Map<number, number> {
  const owner = new Map<number, number>();
  for (const cell of cells) owner.set(quadKey(cell.x, cell.y), 0);
  return owner;
}

/**
 * Pack F into 2×2 blocks, attach every leftover quadrant to the block that
 * completes its 2×2, then grow wards by giving the smallest ward the next
 * adjacent block. Blocks are already two quadrants thick, and a ward stops
 * before it would break the size or box cap.
 */
function clusterPartition(cells: readonly Vec2[], centres: readonly Vec2[]): Map<number, number> {
  const blocks = packBlocks(cells);
  if (!blocks.length) return new Map();
  const adj = blockAdjacency(blocks);
  const k = Math.max(1, Math.min(blocks.length, Math.round(cells.length / TARGET)));
  const seeds = farthestBlockIds(blocks, k, centres);
  const wardOf = new Map<number, number>();
  const members: number[][] = [];
  const body: Vec2[][] = [];
  const claim = (blockId: number, ward: number) => {
    wardOf.set(blockId, ward);
    members[ward]!.push(blockId);
    body[ward]!.push(...(blocks[blockId] ?? []));
  };
  for (const seed of seeds) {
    const ward = members.length;
    members.push([]);
    body.push([]);
    claim(seed, ward);
  }
  const open = new Set<number>();
  for (let i = 0; i < blocks.length; i++) if (!wardOf.has(i)) open.add(i);
  let guard = blocks.length * 3 + 4;
  while (open.size && guard-- > 0) {
    let ward = -1;
    let bestSize = Infinity;
    for (let i = 0; i < members.length; i++) {
      if (!(body[i]?.length ?? 0)) continue;
      if (!adjacentOpen(i, members, adj, open).length) continue;
      const size = body[i]!.length;
      if (size < bestSize) {
        bestSize = size;
        ward = i;
      }
    }
    if (ward < 0) {
      const next = [...open].sort((a, b) => a - b)[0];
      if (next === undefined) break;
      const id = members.length;
      members.push([]);
      body.push([]);
      claim(next, id);
      open.delete(next);
      continue;
    }
    const choices = adjacentOpen(ward, members, adj, open);
    let picked = -1;
    let pickedD = Infinity;
    const seedBlock = blocks[members[ward]![0]!] ?? [];
    const seedCell = seedBlock[0] ?? { x: 0, y: 0 };
    for (const blockId of choices) {
      const trial = (body[ward] ?? []).concat(blocks[blockId] ?? []);
      if (trial.length > TARGET) continue;
      const box = boundingBox(trial);
      if (box.w > WARD_BOX || box.h > WARD_BOX) continue;
      if (thinnestWidth(trial) < 2 || !isConnected4(trial) || hasHole(trial)) continue;
      const at = blocks[blockId]?.[0] ?? seedCell;
      const d = Math.abs(at.x - seedCell.x) + Math.abs(at.y - seedCell.y);
      if (d < pickedD) {
        pickedD = d;
        picked = blockId;
      }
    }
    if (picked < 0) {
      // This ward is boxed in. Park it by giving it a dummy so we try others,
      // and if nobody can take the open blocks, spawn below on the next loop.
      members[ward] = [];
      continue;
    }
    claim(picked, ward);
    open.delete(picked);
  }
  // A parked ward was emptied above; rebuild from wardOf.
  const owner = new Map<number, number>();
  const real = new Map<number, number>();
  let next = 0;
  for (const [blockId, ward] of wardOf) {
    if ((body[ward]?.length ?? 0) === 0 && !members[ward]?.length) {
      // Parked: the claim still recorded block ids in wardOf before parking
      // only cleared members. Re-read body via wardOf instead.
    }
    let id = real.get(ward);
    if (id === undefined) {
      id = next++;
      real.set(ward, id);
    }
    for (const cell of blocks[blockId] ?? []) owner.set(quadKey(cell.x, cell.y), id);
  }
  absorbMissing(owner, cells);
  stealNotches(owner, cells);
  // Wards under the minimum merge into the neighbour that keeps every cap.
  mergeTiny(owner, cells);
  absorbMissing(owner, cells);
  stealNotches(owner, cells);
  return owner;
}

function stealNotches(owner: Map<number, number>, cells: readonly Vec2[]): void {
  const free = () => {
    const set = new Set<number>();
    for (const cell of cells) {
      const key = quadKey(cell.x, cell.y);
      if (!owner.has(key)) set.add(key);
    }
    return set;
  };
  let open = free();
  let guard = open.size * 6 + 2;
  while (open.size && guard-- > 0) {
    let moved = false;
    for (const cell of sortQuads(cells)) {
      if (!open.has(quadKey(cell.x, cell.y))) continue;
      for (const [dx, dy] of [
        [0, 0],
        [-1, 0],
        [0, -1],
        [-1, -1],
      ] as const) {
        const quad: Vec2[] = [];
        const homes = new Set<number>();
        let ok = true;
        for (let y = 0; y < 2 && ok; y++) {
          for (let x = 0; x < 2; x++) {
            const next = { x: cell.x + dx + x, y: cell.y + dy + y };
            const key = quadKey(next.x, next.y);
            const id = owner.get(key);
            quad.push(next);
            if (id !== undefined) homes.add(id);
            else if (!open.has(key)) ok = false;
          }
        }
        if (!ok || homes.size === 0) continue;
        for (const home of homes) {
          const moving = quad.filter((next) => owner.get(quadKey(next.x, next.y)) !== home);
          if (!moving.length) continue;
          if (!canReassign(owner, cells, moving, -1, home)) continue;
          for (const next of moving) {
            const key = quadKey(next.x, next.y);
            open.delete(key);
            owner.set(key, home);
          }
          moved = true;
          break;
        }
        if (moved) break;
      }
      if (moved) break;
    }
    if (!moved) break;
    open = free();
  }
}

function absorbMissing(owner: Map<number, number>, cells: readonly Vec2[]): void {
  const free = new Set<number>();
  for (const cell of cells) {
    const key = quadKey(cell.x, cell.y);
    if (!owner.has(key)) free.add(key);
  }
  let guard = free.size * 4 + 2;
  while (free.size && guard-- > 0) {
    let moved = false;
    for (const cell of sortQuads(cells)) {
      const key = quadKey(cell.x, cell.y);
      if (!free.has(key)) continue;
      for (const [dx, dy] of [
        [0, 0],
        [-1, 0],
        [0, -1],
        [-1, -1],
      ] as const) {
        const need: Vec2[] = [];
        let home = -1;
        let ok = true;
        for (let y = 0; y < 2 && ok; y++) {
          for (let x = 0; x < 2; x++) {
            const next = { x: cell.x + dx + x, y: cell.y + dy + y };
            const id = owner.get(quadKey(next.x, next.y));
            if (id !== undefined) {
              if (home >= 0 && home !== id) ok = false;
              home = id;
            } else if (free.has(quadKey(next.x, next.y))) need.push(next);
            else ok = false;
          }
        }
        if (!ok || home < 0 || !need.length) continue;
        const current = cells.filter((item) => owner.get(quadKey(item.x, item.y)) === home);
        const trial = current.concat(need);
        if (!wardShapeOk(trial)) continue;
        for (const next of need) {
          const nextKey = quadKey(next.x, next.y);
          free.delete(nextKey);
          owner.set(nextKey, home);
        }
        moved = true;
        break;
      }
    }
    if (!moved) break;
  }
}

function packBlocks(cells: readonly Vec2[]): Vec2[][] {
  const free = toKeySet(cells);
  const blocks: Vec2[][] = [];
  const host = new Map<number, number>();
  for (const cell of sortQuads(cells)) {
    if (!free.has(quadKey(cell.x, cell.y))) continue;
    const block: Vec2[] = [];
    let ok = true;
    for (let y = 0; y < 2 && ok; y++) {
      for (let x = 0; x < 2; x++) {
        const next = { x: cell.x + x, y: cell.y + y };
        if (!free.has(quadKey(next.x, next.y))) ok = false;
        else block.push(next);
      }
    }
    if (!ok) continue;
    const id = blocks.length;
    blocks.push(block);
    for (const next of block) {
      const key = quadKey(next.x, next.y);
      free.delete(key);
      host.set(key, id);
    }
  }
  let guard = cells.length + 4;
  while (free.size && guard-- > 0) {
    let moved = false;
    for (const cell of sortQuads(cells)) {
      if (!free.has(quadKey(cell.x, cell.y))) continue;
      for (const [dx, dy] of [
        [0, 0],
        [-1, 0],
        [0, -1],
        [-1, -1],
      ] as const) {
        const need: Vec2[] = [];
        let home = -1;
        let ok = true;
        for (let y = 0; y < 2 && ok; y++) {
          for (let x = 0; x < 2; x++) {
            const next = { x: cell.x + dx + x, y: cell.y + dy + y };
            const key = quadKey(next.x, next.y);
            const owned = host.get(key);
            if (owned !== undefined) {
              if (home >= 0 && home !== owned) ok = false;
              home = owned;
            } else if (free.has(key)) need.push(next);
            else ok = false;
          }
        }
        if (!ok || home < 0 || !need.length) continue;
        if ((blocks[home]?.length ?? 0) + need.length > 10) continue;
        for (const next of need) {
          const key = quadKey(next.x, next.y);
          free.delete(key);
          host.set(key, home);
          blocks[home]!.push(next);
        }
        moved = true;
        break;
      }
    }
    if (!moved) break;
  }
  for (const cell of sortQuads(cells)) {
    if (!free.has(quadKey(cell.x, cell.y))) continue;
    glueLeftover(cell, blocks, free, host);
  }
  return blocks.filter((block) => block.length > 0);
}

/** Pull a leftover into the blocks that complete one of its 2×2s, merging those blocks. */
function glueLeftover(
  cell: Vec2,
  blocks: Vec2[][],
  free: Set<number>,
  host: Map<number, number>,
): void {
  const anchors: ReadonlyArray<readonly [number, number]> = [
    [0, 0],
    [-1, 0],
    [0, -1],
    [-1, -1],
  ];
  for (const [dx, dy] of anchors) {
    const quad: Vec2[] = [];
    const homes = new Set<number>();
    let inside = true;
    for (let y = 0; y < 2 && inside; y++) {
      for (let x = 0; x < 2; x++) {
        const next = { x: cell.x + dx + x, y: cell.y + dy + y };
        const key = quadKey(next.x, next.y);
        quad.push(next);
        const owned = host.get(key);
        if (owned !== undefined) homes.add(owned);
        else if (!free.has(key)) inside = false;
      }
    }
    if (!inside || homes.size === 0) continue;
    const keep = [...homes].sort((a, b) => a - b)[0]!;
    const merged: Vec2[] = [];
    const seen = new Set<number>();
    for (const home of homes) {
      for (const part of blocks[home] ?? []) {
        const key = quadKey(part.x, part.y);
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(part);
      }
    }
    for (const part of quad) {
      const key = quadKey(part.x, part.y);
      if (seen.has(key)) continue;
      if (!free.has(key)) {
        inside = false;
        break;
      }
      seen.add(key);
      merged.push(part);
    }
    if (!inside) continue;
    if (merged.length > 10) continue;
    const box = boundingBox(merged);
    if (box.w > WARD_BOX || box.h > WARD_BOX) continue;
    if (thinnestWidth(merged) < 2 || !isConnected4(merged) || hasHole(merged)) continue;
    for (const home of homes) if (home !== keep) blocks[home] = [];
    blocks[keep] = merged;
    for (const part of merged) {
      const key = quadKey(part.x, part.y);
      free.delete(key);
      host.set(key, keep);
    }
    return;
  }
}

function blockAdjacency(blocks: readonly Vec2[][]): number[][] {
  const at = new Map<number, number>();
  blocks.forEach((block, id) => {
    for (const cell of block) at.set(quadKey(cell.x, cell.y), id);
  });
  const sets = blocks.map(() => new Set<number>());
  for (const [id, block] of blocks.entries()) {
    for (const cell of block) {
      for (const [dx, dy] of CARDINAL) {
        const other = at.get(quadKey(cell.x + dx, cell.y + dy));
        if (other === undefined || other === id) continue;
        sets[id]!.add(other);
        sets[other]!.add(id);
      }
    }
  }
  return sets.map((set) => [...set].sort((a, b) => a - b));
}

function farthestBlockIds(
  blocks: readonly Vec2[][],
  k: number,
  centres: readonly Vec2[],
): number[] {
  const centreOf = (id: number): Vec2 => blocks[id]?.[0] ?? { x: 0, y: 0 };
  const seeds: number[] = [];
  const used = new Set<number>();
  const nearest = (target: Vec2): number => {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < blocks.length; i++) {
      if (used.has(i)) continue;
      const at = centreOf(i);
      const d = (at.x - target.x) ** 2 + (at.y - target.y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  };
  for (const centre of centres) {
    if (seeds.length >= k) break;
    const id = nearest(centre);
    if (used.has(id)) continue;
    seeds.push(id);
    used.add(id);
  }
  if (!seeds.length) {
    seeds.push(0);
    used.add(0);
  }
  while (seeds.length < k) {
    let best = -1;
    let bestD = -1;
    for (let i = 0; i < blocks.length; i++) {
      if (used.has(i)) continue;
      const at = centreOf(i);
      let near = Infinity;
      for (const seed of seeds) {
        const other = centreOf(seed);
        const d = Math.abs(at.x - other.x) + Math.abs(at.y - other.y);
        if (d < near) near = d;
      }
      if (near > bestD) {
        bestD = near;
        best = i;
      }
    }
    if (best < 0) break;
    seeds.push(best);
    used.add(best);
  }
  return seeds;
}

function adjacentOpen(
  ward: number,
  members: readonly number[][],
  adj: readonly (readonly number[])[],
  open: ReadonlySet<number>,
): number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  for (const blockId of members[ward] ?? []) {
    for (const next of adj[blockId] ?? []) {
      if (!open.has(next) || seen.has(next)) continue;
      seen.add(next);
      out.push(next);
    }
  }
  return out;
}

function mergeTiny(owner: Map<number, number>, cells: readonly Vec2[]): void {
  for (let pass = 0; pass < 12; pass++) {
    const wards = groupOwner(owner, cells);
    let changed = false;
    for (const [id, list] of [...wards.entries()].sort((a, b) => a[1].length - b[1].length)) {
      if (list.length >= WARD_MIN && thinnestWidth(list) >= 2 && boundingBox(list).w <= WARD_BOX)
        continue;
      const target = longestSeam(owner, list, id);
      if (target === null) continue;
      if (!canReassign(owner, cells, list, id, target)) continue;
      for (const cell of list) owner.set(quadKey(cell.x, cell.y), target);
      changed = true;
    }
    if (!changed) break;
  }
}

/**
 * Footprints made of aligned 2×2 blocks. Each block is one atom. The smallest
 * ward takes the next adjacent block while the result stays inside the caps.
 * Two blocks are 8 quadrants; three in a row are 12, still inside a 6-wide box.
 */
function clusterAligned(
  cells: readonly Vec2[],
  centres: readonly Vec2[],
  groups: readonly (readonly Vec2[])[] = [],
): Map<number, number> {
  const blocks = fuseGroups(alignedBlocks(cells), groups);
  if (blocks.length <= 1) {
    const owner = new Map<number, number>();
    for (const cell of cells) owner.set(quadKey(cell.x, cell.y), 0);
    return owner;
  }
  const adj = blockAdjacency(blocks);
  const k = Math.max(1, Math.min(blocks.length, Math.round(cells.length / TARGET)));
  const seeds = farthestBlockIds(blocks, Math.min(k, blocks.length), centres);
  const wardOf = new Map<number, number>();
  const body: Vec2[][] = [];
  const members: number[][] = [];
  const take = (blockId: number, ward: number) => {
    wardOf.set(blockId, ward);
    members[ward]!.push(blockId);
    body[ward]!.push(...(blocks[blockId] ?? []));
  };
  for (const seed of seeds) {
    if (wardOf.has(seed)) continue;
    const ward = body.length;
    body.push([]);
    members.push([]);
    take(seed, ward);
  }
  const open = new Set<number>();
  for (let i = 0; i < blocks.length; i++) if (!wardOf.has(i)) open.add(i);
  let guard = blocks.length * 4 + 4;
  while (open.size && guard-- > 0) {
    let ward = -1;
    let best = Infinity;
    for (let i = 0; i < body.length; i++) {
      if (!adjacentOpen(i, members, adj, open).length) continue;
      const size = body[i]!.length;
      if (size < best) {
        best = size;
        ward = i;
      }
    }
    if (ward < 0) {
      const next = [...open].sort((a, b) => a - b)[0];
      if (next === undefined) break;
      const id = body.length;
      body.push([]);
      members.push([]);
      take(next, id);
      open.delete(next);
      continue;
    }
    let picked = -1;
    let pickedD = Infinity;
    const origin = body[ward]?.[0] ?? { x: 0, y: 0 };
    for (const blockId of adjacentOpen(ward, members, adj, open)) {
      const trial = (body[ward] ?? []).concat(blocks[blockId] ?? []);
      if (trial.length > 8) continue;
      const box = boundingBox(trial);
      if (box.w > WARD_BOX || box.h > WARD_BOX) continue;
      if (thinnestWidth(trial) < 2 || !isConnected4(trial) || hasHole(trial)) continue;
      const at = blocks[blockId]?.[0] ?? origin;
      const d = Math.abs(at.x - origin.x) + Math.abs(at.y - origin.y);
      if (d < pickedD) {
        pickedD = d;
        picked = blockId;
      }
    }
    if (picked < 0) {
      members[ward] = [];
      continue;
    }
    take(picked, ward);
    open.delete(picked);
  }
  const owner = new Map<number, number>();
  for (const [blockId, ward] of wardOf) {
    for (const cell of blocks[blockId] ?? []) owner.set(quadKey(cell.x, cell.y), ward);
  }
  pairSmall(owner, cells);
  return owner;
}

function pairSmall(owner: Map<number, number>, cells: readonly Vec2[]): void {
  for (let pass = 0; pass < 10; pass++) {
    const wards = groupOwner(owner, cells);
    let changed = false;
    const ids = [...wards.keys()].sort(
      (a, b) => (wards.get(a)?.length ?? 0) - (wards.get(b)?.length ?? 0),
    );
    for (const id of ids) {
      const list = groupOwner(owner, cells).get(id);
      if (!list || (list.length >= WARD_MIN && thinnestWidth(list) >= 2)) continue;
      const box = boundingBox(list);
      if (list.length >= WARD_MIN && box.w <= WARD_BOX && box.h <= WARD_BOX) continue;
      let best: number | null = null;
      let bestSize = Infinity;
      const seams = new Map<number, number>();
      for (const cell of list) {
        for (const [dx, dy] of CARDINAL) {
          const other = owner.get(quadKey(cell.x + dx, cell.y + dy));
          if (other === undefined || other === id) continue;
          seams.set(other, (seams.get(other) ?? 0) + 1);
        }
      }
      for (const other of seams.keys()) {
        const theirs = cells.filter((cell) => owner.get(quadKey(cell.x, cell.y)) === other);
        const trial = list.concat(theirs);
        if (trial.length > 16) continue;
        const span = boundingBox(trial);
        if (span.w > WARD_BOX || span.h > WARD_BOX) continue;
        if (thinnestWidth(trial) < 2 || !isConnected4(trial) || hasHole(trial)) continue;
        if (theirs.length < bestSize) {
          bestSize = theirs.length;
          best = other;
        }
      }
      if (best === null) continue;
      for (const cell of list) owner.set(quadKey(cell.x, cell.y), best);
      changed = true;
    }
    if (!changed) break;
  }
}

/** Join the aligned blocks a lot, street bundle, wall run, or keep sits on, when that stays legal. */
function fuseGroups(blocks: Vec2[][], groups: readonly (readonly Vec2[])[]): Vec2[][] {
  const at = new Map<number, number>();
  blocks.forEach((block, index) => {
    for (const cell of block) at.set(quadKey(cell.x, cell.y), index);
  });
  const dead = new Set<number>();
  const ordered = groups.slice().sort((a, b) => a.length - b.length);
  for (const group of ordered) {
    const ids = new Set<number>();
    for (const cell of group) {
      const id = at.get(quadKey(cell.x, cell.y));
      if (id !== undefined && !dead.has(id)) ids.add(id);
    }
    if (ids.size <= 1) continue;
    const merged: Vec2[] = [];
    for (const id of ids) merged.push(...(blocks[id] ?? []));
    if (merged.length > 16) continue;
    const box = boundingBox(merged);
    if (box.w > WARD_BOX || box.h > WARD_BOX) continue;
    const keep = [...ids][0]!;
    blocks[keep] = merged;
    for (const id of ids) {
      if (id === keep) continue;
      dead.add(id);
      for (const cell of blocks[id] ?? []) at.set(quadKey(cell.x, cell.y), keep);
      blocks[id] = [];
    }
  }
  return blocks.filter((block) => block.length > 0);
}

function alignedBlocks(cells: readonly Vec2[]): Vec2[][] {
  const groups = new Map<string, Vec2[]>();
  for (const cell of cells) {
    const bx = Math.floor(cell.x / 2) * 2;
    const by = Math.floor(cell.y / 2) * 2;
    const key = `${bx},${by}`;
    let list = groups.get(key);
    if (!list) {
      list = [];
      groups.set(key, list);
    }
    list.push(cell);
  }
  return [...groups.values()].sort((a, b) => a[0]!.y - b[0]!.y || a[0]!.x - b[0]!.x);
}

function growPartition(
  cells: readonly Vec2[],
  _groups: Vec2[][],
  centres: readonly Vec2[],
  _split: boolean,
): Map<number, number> {
  const aligned = clusterAligned(cells, centres, _groups);
  if (partitionValid(cells, aligned, [], false)) return aligned;
  const mono = monoPartition(cells, centres);
  if (partitionValid(cells, mono, [], false)) return mono;
  const blocked = clusterPartition(cells, centres);
  if (partitionValid(cells, blocked, [], false)) return blocked;
  const strips = stripPartition(cells);
  if (partitionValid(cells, strips, [], false)) return strips;
  return mono;
}

/**
 * Balanced growth that never splits a 2×2. Once three quadrants of a 2×2 that
 * sits in F belong to a ward, the fourth is claimed too. Every ward cell then
 * sits in a monochrome 2×2, which is the width rule.
 */
function monoPartition(cells: readonly Vec2[], centres: readonly Vec2[]): Map<number, number> {
  const present = toKeySet(cells);
  const quads = fullQuads(cells, present);
  const owner = new Map<number, number>();
  const wards: Vec2[][] = [];
  const free = toKeySet(cells);
  const claim = (ward: number, cell: Vec2) => {
    const key = quadKey(cell.x, cell.y);
    if (!free.has(key)) return;
    free.delete(key);
    owner.set(key, ward);
    wards[ward]!.push(cell);
  };
  const closure = (ward: number): Vec2[] | null => {
    const extra: Vec2[] = [];
    const seen = new Set<number>();
    let guard = cells.length;
    let grew = true;
    while (grew && guard-- > 0) {
      grew = false;
      for (const quad of quads) {
        let home = -1;
        const need: Vec2[] = [];
        let ok = true;
        for (const cell of quad) {
          const id = owner.get(quadKey(cell.x, cell.y));
          if (id === ward) home = ward;
          else if (id === undefined && free.has(quadKey(cell.x, cell.y))) need.push(cell);
          else if (id === undefined) ok = false;
          else {
            ok = false;
            home = -2;
          }
        }
        if (!ok || home !== ward || !need.length) continue;
        for (const cell of need) {
          const key = quadKey(cell.x, cell.y);
          if (seen.has(key)) continue;
          seen.add(key);
          extra.push(cell);
          // Tentatively visible to later quads in this sweep.
          owner.set(key, ward);
          free.delete(key);
          grew = true;
        }
      }
    }
    if (!extra.length) return [];
    const trial = (wards[ward] ?? []).concat(extra);
    if (!wardShapeOk(trial) && trial.length >= WARD_MIN) {
      // Over the cap: roll the tentative claims back.
      if (
        trial.length > WARD_MAX ||
        boundingBox(trial).w > WARD_BOX ||
        boundingBox(trial).h > WARD_BOX
      ) {
        for (const cell of extra) {
          const key = quadKey(cell.x, cell.y);
          owner.delete(key);
          free.add(key);
        }
        return null;
      }
    }
    if (thinnestWidth(trial) < 2 || !isConnected4(trial) || hasHole(trial)) {
      for (const cell of extra) {
        const key = quadKey(cell.x, cell.y);
        owner.delete(key);
        free.add(key);
      }
      return null;
    }
    if (
      trial.length > WARD_MAX ||
      boundingBox(trial).w > WARD_BOX ||
      boundingBox(trial).h > WARD_BOX
    ) {
      for (const cell of extra) {
        const key = quadKey(cell.x, cell.y);
        owner.delete(key);
        free.add(key);
      }
      return null;
    }
    return extra;
  };
  const seeds = farthestCells(cells, Math.max(1, Math.round(cells.length / TARGET)), centres);
  for (const seed of seeds) {
    if (!free.has(quadKey(seed.x, seed.y))) continue;
    let placed = false;
    for (const quad of quads) {
      if (!quad.some((cell) => cell.x === seed.x && cell.y === seed.y)) continue;
      if (quad.some((cell) => !free.has(quadKey(cell.x, cell.y)))) continue;
      const id = wards.length;
      wards.push([]);
      for (const cell of quad) claim(id, cell);
      placed = true;
      break;
    }
    if (!placed && free.has(quadKey(seed.x, seed.y))) {
      const id = wards.length;
      wards.push([]);
      claim(id, seed);
    }
  }
  if (!wards.length && cells.length) {
    wards.push([]);
    claim(0, cells[0]!);
  }
  let guard = cells.length * 2;
  while (free.size && guard-- > 0) {
    let ward = -1;
    let bestSize = Infinity;
    for (let i = 0; i < wards.length; i++) {
      if ((wards[i]?.length ?? 0) >= WARD_MAX) continue;
      if ((wards[i]?.length ?? 0) < bestSize) {
        bestSize = wards[i]!.length;
        ward = i;
      }
    }
    if (ward < 0) break;
    const touch: Vec2[] = [];
    for (const cell of wards[ward] ?? []) {
      for (const [dx, dy] of CARDINAL) {
        const next = { x: cell.x + dx, y: cell.y + dy };
        if (free.has(quadKey(next.x, next.y))) touch.push(next);
      }
    }
    touch.sort((a, b) => a.y - b.y || a.x - b.x);
    let took = false;
    for (const cell of touch) {
      if (!free.has(quadKey(cell.x, cell.y))) continue;
      claim(ward, cell);
      const extra = closure(ward);
      if (extra === null) {
        const key = quadKey(cell.x, cell.y);
        owner.delete(key);
        free.add(key);
        wards[ward] = (wards[ward] ?? []).filter((item) => item.x !== cell.x || item.y !== cell.y);
        continue;
      }
      for (const added of extra) wards[ward]!.push(added);
      took = true;
      break;
    }
    if (!took) {
      // Nothing legal touches this ward. Stop considering it by filling it to the cap flag.
      if ((wards[ward]?.length ?? 0) < WARD_MAX) wards[ward]!.push({ x: 1e9, y: 1e9 });
      else break;
    }
  }
  for (const list of wards) {
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i]!.x > 1e8) list.splice(i, 1);
    }
  }
  mergeTiny(owner, cells);
  return owner;
}

function fullQuads(cells: readonly Vec2[], present: ReadonlySet<number>): Vec2[][] {
  const quads: Vec2[][] = [];
  const seen = new Set<string>();
  for (const cell of cells) {
    for (const [dx, dy] of [
      [0, 0],
      [-1, 0],
      [0, -1],
      [-1, -1],
    ] as const) {
      const anchor = { x: cell.x + dx, y: cell.y + dy };
      const key = `${anchor.x},${anchor.y}`;
      if (seen.has(key)) continue;
      const quad: Vec2[] = [];
      let ok = true;
      for (let y = 0; y < 2 && ok; y++) {
        for (let x = 0; x < 2; x++) {
          const next = { x: anchor.x + x, y: anchor.y + y };
          if (!present.has(quadKey(next.x, next.y))) ok = false;
          else quad.push(next);
        }
      }
      if (!ok) continue;
      seen.add(key);
      quads.push(quad);
    }
  }
  return quads;
}

/** Two-row bands cut into runs of 3–4 columns. Tried at both row phases. */
function stripPartition(cells: readonly Vec2[]): Map<number, number> {
  let best: Map<number, number> | null = null;
  let bestMissing = Infinity;
  for (const phase of [0, 1]) {
    const owner = stripPhase(cells, phase);
    const missing = cells.reduce(
      (count, cell) => count + (owner.has(quadKey(cell.x, cell.y)) ? 0 : 1),
      0,
    );
    if (missing < bestMissing) {
      best = owner;
      bestMissing = missing;
    }
    if (partitionValid(cells, owner, [], false)) return owner;
  }
  return best ?? new Map();
}

function stripPhase(cells: readonly Vec2[], phase: number): Map<number, number> {
  const set = toKeySet(cells);
  const box = boundingBox(cells);
  const owner = new Map<number, number>();
  let ward = 0;
  const y0 = box.y0 + phase;
  for (let y = y0; y <= box.y1; y += 2) {
    let x = box.x0;
    while (x <= box.x1) {
      const column = (xx: number): Vec2[] => {
        const out: Vec2[] = [];
        for (const yy of [y, y + 1]) {
          if (set.has(quadKey(xx, yy)) && !owner.has(quadKey(xx, yy))) out.push({ x: xx, y: yy });
        }
        return out;
      };
      while (x <= box.x1 && column(x).length < 2) x++;
      if (x > box.x1) break;
      const run: Vec2[] = [];
      let columns = 0;
      while (x <= box.x1 && columns < 4) {
        const col = column(x);
        if (col.length < 2) break;
        run.push(...col);
        x++;
        columns++;
      }
      if (run.length < WARD_MIN) {
        for (const cell of run) owner.delete(quadKey(cell.x, cell.y));
        continue;
      }
      for (const cell of run) owner.set(quadKey(cell.x, cell.y), ward);
      ward++;
    }
  }
  absorbMissing(owner, cells);
  stealNotches(owner, cells);
  mergeTiny(owner, cells);
  absorbMissing(owner, cells);
  return owner;
}

/**
 * Farthest-point seeds, then balanced growth. A ward only accepts a quadrant
 * (or a protected group) when the ward stays 4-connected, hole-free, at least
 * two quadrants thick, inside a 6×6 box, and at most 18 quadrants.
 */
function growFat(
  cells: readonly Vec2[],
  groups: readonly Vec2[][],
  centres: readonly Vec2[],
  minWards = 1,
): Map<number, number> {
  const free = toKeySet(cells);
  const groupOf = new Map<number, Vec2[]>();
  for (const group of groups) {
    const kept = group.filter((cell) => free.has(quadKey(cell.x, cell.y)));
    if (kept.length < 2) continue;
    for (const cell of kept) groupOf.set(quadKey(cell.x, cell.y), kept);
  }
  const k = Math.max(minWards, Math.min(cells.length, Math.round(cells.length / TARGET)));
  const seeds = farthestCells(cells, k, centres);
  const wards: Vec2[][] = [];
  const seedAt: Vec2[] = [];
  const owner = new Map<number, number>();
  const take = (ward: number, extra: readonly Vec2[]) => {
    const list = wards[ward] ?? [];
    for (const cell of extra) {
      const key = quadKey(cell.x, cell.y);
      if (!free.has(key)) continue;
      free.delete(key);
      owner.set(key, ward);
      list.push(cell);
    }
    wards[ward] = list;
  };
  for (const seed of seeds) {
    if (!free.has(quadKey(seed.x, seed.y))) continue;
    const block = seedClaim(seed, free, groupOf);
    if (!block) continue;
    const id = wards.length;
    wards.push([]);
    seedAt.push(seed);
    take(id, block);
  }
  if (!wards.length) {
    const only = seedClaim(cells[0] ?? { x: 0, y: 0 }, free, groupOf) ?? cells.slice(0, 1);
    wards.push([]);
    seedAt.push(only[0] ?? { x: 0, y: 0 });
    take(0, only);
  }
  const growRound = (relaxed: boolean) => {
    let guard = cells.length * 3;
    while (free.size && guard-- > 0) {
      const ward = smallestExtendable(wards, free, groupOf, seedAt, relaxed);
      if (ward < 0) break;
      const add = bestFatAdd(
        wards[ward] ?? [],
        seedAt[ward] ?? { x: 0, y: 0 },
        free,
        groupOf,
        relaxed,
      );
      if (!add) break;
      take(ward, add);
    }
  };
  growRound(false);
  growRound(true);
  // Gaps between capped wards become their own wards when a 2×2 still fits.
  let spawned = 0;
  while (free.size && spawned < 24) {
    const seed = leftmostFree(cells, free);
    if (!seed) break;
    const block = seedClaim(seed, free, groupOf);
    if (!block) break;
    const id = wards.length;
    wards.push([]);
    seedAt.push(seed);
    take(id, block);
    spawned++;
    growRound(true);
  }
  return owner;
}

function leftmostFree(cells: readonly Vec2[], free: ReadonlySet<number>): Vec2 | null {
  for (const cell of sortQuads(cells)) {
    if (free.has(quadKey(cell.x, cell.y))) return cell;
  }
  return null;
}

function farthestCells(cells: readonly Vec2[], k: number, centres: readonly Vec2[]): Vec2[] {
  const seeds: Vec2[] = [];
  const used = new Set<number>();
  const pick = (target: Vec2): Vec2 | null => {
    let best: Vec2 | null = null;
    let bestD = Infinity;
    for (const cell of cells) {
      const key = quadKey(cell.x, cell.y);
      if (used.has(key)) continue;
      const d = (cell.x - target.x) ** 2 + (cell.y - target.y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = cell;
      }
    }
    return best;
  };
  for (const centre of centres) {
    if (seeds.length >= k) break;
    const cell = pick(centre);
    if (!cell) break;
    seeds.push(cell);
    used.add(quadKey(cell.x, cell.y));
  }
  if (!seeds.length && cells.length) {
    const first = sortQuads(cells)[0]!;
    seeds.push(first);
    used.add(quadKey(first.x, first.y));
  }
  while (seeds.length < k) {
    let best: Vec2 | null = null;
    let bestD = -1;
    for (const cell of cells) {
      if (used.has(quadKey(cell.x, cell.y))) continue;
      let near = Infinity;
      for (const seed of seeds) {
        const d = Math.abs(cell.x - seed.x) + Math.abs(cell.y - seed.y);
        if (d < near) near = d;
      }
      if (near > bestD) {
        bestD = near;
        best = cell;
      }
    }
    if (!best) break;
    seeds.push(best);
    used.add(quadKey(best.x, best.y));
  }
  return seeds;
}

function seedClaim(
  seed: Vec2,
  free: ReadonlySet<number>,
  groupOf: Map<number, Vec2[]>,
): Vec2[] | null {
  const group = groupOf.get(quadKey(seed.x, seed.y));
  if (group && group.every((cell) => free.has(quadKey(cell.x, cell.y)))) {
    const fat = fatten(group, free, new Set(group.map((cell) => quadKey(cell.x, cell.y))));
    if (
      fat &&
      boundingBox(fat).w <= WARD_BOX &&
      boundingBox(fat).h <= WARD_BOX &&
      fat.length <= WARD_MAX
    ) {
      return fat;
    }
  }
  for (const [dx, dy] of [
    [0, 0],
    [-1, 0],
    [0, -1],
    [-1, -1],
  ] as const) {
    const block: Vec2[] = [];
    let ok = true;
    for (let y = 0; y < 2 && ok; y++) {
      for (let x = 0; x < 2; x++) {
        const cell = { x: seed.x + dx + x, y: seed.y + dy + y };
        if (!free.has(quadKey(cell.x, cell.y))) ok = false;
        else block.push(cell);
      }
    }
    if (!ok) continue;
    const withGroups = pullGroups(block, free, groupOf);
    const fat = fatten(
      withGroups,
      free,
      new Set(withGroups.map((cell) => quadKey(cell.x, cell.y))),
    );
    if (
      fat &&
      fat.length <= WARD_MAX &&
      boundingBox(fat).w <= WARD_BOX &&
      boundingBox(fat).h <= WARD_BOX
    ) {
      return fat;
    }
  }
  return null;
}

function pullGroups(
  cells: readonly Vec2[],
  free: ReadonlySet<number>,
  groupOf: Map<number, Vec2[]>,
): Vec2[] {
  const out = new Map<number, Vec2>();
  for (const cell of cells) {
    const group = groupOf.get(quadKey(cell.x, cell.y));
    const members = group ?? [cell];
    if (
      members.some(
        (member) => !free.has(quadKey(member.x, member.y)) && !out.has(quadKey(member.x, member.y)),
      )
    ) {
      continue;
    }
    for (const member of members) {
      if (free.has(quadKey(member.x, member.y))) out.set(quadKey(member.x, member.y), member);
    }
  }
  return [...out.values()];
}

/**
 * Add free quadrants until every claimed cell sits in a 2×2. A thin cell is
 * covered by claiming the rest of one 2×2 that contains it, when those
 * quadrants are still free.
 */
function fatten(
  base: readonly Vec2[],
  free: ReadonlySet<number>,
  claimed: Set<number>,
): Vec2[] | null {
  const cells = base.slice();
  for (let guard = 0; guard < 16; guard++) {
    if (thinnestWidth(cells) >= 2 && isConnected4(cells) && !hasHole(cells)) return cells;
    let added = false;
    for (const cell of cells) {
      if (inWard2x2(cell, claimed)) continue;
      for (const [dx, dy] of [
        [0, 0],
        [-1, 0],
        [0, -1],
        [-1, -1],
      ] as const) {
        const block: Vec2[] = [];
        let ok = true;
        for (let y = 0; y < 2 && ok; y++) {
          for (let x = 0; x < 2; x++) {
            const next = { x: cell.x + dx + x, y: cell.y + dy + y };
            const key = quadKey(next.x, next.y);
            if (claimed.has(key)) continue;
            if (!free.has(key)) {
              ok = false;
              break;
            }
            block.push(next);
          }
        }
        if (!ok || !block.length) continue;
        for (const next of block) claimed.add(quadKey(next.x, next.y));
        cells.push(...block);
        added = true;
        break;
      }
      if (added) break;
    }
    if (!added) return null;
  }
  return thinnestWidth(cells) >= 2 && isConnected4(cells) && !hasHole(cells) ? cells : null;
}

function inWard2x2(cell: Vec2, set: ReadonlySet<number>): boolean {
  for (const [dx, dy] of [
    [0, 0],
    [-1, 0],
    [0, -1],
    [-1, -1],
  ] as const) {
    const x = cell.x + dx;
    const y = cell.y + dy;
    if (
      set.has(quadKey(x, y)) &&
      set.has(quadKey(x + 1, y)) &&
      set.has(quadKey(x, y + 1)) &&
      set.has(quadKey(x + 1, y + 1))
    ) {
      return true;
    }
  }
  return false;
}

function smallestExtendable(
  wards: readonly Vec2[][],
  free: ReadonlySet<number>,
  groupOf: Map<number, Vec2[]>,
  seeds: readonly Vec2[],
  relaxed: boolean,
): number {
  let best = -1;
  let bestSize = Infinity;
  for (let i = 0; i < wards.length; i++) {
    const list = wards[i] ?? [];
    if (!relaxed && list.length >= TARGET) continue;
    if (list.length >= WARD_MAX) continue;
    if (!bestFatAdd(list, seeds[i] ?? list[0] ?? { x: 0, y: 0 }, free, groupOf, relaxed)) continue;
    if (list.length < bestSize) {
      bestSize = list.length;
      best = i;
    }
  }
  return best;
}

function bestFatAdd(
  ward: readonly Vec2[],
  seed: Vec2,
  free: ReadonlySet<number>,
  groupOf: Map<number, Vec2[]>,
  relaxed: boolean,
): Vec2[] | null {
  if (!ward.length) return null;
  const touch = new Map<number, Vec2>();
  for (const cell of ward) {
    for (const [dx, dy] of CARDINAL) {
      const next = { x: cell.x + dx, y: cell.y + dy };
      const key = quadKey(next.x, next.y);
      if (!free.has(key)) continue;
      touch.set(key, next);
    }
  }
  const cap = relaxed ? WARD_MAX : TARGET;
  let best: Vec2[] | null = null;
  let bestD = Infinity;
  for (const cell of touch.values()) {
    const add = proposeAdd(ward, cell, free, groupOf, cap);
    if (!add) continue;
    const d = Math.abs(cell.x - seed.x) + Math.abs(cell.y - seed.y);
    if (d < bestD) {
      bestD = d;
      best = add;
    }
  }
  return best;
}

function proposeAdd(
  ward: readonly Vec2[],
  cell: Vec2,
  free: ReadonlySet<number>,
  groupOf: Map<number, Vec2[]>,
  cap: number,
): Vec2[] | null {
  const wanted = new Map<number, Vec2>();
  const queue = [cell];
  while (queue.length) {
    const cur = queue.pop()!;
    const key = quadKey(cur.x, cur.y);
    if (wanted.has(key)) continue;
    if (!free.has(key)) return null;
    wanted.set(key, cur);
    const group = groupOf.get(key);
    if (!group) continue;
    for (const member of group) queue.push(member);
  }
  const base = [...wanted.values()];
  const claimed = new Set<number>(ward.map((item) => quadKey(item.x, item.y)));
  for (const item of base) claimed.add(quadKey(item.x, item.y));
  const fat = fatten(ward.concat(base), free, claimed);
  if (!fat) return null;
  const extra = fat.filter((item) => !ward.some((have) => have.x === item.x && have.y === item.y));
  if (extra.length === 0) return null;
  if (ward.length + extra.length > cap || ward.length + extra.length > WARD_MAX) return null;
  const box = boundingBox(ward.concat(extra));
  if (box.w > WARD_BOX || box.h > WARD_BOX) return null;
  if (thinnestWidth(ward.concat(extra)) < 2) return null;
  if (!isConnected4(ward.concat(extra)) || hasHole(ward.concat(extra))) return null;
  for (const item of extra) if (!free.has(quadKey(item.x, item.y))) return null;
  return extra;
}

function stabilize(
  cells: readonly Vec2[],
  initial: Map<number, number>,
  groups: Vec2[][],
  centres: readonly Vec2[],
  fallbackMode: boolean,
): { owner: Map<number, number>; passes: number } {
  const owner = new Map(initial);
  const seen = new Set<string>();
  let passes = 0;
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const sig = signature(owner);
    if (seen.has(sig)) break;
    seen.add(sig);
    const { atoms, atomOf } = buildAtoms(cells, groups);
    let changed = false;
    if (explodeComponents(owner, cells)) changed = true;
    if (absorbSlivers(owner, cells, atoms, atomOf)) changed = true;
    if (mergeWeak(owner, cells)) changed = true;
    if (splitStrong(owner, cells, centres, groups)) changed = true;
    if (repairAtoms(owner, cells, groups)) changed = true;
    if (!changed) break;
    passes++;
  }
  if (fallbackMode) {
    // The grid cut already happened; atom repair must stick even on a stable grid.
    repairAtoms(owner, cells, groups);
  }
  return { owner, passes };
}

function finish(
  cells: readonly Vec2[],
  owner: Map<number, number>,
  passes: number,
  fallback: boolean,
  groups: Vec2[][],
): CutResult {
  repairAtoms(owner, cells, groups);
  const wards = compactWards(cells, owner);
  const warnings = collectWarnings(cells, wards, groups);
  return { quadrants: [...cells], wards, passes, fallback, warnings };
}

function collectWarnings(cells: readonly Vec2[], wards: CutWard[], groups: Vec2[][]): CutWarning[] {
  const warnings: CutWarning[] = [];
  const owner = new Map<number, number>();
  for (const ward of wards) {
    for (const cell of ward.quadrants) owner.set(quadKey(cell.x, cell.y), ward.wardId);
  }
  for (const cell of cells) {
    const id = owner.get(quadKey(cell.x, cell.y));
    if (id === undefined) {
      warnings.push({
        kind: 'invariant',
        x: cell.x,
        y: cell.y,
        message: 'quadrant is outside every ward',
      });
      continue;
    }
    const counts = neighbourWardCounts(cell, owner, id);
    for (const count of counts.values()) {
      if (count >= 3) {
        warnings.push({
          kind: 'sliver',
          x: cell.x,
          y: cell.y,
          message: 'quadrant has 3 neighbours in another ward',
        });
        break;
      }
    }
  }
  for (const ward of wards) {
    const box = boundingBox(ward.quadrants);
    if (
      ward.quadrants.length < WARD_MIN ||
      ward.quadrants.length > WARD_MAX ||
      box.w > WARD_BOX ||
      box.h > WARD_BOX ||
      thinnestWidth(ward.quadrants) < 2 ||
      !isConnected4(ward.quadrants) ||
      hasHole(ward.quadrants)
    ) {
      const at = ward.quadrants[0] ?? { x: 0, y: 0 };
      warnings.push({
        kind: 'invariant',
        x: at.x,
        y: at.y,
        message: `ward ${ward.wardId} breaks size, shape, or connectivity`,
      });
    }
  }
  for (const group of groups) {
    const ids = new Set<number>();
    for (const cell of group) {
      const id = owner.get(quadKey(cell.x, cell.y));
      if (id !== undefined) ids.add(id);
    }
    if (ids.size > 1) {
      const at = group[0]!;
      warnings.push({
        kind: 'invariant',
        x: at.x,
        y: at.y,
        message: 'a lot, street, wall, or keep is split across wards',
      });
    }
  }
  return warnings;
}

function shapeProblems(cells: readonly Vec2[], owner: Map<number, number>): string {
  let missing = 0;
  for (const cell of cells) if (!owner.has(quadKey(cell.x, cell.y))) missing++;
  if (missing) return `missing ${missing}`;
  const wards = groupOwner(owner, cells);
  for (const [id, list] of wards) {
    const box = boundingBox(list);
    if (!isConnected4(list)) return `ward ${id} split`;
    if (hasHole(list)) return `ward ${id} hole`;
    if (thinnestWidth(list) < 2) return `ward ${id} thin`;
    if (box.w > WARD_BOX || box.h > WARD_BOX) return `ward ${id} box ${box.w}x${box.h}`;
    if (list.length < WARD_MIN || list.length > WARD_MAX) return `ward ${id} size ${list.length}`;
    for (const cell of list) {
      for (const count of neighbourWardCounts(cell, owner, id).values()) {
        if (count >= 3) return `sliver ${cell.x},${cell.y}`;
      }
    }
  }
  if (!graphConnected(wards, owner)) return 'graph';
  return 'ok';
}

function partitionValid(
  cells: readonly Vec2[],
  owner: Map<number, number>,
  groups: Vec2[][],
  allowWeak: boolean,
): boolean {
  if (allowWeak) return false;
  if (shapeProblems(cells, owner) !== 'ok') return false;
  for (const group of groups) {
    let id: number | null = null;
    for (const cell of group) {
      const got = owner.get(quadKey(cell.x, cell.y));
      if (got === undefined) continue;
      if (id === null) id = got;
      else if (id !== got) return false;
    }
  }
  return true;
}

function graphConnected(wards: Map<number, Vec2[]>, owner: Map<number, number>): boolean {
  const ids = [...wards.keys()];
  if (ids.length <= 1) return true;
  const seen = new Set<number>([ids[0]!]);
  const stack = [ids[0]!];
  while (stack.length) {
    const id = stack.pop()!;
    const list = wards.get(id) ?? [];
    const next = new Set<number>();
    for (const cell of list) {
      for (const [dx, dy] of CARDINAL) {
        const other = owner.get(quadKey(cell.x + dx, cell.y + dy));
        if (other !== undefined && other !== id) next.add(other);
      }
    }
    for (const other of next) {
      if (seen.has(other)) continue;
      seen.add(other);
      stack.push(other);
    }
  }
  return seen.size === ids.length;
}

function neighbourWardCounts(
  cell: Vec2,
  owner: Map<number, number>,
  self: number,
): Map<number, number> {
  const counts = new Map<number, number>();
  for (const [dx, dy] of CARDINAL) {
    const id = owner.get(quadKey(cell.x + dx, cell.y + dy));
    if (id === undefined || id === self) continue;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

function absorbSlivers(
  owner: Map<number, number>,
  cells: readonly Vec2[],
  atoms: Atom[],
  atomOf: Map<number, number>,
): boolean {
  let changed = false;
  const seen = new Set<number>();
  for (const cell of sortQuads(cells)) {
    const atomId = atomOf.get(quadKey(cell.x, cell.y));
    if (atomId === undefined || seen.has(atomId)) continue;
    seen.add(atomId);
    const atom = atoms[atomId];
    if (!atom) continue;
    const current = owner.get(quadKey(atom.cells[0]!.x, atom.cells[0]!.y));
    if (current === undefined) continue;
    let target: number | null = null;
    for (const part of atom.cells) {
      const counts = neighbourWardCounts(part, owner, current);
      for (const [id, count] of counts) {
        if (count >= 3) target = id;
      }
    }
    if (target === null) continue;
    if (!canReassign(owner, cells, atom.cells, current, target)) continue;
    for (const part of atom.cells) owner.set(quadKey(part.x, part.y), target);
    changed = true;
  }
  return changed;
}

function mergeWeak(owner: Map<number, number>, cells: readonly Vec2[]): boolean {
  const wards = groupOwner(owner, cells);
  if (wards.size <= 1) return false;
  let changed = false;
  const ids = [...wards.keys()].sort((a, b) => a - b);
  for (const id of ids) {
    const list = groupOwner(owner, cells).get(id);
    if (!list) continue;
    const box = boundingBox(list);
    const shapeBad =
      list.length < WARD_MIN || thinnestWidth(list) < 2 || !isConnected4(list) || hasHole(list);
    if (!shapeBad) continue;
    // Oversized wards are re-split. A small ward with a wide box still merges.
    if (list.length > WARD_MAX && box.w <= WARD_BOX && box.h <= WARD_BOX) continue;
    if (list.length > WARD_MAX) continue;
    const target = longestSeam(owner, list, id);
    if (target === null) continue;
    if (!canReassign(owner, cells, list, id, target)) continue;
    for (const cell of list) owner.set(quadKey(cell.x, cell.y), target);
    changed = true;
  }
  return changed;
}

function splitStrong(
  owner: Map<number, number>,
  cells: readonly Vec2[],
  centres: readonly Vec2[],
  groups: Vec2[][],
): boolean {
  const wards = groupOwner(owner, cells);
  if (wards.size === 0) return false;
  let changed = false;
  let nextId = 0;
  for (const id of owner.values()) if (id >= nextId) nextId = id + 1;
  for (const [id, list] of [...wards.entries()].sort((a, b) => a[0] - b[0])) {
    const box = boundingBox(list);
    if (list.length <= WARD_MAX && box.w <= WARD_BOX && box.h <= WARD_BOX) continue;
    const localGroups = groups
      .map((group) => group.filter((cell) => owner.get(quadKey(cell.x, cell.y)) === id))
      .filter((group) => group.length > 1);
    const localCentres = centres.filter((centre) =>
      list.some((cell) => Math.abs(cell.x - centre.x) + Math.abs(cell.y - centre.y) <= 1),
    );
    const assigned = growFat(list, localGroups, localCentres, 2);
    const locals = new Set<number>();
    for (const local of assigned.values()) locals.add(local);
    if (locals.size < 2) continue;
    const remap = new Map<number, number>();
    for (const cell of list) {
      const local = assigned.get(quadKey(cell.x, cell.y)) ?? 0;
      let ward = remap.get(local);
      if (ward === undefined) {
        ward = remap.size === 0 ? id : nextId++;
        remap.set(local, ward);
      }
      owner.set(quadKey(cell.x, cell.y), ward);
    }
    changed = true;
  }
  return changed;
}

/**
 * A group (lot, street bundle, wall run, keep) that landed in several wards
 * moves entirely onto the ward that already holds the longest shared edge.
 */
function repairAtoms(
  owner: Map<number, number>,
  cells: readonly Vec2[],
  groups: Vec2[][],
): boolean {
  let changed = false;
  for (const group of groups) {
    const counts = new Map<number, number>();
    for (const cell of group) {
      const id = owner.get(quadKey(cell.x, cell.y));
      if (id === undefined) continue;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    if (counts.size <= 1) continue;
    let best = -1;
    let bestN = -1;
    for (const [id, count] of counts) {
      const size = wardSize(owner, id);
      if (count > bestN || (count === bestN && (best < 0 || size < wardSize(owner, best)))) {
        best = id;
        bestN = count;
      }
    }
    if (best < 0) continue;
    if (!canReassign(owner, cells, group, -1, best)) continue;
    for (const cell of group) owner.set(quadKey(cell.x, cell.y), best);
    changed = true;
  }
  return changed;
}

function canReassign(
  owner: Map<number, number>,
  cells: readonly Vec2[],
  moving: readonly Vec2[],
  from: number,
  to: number,
): boolean {
  if (from === to) return false;
  const movingKeys = new Set(moving.map((cell) => quadKey(cell.x, cell.y)));
  const donors = new Set<number>();
  for (const cell of moving) {
    const id = owner.get(quadKey(cell.x, cell.y));
    if (id !== undefined && id !== to) donors.add(id);
  }
  if (from >= 0) donors.add(from);
  for (const donor of donors) {
    const source = cells.filter(
      (cell) =>
        owner.get(quadKey(cell.x, cell.y)) === donor && !movingKeys.has(quadKey(cell.x, cell.y)),
    );
    if (!source.length) continue;
    // A donor may drop under the minimum; the tiny-ward merge picks it up.
    // It still has to stay fat, connected, and inside the box.
    if (thinnestWidth(source) < 2 || !isConnected4(source) || hasHole(source)) return false;
    const box = boundingBox(source);
    if (box.w > WARD_BOX || box.h > WARD_BOX || source.length > WARD_MAX) return false;
  }
  const target = cells.filter(
    (cell) => owner.get(quadKey(cell.x, cell.y)) === to || movingKeys.has(quadKey(cell.x, cell.y)),
  );
  if (!wardShapeOk(target)) return false;
  return true;
}

function wardShapeOk(cells: readonly Vec2[]): boolean {
  if (cells.length < WARD_MIN || cells.length > WARD_MAX) return false;
  const box = boundingBox(cells);
  if (box.w > WARD_BOX || box.h > WARD_BOX) return false;
  if (thinnestWidth(cells) < 2 || !isConnected4(cells) || hasHole(cells)) return false;
  return true;
}

/** Give each 4-connected piece of a ward its own id so a split ward can merge cleanly. */
function explodeComponents(owner: Map<number, number>, cells: readonly Vec2[]): boolean {
  const wards = groupOwner(owner, cells);
  let changed = false;
  let nextId = 0;
  for (const id of owner.values()) if (id >= nextId) nextId = id + 1;
  for (const [id, list] of wards) {
    const parts = components4(list);
    if (parts.length <= 1) continue;
    for (let i = 1; i < parts.length; i++) {
      const fresh = nextId++;
      for (const cell of parts[i]!) owner.set(quadKey(cell.x, cell.y), fresh);
      changed = true;
    }
    void id;
  }
  return changed;
}

function longestSeam(
  owner: Map<number, number>,
  list: readonly Vec2[],
  self: number,
): number | null {
  const seams = new Map<number, number>();
  for (const cell of list) {
    for (const [dx, dy] of CARDINAL) {
      const other = owner.get(quadKey(cell.x + dx, cell.y + dy));
      if (other === undefined || other === self) continue;
      seams.set(other, (seams.get(other) ?? 0) + 1);
    }
  }
  let best: number | null = null;
  let bestLen = -1;
  let bestSize = Infinity;
  for (const [id, len] of seams) {
    const size = wardSize(owner, id);
    if (
      len > bestLen ||
      (len === bestLen && size < bestSize) ||
      (len === bestLen && size === bestSize && (best === null || id < best))
    ) {
      best = id;
      bestLen = len;
      bestSize = size;
    }
  }
  return best;
}

function wardSize(owner: Map<number, number>, id: number): number {
  let n = 0;
  for (const ward of owner.values()) if (ward === id) n++;
  return n;
}

function gridOwner(cells: readonly Vec2[]): Map<number, number> {
  const owner = new Map<number, number>();
  const ids = new Map<number, number>();
  let next = 0;
  for (const cell of sortQuads(cells)) {
    const gx = Math.floor(cell.x / 4);
    const gy = Math.floor(cell.y / 4);
    const gk = gx * KEY_SPAN + gy + KEY_BIAS;
    let id = ids.get(gk);
    if (id === undefined) {
      id = next++;
      ids.set(gk, id);
    }
    owner.set(quadKey(cell.x, cell.y), id);
  }
  return owner;
}

const KEY_BIAS = 4096;
const KEY_SPAN = 8192;

/**
 * Last resort after the 4×4 grid still breaks an invariant: grow compact
 * blobs of about 12 quadrants straight off the footprint.
 */
function forceBlobs(cells: readonly Vec2[], groups: Vec2[][]): Map<number, number> {
  const remaining = toKeySet(cells);
  const owner = new Map<number, number>();
  let ward = 0;
  const byKey = new Map<number, Vec2>();
  for (const cell of cells) byKey.set(quadKey(cell.x, cell.y), cell);
  for (const cell of sortQuads(cells)) {
    const startKey = quadKey(cell.x, cell.y);
    if (!remaining.has(startKey)) continue;
    const claimed: Vec2[] = [];
    const queue: Vec2[] = [cell];
    remaining.delete(startKey);
    claimed.push(cell);
    while (queue.length && claimed.length < TARGET) {
      const cur = queue.shift()!;
      const options: Vec2[] = [];
      for (const [dx, dy] of CARDINAL) {
        const next = { x: cur.x + dx, y: cur.y + dy };
        if (!remaining.has(quadKey(next.x, next.y))) continue;
        options.push(next);
      }
      options.sort((a, b) => {
        const as = blobScore(claimed, a);
        const bs = blobScore(claimed, b);
        return bs - as || a.y - b.y || a.x - b.x;
      });
      for (const next of options) {
        if (claimed.length >= TARGET) break;
        const box = boundingBox(claimed.concat([next]));
        if (box.w > 5 || box.h > 5) continue;
        remaining.delete(quadKey(next.x, next.y));
        claimed.push(next);
        queue.push(next);
      }
    }
    for (const part of claimed) owner.set(quadKey(part.x, part.y), ward);
    ward++;
  }
  repairAtoms(owner, cells, groups);
  return owner;
}

function blobScore(claimed: readonly Vec2[], next: Vec2): number {
  const set = toKeySet(claimed.concat([next]));
  let score = 0;
  const box = boundingBox(claimed.concat([next]));
  score -= box.w + box.h;
  if (
    set.has(quadKey(next.x, next.y)) &&
    (set.has(quadKey(next.x + 1, next.y)) ||
      set.has(quadKey(next.x - 1, next.y)) ||
      set.has(quadKey(next.x, next.y + 1)) ||
      set.has(quadKey(next.x, next.y - 1)))
  ) {
    score += 3;
  }
  return score;
}

function buildAtoms(
  cells: readonly Vec2[],
  groups: readonly (readonly Vec2[])[],
): {
  atoms: Atom[];
  atomOf: Map<number, number>;
} {
  const inF = toKeySet(cells);
  const parent = new Map<number, number>();
  const find = (key: number): number => {
    const known = parent.get(key);
    if (known === undefined) {
      parent.set(key, key);
      return key;
    }
    let cursor = known;
    for (;;) {
      const parentOf = parent.get(cursor);
      if (parentOf === undefined || parentOf === cursor) return cursor;
      const above = parent.get(parentOf);
      if (above === undefined) return parentOf;
      parent.set(cursor, above);
      cursor = parentOf;
    }
  };
  const unite = (a: number, b: number) => {
    const pa = find(a);
    const pb = find(b);
    if (pa !== pb) parent.set(pa, pb);
  };
  for (const group of groups) {
    const keys: number[] = [];
    for (const cell of group) {
      const key = quadKey(cell.x, cell.y);
      if (inF.has(key)) keys.push(key);
    }
    for (let i = 1; i < keys.length; i++) unite(keys[0]!, keys[i]!);
  }
  const buckets = new Map<number, Vec2[]>();
  for (const cell of cells) {
    const root = find(quadKey(cell.x, cell.y));
    let list = buckets.get(root);
    if (!list) {
      list = [];
      buckets.set(root, list);
    }
    list.push(cell);
  }
  const atoms: Atom[] = [];
  const atomOf = new Map<number, number>();
  const roots = [...buckets.keys()].sort((a, b) => a - b);
  for (const root of roots) {
    const id = atoms.length;
    const atomCells = sortQuads(buckets.get(root) ?? []);
    atoms.push({ id, cells: atomCells });
    for (const cell of atomCells) atomOf.set(quadKey(cell.x, cell.y), id);
  }
  return { atoms, atomOf };
}

function groupOwner(owner: Map<number, number>, cells: readonly Vec2[]): Map<number, Vec2[]> {
  const wards = new Map<number, Vec2[]>();
  for (const cell of cells) {
    const id = owner.get(quadKey(cell.x, cell.y));
    if (id === undefined) continue;
    let list = wards.get(id);
    if (!list) {
      list = [];
      wards.set(id, list);
    }
    list.push(cell);
  }
  return wards;
}

function compactWards(cells: readonly Vec2[], owner: Map<number, number>): CutWard[] {
  const grouped = groupOwner(owner, cells);
  const entries = [...grouped.entries()].map(([id, list]) => ({
    id,
    list: sortQuads(list),
  }));
  entries.sort((a, b) => a.list[0]!.y - b.list[0]!.y || a.list[0]!.x - b.list[0]!.x || a.id - b.id);
  const remap = new Map<number, number>();
  entries.forEach((entry, index) => remap.set(entry.id, index));
  const remapped = new Map<number, number>();
  for (const [key, id] of owner) {
    const next = remap.get(id);
    if (next !== undefined) remapped.set(key, next);
  }
  const wards: CutWard[] = entries.map((entry, index) => ({
    wardId: index,
    quadrants: entry.list,
    neighbours: [],
  }));
  const seams = new Map<string, { length: number; crossings: Vec2[] }>();
  const touch = (a: number, b: number, crossing: Vec2) => {
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    const key = `${lo}:${hi}`;
    let row = seams.get(key);
    if (!row) {
      row = { length: 0, crossings: [] };
      seams.set(key, row);
    }
    row.length++;
    row.crossings.push(crossing);
  };
  for (const cell of cells) {
    const id = remapped.get(quadKey(cell.x, cell.y));
    if (id === undefined) continue;
    const east = remapped.get(quadKey(cell.x + 1, cell.y));
    if (east !== undefined && east !== id) touch(id, east, { x: cell.x + 1, y: cell.y + 0.5 });
    const south = remapped.get(quadKey(cell.x, cell.y + 1));
    if (south !== undefined && south !== id) touch(id, south, { x: cell.x + 0.5, y: cell.y + 1 });
  }
  for (const [key, row] of seams) {
    const [lo, hi] = key.split(':').map(Number) as [number, number];
    row.crossings.sort((a, b) => a.y - b.y || a.x - b.x);
    wards[lo]?.neighbours.push({ wardId: hi!, seamLength: row.length, crossings: row.crossings });
    wards[hi!]?.neighbours.push({ wardId: lo!, seamLength: row.length, crossings: row.crossings });
  }
  for (const ward of wards) ward.neighbours.sort((a, b) => a.wardId - b.wardId);
  return wards;
}

function clipGroups(groups: readonly (readonly Vec2[])[], cells: readonly Vec2[]): Vec2[][] {
  const inF = toKeySet(cells);
  const out: Vec2[][] = [];
  for (const group of groups) {
    const kept = sortQuads(group.filter((cell) => inF.has(quadKey(cell.x, cell.y))));
    if (kept.length > 1) out.push(kept);
  }
  return out;
}

function bridgeOrDrop(cells: readonly Vec2[], roads: readonly Vec2[]): Vec2[] {
  const parts = components4(cells);
  const big: Vec2[] = [];
  const small: Vec2[][] = [];
  for (const part of parts) {
    if (part.length >= 4) big.push(...part);
    else small.push(part);
  }
  if (!big.length) {
    parts.sort((a, b) => b.length - a.length || a[0]!.y - b[0]!.y || a[0]!.x - b[0]!.x);
    return parts[0] ?? [];
  }
  const kept = toKeySet(big);
  for (const part of small) {
    const partSet = toKeySet(part);
    let bridge: Vec2 | null = null;
    for (const road of roads) {
      const key = quadKey(road.x, road.y);
      if (kept.has(key) || partSet.has(key)) continue;
      if (touches(road, partSet) && touches(road, kept)) {
        bridge = { x: road.x, y: road.y };
        break;
      }
    }
    if (!bridge) continue;
    big.push(...part, bridge);
    for (const cell of part) kept.add(quadKey(cell.x, cell.y));
    kept.add(quadKey(bridge.x, bridge.y));
  }
  return sortQuads(big);
}

function touches(cell: Vec2, set: ReadonlySet<number>): boolean {
  for (const [dx, dy] of CARDINAL) {
    if (set.has(quadKey(cell.x + dx, cell.y + dy))) return true;
  }
  return false;
}

function dedupe(cells: readonly Vec2[]): Vec2[] {
  const seen = new Set<number>();
  const out: Vec2[] = [];
  for (const cell of cells) {
    const key = quadKey(cell.x, cell.y);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ x: cell.x, y: cell.y });
  }
  return out;
}

function sameCells(a: readonly Vec2[], b: readonly Vec2[]): boolean {
  if (a.length !== b.length) return false;
  const set = toKeySet(a);
  for (const cell of b) if (!set.has(quadKey(cell.x, cell.y))) return false;
  return true;
}

function signature(owner: Map<number, number>): string {
  let hash = 2166136261;
  const keys = [...owner.keys()].sort((a, b) => a - b);
  for (const key of keys) {
    hash = Math.imul(hash ^ key, 16777619);
    hash = Math.imul(hash ^ (owner.get(key) ?? 0), 16777619);
  }
  return String(hash >>> 0);
}
