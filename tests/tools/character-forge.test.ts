import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test } from 'vitest';
import {
  checkRecipeEdit,
  describeRecipe,
  editRecipe,
  forgeStats,
  generateRecipe,
  initForge,
  optionsFor,
  packsForRecipe,
  placeholderAvatar,
  recipeHashOf,
  validateGameProfile,
} from '../../src/render/characters/forge';

const vendor = path.resolve('public/vendor/character-forge/1.2.0');
const profile = JSON.parse(readFileSync('content/characters/trailbound.json', 'utf8')) as unknown;

test('a disabled forge returns a placeholder pawn', async () => {
  const status = await initForge({ enabled: false });
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
  } finally {
    restoreFetch();
  }
}, 180_000);

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
