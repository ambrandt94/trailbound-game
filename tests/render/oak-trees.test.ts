import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Mesh, MeshLambertMaterial, Texture, type BufferGeometry } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { expect, test } from 'vitest';
import { bindOakPrimitive, assignOakMaterial } from '../../src/render/area/oak-bind';
import {
  OAK_MORPH_KEYS,
  OAK_MORPH_RANGES,
  OAK_VARIANTS,
  isOakKit,
  oakTrunkRadius,
  pickOakInstance,
} from '../../src/render/area/oak-dress';
import { prepareOakVariant, writeOakMorph } from '../../src/render/area/oak-batch';

const oakDir = join(process.cwd(), 'public/assets/nature/oak');

/** Rest-pose positions. Morph targets extend the bounding box below the ground. */
function restMinY(geometry: BufferGeometry): number {
  const position = geometry.getAttribute('position');
  if (!position) throw new Error('oak geometry has no position');
  let min = Infinity;
  for (let i = 0; i < position.count; i++) min = Math.min(min, position.getY(i));
  return min;
}

function readGlb(id: string): ArrayBuffer {
  const file = readFileSync(join(oakDir, 'variations', `${id}.glb`));
  return file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer;
}

function glbJson(id: string): {
  materials: { name: string }[];
  images: { name?: string }[];
  meshes: { primitives: { material: number }[] }[];
} {
  const file = readFileSync(join(oakDir, 'variations', `${id}.glb`));
  const jsonLen = file.readUInt32LE(12);
  return JSON.parse(file.subarray(20, 20 + jsonLen).toString('utf8')) as {
    materials: { name: string }[];
    images: { name?: string }[];
    meshes: { primitives: { material: number }[] }[];
  };
}

test('seeded oak picker is deterministic and stays in the safe morph range', () => {
  const spot = pickOakInstance(1109, 63.5, 59.5);
  expect(pickOakInstance(1109, 63.5, 59.5)).toEqual(spot);
  expect(pickOakInstance(1109, 63.5, 59.6)).not.toEqual(spot);

  const counts = { base: 0, spreading: 0, upright: 0, windswept: 0, ironbark: 0 };
  for (let i = 0; i < 400; i++) {
    const picked = pickOakInstance(1109, i * 3, 17);
    expect(pickOakInstance(1109, i * 3, 17)).toEqual(picked);
    counts[picked.variant] += 1;
    if (picked.ironbark) counts.ironbark += 1;
    expect(picked.scale).toBeGreaterThanOrEqual(0.85);
    expect(picked.scale).toBeLessThanOrEqual(1.15);
    expect(Math.round(picked.scale * 20) / 20).toBeCloseTo(picked.scale, 5);
    expect(picked.yaw).toBeGreaterThanOrEqual(0);
    expect(picked.yaw).toBeLessThan(Math.PI * 2);
    for (const key of OAK_MORPH_KEYS) {
      const value = picked.morph[key];
      const [min, max] = OAK_MORPH_RANGES[key];
      expect(value).toBeGreaterThanOrEqual(min);
      expect(value).toBeLessThanOrEqual(max);
      expect(Math.round(value * 20) / 20).toBeCloseTo(value, 5);
    }
    expect(Math.abs(picked.morph.trunk_lean)).toBeLessThanOrEqual(0.25);
    expect(oakTrunkRadius(picked.scale)).toBeLessThan(0.8);
  }
  expect(counts.base).toBeGreaterThan(counts.spreading);
  expect(counts.base).toBeGreaterThan(counts.upright);
  expect(counts.base).toBeGreaterThan(counts.windswept);
  expect(counts.ironbark).toBeGreaterThan(10);
  expect(counts.ironbark).toBeLessThan(80);
  expect(oakTrunkRadius(1)).toBeLessThan(1);
  expect(oakTrunkRadius(1)).toBeGreaterThan(0.2);
});

test('temperate broadleaf kits use oaks and other biomes keep their placeholders', () => {
  for (const kit of [
    'tree_oak_s',
    'tree_oak_m',
    'tree_oak_l',
    'tree_birch_m',
    'tree_beech_l',
    'tree_hawthorn_s',
    'tree_fruit_apple_s',
    'tree_maple_m',
  ]) {
    expect(isOakKit(kit)).toBe(true);
  }
  for (const kit of [
    'tree_pine_m',
    'tree_spruce_l',
    'tree_fir_snow_m',
    'tree_juniper_s',
    'tree_yew_m',
    'tree_palm_coconut_m',
    'tree_dead_snag_m',
    'tree_charred_m',
    'tree_willow_m',
    'tree_cypress_swamp_l',
    'tree_shadowoak_l',
    'tree_acacia_s',
    'tree_kapok_l',
    'bush_round_s',
    'rock_boulder_cool_m',
  ]) {
    expect(isOakKit(kit)).toBe(false);
  }
});

test('textures bind by material name, never by the shared OakRoot mesh name', () => {
  const maps = {
    bark: new Texture(),
    foliage: new Texture(),
    ironbark: new Texture(),
  };
  maps.bark.name = 'bark_oak';
  maps.foliage.name = 'foliage_oak';
  maps.ironbark.name = 'bark_oak_dark';

  const trunk = { name: 'OakRoot', material: { name: 'bark', map: null as Texture | null } };
  const crown = { name: 'OakRoot', material: { name: 'foliage', map: null as Texture | null } };
  bindOakPrimitive(trunk, maps, false);
  bindOakPrimitive(crown, maps, false);
  expect(trunk.material.map).toBe(maps.bark);
  expect(crown.material.map).toBe(maps.foliage);

  const namedLikeAMesh = {
    name: 'bark',
    material: { name: 'foliage', map: null as Texture | null },
  };
  bindOakPrimitive(namedLikeAMesh, maps, false);
  expect(namedLikeAMesh.material.map).toBe(maps.foliage);

  const unknown = new MeshLambertMaterial({ name: 'OakRoot' });
  expect(assignOakMaterial(unknown, maps, false)).toBeNull();
  expect(unknown.map).toBeNull();

  const iron = { name: 'OakRoot', material: { name: 'bark', map: null as Texture | null } };
  bindOakPrimitive(iron, maps, true);
  expect(iron.material.map).toBe(maps.ironbark);
});

test('each oak GLB has bark and foliage primitives, ground origin, and per-instance morphs', async () => {
  const loader = new GLTFLoader();
  const pool = {
    bark: new Texture(),
    foliage: new Texture(),
    ironbark: new Texture(),
  };
  pool.bark.name = 'bark_oak';
  pool.foliage.name = 'foliage_oak';
  pool.ironbark.name = 'bark_oak_dark';

  for (const id of OAK_VARIANTS) {
    const json = glbJson(id);
    expect(json.materials.map((material) => material.name).sort()).toEqual(['bark', 'foliage']);
    expect(json.meshes).toHaveLength(1);
    expect(json.meshes[0]?.primitives).toHaveLength(2);
    const imageByMaterial = json.meshes[0]?.primitives.map((primitive) => {
      const material = json.materials[primitive.material];
      return { material: material?.name, image: json.images[primitive.material]?.name };
    });
    expect(imageByMaterial).toEqual([
      { material: 'bark', image: 'bark_oak' },
      { material: 'foliage', image: 'foliage_oak' },
    ]);

    const gltf = await loader.parseAsync(readGlb(id), '');
    const meshes: Mesh[] = [];
    gltf.scene.traverse((object) => {
      if ((object as Mesh).isMesh) meshes.push(object as Mesh);
    });
    expect(meshes).toHaveLength(2);
    const names = meshes.map((mesh) => (mesh.material as MeshLambertMaterial).name).sort();
    expect(names).toEqual(['bark', 'foliage']);
    for (const mesh of meshes)
      expect(mesh.name === 'OakRoot' || mesh.parent?.name === 'OakRoot').toBe(true);

    const prepared = prepareOakVariant(gltf.scene, pool);
    expect(prepared.bark.material.name).toBe('bark');
    expect(prepared.foliage.material.name).toBe('foliage');
    expect(prepared.bark.material.map).toBe(pool.bark);
    expect(prepared.foliage.material.map).toBe(pool.foliage);
    expect(prepared.ironbark.material.name).toBe('bark');
    expect(prepared.ironbark.material.map).toBe(pool.ironbark);
    expect(prepared.ironbark.material).not.toBe(prepared.bark.material);

    const barkMinY = restMinY(prepared.bark.geometry);
    const sceneMinY = meshes.reduce(
      (min, mesh) => Math.min(min, restMinY(mesh.geometry)),
      Infinity,
    );
    expect(barkMinY).toBeCloseTo(0, 2);
    expect(sceneMinY).toBeCloseTo(0, 2);

    const dictionary = prepared.bark.morphTargetDictionary;
    expect(dictionary.crown_spread).toBeTypeOf('number');
    expect(dictionary.trunk_lean).toBeTypeOf('number');
    const influences = OAK_MORPH_KEYS.map(() => 0);
    influences[dictionary.trunk_lean ?? 0] = 0.2;
    writeOakMorph(prepared.bark.instanced, 0, influences);
    const data = prepared.bark.instanced.morphTexture?.source.data.data as Float32Array;
    expect(data[1 + (dictionary.trunk_lean ?? 0)]).toBeCloseTo(0.2);
    expect(prepared.bark.geometry.morphAttributes.position).toHaveLength(4);
  }
});
