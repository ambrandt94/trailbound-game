import { expect, test } from 'vitest';
import { START_HOUR } from '../../src/core/sim/clock';
import {
  DAY_START_HOUR,
  DEFAULT_SEASON,
  SEASONS,
  bakeNodes,
  clockLabelFor,
  isDaylight,
  litUnits,
  phaseAt,
  rgbToHex,
  serpentineNode,
  skyAt,
  thresholdsFor,
  tuRemainingAt,
  unitColor,
  type NodeLayout,
} from '../../src/core/sim/day-cycle';

const LAYOUT: NodeLayout = {
  count: 100,
  padX: 22,
  stepX: 3.2,
  centerY: 50,
  amplitude: 11,
  cycles: 2.5,
};

test('season presets give the blueprint thresholds', () => {
  expect(DEFAULT_SEASON).toBe('summer');
  expect(thresholdsFor('summer')).toMatchObject({ sunriseTU: 97, sunsetTU: 34, noonTU: 65 });
  expect(thresholdsFor('spring')).toMatchObject({ sunriseTU: 94, sunsetTU: 42 });
  expect(thresholdsFor('autumn')).toMatchObject({ sunriseTU: 93, sunsetTU: 43 });
  expect(thresholdsFor('winter')).toMatchObject({ sunriseTU: 90, sunsetTU: 50 });
  expect(thresholdsFor(SEASONS.winter)).toEqual(thresholdsFor('winter'));
});

test('daylight span matches the blueprint table', () => {
  const span = (id: 'summer' | 'spring' | 'autumn' | 'winter') => {
    const th = thresholdsFor(id);
    return (
      clockLabelFor(th.sunsetTU).hour24 * 60 +
      clockLabelFor(th.sunsetTU).minute -
      (clockLabelFor(th.sunriseTU).hour24 * 60 + clockLabelFor(th.sunriseTU).minute)
    );
  };
  expect(span('summer')).toBe(15 * 60 + 7);
  expect(span('spring')).toBe(12 * 60 + 29);
  expect(span('autumn')).toBe(12 * 60);
  expect(span('winter')).toBe(9 * 60 + 36);
});

test('midnight and noon sit mid-span, and the night wraps through dawn', () => {
  const th = thresholdsFor('summer');
  expect(th.nightLengthTU).toBe(37);
  expect(th.midnightTU).toBe(15);
  expect(isDaylight(65, th)).toBe(true);
  expect(isDaylight(97, th)).toBe(true);
  expect(isDaylight(98, th)).toBe(false);
  expect(isDaylight(33, th)).toBe(false);
});

test('clock face: 100 and 0 TU both read 05:00, 1 TU is 14.4 minutes', () => {
  expect(DAY_START_HOUR).toBe(5);
  expect(clockLabelFor(100).long).toBe('05:00 AM');
  expect(clockLabelFor(0).long).toBe('05:00 AM');
  expect(clockLabelFor(0).short).toBe('5:00A');
  expect(clockLabelFor(99).minute).toBe(14);
  expect(clockLabelFor(78).short).toBe('10:17A');
  expect(clockLabelFor(65).short).toBe('1:24P');
  expect(clockLabelFor(34).long).toBe('08:50 PM');
  expect(clockLabelFor(50).hour24).toBe(17);
});

test('the game clock counts from dawn, so remaining = 100 - tuOfDay', () => {
  expect(tuRemainingAt(0)).toBe(100);
  expect(tuRemainingAt(24)).toBe(100);
  expect(tuRemainingAt(12)).toBeCloseTo(50, 6);
  expect(tuRemainingAt(26)).toBeCloseTo(100 - (2 / 24) * 100, 6);
  expect(tuRemainingAt(START_HOUR)).toBeCloseTo(100 - (8 / 24) * 100, 6);
  for (const h of [0, 3.3, 8, 23.999, 24.5, 100]) {
    const r = tuRemainingAt(h);
    expect(r).toBeGreaterThan(0);
    expect(r).toBeLessThanOrEqual(100);
  }
});

test('lit beads: the unit being spent still counts', () => {
  expect(litUnits(100)).toBe(100);
  expect(litUnits(99.2)).toBe(100);
  expect(litUnits(99)).toBe(99);
  expect(litUnits(0.4)).toBe(1);
  expect(litUnits(0)).toBe(0);
  expect(litUnits(Number.NaN)).toBe(100);
});

test('serpentine nodes follow x = padX + i*stepX with a flattened 2.5-cycle wave', () => {
  const a = serpentineNode(0, LAYOUT);
  const b = serpentineNode(99, LAYOUT);
  expect(a.x).toBeCloseTo(22, 6);
  expect(a.y).toBeCloseTo(50, 6);
  expect(a.unit).toBe(1);
  expect(b.x).toBeCloseTo(22 + 99 * 3.2, 6);
  expect(b.unit).toBe(100);
  // sin(2.5 * 2pi) = sin(5pi) = 0: the wave ends where it starts.
  expect(b.y).toBeCloseTo(50, 6);
  const ys = bakeNodes(LAYOUT).map((n) => n.y);
  expect(Math.max(...ys)).toBeLessThanOrEqual(61 + 1e-9);
  expect(Math.min(...ys)).toBeGreaterThanOrEqual(39 - 1e-9);
  expect(serpentineNode(10, LAYOUT, 3).x).toBeCloseTo(serpentineNode(10, LAYOUT).x * 3, 6);
});

test('baked nodes are reused until layout or scale changes', () => {
  const first = bakeNodes(LAYOUT, 1);
  expect(bakeNodes({ ...LAYOUT }, 1)).toBe(first);
  const scaled = bakeNodes(LAYOUT, 2);
  expect(scaled).not.toBe(first);
  expect(scaled[5]?.x).toBeCloseTo((first[5]?.x ?? 0) * 2, 6);
});

test('bead colours run indigo, coral, gold, amber, orange, violet, blue', () => {
  const th = thresholdsFor('summer');
  expect(rgbToHex(unitColor(100, th))).toBe('#312e81');
  expect(rgbToHex(unitColor(97, th))).toBe('#fb923c');
  expect(rgbToHex(unitColor(65, th))).toBe('#fef08a');
  expect(rgbToHex(unitColor(80, th))).not.toBe(rgbToHex(unitColor(65, th)));
  expect(rgbToHex(unitColor(34, th))).toBe('#ea580c');
  expect(rgbToHex(unitColor(33, th))).not.toBe(rgbToHex(unitColor(34, th)));
  expect(rgbToHex(unitColor(1, th))).not.toBe('#000000');
});

test('phases follow the season thresholds', () => {
  const th = thresholdsFor('summer');
  expect(phaseAt(100, th)).toBe('preSunrise');
  expect(phaseAt(80, th)).toBe('morning');
  expect(phaseAt(50, th)).toBe('afternoon');
  expect(phaseAt(34, th)).toBe('sunset');
  expect(phaseAt(10, th)).toBe('night');
});

test('sun and moon glide continuously across the strip, right to left, and the sky never goes black', () => {
  const th = thresholdsFor('summer');
  const a = skyAt(90, th);
  const b = skyAt(89.5, th);
  expect(a.daylight).toBe(true);
  expect(b.bodyX).toBeLessThan(a.bodyX);
  expect(b.bodyX).toBeGreaterThan(a.bodyX - 0.02);
  const noon = skyAt(th.noonTU, th);
  expect(noon.bodyElev).toBeCloseTo(1, 1);
  const night = skyAt(th.midnightTU, th);
  expect(night.daylight).toBe(false);
  expect(night.bodyElev).toBeCloseTo(1, 1);
  expect(night.starAlpha).toBe(1);
  expect(rgbToHex(night.top)).not.toBe('#000000');
  expect(Math.max(...night.top)).toBeGreaterThan(24);
  // The loop is seamless: just before and just after the wrap look alike.
  const before = skyAt(0.01, th);
  const after = skyAt(100, th);
  expect(before.glowAlpha).toBeGreaterThan(0.2);
  expect(Math.abs(before.glowAlpha - after.glowAlpha)).toBeLessThan(0.01);
  expect(Math.abs(before.bodyX - after.bodyX)).toBeLessThan(0.01);
  expect(rgbToHex(before.top)).toBe(rgbToHex(after.top));
});
