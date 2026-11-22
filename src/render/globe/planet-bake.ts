/** Globe bake job, shared by the worker and the main-thread fallback. */
import {
  bakeFace,
  defaultStartChunk,
  makePlanetField,
  type ChunkAddr,
  type FaceId,
  type PlanetField,
  type WorldSource,
} from '../../core/planet';

export interface PlanetBakeRequest {
  key: string;
  source: WorldSource;
  seed: number;
  n: number;
  faceTexels: number;
  /**
   * The world's chunk (the pin's chunk; island worlds also get a sea ring
   * there). Null: the bake picks the planet's default start chunk.
   */
  home: ChunkAddr | null;
  /** The home world, downsampled (row 0 = north), stamped over `home`. Null: the planet only. */
  homePatch: { size: number; rgba: Uint8ClampedArray } | null;
}

export interface PlanetBakeResult {
  key: string;
  /** The home chunk used (the request's, or the picked start). */
  home: ChunkAddr;
  faces: Uint8ClampedArray[];
  ms: number;
}

export function makeLayer(req: PlanetBakeRequest): PlanetField {
  return makePlanetField({
    source: req.source,
    seed: req.seed,
    n: req.n,
    home: req.home ?? undefined,
  });
}

/** The request's home chunk, or the planet's default start when it has none. */
export function resolveHome(layer: PlanetField, req: PlanetBakeRequest): ChunkAddr {
  return req.home ?? defaultStartChunk(layer);
}

export function bakeOneFace(
  layer: PlanetField,
  req: PlanetBakeRequest,
  home: ChunkAddr,
  face: FaceId,
): Uint8ClampedArray {
  const patches = req.homePatch
    ? [{ addr: home, size: req.homePatch.size, rgba: req.homePatch.rgba }]
    : [];
  return bakeFace(layer, face, req.faceTexels, patches);
}
