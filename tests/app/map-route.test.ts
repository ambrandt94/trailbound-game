import { expect, test } from 'vitest';
import { ROUTE_FIT_MAX_SCALE, resolveRouteTarget, routeFrame } from '../../src/app/map-route';
import { createCaravan, setRoute } from '../../src/core/sim/caravan';
import { Biome, DEFAULT_WORLD_SETTINGS, type WorldData } from '../../src/core/world/models';

function world(): WorldData {
  const w = 40;
  const n = w * w;
  const biomes = new Uint8Array(n).fill(Biome.Plains);
  for (let x = 0; x < w; x++) biomes[x + 39 * w] = Biome.Water;
  const tiles = [];
  for (let y = 10; y <= 14; y++) for (let x = 10; x <= 14; x++) tiles.push({ x, y });
  return {
    seed: 1,
    width: w,
    height: w,
    settings: { ...DEFAULT_WORLD_SETTINGS, worldScale: 1 },
    biomes,
    heightM: new Float32Array(n),
    heights: new Float32Array(n),
    paths: new Uint8Array(n),
    nodes: [
      {
        id: 'ham',
        name: 'Hamlet',
        origin: 'authored',
        kind: 'village',
        biome: Biome.Plains,
        cx: 12.5,
        cy: 12.5,
        radius: 3,
        x0: 10,
        y0: 10,
        x1: 15,
        y1: 15,
        tiles,
        seed: 1,
      },
    ],
    pois: [
      {
        id: 'p',
        name: 'Old Shrine',
        kind: 'shrine',
        x: 30.5,
        y: 30.5,
        radius: 1,
        seed: 1,
        biome: Biome.Plains,
      },
    ],
    features: [],
  };
}

test('a click snaps to a settlement, a nearby POI, or the land tile, and refuses water', () => {
  const w = world();
  expect(resolveRouteTarget(w, 11.2, 13.9, 1)).toEqual({
    x: 12.5,
    y: 12.5,
    name: 'Hamlet',
    placeId: 'ham',
  });
  expect(resolveRouteTarget(w, 31.4, 30.1, 2)?.name).toBe('Old Shrine');
  expect(resolveRouteTarget(w, 22.7, 5.2, 1)).toEqual({
    x: 22.5,
    y: 5.5,
    name: null,
    placeId: null,
  });
  expect(resolveRouteTarget(w, 5.5, 39.5, 1)).toBeNull();
});

test('show route fits the whole route and stays a zoomed-out camera scale', () => {
  const caravan = setRoute(
    createCaravan(100, 100),
    [
      { x: 100, y: 100 },
      { x: 900, y: 500 },
    ],
    [{ x: 900, y: 500, name: 'Far', placeId: null }],
  );
  const frame = routeFrame(caravan, 16, 1440, 900);
  expect(frame).not.toBeNull();
  if (!frame) return;
  expect(frame.x).toBeCloseTo(500 / 16, 6);
  expect(frame.y).toBeCloseTo(300 / 16, 6);
  expect(frame.scale).toBeLessThanOrEqual(ROUTE_FIT_MAX_SCALE);
  // 50 display tiles of route fit inside half the view width.
  expect((800 / 16) * 16 * frame.scale).toBeLessThanOrEqual(1440 * 0.5 + 1e-6);
  expect(routeFrame(createCaravan(0, 0), 16, 1440, 900)).toBeNull();
});
