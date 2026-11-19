import { expect, test } from 'vitest';
import {
  AREA_WINDOW_TILES,
  CONVOY_TRAIL_FRAC,
  convoyAnchorFractions,
  convoyWindowOrigin,
  cutConvoyWindow,
} from '../../src/core/area/area-window';
import { createCaravan, setRoute, type CaravanState } from '../../src/core/sim/caravan';
import { CONVOY_AHEAD_MIN_M, convoyAheadPoint, tileToLocal } from '../../src/core/sim/convoy';
import { WorldState } from '../../src/core/state/world-state';
import { metersToNormalized } from '../../src/core/world/terrain';
import { Biome, DEFAULT_WORLD_SETTINGS, type WorldData } from '../../src/core/world/models';

const SPAN = AREA_WINDOW_TILES;

function plains(seed: number, size = 200): WorldData {
  const n = size * size;
  return {
    seed,
    width: size,
    height: size,
    settings: { ...DEFAULT_WORLD_SETTINGS, worldScale: 1 },
    biomes: new Uint8Array(n).fill(Biome.Plains),
    heightM: new Float32Array(n).fill(40),
    heights: new Float32Array(n).fill(metersToNormalized(40)),
    paths: new Uint8Array(n),
    nodes: [],
    pois: [],
    features: [],
  };
}

/** A route from `a` to `b`, with the caravan `along` tiles down it. */
function routed(a: { x: number; y: number }, b: { x: number; y: number }, along: number) {
  const c = setRoute(createCaravan(a.x, a.y), [a, b], [{ ...b, name: 'Far', placeId: null }], null);
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const t = along / len;
  return { ...c, along, x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t } as CaravanState;
}

/** Where `p` sits in the window, 0..1 per axis. */
function fractionIn(
  w: { x0: number; y0: number; x1: number; y1: number },
  p: { x: number; y: number },
) {
  return { fx: (p.x - w.x0) / (w.x1 - w.x0), fy: (p.y - w.y0) / (w.y1 - w.y0) };
}

test('zones are 24 tiles, 192 m, twice the old 96 m a side', () => {
  expect(SPAN).toBe(24);
  expect(SPAN * 8).toBe(192);
});

test('no route ahead: the window stays centred on the wagon', () => {
  expect(convoyAnchorFractions({ x: 100, y: 100 }, null)).toEqual({ fx: 0.5, fy: 0.5 });
  expect(convoyAnchorFractions({ x: 100, y: 100 }, undefined)).toEqual({ fx: 0.5, fy: 0.5 });
  // The ahead point is on top of the wagon: no direction.
  expect(convoyAnchorFractions({ x: 100, y: 100 }, { x: 100, y: 100 })).toEqual({
    fx: 0.5,
    fy: 0.5,
  });
  const w = cutConvoyWindow(plains(1), 100.3, 100.6);
  expect(w.x0).toBe(Math.round(100.3 - SPAN / 2));
  expect(w.y0).toBe(Math.round(100.6 - SPAN / 2));
  const f = fractionIn(w, { x: 100.3, y: 100.6 });
  expect(f.fx).toBeCloseTo(0.5, 1);
  expect(f.fy).toBeCloseTo(0.5, 1);
});

test('east-moving: the wagon sits in the west part of the window with the zone ahead', () => {
  const at = { x: 100.4, y: 100.4 };
  const w = cutConvoyWindow(plains(1), at.x, at.y, { x: at.x + SPAN, y: at.y });
  const f = fractionIn(w, at);
  expect(f.fx).toBeGreaterThan(0.15);
  expect(f.fx).toBeLessThan(0.3);
  expect(f.fy).toBeCloseTo(0.5, 1);
  // The road ahead: at least 70% of the window, ~150 m at 192 m wide.
  expect((w.x1 - at.x) * 8).toBeGreaterThan(0.7 * SPAN * 8);
  expect(w.x1 - w.x0).toBe(SPAN);
  expect(convoyAnchorFractions(at, { x: at.x + SPAN, y: at.y }).fx).toBeCloseTo(
    CONVOY_TRAIL_FRAC,
    9,
  );
});

test('west, north and south-moving mirror it', () => {
  const at = { x: 100.4, y: 100.4 };
  const world = plains(1);
  const west = cutConvoyWindow(world, at.x, at.y, { x: at.x - SPAN, y: at.y });
  expect(fractionIn(west, at).fx).toBeGreaterThan(0.7);
  const north = cutConvoyWindow(world, at.x, at.y, { x: at.x, y: at.y - SPAN });
  expect(fractionIn(north, at).fy).toBeGreaterThan(0.7);
  expect(fractionIn(north, at).fx).toBeCloseTo(0.5, 1);
  const south = cutConvoyWindow(world, at.x, at.y, { x: at.x, y: at.y + SPAN });
  expect(fractionIn(south, at).fy).toBeLessThan(0.3);
  expect(south.y1 - at.y).toBeGreaterThan(0.7 * SPAN);
});

test('diagonal: the wagon trails in the corner it came from', () => {
  const at = { x: 100.4, y: 100.4 };
  const se = cutConvoyWindow(plains(1), at.x, at.y, { x: at.x + 20, y: at.y + 20 });
  const f = fractionIn(se, at);
  expect(f.fx).toBeLessThan(0.3);
  expect(f.fy).toBeLessThan(0.3);
  const nw = cutConvoyWindow(plains(1), at.x, at.y, { x: at.x - 20, y: at.y - 20 });
  expect(fractionIn(nw, at).fx).toBeGreaterThan(0.7);
  expect(fractionIn(nw, at).fy).toBeGreaterThan(0.7);
  // A shallow slope leans mostly along x, a little in y.
  const shallow = convoyAnchorFractions(at, { x: at.x + 24, y: at.y + 6 });
  expect(shallow.fx).toBeCloseTo(CONVOY_TRAIL_FRAC, 9);
  expect(shallow.fy).toBeGreaterThan(0.3);
  expect(shallow.fy).toBeLessThan(0.5);
});

test('near the world edge the window clamps and still holds the wagon', () => {
  const world = plains(1);
  // West-bound at the west edge: wants the wagon 78% in, so the window would start left of 0.
  const west = cutConvoyWindow(world, 5.5, 100.5, { x: -20, y: 100.5 });
  expect(west.x0).toBe(0);
  expect(west.x1).toBe(SPAN);
  expect(fractionIn(west, { x: 5.5, y: 100.5 }).fx).toBeGreaterThan(0);
  // East-bound at the east edge.
  const east = cutConvoyWindow(world, 195.5, 100.5, { x: 220, y: 100.5 });
  expect(east.x1).toBe(200);
  expect(east.x0).toBe(200 - SPAN);
  expect(fractionIn(east, { x: 195.5, y: 100.5 }).fx).toBeLessThan(1);
  // South-bound at the south edge, north-bound at the north edge.
  expect(cutConvoyWindow(world, 100.5, 196.5, { x: 100.5, y: 230 }).y1).toBe(200);
  expect(cutConvoyWindow(world, 100.5, 2.5, { x: 100.5, y: -30 }).y0).toBe(0);
  // Heading into the open side of an edge keeps the full bias.
  const open = convoyWindowOrigin({ x: 5.5, y: 100.5 }, { x: 40, y: 100.5 }, SPAN, 200, 200);
  expect(open.x0).toBe(0);
  expect(open.y0).toBe(Math.round(100.5 - SPAN / 2));
});

test('the ahead point is about a zone-width down the road, clamped to its end', () => {
  const route = [0, 0, 100, 0];
  const mid = convoyAheadPoint(route, 10, 100, SPAN);
  expect(mid?.x).toBeCloseTo(10 + SPAN, 9);
  // Near the end the point clamps to the end.
  expect(convoyAheadPoint(route, 90, 100, SPAN)?.x).toBeCloseTo(100, 9);
  // A bend: the point is down the road, not along the instantaneous heading.
  const bend = convoyAheadPoint([0, 0, 10, 0, 10, 40], 0, 50, SPAN);
  expect(bend?.x).toBeCloseTo(10, 9);
  expect(bend?.y).toBeCloseTo(SPAN - 10, 9);
  // Too close to give a direction, or no route at all.
  expect(convoyAheadPoint(route, 99.9, 100, SPAN)).toBeNull();
  expect(CONVOY_AHEAD_MIN_M).toBeGreaterThan(0);
  expect(convoyAheadPoint([], 0, 0, SPAN)).toBeNull();
  // From a point other than the wagon (the hero's exit).
  expect(convoyAheadPoint(route, 50, 100, SPAN, { x: 10, y: 0 })?.x).toBeCloseTo(50 + SPAN, 9);
});

test('a rolling route leans the handoff; halted, arrived or no route stays centred', () => {
  const world = new WorldState();
  world.data = plains(4411);
  world.seed = 4411;
  world.caravan = routed({ x: 40, y: 100.5 }, { x: 180, y: 100.5 }, 30);
  const ahead = world.convoyAhead();
  expect(ahead).not.toBeNull();
  expect(ahead?.x).toBeCloseTo(70 + SPAN, 6);
  const leaning = world.buildConvoyHandoff(undefined, undefined, true, ahead);
  const c = leaning?.convoy;
  expect(c).toBeTruthy();
  if (!c) return;
  const wagon = tileToLocal(c.frame, world.caravan.x, world.caravan.y);
  const frac = (wagon.x - c.bounds.minX) / (c.bounds.maxX - c.bounds.minX);
  expect(frac).toBeGreaterThan(0.15);
  expect(frac).toBeLessThan(0.3);
  expect(c.bounds.maxX - c.bounds.minX).toBeCloseTo(SPAN * 8, 6);
  const roadAheadM = c.bounds.maxX - wagon.x;
  expect(roadAheadM).toBeGreaterThan(140);
  // 5 m/s: 28 s or more before the wagon reaches the edge.
  expect(roadAheadM / 5).toBeGreaterThan(28);

  const centred = world.buildConvoyHandoff();
  const cc = centred?.convoy;
  if (!cc) throw new Error('no handoff');
  const w2 = tileToLocal(cc.frame, world.caravan.x, world.caravan.y);
  expect((w2.x - cc.bounds.minX) / (cc.bounds.maxX - cc.bounds.minX)).toBeCloseTo(0.5, 1);

  // Halted at camp: no lean.
  world.caravan = { ...world.caravan, halted: true };
  expect(world.convoyAhead()).toBeNull();
  // Arrived: nothing ahead.
  world.caravan = { ...world.caravan, halted: false, along: world.caravan.length };
  expect(world.convoyAhead()).toBeNull();
  // No route.
  world.caravan = createCaravan(70, 100.5);
  expect(world.convoyAhead()).toBeNull();
});

test('north- and south-bound routes lean the same way', () => {
  const world = new WorldState();
  world.data = plains(4411);
  world.seed = 4411;
  for (const [dir, to] of [
    ['north', 20],
    ['south', 180],
  ] as const) {
    world.caravan = routed({ x: 100.5, y: 100 }, { x: 100.5, y: to }, 20);
    const handoff = world.buildConvoyHandoff(undefined, undefined, true, world.convoyAhead());
    const c = handoff?.convoy;
    if (!c) throw new Error('no handoff');
    const wagon = tileToLocal(c.frame, world.caravan.x, world.caravan.y);
    const frac = (wagon.z - c.bounds.minZ) / (c.bounds.maxZ - c.bounds.minZ);
    if (dir === 'north') expect(frac).toBeGreaterThan(0.7);
    else expect(frac).toBeLessThan(0.3);
    const fx = (wagon.x - c.bounds.minX) / (c.bounds.maxX - c.bounds.minX);
    expect(fx).toBeGreaterThan(0.4);
    expect(fx).toBeLessThan(0.6);
  }
});
