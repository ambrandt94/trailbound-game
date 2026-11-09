/**
 * Character Forge creature packs. The runtime bundle is character recipes only,
 * so a pack is data: one pin, one immutable directory, one manifest.
 *
 * A later ox is a new `public/vendor/creature-packs/<id>/<version>/` tree and
 * a change to `pack-ox.pin.json`. Loaders read that pin; they do not hardcode
 * the version.
 */
import packOxPinFile from './pack-ox.pin.json';

export const CREATURE_PACK_FORMAT = 'cf.creature_pack';
export const DRAFT_CLIP_NAMES = ['Idle', 'Walk', 'PullWalk'] as const;
export type DraftClipName = (typeof DRAFT_CLIP_NAMES)[number];
export const HITCH_SOCKET = 'Socket_Hitch';
export const YOKE_SOCKET = 'Socket_Yoke';
/** Below this ground speed the draft animal idles. */
export const DRAFT_MOVE_EPS_MPS = 0.05;
/** Mixer cap. The PullWalk clip is 0.32 m/s, so a faster wagon shortens the stride. */
export const DRAFT_PLAYBACK_CAP = 1.6;
/** Gap between the wagon front and the ox's rear, metres. */
export const DRAFT_CLEARANCE_M = 0.2;
/** Authored pack is already in metres. Hero height is about 1.4 m; the ox is 1.21 m. */
export const PACK_OX_SCALE = 1;

export interface CreaturePin {
  id: string;
  version: string;
  sha256: string;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface CreatureClip {
  duration: number;
  speedMps: number;
}

export interface CreatureSocket {
  parent: string;
  rest: Vec3;
}

export interface CreatureRecord {
  id: string;
  name: string;
  role: string;
  file: string;
  sha256: string;
  clips: Record<string, CreatureClip>;
  sockets: Record<string, CreatureSocket>;
}

export interface CreaturePack {
  format: string;
  version: string;
  textureFilter: string;
  compatibleBundle: string;
  creatures: CreatureRecord[];
}

export interface DraftPlacement {
  scale: number;
  ox: Vec3;
  /** Where the tongue leaves the wagon, wagon-local metres. */
  tongueFrom: Vec3;
  /** Socket_Hitch in wagon-local metres. The tongue aims here. */
  tongueTo: Vec3;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function num(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(label);
  return value;
}

function vec3(value: unknown, label: string): Vec3 {
  if (!isRecord(value)) throw new Error(label);
  return {
    x: num(value.x, label),
    y: num(value.y, label),
    z: num(value.z, label),
  };
}

export function parseCreaturePin(data: unknown): CreaturePin {
  if (!isRecord(data)) throw new Error('creature pin');
  const id = data.id;
  const version = data.version;
  const sha256 = data.sha256;
  if (typeof id !== 'string' || !/^[a-z0-9_]+$/.test(id)) throw new Error('creature pin id');
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error('creature pin version');
  }
  if (typeof sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(sha256))
    throw new Error('creature pin sha256');
  return { id, version, sha256 };
}

/** The only pack pin. Bump `version` in `pack-ox.pin.json` to move the game. */
export const PACK_OX_PIN: CreaturePin = parseCreaturePin(packOxPinFile);

export function creaturePackRoot(pin: CreaturePin = PACK_OX_PIN): string {
  return `vendor/creature-packs/${pin.id}/${pin.version}`;
}

export function creatureManifestPath(pin: CreaturePin = PACK_OX_PIN): string {
  return `${creaturePackRoot(pin)}/manifest.json`;
}

export function creatureFilePath(pin: CreaturePin, file: string): string {
  const clean = file.replace(/^\/+/, '');
  if (clean.length === 0 || clean.split('/').includes('..')) throw new Error('creature pack file');
  return `${creaturePackRoot(pin)}/${clean}`;
}

export function parseCreaturePack(data: unknown): CreaturePack {
  if (!isRecord(data)) throw new Error('creature pack');
  if (data.format !== CREATURE_PACK_FORMAT) throw new Error('creature pack format');
  const version = data.version;
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error('creature pack version');
  }
  const textureFilter = data.textureFilter;
  if (textureFilter !== 'nearest' && textureFilter !== 'linear') {
    throw new Error('creature pack textureFilter');
  }
  const engine = isRecord(data.engine) ? data.engine : {};
  const compatibleBundle = engine.compatibleBundle;
  if (typeof compatibleBundle !== 'string' || compatibleBundle.length === 0) {
    throw new Error('creature pack engine');
  }
  if (!Array.isArray(data.creatures) || data.creatures.length === 0) {
    throw new Error('creature pack creatures');
  }
  return {
    format: CREATURE_PACK_FORMAT,
    version,
    textureFilter,
    compatibleBundle,
    creatures: data.creatures.map(parseCreature),
  };
}

function parseCreature(data: unknown): CreatureRecord {
  if (!isRecord(data)) throw new Error('creature');
  if (typeof data.id !== 'string' || data.id.length === 0) throw new Error('creature id');
  if (typeof data.file !== 'string' || data.file.length === 0) throw new Error('creature file');
  if (typeof data.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(data.sha256)) {
    throw new Error('creature sha256');
  }
  return {
    id: data.id,
    name: typeof data.name === 'string' ? data.name : data.id,
    role: typeof data.role === 'string' ? data.role : '',
    file: data.file,
    sha256: data.sha256,
    clips: parseClips(data.clips),
    sockets: parseSockets(data.sockets),
  };
}

function parseClips(data: unknown): Record<string, CreatureClip> {
  if (!isRecord(data)) throw new Error('creature clips');
  const clips: Record<string, CreatureClip> = {};
  for (const [name, value] of Object.entries(data)) {
    if (!isRecord(value)) throw new Error(`creature clip ${name}`);
    const duration = num(value.duration, `creature clip ${name}`);
    const speed = num(value.speed_mps, `creature clip ${name}`);
    if (duration <= 0 || speed < 0) throw new Error(`creature clip ${name}`);
    clips[name] = { duration, speedMps: speed };
  }
  if (Object.keys(clips).length === 0) throw new Error('creature clips');
  return clips;
}

function parseSockets(data: unknown): Record<string, CreatureSocket> {
  if (!isRecord(data)) throw new Error('creature sockets');
  const sockets: Record<string, CreatureSocket> = {};
  for (const [name, value] of Object.entries(data)) {
    if (!isRecord(value) || typeof value.parent !== 'string' || value.parent.length === 0) {
      throw new Error(`creature socket ${name}`);
    }
    sockets[name] = {
      parent: value.parent,
      rest: vec3(value.rest_gltf, `creature socket ${name}`),
    };
  }
  return sockets;
}

/** The approved draft animal: three clips and the two hitch sockets. */
export function assertDraftCreature(
  pack: CreaturePack,
  pin: CreaturePin = PACK_OX_PIN,
): CreatureRecord {
  if (pack.version !== pin.version) throw new Error('creature pack version pin');
  const creature = pack.creatures.find((item) => item.id === pin.id);
  if (!creature) throw new Error('creature pack id');
  if (creature.sha256 !== pin.sha256) throw new Error('creature pack hash pin');
  if (pack.textureFilter !== 'nearest') throw new Error('creature pack nearest');
  for (const name of DRAFT_CLIP_NAMES) {
    if (!creature.clips[name]) throw new Error(`creature pack missing ${name}`);
  }
  const hitch = creature.sockets[HITCH_SOCKET];
  const yoke = creature.sockets[YOKE_SOCKET];
  if (!hitch || hitch.parent !== 'Root') throw new Error('creature Socket_Hitch');
  if (!yoke || yoke.parent !== 'Chest') throw new Error('creature Socket_Yoke');
  return creature;
}

/**
 * Hitched: PullWalk while the wagon moves, Idle when it is stopped.
 * Loose: Walk while it moves. Missing clips fall back toward Idle.
 */
export function draftClip(
  speedMps: number,
  hitched: boolean,
  clips: readonly string[],
): DraftClipName {
  const have = new Set(clips);
  const moving = Number.isFinite(speedMps) && speedMps > DRAFT_MOVE_EPS_MPS;
  if (!moving) return have.has('Idle') ? 'Idle' : 'Walk';
  if (hitched && have.has('PullWalk')) return 'PullWalk';
  if (have.has('Walk')) return 'Walk';
  return 'Idle';
}

/**
 * Playback rate so the clip's authored ground speed matches `speedMps`.
 * `timeScale` 1 is the manifest speed. Idle does not use this.
 */
export function draftTimeScale(
  speedMps: number,
  clipSpeedMps: number,
  maxRate = DRAFT_PLAYBACK_CAP,
): number {
  if (!(speedMps > 0) || !(clipSpeedMps > 0)) return 1;
  const cap = maxRate > 0 ? maxRate : DRAFT_PLAYBACK_CAP;
  return Math.min(cap, Math.max(0.2, speedMps / clipSpeedMps));
}

/**
 * Ox origin in wagon-local metres. Both face +Z. The hitch socket lands on
 * `tongueTo`. The ox's rear stays `gap` metres in front of the wagon.
 */
export function placeDraftAnimal(input: {
  wagonFrontZ: number;
  socket: Vec3;
  bodyMinZ: number;
  gap?: number;
  scale?: number;
}): DraftPlacement {
  const scale = input.scale && input.scale > 0 ? input.scale : 1;
  const gap = Number.isFinite(input.gap) ? (input.gap as number) : DRAFT_CLEARANCE_M;
  const oxZ = input.wagonFrontZ + gap - input.bodyMinZ * scale;
  const ox: Vec3 = { x: -input.socket.x * scale, y: 0, z: oxZ };
  const tongueTo: Vec3 = {
    x: ox.x + input.socket.x * scale,
    y: ox.y + input.socket.y * scale,
    z: ox.z + input.socket.z * scale,
  };
  return {
    scale,
    ox,
    tongueFrom: { x: tongueTo.x, y: tongueTo.y, z: input.wagonFrontZ },
    tongueTo,
  };
}

/**
 * Drawn tongue tip. `hitDistance` is the first hide hit along the hitch line.
 * Null draws the tongue all the way to the socket.
 */
export function tongueTip(from: Vec3, to: Vec3, hitDistance: number | null, inset = 0.04): Vec3 {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const length = Math.hypot(dx, dy, dz);
  if (!(length > 1e-6)) return { x: to.x, y: to.y, z: to.z };
  const reach = hitDistance == null ? length : Math.min(length, Math.max(0, hitDistance - inset));
  const t = reach / length;
  return { x: from.x + dx * t, y: from.y + dy * t, z: from.z + dz * t };
}

/** Wagon yaw 0 faces +Z. `localZ` is in front of the wagon, `localX` to its right. */
export function draftWorldXZ(
  spot: { x: number; z: number; yaw: number },
  localX: number,
  localZ: number,
): { x: number; z: number } {
  const yaw = Number.isFinite(spot.yaw) ? spot.yaw : 0;
  const fx = Math.sin(yaw);
  const fz = Math.cos(yaw);
  const rx = Math.cos(yaw);
  const rz = -Math.sin(yaw);
  return {
    x: spot.x + rx * localX + fx * localZ,
    z: spot.z + rz * localX + fz * localZ,
  };
}

/** Axis-aligned footprint of the ox so a turned animal still blocks. */
export function draftFootprint(
  spot: { x: number; z: number; yaw: number },
  local: { x: number; z: number },
  length = 2,
  width = 0.9,
): { x: number; z: number; w: number; d: number } {
  const at = draftWorldXZ(spot, local.x, local.z);
  const yaw = Number.isFinite(spot.yaw) ? spot.yaw : 0;
  const c = Math.abs(Math.cos(yaw));
  const s = Math.abs(Math.sin(yaw));
  return {
    x: at.x,
    z: at.z,
    w: width * c + length * s,
    d: width * s + length * c,
  };
}
