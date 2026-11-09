/**
 * Party wagon in a 3D area. The GLB path is `PARTY_WAGON_ASSET`.
 * The mesh is metres already: wheels on y = 0, tongue along +Z.
 * It is not scaled or recentred. The solid box is the body; parking
 * keeps the whole tongue clear of roads, doors, buildings, and trees.
 */
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
  BoxGeometry,
  Color,
  Group,
  Mesh,
  MeshLambertMaterial,
  NearestFilter,
  SRGBColorSpace,
  Texture,
  type Material,
  type Object3D,
} from 'three';
import { oakTrunkRadius } from '../../core/world/oak-dress';
import {
  WAGON_BOX,
  WAGON_USE_RADIUS_M,
  chooseWagonSpot,
  wagonCandidates,
  groundBlocksWagon,
  partyWagonUrl,
  wagonBodyAabb,
  wagonFootSamples,
  wagonHitsBlock,
  wagonNearPoint,
  wagonSpotClear,
  type WagonBlock,
  type WagonCandidate,
} from '../../core/world/wagon';
import { oakInstances } from './oak-batch';

export interface WagonMount {
  scene: { add(object: unknown): void };
  blocks: WagonBlock[];
  things: Array<Record<string, unknown>>;
  spawn: { x: number; z: number; yaw?: number };
  groundY(x: number, z: number): number;
  clamp(x: number, z: number): { x: number; z: number };
  groundName(x: number, z: number): string;
  doors: Array<{ x: number; z: number }>;
  onOpen(): void;
}

export async function mountPartyWagon(mount: WagonMount): Promise<WagonCandidate | null> {
  const yaw = Number.isFinite(mount.spawn.yaw) ? (mount.spawn.yaw as number) : 0;
  const spots = wagonCandidates(mount.spawn.x, mount.spawn.z, yaw);
  const spot =
    chooseWagonSpot(spots, (candidate) => wagonSpotClear(clearance(mount, candidate))) ??
    spots[0] ??
    null;
  if (!spot) return null;
  const y = mount.groundY(spot.x, spot.z);
  const group = new Group();
  group.name = 'party-wagon';
  group.position.set(spot.x, y, spot.z);
  group.rotation.y = spot.yaw;
  const model = await loadWagon();
  group.add(model);
  mount.scene.add(group);
  const body = wagonBodyAabb(spot);
  mount.blocks.push({
    x: body.x,
    z: body.z,
    w: body.w,
    d: body.d,
    h: y + body.h,
    y0: y,
  } as WagonBlock & { h: number; y0: number });
  const posted = globalThis as { __tbWagon?: { x: number; z: number; y: number } };
  posted.__tbWagon = { x: spot.x, z: spot.z, y };
  mount.things.push({
    k: 'fn',
    label: 'F: Wagon',
    x: spot.x,
    z: spot.z,
    y,
    r: WAGON_USE_RADIUS_M,
    hy: 3,
    use: () => {
      mount.onOpen();
      return '';
    },
  });
  return spot;
}

function clearance(mount: WagonMount, spot: WagonCandidate) {
  const inside = wagonFootSamples(spot).every((sample) => {
    const clamped = mount.clamp(sample.x, sample.z);
    return Math.hypot(clamped.x - sample.x, clamped.z - sample.z) < 0.75;
  });
  const blocked = obstacleBlocks(mount).some((block) => wagonHitsBlock(spot, block));
  const road = wagonFootSamples(spot).some((sample) =>
    groundBlocksWagon(mount.groundName(sample.x, sample.z)),
  );
  const door = mount.doors.some((door) => wagonNearPoint(spot, door));
  return { inside, blocked, road, door };
}

function obstacleBlocks(mount: WagonMount): WagonBlock[] {
  const trees = oakInstances().map((oak) => {
    const diameter = oakTrunkRadius(oak.scale) * 2;
    return { x: oak.x, z: oak.z, w: diameter, d: diameter };
  });
  return mount.blocks.concat(trees);
}

async function loadWagon(): Promise<Group | Mesh> {
  try {
    const gltf = await new GLTFLoader().loadAsync(partyWagonUrl('./'));
    const model = gltf.scene;
    prepareWagonModel(model);
    return model;
  } catch (error) {
    console.warn('party wagon model', error);
    return fallbackWagon();
  }
}

/**
 * Crisp colour maps, same as the oaks: nearest, no mipmaps, sRGB.
 * Position, rotation, and scale stay at the authored identity.
 */
export function prepareWagonModel(root: Object3D): void {
  root.traverse((child) => {
    const mesh = child as Mesh;
    if (!mesh.isMesh || !mesh.material) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const source = mesh.material;
    const list = (Array.isArray(source) ? source : [source]).map((material) => toLambert(material));
    const first = list[0];
    if (!first) return;
    mesh.material = Array.isArray(source) ? list : first;
  });
}

function mapOf(material: Material): Texture | null {
  if ('map' in material && material.map instanceof Texture) return material.map;
  return null;
}

function colorOf(material: Material): Color {
  if ('color' in material && material.color instanceof Color) return material.color.clone();
  return new Color(0xffffff);
}

function toLambert(material: Material): MeshLambertMaterial {
  if ((material as MeshLambertMaterial).isMeshLambertMaterial) {
    const lambert = material as MeshLambertMaterial;
    crispColorMap(lambert.map);
    lambert.toneMapped = false;
    return lambert;
  }
  const lambert = new MeshLambertMaterial({
    name: material.name,
    map: mapOf(material),
    color: colorOf(material),
    transparent: material.transparent,
    opacity: material.opacity,
    alphaTest: material.alphaTest,
    side: material.side,
  });
  lambert.toneMapped = false;
  crispColorMap(lambert.map);
  return lambert;
}

function crispColorMap(texture: Texture | null): void {
  if (!texture) return;
  texture.magFilter = NearestFilter;
  texture.minFilter = NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = SRGBColorSpace;
  texture.needsUpdate = true;
}

function fallbackWagon(): Mesh {
  const mesh = new Mesh(
    new BoxGeometry(WAGON_BOX.w, WAGON_BOX.h, WAGON_BOX.d),
    new MeshLambertMaterial({ color: 0x8a5a32 }),
  );
  mesh.position.set(0, WAGON_BOX.h / 2, (WAGON_BOX.minZ + WAGON_BOX.maxZ) / 2);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}
