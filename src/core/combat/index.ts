import './weapons/fists';
import './weapons/axe';
import './weapons/hammer';
import './weapons/daggers';
import './weapons/sword-shield';

export { AttackBuffer } from './buffer';
export type { AttackEdge } from './buffer';
export { createComboResolver } from './combo';
export type { ResolvedCombo } from './combo';
export { hitDamage } from './damage';
export {
  LOCK_HOLD_MS,
  LockGestureBuffer,
  applyLockTap,
  clockwiseSweep,
  nearestFoe,
  nextClockwise,
  retargetLock,
} from './lock';
export type { LockBody, LockFoe, LockGesture, LockPoint } from './lock';
export { createFight, IDLE_INPUT, ENEMY_MAX_HP, PLAYER_MAX_HP } from './fight';
export type { Fight, FightSnapshot, FightTuning, FighterView, CombatEvent } from './fight';
export { weaponById, weapons } from './registry';
export type {
  AttackButton,
  ButtonKind,
  CombatHooks,
  ComboSpec,
  ComboStep,
  FighterInput,
  MoveSpec,
  SpecialRequest,
  WeaponBehavior,
  WeaponStyle,
} from './types';
