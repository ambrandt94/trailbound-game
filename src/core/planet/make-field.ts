import type { ChunkAddr } from './cube-sphere';
import type { PlanetField } from './field';
import { PlanetLayer } from './global-layer';
import type { WorldSource } from './presets';
import { TrailboundLayer } from './trailbound-layer';

export interface PlanetFieldSpec {
  source: WorldSource;
  seed: number;
  n: number;
  /** Island worlds only: the hand-tuned map's chunk, which gets a sea ring. */
  home?: ChunkAddr;
  /** Trailbound only: mask pixels of sea level. */
  seaLevel?: number;
}

/** The planet behind a world, by its source. */
export function makePlanetField(spec: PlanetFieldSpec): PlanetField {
  switch (spec.source) {
    case 'trailbound':
      return new TrailboundLayer({ seed: spec.seed, n: spec.n, seaLevel: spec.seaLevel });
    case 'procedural':
      return new PlanetLayer({ seed: spec.seed, n: spec.n });
    case 'island':
      return new PlanetLayer({ seed: spec.seed, n: spec.n, home: spec.home });
  }
}
