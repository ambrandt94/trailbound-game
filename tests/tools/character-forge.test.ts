import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test } from 'vitest';
import {
  forgeStats,
  generateRecipe,
  initForge,
  packsForRecipe,
  placeholderAvatar,
  recipeHashOf,
  validateGameProfile,
} from '../../src/render/characters/forge';

const vendor = path.resolve('public/vendor/character-forge/1.1.0');
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
