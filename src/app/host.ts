import type { ContentSource, PlaceContent } from '../core/content/parse';
import type { SaveBackend } from '../core/save/types';
import type { AreaExit, WorldState } from '../core/state/world-state';
import type { ChunkData } from '../core/world/models';
import type { Keyboard } from '../input/keyboard';
import type { MinigameHost } from '../minigames/host';
import type { MapDrawState } from '../render/map/map-renderer';
import type { PlanetGlobe } from '../render/globe/planet-globe';
import type { SceneStack } from './scene-stack';

/** Where the hero comes back to the map from a convoy area. */
export interface AreaLanding {
  x: number;
  y: number;
  yaw: number;
  /** Still with the wagons (walking beside them or on the bench). */
  aboard: boolean;
}

export type AppMode = 'boot' | 'title' | 'map' | 'transition' | 'area' | 'creator' | 'worldgen';

export interface GameHost {
  readonly stack: SceneStack;
  readonly keyboard: Keyboard;
  readonly minigames: MinigameHost;
  readonly content: ContentSource;
  readonly saves: SaveBackend;
  readonly areaCanvas: HTMLCanvasElement;
  readonly mapCanvas: HTMLCanvasElement;
  /** Static planet globe shown when the map zooms out past its furthest flat zoom. */
  readonly globe: PlanetGlobe;
  world: WorldState;
  place: PlaceContent | null;
  readonly view: 'map' | 'area';
  setMode(mode: AppMode): void;
  setView(view: 'map' | 'area'): void;
  /** Hide the map and area canvases while the character creator is open. */
  setCreatorVisible(visible: boolean): void;
  setFade(opacity: number): void;
  /** Copy the last 3D frame over the canvas so a window swap can hide behind it. */
  holdFrame(): boolean;
  /** Dissolve the held frame away over `seconds` (0 drops it at once). */
  releaseFrame(seconds: number): void;
  paintMap(state: MapDrawState): void;
  syncChunks(chunks: ChunkData[]): void;
  enterArea(): void;
  buildArea(): Promise<void>;
  enterTownNow(fixtureId: string): Promise<void>;
  leaveArea(exit?: AreaExit, opts?: { landed?: boolean; keepLayers?: boolean }): void;
  /** Put the hero back on the map for an exit, before the area is torn down. */
  landFromArea(exit: AreaExit | undefined, landing: AreaLanding | null): void;
  /** Map point the dive lands on: the caravan when the hero rides with it. */
  diveTarget(): { x: number; y: number };
  /** Map scale before the last dive in; the dive out pulls back to it. */
  mapReturnScale: number;
  /** Map camera centre (fine tiles) and scale. */
  mapPose(): { x: number; y: number; scale: number };
  /** Closest scale the 2D map draws. */
  mapCloseScale(): number;
  /** Hold the map camera on a dive frame. */
  diveMap(x: number, y: number, scale: number): void;
  endMapDive(): void;
  /**
   * The dive out has landed on the map: drop keys typed during it and lift
   * the re-entry cooldown, which the dive itself already covered.
   */
  settleMapReturn(): void;
  /** CSS magnification of the map canvas and opacity of the 3D canvas. */
  setLayers(mapMagnify: number, areaOpacity: number): void;
  /** 3D camera sweep for the dive: `in` eases down, `out` climbs. */
  areaSweep(kind: 'in' | 'out', seconds: number): void;
  /** 3D follow-camera distance in metres, or null with no area up. */
  areaCameraDistance(): number | null;
  /**
   * CSS magnification of the map at its closest scale that matches the 3D
   * view at the top of the dive, metre for metre.
   */
  diveMagnify(): number;
  enqueue(job: () => void): void;
  /** Short notice over the HUD. */
  toast(message: string): void;
}
