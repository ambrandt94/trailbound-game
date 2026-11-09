/**
 * Where the party wagon parks in a 3D area.
 * Area yaw 0 faces +Z. Candidates sit beside the spawn, never on it.
 * Swap the GLB by changing `PARTY_WAGON_ASSET` only.
 */
export const PARTY_WAGON_ASSET = 'assets/props/party_wagon.glb';

export const WAGON_BOX = { w: 2.6, d: 4.4, h: 2.3 } as const;
/** The spawn point stays outside the wagon's box. */
export const WAGON_SPAWN_GAP_M = 3.4;
export const WAGON_DOOR_GAP_M = 2.6;

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
  const fx = Math.sin(yaw);
  const fz = Math.cos(yaw);
  const rx = Math.cos(yaw);
  const rz = -Math.sin(yaw);
  return {
    x: spawnX - fx * back + rx * side,
    z: spawnZ - fz * back + rz * side,
    yaw,
  };
}

export function wagonHitsBlock(
  spot: { x: number; z: number },
  block: WagonBlock,
  pad = 0.45,
): boolean {
  const halfW = WAGON_BOX.w / 2 + block.w / 2 + pad;
  const halfD = WAGON_BOX.d / 2 + block.d / 2 + pad;
  return Math.abs(spot.x - block.x) < halfW && Math.abs(spot.z - block.z) < halfD;
}

export function wagonNearPoint(
  spot: { x: number; z: number },
  point: { x: number; z: number },
  gap = WAGON_DOOR_GAP_M,
): boolean {
  return Math.hypot(spot.x - point.x, spot.z - point.z) < gap;
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
