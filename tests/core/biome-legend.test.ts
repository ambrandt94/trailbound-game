import { describe, expect, it } from 'vitest';
import {
  bakeWorld,
  biomeLegend,
  biomeLegendRgb,
  biomeWashRgba,
  chunkRaster,
  makePlanetField,
} from '../../src/core/planet';
import { GLOBE_BIOME_RGB } from '../../src/core/planet/atlas';
import {
  BIOME_LABELS,
  Biome,
  clampSettings,
  DEFAULT_WORLD_SETTINGS,
} from '../../src/core/world/models';
import { generatePlanetChunk } from '../../src/core/world/world-gen';
import { planetFrame } from '../../src/core/world/planet-chunk';

describe('the biome legend', () => {
  it('lists every distinct biome id once, from the enum, with a name and colour', () => {
    const ids = new Set(Object.values(Biome).filter((v): v is number => typeof v === 'number'));
    const legend = biomeLegend();
    expect(legend.map((e) => e.id)).toEqual([...ids].sort((a, b) => a - b));
    expect(new Set(legend.map((e) => e.id)).size).toBe(legend.length);
    for (const e of legend) {
      expect(e.name).toBe(BIOME_LABELS[e.id]);
      expect(e.rgb).toEqual(GLOBE_BIOME_RGB[e.id]);
    }
    // Enum aliases (Heath = Badlands) collapse to one row.
    expect(legend.filter((e) => e.id === Biome.Heath)).toHaveLength(1);
    expect(biomeLegendRgb()[Biome.Desert]).toEqual(GLOBE_BIOME_RGB[Biome.Desert]);
  });

  it('washes in legend colours and veils all but the focused biome', () => {
    const ids = new Uint8Array([Biome.Desert, Biome.Water, Biome.Desert, Biome.Plains]);
    const plain = biomeWashRgba(ids, 2, 2, 64, 0.5, null);
    expect(plain.w).toBe(2);
    expect([...plain.rgba.slice(0, 4)]).toEqual([...GLOBE_BIOME_RGB[Biome.Desert]!, 128]);
    const focus = biomeWashRgba(ids, 2, 2, 64, 0.5, Biome.Desert);
    expect(focus.rgba[3]).toBe(192);
    expect([...focus.rgba.slice(4, 8)]).toEqual([10, 12, 18, 165]);
    const small = biomeWashRgba(new Uint8Array(400 * 200), 400, 200, 100, 0.4, null);
    expect([small.w, small.h]).toEqual([100, 50]);
  });

  it('carries biome ids in the bake flags and the chunk raster', () => {
    const f = makePlanetField({ source: 'trailbound', seed: 7741, n: 20 });
    const b = bakeWorld(f, 64, 32);
    const legendIds = new Set(biomeLegend().map((e) => e.id as number));
    let land = 0;
    for (let i = 0; i < 64 * 32; i++) {
      const id = b.flags[i * 4 + 2]!;
      expect(legendIds.has(id)).toBe(true);
      if (b.flags[i * 4]! === 0) expect(id).toBe(Biome.Water);
      else land++;
    }
    expect(land).toBeGreaterThan(0);

    const settings = clampSettings({ ...DEFAULT_WORLD_SETTINGS, worldScale: 1 });
    const frame = planetFrame(7741, settings);
    const world = generatePlanetChunk(7741, settings, frame.home, frame);
    const r = chunkRaster(world, 64);
    expect(r.ids.length).toBe(64 * 64);
    const k = world.width / 64;
    const c = 32 * 64 + 10;
    expect(r.ids[c]).toBe(
      world.biomes[Math.floor((32 + 0.5) * k) * world.width + Math.floor((10 + 0.5) * k)],
    );
  });
});
