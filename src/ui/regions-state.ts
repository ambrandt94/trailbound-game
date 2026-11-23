/**
 * Regions (R1) debug state: the World Gen "Regions" tab and its own debug
 * panel. Everything is simulated; nothing here is saved.
 */
import { signal } from '@preact/signals';
import type { ChunkAddr, Rumor } from '../core/planet';

export type RegionsExplore = 'block' | 'walk' | 'journey';
export type RegionsTool = 'visit' | 'rumor' | 'waypoint' | 'centre';
export type RegionsClouds = 'art' | 'procedural' | 'off';

export interface RegionsDebug {
  /** Centre / home chunk of the simulation (null: the world's start chunk). */
  centre: ChunkAddr | null;
  explore: RegionsExplore;
  /** Block side, chunks (1 → 2×2 → N×N). */
  block: number;
  walkSteps: number;
  walkSeed: number;
  kAuto: boolean;
  k: number;
  bendAuto: boolean;
  bend: number;
  /** Chunks across at which the view starts to bend, and where the globe is whole. */
  bendStart: number;
  spanFull: number;
  margin: number;
  fog: boolean;
  clouds: RegionsClouds;
  density: number;
  drift: number;
  coverTile: 'A' | 'B';
  maskView: boolean;
  truth: boolean;
  /** Days skipped past the last visit (fade preview). */
  timeSkip: number;
  /** Draw known chunks from their own maps (generated in the background). */
  detail: boolean;
  /** Detail map scale: 1× is fast (preview), 'world' matches the world's scale. */
  detailScale: 1 | 4 | 'world';
  tool: RegionsTool;
  rumorConfidence: number;
  rumorDirection: boolean;
  /** Journey playback speed, chunks per second. */
  playSpeed: number;
  /** Debug panel collapsed. */
  collapsed: boolean;
}

export const DEFAULT_REGIONS_DEBUG: RegionsDebug = {
  centre: null,
  explore: 'block',
  block: 1,
  walkSteps: 40,
  walkSeed: 1,
  kAuto: true,
  k: 0.5,
  bendAuto: true,
  bend: 0,
  bendStart: 5,
  spanFull: 20,
  margin: 1.2,
  fog: true,
  clouds: 'art',
  density: 0.8,
  drift: 1,
  coverTile: 'A',
  maskView: false,
  truth: false,
  timeSkip: 0,
  detail: true,
  detailScale: 1,
  tool: 'visit',
  rumorConfidence: 0.5,
  rumorDirection: true,
  playSpeed: 3,
  collapsed: false,
};

export interface RegionsReadout {
  known: number;
  glimpsed: number;
  span: number;
  km: number;
  k: number;
  bend: number;
  visibleDeg: number;
  chunkPx: number;
  pixel: number;
  today: number;
  /** Frame-to-frame time (avg of the last 60), and the GPU / overlay share, ms. */
  frameMs: number;
  frameMax: number;
  drawMs: number;
  overlayMs: number;
  stamps: number;
  detailReady: number;
  detailQueued: number;
  atlas: 'loaded' | 'loading' | 'failed';
  view: 'you' | 'rumor' | 'isolated';
}

export const regionsDebug = signal<RegionsDebug>({ ...DEFAULT_REGIONS_DEBUG });
export const regionsReadout = signal<RegionsReadout | null>(null);
export const regionsRumors = signal<Rumor[]>([]);
export const regionsSelected = signal<number | null>(null);
export const regionsJourney = signal<{
  waypoints: number;
  length: number;
  progress: number;
  playing: boolean;
}>({ waypoints: 0, length: 0, progress: 0, playing: false });
/** The codex line after an arrival: what was said versus what is there. */
export const regionsNote = signal<{ heard: string; source: string; found: string } | null>(null);

export interface RegionsCommands {
  setDebug(patch: Partial<RegionsDebug>): void;
  reset(): void;
  newWalk(): void;
  clearVisits(): void;
  playJourney(): void;
  pauseJourney(): void;
  rewindJourney(): void;
  clearWaypoints(): void;
  select(id: number | null): void;
  showMe(id: number): void;
  backToMe(): void;
  arrive(id: number): void;
  forget(id: number): void;
  clearRumors(): void;
  recentre(): void;
}

export const regionsCommands: RegionsCommands = {
  setDebug() {},
  reset() {},
  newWalk() {},
  clearVisits() {},
  playJourney() {},
  pauseJourney() {},
  rewindJourney() {},
  clearWaypoints() {},
  select() {},
  showMe() {},
  backToMe() {},
  arrive() {},
  forget() {},
  clearRumors() {},
  recentre() {},
};

export function bindRegions(next: RegionsCommands): void {
  Object.assign(regionsCommands, next);
}
