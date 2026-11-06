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

export interface ControllerExit {
  side?: string;
  pos?: number | { x: number; z: number };
  yaw?: number;
}

export interface EdgeBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

function sideOf(value: string | undefined): AreaExit['side'] {
  switch ((value ?? '').toLowerCase()) {
    case 'e':
    case 'east':
      return 'east';
    case 'w':
    case 'west':
      return 'west';
    case 'n':
    case 'north':
      return 'north';
    case 's':
    case 'south':
      return 'south';
    default:
      return 'south';
  }
}

/** Controller tb-exit (compass side, world pos) becomes the map's edge payload. */
export function controllerExitToMap(info: ControllerExit, bounds?: EdgeBounds | null): AreaExit {
  const side = sideOf(info.side);
  let pos = 0.5;
  const raw = info.pos;
  if (typeof raw === 'number' && Number.isFinite(raw)) pos = clamp01(raw);
  else if (raw && typeof raw === 'object' && bounds) {
    const spanX = bounds.maxX - bounds.minX || 1;
    const spanZ = bounds.maxZ - bounds.minZ || 1;
    const x = typeof raw.x === 'number' ? raw.x : bounds.minX;
    const z = typeof raw.z === 'number' ? raw.z : bounds.minZ;
    pos =
      side === 'east' || side === 'west' ? (z - bounds.minZ) / spanZ : (x - bounds.minX) / spanX;
    pos = clamp01(pos);
  }
  return {
    side,
    pos,
    yaw: typeof info.yaw === 'number' && Number.isFinite(info.yaw) ? info.yaw : 0,
  };
}

/** Esc leaves the area and returns the traveller to the map tile they entered from. */
export function exitFromCancel(yaw: number): AreaExit {
  const facingX = Math.sin(yaw);
  const facingZ = -Math.cos(yaw);
  const side: AreaExit['side'] =
    Math.abs(facingX) > Math.abs(facingZ)
      ? facingX >= 0
        ? 'east'
        : 'west'
      : facingZ >= 0
        ? 'south'
        : 'north';
  return { side, pos: 0.5, yaw, cancel: true };
}
