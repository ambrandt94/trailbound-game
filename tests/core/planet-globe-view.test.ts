import { expect, test } from 'vitest';
import {
  angleBetween,
  chunkToSphere,
  globeDiameterPx,
  globeLook,
  globeTurnWeight,
  homeChunk,
} from '../../src/core/planet';
import { MapCamera } from '../../src/render/map/map-camera';
import {
  DEFAULT_WORLD_SETTINGS,
  TILE,
  clampSettings,
  globeMinScaleFor,
  minScaleFor,
  type WorldSettings,
} from '../../src/core/world/models';
import { savedWorldSettings } from '../../src/core/save/migrations';
import type { PackedWorld } from '../../src/core/save/types';

test('at the globe switch the home chunk is the size of the flat map', () => {
  const cells = 192;
  const scale = minScaleFor(cells);
  const n = 20;
  const d = globeDiameterPx(scale, cells, n, 1100, 660);
  const chunkPx = (d / 2) * (Math.PI / 2 / n);
  expect(chunkPx).toBeCloseTo(cells * TILE * scale, 6);
  // Fully out, the planet is framed by the existing globe fill.
  const far = globeDiameterPx(globeMinScaleFor(cells), cells, n, 1100, 660);
  expect(far).toBeGreaterThan(200);
  expect(far).toBeLessThan(660);
  // Zooming out never grows the planet.
  let last = Infinity;
  for (let s = scale; s >= globeMinScaleFor(cells); s *= 0.9) {
    const v = globeDiameterPx(s, cells, n, 1100, 660);
    expect(v).toBeLessThanOrEqual(last + 1e-6);
    last = v;
  }
});

test('the player turn fades out before the switch so the hand-over lines up', () => {
  const sw = minScaleFor(192);
  expect(globeTurnWeight(sw, sw)).toBe(0);
  expect(globeTurnWeight(sw * 0.3, sw)).toBe(1);
  const home = chunkToSphere(20, homeChunk(20), 0.4, 0.6);
  expect(angleBetween(globeLook(home, 0.5, 1, 0), home)).toBeLessThan(1e-9);
  expect(angleBetween(globeLook(home, 0, 0.5, 1), home)).toBeGreaterThan(0.4);
});

test('map camera: the globe band opens only when the globe is ready', () => {
  const cam = new MapCamera();
  cam.frame(3072, 3072, 1500, 1500);
  const flat = minScaleFor(192);
  cam.lookAt(1500, 1500, 0.001);
  expect(cam.scale).toBeCloseTo(flat, 9);
  expect(cam.inGlobe()).toBe(false);
  cam.setGlobeZoom(true);
  cam.lookAt(1500, 1500, 0.001);
  expect(cam.scale).toBeCloseTo(globeMinScaleFor(192), 9);
  expect(cam.inGlobe()).toBe(true);
  // Pace and clock read the furthest flat zoom while the globe is up.
  expect(cam.mapScale()).toBeCloseTo(flat, 9);
  cam.setGlobeZoom(false);
  expect(cam.scale).toBeCloseTo(flat, 9);
  expect(cam.inGlobe()).toBe(false);
});

test('saves: the planet preset round-trips and older saves read the default planet', () => {
  const base = {
    clockHours: 8,
    worldSeed: 7,
    player: { name: 'T', mapX: 1, mapY: 1, yaw: 0 },
    gameVersion: 'x',
    cfPin: { version: 'a', generatorVersion: 'b' },
  } as unknown as PackedWorld;
  expect(savedWorldSettings(base).planet).toBe('standard');
  const preM1 = { ...DEFAULT_WORLD_SETTINGS } as Partial<WorldSettings>;
  delete preM1.planet;
  expect(savedWorldSettings({ ...base, worldSettings: preM1 as WorldSettings }).planet).toBe(
    'standard',
  );
  const tiny = clampSettings({ ...DEFAULT_WORLD_SETTINGS, planet: 'tiny' });
  const back = savedWorldSettings(JSON.parse(JSON.stringify({ ...base, worldSettings: tiny })));
  expect(back.planet).toBe('tiny');
  expect(clampSettings({ planet: 'galactic' as never }).planet).toBe('standard');
});
