import { expect, test } from 'vitest';
import {
  MAP_DIVE_DECAY_SEC,
  MAP_DIVE_HOLD_SEC,
  MAP_DIVE_NOTCH,
  diveCueAmount,
  emptyDiveIntent,
  stepDiveIntent,
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
  notches: number,
  atCap: boolean,
  canEnter: boolean,
): { state: DiveIntentState; dive: boolean } {
  let current = state;
  let dive = false;
  for (let i = 0; i < frames; i++) {
    const next = stepDiveIntent(current, FRAME, notches, atCap, canEnter);
    current = next.state;
    if (next.dive) dive = true;
  }
  return { state: current, dive };
}

test('one zoom notch does not dive, and the fill holds for about a second', () => {
  const once = stepDiveIntent(emptyDiveIntent(), FRAME, 1, true, true);
  expect(once.dive).toBe(false);
  expect(once.state.intent).toBeCloseTo(MAP_DIVE_NOTCH, 5);
  expect(once.state.intent).toBeLessThan(1);
  const held = run(once.state, Math.floor(0.9 / FRAME), 0, true, true);
  expect(held.dive).toBe(false);
  expect(held.state.intent).toBeCloseTo(MAP_DIVE_NOTCH, 2);
  const faded = run(
    once.state,
    Math.ceil((MAP_DIVE_HOLD_SEC + MAP_DIVE_DECAY_SEC) / FRAME),
    0,
    true,
    true,
  );
  expect(faded.dive).toBe(false);
  expect(faded.state.intent).toBeLessThan(0.05);
});

test('two notches, or one pinch that reports two steps, dives', () => {
  const paired = stepDiveIntent(emptyDiveIntent(), FRAME, 2, true, true);
  expect(paired.dive).toBe(true);
  const first = stepDiveIntent(emptyDiveIntent(), FRAME, 1, true, true);
  const second = stepDiveIntent(first.state, FRAME, 1, true, true);
  expect(second.dive).toBe(true);
});

test('deep water and zoom below the cap never dive', () => {
  const water = stepDiveIntent(emptyDiveIntent(), FRAME, 4, true, false);
  expect(water.dive).toBe(false);
  expect(water.state.intent).toBe(0);
  const below = stepDiveIntent(emptyDiveIntent(), FRAME, 4, false, true);
  expect(below.dive).toBe(false);
  expect(below.state.intent).toBe(0);
});

test('the cue darkens near the cap on land and stays clear on water', () => {
  expect(diveCueAmount(1, 0, true)).toBe(0);
  expect(diveCueAmount(MAP_ZOOM_CAP, 0, true)).toBeCloseTo(0.4, 5);
  expect(diveCueAmount(MAP_ZOOM_CAP, 0.8, true)).toBeCloseTo(0.8, 5);
  expect(diveCueAmount(MAP_ZOOM_CAP, 1, false)).toBe(0);
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
