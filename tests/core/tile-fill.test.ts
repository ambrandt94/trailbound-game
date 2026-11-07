import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { BIOME_COUNT, DEFAULT_WORLD_SETTINGS } from '../../src/core/world/models';
import { generateWorld } from '../../src/core/world/world-gen';
import {
  compositeRoadStraight,
  edgeField,
  fillCases,
  foregroundBits,
  ownerTile,
  resolveRoad,
  resolveTile,
  tileFillReport,
  type Adj,
} from '../../src/render/map/tile-fill';

function adj(center: number, other: number, mask: number): Adj {
  const on = (bit: number) => (mask & bit) !== 0;
  const n = on(8);
  const e = on(4);
  const s = on(2);
  const w = on(1);
  const pick = (side: boolean) => (side ? other : center);
  return {
    center,
    n: pick(n),
    e: pick(e),
    s: pick(s),
    w: pick(w),
    nw: pick(n && w),
    ne: pick(n && e),
    se: pick(s && e),
    sw: pick(s && w),
  };
}

test('every biome pair and autotile mask resolves to a tile', () => {
  const ids = new Set<string>();
  for (let center = 0; center < BIOME_COUNT; center++) {
    for (let other = 0; other < BIOME_COUNT; other++) {
      for (let mask = 0; mask < 16; mask++) {
        const tile = resolveTile(adj(center, other, mask));
        expect(tile.id.length).toBeGreaterThan(0);
        expect(['ground', 'authored', 'fill']).toContain(tile.kind);
        ids.add(tile.id);
      }
      const diagonal = resolveTile({
        center,
        n: center,
        e: center,
        s: center,
        w: center,
        nw: other,
        ne: center,
        se: other,
        sw: center,
      });
      expect(diagonal.id.length).toBeGreaterThan(0);
      const tee = resolveTile(adj(center, other, 8 | 4 | 2));
      expect(tee.id.length).toBeGreaterThan(0);
      const isolated = resolveTile(adj(center, other, 15));
      expect(isolated.id.length).toBeGreaterThan(0);
    }
  }
  expect(ids.size).toBeGreaterThan(10);
});

test('road caps, corners, junctions and the two missing straights all resolve', () => {
  for (let mask = 0; mask < 16; mask++) {
    const road = resolveRoad(
      (mask & 8) !== 0,
      (mask & 4) !== 0,
      (mask & 2) !== 0,
      (mask & 1) !== 0,
    );
    expect(road.id.length).toBeGreaterThan(0);
    if (mask === 5 || mask === 10) {
      expect(road.kind).toBe('fill');
      expect(road.parts).toHaveLength(2);
    } else {
      expect(road.kind).toBe('authored');
    }
  }
});

test('an authored grass-onto-sand edge stays on the sheet, and a missing pair is a fill', () => {
  const beach = resolveTile(adj(0, 1, 8));
  expect(beach.kind).toBe('fill');
  expect(beach.id.startsWith('fill:')).toBe(true);
  const grassOnSand = resolveTile(adj(1, 2, 8));
  expect(grassOnSand.kind).toBe('authored');
  expect(grassOnSand.id.startsWith('atlas:')).toBe(true);
});

test('inner corners clear the diagonal and opposite corners are mask 5 or 10', () => {
  const inner = foregroundBits(
    {
      center: 1,
      n: 2,
      e: 2,
      s: 1,
      w: 1,
      nw: 2,
      ne: 1,
      se: 1,
      sw: 1,
    },
    2,
  );
  expect(inner & 4).toBe(0);
  const opposite = foregroundBits(
    {
      center: 1,
      n: 1,
      e: 1,
      s: 1,
      w: 1,
      nw: 2,
      ne: 1,
      se: 2,
      sw: 1,
    },
    2,
  );
  expect(opposite).toBe(8 | 2);
});

test('the edge field is continuous and a staircase cuts the corner', () => {
  const a = edgeField(4, 8.5, 7741);
  const b = edgeField(4.02, 8.5, 7741);
  expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(0.08);
  let waterSide = 0;
  let samples = 0;
  for (let ty = 0; ty < 16; ty++) {
    for (let py = 0; py < 48; py += 4) {
      samples += 1;
      if (ownerTile(10, ty, 0, py, 7741).x < 10) waterSide += 1;
    }
  }
  expect(waterSide).toBeGreaterThan(samples * 0.15);
  expect(waterSide).toBeLessThan(samples * 0.85);
  let land = 0;
  for (let py = 0; py < 48; py++) {
    for (let px = 0; px < 48; px++) {
      const owner = ownerTile(3, 4, px, py, 7741);
      if (owner.x + owner.y >= 8) land += 1;
    }
  }
  expect(land).toBeGreaterThan(48);
  expect(land).toBeLessThan(48 * 48 - 48);
});

test('a derived straight road joins the two authored caps without blending channels', () => {
  const size = 48 * 48 * 4;
  const west = new Uint8ClampedArray(size);
  const east = new Uint8ClampedArray(size);
  for (let i = 0; i < size; i += 4) {
    west[i] = 180;
    west[i + 3] = 255;
    east[i] = 40;
    east[i + 1] = 90;
    east[i + 3] = 255;
  }
  const out = new Uint8ClampedArray(size);
  compositeRoadStraight(west, east, out, 'ew');
  expect(out[0]).toBe(180);
  expect(out[47 * 4]).toBe(40);
  expect(out[47 * 4 + 1]).toBe(90);
});

test('the artist report names the missing coast and the derived road straights', () => {
  const report = tileFillReport();
  expect(readFileSync('docs/map-tile-fills.md', 'utf8')).toBe(report);
  expect(report).toContain('## Filled pairs');
  expect(report).toContain('Sand onto Water');
  expect(report).toContain('Forest onto Plains');
  expect(report).toContain('Mask 5 (east-west)');
  expect(report).toContain('atlas_terrain.png');
  const missing = fillCases().filter((item) => item.authoredBase === null);
  expect(missing.length).toBeGreaterThan(20);
  for (const item of missing) expect(report).toContain(item.name);
});

test('every adjacency on seed 7741 resolves to a tile', () => {
  const world = generateWorld(7741, { ...DEFAULT_WORLD_SETTINGS, worldScale: 16 });
  const width = world.width;
  const seen = new Set<string>();
  const pathAt = (tx: number, ty: number) => {
    if (ty < 0 || ty >= world.height) return false;
    const wx = ((tx % width) + width) % width;
    return world.paths[wx + ty * width] === 1;
  };
  for (let y = 0; y < world.height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const center = world.biomes[x + row] ?? 0;
      const at = (tx: number, ty: number) => {
        if (ty < 0 || ty >= world.height) return 0;
        const wx = ((tx % width) + width) % width;
        return world.biomes[wx + ty * width] ?? 0;
      };
      const tile = resolveTile({
        center,
        n: at(x, y - 1),
        e: at(x + 1, y),
        s: at(x, y + 1),
        w: at(x - 1, y),
        nw: at(x - 1, y - 1),
        ne: at(x + 1, y - 1),
        se: at(x + 1, y + 1),
        sw: at(x - 1, y + 1),
      });
      expect(tile.id.length).toBeGreaterThan(0);
      seen.add(tile.kind);
      if (pathAt(x, y) && center !== 0) {
        const road = resolveRoad(
          pathAt(x, y - 1),
          pathAt(x + 1, y),
          pathAt(x, y + 1),
          pathAt(x - 1, y),
        );
        expect(road.id.length).toBeGreaterThan(0);
      }
    }
  }
  expect(seen.has('ground')).toBe(true);
  expect(seen.has('fill') || seen.has('authored')).toBe(true);
}, 60_000);
