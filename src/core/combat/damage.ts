import type { MoveSpec, WeaponStyle } from './types';

/** Damage one hit of a move deals. A style behavior may scale it. */
export function hitDamage(style: WeaponStyle, move: MoveSpec): number {
  const base = Math.max(0, move.damage);
  const next = style.behavior?.modifyDamage?.(base, move) ?? base;
  return Math.max(0, next);
}
