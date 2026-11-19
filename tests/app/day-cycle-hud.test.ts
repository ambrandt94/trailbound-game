import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { DEFAULT_SEASON, bakeNodes } from '../../src/core/sim/day-cycle';
import {
  HUD_NATIVE_H,
  HUD_NATIVE_W,
  NODE_LAYOUT,
  chooseHudScale,
} from '../../src/ui/day-cycle/layout';
import { REQUIRED_SPRITES, parseManifest } from '../../src/ui/day-cycle/manifest';

const dir = join(process.cwd(), 'public', 'assets', 'ui', 'hud-day-cycle');

function pngSize(file: string): { w: number; h: number } {
  const buf = readFileSync(join(dir, file));
  expect(buf.subarray(1, 4).toString('latin1')).toBe('PNG');
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

describe('day-cycle HUD art manifest', () => {
  const raw: unknown = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
  const manifest = parseManifest(raw);

  test('names every slot the renderer draws', () => {
    for (const id of REQUIRED_SPRITES) expect(manifest.sprites[id]).toBeDefined();
  });

  test('every PNG exists and is `w x states` by `h`, so a swapped file that disagrees fails here', () => {
    for (const [id, def] of Object.entries(manifest.sprites)) {
      const size = pngSize(def.file);
      expect(size, id).toEqual({ w: def.w * def.states.length, h: def.h });
      expect(def.anchor[0], id).toBeLessThan(def.w);
      expect(def.anchor[1], id).toBeLessThan(def.h);
      if (def.slice) {
        expect(def.slice[0] + def.slice[2], id).toBeLessThanOrEqual(def.w);
        expect(def.slice[1] + def.slice[3], id).toBeLessThanOrEqual(def.h);
      }
    }
  });

  test('the font sheet has one cell per glyph', () => {
    const size = pngSize(manifest.font.file);
    expect(size.w).toBe(manifest.font.glyphs.length * manifest.font.cellW);
    expect(size.h).toBe(manifest.font.cellH);
    for (const ch of '0123456789: APMTUDAY') expect(manifest.font.glyphs).toContain(ch);
  });

  test('beads stay 5 px so the chain overlaps into one ribbon', () => {
    expect(manifest.sprites.node_socket_empty).toMatchObject({ w: 5, h: 5 });
    expect(manifest.sprites.node_gem_lit).toMatchObject({ w: 5, h: 5, tint: true });
  });

  test('a manifest missing a slot is rejected with its name', () => {
    const broken = structuredClone(raw) as { sprites: Record<string, unknown> };
    delete broken.sprites.sky_frame;
    expect(() => parseManifest(broken)).toThrow(/sky_frame/);
    expect(() => parseManifest({})).toThrow();
  });
});

describe('day-cycle HUD layout', () => {
  test('the canvas fits the 100-bead wave plus both end-caps', () => {
    const nodes = bakeNodes(NODE_LAYOUT);
    expect(HUD_NATIVE_W).toBe(361);
    expect((nodes[99]?.x ?? 0) + 4 + 7).toBeLessThanOrEqual(HUD_NATIVE_W);
    expect((nodes[0]?.x ?? 0) - 4 - 7).toBeGreaterThanOrEqual(0);
    const ys = nodes.map((n) => n.y);
    expect(Math.max(...ys) + 3).toBeLessThanOrEqual(HUD_NATIVE_H);
  });

  test('scale is a whole number, grows with the screen, and stays modest', () => {
    expect(chooseHudScale(390, 844)).toBe(1);
    expect(chooseHudScale(1280, 720)).toBe(1);
    expect(chooseHudScale(1440, 900)).toBe(2);
    expect(chooseHudScale(1920, 1080)).toBe(2);
    expect(chooseHudScale(2560, 1440)).toBe(3);
    expect(chooseHudScale(3840, 2160)).toBe(4);
    expect(chooseHudScale(7680, 4320)).toBe(4);
  });

  test('scale is counted in device pixels, so retina screens keep the same CSS size', () => {
    const css = (w: number, h: number, dpr: number) =>
      (chooseHudScale(w, h, dpr) * HUD_NATIVE_W) / dpr;
    expect(Number.isInteger(chooseHudScale(1440, 900, 1.25))).toBe(true);
    expect(chooseHudScale(1440, 900, 2)).toBe(4);
    expect(css(1440, 900, 2)).toBe(css(1440, 900, 1));
    // Never taller than a fifth of the screen.
    for (const [w, h] of [
      [1440, 900],
      [2560, 1440],
      [1000, 500],
    ] as const) {
      expect((chooseHudScale(w, h) * HUD_NATIVE_H) / h).toBeLessThanOrEqual(0.2);
    }
  });

  test('defaults to the summer preset', () => {
    expect(DEFAULT_SEASON).toBe('summer');
  });
});
