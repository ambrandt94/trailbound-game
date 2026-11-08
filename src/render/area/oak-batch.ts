import {
  Group,
  InstancedMesh,
  Mesh,
  MeshLambertMaterial,
  NearestFilter,
  Object3D,
  SRGBColorSpace,
  Texture,
  TextureLoader,
  type BufferGeometry,
  type Material,
  type Object3D as Object3DType,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { bindOakPrimitive, type OakMaps } from './oak-bind';
import {
  OAK_MORPH_KEYS,
  OAK_TRUNK_RADIUS_M,
  OAK_VARIANTS,
  isOakKit,
  selectOaks,
  type KeptOak,
  type OakInstance,
  type OakVariantId,
} from './oak-dress';

export interface OakScatterItem {
  kit: string;
  x: number;
  z: number;
  /** Cell or area biome. Plains and Meadow use the open grove spacing. */
  biome?: string | number;
}

export interface OakDebugInstance extends OakInstance {
  x: number;
  y: number;
  z: number;
  kit: string;
}

export interface OakPreparedPart {
  material: MeshLambertMaterial;
  geometry: BufferGeometry;
  morphTargetDictionary: Record<string, number>;
  instanced: InstancedMesh;
}

export interface OakPrepared {
  bark: OakPreparedPart;
  foliage: OakPreparedPart;
  ironbark: { material: MeshLambertMaterial };
}

const morphSource = new Mesh();
const dummy = new Object3D();

let library: Record<OakVariantId, OakPrepared> | null = null;
let loading: Promise<void> | null = null;
let loadMs = 0;
let areaSeed = 1;
let areaBiome = '';
let keptOaks: KeptOak[] = [];
let lastInstances: OakDebugInstance[] = [];

export function useOakSeed(seed: number): void {
  areaSeed = Number.isFinite(seed) ? seed : 1;
  keptOaks = [];
  lastInstances = [];
}

export function useOakBiome(biome: string): void {
  areaBiome = biome || '';
}

export function oakLoadMs(): number {
  return loadMs;
}

export function oakInstances(): readonly OakDebugInstance[] {
  return lastInstances;
}

export function acceptsOak(kit: string): boolean {
  return library !== null && isOakKit(kit);
}

export function oakReady(): Promise<void> {
  if (!loading) {
    const started = now();
    loading = loadLibrary()
      .then((next) => {
        library = next;
        loadMs = now() - started;
      })
      .catch((error: unknown) => {
        loadMs = now() - started;
        console.warn('tb oaks', error);
      });
  }
  return loading;
}

/** Start the GLB fetch during boot so area entry does not wait on a cold cache. */
export function bootOaks(): void {
  void oakReady();
}

export function writeOakMorph(
  mesh: InstancedMesh,
  index: number,
  influences: readonly number[],
): void {
  morphSource.morphTargetInfluences = influences.slice();
  mesh.setMorphAt(index, morphSource);
  if (mesh.morphTexture) mesh.morphTexture.needsUpdate = true;
}

/**
 * Two primitives, split by material name. Embedded bark and foliage maps are
 * reapplied through that name; ironbark is the wood-pool alternate.
 */
export function prepareOakVariant(root: Object3DType, maps: OakMaps<Texture>): OakPrepared {
  const meshes = collectMeshes(root);
  if (meshes.length !== 2) throw new Error(`oak has ${meshes.length} primitives, expected 2`);
  const barkMesh = meshes.find((mesh) => materialName(mesh) === 'bark');
  const foliageMesh = meshes.find((mesh) => materialName(mesh) === 'foliage');
  if (!barkMesh || !foliageMesh)
    throw new Error('oak primitives must use materials bark and foliage');

  const barkMat = toLambert(barkMesh.material);
  const foliageMat = toLambert(foliageMesh.material);
  bindOakPrimitive({ name: barkMesh.name, material: barkMat }, maps, false);
  bindOakPrimitive({ name: foliageMesh.name, material: foliageMat }, maps, false);
  crisp(barkMat.map);
  crisp(foliageMat.map);
  barkMesh.material = barkMat;
  foliageMesh.material = foliageMat;

  const ironMat = barkMat.clone();
  ironMat.name = 'bark';
  ironMat.toneMapped = false;
  ironMat.userData.tbKeep = 1;
  bindOakPrimitive({ name: barkMesh.name, material: ironMat }, maps, true);
  crisp(ironMat.map);

  barkMesh.geometry.userData.tbKeep = 1;
  foliageMesh.geometry.userData.tbKeep = 1;

  return {
    bark: asPart(barkMesh.geometry, barkMat, barkMesh.morphTargetDictionary),
    foliage: asPart(foliageMesh.geometry, foliageMat, foliageMesh.morphTargetDictionary),
    ironbark: { material: ironMat },
  };
}

export function scatterOaks(
  group: Group,
  items: readonly OakScatterItem[],
  groundY?: (x: number, z: number) => number,
): void {
  if (!library || items.length === 0) return;
  const chosen = selectOaks(
    items.map((item) => ({
      x: item.x,
      z: item.z,
      kit: item.kit,
      biome: item.biome ?? areaBiome,
    })),
    areaSeed,
    keptOaks,
  );
  keptOaks = keptOaks.concat(chosen);
  const buckets = new Map<string, OakDebugInstance[]>();
  const placed: OakDebugInstance[] = [];
  for (const oak of chosen) {
    const y = groundY ? groundY(oak.x, oak.z) || 0 : 0;
    const record: OakDebugInstance = { ...oak.instance, x: oak.x, y, z: oak.z, kit: oak.kit };
    placed.push(record);
    const part = oak.instance.ironbark ? 'ironbark' : 'bark';
    pushBucket(buckets, `${oak.instance.variant}:${part}`, record);
    pushBucket(buckets, `${oak.instance.variant}:foliage`, record);
  }
  lastInstances = lastInstances.concat(placed);

  for (const [key, list] of buckets) {
    const split = key.indexOf(':');
    const variant = key.slice(0, split) as OakVariantId;
    const part = key.slice(split + 1);
    const prepared = library[variant];
    if (!prepared || list.length === 0) continue;
    const source = part === 'foliage' ? prepared.foliage : prepared.bark;
    const material = part === 'ironbark' ? prepared.ironbark.material : source.material;
    const mesh = new InstancedMesh(source.geometry, material, list.length);
    mesh.morphTargetDictionary = source.morphTargetDictionary;
    const influences = OAK_MORPH_KEYS.map(() => 0);
    const dict = source.morphTargetDictionary;
    for (let i = 0; i < list.length; i++) {
      const record = list[i];
      if (!record) continue;
      dummy.position.set(record.x, record.y, record.z);
      dummy.rotation.set(0, record.yaw, 0);
      dummy.scale.setScalar(record.scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      for (const morphKey of OAK_MORPH_KEYS) {
        const slot = dict[morphKey];
        if (slot === undefined) continue;
        influences[slot] = record.morph[morphKey];
      }
      writeOakMorph(mesh, i, influences);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.morphTexture) mesh.morphTexture.needsUpdate = true;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.name = `oak-${variant}-${part}`;
    mesh.userData.tbOak = 1;
    mesh.userData.tbProp = mesh.name;
    mesh.userData.tbTrunkRadius = OAK_TRUNK_RADIUS_M;
    group.add(mesh);
  }
}

function pushBucket(
  buckets: Map<string, OakDebugInstance[]>,
  key: string,
  record: OakDebugInstance,
): void {
  const list = buckets.get(key);
  if (list) list.push(record);
  else buckets.set(key, [record]);
}

function asPart(
  geometry: BufferGeometry,
  material: MeshLambertMaterial,
  dictionary: Record<string, number> | undefined,
): OakPreparedPart {
  const morphTargetDictionary = { ...(dictionary ?? {}) };
  const instanced = new InstancedMesh(geometry, material, 1);
  instanced.morphTargetDictionary = morphTargetDictionary;
  return { material, geometry, morphTargetDictionary, instanced };
}

function collectMeshes(root: Object3DType): Mesh[] {
  const meshes: Mesh[] = [];
  root.traverse((object) => {
    if ((object as Mesh).isMesh) meshes.push(object as Mesh);
  });
  return meshes;
}

function materialName(mesh: Mesh): string {
  const material = mesh.material;
  if (Array.isArray(material)) return material[0]?.name ?? '';
  return material.name;
}

function toLambert(material: Material | Material[]): MeshLambertMaterial {
  const src = Array.isArray(material) ? material[0] : material;
  if (!src) throw new Error('oak material missing');
  const map = 'map' in src && src.map instanceof Texture ? src.map : null;
  const lambert = new MeshLambertMaterial({ name: src.name, map, color: 0xffffff });
  lambert.toneMapped = false;
  lambert.userData.tbKeep = 1;
  return lambert;
}

function crisp(texture: Texture | null): void {
  if (!texture) return;
  texture.magFilter = NearestFilter;
  texture.minFilter = NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = SRGBColorSpace;
  texture.needsUpdate = true;
}

function embeddedMaps(root: Object3DType, ironbark: Texture): OakMaps<Texture> {
  const meshes = collectMeshes(root);
  const bark = meshes.find((mesh) => materialName(mesh) === 'bark');
  const foliage = meshes.find((mesh) => materialName(mesh) === 'foliage');
  const barkMap = bark && mapOf(bark.material);
  const foliageMap = foliage && mapOf(foliage.material);
  if (!barkMap || !foliageMap) throw new Error('oak glb is missing bark or foliage texture');
  return { bark: barkMap, foliage: foliageMap, ironbark };
}

function mapOf(material: Material | Material[]): Texture | null {
  const src = Array.isArray(material) ? material[0] : material;
  if (src && 'map' in src && src.map instanceof Texture) return src.map;
  return null;
}

async function loadLibrary(): Promise<Record<OakVariantId, OakPrepared>> {
  const loader = new GLTFLoader();
  const ironbark = await loadTexture(assetUrl('textures/bark_oak_dark.png'));
  ironbark.flipY = false;
  ironbark.name = 'bark_oak_dark';
  crisp(ironbark);
  const loaded = await Promise.all(
    OAK_VARIANTS.map(async (id) => {
      const gltf = await loader.loadAsync(assetUrl(`variations/${id}.glb`));
      return [id, prepareOakVariant(gltf.scene, embeddedMaps(gltf.scene, ironbark))] as const;
    }),
  );
  const next = {} as Record<OakVariantId, OakPrepared>;
  for (const [id, prepared] of loaded) next[id] = prepared;
  return next;
}

function loadTexture(url: string): Promise<Texture> {
  return new Promise((resolve, reject) => {
    new TextureLoader().load(url, resolve, undefined, reject);
  });
}

function assetUrl(relative: string): string {
  const base = import.meta.env.BASE_URL || './';
  const prefix = base.endsWith('/') ? base : `${base}/`;
  return `${prefix}assets/nature/oak/${relative}`;
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

export const oakApi = {
  ready: oakReady,
  useSeed: useOakSeed,
  useBiome: useOakBiome,
  accepts: acceptsOak,
  scatter: scatterOaks,
  instances: oakInstances,
  loadMs: oakLoadMs,
};

if (typeof window !== 'undefined') {
  (window as unknown as { TBOaks: typeof oakApi }).TBOaks = oakApi;
}
