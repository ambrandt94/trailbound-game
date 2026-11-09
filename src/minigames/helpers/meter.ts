import type { MinigameHelpers } from '../types';

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/** `phase` is 0..1 across one beat. The window is inclusive. */
export function meterHot(phase: number, start: number, end: number): boolean {
  const wrapped = ((phase % 1) + 1) % 1;
  return wrapped >= start && wrapped <= end;
}

export const minigameHelpers: MinigameHelpers = {
  clamp,
  hot: meterHot,
};
