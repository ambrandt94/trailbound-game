import { expect, test } from 'vitest';
import {
  createWorld,
  heroTileOnScreen,
  landAfterAreaExit,
  type PlaceFootprint,
} from '../../src/core/state/world-state';

const foot: PlaceFootprint = { minX: 12, minY: 12, maxX: 23, maxY: 23 };
const bounds = { width: 36, height: 36 };
const entry = { x: 18.4, y: 16.2, yaw: 0.3 };

test('escape returns to the tile the traveller entered from', () => {
  const back = landAfterAreaExit(
    { side: 'north', pos: 0.5, yaw: 0, cancel: true },
    foot,
    entry,
    { x: 8, y: 8 },
    bounds,
  );
  expect(back.x).toBeCloseTo(entry.x, 5);
  expect(back.y).toBeCloseTo(entry.y, 5);
  expect(back.yaw).toBe(entry.yaw);
  expect(Math.floor(back.x)).toBe(Math.floor(entry.x));
  expect(Math.floor(back.y)).toBe(Math.floor(entry.y));
});

test('walking off an edge lands on the adjacent tile, lined up with the crossing', () => {
  const east = landAfterAreaExit(
    { side: 'east', pos: 0, yaw: 0.4 },
    foot,
    entry,
    { x: 8, y: 8 },
    bounds,
  );
  expect(Math.floor(east.x)).toBe(foot.maxX + 1);
  expect(Math.floor(east.y)).toBe(foot.minY);
  const north = landAfterAreaExit(
    { side: 'north', pos: 1, yaw: 1 },
    foot,
    entry,
    { x: 8, y: 8 },
    bounds,
  );
  expect(Math.floor(north.y)).toBe(foot.minY - 1);
  expect(Math.floor(north.x)).toBe(foot.maxX);
});

test('an exit off the north edge of the world stays on the map', () => {
  const landed = landAfterAreaExit(
    { side: 'north', pos: 0.5, yaw: 0 },
    { minX: 4, minY: 0, maxX: 8, maxY: 6 },
    entry,
    { x: 6, y: 3 },
    bounds,
  );
  expect(landed.y).toBeGreaterThanOrEqual(0.5);
  expect(landed.y).toBeLessThan(bounds.height);
});

test('the drawn tile stays put when the zoom changes', () => {
  const heroX = 18.4;
  const heroY = 16.2;
  const cameraX = 20.1;
  const cameraY = 15.4;
  const tiles = [0.05, 0.5, 1, 3.6].map((scale) =>
    heroTileOnScreen(heroX, heroY, cameraX, cameraY, scale, 1400, 900),
  );
  for (const tile of tiles) {
    expect(tile).toEqual({ x: Math.floor(heroX), y: Math.floor(heroY) });
  }
});

test('save and load restore the same map tile', () => {
  const world = createWorld({ id: 'waystead', name: 'Waystead', x: 8, y: 8 });
  world.hero = { x: 12.25, y: 9.75, yaw: 1.2 };
  const packed = world.toPacked({
    gameVersion: '0',
    cfPin: { version: '0', generatorVersion: '0' },
    playerName: 'Traveller',
  });
  const loaded = createWorld({ id: 'waystead', name: 'Waystead', x: 1, y: 1 });
  loaded.load(packed);
  expect(loaded.hero.x).toBeCloseTo(12.25, 5);
  expect(loaded.hero.y).toBeCloseTo(9.75, 5);
  expect(loaded.hero.yaw).toBeCloseTo(1.2, 5);
  expect(Math.floor(loaded.hero.x)).toBe(12);
  expect(Math.floor(loaded.hero.y)).toBe(9);
});
