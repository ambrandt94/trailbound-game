/**
 * Where the party wagon parks in a 3D area.
 * The covered wagon is authored in metres: +Y up, forward +Z, origin at the
 * wheelbase centre, minY on the ground. No extra scale or offset.
 * Area yaw 0 faces +Z. Candidates sit beside the spawn, never on it.
 * Swap the GLB by changing `PARTY_WAGON_ASSET` only.
 */
export const PARTY_WAGON_ASSET = 'assets/props/party_wagon.glb';

/**
 * Player collision in wagon space. X ±0.94, Z −1.79..+1.8.
 * The hitch pole past the body is not solid.
 */
export const WAGON_BOX = {
  minX: -0.94,
  maxX: 0.94,
  minZ: -1.79,
  maxZ: 1.8,
  h: 2.7,
  w: 0.94 - -0.94,
  d: 1.8 - -1.79,
} as const;

/**
 * Parking footprint in wagon space, tongue included.
 * Nose to tail is about 5.1 m. X is the mesh width.
 */
export const WAGON_FOOTPRINT = {
  minX: -0.936,
  maxX: 0.936,
  minZ: -1.788,
  maxZ: 3.303,
} as const;

/**
 * The spawn stays outside the tongue. The farthest footprint corner is
 * about 3.43 m from the origin, plus a step for the player's body.
 */
export const WAGON_SPAWN_GAP_M = 3.8;

/** Metres of air between the full footprint and a door. */
export const WAGON_DOOR_GAP_M = 1.2;

/**
 * Use-prompt radius from the wagon origin. Reaches someone standing
 * beside the hitch without covering the next street.
 */
export const WAGON_USE_RADIUS_M = 3.8;

export interface WagonCandidate {
  x: number;
  z: number;
  yaw: number;
}

export interface WagonBlock {
  x: number;
  z: number;
  w: number;
  d: number;
}

export interface WagonAabb {
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
}

const BLOCKED_GROUND = new Set(['road', 'dirt', 'plaza', 'water', 'lot']);

/** Ground classes the wagon must not sit on. Roads, lots, plazas, water. */
export function groundBlocksWagon(name: string): boolean {
  return BLOCKED_GROUND.has(name.trim().toLowerCase());
}

export function partyWagonUrl(base = './'): string {
  const root = base.endsWith('/') ? base : `${base}/`;
  return `${root}${PARTY_WAGON_ASSET}`;
}

/**
 * Side then back offsets, nearest first. `side` is the spawn's right.
 * Every candidate is at least `WAGON_SPAWN_GAP_M` from the spawn.
 */
export function wagonCandidates(spawnX: number, spawnZ: number, yaw: number): WagonCandidate[] {
  const facing = Number.isFinite(yaw) ? yaw : 0;
  const offsets: Array<readonly [number, number]> = [
    [4.6, 1.2],
    [-4.6, 1.2],
    [6.5, 2.4],
    [-6.5, 2.4],
    [4.4, 5],
    [-4.4, 5],
    [8.4, 1.6],
    [-8.4, 1.6],
    // A tight street can block the whole near ring. These stay on grass
    // when the spawn is hemmed in by buildings.
    [12, 3.5],
    [-12, 3.5],
    [11, 6.5],
    [-11, 6.5],
    [14, 4],
    [-14, 4],
  ];
  const spots: WagonCandidate[] = [];
  for (const [side, back] of offsets) {
    const spot = wagonPose(spawnX, spawnZ, facing, side, back);
    if (Math.hypot(spot.x - spawnX, spot.z - spawnZ) + 1e-6 < WAGON_SPAWN_GAP_M) continue;
    spots.push(spot);
  }
  return spots;
}

export function wagonPose(
  spawnX: number,
  spawnZ: number,
  yaw: number,
  side: number,
  back: number,
): WagonCandidate {
  const { fx, fz, rx, rz } = basis(yaw);
  return {
    x: spawnX - fx * back + rx * side,
    z: spawnZ - fz * back + rz * side,
    yaw,
  };
}

interface FootRect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

function basis(yaw: number): { fx: number; fz: number; rx: number; rz: number } {
  const facing = Number.isFinite(yaw) ? yaw : 0;
  return {
    fx: Math.sin(facing),
    fz: Math.cos(facing),
    rx: Math.cos(facing),
    rz: -Math.sin(facing),
  };
}

/** Wagon-local point. +Z is the tongue, +X is the wagon's right. */
export function wagonLocal(
  spot: { x: number; z: number; yaw?: number },
  point: { x: number; z: number },
): { x: number; z: number } {
  const { fx, fz, rx, rz } = basis(spot.yaw ?? 0);
  const dx = point.x - spot.x;
  const dz = point.z - spot.z;
  return { x: dx * rx + dz * rz, z: dx * fx + dz * fz };
}

export function wagonWorld(
  spot: { x: number; z: number; yaw?: number },
  localX: number,
  localZ: number,
): { x: number; z: number } {
  const { fx, fz, rx, rz } = basis(spot.yaw ?? 0);
  return {
    x: spot.x + rx * localX + fx * localZ,
    z: spot.z + rz * localX + fz * localZ,
  };
}

/**
 * World AABB of the solid body. Yaw swings the bed; the hitch stays open.
 * The box is centred on the body, which sits a few millimetres ahead of the axle.
 */
export function wagonBodyAabb(spot: { x: number; z: number; yaw?: number }): WagonAabb {
  const corners = [
    [WAGON_BOX.minX, WAGON_BOX.minZ],
    [WAGON_BOX.maxX, WAGON_BOX.minZ],
    [WAGON_BOX.minX, WAGON_BOX.maxZ],
    [WAGON_BOX.maxX, WAGON_BOX.maxZ],
  ] as const;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const [localX, localZ] of corners) {
    const world = wagonWorld(spot, localX, localZ);
    minX = Math.min(minX, world.x);
    maxX = Math.max(maxX, world.x);
    minZ = Math.min(minZ, world.z);
    maxZ = Math.max(maxZ, world.z);
  }
  return {
    x: (minX + maxX) / 2,
    z: (minZ + maxZ) / 2,
    w: maxX - minX,
    d: maxZ - minZ,
    h: WAGON_BOX.h,
  };
}

/** Corners and the tongue, in world space, so a road under the hitch still counts. */
export function wagonFootSamples(spot: WagonCandidate): Array<{ x: number; z: number }> {
  const xs = [WAGON_FOOTPRINT.minX, 0, WAGON_FOOTPRINT.maxX];
  const zs = [
    WAGON_FOOTPRINT.minZ,
    0,
    WAGON_BOX.maxZ,
    (WAGON_BOX.maxZ + WAGON_FOOTPRINT.maxZ) / 2,
    WAGON_FOOTPRINT.maxZ,
  ];
  const samples: Array<{ x: number; z: number }> = [];
  for (const localX of xs) {
    for (const localZ of zs) samples.push(wagonWorld(spot, localX, localZ));
  }
  return samples;
}

/**
 * Full footprint, tongue included, against a world-aligned block.
 * `pad` is extra metres around the block.
 */
export function wagonHitsBlock(
  spot: { x: number; z: number; yaw?: number },
  block: WagonBlock,
  pad = 0.45,
): boolean {
  return rectHitsAabb(spot, WAGON_FOOTPRINT, block, pad);
}

function rectHitsAabb(
  spot: { x: number; z: number; yaw?: number },
  rect: FootRect,
  block: WagonBlock,
  pad: number,
): boolean {
  const { fx, fz, rx, rz } = basis(spot.yaw ?? 0);
  const center = wagonWorld(spot, (rect.minX + rect.maxX) / 2, (rect.minZ + rect.maxZ) / 2);
  const hx = (rect.maxX - rect.minX) / 2;
  const hz = (rect.maxZ - rect.minZ) / 2;
  const dx = block.x - center.x;
  const dz = block.z - center.z;
  const blockHalfW = block.w / 2 + pad;
  const blockHalfD = block.d / 2 + pad;
  const axes: Array<readonly [number, number]> = [
    [rx, rz],
    [fx, fz],
    [1, 0],
    [0, 1],
  ];
  for (const [nx, nz] of axes) {
    const len = Math.hypot(nx, nz) || 1;
    const ux = nx / len;
    const uz = nz / len;
    const dist = Math.abs(dx * ux + dz * uz);
    const wagonReach = hx * Math.abs(rx * ux + rz * uz) + hz * Math.abs(fx * ux + fz * uz);
    const blockReach = blockHalfW * Math.abs(ux) + blockHalfD * Math.abs(uz);
    if (dist >= wagonReach + blockReach) return false;
  }
  return true;
}

function outside(value: number, min: number, max: number): number {
  if (value < min) return min - value;
  if (value > max) return value - max;
  return 0;
}

/** True when `point` is inside the footprint or within `gap` metres of it. */
export function wagonNearPoint(
  spot: { x: number; z: number; yaw?: number },
  point: { x: number; z: number },
  gap = WAGON_DOOR_GAP_M,
): boolean {
  const local = wagonLocal(spot, point);
  const dx = outside(local.x, WAGON_FOOTPRINT.minX, WAGON_FOOTPRINT.maxX);
  const dz = outside(local.z, WAGON_FOOTPRINT.minZ, WAGON_FOOTPRINT.maxZ);
  return Math.hypot(dx, dz) < gap;
}

export interface WagonClearance {
  inside: boolean;
  blocked: boolean;
  road: boolean;
  door: boolean;
}

export function wagonSpotClear(clearance: WagonClearance): boolean {
  return clearance.inside && !clearance.blocked && !clearance.road && !clearance.door;
}

/** First spot the predicate accepts. Null when every candidate is blocked. */
export function chooseWagonSpot(
  spots: readonly WagonCandidate[],
  clear: (spot: WagonCandidate) => boolean,
): WagonCandidate | null {
  for (const spot of spots) {
    if (clear(spot)) return spot;
  }
  return null;
}
