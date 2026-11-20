import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test } from 'vitest';
import { readWardrobeCatalog } from '../../src/app/wardrobe-edit';
import { createCharacterBackend } from '../../src/render/characters/backends/select';
import { createV2Backend } from '../../src/render/characters/backends/v2';
import { characterForgePaths, characterForgeV2Paths } from '../../src/render/characters/cf-pin';
import {
  characterEngine,
  checkRecipeEdit,
  describeRecipe,
  editRecipe,
  forgeEditCatalog,
  forgeStats,
  generateRecipe,
  initForge,
  optionsFor,
  packsForRecipe,
  placeholderAvatar,
  recipeForAvatar,
  recipeFromStored,
  recipeHashOf,
  validateGameProfile,
} from '../../src/render/characters/forge';
import { forgePresentation } from '../../src/render/characters/forge';

const vendor = path.resolve('public', characterForgePaths().base);
const profile = JSON.parse(readFileSync('content/characters/trailbound.json', 'utf8')) as unknown;

test('v2 is the default backend, ?cf=1 selects the legacy v1, and ?cf=0 still disables', async () => {
  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map((item) => String(item)).join(' '));
  };
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'location');
  const setSearch = (search: string) => {
    Object.defineProperty(globalThis, 'location', {
      configurable: true,
      writable: true,
      value: { search, href: 'http://trailbound.test/' },
    });
  };
  try {
    expect(createCharacterBackend('?cf=2').id).toBe('cf2');
    expect(createCharacterBackend('?cf=v2').id).toBe('cf2');
    expect(createCharacterBackend('?cf=cf2').id).toBe('cf2');
    expect(createCharacterBackend('?cf=1').id).toBe('cf1');
    expect(createCharacterBackend('').id).toBe('cf2');
    expect(createCharacterBackend('?cf=v1').id).toBe('cf1');
    expect(createCharacterBackend('?cf=cf1').id).toBe('cf1');
    expect(warnings).toEqual([]);
    const warnedCount = warnings.length;
    expect(createCharacterBackend('?cf=1').id).toBe('cf1');
    expect(warnings).toHaveLength(warnedCount);

    setSearch('?cf=0');
    const disabled = await initForge({ force: true, enabled: true });
    expect(disabled.ok).toBe(false);
    expect(disabled.reason).toBe('cf=0');
    expect(characterEngine()).toBeNull();

    const before = warnings.length;
    setSearch('?cf=2');
    const rejected = await initForge({
      force: true,
      enabled: true,
      runtimeUrl: 'data:text/javascript,export default {}',
      baseUrl: 'http://cf-test/',
    });
    expect(rejected.ok).toBe(false);
    expect(rejected.reason).toMatch(/api mismatch/);
    expect(characterEngine()).toBeNull();
    expect(warnings.slice(before)).toEqual([]);
  } finally {
    console.warn = originalWarn;
    if (previous) Object.defineProperty(globalThis, 'location', previous);
    else Reflect.deleteProperty(globalThis, 'location');
  }
});

test('a disabled forge returns a placeholder pawn', async () => {
  const status = await initForge({ force: true, enabled: false });
  expect(status.ok).toBe(false);
  expect(status.reason).toBe('cf=0');
  const body = placeholderAvatar(4);
  expect(body.source).toBe('placeholder');
  expect(body.recipeHash).toBe('ph:4');
  body.play('Walk');
  body.update(0.16);
  body.dispose();
});

test('the trailbound profile validates, and the same seed and entry hash the same recipe', async () => {
  // This test loads the v1 runtime and checks v1 recipes, so it pins the legacy backend.
  const restoreSearch = pinSearch('?cf=1');
  const restoreFetch = installFileFetch();
  installCanvasShim();
  installBitmapShim();
  try {
    const status = await initForge({
      force: true,
      enabled: true,
      baseUrl: 'http://cf-test/',
      runtimeUrl: pathToFileURL(path.join(vendor, 'cf-runtime.mjs')).href,
      profile,
    });
    expect(status.ok, status.reason).toBe(true);
    expect(characterEngine()).toBe('cf1');
    expect(status.initMs).toBeGreaterThan(0);

    const report = validateGameProfile(profile);
    expect(report.errors, report.errors.join('\n')).toEqual([]);
    expect(report.ok).toBe(true);

    const entry = {
      races: { elf: 1 },
      genders: { f: 1 },
      styles: { mage: 1 },
      richness: 0.4,
      ages: { adult: 1 },
    };
    const flipped = {
      ages: { adult: 1 },
      richness: 0.4,
      styles: { mage: 1 },
      genders: { f: 1 },
      races: { elf: 1 },
    };
    const first = generateRecipe({ seed: 7741, profileEntry: entry, generatorVersion: 1 });
    const second = generateRecipe({ seed: 7741, profileEntry: flipped, generatorVersion: 1 });
    const other = generateRecipe({ seed: 7742, profileEntry: entry, generatorVersion: 1 });
    const hash = recipeHashOf(first);
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
    expect(recipeHashOf(second)).toBe(hash);
    expect(recipeHashOf(other)).not.toBe(hash);
    expect(first.generatorVersion).toBe(1);
    expect(packsForRecipe(first)).toBeInstanceOf(Array);
    expect(forgeStats()).not.toBeNull();

    const human = generateRecipe({
      seed: 11,
      profileEntry: { ages: { adult: 1 } },
      race: 'human',
      gender: 'f',
      generatorVersion: 1,
    });
    const options = optionsFor('human', 'f', 'adult');
    expect(options.skins.length).toBeGreaterThan(1);
    expect(options.sliders.some((slider) => slider.id === 'height')).toBe(true);
    const kobold = optionsFor('kobold', 'm', 'adult');
    expect(kobold.styles.map((style) => style.id)).toEqual(['bald']);
    expect(kobold.controls.hairColor).toBe(false);
    expect(kobold.facialHair).toEqual([]);

    const described = describeRecipe(human);
    const roundTrip = checkRecipeEdit(human, {
      skin: described.skin,
      hairColor: described.hairColor,
      hairStyle: described.hairStyle,
    });
    expect(roundTrip.ok, roundTrip.errors.map((issue) => issue.msg).join('; ')).toBe(true);
    expect(roundTrip.recipe && recipeHashOf(roundTrip.recipe)).toBe(recipeHashOf(human));

    const nextSkin = options.skins.find((swatch) => swatch.id !== described.skin)?.id;
    expect(nextSkin).toBeTruthy();
    const edited = editRecipe(human, { skin: nextSkin });
    expect(recipeHashOf(edited)).not.toBe(recipeHashOf(human));
    expect(describeRecipe(edited).skin).toBe(nextSkin);
    const rejected = checkRecipeEdit(human, { facialHair: 'goatee' });
    expect(rejected.ok).toBe(false);
    expect(rejected.errors.some((issue) => issue.code === 'not_allowed')).toBe(true);

    const adult = optionsFor('human', 'm', 'adult');
    const slotOrder = Object.keys(adult.slots);
    expect(slotOrder).toHaveLength(29);
    expect(slotOrder).toContain('baldric');
    expect(slotOrder.indexOf('bandolier')).toBeLessThan(slotOrder.indexOf('baldric'));
    expect(slotOrder.indexOf('legs')).toBe(slotOrder.indexOf('hands') + 1);
    expect(adult.slots.baldric?.some((item) => item.id === 'baldric')).toBe(true);
    expect(adult.slots.tunic).toBeUndefined();
    const tunic = editRecipe(human, { outfit: { chest: 'tunic' } });
    const tunicLook = describeRecipe(tunic);
    expect(tunicLook.outfit.chest).toMatchObject({ id: 'tunic' });
    expect(tunicLook.outfit.torso_mid).toMatchObject({ id: 'tunic' });
    const boots = editRecipe(tunic, { outfit: { feet: 'riding_boots' } });
    const bootLook = describeRecipe(boots);
    expect(bootLook.outfit.feet?.id).toBe('riding_boots');
    expect(bootLook.outfit.shins?.id).toBe('riding_boots');
    const headed = editRecipe(human, { outfit: { head_inner: 'bandana' } });
    expect(describeRecipe(headed).outfit.head_inner?.id).toBe('bandana');
    const neck = editRecipe(headed, {
      outfit: { neck_wrap: { id: 'bandana', states: { wear: 'neck' } } },
    });
    const neckLook = describeRecipe(neck);
    expect(neckLook.outfit.neck_wrap).toMatchObject({ id: 'bandana', states: { wear: 'neck' } });
    expect(neckLook.outfit.head_inner).toBeNull();
    const illegal = checkRecipeEdit(neck, {
      outfit: { head_inner: { id: 'bandana', states: { wear: 'neck' } } },
    });
    expect(illegal.ok).toBe(false);
    const vest = editRecipe(human, { outfit: { torso_mid: 'vest' } });
    const displaced = editRecipe(vest, { outfit: { chest: 'tunic' } });
    expect(describeRecipe(displaced).outfit.torso_mid?.id).toBe('tunic');
    expect(describeRecipe(displaced).outfit.torso_inner?.id).not.toBe('tunic');
    const again = editRecipe(displaced, { outfit: { chest: 'tunic' } });
    expect(recipeHashOf(again)).toBe(recipeHashOf(displaced));
    const cleared = editRecipe(neck, { outfit: { neck_wrap: null } });
    const clearedLook = describeRecipe(cleared);
    expect(clearedLook.outfit.neck_wrap).toBeNull();
    expect(clearedLook.outfit.head_inner?.id).not.toBe('bandana');
    expect(clearedLook.outfit.face_lower?.id).not.toBe('bandana');
    const hoodUp = editRecipe(human, {
      outfit: { head_outer: { id: 'hood', states: { wear: 'up' } } },
    });
    expect(describeRecipe(hoodUp).outfit.head_outer?.id).toBe('hood');
    const hoodDown = editRecipe(hoodUp, {
      outfit: { neck_wrap: { id: 'hood', states: { wear: 'down' } } },
    });
    const hoodLook = describeRecipe(hoodDown);
    expect(hoodLook.outfit.neck_wrap).toMatchObject({ id: 'hood', states: { wear: 'down' } });
    expect(hoodLook.outfit.head_outer?.id).not.toBe('hood');

    const catalog = readWardrobeCatalog(forgeEditCatalog());
    expect(catalog.catalogVersion).toBe(1);
    expect(catalog.slots).toEqual(slotOrder);
    expect(catalog.slotRegions).not.toBeNull();
    const upper = catalog.slotRegions?.upper ?? [];
    const lower = catalog.slotRegions?.lower ?? [];
    expect(catalog.slots.filter((slot) => upper.includes(slot))).toEqual(upper);
    expect(catalog.slots.filter((slot) => lower.includes(slot))).toEqual(lower);
    expect(new Set([...upper, ...lower])).toEqual(new Set(catalog.slots));
    expect(upper.length + lower.length).toBe(catalog.slots.length);
    expect(catalog.occupation.bandana).toEqual([
      { when: { wear: 'head' }, slots: ['head_inner'] },
      { when: { wear: 'mask' }, slots: ['face_lower'] },
      { when: { wear: 'neck' }, slots: ['neck_wrap'] },
    ]);
    expect(catalog.occupation.hood).toEqual([
      { when: { wear: 'up' }, slots: ['head_outer'] },
      { when: { wear: 'down' }, slots: ['neck_wrap'] },
    ]);
    expect(catalog.occupation.tunic).toEqual([{ when: {}, slots: ['chest', 'torso_mid'] }]);
    expect(catalog.occupation.riding_boots).toEqual([{ when: {}, slots: ['shins', 'feet'] }]);
    const bareTunic = editRecipe(tunic, { outfit: { chest: null } });
    expect(describeRecipe(bareTunic).outfit.chest).toBeNull();
    expect(describeRecipe(bareTunic).outfit.torso_mid).toBeNull();
    const bareBoots = editRecipe(boots, { outfit: { shins: null } });
    expect(describeRecipe(bareBoots).outfit.feet).toBeNull();
    expect(describeRecipe(bareBoots).outfit.shins).toBeNull();

    const stored = JSON.parse(
      readFileSync('tests/fixtures/cf-1.2.0-recipes.json', 'utf8'),
    ) as Record<string, { hash: string; engine: unknown }>;
    for (const row of Object.values(stored)) {
      const loaded = recipeFromStored(row.engine, 0);
      expect(recipeHashOf(loaded)).toBe(row.hash);
    }
  } finally {
    restoreFetch();
    restoreSearch();
  }
}, 180_000);

test('a v1 body keeps the old scale rule, and v2 metrics scale toward the 1.4 m hero', () => {
  expect(forgePresentation(null, 0)).toEqual({ scale: 1, timeScale: 1 });
  expect(forgePresentation(null, 1.4)).toEqual({ scale: 1, timeScale: 1 });
  expect(forgePresentation(null, 2.8)).toEqual({ scale: 1, timeScale: 2 });
  const human = forgePresentation({ heightM: 0.946, strideM: 0.539, walkDuration: 1.375 }, 1.6);
  expect(human.scale).toBeCloseTo(1.4 / 0.946, 5);
  expect(human.timeScale).toBeGreaterThan(0.2);
  expect(human.timeScale).not.toBe(Math.max(0.6, 1.6 / 1.4));
});

test('v2 builds a character, migrates a cf1 recipe in memory, and ignores KI unless asked', async () => {
  installHeadlessShims();
  const vendor2 = path.resolve('public', characterForgeV2Paths().base);
  const fetched: string[] = [];
  const restoreFetch = installFetch(vendor2, 'cf2-test/', fetched);
  const backend = createV2Backend();
  try {
    await backend.init({
      runtimeUrl: pathToFileURL(path.join(vendor2, 'cf-runtime.mjs')).href,
      baseUrl: 'http://cf2-test/',
    });
    const catalog = backend.catalog();
    expect(catalog?.version).toBe('2.1.0');
    expect(catalog?.raceMetrics?.human).toMatchObject({ heightM: 0.946, strideM: 0.539 });
    expect(catalog?.raceMetrics?.human?.walkDuration).toBeCloseTo(1.375, 3);
    expect(catalog?.flyerRaces).toEqual(expect.arrayContaining(['pixie', 'imp']));

    const first = backend.generate({
      seed: 1234,
      profileEntry: { ages: { adult: 1 } },
      race: 'dwarf',
      role: 'smith',
      tier: 'town',
    }) as { race?: string };
    const second = backend.generate({
      seed: 1234,
      profileEntry: { ages: { adult: 1 } },
      race: 'dwarf',
      role: 'smith',
      tier: 'town',
    });
    const other = backend.generate({
      seed: 1235,
      profileEntry: { ages: { adult: 1 } },
      race: 'dwarf',
      role: 'smith',
      tier: 'town',
    });
    expect(first.race).toBe('dwarf');
    expect(backend.recipeHash(first)).toBe('1e131891b205bb7f');
    expect(backend.recipeHash(second)).toBe(backend.recipeHash(first));
    expect(backend.recipeHash(other)).not.toBe(backend.recipeHash(first));

    const notes: string[] = [];
    const originalInfo = console.info;
    console.info = (...args: unknown[]) => {
      notes.push(args.map((item) => String(item)).join(' '));
    };
    let mapped: { race?: string };
    try {
      mapped = backend.generate({
        seed: 3,
        profileEntry: { ages: { adult: 1 }, races: { djinn: 1 } },
        race: 'djinn',
        gender: 'm',
      }) as { race?: string };
    } finally {
      console.info = originalInfo;
    }
    expect(mapped.race).toBe('human');
    expect(notes.join('\n')).toMatch(/djinn/);
    expect(notes.join('\n')).toMatch(/human/);

    const fixtures = JSON.parse(
      readFileSync('tests/fixtures/cf-1.2.0-recipes.json', 'utf8'),
    ) as Record<string, { hash: string; engine: { preset?: string } }>;
    const elfBefore = JSON.stringify(fixtures.elfMage?.engine);
    const humanBefore = JSON.stringify(fixtures.human?.engine);
    const elf = backend.migrateRecipe?.(fixtures.elfMage?.engine) as { race?: string; v?: number };
    const human = backend.migrateRecipe?.(fixtures.human?.engine) as { race?: string; v?: number };
    expect(JSON.stringify(fixtures.elfMage?.engine)).toBe(elfBefore);
    expect(JSON.stringify(fixtures.human?.engine)).toBe(humanBefore);
    expect(elf).toMatchObject({ race: 'wood_elf', v: 2 });
    expect(human).toMatchObject({ race: 'human', v: 2 });
    expect(backend.recipeHash(elf)).toBe('68144ce461f48dda');
    expect(backend.recipeHash(human)).toBe('eb9fba9697f19f92');
    expect(backend.recipeHash(backend.migrateRecipe?.(elf))).toBe(backend.recipeHash(elf));

    const built = await backend.build(first, {});
    expect(built.info?.budgetMs).toBe(6);
    expect(built.info?.heightM).toBeCloseTo(0.762, 3);
    expect(built.object3D).toBeTruthy();
    expect(built.clips?.Idle).toBeTruthy();
    expect(built.clips?.Walk?.duration).toBeCloseTo(1.375, 3);
    expect(built.object3D.userData.cfMetrics).toMatchObject({
      heightM: expect.closeTo(0.762, 3),
      strideM: expect.any(Number),
      walkDuration: expect.closeTo(1.375, 3),
    });
    built.play('Walk');
    built.mixer.update(0.05);
    expect(built.socket?.('head')).toBeTruthy();
    built.dispose();
    expect(
      fetched.some((url) => url.toLowerCase().includes('ki_') || url.includes('ki_manifest')),
    ).toBe(false);

    const opted = createV2Backend();
    const privateFetches: string[] = [];
    const restorePrivate = installFetch(vendor2, 'cf2-private/', privateFetches);
    try {
      await opted.init({
        runtimeUrl: pathToFileURL(path.join(vendor2, 'cf-runtime.mjs')).href,
        baseUrl: 'http://cf2-private/',
        privateAnimBaseUrl: 'http://cf2-private/private-ki/',
      });
      const recipe = opted.generate({
        seed: 9,
        profileEntry: { ages: { adult: 1 } },
        race: 'human',
      });
      await expect(opted.build(recipe, { budgetMs: 0 })).rejects.toThrow(
        /private|ki_manifest|HTTP/i,
      );
      expect(privateFetches.some((url) => url.includes('ki_manifest.json'))).toBe(true);
    } finally {
      restorePrivate();
      opted.dispose();
    }
  } finally {
    restoreFetch();
    backend.dispose();
  }
}, 180_000);

test('loading a cf1 avatar on the default v2 backend migrates a copy and leaves the save alone', async () => {
  installHeadlessShims();
  const vendor2 = path.resolve('public', characterForgeV2Paths().base);
  const restoreFetch = installFetch(vendor2, 'cf2-load/', []);
  // No `?cf=`: the default backend is v2.
  const restoreSearch = pinSearch('');
  try {
    const fixtures = JSON.parse(
      readFileSync('tests/fixtures/cf-1.2.0-recipes.json', 'utf8'),
    ) as Record<string, { engine: Record<string, unknown> }>;
    const saved = {
      engine: 'cf1' as const,
      recipe: fixtures.elfMage?.engine,
      legacyRecipe: undefined,
      seed: 7741,
    };
    const before = JSON.stringify(saved);
    const ready = await initForge({
      force: true,
      enabled: true,
      runtimeUrl: pathToFileURL(path.join(vendor2, 'cf-runtime.mjs')).href,
      baseUrl: 'http://cf2-load/',
    });
    expect(ready.ok, ready.reason).toBe(true);
    expect(characterEngine()).toBe('cf2');
    const playable = recipeForAvatar(saved);
    expect(JSON.stringify(saved)).toBe(before);
    expect(saved.engine).toBe('cf1');
    expect(playable?.engine && (playable.engine as { race?: string; v?: number }).race).toBe(
      'wood_elf',
    );
    expect((playable?.engine as { v?: number }).v).toBe(2);
    const untouched = recipeFromStored(fixtures.human?.engine, 1);
    expect(recipeHashOf(untouched)).not.toBe(recipeHashOf(playable!));
  } finally {
    restoreFetch();
    restoreSearch();
  }
}, 180_000);

/** Point `location.search` at `search` for backend selection. Returns the undo. */
function pinSearch(search: string): () => void {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'location');
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    writable: true,
    value: { search, href: `http://trailbound.test/${search}` },
  });
  return () => {
    if (previous) Object.defineProperty(globalThis, 'location', previous);
    else Reflect.deleteProperty(globalThis, 'location');
  };
}

function installFileFetch(): () => void {
  const original = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const marker = 'cf-test/';
    const at = url.indexOf(marker);
    if (at < 0) return original(input, init);
    const rel = decodeURIComponent(url.slice(at + marker.length).split('?')[0] ?? '');
    const file = path.resolve(vendor, rel);
    if (file !== vendor && !file.startsWith(`${vendor}${path.sep}`)) {
      throw new Error(`forge test fetch escaped: ${rel}`);
    }
    const data = await readFile(file);
    return new Response(data);
  };
  return () => {
    globalThis.fetch = original;
  };
}

function installBitmapShim(): void {
  if (typeof globalThis.createImageBitmap === 'function') return;
  globalThis.createImageBitmap = async () =>
    ({
      width: 4,
      height: 4,
      close() {
        return;
      },
    }) as ImageBitmap;
}

function installCanvasShim(): void {
  if (typeof globalThis.OffscreenCanvas !== 'undefined') return;
  class CanvasShim {
    width: number;
    height: number;
    constructor(width = 1, height = 1) {
      this.width = width;
      this.height = height;
    }
    getContext(): unknown {
      return {
        canvas: this,
        fillRect() {
          return;
        },
        clearRect() {
          return;
        },
        drawImage() {
          return;
        },
        getImageData() {
          return { data: new Uint8ClampedArray(4), width: 1, height: 1 };
        },
        putImageData() {
          return;
        },
        createImageData() {
          return { data: new Uint8ClampedArray(4), width: 1, height: 1 };
        },
      };
    }
  }
  Object.assign(globalThis, { OffscreenCanvas: CanvasShim });
}

function installHeadlessShims(): void {
  class CanvasShim {
    width: number;
    height: number;
    constructor(width = 4, height = 4) {
      this.width = width;
      this.height = height;
    }
    getContext(): unknown {
      return {
        canvas: this,
        fillStyle: '',
        globalCompositeOperation: 'source-over',
        imageSmoothingEnabled: false,
        fillRect() {
          return;
        },
        clearRect() {
          return;
        },
        drawImage() {
          return;
        },
        getImageData(_x: number, _y: number, w = 1, h = 1) {
          return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h };
        },
        putImageData() {
          return;
        },
        createImageData(w = 1, h = 1) {
          return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h };
        },
        createPattern() {
          return {};
        },
        measureText() {
          return { width: 0 };
        },
        fillText() {
          return;
        },
        save() {
          return;
        },
        restore() {
          return;
        },
        translate() {
          return;
        },
        scale() {
          return;
        },
        beginPath() {
          return;
        },
        rect() {
          return;
        },
        clip() {
          return;
        },
        setTransform() {
          return;
        },
        resetTransform() {
          return;
        },
      };
    }
  }
  class ImageShim {
    width = 8;
    height = 8;
    onload: (() => void) | null = null;
    set src(_value: string) {
      queueMicrotask(() => this.onload?.());
    }
    decode(): Promise<void> {
      return Promise.resolve();
    }
  }
  (globalThis as unknown as { self: unknown }).self = globalThis;
  (globalThis as unknown as { window: unknown }).window = globalThis;
  const globals = globalThis;
  globals.OffscreenCanvas = CanvasShim as unknown as typeof OffscreenCanvas;
  globals.createImageBitmap = async () =>
    ({
      width: 8,
      height: 8,
      close() {
        return;
      },
    }) as ImageBitmap;
  globals.document = {
    createElement(tag: string) {
      if (tag === 'canvas') return new CanvasShim(32, 32) as unknown as HTMLCanvasElement;
      return { style: {} } as HTMLElement;
    },
  } as Document;
  globals.Image = ImageShim as unknown as typeof Image;
}

function installFetch(root: string, marker: string, seen: string[]): () => void {
  const original = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    seen.push(url);
    const at = url.indexOf(marker);
    if (at < 0) return original(input, init);
    const rel = decodeURIComponent(url.slice(at + marker.length).split('?')[0] ?? '');
    if (rel.startsWith('private-ki/')) return new Response('missing', { status: 404 });
    const file = path.resolve(root, rel);
    if (file !== root && !file.startsWith(`${root}${path.sep}`) && !file.startsWith(root)) {
      throw new Error(`forge test fetch escaped: ${rel}`);
    }
    const data = await readFile(file);
    return new Response(data);
  };
  return () => {
    globalThis.fetch = original;
  };
}
