/**
 * The 3D convoy: the caravan rolling through a 3D area with the hero beside it.
 *
 * Space. Area metres, +x east, +z south. Yaw follows the controller motor:
 * facing is `(sin yaw, cos yaw)`, and the wagon's tongue points that way.
 * The geometric left of a body facing yaw (Y up) is `(cos yaw, −sin yaw)`.
 *
 * Pace. On the map the caravan covers about 1 unit (32 m) per TU, which is
 * 5.9 m/s of 3D time at the 0.33× area clock: an ox at a gallop. In 3D the
 * wagon walks at `CONVOY_WALK_MPS` × speedMod instead, and the map caravan
 * advances by exactly the metres the wagon covers, so the wagon on screen
 * and the caravan on the map never disagree. Swap `convoyMps` for
 * `convoyClockMps` to tie the wagon to the clock pace instead.
 */
import { METERS_PER_WORLD_TILE, ZONE_SCALE } from '../world/models';
import { AREA_TIME_SCALE, HOURS_PER_TU } from './time';
import { GAME_HOURS_PER_REAL_SECOND } from './clock';
import { CARAVAN_METERS_PER_UNIT, CARAVAN_UNITS_PER_TU } from './caravan';

/** Ox walking pace beside a person, metres per real second at speedMod 1. */
export const CONVOY_WALK_MPS = 1.3;
/** The hero walks this far off the wagon's left side. */
export const CONVOY_SIDE_M = 2.5;
/** …and this far ahead of the wheelbase centre, beside the front wheel. */
export const CONVOY_AHEAD_M = 0.8;
/** Past this, the HUD offers to rejoin. */
export const LEASH_HINT_M = 30;
/** Past this with no move input, the hero walks back on their own. */
export const LEASH_PULL_M = 40;
/** Free walk re-latches onto the wagon after standing this long near the slot. */
export const RELATCH_SLOT_M = 3;
export const RELATCH_IDLE_SEC = 0.8;
/** Spring that pulls the hero onto the slot, per second. */
export const FOLLOW_GAIN = 1.4;
/** Auto-walk never runs faster than this (the controller's run). */
export const FOLLOW_RUN_MPS = 3.5;
/** Far behind (the leash pull), the hero may sprint. */
export const FOLLOW_SPRINT_MPS = 5.5;
/** Re-cut the area when the wagon gets this close to the playable edge. */
export const CONVOY_RECUT_EDGE_M = 16;
/** A re-cut centres the new window this far ahead of the wagon along the route. */
export const CONVOY_LOOKAHEAD_M = 24;
/** The bench toggle only seats a hero this close to the wagon; farther, it walks them back. */
export const BENCH_REACH_M = 6;
/** Bench seat in wagon space (+Z tongue, +X the wagon's left), metres. */
export const CONVOY_BENCH = { x: 0.32, y: 1.32, z: 1.62 } as const;

export type ConvoyMode = 'walk' | 'bench' | 'free';
export type LeashState = 'ok' | 'hint' | 'pull';

export interface ConvoyPose {
  x: number;
  z: number;
  yaw: number;
  /** Ground speed this frame, m/s. Zero while halted. */
  speed: number;
}

/** 3D wagon speed in metres per real second. */
export function convoyMps(speedMod: number): number {
  const mod = Number.isFinite(speedMod) && speedMod > 0 ? speedMod : 1;
  return CONVOY_WALK_MPS * mod;
}

/** The clock-true alternative: the map pace at the area clock. About 5.9 m/s. */
export function convoyClockMps(speedMod: number): number {
  const mod = Number.isFinite(speedMod) && speedMod > 0 ? speedMod : 1;
  const tuPerSec = (GAME_HOURS_PER_REAL_SECOND * AREA_TIME_SCALE) / HOURS_PER_TU;
  return tuPerSec * CARAVAN_UNITS_PER_TU * CARAVAN_METERS_PER_UNIT * mod;
}

/** Metres to fine world tiles. */
export function metresToTiles(metres: number): number {
  return metres / METERS_PER_WORLD_TILE;
}

/**
 * Where an area export sits in the world. `innerOrigin` is the absolute
 * inner tile of local (0, 0); there are `ZONE_SCALE` inner tiles per fine tile.
 */
export interface AreaFrame {
  innerOrigin: { x: number; y: number };
  metersPerTile: number;
}

export function tileToLocal(frame: AreaFrame, x: number, y: number): { x: number; z: number } {
  const m = frame.metersPerTile > 0 ? frame.metersPerTile : 1;
  return {
    x: (x * ZONE_SCALE - frame.innerOrigin.x) * m,
    z: (y * ZONE_SCALE - frame.innerOrigin.y) * m,
  };
}

export function localToTile(frame: AreaFrame, x: number, z: number): { x: number; y: number } {
  const m = frame.metersPerTile > 0 ? frame.metersPerTile : 1;
  return {
    x: (x / m + frame.innerOrigin.x) / ZONE_SCALE,
    y: (z / m + frame.innerOrigin.y) / ZONE_SCALE,
  };
}

/** Map yaw (0 faces north, −y) to area yaw (facing `(sin, cos)` with +z south). */
export function mapYawToArea(mapYaw: number): number {
  // Map facing is (sin m, −cos m) in x/y; area facing is (sin a, cos a) in x/z, z = y.
  return Math.PI - mapYaw;
}

export function areaYawToMap(areaYaw: number): number {
  return Math.PI - areaYaw;
}

/** The hero's walking spot: off the wagon's left side, beside the front wheel. */
export function convoySlot(wagon: ConvoyPose): { x: number; z: number } {
  const fx = Math.sin(wagon.yaw);
  const fz = Math.cos(wagon.yaw);
  const lx = Math.cos(wagon.yaw);
  const lz = -Math.sin(wagon.yaw);
  return {
    x: wagon.x + lx * CONVOY_SIDE_M + fx * CONVOY_AHEAD_M,
    z: wagon.z + lz * CONVOY_SIDE_M + fz * CONVOY_AHEAD_M,
  };
}

/** Bench seat in area space. */
export function convoyBench(
  wagon: ConvoyPose,
  groundY: number,
): {
  x: number;
  y: number;
  z: number;
  yaw: number;
} {
  const fx = Math.sin(wagon.yaw);
  const fz = Math.cos(wagon.yaw);
  const lx = Math.cos(wagon.yaw);
  const lz = -Math.sin(wagon.yaw);
  return {
    x: wagon.x + lx * CONVOY_BENCH.x + fx * CONVOY_BENCH.z,
    y: groundY + CONVOY_BENCH.y,
    z: wagon.z + lz * CONVOY_BENCH.x + fz * CONVOY_BENCH.z,
    yaw: wagon.yaw,
  };
}

/**
 * Velocity that walks the hero onto the slot: the wagon's own velocity plus a
 * spring toward the slot, capped at a run (a sprint past the leash).
 */
export function followVelocity(
  hero: { x: number; z: number },
  wagon: ConvoyPose,
): { vx: number; vz: number; slotDist: number } {
  const slot = convoySlot(wagon);
  const ex = slot.x - hero.x;
  const ez = slot.z - hero.z;
  const slotDist = Math.hypot(ex, ez);
  const speed = Math.max(0, wagon.speed);
  if (slotDist < 0.2 && speed < 0.05) return { vx: 0, vz: 0, slotDist };
  let vx = Math.sin(wagon.yaw) * speed + ex * FOLLOW_GAIN;
  let vz = Math.cos(wagon.yaw) * speed + ez * FOLLOW_GAIN;
  const cap = slotDist > LEASH_HINT_M ? FOLLOW_SPRINT_MPS : FOLLOW_RUN_MPS;
  const len = Math.hypot(vx, vz);
  if (len > cap) {
    vx = (vx / len) * cap;
    vz = (vz / len) * cap;
  }
  return { vx, vz, slotDist };
}

/** Distance band for the leash. `pull` only fires without move input. */
export function leashState(dist: number, hasInput: boolean): LeashState {
  if (!(dist > LEASH_HINT_M)) return 'ok';
  if (dist > LEASH_PULL_M && !hasInput) return 'pull';
  return 'hint';
}

export interface ConvoyModeInput {
  mode: ConvoyMode;
  hasInput: boolean;
  /** Hero to wagon origin, metres. */
  dist: number;
  /** Hero to the walking slot, metres. */
  slotDist: number;
  /** Seconds the hero has stood without move input. */
  idleSec: number;
  /** Bench toggle pressed this tick. */
  bench: boolean;
  /** Rejoin pressed this tick (HUD button or key). */
  rejoin: boolean;
}

/**
 * Walk beside the wagon until a move key takes over. Free walk lasts until
 * the hero is pulled back past the leash, asks to rejoin, or stands still
 * by the slot. The bench toggles; a move key steps off it.
 */
export function nextConvoyMode(input: ConvoyModeInput): ConvoyMode {
  if (input.bench) {
    if (input.mode === 'bench') return 'walk';
    return input.dist <= BENCH_REACH_M ? 'bench' : 'walk';
  }
  if (input.rejoin) return 'walk';
  if (input.mode === 'bench') return input.hasInput ? 'free' : 'bench';
  if (input.hasInput) return 'free';
  if (input.mode === 'walk') return 'walk';
  if (input.dist > LEASH_PULL_M) return 'walk';
  if (input.slotDist < RELATCH_SLOT_M && input.idleSec >= RELATCH_IDLE_SEC) return 'walk';
  return 'free';
}

/** Turn a wanted world velocity into the motor's camera-relative stick. */
export function stickFor(
  vx: number,
  vz: number,
  camYawDeg: number,
): { ix: number; iz: number; speed: number } {
  const speed = Math.hypot(vx, vz);
  if (!(speed > 0.04)) return { ix: 0, iz: 0, speed: 0 };
  const mx = vx / speed;
  const mz = vz / speed;
  const th = (camYawDeg * Math.PI) / 180;
  const c = Math.cos(th);
  const s = Math.sin(th);
  // Inverse of the motor's mapping, which is its own inverse.
  return { ix: c * mx - s * mz, iz: -s * mx - c * mz, speed };
}

/** Playable rectangle in area metres. */
export interface ConvoyBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** True once the wagon is within `CONVOY_RECUT_EDGE_M` of the playable edge. */
export function convoyNeedsRecut(wagon: { x: number; z: number }, bounds: ConvoyBounds): boolean {
  const room = Math.min(
    wagon.x - bounds.minX,
    bounds.maxX - wagon.x,
    wagon.z - bounds.minZ,
    bounds.maxZ - wagon.z,
  );
  return room < CONVOY_RECUT_EDGE_M;
}
