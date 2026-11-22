/**
 * World Gen screen state. New worlds edit the creator's draft (`newWorldGen`,
 * `newWorldSeed`); an existing world opens read-only with its own settings.
 * Inspected chunks live only while the screen is open (the scene's LRU).
 */
import { signal } from '@preact/signals';
import type { ChunkAddr, StartCandidate } from '../core/planet';
import type { Biome, WorldSettings } from '../core/world/models';

export type WgMode = 'globe' | 'flat' | 'chunk';

export interface WgLayers {
  biomes: boolean;
  height: boolean;
  mask: boolean;
  grid: boolean;
  ice: boolean;
  start: boolean;
}

export const DEFAULT_WG_LAYERS: WgLayers = {
  biomes: true,
  height: false,
  mask: false,
  grid: true,
  ice: false,
  start: true,
};

export interface WgBakeView {
  state: 'idle' | 'baking' | 'preview' | 'ready' | 'error';
  /** 0..1 of the bake in flight. */
  progress: number;
  /** Land share by area of the last bake. */
  landShare: number;
  ms: number;
  message: string;
}

/** What the inspector shows for the selected chunk (from the planet, before any local map). */
export interface WgInspect {
  addr: ChunkAddr;
  latDeg: number;
  lonDeg: number;
  /** Planet land share, 0..1. */
  land: number;
  minM: number;
  maxM: number;
  biomes: Array<{ biome: Biome; share: number }>;
  /** Start score on the auto-pick scale (best ≈ 0.5–0.9), and its neighbours' land. */
  score: number;
  around: number;
}

export interface WgChunkView {
  addr: ChunkAddr;
  state: 'generating' | 'ready' | 'error';
  /** `performance.now()` when the job started. */
  startedAt: number;
  /** Estimated generation time, ms (for the progress bar). */
  estimateMs: number;
  genMs: number;
  cached: boolean;
  land: number;
  minM: number;
  maxM: number;
  towns: number;
  tiles: number;
  message: string;
}

/** Read-only view of an existing world (opened from the map or pause menu). */
export interface WgExisting {
  seed: number;
  settings: WorldSettings;
}

export const wgExisting = signal<WgExisting | null>(null);
export const wgMode = signal<WgMode>('globe');
export const wgLayers = signal<WgLayers>({ ...DEFAULT_WG_LAYERS });
export const wgBake = signal<WgBakeView>({
  state: 'idle',
  progress: 0,
  landShare: 0,
  ms: 0,
  message: '',
});
export const wgStarts = signal<StartCandidate[]>([]);
/** The start in use: the auto pick, a reroll, or a hand pick. */
export const wgStart = signal<{ addr: ChunkAddr; how: 'auto' | 'reroll' | 'pick' } | null>(null);
export const wgPickStart = signal(false);
export const wgInspect = signal<WgInspect | null>(null);
export const wgChunk = signal<WgChunkView | null>(null);
/** Chunk keys held in the inspector cache, most recent last. */
export const wgCached = signal<string[]>([]);
/** Ticks while a chunk generates so the progress bar moves. */
export const wgClock = signal(0);

export interface WorldGenCommands {
  setSettings(patch: Partial<WorldSettings>): void;
  setSeed(seed: number): void;
  rerollSeed(): void;
  setMode(mode: WgMode): void;
  setLayers(patch: Partial<WgLayers>): void;
  autoStart(): void;
  rerollStart(): void;
  togglePickStart(): void;
  /** Generate (or reuse) a chunk's local map and show it. */
  openChunk(addr: ChunkAddr): void;
  cancelChunk(): void;
  /** From the chunk view back to the globe or world map it was opened from. */
  backToPlanet(): void;
  /** New world: go on to the character. */
  confirm(): void;
  /** New world with every default (Trailbound, auto start). */
  quickStart(): void;
  /** Back to the title, or back to the game for an existing world. */
  close(): void;
}

export const wgCommands: WorldGenCommands = {
  setSettings() {},
  setSeed() {},
  rerollSeed() {},
  setMode() {},
  setLayers() {},
  autoStart() {},
  rerollStart() {},
  togglePickStart() {},
  openChunk() {},
  cancelChunk() {},
  backToPlanet() {},
  confirm() {},
  quickStart() {},
  close() {},
};

export function bindWorldGen(next: WorldGenCommands): void {
  Object.assign(wgCommands, next);
}
