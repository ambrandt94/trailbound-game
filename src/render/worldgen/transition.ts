/**
 * WG4's view transitions, as pure maths so they can be tested without a
 * browser. The scene drives them from its render loop:
 * - Globe ↔ World map: tween the morph mesh (`morph`, tilt and radius), ~600 ms.
 *   The view centre keeps its position and scale, so it stays put while the
 *   rest rolls up or unrolls around it.
 * - Planet → Chunk: fly the planet camera onto the chunk (~520 ms), then
 *   crossfade the chunk's local map in over it, turned from the chunk's
 *   bearing on screen to north-up.
 * - Chunk → Planet: the reverse; the chunk map fades out while the planet
 *   pulls back to the view the toggle asked for.
 * Nothing is generated or baked while one runs: the chunk map is already in
 * the cache before a fly starts.
 */
import { wrapAngle, type ViewState } from './projection';

/** Globe ↔ World map. */
export const MORPH_MS = 600;
/** Planet camera onto a chunk, or back out of one. */
export const FLY_MS = 520;
/** Chunk map crossfade. */
export const FADE_MS = 260;
/** The crossfade starts this far into a fly in (the chunk fills ~60% of the view by then). */
export const FADE_AT = 0.55;
/** Share of the view's short side a chunk fills at the end of a fly (the chunk view's own fit). */
export const CHUNK_FILL = 0.92;

export type Ease = (t: number) => number;

export function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/** Slow out, slow in. */
export const easeInOutCubic: Ease = (t) => {
  const x = clamp01(t);
  return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
};

/** Quick start, soft landing (fades). */
export const easeOutQuad: Ease = (t) => {
  const x = clamp01(t);
  return 1 - (1 - x) * (1 - x);
};

/**
 * Between two views: longitude the short way round, radius in log space (so a
 * 20× zoom feels even), tilt and morph straight.
 */
export function lerpView(a: ViewState, b: ViewState, t: number): ViewState {
  const k = clamp01(t);
  const dl = wrapAngle(b.lon0 - a.lon0);
  const ra = Math.max(1e-6, a.radiusPx);
  const rb = Math.max(1e-6, b.radiusPx);
  return {
    lon0: wrapAngle(a.lon0 + dl * k),
    lat0: a.lat0 + (b.lat0 - a.lat0) * k,
    radiusPx: Math.exp(Math.log(ra) + (Math.log(rb) - Math.log(ra)) * k),
    morph: a.morph + (b.morph - a.morph) * k,
  };
}

/** One eased move of the planet view. */
export class ViewTween {
  constructor(
    readonly from: ViewState,
    readonly to: ViewState,
    readonly startMs: number,
    readonly durMs: number,
    readonly ease: Ease = easeInOutCubic,
  ) {}

  /** 0..1 of the way through at `now` (unclamped time, eased value). */
  progress(now: number): number {
    return clamp01((now - this.startMs) / Math.max(1, this.durMs));
  }

  at(now: number): ViewState {
    return lerpView(this.from, this.to, this.ease(this.progress(now)));
  }

  done(now: number): boolean {
    return now >= this.startMs + this.durMs;
  }
}

/** One eased opacity ramp (the chunk map's crossfade). */
export class FadeTween {
  constructor(
    readonly from: number,
    readonly to: number,
    readonly startMs: number,
    readonly durMs: number,
    readonly ease: Ease = easeOutQuad,
  ) {}

  at(now: number): number {
    const t = clamp01((now - this.startMs) / Math.max(1, this.durMs));
    return this.from + (this.to - this.from) * this.ease(t);
  }

  done(now: number): boolean {
    return now >= this.startMs + this.durMs;
  }
}

/** Angle a cube-sphere chunk spans across its middle, radians (equi-angular faces). */
export function chunkSpan(n: number): number {
  return Math.PI / 2 / Math.max(1, n);
}

/**
 * Planet radius at which a chunk fills `fill` of the view's short side.
 * On the flat map a chunk is also 1/cos(lat) wider than tall; its height is
 * what is matched, so the crossfade lands the chunk map's top and bottom edges
 * on the planet's.
 */
export function chunkFrameRadius(
  n: number,
  viewW: number,
  viewH: number,
  fill = CHUNK_FILL,
): number {
  return (fill * Math.min(viewW, viewH)) / chunkSpan(n);
}

/** The planet view centred on a chunk centre and zoomed so the chunk fills the view. */
export function chunkFrameView(
  n: number,
  centre: { lat: number; lon: number },
  morph: number,
  viewW: number,
  viewH: number,
): ViewState {
  return {
    lon0: centre.lon,
    lat0: centre.lat,
    radiusPx: chunkFrameRadius(n, viewW, viewH),
    morph,
  };
}

/**
 * Screen rotation (radians, clockwise) that turns "up" into a direction given
 * as a screen offset (x right, y down): 0 when it already points up.
 */
export function bearingOf(dx: number, dy: number): number {
  if (dx === 0 && dy === 0) return 0;
  return Math.atan2(dx, -dy);
}

/** Frame timing summary for the perf readout and tests. */
export interface FrameStats {
  frames: number;
  avgMs: number;
  p95Ms: number;
  maxMs: number;
}

/** rAF intervals → average, p95 and worst. */
export function frameStats(intervalsMs: readonly number[]): FrameStats {
  if (!intervalsMs.length) return { frames: 0, avgMs: 0, p95Ms: 0, maxMs: 0 };
  const sorted = [...intervalsMs].sort((a, b) => a - b);
  const sum = sorted.reduce((s, v) => s + v, 0);
  const p95 = sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)]!;
  return {
    frames: sorted.length,
    avgMs: sum / sorted.length,
    p95Ms: p95,
    maxMs: sorted[sorted.length - 1]!,
  };
}
