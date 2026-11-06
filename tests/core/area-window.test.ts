import { expect, test } from 'vitest';
import { buildAreaExport } from '../../src/core/area/build-area';
import {
  AREA_WINDOW_TILES,
  SETTLEMENT_STOP_SCALE,
  clampStepToSettlement,
  cutAreaWindow,
  resolveAreaAt,
  windowSeed,
} from '../../src/core/area/area-window';
import { createWorld } from '../../src/core/state/world-state';
import { metersToNormalized } from '../../src/core/world/terrain';
import {
  Biome,
  DEFAULT_WORLD_SETTINGS,
  type MapNode,
  type Vec2,
  type WorldData,
} from '../../src/core/world/models';

function blankWorld(seed: number, size = 36): WorldData {
  const n = size * size;
  const biomes = new Uint8Array(n);
  biomes.fill(Biome.Plains);
  const heightM = new Float32Array(n);
  heightM.fill(40);
  const heights = new Float32Array(n);
  heights.fill(metersToNormalized(40));
  return {
    seed,
    width: size,
    height: size,
    settings: { ...DEFAULT_WORLD_SETTINGS, worldScale: 1 },
    biomes,
    heightM,
    heights,
    paths: new Uint8Array(n),
    nodes: [],
    pois: [],
    features: [],
  };
}

function paint(world: WorldData, x: number, y: number, biome: Biome, metres: number): void {
  const i = x + y * world.width;
  world.biomes[i] = biome;
  world.heightM[i] = metres;
  world.heights[i] = metersToNormalized(metres);
}

function hamletTiles(): Vec2[] {
  const tiles: Vec2[] = [];
  for (let y = 14; y <= 20; y++) {
    for (let x = 14; x <= 20; x++) tiles.push({ x, y });
  }
  return tiles;
}

function hamlet(tiles: Vec2[]): MapNode {
  return {
    id: 'ham',
    name: 'Hamble',
    origin: 'authored',
    kind: 'hamlet',
    biome: Biome.Forest,
    cx: 17,
    cy: 17,
    radius: 4,
    x0: 14,
    y0: 14,
    x1: 21,
    y1: 21,
    tiles,
    seed: 3,
  };
}

function dress(world: WorldData): MapNode {
  for (let y = 12; y < 24; y++) {
    for (let x = 12; x < 24; x++) paint(world, x, y, Biome.Forest, 48);
  }
  for (let y = 0; y <= 7; y++) {
    for (let x = 0; x <= 7; x++) paint(world, x, y, Biome.Water, -80);
  }
  paint(world, 6, 2, Biome.Water, -0.4);
  const tiles = hamletTiles();
  const node = hamlet(tiles);
  world.nodes = [node];
  world.paths[13 + 12 * world.width] = 1;
  return node;
}

test('a window snaps to the same tiles anywhere inside it and follows the world seed', () => {
  const world = blankWorld(7741);
  dress(world);
  const west = cutAreaWindow(world, 12.1, 12.2);
  const east = cutAreaWindow(world, 23.9, 23.4);
  expect(west.id).toBe('wild-12-12');
  expect(east.id).toBe(west.id);
  expect(east.tiles).toEqual(west.tiles);
  expect(west.tiles).toHaveLength(AREA_WINDOW_TILES * AREA_WINDOW_TILES);
  expect(west.x0).toBe(12);
  expect(west.y0).toBe(12);
  expect(west.x1).toBe(24);
  expect(west.biome).toBe(Biome.Forest);
  expect(cutAreaWindow(world, 24, 12.2).id).toBe('wild-24-12');
  expect(windowSeed(7741, 12, 12)).toBe(west.seed);
  expect(cutAreaWindow(blankWorld(99), 12.4, 18).seed).not.toBe(west.seed);
  expect(cutAreaWindow(blankWorld(99), 12.4, 18).id).toBe(west.id);
});

test('settlements keep every town tile and wilderness cuts a window around the stand', () => {
  const world = blankWorld(7741);
  const node = dress(world);
  const town = resolveAreaAt(world, 15.2, 16.8);
  expect(town?.cacheKey).toBe('settle:ham');
  expect(town?.node.tiles).toEqual(node.tiles);
  expect(town?.node.tiles.length).toBeGreaterThan(AREA_WINDOW_TILES);

  const wild = resolveAreaAt(world, 12.5, 12.5);
  expect(wild?.cacheKey).toBe('wild:12:12');
  expect(wild?.node.kind).toBe('grove');
  expect(wild?.node.tiles).toHaveLength(AREA_WINDOW_TILES * AREA_WINDOW_TILES);
  expect(wild?.node.tiles.some((tile) => tile.x === 15 && tile.y === 15)).toBe(true);
  expect(wild?.minX).toBe(12);
  expect(wild?.maxX).toBe(23);

  expect(resolveAreaAt(world, 2.5, 2.5)).toBeNull();
  const shore = resolveAreaAt(world, 6.2, 2.4);
  expect(shore?.cacheKey.startsWith('wild:')).toBe(true);
  expect(shore?.node.tiles.some((tile) => tile.x === 8 && tile.y === 2)).toBe(true);
});

test('wilderness export matches the window and a settlement export keeps the town', () => {
  const world = blankWorld(7741);
  const node = dress(world);
  const state = createWorld({ id: 'x', name: 'X', x: 1, y: 1 });
  state.data = world;
  state.seed = world.seed;
  state.hero = { x: 12.5, y: 12.5, yaw: 0 };

  const first = state.buildHandoffHere();
  expect(first).not.toBeNull();
  if (!first) return;
  expect(first.areaExport.area.kind).toBe('grove');
  expect(first.areaExport.area.settlement).toBeUndefined();
  expect(first.areaExport.area.biome).toBe('Forest');
  expect(first.areaExport.area.name).toBe('Woodland');
  expect(first.areaExport.area.worldBounds).toEqual({ x0: 12, y0: 12, x1: 23, y1: 23 });
  expect(first.areaExport.roads.worldTiles).toContainEqual([13, 12]);
  expect(first.areaExport.layers.height.raw.length).toBeGreaterThan(10);
  expect(first.areaExport.layers.heightM.data.length).toBeGreaterThan(10);
  expect(first.areaExport.buildings.length).toBeGreaterThan(0);

  state.clockHours = 11.5;
  state.hero = { x: 23.2, y: 20.4, yaw: 0.2 };
  const again = state.buildHandoffHere();
  expect(again?.areaExport).toBe(first.areaExport);
  expect(again?.areaExport.meta.hash).toBe(first.areaExport.meta.hash);
  expect(again?.areaExport.meta.timeOfDayHours).toBe(11.5);

  const wildNode = resolveAreaAt(world, 13.2, 13.2)?.node;
  expect(wildNode?.id).toBe('wild-12-12');
  if (!wildNode) return;
  const rebuilt = buildAreaExport(world, wildNode, {
    exportedAt: 'later',
    timeOfDayHours: 3,
  });
  expect(rebuilt.meta.hash).toBe(first.areaExport.meta.hash);

  const other = blankWorld(99);
  dress(other);
  const shifted = buildAreaExport(other, resolveAreaAt(other, 13.2, 13.2)!.node, {
    timeOfDayHours: 8,
  });
  expect(shifted.meta.hash).not.toBe(first.areaExport.meta.hash);

  state.hero = { x: 15.5, y: 15.5, yaw: 0 };
  const town = state.buildHandoffHere();
  expect(town?.areaExport.area.settlement).toBeTruthy();
  expect(town?.areaExport.area.id).toBe('ham');
  expect(town?.areaExport.area.worldTiles).toHaveLength(node.tiles.length);
  expect(town?.areaExport).not.toBe(first.areaExport);

  state.hero = { x: 18, y: 18, yaw: 0.2 };
  state.buildHandoffHere();
  state.placeHeroOutside({ side: 'north', pos: 0.5, yaw: 0, cancel: true });
  expect(state.hero.x).toBeCloseTo(18, 5);
  expect(state.hero.y).toBeCloseTo(18, 5);
  expect(state.hero.yaw).toBeCloseTo(0.2, 5);

  state.placeHeroOutside({ side: 'north', pos: 0.5, yaw: 1 });
  expect(state.footprint?.minY).toBe(14);
  expect(state.hero.y).toBeCloseTo(14 - 0.5, 5);
  expect(Math.floor(state.hero.y)).toBe(13);
  expect(state.hero.yaw).toBe(1);

  state.hero = { x: 12.5, y: 12.5, yaw: 0 };
  state.buildHandoffHere();
  state.placeHeroOutside({ side: 'east', pos: 0, yaw: 0.4 });
  expect(state.hero.x).toBeCloseTo(23 + 1.5, 5);
  expect(Math.floor(state.hero.x)).toBe(24);
  expect(state.hero.y).toBeCloseTo(12.5, 5);
}, 60_000);

test('detail zoom stops a stride on the first settlement tile it crosses', () => {
  const world = blankWorld(7741);
  dress(world);
  const stopped = clampStepToSettlement(world, 8.5, 14.5, 8, 0, SETTLEMENT_STOP_SCALE);
  expect(stopped.holdId).toBe('ham');
  expect(Math.floor(8.5 + stopped.dx)).toBe(14);
  expect(8.5 + stopped.dx).toBeGreaterThanOrEqual(14);
  expect(8.5 + stopped.dx).toBeLessThan(14.05);
  expect(stopped.dy).toBeCloseTo(0, 5);

  const far = clampStepToSettlement(world, 8.5, 14.5, 8, 0, SETTLEMENT_STOP_SCALE - 0.1);
  expect(far.holdId).toBeNull();
  expect(far.dx).toBe(8);

  const inside = clampStepToSettlement(world, 15.2, 15.2, 2, 0, 12);
  expect(inside.holdId).toBeNull();
  expect(inside.dx).toBe(2);

  const miss = clampStepToSettlement(world, 8.5, 14.5, 0.4, 0, 12);
  expect(miss.holdId).toBeNull();
  expect(miss.dx).toBeCloseTo(0.4, 5);
});
