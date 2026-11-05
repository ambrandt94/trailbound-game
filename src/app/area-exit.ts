import type { AreaExit } from '../core/state/world-state';

export type { AreaExit };

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/**
 * Area space: +x east, +z south, yaw 0 faces north.
 * Returns an exit once the pawn center crosses the ground edge.
 */
export function exitFromPose(x: number, z: number, yaw: number, half = 8): AreaExit | null {
  const east = x - half;
  const west = -half - x;
  const south = z - half;
  const north = -half - z;
  const over = Math.max(east, west, south, north);
  if (over <= 0) return null;
  const span = half * 2;
  const alongZ = clamp01((z + half) / span);
  const alongX = clamp01((x + half) / span);
  if (over === east) return { side: 'east', pos: alongZ, yaw };
  if (over === west) return { side: 'west', pos: alongZ, yaw };
  if (over === south) return { side: 'south', pos: alongX, yaw };
  return { side: 'north', pos: alongX, yaw };
}

/** Esc leaves through the side the pawn is facing, at the middle of that edge. */
export function exitFromCancel(yaw: number): AreaExit {
  const facingX = Math.sin(yaw);
  const facingZ = -Math.cos(yaw);
  if (Math.abs(facingX) > Math.abs(facingZ)) {
    return { side: facingX >= 0 ? 'east' : 'west', pos: 0.5, yaw };
  }
  return { side: facingZ >= 0 ? 'south' : 'north', pos: 0.5, yaw };
}
