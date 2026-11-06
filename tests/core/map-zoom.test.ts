import { expect, test } from 'vitest';
import {
  MAP_DIVE_HOLD_SEC,
  MAP_ZOOM_PULSE_SEC,
  diveCueAmount,
  emptyDiveIntent,
  stepDiveIntent,
  zoomEasesToHero,
  type DiveIntentState,
} from '../../src/core/world/map-zoom';
import {
  MAP_WALK_SCREEN_PX,
  MAP_ZOOM_CAP,
  TILE,
  formatMapClockRate,
  mapClockScale,
  playerWalkSpeed,
} from '../../src/core/world/models';

const FRAME = 1 / 60;

function run(
  state: DiveIntentState,
  frames: number,
  zoomingIn: boolean,
  atCap: boolean,
  canEnter: boolean,
): { state: DiveIntentState; dive: boolean } {
  let current = state;
  let dive = false;
  for (let i = 0; i < frames; i++) {
    const next = stepDiveIntent(current, FRAME, zoomingIn, atCap, canEnter);
    current = next.state;
    if (next.dive) dive = true;
  }
  return { state: current, dive };
}

test('one zoom tick at the cap does not dive', () => {
  const armed = stepDiveIntent(emptyDiveIntent(), FRAME, true, true, true);
  expect(armed.dive).toBe(false);
  const settled = run(armed.state, Math.ceil(1 / FRAME), false, true, true);
  expect(settled.dive).toBe(false);
  expect(settled.state.intent).toBe(0);
  expect(armed.state.intent).toBeLessThan(0.5);
  expect(armed.state.intent).toBeGreaterThan(0);
});

test('continued zoom-in at the cap dives, and a shorter hold does not', () => {
  const early = run(
    emptyDiveIntent(),
    Math.floor((MAP_DIVE_HOLD_SEC * 0.7) / FRAME),
    true,
    true,
    true,
  );
  expect(early.dive).toBe(false);
  expect(early.state.intent).toBeGreaterThan(0.5);
  const held = run(
    emptyDiveIntent(),
    Math.ceil((MAP_DIVE_HOLD_SEC + 0.08) / FRAME),
    true,
    true,
    true,
  );
  expect(held.dive).toBe(true);
  expect(MAP_ZOOM_PULSE_SEC).toBeLessThan(MAP_DIVE_HOLD_SEC);
});

test('deep water and zoom below the cap never dive', () => {
  const water = run(emptyDiveIntent(), 90, true, true, false);
  expect(water.dive).toBe(false);
  expect(water.state.intent).toBe(0);
  const below = run(emptyDiveIntent(), 90, true, false, true);
  expect(below.dive).toBe(false);
  expect(below.state.intent).toBe(0);
});

test('letting go of zoom fades the cue', () => {
  const halfway = run(
    emptyDiveIntent(),
    Math.floor((MAP_DIVE_HOLD_SEC * 0.5) / FRAME),
    true,
    true,
    true,
  );
  expect(halfway.state.intent).toBeGreaterThan(0.3);
  const released = run(halfway.state, Math.ceil(0.8 / FRAME), false, true, true);
  expect(released.dive).toBe(false);
  expect(released.state.intent).toBe(0);
});

test('the cue darkens near the cap on land and stays clear on water', () => {
  expect(diveCueAmount(1, 0, true)).toBe(0);
  expect(diveCueAmount(MAP_ZOOM_CAP, 0, true)).toBeCloseTo(0.4, 5);
  expect(diveCueAmount(MAP_ZOOM_CAP, 0.8, true)).toBeCloseTo(0.8, 5);
  expect(diveCueAmount(MAP_ZOOM_CAP, 1, false)).toBe(0);
  expect(zoomEasesToHero(MAP_ZOOM_CAP, 1.12)).toBe(true);
  expect(zoomEasesToHero(MAP_ZOOM_CAP * 0.5, 1.12)).toBe(false);
  expect(zoomEasesToHero(MAP_ZOOM_CAP, 0.9)).toBe(false);
});

test('at the zoom cap the clock is slow enough to stop and not the old street extreme', () => {
  const tiles = playerWalkSpeed(MAP_ZOOM_CAP, false);
  expect(tiles).toBeGreaterThan(1);
  expect(tiles).toBeLessThan(4);
  expect(tiles * MAP_ZOOM_CAP * TILE).toBeCloseTo(MAP_WALK_SCREEN_PX, 4);
  expect(mapClockScale(MAP_ZOOM_CAP)).toBeGreaterThan(0.02);
  expect(mapClockScale(MAP_ZOOM_CAP)).toBeGreaterThan(mapClockScale(10));
  expect(formatMapClockRate(MAP_ZOOM_CAP)).toBe('×0.03');
  expect(formatMapClockRate(0.02)).toBe('');
});
