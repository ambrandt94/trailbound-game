import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  Box3,
  BoxGeometry,
  Group,
  LinearFilter,
  LinearSRGBColorSpace,
  Mesh,
  MeshLambertMaterial,
  MeshStandardMaterial,
  NearestFilter,
  SRGBColorSpace,
  Texture,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { expect, test } from 'vitest';
import { WAGON_USE_RADIUS_M, wagonBodyAabb } from '../../src/core/world/wagon';
import { mountPartyWagon, prepareWagonModel } from '../../src/render/area/party-wagon';

const wagonFile = join(process.cwd(), 'public/assets/props/party_wagon.glb');

function readGlb(): ArrayBuffer {
  const file = readFileSync(wagonFile);
  return file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer;
}

function glbJson(): {
  nodes: Array<{
    translation?: number[];
    rotation?: number[];
    scale?: number[];
    matrix?: number[];
  }>;
  meshes: { primitives: { indices?: number; material?: number }[] }[];
  accessors: { count: number }[];
  materials: { pbrMetallicRoughness?: { baseColorTexture?: { index: number } } }[];
  images: { bufferView?: number; uri?: string }[];
  samplers: { magFilter?: number; minFilter?: number }[];
} {
  const file = readFileSync(wagonFile);
  const jsonLen = file.readUInt32LE(12);
  return JSON.parse(file.subarray(20, 20 + jsonLen).toString('utf8')) as ReturnType<typeof glbJson>;
}

test('the covered wagon GLB is metres, ground origin, and has no node transforms', async () => {
  const json = glbJson();
  expect(json.nodes.length).toBeGreaterThan(0);
  for (const node of json.nodes) {
    expect(node.translation).toBeUndefined();
    expect(node.rotation).toBeUndefined();
    expect(node.scale).toBeUndefined();
    expect(node.matrix).toBeUndefined();
  }
  let triangles = 0;
  for (const mesh of json.meshes) {
    for (const primitive of mesh.primitives) {
      const index = primitive.indices;
      expect(index).toBeTypeOf('number');
      triangles += (json.accessors[index ?? 0]?.count ?? 0) / 3;
    }
  }
  expect(triangles).toBe(4000);
  expect(json.images.length).toBe(json.materials.length);
  for (const image of json.images) {
    expect(image.bufferView).toBeTypeOf('number');
    expect(image.uri).toBeUndefined();
  }
  for (const sampler of json.samplers) {
    expect(sampler.magFilter).toBe(9728);
    expect(sampler.minFilter).toBe(9728);
  }
  for (const material of json.materials) {
    expect(material.pbrMetallicRoughness?.baseColorTexture?.index).toBeTypeOf('number');
  }

  const gltf = await new GLTFLoader().parseAsync(readGlb(), '');
  const box = new Box3().setFromObject(gltf.scene);
  expect(box.min.x).toBeCloseTo(-0.936, 3);
  expect(box.max.x).toBeCloseTo(0.936, 3);
  expect(box.min.y).toBeCloseTo(0, 3);
  expect(box.max.y).toBeCloseTo(2.691, 2);
  expect(box.min.z).toBeCloseTo(-1.788, 3);
  expect(box.max.z).toBeCloseTo(3.303, 2);
  expect(box.max.z - box.min.z).toBeCloseTo(5.09, 2);

  gltf.scene.traverse((object) => {
    if (object === gltf.scene) return;
    expect(object.position.length()).toBeLessThan(1e-6);
    expect(object.scale.x).toBeCloseTo(1, 5);
    expect(object.scale.y).toBeCloseTo(1, 5);
    expect(object.scale.z).toBeCloseTo(1, 5);
    expect(object.quaternion.w).toBeCloseTo(1, 5);
  });

  prepareWagonModel(gltf.scene);
  let lambertMeshes = 0;
  gltf.scene.traverse((object) => {
    const mesh = object as Mesh;
    if (!mesh.isMesh) return;
    lambertMeshes += 1;
    const material = mesh.material as MeshLambertMaterial;
    expect(material.isMeshLambertMaterial).toBe(true);
    if (!material.map) return;
    expect(material.map.magFilter).toBe(NearestFilter);
    expect(material.map.minFilter).toBe(NearestFilter);
    expect(material.map.generateMipmaps).toBe(false);
    expect(material.map.colorSpace).toBe(SRGBColorSpace);
  });
  expect(lambertMeshes).toBeGreaterThan(0);
  const after = new Box3().setFromObject(gltf.scene);
  expect(after.min.y).toBeCloseTo(0, 3);
  expect(after.max.x - after.min.x).toBeCloseTo(box.max.x - box.min.x, 3);
});

test('native scale is left alone and colour maps stay nearest and sRGB', () => {
  const mesh = new Mesh(new BoxGeometry(10, 2, 8));
  mesh.position.set(0, 1, 0);
  const map = new Texture();
  map.magFilter = LinearFilter;
  map.minFilter = LinearFilter;
  map.generateMipmaps = true;
  map.colorSpace = LinearSRGBColorSpace;
  mesh.material = new MeshStandardMaterial({ map });
  const root = new Group();
  root.add(mesh);
  prepareWagonModel(root);
  expect(root.scale.x).toBe(1);
  expect(root.position.length()).toBe(0);
  expect(root.quaternion.w).toBe(1);
  expect(mesh.scale.x).toBe(1);
  expect(mesh.position.y).toBe(1);
  expect(map.magFilter).toBe(NearestFilter);
  expect(map.minFilter).toBe(NearestFilter);
  expect(map.generateMipmaps).toBe(false);
  expect(map.colorSpace).toBe(SRGBColorSpace);
  expect((mesh.material as MeshLambertMaterial).isMeshLambertMaterial).toBe(true);
});

test('the parked collision box is the body and the use prompt reaches the tongue', async () => {
  const blocks: Array<{ x: number; z: number; w: number; d: number; h?: number }> = [];
  const things: Array<Record<string, unknown>> = [];
  const spot = await mountPartyWagon({
    scene: { add() {} },
    blocks,
    things,
    spawn: { x: 0, z: 0, yaw: 0 },
    groundY: () => 1.5,
    clamp: (x, z) => ({ x, z }),
    groundName: () => 'grass',
    doors: [],
    onOpen: () => {},
  });
  expect(spot).not.toBeNull();
  const body = wagonBodyAabb(spot!);
  expect(blocks[0]?.w).toBeCloseTo(body.w, 5);
  expect(blocks[0]?.d).toBeCloseTo(body.d, 5);
  expect(blocks[0]?.w).toBeCloseTo(1.88, 2);
  expect(blocks[0]?.d).toBeCloseTo(3.59, 2);
  expect(blocks[0]?.h).toBeCloseTo(1.5 + 2.7, 2);
  expect(things[0]?.r).toBe(WAGON_USE_RADIUS_M);
  expect(things[0]?.label).toBe('F: Wagon');
});
