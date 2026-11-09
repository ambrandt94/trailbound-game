/**
 * Pack ox from the pinned Character Forge creature pack.
 * The manifest chooses the file, clips, and hitch. This module loads the GLB,
 * keeps the pixel texture nearest, and plays the draft clips.
 */
import {
  AnimationMixer,
  Box3,
  BoxGeometry,
  LoopRepeat,
  Mesh,
  MeshLambertMaterial,
  MeshPhongMaterial,
  MeshStandardMaterial,
  NearestFilter,
  Quaternion,
  Raycaster,
  SRGBColorSpace,
  Texture,
  Vector3,
  type AnimationAction,
  type Material,
  type Object3D,
} from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import {
  DRAFT_CLIP_NAMES,
  HITCH_SOCKET,
  PACK_OX_PIN,
  PACK_OX_SCALE,
  assertDraftCreature,
  creatureFilePath,
  creatureManifestPath,
  draftClip,
  draftFootprint,
  draftTimeScale,
  parseCreaturePack,
  placeDraftAnimal,
  tongueTip,
  type CreaturePin,
  type CreatureRecord,
  type DraftClipName,
  type Vec3,
} from '../../core/content/creature-pack';
import type { WagonBlock } from '../../core/world/wagon';

const MAPS = [
  'map',
  'emissiveMap',
  'normalMap',
  'roughnessMap',
  'metalnessMap',
  'alphaMap',
  'aoMap',
] as const;

export interface PackOx {
  root: Object3D;
  creature: CreatureRecord;
  present(clip: DraftClipName, timeScale: number): void;
  update(dt: number): void;
  clip(): DraftClipName;
}

export interface HitchHost {
  group: Object3D;
  /** Wagon-local +Z of the fitted wagon, measured before the group yaws it. */
  wagonFrontZ: number;
  spot: { x: number; z: number; yaw: number };
  blocks: WagonBlock[];
  groundY(x: number, z: number): number;
}

interface HitchState {
  ox: PackOx;
  group: Object3D;
  hitched: boolean;
  last: Vector3 | null;
}

let hitch: HitchState | null = null;

export function tickPackOx(dt: number): void {
  const live = hitch;
  if (!live || !(dt > 0)) return;
  live.group.updateMatrixWorld(true);
  const now = live.group.getWorldPosition(new Vector3());
  const speed = live.last ? now.distanceTo(live.last) / dt : 0;
  live.last = now;
  const name = draftClip(speed, live.hitched, DRAFT_CLIP_NAMES);
  const clip = live.ox.creature.clips[name];
  const rate = name === 'Idle' || !clip ? 1 : draftTimeScale(speed, clip.speedMps);
  live.ox.present(name, rate);
  live.ox.update(dt);
  const at = live.ox.root.getWorldPosition(new Vector3());
  const posted = globalThis as {
    __tbOx?: { clip: string; speed: number; x: number; y: number; z: number };
  };
  posted.__tbOx = { clip: name, speed, x: at.x, y: at.y, z: at.z };
}

/** SHA-256 hex of the GLB bytes. The pin and the manifest must both match. */
export async function sha256Hex(bytes: BufferSource): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Standard glTF materials read near-black under the town lights.
 * Other skinned pixel models become flat Phong, nearest, no mipmaps.
 */
export function prepPixelSkin(root: Object3D): void {
  root.traverse((object) => {
    const mesh = object as Mesh;
    if (!mesh.isMesh || !mesh.material) return;
    const list = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map(toPhong);
    mesh.material = Array.isArray(mesh.material) ? list : (list[0] as Material);
    for (const material of list) crispMaps(material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
  });
}

export function createPackOx(creature: CreatureRecord, gltf: GLTF): PackOx {
  const root = gltf.scene;
  root.name = 'pack-ox';
  prepPixelSkin(root);
  const mixer = new AnimationMixer(root);
  const actions = new Map<string, AnimationAction>();
  for (const clip of gltf.animations) {
    const action = mixer.clipAction(clip);
    action.setLoop(LoopRepeat, Infinity);
    action.clampWhenFinished = false;
    actions.set(clip.name, action);
  }
  let current: DraftClipName = 'Idle';
  return {
    root,
    creature,
    clip: () => current,
    present(name, timeScale) {
      const next = actions.get(name);
      if (!next) return;
      next.timeScale = Number.isFinite(timeScale) ? timeScale : 1;
      next.enabled = true;
      if (current === name && next.isRunning()) return;
      const prev = actions.get(current);
      next.reset().play();
      if (prev && prev !== next && current !== name) next.crossFadeFrom(prev, 0.16, true);
      current = name;
    },
    update(dt) {
      mixer.update(dt);
    },
  };
}

export async function loadPackOx(pin: CreaturePin = PACK_OX_PIN): Promise<PackOx> {
  const manifestUrl = publicUrl(creatureManifestPath(pin));
  const manifestRes = await fetch(manifestUrl);
  if (!manifestRes.ok) throw new Error(`creature manifest ${manifestRes.status}`);
  const pack = parseCreaturePack(await manifestRes.json());
  const creature = assertDraftCreature(pack, pin);
  const glbRes = await fetch(publicUrl(creatureFilePath(pin, creature.file)));
  if (!glbRes.ok) throw new Error(`creature glb ${glbRes.status}`);
  const bytes = await glbRes.arrayBuffer();
  const hash = await sha256Hex(bytes);
  if (hash !== pin.sha256 || hash !== creature.sha256)
    throw new Error('creature pack hash mismatch');
  const gltf = await new GLTFLoader().parseAsync(bytes, '');
  const names = gltf.animations.map((clip) => clip.name);
  for (const name of DRAFT_CLIP_NAMES) {
    if (!names.includes(name)) throw new Error(`creature pack missing ${name}`);
  }
  return createPackOx(creature, gltf);
}

/** Hitch the pinned ox to the party wagon. The wagon still parks if this throws. */
export async function hitchPackOx(host: HitchHost): Promise<void> {
  hitch = null;
  const ox = await loadPackOx();
  const oxBox = new Box3().setFromObject(ox.root);
  const socket = ox.creature.sockets[HITCH_SOCKET]?.rest;
  if (!socket) throw new Error('creature Socket_Hitch');
  const placed = placeDraftAnimal({
    wagonFrontZ: host.wagonFrontZ,
    socket,
    bodyMinZ: oxBox.min.z,
    scale: PACK_OX_SCALE,
  });
  ox.root.scale.setScalar(placed.scale);
  ox.root.position.set(placed.ox.x, placed.ox.y, placed.ox.z);
  ox.root.rotation.set(0, 0, 0);
  host.group.add(ox.root);
  host.group.updateMatrixWorld(true);
  const world = host.group.localToWorld(new Vector3(placed.ox.x, 0, placed.ox.z));
  const ground = host.groundY(world.x, world.z);
  ox.root.position.y = ground - host.group.position.y;
  const tongueTo: Vec3 = {
    x: placed.tongueTo.x,
    y: placed.tongueTo.y + ox.root.position.y,
    z: placed.tongueTo.z,
  };
  const tongueFrom: Vec3 = { ...placed.tongueFrom, y: tongueTo.y };
  addTongue(host.group, tongueFrom, hideTip(host.group, ox.root, tongueFrom, tongueTo));
  const foot = draftFootprint(host.spot, { x: placed.ox.x, z: placed.ox.z });
  host.blocks.push({
    x: foot.x,
    z: foot.z,
    w: foot.w,
    d: foot.d,
    h: ground + 1.25,
    y0: ground,
  } as WagonBlock & { h: number; y0: number });
  ox.present('Idle', 1);
  hitch = { ox, group: host.group, hitched: true, last: null };
}

function hideTip(group: Object3D, ox: Object3D, from: Vec3, to: Vec3): Vec3 {
  group.updateMatrixWorld(true);
  const start = group.localToWorld(new Vector3(from.x, from.y, from.z));
  const end = group.localToWorld(new Vector3(to.x, to.y, to.z));
  const delta = end.clone().sub(start);
  const length = delta.length();
  if (!(length > 1e-4)) return to;
  const ray = new Raycaster(start, delta.normalize(), 0, length);
  const hits = ray.intersectObject(ox, true);
  const hit = hits.find((item) => item.distance > 0.02);
  const localHit = hit ? group.worldToLocal(hit.point.clone()) : null;
  const distance = localHit
    ? Math.hypot(localHit.x - from.x, localHit.y - from.y, localHit.z - from.z)
    : null;
  return tongueTip(from, to, distance);
}

function addTongue(group: Object3D, from: Vec3, to: Vec3): void {
  const delta = new Vector3(to.x - from.x, to.y - from.y, to.z - from.z);
  const length = delta.length();
  if (!(length > 0.05)) return;
  const mesh = new Mesh(
    new BoxGeometry(0.08, 0.06, length),
    new MeshLambertMaterial({ color: 0x8a5a32 }),
  );
  mesh.name = 'wagon-tongue';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.position.set((from.x + to.x) / 2, (from.y + to.y) / 2, (from.z + to.z) / 2);
  mesh.quaternion.copy(
    new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), delta.normalize()),
  );
  group.add(mesh);
}

function toPhong(material: Material): Material {
  if (!(material instanceof MeshStandardMaterial)) return material;
  const phong = new MeshPhongMaterial({
    name: material.name,
    map: material.map,
    color: material.color.clone(),
    emissive: material.emissive.clone(),
    emissiveMap: material.emissiveMap,
    emissiveIntensity: material.emissiveIntensity,
    shininess: 0,
    specular: 0x000000,
    transparent: material.transparent,
    opacity: material.opacity,
    alphaTest: material.alphaTest,
    side: material.side,
    vertexColors: material.vertexColors,
    depthWrite: material.depthWrite,
    depthTest: material.depthTest,
  });
  material.dispose();
  return phong;
}

function crispMaps(material: Material): void {
  for (const key of MAPS) {
    const value = (material as unknown as Record<string, unknown>)[key];
    if (value instanceof Texture) crisp(value);
  }
}

function crisp(texture: Texture): void {
  texture.magFilter = NearestFilter;
  texture.minFilter = NearestFilter;
  texture.generateMipmaps = false;
  texture.anisotropy = 1;
  texture.colorSpace = SRGBColorSpace;
  texture.needsUpdate = true;
}

function publicUrl(path: string): string {
  const base = import.meta.env.BASE_URL || './';
  const prefix = base.endsWith('/') ? base : `${base}/`;
  return `${prefix}${path}`;
}
