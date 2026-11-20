import { expect, test } from 'vitest';
import {
  ZONE_HISTORY_MAX,
  ZONE_REENTRY_MARGIN_TILES,
  normalizeZones,
  rememberZone,
  zoneContaining,
  zoneDistance,
  zoneMargin,
  zoneOutlineAlpha,
  type ZoneRecord,
} from '../../src/core/area/zone-history';

const block = (x0: number, y0 = 0, name = 'Plains') => ({ x0, y0, x1: x0 + 24, y1: y0 + 24, name });

function fill(...starts: number[]): ZoneRecord[] {
  let h: ZoneRecord[] = [];
  starts.forEach((x, i) => {
    h = rememberZone(h, block(x), i);
  });
  return h;
}

test('the history keeps the last three zones, newest first', () => {
  expect(ZONE_HISTORY_MAX).toBe(3);
  const h = fill(0, 24, 48, 72);
  expect(h.map((z) => z.x0)).toEqual([72, 48, 24]);
  expect(h.map((z) => z.seq)).toEqual([4, 3, 2]);
  expect(h[0]!.hours).toBe(3);
});

test('re-entering a zone moves it to the front instead of adding a copy', () => {
  const h = rememberZone(fill(0, 24, 48), block(0), 9);
  expect(h.map((z) => z.x0)).toEqual([0, 48, 24]);
  expect(h[0]!.hours).toBe(9);
  expect(h[0]!.seq).toBe(4);
  expect(h).toHaveLength(3);
});

test('remembering does not change the list it was given', () => {
  const h = fill(0, 24);
  rememberZone(h, block(48), 5);
  expect(h.map((z) => z.x0)).toEqual([24, 0]);
});

test('a point is "in" a zone only well inside its edge', () => {
  const h = fill(0);
  expect(zoneMargin(h[0]!, 12, 12)).toBe(12);
  expect(zoneMargin(h[0]!, 30, 12)).toBeLessThan(0);
  expect(zoneContaining(h, 12, 12)?.x0).toBe(0);
  expect(zoneContaining(h, ZONE_REENTRY_MARGIN_TILES, 12)?.x0).toBe(0);
  expect(zoneContaining(h, ZONE_REENTRY_MARGIN_TILES - 0.5, 12)).toBeNull();
  expect(zoneContaining(h, 40, 12)).toBeNull();
  expect(zoneContaining([], 12, 12)).toBeNull();
});

test('where zones overlap the deeper one wins, and a tie goes to the newer', () => {
  // Cut east of the first: a point at x=20 is 4 deep in the second, 20 from the first's far edge.
  const h = rememberZone(rememberZone([], block(0), 0), block(16), 1);
  expect(zoneContaining(h, 20, 12)?.x0).toBe(16);
  expect(zoneContaining(h, 8, 12)?.x0).toBe(0);
  const tie = rememberZone(rememberZone([], block(0, 0), 0), block(0, 0), 1);
  expect(tie).toHaveLength(1);
  const a = rememberZone([], { x0: 0, y0: 0, x1: 20, y1: 20, name: 'a' }, 0);
  const b = rememberZone(a, { x0: 0, y0: 0, x1: 20, y1: 24, name: 'b' }, 1);
  expect(zoneContaining(b, 10, 10)?.name).toBe('b');
});

test('distance is zero inside, and wraps over the world seam', () => {
  const z = block(0);
  expect(zoneDistance(z, 10, 10)).toBe(0);
  expect(zoneDistance(z, 34, 10)).toBe(10);
  expect(zoneDistance(z, 36, 24 + 5)).toBeCloseTo(Math.hypot(12, 5));
  // A hero at x=395 of a 400-wide world is 5 tiles west of a zone at the east end.
  expect(zoneDistance(block(0), 395, 10, 400)).toBe(5);
  expect(zoneDistance(block(0), 395, 10)).toBe(371);
});

test('outline strength: newest strongest, older fainter, farther fainter, never zero', () => {
  const near = [0, 1, 2].map((r) => zoneOutlineAlpha(r, 0));
  expect(near[0]!).toBeGreaterThan(near[1]!);
  expect(near[1]!).toBeGreaterThan(near[2]!);
  expect(near[2]!).toBeGreaterThan(0.15);
  expect(near[0]!).toBeLessThan(1);
  let last = Infinity;
  for (const d of [0, 30, 60, 120, 200, 260, 900]) {
    const a = zoneOutlineAlpha(0, d);
    expect(a).toBeLessThanOrEqual(last);
    last = a;
  }
  expect(zoneOutlineAlpha(0, 900)).toBeGreaterThan(0.1);
  expect(zoneOutlineAlpha(0, 900)).toBeLessThan(near[0]! * 0.5);
  expect(zoneOutlineAlpha(0, 10)).toBe(near[0]);
  // Ranks past the list read as the faintest.
  expect(zoneOutlineAlpha(7, 0)).toBe(near[2]);
});

test('a saved history reads back; junk, repeats and off-world blocks are dropped', () => {
  const h = fill(0, 24, 48);
  expect(normalizeZones(JSON.parse(JSON.stringify(h)))).toEqual(h);
  expect(normalizeZones(undefined)).toEqual([]);
  expect(normalizeZones('zones')).toEqual([]);
  const junk = [
    null,
    { x0: 'a', y0: 0, x1: 24, y1: 24 },
    { x0: 10, y0: 0, x1: 10, y1: 24 },
    { ...h[0], seq: 7 },
    { ...h[0], seq: 2 },
    { x0: 500, y0: 0, x1: 524, y1: 24, name: 'off', seq: 9, hours: 1 },
  ];
  const kept = normalizeZones(junk, { width: 400, height: 400 });
  expect(kept).toHaveLength(1);
  expect(kept[0]!.seq).toBe(7);
  expect(
    normalizeZones(
      Array.from({ length: 6 }, (_, i) => ({ ...block(i * 30), seq: i + 1, hours: i })),
    ),
  ).toHaveLength(3);
});
