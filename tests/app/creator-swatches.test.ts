import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test } from 'vitest';
import {
  eyeColorPatch,
  hairColorIds,
  irisColorIds,
  paintCreatorSwatch,
} from '../../src/app/creator-swatches';
import {
  characterEngine,
  checkRecipeEdit,
  describeRecipe,
  editRecipe,
  generateRecipe,
  initForge,
  optionsFor,
  recipeHashOf,
} from '../../src/render/characters/forge';
import { characterForgeV2Paths } from '../../src/render/characters/cf-pin';

test('hair and iris swatches paint with real colours, and existing rgb is left alone', () => {
  const hair = hairColorIds().map((id) => paintCreatorSwatch({ id, rgb: [] }));
  const iris = irisColorIds().map((id) => paintCreatorSwatch({ id, rgb: [] }));
  expect(hair).toHaveLength(15);
  expect(iris).toHaveLength(15);

  const keys = (item: { rgb: number[] }) => item.rgb.join(',');
  expect(new Set(hair.map(keys)).size).toBe(15);
  expect(new Set(iris.map(keys)).size).toBe(15);
  for (const item of [...hair, ...iris]) {
    expect(item.rgb, item.id).toHaveLength(3);
    expect(
      item.rgb.some((channel) => channel > 0),
      `${item.id} was #000000`,
    ).toBe(true);
  }

  const skin = paintCreatorSwatch({ id: '2', rgb: [240, 200, 170], name: 'Fair' });
  expect(skin).toEqual({ id: '2', rgb: [240, 200, 170], name: 'Fair' });
  expect(paintCreatorSwatch({ id: 'unknown_dye', rgb: [] }).rgb).toEqual([]);
});

test('eye colour patches use iris on v2 and eyeColor on v1', () => {
  expect(eyeColorPatch('blue', 'cf2')).toEqual({ iris: 'blue' });
  expect(eyeColorPatch('blue', 'cf1')).toEqual({ eyeColor: 'blue' });
});

test('v2 options need painted swatches, and hair and iris edits change the look', async () => {
  installHeadlessShims();
  const vendor = path.resolve('public', characterForgeV2Paths().base);
  const restoreFetch = installFetch(vendor, 'cf-swatch/', []);
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'location');
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    writable: true,
    value: { search: '', href: 'http://trailbound.test/' },
  });
  try {
    const ready = await initForge({
      force: true,
      enabled: true,
      runtimeUrl: pathToFileURL(path.join(vendor, 'cf-runtime.mjs')).href,
      baseUrl: 'http://cf-swatch/',
      platform: {
        ...installHeadlessShims(),
        fetch: (input, init) => globalThis.fetch(input, init),
      },
    });
    expect(ready.ok, ready.reason).toBe(true);
    expect(characterEngine()).toBe('cf2');

    const options = optionsFor('human', 'm', 'adult');
    expect(options.hairColors.every((item) => item.rgb.length === 0)).toBe(true);
    expect(options.iris.every((item) => item.rgb.length === 0)).toBe(true);
    const hair = options.hairColors.map(paintCreatorSwatch);
    const iris = options.iris.map(paintCreatorSwatch);
    expect(hair.length).toBeGreaterThan(8);
    expect(iris.length).toBeGreaterThan(8);
    expect(hair.every((item) => item.rgb.some((channel) => channel > 0))).toBe(true);
    expect(iris.every((item) => item.rgb.some((channel) => channel > 0))).toBe(true);

    const recipe = generateRecipe({
      seed: 11,
      profileEntry: { ages: { adult: 1 } },
      race: 'human',
      gender: 'm',
    });
    const before = describeRecipe(recipe);
    const nextHair = options.hairColors.find((item) => item.id !== before.hairColor)?.id;
    const nextIris = options.iris.find((item) => item.id !== before.eyeColor)?.id;
    expect(nextHair && nextIris).toBeTruthy();

    const ignored = checkRecipeEdit(recipe, { eyeColor: nextIris });
    expect(ignored.ok, ignored.errors.map((issue) => issue.msg).join('; ')).toBe(true);
    if (ignored.recipe) {
      expect(describeRecipe(ignored.recipe).eyeColor).toBe(before.eyeColor);
    }

    const eyes = editRecipe(recipe, eyeColorPatch(nextIris!, 'cf2'));
    expect(recipeHashOf(eyes)).not.toBe(recipeHashOf(recipe));
    expect(describeRecipe(eyes).eyeColor).toBe(nextIris);

    const hairEdit = editRecipe(eyes, { hairColor: nextHair });
    expect(describeRecipe(hairEdit).hairColor).toBe(nextHair);
    expect(describeRecipe(hairEdit).eyeColor).toBe(nextIris);
  } finally {
    restoreFetch();
    if (previous) Object.defineProperty(globalThis, 'location', previous);
    else Reflect.deleteProperty(globalThis, 'location');
  }
}, 180_000);

function installHeadlessShims(): {
  createCanvas: () => unknown;
  createImageBitmap: (blob: Blob) => Promise<unknown>;
  document: { createElement(tag: string): unknown };
} {
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
        fillRect() {},
        clearRect() {},
        drawImage() {},
        getImageData(_x: number, _y: number, w = 1, h = 1) {
          return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h };
        },
        putImageData() {},
        createImageData(w = 1, h = 1) {
          return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h };
        },
        createPattern() {
          return {};
        },
        measureText() {
          return { width: 0 };
        },
        fillText() {},
        save() {},
        restore() {},
        translate() {},
        scale() {},
        beginPath() {},
        rect() {},
        clip() {},
        setTransform() {},
        resetTransform() {},
      };
    }
  }
  return {
    createCanvas: () => new CanvasShim(32, 32),
    createImageBitmap: async () => ({
      width: 8,
      height: 8,
      close() {},
    }),
    document: {
      createElement(tag: string) {
        if (tag !== 'canvas') throw new Error(`createElement ${tag}`);
        return new CanvasShim(32, 32);
      },
    },
  };
}

function installFetch(root: string, marker: string, seen: string[]): () => void {
  const original = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    seen.push(url);
    const at = url.indexOf(marker);
    if (at < 0) return original(input, init);
    const rel = decodeURIComponent(url.slice(at + marker.length).split('?')[0] ?? '');
    const file = path.resolve(root, rel);
    if (file !== root && !file.startsWith(`${root}${path.sep}`)) {
      throw new Error(`forge test fetch escaped: ${rel}`);
    }
    const data = await readFile(file);
    return new Response(data);
  };
  return () => {
    globalThis.fetch = original;
  };
}
