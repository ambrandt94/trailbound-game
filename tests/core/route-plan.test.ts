import { expect, test } from 'vitest';
import { Biome, DEFAULT_WORLD_SETTINGS, type WorldData } from '../../src/core/world/models';
import { planRoute, tileCost, ROUTE_COST } from '../../src/core/world/route-plan';

function flatWorld(w: number, h: number, biome = Biome.Plains): WorldData {
  const n = w * h;
  const biomes = new Uint8Array(n).fill(biome);
  return {
    seed: 1,
    width: w,
    height: h,
    settings: { ...DEFAULT_WORLD_SETTINGS, worldScale: 1 },
    biomes,
    heightM: new Float32Array(n),
    heights: new Float32Array(n),
    paths: new Uint8Array(n),
    nodes: [],
    pois: [],
    features: [],
  };
}

function set(world: WorldData, x: number, y: number, biome: Biome): void {
  world.biomes[x + y * world.width] = biome;
}

function road(world: WorldData, x: number, y: number): void {
  world.paths[x + y * world.width] = 1;
}

test('costs rank road, open land, forest, hills, mountains, and water', () => {
  const world = flatWorld(6, 1);
  road(world, 0, 0);
  set(world, 2, 0, Biome.Forest);
  set(world, 3, 0, Biome.Hills);
  set(world, 4, 0, Biome.Mountain);
  set(world, 5, 0, Biome.Water);
  const costs = [0, 1, 2, 3, 4, 5].map((x) => tileCost(world, x, 0));
  expect(costs).toEqual([
    ROUTE_COST.road,
    ROUTE_COST.open,
    ROUTE_COST.forest,
    ROUTE_COST.hills,
    ROUTE_COST.mountain,
    Infinity,
  ]);
});

test('the route bends out to a road rather than cross open land', () => {
  // Straight across row 10 is open land; a road runs along row 2 with spurs.
  const world = flatWorld(60, 20);
  for (let x = 5; x <= 55; x++) road(world, x, 2);
  for (let y = 2; y <= 10; y++) {
    road(world, 5, y);
    road(world, 55, y);
  }
  const plan = planRoute(world, { x: 5.5, y: 10.5 }, { x: 55.5, y: 10.5 });
  expect(plan).not.toBeNull();
  if (!plan) return;
  // Sample the line where it crosses x = 30: it should be on the row-2 road.
  let crossY = NaN;
  for (let i = 1; i < plan.points.length; i++) {
    const a = plan.points[i - 1]!;
    const b = plan.points[i]!;
    if ((a.x - 30) * (b.x - 30) <= 0 && a.x !== b.x) {
      crossY = a.y + ((b.y - a.y) * (30 - a.x)) / (b.x - a.x);
      break;
    }
  }
  expect(crossY).toBeGreaterThanOrEqual(2);
  expect(crossY).toBeLessThan(3.5);
  // Roughly 8 + 50 + 8 road tiles beats 50 open tiles (150).
  expect(plan.cost).toBeLessThan(50 * ROUTE_COST.open);
});

test('the route goes around a lake and never stands on water', () => {
  const world = flatWorld(40, 40);
  for (let y = 5; y < 35; y++) {
    for (let x = 15; x < 25; x++) set(world, x, y, Biome.Water);
  }
  const plan = planRoute(world, { x: 5.5, y: 20.5 }, { x: 34.5, y: 20.5 });
  expect(plan).not.toBeNull();
  if (!plan) return;
  // Walk the polyline finely and check every sample is on land.
  for (let i = 1; i < plan.points.length; i++) {
    const a = plan.points[i - 1]!;
    const b = plan.points[i]!;
    const steps = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) * 4) + 1;
    for (let s = 0; s <= steps; s++) {
      const x = a.x + ((b.x - a.x) * s) / steps;
      const y = a.y + ((b.y - a.y) * s) / steps;
      const biome = world.biomes[Math.floor(x) + Math.floor(y) * world.width];
      expect(biome).not.toBe(Biome.Water);
    }
  }
  const ys = plan.points.map((p) => p.y);
  expect(Math.min(...ys) < 5 || Math.max(...ys) > 35).toBe(true);
});

test('open water as a goal, or a goal walled off by water, has no route', () => {
  const world = flatWorld(30, 30);
  set(world, 20, 20, Biome.Water);
  expect(planRoute(world, { x: 2.5, y: 2.5 }, { x: 20.5, y: 20.5 })).toBeNull();
  for (let y = 0; y < 30; y++) set(world, 10, y, Biome.Water);
  expect(planRoute(world, { x: 2.5, y: 2.5 }, { x: 25.5, y: 25.5 })).toBeNull();
});
