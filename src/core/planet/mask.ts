/**
 * Run-length land masks and their signed distance fields. Pure data, so the
 * globe worker and node tests decode the same bytes.
 *
 * Format: `{ w, h, rows }`. Each row is a list of run lengths that starts with
 * water (0) and alternates; a row may start with a 0-length water run.
 */
export interface RleMask {
  w: number;
  h: number;
  rows: number[][];
}

export interface BitMask {
  w: number;
  h: number;
  /** 1 = set (land / ice), row 0 = north. */
  bits: Uint8Array;
}

export function decodeRle(mask: RleMask): BitMask {
  const { w, h } = mask;
  const bits = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const runs = mask.rows[y] ?? [];
    let x = 0;
    let on = 0;
    for (const run of runs) {
      if (on) bits.fill(1, y * w + x, y * w + Math.min(w, x + run));
      x += run;
      on ^= 1;
    }
  }
  return { w, h, bits };
}

export function encodeRle(mask: BitMask): RleMask {
  const rows: number[][] = [];
  for (let y = 0; y < mask.h; y++) {
    const runs: number[] = [];
    let cur = 0;
    let count = 0;
    for (let x = 0; x < mask.w; x++) {
      const v = mask.bits[y * mask.w + x]! ? 1 : 0;
      if (v === cur) count++;
      else {
        runs.push(count);
        cur = v;
        count = 1;
      }
    }
    runs.push(count);
    rows.push(runs);
  }
  return { w: mask.w, h: mask.h, rows };
}

const INF = 1e20;

/** Felzenszwalb–Huttenlocher squared distance transform of one line, in place. */
function edt1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array): void {
  let k = 0;
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  for (let q = 1; q < n; q++) {
    let s = (f[q]! + q * q - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!);
    while (s <= z[k]!) {
      k--;
      s = (f[q]! + q * q - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1]! < q) k++;
    const dq = q - v[k]!;
    d[q] = dq * dq + f[v[k]!]!;
  }
}

/**
 * Euclidean distance (pixels) from every pixel to the nearest pixel where
 * `target(i)` is true. X wraps (the map is a full turn of longitude); Y does not.
 */
function distanceTo(w: number, h: number, target: (i: number) => boolean): Float32Array {
  const pad = Math.min(w, 128);
  const pw = w + pad * 2;
  const grid = new Float64Array(pw * h);
  for (let y = 0; y < h; y++) {
    for (let px = 0; px < pw; px++) {
      const x = (((px - pad) % w) + w) % w;
      grid[y * pw + px] = target(y * w + x) ? 0 : INF;
    }
  }
  const n = Math.max(pw, h);
  const f = new Float64Array(n);
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  for (let px = 0; px < pw; px++) {
    for (let y = 0; y < h; y++) f[y] = grid[y * pw + px]!;
    edt1d(f, h, d, v, z);
    for (let y = 0; y < h; y++) grid[y * pw + px] = d[y]!;
  }
  for (let y = 0; y < h; y++) {
    for (let px = 0; px < pw; px++) f[px] = grid[y * pw + px]!;
    edt1d(f, pw, d, v, z);
    for (let px = 0; px < pw; px++) grid[y * pw + px] = d[px]!;
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) out[y * w + x] = Math.sqrt(grid[y * pw + x + pad]!);
  }
  return out;
}

/**
 * Signed distance in mask pixels: positive inside the set (land), negative
 * outside, about ±0.5 at the edge, clamped to ±`clampPx`.
 */
export function signedDistance(mask: BitMask, clampPx = 64): Float32Array {
  const { w, h, bits } = mask;
  const toOn = distanceTo(w, h, (i) => bits[i] === 1);
  const toOff = distanceTo(w, h, (i) => bits[i] === 0);
  const out = new Float32Array(w * h);
  for (let i = 0; i < out.length; i++) {
    const s = bits[i] ? toOff[i]! - 0.5 : -(toOn[i]! - 0.5);
    out[i] = s > clampPx ? clampPx : s < -clampPx ? -clampPx : s;
  }
  return out;
}

/** Bilinear read of a row-major field at fractional pixel coordinates; x wraps, y clamps. */
export function sampleField(
  field: Float32Array,
  w: number,
  h: number,
  fx: number,
  fy: number,
): number {
  const x = fx - 0.5;
  const y = Math.min(h - 1.0001, Math.max(0, fy - 0.5));
  const xf = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = x - xf;
  const ty = y - y0;
  const x0 = ((xf % w) + w) % w;
  const x1 = (x0 + 1) % w;
  const y1 = Math.min(h - 1, y0 + 1);
  const a = field[y0 * w + x0]!;
  const b = field[y0 * w + x1]!;
  const c = field[y1 * w + x0]!;
  const d = field[y1 * w + x1]!;
  return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
}
