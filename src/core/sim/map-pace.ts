/**
 * Overworld pace settings, pure so they test without a browser.
 *
 * Two knobs, both map-only:
 * - "Time moves only when I move": the map clock, the caravan, and every
 *   other map mover stand still until the hero walks.
 * - Map speed (1x/2x/4x/8x): scales the hero's walk, the caravan, every other
 *   map mover, and the map clock together.
 *
 * 3D areas ignore both. They always run at 1x and the clock keeps going.
 *
 * On-foot speed is a third map-only knob: the hero's own pace as a multiple of
 * the wagon's map pace, so a scout is only a little quicker than the caravan.
 */
import {
  CARAVAN_METERS_PER_UNIT,
  CARAVAN_UNITS_PER_TU,
  isRolling,
  type CaravanState,
} from './caravan';
import { HOURS_PER_TU } from './time';

export const MAP_SPEEDS = [1, 2, 4, 8] as const;
export type MapSpeed = (typeof MAP_SPEEDS)[number];
export const DEFAULT_MAP_SPEED: MapSpeed = 1;
export const DEFAULT_TIME_ONLY_WHEN_MOVING = true;

/** Anything that is not one of the four steps falls back to 1x. */
export function normalizeMapSpeed(value: unknown): MapSpeed {
  const n = typeof value === 'string' ? Number(value) : value;
  return MAP_SPEEDS.find((speed) => speed === n) ?? DEFAULT_MAP_SPEED;
}

export function formatMapSpeed(speed: MapSpeed): string {
  return `${speed}x`;
}

/**
 * True when the map clock should run this frame.
 *
 * With "time moves only when I move" on, only the hero's own walk runs it:
 * a rolling caravan waits for the hero. With it off the caravan rolls on its
 * own, as before.
 */
export function mapTimeRuns(
  caravan: CaravanState,
  heroMoving: boolean,
  onlyWhenMoving: boolean,
): boolean {
  if (heroMoving) return true;
  if (onlyWhenMoving) return false;
  return isRolling(caravan);
}

/**
 * Status word on the caravan panel. On the map the wagons wait for the hero
 * whenever the clock is paused; in 3D they simply roll.
 */
export function caravanStatus(hud: {
  hasRoute: boolean;
  halted: boolean;
  clockPaused: boolean;
  view: 'map' | 'area';
}): 'No route' | 'Halted' | 'Waiting' | 'Rolling' {
  if (!hud.hasRoute) return 'No route';
  if (hud.halted) return 'Halted';
  return hud.view === 'map' && hud.clockPaused ? 'Waiting' : 'Rolling';
}

/** On-foot speed on the map, as a multiple of the wagon's map pace. */
export const ON_FOOT_MIN = 1;
export const ON_FOOT_MAX = 2;
export const ON_FOOT_STEP = 0.05;
export const DEFAULT_ON_FOOT_SPEED = 1.25;
/** Shift sprints at this multiple of the walk, as everywhere else. */
export const ON_FOOT_SPRINT_RATIO = 2;

/** Clamp to 1.0–2.0 and snap to 0.05. Anything that is not a number falls back to 1.25. */
export function normalizeOnFootSpeed(value: unknown): number {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n)) return DEFAULT_ON_FOOT_SPEED;
  const clamped = Math.min(ON_FOOT_MAX, Math.max(ON_FOOT_MIN, n));
  return Math.round(Math.round(clamped / ON_FOOT_STEP) * ON_FOOT_STEP * 100) / 100;
}

export function formatOnFootSpeed(speed: number): string {
  return `${normalizeOnFootSpeed(speed).toFixed(2)}x`;
}

/**
 * The wagon's map pace in metres per game second at an even mood: one road
 * unit (32 m) per TU. This is what the caravan rolls at on the overworld.
 */
export function wagonMapPaceMps(): number {
  return (CARAVAN_METERS_PER_UNIT * CARAVAN_UNITS_PER_TU) / (HOURS_PER_TU * 3600);
}

/**
 * Pace the hero walks (and the clock charges) on the overworld, metres per
 * game second: the wagon's pace times the on-foot multiplier. Sprint doubles it.
 */
export function onFootPaceMps(multiplier: number, sprint = false): number {
  const pace = wagonMapPaceMps() * normalizeOnFootSpeed(multiplier);
  return sprint ? pace * ON_FOOT_SPRINT_RATIO : pace;
}

/**
 * The 3D clock for one step. 3D time does not depend on input and ignores the
 * map's "time moves only when I move" setting: it runs every frame unless the
 * game is paused (a minigame popup or instance is up).
 *
 * - Paused: nothing.
 * - Wagon rolling: the road it covered, paid by distance (`roadHours`).
 * - Otherwise (halted at camp, no route, arrived): the area clock at
 *   `areaHoursPerRealSec`, so time keeps passing while the wagon stands.
 */
export function areaClockHours(input: {
  paused: boolean;
  dt: number;
  roadHours: number | null;
  areaHoursPerRealSec: number;
}): number {
  if (input.paused || !(input.dt > 0)) return 0;
  if (input.roadHours !== null) return Math.max(0, input.roadHours);
  return Math.max(0, input.dt * input.areaHoursPerRealSec);
}
