import { expect, test } from 'vitest';
import { describeMapStand } from '../../src/core/area/area-window';
import {
  fineTileCenter,
  fineToDisplay,
  mapDisplayStep,
  markerDisplay,
  wagonTrailFine,
} from '../../src/core/world/map-grid';
import {
  Biome,
  DEFAULT_WORLD_SETTINGS,
  nodeContaining,
  type MapNode,
  type PointOfInterest,
  type WorldData,
} from '../../src/core/world/models';

test('display step is 16 on a 3072 map and 1 on the 192 sheet', () => {
  expect(mapDisplayStep(3072)).toBe(16);
  expect(mapDisplayStep(192)).toBe(1);
});

test('a marker converts back to the same fine tile the hero is standing on', () => {
  const step = 16;
  const fine = 100.2;
  const center = fineTileCenter(fine);
  expect(center).toBe(100.5);
  const display = markerDisplay(fine, step);
  const back = display * step;
  expect(back).toBeCloseTo(center, 8);
  expect(Math.floor(back)).toBe(Math.floor(fine));
  const halfCell = (display + 0.5) * step;
  expect(Math.abs(Math.floor(halfCell) - Math.floor(fine))).toBeGreaterThanOrEqual(7);
  expect(fineToDisplay(center, step) * step).toBeCloseTo(center, 8);
});

test('the wagon trails just behind a north-facing hero', () => {
  const trail = wagonTrailFine(10, 20, 0, 16, 3.6);
  expect(trail.x).toBeCloseTo(10, 5);
  expect(trail.y).toBeGreaterThan(20);
  const gap = (trail.y - 20) / 16;
  expect(gap).toBeGreaterThanOrEqual(0.55);
  expect(gap).toBeLessThanOrEqual(1.5);
});

test('standing on a settlement or POI marker resolves that place', () => {
  const world = sampleWorld();
  const town = world.nodes[0]!;
  const townStand = describeMapStand(world, town.cx, town.cy);
  expect(townStand.name).toBe('Ashfen');
  expect(townStand.standLine).toBe('In Ashfen');
  expect(townStand.canEnter).toBe(true);
  expect(nodeContaining(world.nodes, town.cx, town.cy)?.id).toBe(town.id);
  const step = mapDisplayStep(world.width);
  const drawn = markerDisplay(town.cx, step) * step;
  expect(describeMapStand(world, drawn, markerDisplay(town.cy, step) * step).name).toBe('Ashfen');

  const poi = world.pois[0]!;
  const poiStand = describeMapStand(world, poi.x, poi.y);
  expect(poiStand.name).toBe('Greyfen Ruins');
  expect(poiStand.standLine).toBe('In Greyfen Ruins');
  const poiBackX = markerDisplay(poi.x, step) * step;
  const poiBackY = markerDisplay(poi.y, step) * step;
  expect(describeMapStand(world, poiBackX, poiBackY).name).toBe('Greyfen Ruins');

  const away = describeMapStand(world, 30.5, 40.5);
  expect(away.name).not.toBe('Greyfen Ruins');
  expect(away.nearestLine).toContain('Greyfen');
});

function sampleWorld(): WorldData {
  const width = 64;
  const height = 64;
  const biomes = new Uint8Array(width * height);
  biomes.fill(Biome.Plains);
  const tiles = [];
  for (let y = 20; y <= 24; y++) {
    for (let x = 30; x <= 34; x++) tiles.push({ x, y });
  }
  const node: MapNode = {
    id: 'ashfen',
    name: 'Ashfen',
    origin: 'authored',
    kind: 'town',
    biome: Biome.Plains,
    cx: 32.5,
    cy: 22.5,
    radius: 3,
    x0: 30,
    y0: 20,
    x1: 35,
    y1: 25,
    tiles,
    seed: 1,
  };
  const poi: PointOfInterest = {
    id: 'poi-ruins-0',
    name: 'Greyfen Ruins',
    kind: 'ruins',
    x: 8.5,
    y: 8.5,
    radius: 4,
    seed: 3,
    biome: Biome.Plains,
  };
  return {
    seed: 1,
    width,
    height,
    settings: { ...DEFAULT_WORLD_SETTINGS, worldScale: 1 },
    biomes,
    heightM: new Float32Array(width * height),
    heights: new Float32Array(width * height),
    paths: new Uint8Array(width * height),
    nodes: [node],
    pois: [poi],
    features: [],
  };
}
