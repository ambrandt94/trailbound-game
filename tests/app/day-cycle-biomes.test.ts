import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { BIOME_NAMES } from '../../src/core/area/build-area';
import {
  groundLight,
  litTint,
  skyAt,
  thresholdsFor,
  type SkyState,
} from '../../src/core/sim/day-cycle';
import { biomeAtTile } from '../../src/core/world/biome-at';
import { BIOME_COUNT, Biome } from '../../src/core/world/models';
import {
  BASE_IDS,
  BASE_SLOTS,
  BIOME_ID_NAMES,
  BIOME_RECIPE,
  DEFAULT_RECIPE,
  DETAIL_IDS,
  RECIPES,
  detailSlot,
  layerTint,
  recipeFor,
  recipeSlots,
} from '../../src/ui/day-cycle/biome-recipes';
import { parseManifest } from '../../src/ui/day-cycle/manifest';
// Plain JS art tool: runs the game's own renderer on a software canvas.
// @ts-expect-error untyped mjs module.
import { createHudRenderer } from '../../tools/hud-day-cycle-preview.mjs';

interface Img {
  w: number;
  h: number;
  data: Uint8ClampedArray;
  get(x: number, y: number): number[];
}
interface HudRenderer {
  recipeId: string;
  layout: { sky: { x: number; y: number; w: number; h: number } };
  thresholdsFor(season: string): { sunriseTU: number; noonTU: number; sunsetTU: number };
  draw(frame: Record<string, unknown>): Img;
}

const dir = join(process.cwd(), 'public', 'assets', 'ui', 'hud-day-cycle');
const manifest = parseManifest(JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')));
const th = thresholdsFor('summer');

describe('biome recipes: every game biome has one', () => {
  test('the id-to-name table is the game biome list', () => {
    expect([...BIOME_ID_NAMES]).toEqual([...BIOME_NAMES]);
    expect(BIOME_ID_NAMES.length).toBeGreaterThanOrEqual(BIOME_COUNT);
  });

  test('every world biome id, every name and the Heath alias resolve to a real, non-default recipe', () => {
    for (let id = 0; id < BIOME_ID_NAMES.length; id++) {
      const recipe = recipeFor(id);
      expect(recipe.id, `id ${id} ${BIOME_ID_NAMES[id]}`).not.toBe(DEFAULT_RECIPE.id);
      expect(RECIPES[recipe.id]).toBe(recipe);
    }
    for (const name of BIOME_NAMES) expect(BIOME_RECIPE[name], name).toBeDefined();
    expect(recipeFor(Biome.Heath).id).toBe(recipeFor(Biome.Badlands).id);
    expect(recipeFor('Heath').id).toBe('badlands');
  });

  test('the generator biomes read as what they are', () => {
    expect(recipeFor(Biome.Forest).details.map((d) => d.id)).toContain('broadleaf');
    expect(recipeFor(Biome.Taiga).details.map((d) => d.id)).toContain('pine');
    expect(recipeFor(Biome.Desert).base).toBe('dunes');
    expect(recipeFor(Biome.Mountain).base).toBe('mountains');
    expect(recipeFor(Biome.Snow).details.map((d) => d.id)).toContain('snowcaps');
    expect(recipeFor(Biome.Sand).base).toBe('coastline');
    expect(recipeFor(Biome.Plains).base).toBe('flatland');
    expect(recipeFor(Biome.Marsh).details.map((d) => d.id)).toContain('reeds');
  });

  test('lookups take ids, names, recipe ids and loose case, and fall back to the default', () => {
    expect(recipeFor('Desert').id).toBe('desert');
    expect(recipeFor('desert').id).toBe('desert');
    expect(recipeFor('snow_mountains').id).toBe('snow_mountains');
    expect(recipeFor(' dark_forest ').id).toBe('dark_forest');
    expect(recipeFor('DARKFOREST').id).toBe('dark_forest');
    expect(recipeFor(null)).toBe(DEFAULT_RECIPE);
    expect(recipeFor(undefined)).toBe(DEFAULT_RECIPE);
    expect(recipeFor(999)).toBe(DEFAULT_RECIPE);
    expect(recipeFor(-1)).toBe(DEFAULT_RECIPE);
    expect(recipeFor('Atlantis')).toBe(DEFAULT_RECIPE);
  });

  test('the default recipe is the original hills strip, tinted by the sky', () => {
    expect(DEFAULT_RECIPE).toMatchObject({ base: 'hills', details: [], tints: {} });
    expect(BASE_SLOTS.hills).toBe('terrain_mask');
  });
});

describe('biome recipes: art slots', () => {
  test('every slot a recipe draws is in the manifest as a tintable, tileable strip', () => {
    for (const recipe of Object.values(RECIPES)) {
      for (const slot of recipeSlots(recipe)) {
        const def = manifest.sprites[slot];
        expect(def, `${recipe.id} needs ${slot}`).toBeDefined();
        expect(def?.tint, slot).toBe(true);
        expect(def?.tile, slot).toBe(true);
        expect(def?.w, slot).toBe(36);
      }
    }
  });

  test('every base and detail has a slot, and the new strips are on the biomes sheet', () => {
    for (const id of BASE_IDS) expect(manifest.sprites[BASE_SLOTS[id]]).toBeDefined();
    for (const id of DETAIL_IDS) expect(manifest.sprites[detailSlot(id)]).toBeDefined();
    for (const [id, def] of Object.entries(manifest.sprites)) {
      const isBiome = id.startsWith('ground_') || id.startsWith('detail_');
      expect(def.sheet === 'biomes', id).toBe(isBiome);
    }
  });

  test('tints are noon hex colours, layers use known tint kinds, and waves and water use water', () => {
    for (const recipe of Object.values(RECIPES)) {
      for (const hex of Object.values(recipe.tints)) expect(hex).toMatch(/^#[0-9a-f]{6}$/i);
      for (const layer of recipe.details) {
        const kind = layerTint(layer);
        if (layer.id === 'water' || layer.id === 'waves') expect(kind).toBe(layer.tint ?? 'water');
        if (kind !== 'ground')
          expect(recipe.tints[kind] ?? recipe.tints.detail, recipe.id).toBeDefined();
      }
    }
  });

  test('draw order is behind details, then the base, then the rest', () => {
    expect(recipeSlots(RECIPES.beach!)).toEqual(['detail_water', 'ground_coast', 'detail_waves']);
    expect(recipeSlots(RECIPES.desert!)).toEqual(['ground_dunes', 'detail_cactus']);
  });
});

describe('light of the hour for biome tints', () => {
  const at = (tu: number): SkyState => skyAt(tu, th);
  const sum = (c: readonly number[]) => c.reduce((a, b) => a + b, 0);

  test('noon is full light, so a tint is shown as written', () => {
    const light = groundLight(at(th.noonTU));
    for (const c of light) expect(c).toBeCloseTo(1, 1);
    expect(litTint([100, 150, 200], light)).toEqual([100, 150, 200]);
  });

  test('dawn and dusk are dimmer and warmer, night dimmer and cooler, and nothing goes black', () => {
    const noon = groundLight(at(th.noonTU));
    const dawn = groundLight(at(th.sunriseTU - 1));
    const dusk = groundLight(at(th.sunsetTU + 1));
    const night = groundLight(at(th.sunsetTU - 20));
    for (const dim of [dawn, dusk, night]) expect(sum(dim)).toBeLessThan(sum(noon));
    expect(dawn[0] / dawn[2]).toBeGreaterThan(noon[0] / noon[2]);
    expect(dusk[0] / dusk[2]).toBeGreaterThan(noon[0] / noon[2]);
    expect(night[2] / night[0]).toBeGreaterThan(noon[2] / noon[0]);
    for (let tu = 1; tu <= 100; tu++) {
      for (const c of groundLight(at(tu))) {
        expect(c).toBeGreaterThan(0.25);
        expect(c).toBeLessThan(1.4);
      }
    }
  });

  test('a lit tint is a clamped colour and takes a brightness multiplier', () => {
    expect(litTint([250, 250, 250], [1.4, 1.4, 1.4])).toEqual([255, 255, 255]);
    expect(litTint([200, 100, 50], [1, 1, 1], 0.5)).toEqual([100, 50, 25]);
  });
});

describe('the biome under the party', () => {
  const data = { width: 4, height: 2, biomes: Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7]) };

  test('reads the tile, wraps east-west and clamps north-south', () => {
    expect(biomeAtTile(data, 1.9, 0.2)).toBe(1);
    expect(biomeAtTile(data, 3.5, 1.5)).toBe(7);
    expect(biomeAtTile(data, 4.1, 0)).toBe(0);
    expect(biomeAtTile(data, -0.5, 0)).toBe(3);
    expect(biomeAtTile(data, 1, -5)).toBe(1);
    expect(biomeAtTile(data, 1, 99)).toBe(5);
  });

  test('is null without a map or with a bad position', () => {
    expect(biomeAtTile(null, 1, 1)).toBeNull();
    expect(biomeAtTile(data, Number.NaN, 1)).toBeNull();
    expect(biomeAtTile({ width: 0, height: 0, biomes: new Uint8Array(0) }, 0, 0)).toBeNull();
  });
});

describe('the sky strip draws the biome (game renderer, software canvas)', () => {
  const frame = (biome: number | string | null | undefined, tu: number, timeMs = 0) => ({
    tuRemaining: tu,
    day: 1,
    season: 'summer',
    fogUnits: 0,
    timeMs,
    reducedMotion: false,
    ...(biome === undefined ? {} : { biome }),
  });
  const skyRows = (r: HudRenderer, img: Img): number[] => {
    const { x, y, w, h } = r.layout.sky;
    const out: number[] = [];
    for (let yy = y; yy < y + h; yy++)
      for (let xx = x; xx < x + w; xx++) out.push(...img.get(xx, yy));
    return out;
  };
  const same = (a: readonly number[], b: readonly number[]) =>
    a.length === b.length && a.every((v, i) => v === b[i]);
  const diffCount = (a: readonly number[], b: readonly number[]) =>
    a.reduce((n, v, i) => n + (v === b[i] ? 0 : 1), 0) / 4;

  test('no biome and the default recipe draw exactly the original strip', async () => {
    const r = (await createHudRenderer()) as HudRenderer;
    const tu = th.noonTU;
    const plain = skyRows(r, r.draw(frame(undefined, tu)));
    expect(same(plain, skyRows(r, r.draw(frame(null, tu))))).toBe(true);
    expect(same(plain, skyRows(r, r.draw(frame('default', tu))))).toBe(true);
    expect(r.recipeId).toBe('default');
  });

  test('each biome looks different from the others, at sunrise and at noon', async () => {
    const names = [
      'Forest',
      'Mountain',
      'Snow',
      'Sand',
      'Desert',
      'Plains',
      'Taiga',
      'Marsh',
      'Jungle',
      'Hills',
    ];
    for (const tu of [th.sunriseTU - 2, th.noonTU]) {
      const shots: number[][] = [];
      for (const name of names) {
        const r = (await createHudRenderer()) as HudRenderer;
        shots.push(skyRows(r, r.draw(frame(name, tu))));
      }
      for (let i = 0; i < shots.length; i++)
        for (let j = i + 1; j < shots.length; j++)
          expect(
            diffCount(shots[i]!, shots[j]!),
            `${names[i]} vs ${names[j]} at ${tu}`,
          ).toBeGreaterThan(80);
    }
  });

  test('a biome change crossfades over about a second: a mix halfway, the new biome at the end', async () => {
    const tu = th.noonTU;
    const r = (await createHudRenderer()) as HudRenderer;
    const only = async (name: string) => {
      const solo = (await createHudRenderer()) as HudRenderer;
      return skyRows(solo, solo.draw(frame(name, tu)));
    };
    const forest = await only('Forest');
    const desert = await only('Desert');
    expect(same(skyRows(r, r.draw(frame('Forest', tu, 1000))), forest)).toBe(true);
    const start = skyRows(r, r.draw(frame('Desert', tu, 2000)));
    const half = skyRows(r, r.draw(frame('Desert', tu, 2500)));
    const end = skyRows(r, r.draw(frame('Desert', tu, 3000)));
    const later = skyRows(r, r.draw(frame('Desert', tu, 5000)));
    expect(diffCount(start, forest)).toBeLessThan(diffCount(half, forest));
    expect(diffCount(half, forest)).toBeGreaterThan(40);
    expect(diffCount(half, desert)).toBeGreaterThan(40);
    expect(same(end, desert)).toBe(true);
    expect(same(later, desert)).toBe(true);
    expect(r.recipeId).toBe('desert');
  });

  test('reduced motion switches biome at once', async () => {
    const r = (await createHudRenderer()) as HudRenderer;
    const tu = th.noonTU;
    r.draw(frame('Forest', tu, 0));
    const now = skyRows(r, r.draw({ ...frame('Desert', tu, 10), reducedMotion: true }));
    const solo = (await createHudRenderer()) as HudRenderer;
    expect(same(now, skyRows(solo, solo.draw(frame('Desert', tu))))).toBe(true);
  });

  test('art without the biome strips falls back to the default hills, not to nothing', async () => {
    const old = (await createHudRenderer(undefined, {
      skip: (id: string) => id.startsWith('ground_') || id.startsWith('detail_'),
    })) as HudRenderer;
    const r = (await createHudRenderer()) as HudRenderer;
    const tu = th.noonTU;
    expect(
      same(skyRows(old, old.draw(frame('Forest', tu))), skyRows(r, r.draw(frame(undefined, tu)))),
    ).toBe(true);
  });

  test('the light of the hour still shows through: a biome is darker at night than at noon', async () => {
    const lum = (img: number[]) => img.reduce((a, v, i) => (i % 4 === 3 ? a : a + v), 0);
    const r1 = (await createHudRenderer()) as HudRenderer;
    const r2 = (await createHudRenderer()) as HudRenderer;
    const noon = lum(skyRows(r1, r1.draw(frame('Forest', th.noonTU))));
    const night = lum(skyRows(r2, r2.draw(frame('Forest', 10))));
    expect(night).toBeLessThan(noon * 0.6);
  });
});
