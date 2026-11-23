import { describe, expect, it } from 'vitest';
import {
  FadeTween,
  ViewTween,
  bearingOf,
  chunkFrameRadius,
  chunkFrameView,
  chunkSpan,
  easeInOutCubic,
  frameStats,
  lerpView,
} from '../../src/render/worldgen/transition';
import { MapCamera } from '../../src/render/map/map-camera';

const v = (lon0: number, radiusPx: number, lat0 = 0, morph = 0) => ({
  lon0,
  lat0,
  radiusPx,
  morph,
});

describe('WG4 view transitions', () => {
  it('lerps longitude the short way round across the date line', () => {
    const a = v(Math.PI - 0.1, 100);
    const b = v(-Math.PI + 0.1, 100);
    const mid = lerpView(a, b, 0.5);
    expect(Math.abs(Math.abs(mid.lon0) - Math.PI)).toBeLessThan(1e-9);
    const q = lerpView(a, b, 0.25);
    expect(Math.abs(q.lon0)).toBeGreaterThan(Math.PI - 0.1);
  });

  it('zooms evenly in log space and moves morph and tilt straight', () => {
    const mid = lerpView(v(0, 100, 0, 0), v(0, 10000, 0.4, 1), 0.5);
    expect(mid.radiusPx).toBeCloseTo(1000, 6);
    expect(mid.morph).toBeCloseTo(0.5, 9);
    expect(mid.lat0).toBeCloseTo(0.2, 9);
    expect(lerpView(v(0, 1), v(1, 2), 2).radiusPx).toBeCloseTo(2, 9);
  });

  it('tweens ease from start to end and report done', () => {
    const t = new ViewTween(v(0, 100), v(1, 400), 1000, 500);
    expect(t.at(900)).toEqual(lerpView(v(0, 100), v(1, 400), 0));
    expect(t.at(1500).radiusPx).toBeCloseTo(400, 9);
    expect(t.at(1250).lon0).toBeCloseTo(0.5, 9);
    expect(t.done(1499)).toBe(false);
    expect(t.done(1500)).toBe(true);
    const f = new FadeTween(1, 0, 0, 200);
    expect(f.at(0)).toBe(1);
    expect(f.at(100)).toBeLessThan(0.5);
    expect(f.at(300)).toBe(0);
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(1)).toBe(1);
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5, 9);
  });

  it('frames a chunk so its span fills the short side', () => {
    const n = 20;
    const r = chunkFrameRadius(n, 1200, 700, 0.9);
    expect(r * chunkSpan(n)).toBeCloseTo(630, 6);
    const view = chunkFrameView(n, { lat: 0.3, lon: -1 }, 1, 1200, 700);
    expect(view).toMatchObject({ lat0: 0.3, lon0: -1, morph: 1 });
    expect(view.radiusPx).toBeGreaterThan(r);
  });

  it('turns a screen direction into a clockwise bearing', () => {
    expect(bearingOf(0, -1)).toBe(0);
    expect(bearingOf(1, 0)).toBeCloseTo(Math.PI / 2, 9);
    expect(bearingOf(-1, 0)).toBeCloseTo(-Math.PI / 2, 9);
    expect(bearingOf(0, 0)).toBe(0);
  });

  it('summarises frame intervals', () => {
    const iv = Array.from({ length: 100 }, (_, i) => (i < 95 ? 16 : 40));
    const s = frameStats(iv);
    expect(s.frames).toBe(100);
    expect(s.p95Ms).toBe(16);
    expect(s.maxMs).toBe(40);
    expect(s.avgMs).toBeCloseTo(17.2, 9);
    expect(frameStats([])).toEqual({ frames: 0, avgMs: 0, p95Ms: 0, maxMs: 0 });
  });
});

describe('the map camera glide (HUD view toggle)', () => {
  it('glides to a scale in log space and stops there', () => {
    const camera = new MapCamera();
    camera.frame(3072, 3072, 1600, 800);
    camera.follow = false;
    camera.scale = 2;
    camera.targetScale = 2;
    const to = camera.minScale() * 1.5;
    camera.glideScale(to, 1);
    expect(camera.gliding()).toBe(true);
    const seen: number[] = [];
    for (let i = 0; i < 70 && camera.gliding(); i++) {
      camera.update(1 / 60, camera.x, camera.y);
      seen.push(camera.scale);
    }
    expect(camera.gliding()).toBe(false);
    expect(camera.scale).toBeCloseTo(to, 6);
    for (let i = 1; i < seen.length; i++) expect(seen[i]!).toBeLessThanOrEqual(seen[i - 1]! + 1e-9);
    // Eased: the middle of the glide moves faster than its first frame.
    const first = Math.log(2) - Math.log(seen[0]!);
    const mid = Math.log(seen[29]!) - Math.log(seen[30]!);
    expect(mid).toBeGreaterThan(first);
  });

  it('a user zoom cancels the glide', () => {
    const camera = new MapCamera();
    camera.frame(3072, 3072, 1600, 800);
    camera.glideScale(camera.minScale(), 1);
    camera.zoomAt(800, 400, 1.2, 1600, 800);
    expect(camera.gliding()).toBe(false);
  });
});
