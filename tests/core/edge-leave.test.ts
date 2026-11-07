import { expect, test } from 'vitest';
import {
  EDGE_EXIT_HOLD_SEC,
  EDGE_EXIT_MARGIN,
  WALK_CLAMP_MARGIN,
  clampClearance,
  edgeSide,
  freshEdgeLeave,
  stepEdgeLeave,
} from '../../src/core/area/edge-leave';
import { landAfterAreaExit, type PlaceFootprint } from '../../src/core/state/world-state';

const SPRINT = 3.2;

function push(dist: number, outward: number, seconds: number) {
  let state = freshEdgeLeave();
  let started = 0;
  const frames = Math.ceil(seconds / (1 / 60));
  for (let i = 0; i < frames; i++) {
    const step = stepEdgeLeave(state, dist, outward, 1 / 60);
    state = step.state;
    if (step.startFade) started += 1;
  }
  return { state, started };
}

test('the exit margin sits inside the walk clamp and a sprint commits before the wall', () => {
  expect(EDGE_EXIT_MARGIN).toBeGreaterThan(WALK_CLAMP_MARGIN);
  const sprint = 5.5 * 1.6;
  expect(sprint * EDGE_EXIT_HOLD_SEC).toBeLessThan(EDGE_EXIT_MARGIN - WALK_CLAMP_MARGIN);
  const room = clampClearance(1, 10, 0, 0, 40, 40);
  expect(room).toBeCloseTo(1 - WALK_CLAMP_MARGIN, 5);
  expect(room).toBeLessThan(EDGE_EXIT_MARGIN);
});

test('each edge and a corner leave exactly once, including at a sprint', () => {
  for (const dist of [0.4, 0, -0.2]) {
    const run = push(dist, SPRINT, EDGE_EXIT_HOLD_SEC + 0.2);
    expect(run.started).toBe(1);
    expect(run.state.fired).toBe(true);
    const again = stepEdgeLeave(run.state, dist, SPRINT, 1);
    expect(again.startFade).toBe(false);
  }
  const corner = push(0.3, SPRINT, EDGE_EXIT_HOLD_SEC + 0.1);
  expect(corner.started).toBe(1);
});

test('turning around before the hold cancels, and one frame does not leave', () => {
  const early = push(0.4, SPRINT, EDGE_EXIT_HOLD_SEC * 0.4);
  expect(early.started).toBe(0);
  const turned = stepEdgeLeave(early.state, 0.4, -1, 1 / 60);
  expect(turned.state.hold).toBe(0);
  expect(turned.startFade).toBe(false);
  const outside = push(EDGE_EXIT_MARGIN + 0.2, SPRINT, 3);
  expect(outside.started).toBe(0);
});

test('a corner normal still names one side', () => {
  expect(edgeSide(1, 0)).toBe('E');
  expect(edgeSide(-1, 0)).toBe('W');
  expect(edgeSide(0, 1)).toBe('S');
  expect(edgeSide(0, -1)).toBe('N');
  expect(edgeSide(0.8, 0.8)).toBe('S');
  expect(edgeSide(-0.2, 0.9)).toBe('S');
  expect(edgeSide(0.9, -0.2)).toBe('E');
});

test('an edge exit still lands on the map tile outside that edge', () => {
  const foot: PlaceFootprint = { minX: 12, minY: 12, maxX: 23, maxY: 23 };
  const east = landAfterAreaExit(
    { side: 'east', pos: 0.5, yaw: 0.2 },
    foot,
    { x: 18, y: 16, yaw: 0 },
    { x: 8, y: 8 },
    { width: 48, height: 48 },
  );
  expect(Math.floor(east.x)).toBe(foot.maxX + 1);
  expect(Number.isFinite(east.x)).toBe(true);
  expect(Number.isFinite(east.y)).toBe(true);
  const broken = landAfterAreaExit(
    { side: 'north', pos: Number.NaN, yaw: Number.NaN },
    foot,
    { x: 18.2, y: 16.4, yaw: 0.1 },
    { x: 8, y: 8 },
    { width: 48, height: 48 },
  );
  expect(Number.isFinite(broken.x)).toBe(true);
  expect(Number.isFinite(broken.y)).toBe(true);
  expect(Math.floor(broken.y)).toBe(foot.minY - 1);
});
