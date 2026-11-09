/**
 * Party wagon in a 3D area. The GLB path is `PARTY_WAGON_ASSET`.
 * The mesh sits on clear ground beside the spawn and blocks with a box.
 */
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Box3, BoxGeometry, Group, Mesh, MeshLambertMaterial, Vector3 } from 'three';
import { hitchPackOx, tickPackOx } from './pack-ox';
import {
  WAGON_BOX,
  chooseWagonSpot,
  groundBlocksWagon,
  partyWagonUrl,
  wagonCandidates,
  wagonHitsBlock,
  wagonNearPoint,
  wagonSpotClear,
  type WagonBlock,
  type WagonCandidate,
} from '../../core/world/wagon';

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
  const wagonFrontZ = new Box3().setFromObject(model).max.z;
  group.add(model);
  mount.scene.add(group);
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
  const span = Math.max(WAGON_BOX.w, WAGON_BOX.d);
  mount.blocks.push({
    x: spot.x,
    z: spot.z,
    w: span,
    d: span,
    h: y + WAGON_BOX.h,
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
    r: 3.2,
    hy: 2.2,
    use: () => {
      mount.onOpen();
      return '';
    },
  });
  return spot;
}

/** Advance the hitched ox. Stopped wagons idle; a moving wagon uses PullWalk. */
export function tickPartyWagon(dt: number): void {
  tickPackOx(dt);
}

function clearance(mount: WagonMount, spot: WagonCandidate) {
  const clamped = mount.clamp(spot.x, spot.z);
  const inside = Math.hypot(clamped.x - spot.x, clamped.z - spot.z) < 0.75;
  const blocked = mount.blocks.some((block) => wagonHitsBlock(spot, block));
  const road = wagonFootSamples(spot).some((sample) =>
    groundBlocksWagon(mount.groundName(sample.x, sample.z)),
  );
  const door = mount.doors.some((door) => wagonNearPoint(spot, door));
  return { inside, blocked, road, door };
}

function wagonFootSamples(spot: WagonCandidate): Array<{ x: number; z: number }> {
  const hx = WAGON_BOX.w / 2;
  const hz = WAGON_BOX.d / 2;
  const fx = Math.sin(spot.yaw);
  const fz = Math.cos(spot.yaw);
  const rx = Math.cos(spot.yaw);
  const rz = -Math.sin(spot.yaw);
  const corners = [
    [0, 0],
    [hx, hz],
    [-hx, hz],
    [hx, -hz],
    [-hx, -hz],
  ] as const;
  return corners.map(([side, back]) => ({
    x: spot.x + rx * side + fx * back,
    z: spot.z + rz * side + fz * back,
  }));
}

async function loadWagon(): Promise<Group | Mesh> {
  try {
    const gltf = await new GLTFLoader().loadAsync(partyWagonUrl('./'));
    const model = gltf.scene;
    model.traverse((child) => {
      const mesh = child as Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    });
    fitWagon(model);
    return model;
  } catch (error) {
    console.warn('party wagon model', error);
    return fallbackWagon();
  }
}

/** Scale the GLB so its longest horizontal side is about 3.8 m, feet on y = 0. */
function fitWagon(model: Group): void {
  const box = new Box3().setFromObject(model);
  const size = box.getSize(new Vector3());
  const span = Math.max(size.x, size.z, 0.001);
  const scale = 3.8 / span;
  model.scale.multiplyScalar(scale);
  const fitted = new Box3().setFromObject(model);
  const center = fitted.getCenter(new Vector3());
  model.position.x -= center.x;
  model.position.z -= center.z;
  model.position.y -= fitted.min.y;
}

function fallbackWagon(): Mesh {
  const mesh = new Mesh(
    new BoxGeometry(WAGON_BOX.w, WAGON_BOX.h, WAGON_BOX.d),
    new MeshLambertMaterial({ color: 0x8a5a32 }),
  );
  mesh.position.y = WAGON_BOX.h / 2;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}
