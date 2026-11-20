/**
 * Cube-sphere chunk addressing. Six cube faces, each an `n × n` grid of chunks,
 * projected onto the unit sphere with the equi-angular map (a `tan` warp of the
 * face coordinates), so chunk areas vary by about 1.4× instead of the plain
 * cube's 5×.
 *
 * Face frame: `normal` points out, `u` grows with `cx` (east on the four side
 * faces), `v` grows with `cy` (south on the side faces). Face 0 (+Z) is the
 * home face: latitude 0, longitude 0 sits at its centre.
 *
 * Sides: 0 = north (−cy), 1 = east (+cx), 2 = south (+cy), 3 = west (−cx).
 * Across one of the 12 cube edges the neighbour face has its own axes, so
 * `neighbor` reports `rot`, the quarter turns from our frame into theirs.
 */
export type Vec3 = readonly [number, number, number];
export type FaceId = 0 | 1 | 2 | 3 | 4 | 5;
export type Side = 0 | 1 | 2 | 3;

export interface ChunkAddr {
  face: FaceId;
  cx: number;
  cy: number;
}

/** A point inside a chunk: `x`, `y` in 0..1 across the chunk (east, south). */
export interface ChunkPoint {
  chunk: ChunkAddr;
  x: number;
  y: number;
}

interface FaceFrame {
  normal: Vec3;
  u: Vec3;
  v: Vec3;
}

export const FACES: readonly FaceFrame[] = [
  { normal: [0, 0, 1], u: [1, 0, 0], v: [0, -1, 0] }, // 0 +Z front (home)
  { normal: [1, 0, 0], u: [0, 0, -1], v: [0, -1, 0] }, // 1 +X east
  { normal: [0, 0, -1], u: [-1, 0, 0], v: [0, -1, 0] }, // 2 −Z back
  { normal: [-1, 0, 0], u: [0, 0, 1], v: [0, -1, 0] }, // 3 −X west
  { normal: [0, 1, 0], u: [1, 0, 0], v: [0, 0, 1] }, // 4 +Y north cap
  { normal: [0, -1, 0], u: [1, 0, 0], v: [0, 0, -1] }, // 5 −Y south cap
];

export const FACE_NAMES = ['front', 'east', 'back', 'west', 'north', 'south'] as const;

const QUARTER = Math.PI / 4;

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function normalize(x: number, y: number, z: number): Vec3 {
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
}

export function chunkKey(a: ChunkAddr): string {
  return `${a.face}:${a.cx}:${a.cy}`;
}

export function parseChunkKey(key: string, n: number): ChunkAddr | null {
  const parts = key.split(':').map(Number);
  if (parts.length !== 3 || parts.some((p) => !Number.isInteger(p))) return null;
  const [face, cx, cy] = parts as [number, number, number];
  if (face < 0 || face > 5 || cx < 0 || cy < 0 || cx >= n || cy >= n) return null;
  return { face: face as FaceId, cx, cy };
}

export function sameChunk(a: ChunkAddr, b: ChunkAddr): boolean {
  return a.face === b.face && a.cx === b.cx && a.cy === b.cy;
}

export function validChunk(a: ChunkAddr, n: number): boolean {
  return (
    Number.isInteger(a.face) &&
    a.face >= 0 &&
    a.face <= 5 &&
    Number.isInteger(a.cx) &&
    Number.isInteger(a.cy) &&
    a.cx >= 0 &&
    a.cy >= 0 &&
    a.cx < n &&
    a.cy < n
  );
}

/** Face coordinates (s, t) in −1..1 to a unit vector, equi-angular. */
export function faceToSphere(face: FaceId, s: number, t: number): Vec3 {
  const f = FACES[face]!;
  const a = Math.tan(s * QUARTER);
  const b = Math.tan(t * QUARTER);
  return normalize(
    f.normal[0] + a * f.u[0] + b * f.v[0],
    f.normal[1] + a * f.u[1] + b * f.v[1],
    f.normal[2] + a * f.u[2] + b * f.v[2],
  );
}

/** The face a direction lands on: the largest component wins (ties go to the lower id). */
export function faceOf(p: Vec3): FaceId {
  const ax = Math.abs(p[0]);
  const ay = Math.abs(p[1]);
  const az = Math.abs(p[2]);
  if (az >= ax && az >= ay) return p[2] >= 0 ? 0 : 2;
  if (ax >= ay) return p[0] >= 0 ? 1 : 3;
  return p[1] >= 0 ? 4 : 5;
}

/** Any non-zero vector to face coordinates on a given face (s, t may leave −1..1 off-face). */
export function sphereToFaceOn(face: FaceId, p: Vec3): { s: number; t: number } {
  const f = FACES[face]!;
  const d = dot(p, f.normal);
  const a = dot(p, f.u) / d;
  const b = dot(p, f.v) / d;
  return { s: Math.atan(a) / QUARTER, t: Math.atan(b) / QUARTER };
}

export function sphereToFace(p: Vec3): { face: FaceId; s: number; t: number } {
  const face = faceOf(p);
  return { face, ...sphereToFaceOn(face, p) };
}

/** Chunk-local point (0..1 each way) to a unit vector. */
export function chunkToSphere(n: number, a: ChunkAddr, x = 0.5, y = 0.5): Vec3 {
  const s = ((a.cx + x) / n) * 2 - 1;
  const t = ((a.cy + y) / n) * 2 - 1;
  return faceToSphere(a.face, s, t);
}

export function sphereToChunk(n: number, p: Vec3): ChunkPoint {
  const { face, s, t } = sphereToFace(p);
  const gx = Math.min(n - 1e-9, Math.max(0, ((s + 1) / 2) * n));
  const gy = Math.min(n - 1e-9, Math.max(0, ((t + 1) / 2) * n));
  const cx = Math.floor(gx);
  const cy = Math.floor(gy);
  return { chunk: { face, cx, cy }, x: gx - cx, y: gy - cy };
}

/** Latitude (north +) and longitude (east +, 0 at the home face centre), radians. */
export function sphereToLatLon(p: Vec3): { lat: number; lon: number } {
  const l = Math.hypot(p[0], p[1], p[2]) || 1;
  return {
    lat: Math.asin(Math.max(-1, Math.min(1, p[1] / l))),
    lon: Math.atan2(p[0], p[2]),
  };
}

export function latLonToSphere(lat: number, lon: number): Vec3 {
  const c = Math.cos(lat);
  return [c * Math.sin(lon), Math.sin(lat), c * Math.cos(lon)];
}

export function chunkLatLon(
  n: number,
  a: ChunkAddr,
  x = 0.5,
  y = 0.5,
): { lat: number; lon: number } {
  return sphereToLatLon(chunkToSphere(n, a, x, y));
}

/** Angle between two unit vectors, radians. */
export function angleBetween(a: Vec3, b: Vec3): number {
  return Math.acos(Math.max(-1, Math.min(1, dot(a, b))));
}

const SIDE_STEP: Record<Side, [number, number]> = {
  0: [0, -1],
  1: [1, 0],
  2: [0, 1],
  3: [-1, 0],
};

export function oppositeSide(side: Side): Side {
  return ((side + 2) % 4) as Side;
}

/** Side index of a face-local direction (±u or ±v) on a face, or null. */
function sideOfDir(face: FaceId, d: Vec3): Side | null {
  const f = FACES[face]!;
  const du = dot(d, f.u);
  const dv = dot(d, f.v);
  if (du > 0.5) return 1;
  if (du < -0.5) return 3;
  if (dv > 0.5) return 2;
  if (dv < -0.5) return 0;
  return null;
}

/**
 * Edge neighbour. `rot` is the quarter turns (0–3, clockwise) from this chunk's
 * frame to the neighbour's: walking out of side `side` you arrive heading
 * `(side + rot) % 4` in the neighbour's frame.
 */
export function neighbor(n: number, a: ChunkAddr, side: Side): { addr: ChunkAddr; rot: number } {
  const [dx, dy] = SIDE_STEP[side];
  const nx = a.cx + dx;
  const ny = a.cy + dy;
  if (nx >= 0 && ny >= 0 && nx < n && ny < n) {
    return { addr: { face: a.face, cx: nx, cy: ny }, rot: 0 };
  }
  // Off the face: take the edge midpoint on the cube, nudge it over the edge,
  // and see which face and chunk it lands in.
  const f = FACES[a.face]!;
  const s = side === 1 ? 1 : side === 3 ? -1 : ((a.cx + 0.5) / n) * 2 - 1;
  const t = side === 2 ? 1 : side === 0 ? -1 : ((a.cy + 0.5) / n) * 2 - 1;
  const ea = side === 1 || side === 3 ? s : Math.tan(s * QUARTER);
  const eb = side === 0 || side === 2 ? t : Math.tan(t * QUARTER);
  const eps = 1e-6;
  const q: Vec3 = [
    f.normal[0] * (1 - eps) + ea * f.u[0] + eb * f.v[0],
    f.normal[1] * (1 - eps) + ea * f.u[1] + eb * f.v[1],
    f.normal[2] * (1 - eps) + ea * f.u[2] + eb * f.v[2],
  ];
  const hit = sphereToChunk(n, normalize(q[0], q[1], q[2]));
  // Heading across the edge is −normal of the face we left.
  const heading: Vec3 = [-f.normal[0], -f.normal[1], -f.normal[2]];
  const arrive = sideOfDir(hit.chunk.face, heading) ?? side;
  return { addr: hit.chunk, rot: (arrive - side + 4) % 4 };
}

/** The 4 edge neighbours, north, east, south, west. */
export function neighbors4(n: number, a: ChunkAddr): ChunkAddr[] {
  return ([0, 1, 2, 3] as Side[]).map((side) => neighbor(n, a, side).addr);
}

/**
 * The load ring: edge neighbours plus diagonals, deduplicated. A chunk at one of
 * the 8 cube corners has 7 (three faces meet there, so one diagonal is missing).
 */
export function neighbors8(n: number, a: ChunkAddr): ChunkAddr[] {
  const out = new Map<string, ChunkAddr>();
  const self = chunkKey(a);
  for (const side of [0, 1, 2, 3] as Side[]) {
    const edge = neighbor(n, a, side);
    out.set(chunkKey(edge.addr), edge.addr);
    // Turn right from that side, in the neighbour's frame.
    const heading = ((side + edge.rot) % 4) as Side;
    const right = ((heading + 1) % 4) as Side;
    const diag = neighbor(n, edge.addr, right).addr;
    const key = chunkKey(diag);
    if (key !== self) out.set(key, diag);
  }
  out.delete(self);
  // At a cube corner the two routes to a diagonal can land on an edge neighbour
  // of the other side; keep only chunks that touch `a` (centre within ~1.6 chunk widths).
  const centre = chunkToSphere(n, a);
  const reach = (Math.PI / 2 / n) * 1.75;
  return [...out.values()].filter((c) => angleBetween(centre, chunkToSphere(n, c)) < reach);
}

/** Every chunk address, face by face, row by row. */
export function allChunks(n: number): ChunkAddr[] {
  const out: ChunkAddr[] = [];
  for (let face = 0; face < 6; face++) {
    for (let cy = 0; cy < n; cy++) {
      for (let cx = 0; cx < n; cx++) out.push({ face: face as FaceId, cx, cy });
    }
  }
  return out;
}

/** Where today's world sits on a fresh planet: the middle of the front face. */
export function homeChunk(n: number): ChunkAddr {
  const c = Math.floor(n / 2);
  return { face: 0, cx: c, cy: c };
}

/**
 * Deterministic seed for a chunk. The home chunk keeps the world's own seed,
 * so the existing continent (and every save made on it) is unchanged.
 */
export function chunkSeed(planetSeed: number, a: ChunkAddr, home?: ChunkAddr): number {
  if (home && sameChunk(a, home)) return planetSeed >>> 0;
  let h = Math.imul(planetSeed >>> 0, 0x9e3779b1);
  h ^= Math.imul(a.face + 1, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= Math.imul(a.cx + 1, 0x27d4eb2f);
  h = Math.imul(h ^ (h >>> 15), 0x165667b1);
  h ^= Math.imul(a.cy + 1, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = (h ^ (h >>> 13)) >>> 0;
  return h || 1;
}

/** Physical numbers for a planet of `n` chunks per face edge, each `chunkKm` wide. */
export function planetStats(
  n: number,
  chunkKm: number,
): {
  chunks: number;
  circumferenceKm: number;
  radiusKm: number;
} {
  const circumferenceKm = 4 * n * chunkKm;
  return { chunks: 6 * n * n, circumferenceKm, radiusKm: circumferenceKm / (2 * Math.PI) };
}
