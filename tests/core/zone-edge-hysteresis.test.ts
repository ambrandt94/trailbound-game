import { expect, test, vi } from 'vitest';
import {
  EDGE_EXIT_HOLD_SEC,
  EDGE_EXIT_MARGIN,
  EDGE_EXIT_MARGIN_OFF,
  EDGE_HOLD_DRAIN,
  EDGE_WARN_MIN_SEC,
  EDGE_WARN_OFF_M,
  EDGE_WARN_ON_M,
  edgeOutward,
  holdVelocityAtEdge,
  freshEdgeLeave,
  nearestOutside,
  stepEdgeLeave,
  type EdgeLeaveState,
} from '../../src/core/area/edge-leave';
import { CONVOY_EDGE_HOLD_M } from '../../src/core/sim/convoy';

vi.setConfig({ testTimeout: 60_000 });

const DT = 1 / 60;

/** Feed `dist(i)` / `outward(i)` per frame; collect the warn and fade transitions. */
function run(
  frames: number,
  dist: (i: number) => number,
  outward: (i: number) => number,
  from: EdgeLeaveState = freshEdgeLeave(),
) {
  let state = from;
  let warnFlips = 0;
  let prev = from.warn;
  let fades = 0;
  const warn: boolean[] = [];
  for (let i = 0; i < frames; i++) {
    const step = stepEdgeLeave(state, dist(i), outward(i), DT);
    state = step.state;
    if (step.warn !== prev) warnFlips += 1;
    prev = step.warn;
    if (step.startFade) fades += 1;
    warn.push(step.warn);
  }
  return { state, warnFlips, fades, warn };
}

test('the leaving warning has a lip: wobbling across 7.5 m does not flip it', () => {
  expect(EDGE_WARN_OFF_M).toBeGreaterThan(EDGE_WARN_ON_M);
  // 6 s hovering between 7.0 and 8.0 m, crossing the on line every few frames.
  const wobble = (i: number) => 7.5 + 0.5 * Math.sin(i * 0.9);
  const hover = run(360, wobble, () => 0);
  expect(hover.warnFlips).toBe(1);
  expect(hover.warn.at(-1)).toBe(true);
  // Only walking in past the off line clears it.
  const inward = run(
    120,
    () => EDGE_WARN_OFF_M + 0.2,
    () => -1,
    hover.state,
  );
  expect(inward.warn.at(-1)).toBe(false);
  expect(inward.warnFlips).toBe(1);
  // And nothing shows from outside the on line.
  expect(
    run(
      120,
      () => EDGE_WARN_ON_M + 0.1,
      () => 0,
    ).warnFlips,
  ).toBe(0);
});

test('once shown, the warning stays at least a short dwell', () => {
  const shown = run(
    1,
    () => 6,
    () => 0,
  );
  expect(shown.warn[0]).toBe(true);
  // Straight out to 12 m next frame: still on until the dwell is up.
  const frames = Math.ceil(EDGE_WARN_MIN_SEC / DT);
  const away = run(
    frames + 5,
    () => 12,
    () => 0,
    shown.state,
  );
  const off = away.warn.indexOf(false);
  expect(off).toBeGreaterThanOrEqual(frames - 2);
  expect(away.warnFlips).toBe(1);
});

test('near the edge has a lip: sitting on 4 m does not reset the exit timer', () => {
  expect(EDGE_EXIT_MARGIN_OFF).toBeGreaterThan(EDGE_EXIT_MARGIN);
  // Pushing out while the distance wobbles 3.7-4.3 m: inside the lip, so it keeps counting.
  const wobble = (i: number) => 4 + 0.3 * Math.sin(i * 1.3);
  const first = run(
    2,
    () => 3.9,
    () => 2,
  );
  const push = run(Math.ceil(EDGE_EXIT_HOLD_SEC / DT) + 3, wobble, () => 2, first.state);
  expect(push.fades).toBe(1);
});

test('a stumble in the push drains the exit timer, only a real turn-back clears it', () => {
  const half = Math.floor((EDGE_EXIT_HOLD_SEC / DT) * 0.6);
  const pushed = run(
    half,
    () => 2,
    () => 2,
  );
  expect(pushed.state.hold).toBeGreaterThan(0);
  // One slack frame (outward 0.1, e.g. a flipped normal): the timer drains, it does not vanish.
  const slack = stepEdgeLeave(pushed.state, 2, 0.1, DT);
  expect(slack.state.hold).toBeGreaterThan(0);
  expect(slack.state.hold).toBeCloseTo(pushed.state.hold - DT * EDGE_HOLD_DRAIN, 9);
  // Resuming the push after that one frame still leaves, once.
  const resumed = run(
    Math.ceil(EDGE_EXIT_HOLD_SEC / DT),
    () => 2,
    () => 2,
    slack.state,
  );
  expect(resumed.fades).toBe(1);
  // A turn back resets at once.
  const turned = stepEdgeLeave(pushed.state, 2, -1, DT);
  expect(turned.state.hold).toBe(0);
  // Long slack never leaves.
  const idle = run(
    600,
    () => 2,
    () => 0.1,
    pushed.state,
  );
  expect(idle.fades).toBe(0);
  expect(idle.state.hold).toBe(0);
});

test('a stable exit: the warning turns on once on the approach and the fade fires once', () => {
  // Walk out at 2 m/s from 20 m inside to the wall.
  const dist = (i: number) => 20 - 2 * i * DT;
  const out = run(60 * 11, dist, () => 2);
  expect(out.fades).toBe(1);
  // On once, and off once when the fade takes over: two flips, no chatter.
  expect(out.warnFlips).toBe(2);
});

test('the convoy auto-walk parks the hero outside the leaving band', () => {
  expect(CONVOY_EDGE_HOLD_M).toBeGreaterThan(EDGE_WARN_OFF_M);
  expect(CONVOY_EDGE_HOLD_M).toBeGreaterThan(EDGE_EXIT_MARGIN_OFF);
  // A hero held at the line shows no warning and never counts toward an exit.
  const parked = run(
    600,
    () => CONVOY_EDGE_HOLD_M,
    () => 0.3,
  );
  expect(parked.warnFlips).toBe(0);
  expect(parked.fades).toBe(0);
});

function rect(w: number, h: number, pad: number): Uint8Array {
  const mask = new Uint8Array(w * h);
  for (let z = pad; z < h - pad; z++) for (let x = pad; x < w - pad; x++) mask[z * w + x] = 1;
  return mask;
}

test('the edge distance field is the true distance, and its normal does not flip', () => {
  const w = 120;
  const h = 120;
  const mask = rect(w, h, 10);
  // Walk east at many z offsets and sub-cell phases toward the x = 110 edge.
  for (const z of [47.7, 60.3, 31.5, 70.01, 89.99]) {
    let lastD = Number.NaN;
    for (let x = 95; x < 109.9; x += 0.05) {
      const hit = nearestOutside(mask, w, h, 1, x, z, 16);
      const north = z - 10;
      const south = 110 - z;
      const east = 110 - x;
      const truth = Math.min(east, north, south, x - 10);
      expect(hit).not.toBeNull();
      expect(hit!.d).toBeCloseTo(truth, 6);
      // The normal points at the nearest edge: east here, never a flipped direction.
      if (east <= Math.min(north, south) - 0.01) {
        expect(hit!.dx).toBeGreaterThan(0);
        expect(Math.abs(hit!.dz)).toBeLessThan(1e-9);
      }
      // Continuous: no jumps bigger than the step walked.
      if (Number.isFinite(lastD)) expect(Math.abs(hit!.d - lastD)).toBeLessThan(0.06);
      lastD = hit!.d;
    }
  }
  // Out of range: nothing found, not a bogus direction.
  expect(nearestOutside(mask, w, h, 1, 60, 60, 16)).toBeNull();
});

test('the grid edge counts as outside, and fractional cell sizes work', () => {
  const full = new Uint8Array(40 * 40).fill(1);
  const hit = nearestOutside(full, 40, 40, 0.5, 18.5, 10, 16);
  expect(hit!.d).toBeCloseTo(1.5, 9);
  expect(hit!.dx).toBeCloseTo(1.5, 9);
});

test('the auto-walk never counts as walking out, even pressed on a wall', () => {
  // Pushing east into an east wall at 3 m/s.
  expect(edgeOutward(3, 0, 1, 0, false)).toBe(3);
  expect(edgeOutward(3, 0, 1, 0, true)).toBe(0);
  expect(edgeOutward(undefined, undefined, 1, 0, false)).toBe(0);
  // So its exit timer never runs, however long it presses.
  const pressed = run(
    600,
    () => 1.5,
    () => edgeOutward(3, 0, 1, 0, true),
  );
  expect(pressed.fades).toBe(0);
  // The same push by hand leaves, once.
  expect(
    run(
      600,
      () => 1.5,
      () => edgeOutward(3, 0, 1, 0, false),
    ).fades,
  ).toBe(1);
});

test('the auto-walk holds short of the playable edge and slides along it', () => {
  const east = { dist: 6, ox: 1, oz: 0 };
  // Wants to go east and north at once: east is dropped, north stays.
  expect(holdVelocityAtEdge(2, -1.5, east, CONVOY_EDGE_HOLD_M)).toEqual({ vx: 0, vz: -1.5 });
  // Walking away from the edge is free.
  expect(holdVelocityAtEdge(-2, 0.5, east, CONVOY_EDGE_HOLD_M)).toEqual({ vx: -2, vz: 0.5 });
  // Farther in than the hold line, or no edge info: untouched.
  expect(
    holdVelocityAtEdge(2, 0, { ...east, dist: CONVOY_EDGE_HOLD_M + 0.1 }, CONVOY_EDGE_HOLD_M),
  ).toEqual({ vx: 2, vz: 0 });
  expect(holdVelocityAtEdge(2, 0, null, CONVOY_EDGE_HOLD_M)).toEqual({ vx: 2, vz: 0 });
  expect(holdVelocityAtEdge(2, 0, { dist: Number.NaN, ox: 1, oz: 0 }, CONVOY_EDGE_HOLD_M)).toEqual({
    vx: 2,
    vz: 0,
  });
  // A slanted edge: only the part along the normal goes.
  const s = Math.SQRT1_2;
  const slant = holdVelocityAtEdge(2, 0, { dist: 3, ox: s, oz: s }, CONVOY_EDGE_HOLD_M);
  expect(slant.vx * s + slant.vz * s).toBeCloseTo(0, 9);
  expect(slant.vx).toBeCloseTo(1, 9);
  expect(slant.vz).toBeCloseTo(-1, 9);
});
