import type { ContentSource, PlaceContent } from '../core/content/parse';
import type { SaveBackend } from '../core/save/types';
import type { AreaExit, WorldState } from '../core/state/world-state';
import type { Keyboard } from '../input/keyboard';
import type { SceneStack } from './scene-stack';

export type AppMode = 'boot' | 'title' | 'map' | 'transition' | 'area';

export interface GameHost {
  readonly stack: SceneStack;
  readonly keyboard: Keyboard;
  readonly content: ContentSource;
  readonly saves: SaveBackend;
  readonly areaCanvas: HTMLCanvasElement;
  world: WorldState;
  place: PlaceContent | null;
  readonly view: 'map' | 'area';
  setMode(mode: AppMode): void;
  setView(view: 'map' | 'area'): void;
  setFade(opacity: number): void;
  paintMap(pose: { x: number; y: number; yaw: number }): void;
  buildArea(): void;
  leaveArea(exit?: AreaExit): void;
  enqueue(job: () => void): void;
}
