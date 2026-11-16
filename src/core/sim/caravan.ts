/**
 * The caravan: a map entity separate from the hero. It owns a route
 * polyline in fine world tiles and rolls along it whenever the shared
 * clock runs, including while the map is open.
 *
 * Units. Distance is counted in Fable-style units so the day goal and pace
 * read the same as the design: about 1 unit per TU at an even mood, 70
 * units a day. One unit is `CARAVAN_TILES_PER_UNIT` fine world tiles
 * (4 tiles × 8 m = 32 m). That compresses a real ox train the way the map
 * already compresses the continent: on seed 7741 the road from Ashfen to
 * Saltgate, the nearest other city, is about 116 units, so about 116 TU of
 * rolling (1.2 clock days, 1.7 day goals). Ironmarch is about 210 units.
 */
import { METERS_PER_WORLD_TILE, type Vec2 } from '../world/models';

export const CARAVAN_TILES_PER_UNIT = 4;
export const CARAVAN_METERS_PER_UNIT = CARAVAN_TILES_PER_UNIT * METERS_PER_WORLD_TILE;
/** Units per TU before the speed modifier. */
export const CARAVAN_UNITS_PER_TU = 1;
/** Fable's day goal, in units. */
export const CARAVAN_DAY_GOAL_UNITS = 70;
/** Fable: mood spreads speed from 0.9 to 1.1. */
export const MOOD_SPEED_BASE = 0.9;
export const MOOD_SPEED_RANGE = 0.2;
/** Fable: mountains slow the train to 0.8. */
export const MOUNTAIN_SPEED = 0.8;
/** Party morale that maps to the top and bottom of the mood range. */
export const MORALE_SPEED_SPAN = 20;
/** Sub-step so a settlement edge or mountain line is not skipped. */
const ADVANCE_STEP_TU = 0.25;

/**
 * Who sets the route. A leader or a solo traveller edits it. A passenger
 * rides a route someone else set and cannot change it.
 */
export type CaravanRole = 'leader' | 'solo' | 'passenger';

export interface CaravanTarget {
  x: number;
  y: number;
  /** Settlement, POI, or null for open land. */
  name: string | null;
  /** Settlement id when the target is a settlement. */
  placeId: string | null;
}

export interface CaravanState {
  x: number;
  y: number;
  /** Map yaw. 0 faces north (−y), like the hero. */
  yaw: number;
  role: CaravanRole;
  /**
   * Hook for NPC-led caravans. Null when the player leads or travels solo.
   * A passenger's caravan names its leader here; a later step lets that
   * leader's routine set the route.
   */
  leaderId: string | null;
  /** Flat polyline, `[x0, y0, x1, y1, …]` in fine tiles. Empty without a route. */
  route: number[];
  /** Fine tiles travelled along `route`. */
  along: number;
  /** Polyline length in fine tiles. */
  length: number;
  /** Destination is the last target. Earlier ones are waypoints. */
  targets: CaravanTarget[];
  halted: boolean;
  /** Settlement the caravan is stopped in or set out from. It will not re-halt there. */
  stopId: string | null;
  /** Day index (`floor(clockHours / 24)`) that `todayUnits` counts. */
  todayDay: number;
  todayUnits: number;
}

export interface CaravanPlace {
  id: string;
  name: string;
}

export interface CaravanStepEnv {
  /** Day index for the "distance today" counter. */
  day: number;
  /** Speed modifier at a fine-tile point. */
  speedAt(x: number, y: number): number;
  /** Settlement under a point, if any. */
  settlementAt(x: number, y: number): CaravanPlace | null;
}

export type CaravanEvent =
  { type: 'arrived'; name: string | null } | { type: 'stopped'; name: string };

export function createCaravan(x: number, y: number, role: CaravanRole = 'leader'): CaravanState {
  return {
    x,
    y,
    yaw: 0,
    role,
    leaderId: null,
    route: [],
    along: 0,
    length: 0,
    targets: [],
    halted: false,
    stopId: null,
    todayDay: 0,
    todayUnits: 0,
  };
}

export function canEditRoute(caravan: CaravanState): boolean {
  return caravan.role !== 'passenger';
}

export function hasRoute(caravan: CaravanState): boolean {
  return caravan.route.length >= 4 && caravan.length > 0;
}

export function isRolling(caravan: CaravanState): boolean {
  return hasRoute(caravan) && !caravan.halted && caravan.along < caravan.length;
}

/** Fable `speedMod`: mood 0.9–1.1, mountains ×0.8, and a wagon-condition hook. */
export function caravanSpeedMod(input: {
  morale: number;
  inMountains: boolean;
  /** 0..1 wagon condition factor. Omit for a sound wagon. */
  wagonFactor?: number;
}): number {
  const morale = Number.isFinite(input.morale) ? input.morale : 0;
  const t = Math.min(1, Math.max(0, 0.5 + morale / (2 * MORALE_SPEED_SPAN)));
  let mod = MOOD_SPEED_BASE + MOOD_SPEED_RANGE * t;
  if (input.inMountains) mod *= MOUNTAIN_SPEED;
  const wagon = input.wagonFactor;
  if (wagon !== undefined && Number.isFinite(wagon)) mod *= Math.min(1, Math.max(0, wagon));
  return mod;
}

export function tilesToUnits(tiles: number): number {
  return tiles / CARAVAN_TILES_PER_UNIT;
}

export function unitsToTiles(units: number): number {
  return units * CARAVAN_TILES_PER_UNIT;
}

export function remainingUnits(caravan: CaravanState): number {
  if (!hasRoute(caravan)) return 0;
  return tilesToUnits(Math.max(0, caravan.length - caravan.along));
}

/** TU to the destination at `speedMod`. Null without a route. */
export function etaTu(caravan: CaravanState, speedMod: number): number | null {
  if (!hasRoute(caravan)) return null;
  const rate = CARAVAN_UNITS_PER_TU * (speedMod > 0 ? speedMod : 1);
  return remainingUnits(caravan) / rate;
}

/**
 * Replace the route. `points` start at the caravan. A route set inside a
 * settlement remembers it so the caravan does not halt before it leaves.
 */
export function setRoute(
  caravan: CaravanState,
  points: readonly Vec2[],
  targets: readonly CaravanTarget[],
  startPlace: CaravanPlace | null,
): CaravanState {
  const route = flatten(points);
  return {
    ...caravan,
    route,
    along: 0,
    length: flatLength(route),
    targets: targets.map((t) => ({ ...t })),
    halted: false,
    stopId: startPlace?.id ?? null,
  };
}

/** Append a leg that starts at the current route end. */
export function appendRoute(
  caravan: CaravanState,
  points: readonly Vec2[],
  target: CaravanTarget,
): CaravanState {
  if (!hasRoute(caravan)) return caravan;
  const extra = flatten(points.slice(1));
  const route = [...caravan.route, ...extra];
  return {
    ...caravan,
    route,
    length: flatLength(route),
    targets: [...caravan.targets.map((t) => ({ ...t })), { ...target }],
  };
}

export function clearRoute(caravan: CaravanState): CaravanState {
  return { ...caravan, route: [], along: 0, length: 0, targets: [], halted: false };
}

/** Point `along` fine tiles down a flat route, with its heading. */
export function pointAlong(
  route: readonly number[],
  along: number,
): { x: number; y: number; yaw: number } {
  const count = route.length >> 1;
  if (count === 0) return { x: 0, y: 0, yaw: 0 };
  let left = Math.max(0, along);
  for (let i = 1; i < count; i++) {
    const ax = route[(i - 1) * 2]!;
    const ay = route[(i - 1) * 2 + 1]!;
    const bx = route[i * 2]!;
    const by = route[i * 2 + 1]!;
    const seg = Math.hypot(bx - ax, by - ay);
    if (left <= seg || i === count - 1) {
      const t = seg > 1e-9 ? Math.min(1, left / seg) : 1;
      const yaw = seg > 1e-9 ? Math.atan2(bx - ax, -(by - ay)) : 0;
      return { x: ax + (bx - ax) * t, y: ay + (by - ay) * t, yaw };
    }
    left -= seg;
  }
  return { x: route[0]!, y: route[1]!, yaw: 0 };
}

/** Split the route at the caravan: travelled part and what is left. Flat arrays. */
export function splitRoute(caravan: CaravanState): { done: number[]; rest: number[] } {
  const route = caravan.route;
  const count = route.length >> 1;
  if (count < 2) return { done: [], rest: [] };
  const done: number[] = [route[0]!, route[1]!];
  let left = caravan.along;
  let i = 1;
  for (; i < count; i++) {
    const ax = route[(i - 1) * 2]!;
    const ay = route[(i - 1) * 2 + 1]!;
    const bx = route[i * 2]!;
    const by = route[i * 2 + 1]!;
    const seg = Math.hypot(bx - ax, by - ay);
    if (left < seg) break;
    left -= seg;
    done.push(bx, by);
  }
  if (i >= count) return { done, rest: [] };
  const here = pointAlong(route, caravan.along);
  done.push(here.x, here.y);
  const rest: number[] = [here.x, here.y];
  for (let j = i; j < count; j++) rest.push(route[j * 2]!, route[j * 2 + 1]!);
  return { done, rest };
}

/**
 * Roll the caravan for `tu` of clock time. Halted or routeless caravans do
 * not move. Entering a settlement that is not the destination halts the
 * caravan; reaching the route end clears the route.
 */
export function advanceCaravan(
  caravan: CaravanState,
  tu: number,
  env: CaravanStepEnv,
): { caravan: CaravanState; events: CaravanEvent[]; units: number } {
  const events: CaravanEvent[] = [];
  let next = caravan;
  if (next.todayDay !== env.day) next = { ...next, todayDay: env.day, todayUnits: 0 };
  if (!(tu > 0) || !isRolling(next)) return { caravan: next, events, units: 0 };
  next = { ...next };
  const dest = next.targets.at(-1) ?? null;
  let left = tu;
  let units = 0;
  while (left > 1e-9) {
    const step = Math.min(left, ADVANCE_STEP_TU);
    left -= step;
    const speed = Math.max(0, env.speedAt(next.x, next.y));
    const du = step * CARAVAN_UNITS_PER_TU * speed;
    const before = next.along;
    next.along = Math.min(next.length, next.along + unitsToTiles(du));
    units += tilesToUnits(next.along - before);
    const at = pointAlong(next.route, next.along);
    next.x = at.x;
    next.y = at.y;
    next.yaw = at.yaw;
    if (next.along >= next.length - 1e-6) {
      events.push({ type: 'arrived', name: dest?.name ?? null });
      const place = env.settlementAt(next.x, next.y);
      next = { ...clearRoute(next), stopId: place?.id ?? null };
      break;
    }
    const place = env.settlementAt(next.x, next.y);
    if (!place) {
      next.stopId = null;
      continue;
    }
    if (place.id === next.stopId || place.id === dest?.placeId) continue;
    next.stopId = place.id;
    next.halted = true;
    events.push({ type: 'stopped', name: place.name });
    break;
  }
  next.todayUnits += units;
  return { caravan: next, events, units };
}

export interface CaravanSave {
  x: number;
  y: number;
  yaw: number;
  role: CaravanRole;
  leaderId: string | null;
  route: number[];
  along: number;
  targets: CaravanTarget[];
  halted: boolean;
  stopId: string | null;
  todayDay: number;
  todayUnits: number;
  /** Hero riding with the caravan rather than scouting on foot. */
  heroAboard: boolean;
}

export function caravanSave(caravan: CaravanState, heroAboard: boolean): CaravanSave {
  return {
    x: caravan.x,
    y: caravan.y,
    yaw: caravan.yaw,
    role: caravan.role,
    leaderId: caravan.leaderId,
    route: [...caravan.route],
    along: caravan.along,
    targets: caravan.targets.map((t) => ({ ...t })),
    halted: caravan.halted,
    stopId: caravan.stopId,
    todayDay: caravan.todayDay,
    todayUnits: caravan.todayUnits,
    heroAboard,
  };
}

/** Read a saved caravan. Older saves have none; the caravan starts on the hero. */
export function loadCaravan(
  value: unknown,
  fallback: Vec2,
): { caravan: CaravanState; heroAboard: boolean } {
  const base = createCaravan(fallback.x, fallback.y);
  if (!value || typeof value !== 'object') return { caravan: base, heroAboard: true };
  const raw = value as Partial<CaravanSave>;
  const role: CaravanRole =
    raw.role === 'solo' || raw.role === 'passenger' || raw.role === 'leader' ? raw.role : 'leader';
  const route =
    Array.isArray(raw.route) && raw.route.length % 2 === 0 && raw.route.every(Number.isFinite)
      ? raw.route.map(Number)
      : [];
  const length = flatLength(route);
  const caravan: CaravanState = {
    x: finite(raw.x, base.x),
    y: finite(raw.y, base.y),
    yaw: finite(raw.yaw, 0),
    role,
    leaderId: typeof raw.leaderId === 'string' ? raw.leaderId : null,
    route: route.length >= 4 ? route : [],
    along: route.length >= 4 ? Math.min(length, Math.max(0, finite(raw.along, 0))) : 0,
    length: route.length >= 4 ? length : 0,
    targets: Array.isArray(raw.targets) ? raw.targets.filter(isTarget).map((t) => ({ ...t })) : [],
    halted: raw.halted === true,
    stopId: typeof raw.stopId === 'string' ? raw.stopId : null,
    todayDay: Math.max(0, Math.floor(finite(raw.todayDay, 0))),
    todayUnits: Math.max(0, finite(raw.todayUnits, 0)),
  };
  return { caravan, heroAboard: raw.heroAboard !== false };
}

function isTarget(value: unknown): value is CaravanTarget {
  if (!value || typeof value !== 'object') return false;
  const t = value as Partial<CaravanTarget>;
  return (
    Number.isFinite(t.x) &&
    Number.isFinite(t.y) &&
    (t.name === null || typeof t.name === 'string') &&
    (t.placeId === null || typeof t.placeId === 'string')
  );
}

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function flatten(points: readonly Vec2[]): number[] {
  const out: number[] = [];
  for (const p of points) out.push(p.x, p.y);
  return out;
}

function flatLength(route: readonly number[]): number {
  let total = 0;
  for (let i = 2; i + 1 < route.length; i += 2) {
    total += Math.hypot(route[i]! - route[i - 2]!, route[i + 1]! - route[i - 1]!);
  }
  return total;
}
