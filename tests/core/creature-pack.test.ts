import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import {
  CREATURE_PACK_FORMAT,
  DRAFT_CLEARANCE_M,
  DRAFT_PLAYBACK_CAP,
  HITCH_SOCKET,
  PACK_OX_PIN,
  PACK_OX_SCALE,
  YOKE_SOCKET,
  assertDraftCreature,
  creatureFilePath,
  creatureManifestPath,
  creaturePackRoot,
  draftClip,
  draftFootprint,
  draftTimeScale,
  draftWorldXZ,
  parseCreaturePack,
  placeDraftAnimal,
  tongueTip,
} from '../../src/core/content/creature-pack';

const root = join(process.cwd(), 'public', creaturePackRoot());

test('the pack ox pin is 0.1.2 and the versioned path follows it', () => {
  expect(PACK_OX_PIN).toEqual({
    id: 'pack_ox',
    version: '0.1.2',
    sha256: 'e3ac943c9e8dbf942e30c8fcabefc7d3405625a58d984d0ceba68209a2b67558',
  });
  expect(creaturePackRoot()).toBe('vendor/creature-packs/pack_ox/0.1.2');
  expect(creatureManifestPath()).toBe('vendor/creature-packs/pack_ox/0.1.2/manifest.json');
  expect(PACK_OX_SCALE).toBe(1);
});

test('the vendored manifest matches the pin, the hash, and the draft clips', () => {
  const manifestPath = join(process.cwd(), 'public', creatureManifestPath());
  const pack = parseCreaturePack(JSON.parse(readFileSync(manifestPath, 'utf8')));
  const creature = assertDraftCreature(pack);
  expect(pack.format).toBe(CREATURE_PACK_FORMAT);
  expect(pack.version).toBe(PACK_OX_PIN.version);
  expect(pack.textureFilter).toBe('nearest');
  expect(pack.compatibleBundle).toBe('1.2.1');
  expect(creature.role).toBe('tier1_wagon_draft');
  expect(creature.file).toBe('packs/pack_ox.glb');
  expect(creature.sha256).toBe(PACK_OX_PIN.sha256);

  const glbPath = join(process.cwd(), 'public', creatureFilePath(PACK_OX_PIN, creature.file));
  const bytes = readFileSync(glbPath);
  const hash = createHash('sha256').update(bytes).digest('hex');
  expect(hash).toBe(PACK_OX_PIN.sha256);
  expect(bytes.byteLength).toBe(594868);
  expect(glbPath.startsWith(root)).toBe(true);

  expect(creature.clips.Idle).toMatchObject({ duration: 3.233, speedMps: 0 });
  expect(creature.clips.Walk).toMatchObject({ duration: 0.933, speedMps: 0.41 });
  expect(creature.clips.PullWalk).toMatchObject({ duration: 0.933, speedMps: 0.32 });
  expect(creature.sockets[HITCH_SOCKET]?.parent).toBe('Root');
  expect(creature.sockets[YOKE_SOCKET]?.parent).toBe('Chest');
  expect(creature.sockets[HITCH_SOCKET]?.rest.y).toBeCloseTo(0.932, 3);
  expect(creature.sockets[HITCH_SOCKET]?.rest.z).toBeCloseTo(0.52, 3);
  expect(creature.sockets[YOKE_SOCKET]?.rest).toEqual(creature.sockets[HITCH_SOCKET]?.rest);
});

test('a pack that is not cf.creature_pack is refused', () => {
  expect(() => parseCreaturePack({ format: 'other' })).toThrow(/format/);
  const pack = parseCreaturePack({
    format: CREATURE_PACK_FORMAT,
    version: '0.1.2',
    textureFilter: 'nearest',
    engine: { compatibleBundle: '1.2.1' },
    creatures: [
      {
        id: 'pack_ox',
        file: 'packs/pack_ox.glb',
        sha256: PACK_OX_PIN.sha256,
        clips: {
          Idle: { duration: 1, speed_mps: 0 },
          Walk: { duration: 1, speed_mps: 0.4 },
        },
        sockets: {},
      },
    ],
  });
  expect(() => assertDraftCreature(pack)).toThrow(/PullWalk/);
});

test('a hitched ox idles when the wagon is stopped and pull-walks when it moves', () => {
  const clips = ['Idle', 'Walk', 'PullWalk'];
  expect(draftClip(0, true, clips)).toBe('Idle');
  expect(draftClip(0.02, true, clips)).toBe('Idle');
  expect(draftClip(Number.NaN, true, clips)).toBe('Idle');
  expect(draftClip(0.4, true, clips)).toBe('PullWalk');
  expect(draftClip(0.4, false, clips)).toBe('Walk');
  expect(draftClip(0.4, true, ['Idle', 'Walk'])).toBe('Walk');

  const pull = 0.32;
  expect(draftTimeScale(pull, pull)).toBeCloseTo(1, 5);
  expect(draftTimeScale(pull * 1.25, pull)).toBeCloseTo(1.25, 5);
  expect(draftTimeScale(pull * 2, pull)).toBe(DRAFT_PLAYBACK_CAP);
  expect(draftTimeScale(pull * 10, pull)).toBe(DRAFT_PLAYBACK_CAP);
  expect(draftTimeScale(0, pull)).toBe(1);
});

test('the hitch socket sits on the tongue and the ox rear clears the wagon', () => {
  const socket = { x: 0, y: 0.932, z: 0.52 };
  const placed = placeDraftAnimal({
    wagonFrontZ: 1.9,
    socket,
    bodyMinZ: -0.944,
  });
  expect(placed.scale).toBe(1);
  expect(placed.ox.x).toBeCloseTo(0, 5);
  expect(placed.ox.y).toBe(0);
  expect(placed.ox.z + -0.944).toBeCloseTo(1.9 + DRAFT_CLEARANCE_M, 5);
  expect(placed.tongueFrom).toEqual({ x: 0, y: socket.y, z: 1.9 });
  expect(placed.tongueTo.x).toBeCloseTo(0, 5);
  expect(placed.tongueTo.y).toBeCloseTo(socket.y, 5);
  expect(placed.tongueTo.z).toBeCloseTo(placed.ox.z + socket.z, 5);

  const shifted = placeDraftAnimal({
    wagonFrontZ: 1,
    socket: { x: 0.1, y: 1, z: 0.5 },
    bodyMinZ: -1,
    scale: 2,
    gap: 0.5,
  });
  expect(shifted.ox.x).toBeCloseTo(-0.2, 5);
  expect(shifted.tongueTo.x).toBeCloseTo(0, 5);
  expect(shifted.ox.z + -1 * 2).toBeCloseTo(1.5, 5);

  const full = tongueTip(placed.tongueFrom, placed.tongueTo, null);
  expect(full).toEqual(placed.tongueTo);
  const stopped = tongueTip({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 2 }, 1, 0.04);
  expect(stopped.z).toBeCloseTo(0.96, 5);
});

test('wagon yaw carries the ox in front of the tongue', () => {
  expect(draftWorldXZ({ x: 10, z: 20, yaw: 0 }, 0, 3)).toEqual({ x: 10, z: 23 });
  const side = draftWorldXZ({ x: 0, z: 0, yaw: Math.PI / 2 }, 0, 3);
  expect(side.x).toBeCloseTo(3, 5);
  expect(side.z).toBeCloseTo(0, 5);
  const parked = draftFootprint({ x: 4, z: 5, yaw: 0 }, { x: 0, z: 2 });
  expect(parked).toEqual({ x: 4, z: 7, w: 0.9, d: 2 });
  const turned = draftFootprint({ x: 0, z: 0, yaw: Math.PI / 2 }, { x: 0, z: 0 });
  expect(turned.w).toBeCloseTo(2, 5);
  expect(turned.d).toBeCloseTo(0.9, 5);
});
