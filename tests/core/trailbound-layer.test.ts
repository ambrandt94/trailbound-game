import { describe, expect, it } from 'vitest';
import landJson from '../../src/core/planet/data/trailbound-land.json';
import {
  bakeFace,
  chunkKey,
  decodeRle,
  defaultStartChunk,
  encodeRle,
  latLonToSphere,
  makePlanetField,
  PlanetLayer,
  rankStartChunks,
  signedDistance,
  TRAILBOUND_LAT_SPAN,
  TrailboundLayer,
  type RleMask,
  type Vec3,
} from '../../src/core/planet';
import { Biome } from '../../src/core/world/models';
import { resolveHome, type PlanetBakeRequest } from '../../src/render/globe/planet-bake';

const DEG = Math.PI / 180;

/** Equirect sample grid over the mask's latitude band (the reference's own pixels). */
function flatGrid(cols: number, rows: number): Array<{ p: Vec3; r: number; c: number }> {
  const out: Array<{ p: Vec3; r: number; c: number }> = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const lat = (0.5 - (r + 0.5) / rows) * 2 * TRAILBOUND_LAT_SPAN;
      const lon = ((c + 0.5) / cols - 0.5) * 2 * Math.PI;
      out.push({ p: latLonToSphere(lat, lon), r, c });
    }
  }
  return out;
}

/** Even points over the whole sphere (Fibonacci), for area shares. */
function spherePoints(count: number): Vec3[] {
  const out: Vec3[] = [];
  for (let i = 0; i < count; i++) {
    const y = 1 - (2 * (i + 0.5)) / count;
    const r = Math.sqrt(1 - y * y);
    const a = i * Math.PI * (3 - Math.sqrt(5));
    out.push([r * Math.cos(a), y, r * Math.sin(a)]);
  }
  return out;
}

describe('trailbound mask asset', () => {
  const mask = decodeRle(landJson as RleMask);

  it('decodes to the derived 1024×474 equirect mask, about a third land', () => {
    expect(mask.w).toBe(1024);
    expect(mask.h).toBe(474);
    let land = 0;
    for (const b of mask.bits) land += b;
    const share = land / mask.bits.length;
    expect(share).toBeGreaterThan(0.33);
    expect(share).toBeLessThan(0.35);
  });

  it('round-trips through the run-length encoder', () => {
    const again = decodeRle(encodeRle(mask));
    expect(Buffer.from(again.bits).equals(Buffer.from(mask.bits))).toBe(true);
  });

  it('signed distance is + on land, − at sea, and wraps east–west', () => {
    const w = 16;
    const h = 4;
    const bits = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) bits[y * w] = 1; // a land column on the west edge
    const sdf = signedDistance({ w, h, bits });
    expect(sdf[0]).toBeGreaterThan(0);
    expect(sdf[1]).toBeLessThan(0);
    // The east edge is one pixel from the land column across the wrap.
    expect(Math.abs(sdf[w - 1]!)).toBeCloseTo(Math.abs(sdf[1]!), 5);
  });
});

describe('TrailboundLayer', () => {
  const layer = new TrailboundLayer({ seed: 7741, n: 20 });

  it('keeps the reference shape: a third of the flat map is land, matching its pixels', () => {
    const mask = decodeRle(landJson as RleMask);
    const cols = 512;
    const rows = 237;
    let land = 0;
    let agree = 0;
    for (const { p, r, c } of flatGrid(cols, rows)) {
      const ours = layer.landValue(p) > 0;
      if (ours) land++;
      const ref =
        mask.bits[
          Math.floor(((r + 0.5) / rows) * mask.h) * mask.w + Math.floor(((c + 0.5) / cols) * mask.w)
        ] === 1;
      if (ours === ref) agree++;
    }
    const n = cols * rows;
    expect(land / n).toBeGreaterThan(0.32);
    expect(land / n).toBeLessThan(0.36);
    expect(agree / n).toBeGreaterThan(0.95);
  });

  it('is about 40% land by area on the sphere (equirect squeezes the equator)', () => {
    const pts = spherePoints(6000);
    let land = 0;
    for (const p of pts) if (layer.landValue(p) > 0) land++;
    expect(land / pts.length).toBeGreaterThan(0.36);
    expect(land / pts.length).toBeLessThan(0.43);
  });

  it('caps both poles in ice', () => {
    expect(layer.sample(latLonToSphere(88 * DEG, 0.3)).biome).toBe(Biome.Snow);
    expect(layer.sample(latLonToSphere(-88 * DEG, 2.1)).biome).toBe(Biome.Snow);
  });

  it('is deterministic; the seed moves coasts but not the continents', () => {
    const same = new TrailboundLayer({ seed: 7741, n: 20 });
    const other = new TrailboundLayer({ seed: 99, n: 20 });
    const pts = spherePoints(3000);
    let moved = 0;
    for (const p of pts) {
      expect(same.sample(p)).toEqual(layer.sample(p));
      if (layer.landValue(p) > 0 !== other.landValue(p) > 0) moved++;
    }
    expect(moved).toBeGreaterThan(0);
    expect(moved / pts.length).toBeLessThan(0.06);
  });

  it('sea level drowns coast', () => {
    const high = new TrailboundLayer({ seed: 7741, n: 20, seaLevel: 4 });
    const pts = spherePoints(3000);
    let a = 0;
    let b = 0;
    for (const p of pts) {
      if (layer.landValue(p) > 0) a++;
      if (high.landValue(p) > 0) b++;
    }
    expect(b).toBeLessThan(a);
  });

  it('fine detail only nudges the coast line', () => {
    const pts = spherePoints(2000);
    let flips = 0;
    for (const p of pts) if (layer.landValue(p) > 0 !== layer.landValue(p, true) > 0) flips++;
    expect(flips / pts.length).toBeLessThan(0.02);
  });

  it('bakes a globe face with ocean, land and ice', () => {
    const rgba = bakeFace(layer, 4, 32);
    const colours = new Set<string>();
    for (let i = 0; i < rgba.length; i += 4)
      colours.add(`${rgba[i]},${rgba[i + 1]},${rgba[i + 2]}`);
    expect(colours.size).toBeGreaterThan(20);
  });
});

describe('start chunk', () => {
  const layer = new TrailboundLayer({ seed: 7741, n: 20 });
  const ranked = rankStartChunks(layer);

  it('picks a mostly-land chunk inside a big landmass, temperate and off face edges', () => {
    const best = ranked[0]!;
    expect(best.land).toBeGreaterThanOrEqual(0.6);
    expect(best.around).toBeGreaterThanOrEqual(0.6);
    expect(Math.abs(best.latDeg)).toBeGreaterThan(15);
    expect(Math.abs(best.latDeg)).toBeLessThan(55);
    const { cx, cy } = best.addr;
    expect(Math.min(cx, cy, 19 - cx, 19 - cy)).toBeGreaterThanOrEqual(2);
    expect(defaultStartChunk(layer)).toEqual(best.addr);
  });

  it('ranks island-edge chunks low (the mockup start, face 3 (7,2))', () => {
    const rank = ranked.findIndex((c) => chunkKey(c.addr) === '3:7:2');
    expect(rank === -1 || rank > 40).toBe(true);
  });

  it('works on the tiny planet', () => {
    const tiny = new TrailboundLayer({ seed: 7741, n: 4 });
    const best = rankStartChunks(tiny)[0]!;
    expect(best.land).toBeGreaterThan(0.4);
  });
});

describe('world sources', () => {
  it('builds the right planet for each source', () => {
    expect(makePlanetField({ source: 'trailbound', seed: 1, n: 4 })).toBeInstanceOf(
      TrailboundLayer,
    );
    expect(makePlanetField({ source: 'procedural', seed: 1, n: 4 })).toBeInstanceOf(PlanetLayer);
    expect(
      makePlanetField({ source: 'island', seed: 1, n: 4, home: { face: 0, cx: 2, cy: 2 } }),
    ).toBeInstanceOf(PlanetLayer);
  });

  it('a bake with no home picks the start chunk', () => {
    const req: PlanetBakeRequest = {
      key: 'k',
      source: 'trailbound',
      seed: 7741,
      n: 20,
      faceTexels: 8,
      home: null,
      homePatch: null,
    };
    const layer = makePlanetField({ source: 'trailbound', seed: 7741, n: 20 });
    expect(resolveHome(layer, req)).toEqual(defaultStartChunk(layer));
    expect(resolveHome(layer, { ...req, home: { face: 1, cx: 1, cy: 1 } })).toEqual({
      face: 1,
      cx: 1,
      cy: 1,
    });
  });
});
