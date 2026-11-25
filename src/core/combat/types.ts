/** Buttons the combat core understands. The app maps keys, mouse, and pads onto these. */
export type AttackButton = 'x' | 'y';
export type ButtonKind = 'tap' | 'hold';
export type MoveButton = AttackButton | 'counter';

export interface ComboStep {
  button: AttackButton;
  kind: ButtonKind;
}

export interface MoveSpec {
  id: string;
  name: string;
  button: MoveButton;
  kind: ButtonKind;
  damage: number;
  /** Seconds before the hitbox is live. */
  startup: number;
  /** Seconds the hitbox stays live. */
  active: number;
  /** Seconds after the hitbox closes before the body is free. */
  recovery: number;
  /** Metres from the attacker's origin. */
  range: number;
  /** Half-angle of the swing, radians. */
  arc: number;
  /** Knockback speed, metres per second, applied away from the attacker. */
  knockback: number;
  /** How long the victim cannot act, seconds. */
  stagger: number;
  /** Freeze after the impact, seconds. Counts down in real step time. */
  hitStop: number;
  /** Renderer motion. Missing clips are tweened; Idle and Walk come from the body. */
  motion: string;
  hits: number;
  aoe: boolean;
  aoeRadius: number;
  /** Forward slide during the active frames, metres. */
  lunge: number;
  /** Landing this move can ask the special hook for a future minigame. */
  special: boolean;
}

export interface ComboSpec {
  id: string;
  name: string;
  sequence: readonly ComboStep[];
  moveId: string;
  /** A finisher. The string clears when it starts. */
  ender: boolean;
}

export interface CounterContext {
  weaponId: string;
  moveId: string;
  attackerId: string;
  targetId: string;
}

/**
 * A counter or special just connected. `minigameId` stays null until a real
 * minigame is registered. The fight asks {@link CombatHooks.onSpecial} and
 * pauses only when that hook answers `minigame`.
 */
export interface SpecialRequest {
  kind: 'counter' | 'special';
  weaponId: string;
  moveId: string;
  minigameId: string | null;
}

export interface WeaponBehavior {
  /** Replace the move's written damage. Omit to keep it. */
  modifyDamage?(damage: number, move: MoveSpec): number;
  /** Shape the counter hook. Omit to offer a counter with no minigame. */
  onCounter?(ctx: CounterContext): SpecialRequest | null;
  /** Shape the hook for a move flagged `special`. */
  onSpecial?(ctx: CounterContext): SpecialRequest | null;
}

export interface CombatHooks {
  onSpecial(request: SpecialRequest): 'continue' | 'minigame';
}

export interface WeaponStyle {
  id: string;
  name: string;
  blurb: string;
  /** Ground speed, metres per second. */
  moveSpeed: number;
  /** How long the counter cue stays open, before the debug slider overrides it. */
  counterWindowMs: number;
  counterMoveId: string;
  moves: readonly MoveSpec[];
  combos: readonly ComboSpec[];
  behavior?: WeaponBehavior;
}

export interface FighterInput {
  /** World-space wish. +x is east, +z is south. Already camera-relative. */
  moveX: number;
  moveZ: number;
  xDown: boolean;
  yDown: boolean;
  counterPressed: boolean;
}

export type MoveInit = Partial<MoveSpec> &
  Pick<
    MoveSpec,
    | 'id'
    | 'name'
    | 'button'
    | 'kind'
    | 'damage'
    | 'startup'
    | 'active'
    | 'recovery'
    | 'range'
    | 'arc'
    | 'knockback'
    | 'stagger'
    | 'hitStop'
    | 'motion'
  >;

export function move(init: MoveInit): MoveSpec {
  return {
    hits: 1,
    aoe: false,
    aoeRadius: 0,
    lunge: 0.18,
    special: false,
    ...init,
  };
}
