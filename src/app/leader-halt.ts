import type { WorldState } from '../core/state/world-state';

/** What the leader's Halt / Roll out command needs from the app: the world and a toast. */
export interface LeaderHaltHost {
  readonly world: WorldState;
  toast(message: string): void;
}

/**
 * The one Halt / Roll out command. The H key on the map, the H key in 3D wilds
 * and 3D towns, the toolbar button, and the caravan-card button all call this,
 * so the caravan answers the leader the same way wherever the hero stands.
 */
export function leaderToggleHalt(host: LeaderHaltHost): boolean {
  const result = host.world.toggleCaravanHalt();
  host.toast(result.message);
  return result.ok;
}
