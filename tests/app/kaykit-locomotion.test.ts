import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test } from 'vitest';
import { applyKaykitLocomotion, loadKaykitLocomotion } from '../../src/render/kaykit-locomotion';
import { createV2Backend } from '../../src/render/characters/backends/v2';
import { characterForgeV2Paths } from '../../src/render/characters/cf-pin';
import type { BuiltCharacter } from '../../src/render/characters/backends/types';
import type { Object3D, SkinnedMesh } from 'three';

const vendor = path.resolve('public', characterForgeV2Paths().base);
const kaykitFile = pathToFileURL(path.join(vendor, 'assets/packs/kaykit_anims.glb')).href;

test('KayKit idle leaves the bind T-pose, and walk swings the legs', async () => {
  const restore = installFileFetch();
  try {
    const pack = await loadKaykitLocomotion(kaykitFile);
    expect(pack, 'kaykit pack failed to load').not.toBeNull();
    expect(maxTrackSwing(pack!.idle, 'Shin_L.quaternion')).toBeGreaterThan(5);
    expect(maxTrackSwing(pack!.walk, 'Thigh_L.quaternion')).toBeGreaterThan(40);
    expect(maxTrackSwing(pack!.walk, 'UpperArm_L.quaternion')).toBeGreaterThan(40);
  } finally {
    restore();
  }
});

test('a v2 body with KayKit clips leaves the bind pose on idle and walk', async () => {
  installHeadlessShims();
  const restoreFetch = installFetch(vendor, 'cf-anim/', []);
  const backend = createV2Backend();
  try {
    await backend.init({
      runtimeUrl: pathToFileURL(path.join(vendor, 'cf-runtime.mjs')).href,
      baseUrl: 'http://cf-anim/',
      platform: {
        ...installHeadlessShims(),
        fetch: (input, init) => globalThis.fetch(input, init),
      },
    });
    const recipe = backend.generate({
      seed: 11,
      profileEntry: { ages: { adult: 1 } },
      race: 'human',
      gender: 'm',
    });
    const built = await backend.build(recipe, { budgetMs: 50 });

    const beforeIdle = maxBoneSwing(built, 'Idle', 2.1);
    // CF-authored idle only nods the head and chest by about 2°.
    expect(beforeIdle['UpperArm_L'] ?? 0).toBeLessThan(5);
    expect(beforeIdle['Thigh_L'] ?? 0).toBeLessThan(5);

    await applyKaykitLocomotion(built, kaykitFile);
    const idle = maxBoneSwing(built, 'Idle', 1.2);
    expect(
      Math.max(idle['Shin_L'] ?? 0, idle['LowerArm_L'] ?? 0, idle['Thigh_L'] ?? 0),
      `idle stayed at bind: ${JSON.stringify(idle)}`,
    ).toBeGreaterThan(5);

    const walk = maxBoneSwing(built, 'Walk', 1.2);
    expect(walk['Thigh_L'] ?? 0, `walk thigh at bind: ${JSON.stringify(walk)}`).toBeGreaterThan(40);
    expect(walk['UpperArm_L'] ?? 0, `walk arm at bind: ${JSON.stringify(walk)}`).toBeGreaterThan(
      40,
    );
  } finally {
    backend.dispose();
    restoreFetch();
  }
}, 180_000);

function maxTrackSwing(
  clip: { tracks: Array<{ name: string; values: ArrayLike<number> }> },
  name: string,
): number {
  const track = clip.tracks.find((item) => item.name === name);
  if (!track) return 0;
  const values = track.values;
  const first = [values[0] ?? 0, values[1] ?? 0, values[2] ?? 0, values[3] ?? 1];
  let max = 0;
  for (let i = 0; i + 3 < values.length; i += 4) {
    max = Math.max(
      max,
      quatDegrees(first, [
        values[i] ?? 0,
        values[i + 1] ?? 0,
        values[i + 2] ?? 0,
        values[i + 3] ?? 1,
      ]),
    );
  }
  return max;
}

function maxBoneSwing(
  built: BuiltCharacter,
  clip: 'Idle' | 'Walk',
  seconds: number,
): Record<string, number> {
  const mesh = firstSkinned(built.object3D);
  const bones = mesh?.skeleton?.bones ?? [];
  const rest = Object.fromEntries(bones.map((bone) => [bone.name, bone.quaternion.clone()]));
  built.mixer.stopAllAction();
  built.play(clip);
  const swings: Record<string, number> = {};
  const step = 1 / 30;
  for (let time = 0; time < seconds; time += step) {
    built.mixer.update(step);
    for (const bone of bones) {
      const start = rest[bone.name];
      if (!start) continue;
      const deg = quatDegrees(
        [start.x, start.y, start.z, start.w],
        [bone.quaternion.x, bone.quaternion.y, bone.quaternion.z, bone.quaternion.w],
      );
      swings[bone.name] = Math.max(swings[bone.name] ?? 0, deg);
    }
  }
  return swings;
}

function firstSkinned(root: Object3D): SkinnedMesh | null {
  let found: SkinnedMesh | null = null;
  root.traverse((node) => {
    const mesh = node as SkinnedMesh;
    if (!found && mesh.isSkinnedMesh) found = mesh;
  });
  return found;
}

function quatDegrees(a: number[], b: number[]): number {
  const dot = Math.min(1, Math.abs(a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]! + a[3]! * b[3]!));
  return (2 * Math.acos(dot) * 180) / Math.PI;
}

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

function installFileFetch(): () => void {
  const original = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.startsWith('file:')) {
      const data = await readFile(new URL(url));
      return new Response(data);
    }
    return original(input, init);
  };
  return () => {
    globalThis.fetch = original;
  };
}

function installFetch(root: string, marker: string, seen: string[]): () => void {
  const original = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    seen.push(url);
    if (url.startsWith('file:')) {
      const data = await readFile(new URL(url));
      return new Response(data);
    }
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
