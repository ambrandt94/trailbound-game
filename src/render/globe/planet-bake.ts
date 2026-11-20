/** Globe bake job, shared by the worker and the main-thread fallback. */
import { bakeFace, PlanetLayer, type ChunkAddr, type FaceId } from '../../core/planet';

export interface PlanetBakeRequest {
  key: string;
  seed: number;
  n: number;
  faceTexels: number;
  home: ChunkAddr;
  /** The home world, downsampled (row 0 = north). */
  homePatch: { size: number; rgba: Uint8ClampedArray };
}

export interface PlanetBakeResult {
  key: string;
  faces: Uint8ClampedArray[];
  ms: number;
}

export function makeLayer(req: PlanetBakeRequest): PlanetLayer {
  return new PlanetLayer({ seed: req.seed, n: req.n, home: req.home });
}

export function bakeOneFace(
  layer: PlanetLayer,
  req: PlanetBakeRequest,
  face: FaceId,
): Uint8ClampedArray {
  return bakeFace(layer, face, req.faceTexels, [
    { addr: req.home, size: req.homePatch.size, rgba: req.homePatch.rgba },
  ]);
}
