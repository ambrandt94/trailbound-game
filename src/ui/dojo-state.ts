import { signal } from '@preact/signals';

export const dojoWeapon = signal('fists');
export const dojoEnemies = signal(1);
export const dojoAggression = signal(0.65);
export const dojoAttackRate = signal(0.45);
export const dojoCounterMs = signal(280);
export const dojoTimeScale = signal(1);
export const dojoHitboxes = signal(false);
export const dojoHoldMs = signal(300);
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
}

export const dojoHud = signal<DojoHud | null>(null);
