import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  MeshPhongMaterial,
  NearestFilter,
  Texture,
  Vector3,
  type Mesh,
  type Object3D,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { expect, test } from 'vitest';
import {
  HITCH_SOCKET,
  PACK_OX_PIN,
  YOKE_SOCKET,
  assertDraftCreature,
  creatureFilePath,
  creatureManifestPath,
  parseCreaturePack,
} from '../../src/core/content/creature-pack';
import { createPackOx, prepPixelSkin, sha256Hex } from '../../src/render/area/pack-ox';

function glbBytes(): ArrayBuffer {
  const file = readFileSync(
    join(process.cwd(), 'public', creatureFilePath(PACK_OX_PIN, 'packs/pack_ox.glb')),
  );
  return file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer;
}

test('the pack ox GLB loads, matches the pin, and has Idle, Walk, and PullWalk', async () => {
  const bytes = glbBytes();
  const hash = createHash('sha256').update(Buffer.from(bytes)).digest('hex');
  expect(hash).toBe(PACK_OX_PIN.sha256);
  expect(await sha256Hex(bytes)).toBe(PACK_OX_PIN.sha256);

  const pack = parseCreaturePack(
    JSON.parse(readFileSync(join(process.cwd(), 'public', creatureManifestPath()), 'utf8')),
  );
  const creature = assertDraftCreature(pack);
  const gltf = await new GLTFLoader().parseAsync(bytes, '');
  const names = gltf.animations.map((clip) => clip.name).sort();
  expect(names).toEqual(['Idle', 'PullWalk', 'Walk']);
  for (const clip of gltf.animations) {
    expect(clip.duration).toBeCloseTo(creature.clips[clip.name]?.duration ?? -1, 2);
  }

  let tris = 0;
  gltf.scene.traverse((object) => {
    const mesh = object as Mesh;
    if (!mesh.isMesh) return;
    const position = mesh.geometry.getAttribute('position');
    const count = mesh.geometry.index?.count ?? position?.count ?? 0;
    tris += count / 3;
  });
  expect(tris).toBe(4601);

  gltf.scene.updateMatrixWorld(true);
  for (const [name, parent] of [
    [HITCH_SOCKET, 'Root'],
    [YOKE_SOCKET, 'Chest'],
  ] as const) {
    const socket = gltf.scene.getObjectByName(name);
    expect(socket?.parent?.name).toBe(parent);
    const rest = creature.sockets[name]?.rest;
    const world = socket?.getWorldPosition(new Vector3());
    expect(rest).toBeTruthy();
    expect(world?.x).toBeCloseTo(rest?.x ?? 99, 2);
    expect(world?.y).toBeCloseTo(rest?.y ?? 99, 2);
    expect(world?.z).toBeCloseTo(rest?.z ?? 99, 2);
  }

  const ox = createPackOx(creature, gltf);
  expect(ox.clip()).toBe('Idle');
  const head = ox.root.getObjectByName('Head');
  expect(head).toBeTruthy();
  const before = head?.quaternion.clone();
  ox.present('Walk', 1);
  ox.update(0.45);
  expect(ox.clip()).toBe('Walk');
  expect(head?.quaternion.angleTo(before!)).toBeGreaterThan(0.01);
  ox.present('PullWalk', 1);
  ox.update(0.2);
  expect(ox.clip()).toBe('PullWalk');
  ox.present('Idle', 1);
  ox.update(0.2);
  expect(ox.clip()).toBe('Idle');

  const carrier = firstMesh(ox.root);
  const material = carrier.material;
  const phong = Array.isArray(material) ? material[0] : material;
  expect(phong).toBeInstanceOf(MeshPhongMaterial);
  const injected = new Texture();
  if (phong && 'map' in phong) phong.map = injected;
  prepPixelSkin(ox.root);
  expect(injected.magFilter).toBe(NearestFilter);
  expect(injected.minFilter).toBe(NearestFilter);
  expect(injected.generateMipmaps).toBe(false);
  expect(injected.colorSpace).toBe('srgb');
});

function firstMesh(root: Object3D): Mesh {
  let found: Mesh | null = null;
  root.traverse((object) => {
    const mesh = object as Mesh;
    if (!found && mesh.isMesh) found = mesh;
  });
  if (!found) throw new Error('pack ox has no mesh');
  return found;
}
