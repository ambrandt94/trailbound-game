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
 */
import { isRolling, type CaravanState } from './caravan';

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
