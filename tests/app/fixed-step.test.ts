import { describe, expect, test } from 'vitest';
import { FixedStep, FrameClock, type Clock } from '../../src/app/fixed-step';

describe('fixed step', () => {
  test('runs whole steps and reports the leftover alpha', () => {
    const step = 0.1;
    const loop = new FixedStep(step);
    const seen: number[] = [];
    const alpha = loop.advance(0.25, (dt) => seen.push(dt));
    expect(seen).toEqual([0.1, 0.1]);
    expect(alpha).toBeCloseTo(0.5, 5);
  });

  test('uses a 120 Hz step when asked', () => {
    const step = 1 / 120;
    const loop = new FixedStep(step);
    let steps = 0;
    const alpha = loop.advance(step * 2.5, () => {
      steps += 1;
    });
    expect(steps).toBe(2);
    expect(alpha).toBeCloseTo(0.5, 5);
  });

  test('a long hitch runs at most the step cap', () => {
    const loop = new FixedStep(1 / 120, 8);
    let steps = 0;
    const alpha = loop.advance(10, () => {
      steps += 1;
    });
    expect(steps).toBe(8);
    expect(alpha).toBeGreaterThanOrEqual(0);
    expect(alpha).toBeLessThan(1);
  });

  test('keeps the remainder for the next frame', () => {
    const loop = new FixedStep(1, 8);
    loop.advance(2.5, () => undefined);
    const seen: number[] = [];
    const alpha = loop.advance(0.5, (dt) => seen.push(dt));
    expect(seen).toEqual([1]);
    expect(alpha).toBeCloseTo(0, 5);
  });
});

describe('injected clock', () => {
  test('consumes time from the clock rather than the frame callback', () => {
    let now = 1_000;
    const clock: Clock = { now: () => now };
    const loop = new FrameClock(clock, 120);
    const steps: number[] = [];
    let alpha = -1;

    loop.frame(
      () => steps.push(1),
      (value) => {
        alpha = value;
      },
    );
    expect(steps).toEqual([]);
    expect(alpha).toBe(1);

    now += (2.5 / 120) * 1000;
    loop.frame(
      (dt) => steps.push(dt),
      (value) => {
        alpha = value;
      },
    );
    expect(steps).toHaveLength(2);
    expect(steps[0]).toBeCloseTo(1 / 120, 8);
    expect(alpha).toBeCloseTo(0.5, 5);
  });
});
