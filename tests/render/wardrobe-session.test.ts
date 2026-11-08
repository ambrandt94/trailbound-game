import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { h, render } from 'preact';
import { beforeAll, expect, test, vi } from 'vitest';
import { manifestFor } from '../../src/platform/storage/slot';
import { createMemorySettings } from '../../src/platform/settings';
import { createFetchContentSource } from '../../src/platform/content-source';
import type { PackedWorld, SaveManifest } from '../../src/core/save/types';
import { characterForgePaths } from '../../src/render/characters/cf-pin';
import { MapRenderer } from '../../src/render/map/map-renderer';
import { describeRecipe, recipeFromStored, recipeHashOf } from '../../src/render/characters/forge';
import {
  creatorBusy,
  creatorCommands,
  creatorView,
  emptyCreatorView,
} from '../../src/ui/creator-state';
import { skinText } from '../../src/ui/glyphs';
import { commands, screen } from '../../src/ui/state';
import { WardrobeScreen } from '../../src/ui/wardrobe';
import { Game } from '../../src/app/game';
import type { SaveBackend } from '../../src/core/save/types';

const vendor = path.resolve('public', characterForgePaths().base);

vi.mock('../../src/render/characters/forge', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/render/characters/forge')>();
  return {
    ...actual,
    initForge(options: Parameters<typeof actual.initForge>[0] = {}) {
      return actual.initForge({
        ...options,
        runtimeUrl: options.runtimeUrl ?? pathToFileURL(path.join(vendor, 'cf-runtime.mjs')).href,
        baseUrl: options.baseUrl ?? 'http://cf-test/',
      });
    },
  };
});

beforeAll(() => {
  installCanvasShim();
  installBitmapShim();
  installFetch();
  MapRenderer.prototype.load = () => Promise.resolve();
  MapRenderer.prototype.setSkin = () => Promise.resolve();
  MapRenderer.prototype.draw = () => undefined;
});

test('the paperdoll renders forge warnings beside errors', () => {
  const host = document.createElement('div');
  const view = emptyCreatorView();
  view.warnings = ['hair colour clashed with the new skin'];
  view.errors = ['Forge refused that state'];
  render(h(WardrobeScreen, { view, busy: false, confirmLabel: 'Save avatar' }), host);
  expect(host.textContent).toContain(skinText(view.warnings[0] ?? ''));
  expect(host.textContent).toContain(view.errors[0]);
  render(null, host);
});

test('schema 3 edit migrates without inventing a recipe or saving, and warnings reach the paperdoll', async () => {
  const saves = memorySaves();
  saves.seed('slot-1', legacyManifest(), legacyCore());
  const game = startGame(saves.api);
  try {
    await game.start();
    commands.editAvatar();
    await waitFor(
      () => creatorView.value.paperdoll && /^[0-9a-f]{16}$/.test(creatorView.value.hash),
    );
    expect(game.world.avatar.recipe).toBeUndefined();
    expect(game.world.avatar.recipeHash).toBe('');
    expect(game.world.avatar.name).toBe('Mara');
    expect(saves.writes).toBe(0);
    const manifest = await saves.api.readManifest('slot-1');
    expect(manifest?.schema).toBe(3);
    expect(manifest?.player.avatar).toBeUndefined();

    creatorCommands.setStubble(0.1);
    expect(creatorView.value.warnings.length).toBeGreaterThan(0);
    const host = document.createElement('div');
    render(
      h(WardrobeScreen, {
        view: creatorView.value,
        busy: false,
        confirmLabel: 'Save avatar',
      }),
      host,
    );
    expect(host.textContent).toContain(skinText(creatorView.value.warnings[0] ?? ''));
    render(null, host);

    creatorCommands.cancel();
    await waitFor(() => screen.value === 'title');
    expect(saves.writes).toBe(0);
    expect((await saves.api.readManifest('slot-1'))?.schema).toBe(3);
    expect((await saves.api.readCore('slot-1'))?.player.avatar).toBeUndefined();
  } finally {
    game.stop();
  }
}, 120_000);

test('cancel writes nothing, undo restores exact hashes, focus does not, and confirm reloads the opaque recipe', async () => {
  const saves = memorySaves();
  const game = startGame(saves.api);
  try {
    await game.start();
    commands.newGame();
    await waitFor(
      () => screen.value === 'creator' && /^[0-9a-f]{16}$/.test(creatorView.value.hash),
    );
    expect(creatorView.value.paperdoll).toBe(false);
    const rolled = creatorView.value.hash;
    expect(creatorView.value.regionsReady).toBe(true);
    creatorCommands.setFocus('upper');
    const upperSlots = [...creatorView.value.slots];
    expect(creatorView.value.hash).toBe(rolled);
    expect(upperSlots).toContain('chest');
    expect(upperSlots).not.toContain('feet');
    creatorCommands.setFocus('lower');
    const lowerSlots = [...creatorView.value.slots];
    expect(creatorView.value.hash).toBe(rolled);
    expect(lowerSlots).toContain('feet');
    expect(lowerSlots).not.toContain('chest');
    expect(new Set([...upperSlots, ...lowerSlots]).size).toBe(
      upperSlots.length + lowerSlots.length,
    );
    creatorCommands.setFocus('full');
    expect(creatorView.value.hash).toBe(rolled);
    expect(creatorView.value.focus).toBe('full');
    expect(creatorView.value.slots).toHaveLength(upperSlots.length + lowerSlots.length);

    creatorCommands.openPaperdoll();
    const hashes = [creatorView.value.hash];
    const changed = (run: () => void) => {
      const before = hashes[hashes.length - 1] ?? '';
      run();
      expect(creatorView.value.errors, creatorView.value.errors.join('; ')).toEqual([]);
      expect(creatorView.value.hash).not.toBe(before);
      hashes.push(creatorView.value.hash);
    };
    creatorCommands.setSlot('chest');
    if (creatorView.value.garment === 'tunic') {
      const other = creatorView.value.garments.find((id) => id !== 'tunic');
      expect(other).toBeTruthy();
      changed(() => creatorCommands.setGarment(other ?? ''));
    }
    changed(() => creatorCommands.setGarment('tunic'));
    expect(creatorView.value.worn.chest).toBe('tunic');
    expect(creatorView.value.worn.torso_mid).toBe('tunic');

    creatorCommands.setSlot('head_inner');
    expect(creatorView.value.garments).toContain('bandana');
    changed(() => creatorCommands.setGarment('bandana'));
    const wear = creatorView.value.states.find((state) => state.name === 'wear');
    expect(wear?.options).toEqual(expect.arrayContaining(['head', 'neck']));
    const destination = wear?.value === 'neck' ? 'head' : 'neck';
    changed(() => creatorCommands.setGarmentState('wear', destination));
    if (destination === 'neck') {
      expect(creatorView.value.worn.neck_wrap).toBe('bandana');
      expect(creatorView.value.worn.head_inner).not.toBe('bandana');
      expect(creatorView.value.slot).toBe('neck_wrap');
    } else {
      expect(creatorView.value.worn.head_inner).toBe('bandana');
      expect(creatorView.value.worn.neck_wrap).not.toBe('bandana');
    }
    const edited = creatorView.value.hash;
    creatorCommands.setFocus('lower');
    expect(creatorView.value.hash).toBe(edited);

    for (let index = hashes.length - 2; index >= 0; index -= 1) {
      creatorCommands.undo();
      expect(creatorView.value.hash).toBe(hashes[index]);
    }
    expect(creatorView.value.canUndo).toBe(false);
    for (let index = 1; index < hashes.length; index += 1) {
      creatorCommands.redo();
      expect(creatorView.value.hash).toBe(hashes[index]);
    }
    expect(creatorView.value.hash).toBe(edited);
    expect(creatorView.value.worn.chest).toBe('tunic');
    expect(creatorView.value.worn.torso_mid).toBe('tunic');

    const wornBeforeUnequip = creatorView.value.hash;
    creatorCommands.setSlot('chest');
    creatorCommands.setGarment('');
    expect(creatorView.value.errors).toEqual([]);
    expect(creatorView.value.worn.chest).toBeFalsy();
    expect(creatorView.value.worn.torso_mid).toBeFalsy();
    creatorCommands.undo();
    expect(creatorView.value.hash).toBe(wornBeforeUnequip);
    expect(creatorView.value.worn.chest).toBe('tunic');
    expect(creatorView.value.worn.torso_mid).toBe('tunic');

    creatorCommands.setFocus('upper');
    expect(creatorView.value.hash).toBe(wornBeforeUnequip);
    expect(creatorView.value.slots).toContain('torso_mid');
    creatorCommands.setSlot('torso_mid');
    expect(creatorView.value.slot).toBe('torso_mid');
    creatorCommands.setGarment('');
    expect(creatorView.value.errors, creatorView.value.errors.join('; ')).toEqual([]);
    expect(creatorView.value.worn.chest).toBeFalsy();
    expect(creatorView.value.worn.torso_mid).toBeFalsy();
    creatorCommands.undo();
    expect(creatorView.value.hash).toBe(wornBeforeUnequip);
    expect(creatorView.value.worn.chest).toBe('tunic');
    expect(creatorView.value.worn.torso_mid).toBe('tunic');
    creatorCommands.setFocus('full');

    creatorCommands.setSlot('chest');
    const alternate = creatorView.value.garments.find(
      (id) => id !== 'tunic' && id !== creatorView.value.garment,
    );
    expect(alternate).toBeTruthy();
    creatorCommands.setGarment(alternate ?? '');
    const firstLook = creatorView.value.hash;
    creatorCommands.setGarment('tunic');
    const latestLook = creatorView.value.hash;
    expect(latestLook).not.toBe(firstLook);
    await waitFor(() => creatorBusy.value === false);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(creatorView.value.hash).toBe(latestLook);
    expect(creatorView.value.worn.chest).toBe('tunic');
    expect(creatorView.value.worn.torso_mid).toBe('tunic');

    creatorCommands.cancel();
    await waitFor(() => screen.value === 'title');
    expect(saves.writes).toBe(0);
    expect(await saves.api.readCore('slot-1')).toBeNull();
    expect(game.world.avatar.recipe).toBeUndefined();
    expect(game.world.avatar.recipeHash).toBe('');

    const stale = creatorView.value.hash;
    commands.editAvatar();
    await waitFor(
      () =>
        creatorView.value.paperdoll &&
        creatorView.value.hash !== stale &&
        /^[0-9a-f]{16}$/.test(creatorView.value.hash),
    );
    creatorCommands.setSlot('chest');
    if (creatorView.value.garment === 'tunic') {
      creatorCommands.setGarment(creatorView.value.garments.find((id) => id !== 'tunic') ?? '');
    }
    creatorCommands.setGarment('tunic');
    creatorCommands.setSlot('feet');
    expect(creatorView.value.garments, creatorView.value.garments.join(',')).toContain(
      'riding_boots',
    );
    creatorCommands.setGarment('riding_boots');
    expect(creatorView.value.errors, creatorView.value.errors.join('; ')).toEqual([]);
    const savedHash = creatorView.value.hash;
    expect(savedHash).toMatch(/^[0-9a-f]{16}$/);
    expect(savedHash.startsWith('ph:')).toBe(false);
    expect(creatorView.value.worn.feet).toBe('riding_boots');
    expect(creatorView.value.worn.shins).toBe('riding_boots');

    creatorCommands.setFocus('lower');
    expect(creatorView.value.hash).toBe(savedHash);
    expect(creatorView.value.slots).toContain('feet');
    creatorCommands.setSlot('feet');
    expect(creatorView.value.slot).toBe('feet');
    creatorCommands.setGarment('');
    expect(creatorView.value.errors, creatorView.value.errors.join('; ')).toEqual([]);
    expect(creatorView.value.worn.feet).toBeFalsy();
    expect(creatorView.value.worn.shins).toBeFalsy();
    creatorCommands.undo();
    expect(creatorView.value.hash).toBe(savedHash);
    expect(creatorView.value.worn.feet).toBe('riding_boots');
    expect(creatorView.value.worn.shins).toBe('riding_boots');
    creatorCommands.setFocus('full');

    creatorCommands.confirm();
    await waitFor(() => saves.writes === 1 && screen.value === 'title');
    const stored = await saves.api.readCore('slot-1');
    const recipe = stored?.player.avatar?.recipe;
    expect(recipe).toBeTruthy();
    expect(stored?.player.avatar?.recipeHash).toBe(savedHash);
    const loaded = recipeFromStored(recipe, stored?.player.avatar?.seed ?? 0);
    expect(recipeHashOf(loaded)).toBe(savedHash);
    const look = describeRecipe(loaded);
    expect(look.outfit.chest?.id).toBe('tunic');
    expect(look.outfit.torso_mid?.id).toBe('tunic');
    expect(look.outfit.feet?.id).toBe('riding_boots');
    expect(look.outfit.shins?.id).toBe('riding_boots');
  } finally {
    game.stop();
  }

  const reloaded = startGame(saves.api);
  try {
    await reloaded.start();
    commands.continueGame();
    await waitFor(() => reloaded.world.avatar.recipeHash.length === 16);
    const core = await saves.api.readCore('slot-1');
    expect(reloaded.world.avatar.recipeHash).toBe(core?.player.avatar?.recipeHash);
    expect(reloaded.world.avatar.recipe).toEqual(core?.player.avatar?.recipe);
    const again = recipeFromStored(reloaded.world.avatar.recipe, reloaded.world.avatar.seed);
    expect(recipeHashOf(again)).toBe(reloaded.world.avatar.recipeHash);
    expect(describeRecipe(again).outfit.feet?.id).toBe('riding_boots');
    expect(describeRecipe(again).outfit.chest?.id).toBe('tunic');
  } finally {
    reloaded.stop();
  }
}, 180_000);

function startGame(saves: SaveBackend): Game {
  const root = document.createElement('div');
  const mapCanvas = document.createElement('canvas');
  const areaCanvas = document.createElement('canvas');
  const fade = document.createElement('div');
  document.body.append(root, mapCanvas, areaCanvas, fade);
  return new Game({
    clock: { now: () => 0 },
    root,
    mapCanvas,
    areaCanvas,
    fade,
    baseUrl: './',
    content: createFetchContentSource('./', globalThis.fetch.bind(globalThis)),
    saves,
    settings: createMemorySettings(),
  });
}

function memorySaves(): {
  api: SaveBackend;
  writes: number;
  seed(slot: string, manifest: SaveManifest, core: PackedWorld): void;
} {
  let writes = 0;
  const manifests = new Map<string, SaveManifest>();
  const cores = new Map<string, PackedWorld>();
  const api: SaveBackend = {
    async listSlots() {
      return [...manifests.entries()].map(([slot, manifest]) => ({ slot, manifest }));
    },
    async readManifest(slot) {
      return manifests.get(slot) ?? null;
    },
    async readCore(slot) {
      return cores.get(slot) ?? null;
    },
    async readDetail() {
      return null;
    },
    async write(slot, patch) {
      if (!patch.core) throw new Error('core required');
      writes += 1;
      cores.set(slot, patch.core);
      manifests.set(slot, manifestFor(patch.core, '2026-11-08T00:00:00.000Z'));
    },
    async deleteSlot(slot) {
      manifests.delete(slot);
      cores.delete(slot);
    },
  };
  return {
    api,
    get writes() {
      return writes;
    },
    seed(slot, manifest, core) {
      manifests.set(slot, manifest);
      cores.set(slot, core);
    },
  };
}

function legacyCore(): PackedWorld {
  return {
    clockHours: 9,
    worldSeed: 7741,
    player: { name: 'Mara', mapX: 3, mapY: 4, yaw: 0.5 },
    gameVersion: '0.0.0',
    cfPin: { version: '1.2.0', generatorVersion: '1' },
  };
}

function legacyManifest(): SaveManifest {
  return {
    schema: 3,
    gameVersion: '0.0.0',
    worldSeed: 7741,
    clockHours: 9,
    player: { name: 'Mara', mapX: 3, mapY: 4, yaw: 0.5 },
    cfPin: { version: '1.2.0', generatorVersion: '1' },
    savedAt: '2026-11-07T00:00:00.000Z',
  };
}

async function waitFor(ready: () => boolean, ms = 90_000): Promise<void> {
  const start = Date.now();
  while (!ready()) {
    if (Date.now() - start > ms) {
      const view = creatorView.value;
      throw new Error(
        `timed out screen=${screen.value} paperdoll=${String(view.paperdoll)} hash=${view.hash} errors=${view.errors.join('; ')} note=${view.note} slot=${view.slot}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function installFetch(): void {
  const original = globalThis.fetch.bind(globalThis);
  const contentRoot = path.resolve('content');
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const forgeAt = url.indexOf('cf-test/');
    if (forgeAt >= 0) {
      const rel = decodeURIComponent(url.slice(forgeAt + 'cf-test/'.length).split('?')[0] ?? '');
      const file = path.resolve(vendor, rel);
      if (file !== vendor && !file.startsWith(`${vendor}${path.sep}`)) {
        throw new Error(`forge test fetch escaped: ${rel}`);
      }
      return new Response(await readFile(file));
    }
    const contentAt = url.indexOf('content/');
    if (contentAt >= 0) {
      const rel = decodeURIComponent(url.slice(contentAt + 'content/'.length).split('?')[0] ?? '');
      const file = path.resolve(contentRoot, rel);
      if (file !== contentRoot && !file.startsWith(`${contentRoot}${path.sep}`)) {
        throw new Error(`content fetch escaped: ${rel}`);
      }
      return new Response(await readFile(file), {
        headers: { 'content-type': 'application/json' },
      });
    }
    return original(input, init);
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
  const context = (canvas: object) => ({
    canvas,
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
    measureText() {
      return { width: 0 };
    },
    save() {
      return;
    },
    restore() {
      return;
    },
    beginPath() {
      return;
    },
    fill() {
      return;
    },
    stroke() {
      return;
    },
  });
  class CanvasShim {
    width: number;
    height: number;
    constructor(width = 1, height = 1) {
      this.width = width;
      this.height = height;
    }
    getContext(): unknown {
      return context(this);
    }
  }
  Object.assign(globalThis, { OffscreenCanvas: CanvasShim });
  const proto = globalThis.HTMLCanvasElement?.prototype;
  if (!proto) return;
  const previous = proto.getContext;
  proto.getContext = function getContext(this: HTMLCanvasElement, kind: string) {
    if (kind === '2d') return context(this);
    try {
      return previous?.call(this, kind);
    } catch {
      return null;
    }
  } as typeof proto.getContext;
}
