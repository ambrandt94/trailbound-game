import type { ContentSource, PlaceContent } from '../core/content/parse';
import type { SaveBackend } from '../core/save/types';
import type { AreaExit, WorldState } from '../core/state/world-state';
import type { ChunkData } from '../core/world/models';
import type { Keyboard } from '../input/keyboard';
import type { MapDrawState } from '../render/map/map-renderer';
import type { SceneStack } from './scene-stack';

export type AppMode = 'boot' | 'title' | 'map' | 'transition' | 'area' | 'creator';

export interface GameHost {
  readonly stack: SceneStack;
  readonly keyboard: Keyboard;
  readonly content: ContentSource;
  readonly saves: SaveBackend;
  readonly areaCanvas: HTMLCanvasElement;
  readonly mapCanvas: HTMLCanvasElement;
  world: WorldState;
  place: PlaceContent | null;
  readonly view: 'map' | 'area';
  setMode(mode: AppMode): void;
  setView(view: 'map' | 'area'): void;
  /** Hide the map and area canvases while the character creator is open. */
  setCreatorVisible(visible: boolean): void;
  setFade(opacity: number): void;
  paintMap(state: MapDrawState): void;
  syncChunks(chunks: ChunkData[]): void;
  enterSettlement(): void;
  buildArea(): void;
  leaveArea(exit?: AreaExit): void;
  enqueue(job: () => void): void;
}
