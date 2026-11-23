/**
 * World Gen worker jobs, shared by the module worker and the main-thread
 * fallback (tests, browsers without module workers).
 *
 * - `bake`: the whole planet as equirect layers plus the start candidates.
 * - `chunk`: one chunk's full local map, generated like the real thing and
 *   squeezed into an inspector raster. Never saved, never seen by game logic.
 */
import {
  bakeWorld,
  chunkRaster,
  makePlanetField,
  PLANET_PRESET_SPECS,
  rankStartChunks,
  startChoices,
  type ChunkAddr,
  type ChunkRaster,
  type StartCandidate,
  type WorldBake,
} from '../../core/planet';
import type { WorldSettings } from '../../core/world/models';
import { generateChunkAt } from '../../core/world/world-gen';
import { planetFrame, settingsShape } from '../../core/world/planet-chunk';
import { homeChunk } from '../../core/planet';

export interface BakeJob {
  type: 'bake';
  id: number;
  seed: number;
  settings: WorldSettings;
  w: number;
  h: number;
  /** Rank start chunks too (skipped for slider previews). */
  starts: boolean;
}

export interface BakeDone {
  type: 'bake';
  id: number;
  bake: WorldBake;
  /** Best starts, spread out (empty when not asked for). */
  starts: StartCandidate[];
  ms: number;
}

export interface ChunkJob {
  type: 'chunk';
  id: number;
  seed: number;
  settings: WorldSettings;
  addr: ChunkAddr;
  /** Largest raster side. */
  raster: number;
}

export interface ChunkDone {
  type: 'chunk';
  id: number;
  addr: ChunkAddr;
  raster: ChunkRaster;
  /** Generation time (the map, not the raster), ms. */
  genMs: number;
}

export interface JobProgress {
  type: 'progress';
  id: number;
  /** 0..1 */
  done: number;
}

export interface JobFailed {
  type: 'error';
  id: number;
  message: string;
}

export type WorldGenJob = BakeJob | ChunkJob;
export type WorldGenReply = BakeDone | ChunkDone | JobProgress | JobFailed;

export function runBake(job: BakeJob, progress?: (done: number) => void): BakeDone {
  const t0 = performance.now();
  const n = PLANET_PRESET_SPECS[job.settings.planet].n;
  const island = job.settings.worldSource === 'island';
  const field = makePlanetField({
    source: job.settings.worldSource,
    seed: job.seed,
    n,
    home: island ? homeChunk(n) : undefined,
    shape: island ? undefined : settingsShape(job.settings),
  });
  const bake = bakeWorld(
    field,
    job.w,
    job.h,
    progress ? (rows) => progress(rows / job.h) : undefined,
  );
  const starts = job.starts && !island ? startChoices(rankStartChunks(field)) : [];
  return { type: 'bake', id: job.id, bake, starts, ms: performance.now() - t0 };
}

export function runChunk(job: ChunkJob): ChunkDone {
  const t0 = performance.now();
  const frame = planetFrame(job.seed, job.settings);
  const world = generateChunkAt(job.seed, job.settings, job.addr, frame);
  const genMs = performance.now() - t0;
  return {
    type: 'chunk',
    id: job.id,
    addr: job.addr,
    raster: chunkRaster(world, job.raster),
    genMs,
  };
}

/** Buffers to transfer with a reply (so nothing is copied). */
export function replyTransfer(reply: WorldGenReply): ArrayBuffer[] {
  if (reply.type === 'bake') {
    const b = reply.bake;
    return [b.biome.buffer, b.height.buffer, b.flags.buffer] as ArrayBuffer[];
  }
  if (reply.type === 'chunk') {
    return [
      reply.raster.biome.buffer,
      reply.raster.height.buffer,
      reply.raster.ids.buffer,
    ] as ArrayBuffer[];
  }
  return [];
}
