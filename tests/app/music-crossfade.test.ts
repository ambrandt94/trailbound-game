import { describe, expect, test } from 'vitest';
import { fadeCurve, fadeDone, fadeGain } from '../../src/audio/crossfade';

describe('equal-power crossfade', () => {
  const out = { start: 10, dur: 2.5, from: 1, to: 0 };
  const into = { start: 10, dur: 2.5, from: 0, to: 1 };

  test('the pair keeps constant power the whole way', () => {
    for (let t = 10; t <= 12.5; t += 0.125) {
      const a = fadeGain(out, t);
      const b = fadeGain(into, t);
      expect(a * a + b * b).toBeCloseTo(1, 10);
    }
  });

  test('endpoints and midpoint', () => {
    expect(fadeGain(into, 10)).toBe(0);
    expect(fadeGain(into, 12.5)).toBe(1);
    expect(fadeGain(out, 10)).toBe(1);
    expect(fadeGain(out, 12.5)).toBeCloseTo(0, 12);
    expect(fadeGain(into, 11.25)).toBeCloseTo(Math.SQRT1_2, 10);
    expect(fadeGain(into, 5)).toBe(0);
    expect(fadeGain(into, 99)).toBe(1);
  });

  test('a zero-length fade jumps; done only after the duration', () => {
    expect(fadeGain({ start: 0, dur: 0, from: 0.4, to: 1 }, 0)).toBe(1);
    expect(fadeDone(into, 12.4)).toBe(false);
    expect(fadeDone(into, 12.5)).toBe(true);
  });

  test('a fade re-aimed mid-way starts from where the gain was', () => {
    const half = fadeGain(into, 11.25);
    const redirect = { start: 11.25, dur: 2, from: half, to: 0 };
    expect(fadeGain(redirect, 11.25)).toBeCloseTo(half, 12);
    expect(fadeGain(redirect, 13.25)).toBeCloseTo(0, 12);
  });

  test('the sampled curve runs from the start gain to the end gain', () => {
    const curve = fadeCurve(into);
    expect(curve[0]).toBe(0);
    expect(curve[curve.length - 1]).toBeCloseTo(1, 6);
    for (let i = 1; i < curve.length; i++) {
      expect(curve[i] ?? 0).toBeGreaterThanOrEqual(curve[i - 1] ?? 0);
    }
  });
});
