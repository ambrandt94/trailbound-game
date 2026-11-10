import type { Camera, Scene } from 'three';
import type { MinigameResult, PartyState, WagonPlayId } from '../core/sim/party';

export type { MinigameResult, WagonPlayId };

export type MinigameKind = 'world' | 'pop2d' | 'pop3d' | 'inst';
export type MinigameSize = 'full' | 'part';

/** Stick from the shared area actions, plus the overlay pointer. */
export interface MinigameStick {
  x: number;
  y: number;
  hold: boolean;
}

export interface MinigamePointer {
  /** 0..1 across the game surface. */
  x: number;
  y: number;
  down: boolean;
  dx: number;
  dy: number;
  tap: boolean;
  press: boolean;
  dragX: number;
  dragY: number;
  moved: boolean;
}

export interface MinigameHelpers {
  clamp(value: number, min: number, max: number): number;
  /** True when a 0..1 sweep sits inside the window. */
  hot(phase: number, start: number, end: number): boolean;
}

export interface WorldPose {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

export interface MinigameContext {
  in: MinigameStick;
  pointer: MinigamePointer;
  /** Space, F, jump, or a tap on the overlay this frame. */
  act: boolean;
  quit: boolean;
  canvas: HTMLCanvasElement | null;
  /** 2D drawing context. Pop games are sized in game pixels (`W` by `H`). */
  gfx: CanvasRenderingContext2D | null;
  scene: Scene | null;
  camera: Camera | null;
  /** Live town scene for world games. */
  worldScene: Scene | null;
  pose: WorldPose | null;
  /** Instance avatar. Null until an instanced game starts. */
  A: import('./helpers/runtime').SimAvatar | null;
  camYaw: number;
  syncAvatar?(avatar: import('./helpers/runtime').SimAvatar): void;
  hud: HTMLElement | null;
  side: HTMLElement | null;
  width: number;
  height: number;
  /** Game-pixel size of a pop2d canvas. */
  W: number;
  H: number;
  t: number;
  over: boolean;
  supplies: PartyState;
  helpers: MinigameHelpers;
  done(result: MinigameResult): void;
}

export interface MinigameStatus {
  hot: boolean;
  hits: number;
  beat: number;
  detail: string;
}

export interface MinigameDef {
  id: string;
  name: string;
  type: MinigameKind;
  size?: MinigameSize;
  /**
   * Pop2d game-pixel height (controller `h`). Values at or under 200 size the
   * canvas in game pixels. Taller values are the wagon popup's CSS height.
   */
  h?: number;
  drag?: boolean;
  /** Wagon games set this so a miss spends half that activity's TU. */
  activity?: WagonPlayId;
  start(g: MinigameContext): void;
  update(g: MinigameContext, dt: number): void;
  end?(g: MinigameContext): void;
  status?(g: MinigameContext): MinigameStatus;
}
