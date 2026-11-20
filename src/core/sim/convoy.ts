/**
 * The 3D convoy: the caravan rolling through a 3D area with the hero beside it.
 *
 * Space. Area metres, +x east, +z south. Yaw follows the controller motor:
 * facing is `(sin yaw, cos yaw)`, and the wagon's tongue points that way.
 * The geometric left of a body facing yaw (Y up) is `(cos yaw, −sin yaw)`.
 *
 * Pace. On the map the caravan covers about 1 unit (32 m) per TU. At the
 * 0.33× area clock that is `convoyClockMps` = 5.9 m/s: clock-true, but a
 * gallop a walking hero cannot hold. The wagon rolls at the zone wagon speed
 * × speedMod instead: `CONVOY_MPS` (2.5 m/s, an ox-cart walk a hero strolls
 * beside) by default, or whatever the "Zone (3D) wagon speed" setting says
 * (`zoneWagonSpeed`, 1–6 m/s, read live). The map caravan advances by exactly
 * the metres the wagon covers: the wagon on screen and the caravan on the map
 * never disagree. The 3D clock is then paid by distance while the wagon rolls
 * (`convoyClockHours`), so a unit of road costs the same TU as on the map; a
 * slower wagon just takes longer, in real seconds, to cover it.
 * 3D never reads the overworld map speed setting, and the zone wagon speed
 * never touches the map.
 */
import { EDGE_WARN_OFF_M } from '../area/edge-leave';
import { METERS_PER_WORLD_TILE, ZONE_SCALE } from '../world/models';
import { AREA_TIME_SCALE, HOURS_PER_TU } from './time';
import { GAME_HOURS_PER_REAL_SECOND } from './clock';
import { CARAVAN_METERS_PER_UNIT, CARAVAN_UNITS_PER_TU, pointAlong } from './caravan';

/**
 * Default wagon pace in 3D, metres per real second at speedMod 1: an ox-cart
 * walk. It was 5, which read about twice too fast. The "Zone (3D) wagon speed"
 * setting overrides it live. Clock-true is 5.9.
 */
export const CONVOY_MPS = 2.5;
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
/**
 * Auto-walk's floor for its speed cap. The wagon tops out near 2.75 m/s at
 * the default pace (speedMod 1.1), so this leaves room to close a gap without
 * breaking into a run. The cap rises with a faster wagon (`followCap`).
 */
export const FOLLOW_RUN_MPS = 3.5;
/** Headroom over the wagon's own speed that the auto-walk may use to catch up, m/s. */
export const FOLLOW_CATCHUP_MPS = 1;
/**
 * Auto-walk faster than this plays as a jog; at or under it, a walk. Sits
 * above the wagon's default pace (2.5, 2.75 on a good road), so the hero walks
 * beside it, and below the catch-up cap.
 */
export const AUTO_JOG_MPS = 3.2;
/** Far behind (the leash pull), the hero may sprint. */
export const FOLLOW_SPRINT_MPS = 8.5;
/** Re-cut the area when the wagon gets this close to the playable edge. */
export const CONVOY_RECUT_EDGE_M = 16;
/**
 * Start cutting the next window this much sooner than the re-cut itself, so
 * the build is done before the wagon needs it. About 8 s at the default 2.5 m/s, 3 s at the 6 m/s slider top.
 */
export const CONVOY_PRECUT_LEAD_M = 20;
/**
 * Zones are instanced blocks. With this off (the default) the wagon does not
 * stream a next window ahead of itself: it rolls off the edge of the zone and
 * the hero follows it, or returns to the map. Turn it on to bring back the
 * cut-ahead-and-swap behaviour (`recutAction`).
 */
export const CONVOY_STREAM_RECUT = false;
/** The wagon has left the zone once it is this far past the playable edge, metres. */
export const CONVOY_GONE_M = 6;
/**
 * The hero's auto-walk beside the wagon stops this far inside the zone edge:
 * they stay while the wagon rolls on. It sits outside the "leaving" warning
 * band (`EDGE_WARN_OFF_M`) so a parked hero never shows the leave warning or
 * counts toward an exit: only walking out on purpose does.
 */
export const CONVOY_EDGE_HOLD_M = EDGE_WARN_OFF_M + 1;
/** A zone hop centres the new zone this far toward the wagon from the exit point, at most. */
export const CONVOY_HOP_SHIFT_M = 34;
/** A re-cut centres the new window this far ahead of the wagon along the route. */
export const CONVOY_LOOKAHEAD_M = 26;
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

/**
 * 3D wagon speed in metres per real second. `baseMps` is the zone wagon speed
 * setting (a bad value falls back to `CONVOY_MPS`); the terrain `speedMod`
 * multiplies on top.
 */
export function convoyMps(speedMod: number, baseMps: number = CONVOY_MPS): number {
  const mod = Number.isFinite(speedMod) && speedMod > 0 ? speedMod : 1;
  const base = Number.isFinite(baseMps) && baseMps > 0 ? baseMps : CONVOY_MPS;
  return base * mod;
}

/**
 * Metres the wagon rolls in `dt` real seconds. It rolls whenever a route is
 * active and not halted, with no input needed, and stands still when paused.
 */
export function convoyRollMetres(input: {
  rolling: boolean;
  paused: boolean;
  speedMod: number;
  /** Zone wagon speed setting, m/s. Default `CONVOY_MPS`. */
  baseMps?: number;
  dt: number;
}): number {
  if (!input.rolling || input.paused || !(input.dt > 0)) return 0;
  return convoyMps(input.speedMod, input.baseMps) * input.dt;
}

/**
 * Game hours the clock pays for `units` of road rolled in 3D. The same TU per
 * unit as the map (`etaTu`): a mountain slows the wagon and costs more TU.
 */
export function convoyClockHours(units: number, speedMod: number): number {
  if (!(units > 0)) return 0;
  const mod = Number.isFinite(speedMod) && speedMod > 0 ? speedMod : 1;
  return (units / (CARAVAN_UNITS_PER_TU * mod)) * HOURS_PER_TU;
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
 * The fastest the auto-walk goes: a walk-plus-catch-up beside the wagon, or a
 * sprint past the leash. Both rise with a fast wagon so a high zone speed
 * never leaves the hero behind.
 */
export function followCap(wagonSpeed: number, slotDist: number): number {
  const speed = Number.isFinite(wagonSpeed) ? Math.max(0, wagonSpeed) : 0;
  if (slotDist > LEASH_HINT_M) return Math.max(FOLLOW_SPRINT_MPS, speed + 3);
  return Math.max(FOLLOW_RUN_MPS, speed + FOLLOW_CATCHUP_MPS);
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
  const cap = followCap(speed, slotDist);
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

/** Metres from the wagon to the nearest playable edge. */
export function convoyRoom(wagon: { x: number; z: number }, bounds: ConvoyBounds): number {
  return Math.min(
    wagon.x - bounds.minX,
    bounds.maxX - wagon.x,
    wagon.z - bounds.minZ,
    bounds.maxZ - wagon.z,
  );
}

/** True once the wagon is within `CONVOY_RECUT_EDGE_M` of the playable edge. */
export function convoyNeedsRecut(wagon: { x: number; z: number }, bounds: ConvoyBounds): boolean {
  return convoyRoom(wagon, bounds) < CONVOY_RECUT_EDGE_M;
}

/** What the re-cut machinery should do this frame. */
export type RecutAction = 'none' | 'prepare' | 'swap';

/**
 * The next window is cut early and swapped in late.
 * - `prepare` once the wagon is within `CONVOY_PRECUT_LEAD_M` of the route
 *   point where it will cross the re-cut line, and nothing is cut yet.
 * - `swap` once it is on the line.
 * Nothing happens while a swap is already running or the route is gone.
 * `crossing` is the road left to that line in metres (Infinity when the
 * route leaves the window nowhere near).
 */
export function recutAction(input: {
  routed: boolean;
  room: number;
  crossing: number;
  prepared: boolean;
  swapping: boolean;
}): RecutAction {
  if (!input.routed || input.swapping) return 'none';
  if (input.room < CONVOY_RECUT_EDGE_M) return 'swap';
  if (!input.prepared && input.crossing <= CONVOY_PRECUT_LEAD_M) return 'prepare';
  return 'none';
}

/**
 * Fine-tile distance along a flat route, from `from`, to the first point
 * within `CONVOY_RECUT_EDGE_M` of this window's edge. Null when the route
 * stays clear of it for `limitTiles`. Samples about once a metre.
 */
export function routeCrossing(
  route: readonly number[],
  from: number,
  frame: AreaFrame,
  bounds: ConvoyBounds,
  limitTiles: number,
): number | null {
  const count = route.length >> 1;
  const step = metresToTiles(1);
  let before = 0;
  for (let i = 1; i < count; i++) {
    const ax = route[(i - 1) * 2]!;
    const ay = route[(i - 1) * 2 + 1]!;
    const bx = route[i * 2]!;
    const by = route[i * 2 + 1]!;
    const seg = Math.hypot(bx - ax, by - ay);
    const end = before + seg;
    if (end >= from && seg > 1e-9) {
      for (let at = Math.max(from, before); at <= Math.min(end, from + limitTiles); at += step) {
        const t = (at - before) / seg;
        const local = tileToLocal(frame, ax + (bx - ax) * t, ay + (by - ay) * t);
        if (convoyRoom(local, bounds) < CONVOY_RECUT_EDGE_M) return at;
      }
    }
    before = end;
    if (before > from + limitTiles) break;
  }
  return null;
}

/**
 * A window cut ahead of time is only good if it still holds the wagon with
 * room to spare when the swap comes (the wagon may have halted, the route may
 * have changed, or the swap may have come late).
 */
export function preparedWindowFits(
  wagon: { x: number; z: number },
  bounds: ConvoyBounds,
  margin = CONVOY_RECUT_EDGE_M + 4,
): boolean {
  return convoyRoom(wagon, bounds) >= margin;
}

/**
 * True once the wagon has rolled off the zone: past the playable edge by
 * `CONVOY_GONE_M`. `room` is `convoyRoom`, negative outside the zone.
 */
export function convoyLeftZone(room: number): boolean {
  return room < -CONVOY_GONE_M;
}

/**
 * Where to cut the adjacent zone when the hero walks off the edge after the
 * wagon has rolled on: the exit point, nudged toward the wagon (half the gap,
 * at most `CONVOY_HOP_SHIFT_M`) so a wagon just ahead lands in the new zone
 * too, and the hero stays well inside it. Fine tiles in and out.
 */
export function zoneHopCentre(
  exit: { x: number; y: number },
  wagon: { x: number; y: number },
): { x: number; y: number } {
  const dx = wagon.x - exit.x;
  const dy = wagon.y - exit.y;
  const gap = Math.hypot(dx, dy);
  if (!(gap > 1e-9)) return { x: exit.x, y: exit.y };
  const shift = Math.min(metresToTiles(CONVOY_HOP_SHIFT_M), gap / 2);
  return { x: exit.x + (dx / gap) * shift, y: exit.y + (dy / gap) * shift };
}

/** Chords shorter than this (metres) are not a direction: the road ends here. */
export const CONVOY_AHEAD_MIN_M = 8;

/**
 * The route point about one zone-width down the road from `along`
 * (fine tiles, clamped to the route's end), or null when it is too close to
 * `from` to give a direction. A direction taken to a point that far ahead
 * follows where the road is going rather than the wagon's instantaneous yaw, so
 * a bend does not flip the cut. `from` is the wagon, or the point the hero
 * walked out at.
 */
export function convoyAheadPoint(
  route: readonly number[],
  along: number,
  length: number,
  aheadTiles: number,
  from?: { x: number; y: number },
): { x: number; y: number } | null {
  if (route.length < 4 || !(length > 0) || !(aheadTiles > 0)) return null;
  const start = from ?? pointAlong(route, along);
  const at = pointAlong(route, Math.min(length, Math.max(0, along) + aheadTiles));
  const gap = Math.hypot(at.x - start.x, at.y - start.y);
  if (!(gap > metresToTiles(CONVOY_AHEAD_MIN_M))) return null;
  return { x: at.x, y: at.y };
}
