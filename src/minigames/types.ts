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
}

export interface MinigameHelpers {
  clamp(value: number, min: number, max: number): number;
  /** True when a 0..1 sweep sits inside the window. */
  hot(phase: number, start: number, end: number): boolean;
}

export interface MinigameContext {
  in: MinigameStick;
  pointer: MinigamePointer;
  /** Space, F, jump, or a tap on a game that is not drag-driven. */
  act: boolean;
  quit: boolean;
  canvas: HTMLCanvasElement | null;
  scene: Scene | null;
  camera: Camera | null;
  width: number;
  height: number;
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
  /** Part-popup height in CSS pixels. */
  h?: number;
  drag?: boolean;
  /** Wagon games set this so a miss spends half that activity's TU. */
  activity?: WagonPlayId;
  start(g: MinigameContext): void;
  update(g: MinigameContext, dt: number): void;
  end?(g: MinigameContext): void;
  status?(g: MinigameContext): MinigameStatus;
}
