/**
 * Party wagon in a 3D area. The GLB path is `PARTY_WAGON_ASSET`.
 * The mesh is metres already: wheels on y = 0, tongue along +Z.
 * It is not scaled or recentred. The solid box is the body; parking
 * keeps the whole tongue clear of roads, doors, buildings, and trees.
 * The pack ox stands just ahead of that tongue and idles until the wagon moves.
 */
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
  Box3,
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
import { hitchPackOx, setPackOxPlaybackCap, tickPackOx } from './pack-ox';
import { draftFootprint } from '../../core/content/creature-pack';
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
  wagonWorld,
  type WagonBlock,
  type WagonCandidate,
} from '../../core/world/wagon';
import { oakInstances } from './oak-batch';

export interface WagonMount {
  scene: { add(object: unknown): void };
  /** Convoy: stand here, on the route, instead of searching for a parking spot. */
  pose?: { x: number; z: number; yaw: number } | null;
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
  convoy = null;
  setPackOxPlaybackCap(0);
  const yaw = Number.isFinite(mount.spawn.yaw) ? (mount.spawn.yaw as number) : 0;
  const spots = mount.pose ? [] : wagonCandidates(mount.spawn.x, mount.spawn.z, yaw);
  const spot = mount.pose
    ? { x: mount.pose.x, z: mount.pose.z, yaw: mount.pose.yaw }
    : (chooseWagonSpot(spots, (candidate) => wagonSpotClear(clearance(mount, candidate))) ??
      spots[0] ??
      null);
  if (!spot) return null;
  const y = mount.groundY(spot.x, spot.z);
  const group = new Group();
  group.name = 'party-wagon';
  group.position.set(spot.x, y, spot.z);
  group.rotation.y = spot.yaw;
  const model = await loadWagon();
  const wagonFrontZ = new Box3().setFromObject(model).max.z;
  group.add(model);
  mount.scene.add(group);
  const body = wagonBodyAabb(spot);
  const wagonBlock = {
    x: body.x,
    z: body.z,
    w: body.w,
    d: body.d,
    h: y + body.h,
    y0: y,
  } as MovingBlock;
  mount.blocks.push(wagonBlock);
  const before = mount.blocks.length;
  try {
    await hitchPackOx({
      group,
      wagonFrontZ,
      spot,
      blocks: mount.blocks,
      groundY: mount.groundY,
    });
  } catch (error) {
    console.warn('pack ox', error);
  }
  const posted = globalThis as { __tbWagon?: { x: number; z: number; y: number } };
  posted.__tbWagon = { x: spot.x, z: spot.z, y };
  const thing: Record<string, unknown> = {
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
  };
  mount.things.push(thing);
  if (mount.pose) {
    const oxRoot = group.getObjectByName('pack-ox') ?? null;
    const oxBlock =
      mount.blocks.length > before ? (mount.blocks[mount.blocks.length - 1] as MovingBlock) : null;
    convoy = {
      group,
      model,
      wagonBlock,
      oxBlock,
      oxLocal: oxRoot ? { x: oxRoot.position.x, z: oxRoot.position.z } : null,
      oxRoot,
      thing,
      phase: 0,
      yaw: spot.yaw,
    };
    // PullWalk is authored at 0.32 m/s; let it play fast enough for a trotting wagon.
    setPackOxPlaybackCap(6);
  }
  return spot;
}

type MovingBlock = WagonBlock & { h: number; y0: number };

interface ConvoyRig {
  group: Group;
  model: Object3D;
  wagonBlock: MovingBlock;
  oxBlock: MovingBlock | null;
  oxLocal: { x: number; z: number } | null;
  oxRoot: Object3D | null;
  thing: Record<string, unknown>;
  phase: number;
  yaw: number;
}

let convoy: ConvoyRig | null = null;

/** True while the party wagon is the moving convoy wagon. */
export function convoyWagonMounted(): boolean {
  return convoy !== null;
}

/**
 * The convoy wagon has rolled off the zone: hide it, and take its collision
 * boxes and F prompt out of play. The rig stays so the session can tell.
 */
export function hideConvoyWagon(): void {
  const rig = convoy;
  if (!rig || !rig.group.visible) return;
  rig.group.visible = false;
  const gone = { x: 1e9, z: 1e9, w: 0, d: 0, h: -1e3, y0: -1e3 };
  Object.assign(rig.wagonBlock, gone);
  if (rig.oxBlock) Object.assign(rig.oxBlock, gone);
  rig.thing.x = 1e9;
  rig.thing.z = 1e9;
  const posted = globalThis as { __tbWagon?: unknown };
  posted.__tbWagon = undefined;
}

/** Smoothed wagon pose as drawn (yaw eases through route corners). */
export function convoyWagonPose(): { x: number; z: number; yaw: number; y: number } | null {
  if (!convoy) return null;
  const g = convoy.group.position;
  return { x: g.x, z: g.z, yaw: convoy.yaw, y: g.y };
}

/**
 * Put the convoy wagon on its route pose. Yaw eases through the route's
 * corners, the body pitches with the ground under its wheels, and the bed
 * bobs while it rolls. Collision boxes and the F prompt follow it.
 */
export function driveConvoyWagon(
  pose: { x: number; z: number; yaw: number; speed: number },
  groundY: (x: number, z: number) => number,
  dt: number,
): void {
  const rig = convoy;
  if (!rig) return;
  const turn = 1 - Math.exp(-Math.max(0, dt) * 3.2);
  let d = pose.yaw - rig.yaw;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  rig.yaw += d * turn;
  const fx = Math.sin(rig.yaw);
  const fz = Math.cos(rig.yaw);
  const y = groundY(pose.x, pose.z);
  const front = groundY(pose.x + fx * 1.6, pose.z + fz * 1.6);
  const back = groundY(pose.x - fx * 1.6, pose.z - fz * 1.6);
  const pitch = Math.atan2(front - back, 3.2);
  const moving = pose.speed > 0.05;
  // The bed bob tops out near 3.5 Hz: a faster wagon should rumble, not buzz.
  if (moving) rig.phase += dt * Math.min(1.45, Math.max(0.6, pose.speed)) * 2.4;
  const g = rig.group;
  g.rotation.order = 'YXZ';
  g.position.set(pose.x, y, pose.z);
  g.rotation.set(-Math.max(-0.35, Math.min(0.35, pitch)), rig.yaw, 0);
  const bob = moving ? Math.sin(rig.phase * Math.PI * 2) : 0;
  rig.model.position.y = Math.abs(bob) * 0.035;
  rig.model.rotation.z = (moving ? Math.sin(rig.phase * Math.PI) : 0) * 0.012;
  const spot = { x: pose.x, z: pose.z, yaw: rig.yaw };
  const body = wagonBodyAabb(spot);
  Object.assign(rig.wagonBlock, {
    x: body.x,
    z: body.z,
    w: body.w,
    d: body.d,
    h: y + body.h,
    y0: y,
  });
  if (rig.oxRoot && rig.oxLocal) {
    // Keep the ox's hooves on the ground under it, not on the wagon's plane.
    const at = wagonWorld(spot, rig.oxLocal.x, rig.oxLocal.z);
    const oxGround = groundY(at.x, at.z);
    rig.oxRoot.position.y = (oxGround - y) * Math.cos(pitch);
  }
  if (rig.oxBlock && rig.oxLocal) {
    const foot = draftFootprint(spot, rig.oxLocal);
    const oxY = groundY(foot.x, foot.z);
    Object.assign(rig.oxBlock, {
      x: foot.x,
      z: foot.z,
      w: foot.w,
      d: foot.d,
      h: oxY + 1.25,
      y0: oxY,
    });
  }
  rig.thing.x = pose.x;
  rig.thing.z = pose.z;
  rig.thing.y = y;
  const posted = globalThis as { __tbWagon?: { x: number; z: number; y: number } };
  posted.__tbWagon = { x: pose.x, z: pose.z, y };
}

/** Advance the hitched ox. Stopped wagons idle; a moving wagon uses PullWalk. */
export function tickPartyWagon(dt: number): void {
  tickPackOx(dt);
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
