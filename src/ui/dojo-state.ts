import { signal } from '@preact/signals';
import { DEFAULT_MOTOR } from '../core/combat/motor';

export const dojoWeapon = signal('fists');
export const dojoEnemies = signal(1);
export const dojoAggression = signal(0.65);
export const dojoAttackRate = signal(0.45);
export const dojoCounterMs = signal(280);
export const dojoTimeScale = signal(1);
export const dojoHitboxes = signal(false);
export const dojoHoldMs = signal(300);
export const dojoLockHoldMs = signal(250);
export const dojoAccel = signal(DEFAULT_MOTOR.accel);
export const dojoBrake = signal(DEFAULT_MOTOR.brake);
export const dojoTurn = signal(DEFAULT_MOTOR.turnRate);
export const dojoSprint = signal(DEFAULT_MOTOR.sprintMul);
export const dojoLockedSpeed = signal(DEFAULT_MOTOR.lockedSpeed);
export const dojoLockedAccel = signal(DEFAULT_MOTOR.lockedAccel);
export const dojoDodgeDistance = signal(DEFAULT_MOTOR.evadeDistance);
export const dojoDodgeTime = signal(DEFAULT_MOTOR.evadeDuration);
export const dojoDodgeCooldown = signal(DEFAULT_MOTOR.evadeCooldown);
export const dojoIFrames = signal(DEFAULT_MOTOR.evadeIFrames);
export const dojoNotice = signal('');

export interface DojoHudEnemy {
  id: string;
  hp: number;
  max: number;
  telegraph: string;
}

export interface DojoHud {
  playerHp: number;
  playerMax: number;
  enemies: DojoHudEnemy[];
  move: string | null;
  ready: number;
  lockId: string | null;
  gait: string;
  charge: number;
  evade: string | null;
}

export const dojoHud = signal<DojoHud | null>(null);
