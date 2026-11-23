import { describe, expect, test } from 'vitest';
import {
  bendForScale,
  bentRadius,
  chunkAngle,
  chunkKey,
  chunkToSphere,
  DEFAULT_REGIONS_TUNING,
  exploreBlock,
  fadeAmount,
  frameStep,
  nextStepAt,
  regionsFraming,
  glimpsed,
  journeyPath,
  knowledgeFromPath,
  knowledgeScale,
  knownExtent,
  makeRumor,
  maxVisibleAngle,
  randomWalk,
  regionsProject,
  regionsTarget,
  regionsUnproject,
  rumorClearing,
  rumorUncertainty,
  angleBetween,
  type ChunkAddr,
  type Knowledge,
} from '../../src/core/planet';

const N = 20;
const home: ChunkAddr = { face: 0, cx: 6, cy: 10 };
const know = (chunks: ChunkAddr[]): Knowledge =>
  new Map(chunks.map((a) => [chunkKey(a), { addr: a, lastVisit: 0 }]));

describe('regions knowledge', () => {
  test('blocks grow 1 → 2×2 → N×N', () => {
    expect(exploreBlock(N, home, 1)).toHaveLength(1);
    expect(exploreBlock(N, home, 2)).toHaveLength(4);
    expect(exploreBlock(N, home, 3)).toHaveLength(9);
    expect(exploreBlock(N, home, 5)).toHaveLength(25);
  });

  test('visited chunks are clear and their 8 neighbours glimpsed', () => {
    expect(glimpsed(N, know([home])).size).toBe(8);
    expect(glimpsed(N, know(exploreBlock(N, home, 3))).size).toBe(16);
  });

  test('span and k: one chunk is k=0, about 40 across is the globe', () => {
    const one = knownExtent(N, know([home]), chunkToSphere(N, home));
    expect(one.span).toBeCloseTo(1, 5);
    expect(knowledgeScale(one.span)).toBe(0);
    const five = knownExtent(N, know(exploreBlock(N, home, 5)), chunkToSphere(N, home));
    expect(five.span).toBeGreaterThan(5);
    expect(five.span).toBeLessThan(8.5);
    expect(knowledgeScale(40)).toBeCloseTo(1, 5);
    // Flat until about 8 across, curved past it, the globe at 40.
    expect(bendForScale(knowledgeScale(5))).toBe(0);
    expect(bendForScale(knowledgeScale(8))).toBeCloseTo(0, 5);
    expect(bendForScale(knowledgeScale(20))).toBeGreaterThan(0.2);
    expect(bendForScale(knowledgeScale(40))).toBe(1);
  });

  test('the view grows in earned steps', () => {
    const steps = [1, 3, 4, 6, 9, 12, 30, 60].map((v) => frameStep(v));
    expect(steps).toEqual([1, 1, 2, 2, 3, 3, 5, 7]);
    expect(nextStepAt(1)).toBe(4);
    expect(nextStepAt(6)).toBe(9);
    expect(nextStepAt(30)).toBe(36);
    const loose = { ...DEFAULT_REGIONS_TUNING, widenAfter: 2, stepFill: 0.5 };
    expect(frameStep(2, loose)).toBe(2);
    expect(frameStep(5, loose)).toBe(3);
  });

  test('framing stays on your chunk at first and never outruns the known area', () => {
    const at = chunkToSphere(N, home);
    const patch = (count: number) =>
      know(exploreBlock(N, home, Math.ceil(Math.sqrt(count)) + 2).slice(0, count));
    expect(regionsFraming(N, patch(3), at).span).toBe(1);
    expect(regionsFraming(N, patch(3), at).centre).toEqual(at);
    expect(regionsFraming(N, patch(6), at).span).toBe(2);
    expect(regionsFraming(N, patch(12), at).span).toBe(3);
    // A long line of 12 chunks: the view frames 3 across around where you are.
    const line = know(
      Array.from({ length: 12 }, (_, i) => ({ face: 0 as const, cx: 2 + i, cy: 10 })),
    );
    const end = chunkToSphere(N, { face: 0, cx: 13, cy: 10 });
    const f = regionsFraming(N, line, end);
    expect(f.knownSpan).toBeGreaterThan(10);
    expect(f.span).toBe(3);
    expect(angleBetween(f.centre, end)).toBeLessThanOrEqual(chunkAngle(N) + 1e-9);
  });

  test('haze can reach more than one ring', () => {
    expect(glimpsed(N, know([home]), 0).size).toBe(0);
    expect(glimpsed(N, know([home]), 2).size).toBe(24);
  });

  test('one known chunk fills most of the view; the globe fits at k=1', () => {
    const ext = knownExtent(N, know([home]), chunkToSphere(N, home));
    const t = regionsTarget(N, ext, 1000, 800);
    const chunkPx = t.R * chunkAngle(N);
    expect(chunkPx).toBeGreaterThan(500);
    expect(chunkPx).toBeLessThan(800);
    const g = regionsTarget(N, ext, 1000, 800, DEFAULT_REGIONS_TUNING, { k: 1, bend: null });
    expect(g.bend).toBe(1);
    expect(g.R).toBeCloseTo(400 * 0.94, 0);
  });

  test('the bent projection round-trips and folds at the limb', () => {
    expect(maxVisibleAngle(0)).toBe(Math.PI);
    expect(maxVisibleAngle(1)).toBeCloseTo(Math.PI / 2, 6);
    for (const bend of [0, 0.3, 0.7, 1]) {
      const frame = { centre: chunkToSphere(N, home), R: 300, bend };
      for (const a of exploreBlock(N, home, 5)) {
        const p = chunkToSphere(N, a, 0.2, 0.7);
        const s = regionsProject(frame, p);
        expect(s).not.toBeNull();
        const q = regionsUnproject(frame, s!.x, s!.y);
        expect(angleBetween(p, q!)).toBeLessThan(1e-6);
      }
    }
    expect(bentRadius(0.5, 0)).toBe(0.5);
    expect(bentRadius(0.5, 1)).toBeCloseTo(Math.sin(0.5), 9);
  });

  test('north is up and east is right at the centre', () => {
    const frame = { centre: chunkToSphere(N, home), R: 300, bend: 0 };
    const north = regionsProject(frame, chunkToSphere(N, { ...home, cy: home.cy - 1 }))!;
    const east = regionsProject(frame, chunkToSphere(N, { ...home, cx: home.cx + 1 }))!;
    expect(north.y).toBeLessThan(-15);
    expect(east.x).toBeGreaterThan(15);
    expect(Math.abs(north.x)).toBeLessThan(3);
  });

  test('fade starts at ~10 days, levels off at ~60', () => {
    expect(fadeAmount(0)).toBe(0);
    expect(fadeAmount(10)).toBe(0);
    expect(fadeAmount(35)).toBeGreaterThan(0.3);
    expect(fadeAmount(60)).toBe(1);
    expect(fadeAmount(400)).toBe(1);
  });

  test('journeys and walks are connected chunk paths', () => {
    const walk = randomWalk(N, home, 30, 7);
    expect(walk[0]).toEqual(home);
    expect(walk.length).toBeGreaterThan(20);
    for (let i = 1; i < walk.length; i++) {
      const d = angleBetween(chunkToSphere(N, walk[i - 1]!), chunkToSphere(N, walk[i]!));
      expect(d).toBeLessThan(chunkAngle(N) * 1.6);
    }
    const path = journeyPath(N, [chunkToSphere(N, home), chunkToSphere(N, { ...home, cx: 12 })]);
    expect(path[0]).toEqual(home);
    expect(path[path.length - 1]).toEqual({ ...home, cx: 12 });
    const k = knowledgeFromPath(path, 3, 5);
    expect(k.size).toBe(3);
    expect([...k.values()].map((c) => c.lastVisit)).toEqual([5, 6, 7]);
  });

  test('rumours: surer means a bigger clearing and a smaller ring; the truth stays in the ring', () => {
    expect(rumorClearing(N, 1)).toBeGreaterThan(rumorClearing(N, 0.2));
    expect(rumorUncertainty(N, 1)).toBeLessThan(rumorUncertainty(N, 0.2));
    const at = chunkToSphere(N, home);
    for (let id = 1; id < 12; id++) {
      const r = makeRumor(N, id, at, 0.4, id % 2 === 0, 99);
      expect(angleBetween(r.at, r.trueAt)).toBeLessThanOrEqual(rumorUncertainty(N, 0.4));
    }
    expect(makeRumor(N, 1, at, 0.5, true, 1).believed.id).toBe('pyramid');
    expect(makeRumor(N, 1, at, 0.5, true, 1).truth.id).toBe('jars');
  });
});
