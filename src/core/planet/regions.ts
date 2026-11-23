/**
 * Regions (R1): the belief map. What the party knows of the planet, and how
 * much of the planet the view shows because of it. Pure maths, no DOM.
 *
 * - Visited chunks are known; their 8 neighbours are glimpsed (hazy); the rest
 *   is under clouds. Rumours open small grey clearings of their own.
 * - One number, k (0..1), says how much of the planet the party has seen. It
 *   comes from the angular span of the known chunks, in chunk widths, on a log
 *   scale: 1 chunk → 0, `spanFull` chunks → 1. The view zooms out with k, and
 *   past `bendStart` chunks it starts to bend from a flat map into the globe.
 * - The projection is azimuthal around the view centre: screen radius
 *   r(θ) = mix(θ, sin θ, bend) · R. At bend 0 it is a flat (equidistant) map,
 *   at bend 1 the orthographic globe; in between the edges curve away.
 *
 * R1 is a World Gen debug preview: nothing here is saved.
 */
import {
  angleBetween,
  chunkKey,
  chunkToSphere,
  neighbors8,
  sphereToChunk,
  type ChunkAddr,
  type Vec3,
} from './cube-sphere';

export interface RegionsTuning {
  /** Chunks across at which the view starts to bend. */
  bendStart: number;
  /** Chunks across at which the whole globe shows (k = 1). */
  spanFull: number;
  /** Room around the known area, as a share of its radius. */
  margin: number;
  /** Days away before a known place starts to fade, and when the fade levels off. */
  fadeStartDays: number;
  fadeFullDays: number;
}

export const DEFAULT_REGIONS_TUNING: RegionsTuning = {
  bendStart: 5,
  spanFull: 20,
  margin: 1.2,
  fadeStartDays: 10,
  fadeFullDays: 60,
};

/** The deepest a faded place gets: half its colour and a light haze. Never clouds again. */
export const FADE_MAX_DESAT = 0.5;
export const FADE_MAX_HAZE = 0.22;

export interface KnownChunk {
  addr: ChunkAddr;
  /** Day of the last visit (game days). */
  lastVisit: number;
}

export type Knowledge = Map<string, KnownChunk>;

/** Chunk width as an angle (one cube face spans π/2). */
export function chunkAngle(n: number): number {
  return Math.PI / 2 / n;
}

export function normalize3(v: readonly number[]): Vec3 {
  const l = Math.hypot(v[0] ?? 0, v[1] ?? 0, v[2] ?? 0) || 1;
  return [(v[0] ?? 0) / l, (v[1] ?? 0) / l, (v[2] ?? 0) / l];
}

export function dot3(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross3(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/** Great-circle interpolation, t in 0..1. */
export function slerp3(a: Vec3, b: Vec3, t: number): Vec3 {
  const d = Math.max(-1, Math.min(1, dot3(a, b)));
  const w = Math.acos(d);
  if (w < 1e-6) return a;
  const s = Math.sin(w);
  const ka = Math.sin((1 - t) * w) / s;
  const kb = Math.sin(t * w) / s;
  return normalize3([a[0] * ka + b[0] * kb, a[1] * ka + b[1] * kb, a[2] * ka + b[2] * kb]);
}

export function smoothstep(e0: number, e1: number, x: number): number {
  if (e1 === e0) return x < e0 ? 0 : 1;
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** Chunks next to the known ones that are not known themselves. */
export function glimpsed(n: number, known: Knowledge): Map<string, ChunkAddr> {
  const out = new Map<string, ChunkAddr>();
  for (const k of known.values()) {
    for (const nb of neighbors8(n, k.addr)) {
      const key = chunkKey(nb);
      if (!known.has(key)) out.set(key, nb);
    }
  }
  return out;
}

/** 0 fresh .. 1 fully faded, from days since the last visit. */
export function fadeAmount(
  daysAway: number,
  tuning: RegionsTuning = DEFAULT_REGIONS_TUNING,
): number {
  return smoothstep(tuning.fadeStartDays, tuning.fadeFullDays, daysAway);
}

export interface KnownExtent {
  /** Centroid of the known chunk centres (unit vector). */
  centre: Vec3;
  /** Angle from the centre to the far edge of the known area. */
  radius: number;
  /** Known area across, in chunk widths (≥ 1). */
  span: number;
}

export function knownExtent(n: number, known: Knowledge, fallback: Vec3): KnownExtent {
  const ca = chunkAngle(n);
  if (known.size === 0) return { centre: fallback, radius: ca / 2, span: 1 };
  const sum = [0, 0, 0];
  const centres: Vec3[] = [];
  for (const k of known.values()) {
    const p = chunkToSphere(n, k.addr);
    centres.push(p);
    sum[0]! += p[0];
    sum[1]! += p[1];
    sum[2]! += p[2];
  }
  // Known all round the planet: the centroid is meaningless, keep the fallback.
  const len = Math.hypot(sum[0]!, sum[1]!, sum[2]!);
  const centre = len / known.size < 0.05 ? fallback : normalize3(sum);
  let far = 0;
  for (const p of centres) far = Math.max(far, angleBetween(centre, p));
  const radius = far + ca / 2;
  return { centre, radius, span: Math.max(1, (2 * radius) / ca) };
}

/** k: 0 with one chunk known, 1 at `spanFull` chunks across (log scale). */
export function knowledgeScale(
  span: number,
  tuning: RegionsTuning = DEFAULT_REGIONS_TUNING,
): number {
  if (span <= 1) return 0;
  return Math.max(0, Math.min(1, Math.log(span) / Math.log(Math.max(1.01, tuning.spanFull))));
}

/** Span (chunks across) for a given k: the inverse of `knowledgeScale`. */
export function spanForScale(k: number, tuning: RegionsTuning = DEFAULT_REGIONS_TUNING): number {
  return Math.pow(Math.max(1.01, tuning.spanFull), Math.max(0, Math.min(1, k)));
}

/** Bend from k: flat until `bendStart` chunks across, the globe at `spanFull`. */
export function bendForScale(k: number, tuning: RegionsTuning = DEFAULT_REGIONS_TUNING): number {
  const k0 = Math.log(Math.max(1, tuning.bendStart)) / Math.log(Math.max(1.01, tuning.spanFull));
  return smoothstep(Math.min(0.999, k0), 1, k);
}

/** Screen radius (in units of R) of a point θ from the centre. */
export function bentRadius(theta: number, bend: number): number {
  return (1 - bend) * theta + bend * Math.sin(theta);
}

/** Furthest angle the bent projection can show before it folds back (the limb). */
export function maxVisibleAngle(bend: number): number {
  if (bend <= 0.5) return Math.PI;
  return Math.acos(-(1 - bend) / bend);
}

/** θ for a screen radius ρ (in units of R), or null past the limb. */
export function unbendRadius(rho: number, bend: number): number | null {
  const tmax = maxVisibleAngle(bend);
  if (rho > bentRadius(tmax, bend) + 1e-9) return null;
  let t = rho;
  for (let i = 0; i < 12; i++) {
    const f = bentRadius(t, bend) - rho;
    const d = Math.max(0.05, 1 - bend + bend * Math.cos(t));
    t = Math.max(0, Math.min(tmax, t - f / d));
  }
  return t;
}

export interface RegionsFrame {
  centre: Vec3;
  /** Pixels per radian at the centre. */
  R: number;
  bend: number;
}

export interface FrameAxes {
  c: Vec3;
  east: Vec3;
  north: Vec3;
}

export function frameAxes(centre: Vec3): FrameAxes {
  const c = normalize3(centre);
  let east = cross3([0, 1, 0], c);
  if (Math.hypot(...east) < 1e-6) east = [1, 0, 0];
  east = normalize3(east);
  const north = normalize3(cross3(c, east));
  return { c, east, north };
}

/** Sphere point to screen (CSS px from the view centre, y down), or null when hidden. */
export function regionsProject(
  frame: RegionsFrame,
  p: Vec3,
  axes: FrameAxes = frameAxes(frame.centre),
): { x: number; y: number; theta: number } | null {
  const d = Math.max(-1, Math.min(1, dot3(p, axes.c)));
  const theta = Math.acos(d);
  if (theta > maxVisibleAngle(frame.bend) + 1e-6) return null;
  const ex = dot3(p, axes.east);
  const ny = dot3(p, axes.north);
  const l = Math.hypot(ex, ny);
  const r = bentRadius(theta, frame.bend) * frame.R;
  if (l < 1e-12) return { x: 0, y: 0, theta };
  return { x: (r * ex) / l, y: (-r * ny) / l, theta };
}

/** Screen point (CSS px from the centre, y down) to the sphere, or null off the planet. */
export function regionsUnproject(
  frame: RegionsFrame,
  x: number,
  y: number,
  axes: FrameAxes = frameAxes(frame.centre),
): Vec3 | null {
  const rho = Math.hypot(x, y) / frame.R;
  const theta = unbendRadius(rho, frame.bend);
  if (theta === null) return null;
  const l = Math.hypot(x, y);
  const dx = l > 0 ? x / l : 0;
  const dy = l > 0 ? -y / l : 0;
  const s = Math.sin(theta);
  const c = Math.cos(theta);
  return normalize3([
    axes.c[0] * c + (axes.east[0] * dx + axes.north[0] * dy) * s,
    axes.c[1] * c + (axes.east[1] * dx + axes.north[1] * dy) * s,
    axes.c[2] * c + (axes.east[2] * dx + axes.north[2] * dy) * s,
  ]);
}

export interface FrameOverrides {
  /** Force k (how much is known), or null for auto. */
  k: number | null;
  /** Force the bend, or null for auto (from k). */
  bend: number | null;
}

export interface RegionsTarget extends RegionsFrame {
  k: number;
  span: number;
  /** Angle from the centre to the view's edge (shorter side). */
  visible: number;
}

/**
 * Where the view wants to be for what is known: centred on the known area,
 * zoomed so it fills the view with a margin, and bent by k.
 */
export function regionsTarget(
  n: number,
  extent: KnownExtent,
  viewW: number,
  viewH: number,
  tuning: RegionsTuning = DEFAULT_REGIONS_TUNING,
  overrides: FrameOverrides = { k: null, bend: null },
): RegionsTarget {
  const ca = chunkAngle(n);
  const k = overrides.k ?? knowledgeScale(extent.span, tuning);
  const span = overrides.k === null ? extent.span : spanForScale(k, tuning);
  const radius = overrides.k === null ? extent.radius : (span * ca) / 2;
  const bend = Math.max(0, Math.min(1, overrides.bend ?? bendForScale(k, tuning)));
  const local = radius * tuning.margin;
  // Past the bend the target widens to the whole hemisphere (the globe fits the view).
  const visible = Math.min(
    maxVisibleAngle(bend),
    local + (Math.PI / 2 - local) * Math.max(0, bend) ** 2,
  );
  const half = (Math.min(viewW, viewH) / 2) * 0.94;
  const R = half / Math.max(1e-4, bentRadius(Math.max(visible, ca * 0.3), bend));
  return { centre: extent.centre, R, bend, k, span, visible };
}

// —— simulated exploration (debug) ——

/** Chunks inside an N×N block of chunk widths around a centre chunk (odd N centred on it). */
export function exploreBlock(n: number, centre: ChunkAddr, size: number): ChunkAddr[] {
  const ca = chunkAngle(n);
  const c = chunkToSphere(n, centre);
  const axes = frameAxes(c);
  const off = size % 2 === 0 ? 0.5 : 0;
  const half = size / 2;
  const out: Array<{ a: ChunkAddr; d: number }> = [];
  const reach = (half + 1) * ca * Math.SQRT2;
  for (let face = 0; face < 6; face++) {
    for (let cy = 0; cy < n; cy++) {
      for (let cx = 0; cx < n; cx++) {
        const a = { face: face as ChunkAddr['face'], cx, cy };
        const p = chunkToSphere(n, a);
        const d = angleBetween(c, p);
        if (d > reach) continue;
        const z = dot3(p, axes.c);
        if (z <= 0 && size < 4 * n) continue;
        const x = Math.atan2(dot3(p, axes.east), z) / ca - off;
        const y = -Math.atan2(dot3(p, axes.north), z) / ca - off;
        const lim = half - 0.5 + 0.3;
        if (Math.abs(x) <= lim && Math.abs(y) <= lim) out.push({ a, d });
      }
    }
  }
  out.sort((p, q) => p.d - q.d);
  return out.map((e) => e.a);
}

/** Small deterministic PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A wandering journey: each step goes to a neighbouring chunk, mostly keeping
 * its heading. Returns the chunks in visiting order (revisits included).
 */
export function randomWalk(n: number, start: ChunkAddr, steps: number, seed: number): ChunkAddr[] {
  const rand = rng(seed);
  const path: ChunkAddr[] = [start];
  let heading = rand() * Math.PI * 2;
  let here = chunkToSphere(n, start);
  const ca = chunkAngle(n);
  let last = start;
  while (path.length <= steps) {
    heading += (rand() - 0.5) * 1.3;
    const axes = frameAxes(here);
    const dir: Vec3 = normalize3([
      axes.east[0] * Math.cos(heading) + axes.north[0] * Math.sin(heading),
      axes.east[1] * Math.cos(heading) + axes.north[1] * Math.sin(heading),
      axes.east[2] * Math.cos(heading) + axes.north[2] * Math.sin(heading),
    ]);
    const step = ca * 0.55;
    const next = normalize3([
      here[0] * Math.cos(step) + dir[0] * Math.sin(step),
      here[1] * Math.cos(step) + dir[1] * Math.sin(step),
      here[2] * Math.cos(step) + dir[2] * Math.sin(step),
    ]);
    // Keep the heading in the new tangent frame.
    const nAxes = frameAxes(next);
    heading = Math.atan2(dot3(dir, nAxes.north), dot3(dir, nAxes.east));
    here = next;
    const at = sphereToChunk(n, here).chunk;
    if (chunkKey(at) !== chunkKey(last)) {
      path.push(at);
      last = at;
    }
  }
  return path;
}

/** Chunks along great circles through the waypoints, in order, without repeats in a row. */
export function journeyPath(n: number, waypoints: readonly Vec3[]): ChunkAddr[] {
  const out: ChunkAddr[] = [];
  const ca = chunkAngle(n);
  const push = (p: Vec3) => {
    const a = sphereToChunk(n, p).chunk;
    const last = out[out.length - 1];
    if (!last || chunkKey(last) !== chunkKey(a)) out.push(a);
  };
  if (waypoints.length === 0) return out;
  push(waypoints[0]!);
  for (let i = 1; i < waypoints.length; i++) {
    const a = waypoints[i - 1]!;
    const b = waypoints[i]!;
    const steps = Math.max(1, Math.ceil(angleBetween(a, b) / (ca * 0.25)));
    for (let s = 1; s <= steps; s++) push(slerp3(a, b, s / steps));
  }
  return out;
}

/** Knowledge after walking a path: one day per step, the last visit wins. */
export function knowledgeFromPath(
  path: readonly ChunkAddr[],
  upTo = path.length,
  day0 = 0,
): Knowledge {
  const out: Knowledge = new Map();
  for (let i = 0; i < Math.min(upTo, path.length); i++) {
    const a = path[i]!;
    out.set(chunkKey(a), { addr: a, lastVisit: day0 + i });
  }
  return out;
}

// —— rumours ——

export interface PlaceLook {
  id: string;
  name: string;
}

/** What people said versus what is there (debug presets). */
export const RUMOR_PRESETS: ReadonlyArray<{
  source: string;
  believed: PlaceLook;
  truth: PlaceLook;
}> = [
  {
    source: 'A beggar in the square',
    believed: { id: 'pyramid', name: 'A golden pyramid full of treasure' },
    truth: { id: 'jars', name: 'A pile of rocks and some jars of gold dust' },
  },
  {
    source: 'A trader at the well',
    believed: { id: 'tower', name: 'A wizard’s tower' },
    truth: { id: 'ruin', name: 'A broken watchtower, home to crows' },
  },
  {
    source: 'An old map in a book',
    believed: { id: 'lake-town', name: 'A town on a blue lake' },
    truth: { id: 'lake-town', name: 'A town on a blue lake (it was true)' },
  },
  {
    source: 'A drunk sailor',
    believed: { id: 'cave', name: 'A dragon’s cave' },
    truth: { id: 'shrine', name: 'A quiet shrine in a hollow' },
  },
];

export interface Rumor {
  id: number;
  source: string;
  believed: PlaceLook;
  truth: PlaceLook;
  /** Where people say it is. */
  at: Vec3;
  /** Where it really is (within the uncertainty ring). */
  trueAt: Vec3;
  /** 0..1: how sure the party is. Bigger clearing, smaller ring. */
  confidence: number;
  /** The direction is known: "Show me" flies there; otherwise it cuts in a poof. */
  directionKnown: boolean;
  arrived: boolean;
}

/** Clearing radius around a rumour, as an angle. */
export function rumorClearing(n: number, confidence: number): number {
  return chunkAngle(n) * (0.35 + 0.85 * Math.max(0, Math.min(1, confidence)));
}

/** How far off the spot might be (the dashed ring), as an angle. */
export function rumorUncertainty(n: number, confidence: number): number {
  return chunkAngle(n) * (2.4 - 2.0 * Math.max(0, Math.min(1, confidence)));
}

/** A point at `angle` from `p` towards `bearing` (radians, 0 = east, π/2 = north). */
export function offsetOnSphere(p: Vec3, bearing: number, angle: number): Vec3 {
  const axes = frameAxes(p);
  const dir: Vec3 = [
    axes.east[0] * Math.cos(bearing) + axes.north[0] * Math.sin(bearing),
    axes.east[1] * Math.cos(bearing) + axes.north[1] * Math.sin(bearing),
    axes.east[2] * Math.cos(bearing) + axes.north[2] * Math.sin(bearing),
  ];
  return normalize3([
    p[0] * Math.cos(angle) + dir[0] * Math.sin(angle),
    p[1] * Math.cos(angle) + dir[1] * Math.sin(angle),
    p[2] * Math.cos(angle) + dir[2] * Math.sin(angle),
  ]);
}

export function makeRumor(
  n: number,
  id: number,
  at: Vec3,
  confidence: number,
  directionKnown: boolean,
  seed: number,
): Rumor {
  const rand = rng(seed * 7919 + id * 104729);
  const preset = RUMOR_PRESETS[(id - 1) % RUMOR_PRESETS.length]!;
  const off = rumorUncertainty(n, confidence) * Math.sqrt(rand()) * 0.85;
  return {
    id,
    source: preset.source,
    believed: preset.believed,
    truth: preset.truth,
    at,
    trueAt: offsetOnSphere(at, rand() * Math.PI * 2, off),
    confidence,
    directionKnown,
    arrived: false,
  };
}
