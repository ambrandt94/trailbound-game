import {
  CARAVAN_DAY_GOAL_UNITS,
  canEditRoute,
  etaTu,
  hasRoute,
  remainingUnits,
} from '../core/sim/caravan';
import { tuOfDay } from '../core/sim/time';
import type { WorldState } from '../core/state/world-state';
import type { ConvoyHud, TravelHud } from '../ui/state';

/** Caravan readout shared by the map HUD and the 3D convoy HUD. */
export function travelHudFor(
  world: WorldState,
  extra: { clockPaused: boolean; view: 'map' | 'area'; convoy: ConvoyHud | null },
): TravelHud {
  const caravan = world.caravan;
  const tu = tuOfDay(world.clockHours);
  const day = Math.floor(world.clockHours / 24) + 1;
  const speed = world.caravanSpeedAt();
  const routed = hasRoute(caravan);
  const eta = routed ? etaTu(caravan, speed) : null;
  const today = caravan.todayDay === day - 1 ? caravan.todayUnits : 0;
  return {
    role: caravan.role,
    editable: canEditRoute(caravan),
    hasRoute: routed,
    halted: caravan.halted,
    aboard: world.heroAboard,
    day,
    tu,
    todayUnits: today,
    goalUnits: CARAVAN_DAY_GOAL_UNITS,
    destName: caravan.targets.at(-1)?.name ?? 'the marked spot',
    waypoints: Math.max(0, caravan.targets.length - 1),
    remainingUnits: remainingUnits(caravan),
    eta: eta === null ? '' : formatEta(eta, day, tu, caravan.halted),
    speed,
    ...extra,
  };
}

/** Change key so the HUD signal only updates when something visible moved. */
export function travelHudKey(hud: TravelHud): string {
  return [
    hud.role,
    hud.hasRoute,
    hud.halted,
    hud.aboard,
    hud.day,
    Math.floor(hud.tu),
    Math.floor(hud.todayUnits),
    hud.destName,
    hud.waypoints,
    Math.ceil(hud.remainingUnits),
    hud.eta,
    hud.speed.toFixed(2),
    hud.clockPaused,
    hud.view,
    hud.convoy
      ? `${hud.convoy.mode}:${hud.convoy.leash}:${Math.round(hud.convoy.dist)}:${hud.convoy.gone === true}`
      : '-',
  ].join('|');
}

/**
 * "≈ 38 TU · Day 2, 88 TU left". The arrival time counts TU left in that day,
 * the same way the day-cycle HUD does. Halted adds a note: the wagons wait
 * until they roll again.
 */
export function formatEta(tuLeft: number, day: number, tu: number, halted: boolean): string {
  const left = Math.max(0, Math.ceil(tuLeft));
  const at = tu + left;
  const arriveDay = day + Math.floor(at / 100);
  const arriveLeft = Math.min(100, Math.max(0, Math.ceil(100 - (at % 100) - 1e-6)));
  const base = `≈ ${left} TU · Day ${arriveDay}, ${arriveLeft} TU left`;
  return halted ? `${base} once rolling` : base;
}
