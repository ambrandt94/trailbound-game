import { describe, expect, it } from 'vitest';
import { ChunkCache } from '../../src/render/worldgen/chunk-cache';
import { JobRunner } from '../../src/render/worldgen/job-runner';
import type { WorldGenReply } from '../../src/render/worldgen/jobs';
import {
  flatFitRadius,
  globeFitRadius,
  project,
  unproject,
  wrapAngle,
  type ViewState,
} from '../../src/render/worldgen/projection';
import type { ChunkRaster } from '../../src/core/planet';
import { clampSettings, DEFAULT_WORLD_SETTINGS } from '../../src/core/world/models';

describe('World Gen projection', () => {
  const pts = [
    { lat: 0.2, lon: 0.4 },
    { lat: -0.5, lon: -0.9 },
    { lat: 0.9, lon: 2.6 },
  ];
  it('picks back what it draws, on the globe and the flat map', () => {
    for (const morph of [0, 1]) {
      const view: ViewState = { lon0: 0.3, lat0: morph ? 0 : 0.4, radiusPx: 300, morph };
      for (const p of pts) {
        const s = project(view, p);
        if (!s) continue;
        const back = unproject(view, s.x, s.y)!;
        expect(back.lat).toBeCloseTo(p.lat, 6);
        expect(wrapAngle(back.lon - p.lon)).toBeCloseTo(0, 6);
      }
    }
  });

  it('keeps the view centre still between globe and flat', () => {
    for (const morph of [0, 0.5, 1]) {
      const s = project({ lon0: 1, lat0: 0.3, radiusPx: 200, morph }, { lat: 0.3, lon: 1 })!;
      expect(Math.abs(s.x)).toBeLessThan(1e-9);
      expect(Math.abs(s.y)).toBeLessThan(1e-9);
    }
  });

  it('hides the far side of the globe and misses off the planet', () => {
    const view: ViewState = { lon0: 0, lat0: 0, radiusPx: 100, morph: 0 };
    expect(project(view, { lat: 0, lon: Math.PI })).toBeNull();
    expect(unproject(view, 150, 0)).toBeNull();
    expect(globeFitRadius(1000, 600)).toBeLessThan(300);
    expect(flatFitRadius(1000, 600) * 2 * Math.PI).toBeLessThanOrEqual(1000);
  });
});

describe('inspected chunk cache', () => {
  const r = (size: number) => ({ size }) as ChunkRaster;
  it('keeps the few most recently used chunks only', () => {
    const cache = new ChunkCache(3);
    cache.set('a', r(1));
    cache.set('b', r(2));
    cache.set('c', r(3));
    expect(cache.get('a')?.size).toBe(1);
    cache.set('d', r(4));
    expect(cache.keys()).toEqual(['c', 'a', 'd']);
    expect(cache.get('b')).toBeUndefined();
    cache.clear();
    expect(cache.size).toBe(0);
  });
});

describe('World Gen jobs', () => {
  const settings = clampSettings({ ...DEFAULT_WORLD_SETTINGS, worldScale: 1, planet: 'tiny' });

  it('a new job replaces the running one; cancel drops its result', async () => {
    const replies: WorldGenReply[] = [];
    const runner = new JobRunner((r) => replies.push(r));
    const first = runner.start({ type: 'bake', seed: 3, settings, w: 32, h: 16, starts: false });
    const second = runner.start({ type: 'bake', seed: 3, settings, w: 32, h: 16, starts: true });
    await new Promise((res) => setTimeout(res, 50));
    expect(replies.map((r) => r.id)).toEqual([second]);
    expect(replies[0]!.type).toBe('bake');
    expect(first).not.toBe(second);
    runner.start({
      type: 'chunk',
      seed: 3,
      settings,
      addr: { face: 0, cx: 1, cy: 1 },
      raster: 64,
    });
    runner.cancel();
    await new Promise((res) => setTimeout(res, 50));
    expect(replies.length).toBe(1);
    runner.dispose();
  });

  it('generates a chunk map raster on demand', async () => {
    const reply = await new Promise<WorldGenReply>((resolve) => {
      const runner = new JobRunner((r) => {
        if (r.type !== 'progress') resolve(r);
      });
      runner.start({
        type: 'chunk',
        seed: 3,
        settings,
        addr: { face: 1, cx: 2, cy: 1 },
        raster: 64,
      });
    });
    expect(reply.type).toBe('chunk');
    if (reply.type !== 'chunk') return;
    expect(reply.raster.size).toBe(64);
    expect(reply.addr).toEqual({ face: 1, cx: 2, cy: 1 });
  }, 30000);
});
