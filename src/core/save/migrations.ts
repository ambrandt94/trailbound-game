import { defaultPlayerAvatar, isPlayerAvatar } from '../people/avatar';
import type { PlayerAvatar } from '../people/avatar';
import { clampSettings, DEFAULT_WORLD_SETTINGS, type WorldSettings } from '../world/models';
import type { CfPin, PackedWorld, PlayerSave, SaveManifest } from './types';

/**
 * World generation settings a save was made with. Saves before `worldSettings`
 * existed always loaded the default world, so they keep doing that.
 */
export function savedWorldSettings(core: PackedWorld): WorldSettings {
  const raw = core.worldSettings;
  // Saves from before world sources are classic islands; keep their map exactly.
  const classic = {
    ...DEFAULT_WORLD_SETTINGS,
    worldSource: 'island' as const,
    homeChunk: null,
    terrainGen: 1 as const,
    // Saves from before city plans keep today's settlements.
    settlementGen: 1 as const,
  };
  if (!raw || typeof raw !== 'object') return clampSettings(classic);
  return clampSettings({ ...classic, ...raw });
}

export function assertPackedWorld(value: PackedWorld): PackedWorld {
  if (!Number.isFinite(value.clockHours) || !Number.isFinite(value.worldSeed)) {
    throw new Error('packed world is missing clock or seed');
  }
  if (typeof value.gameVersion !== 'string' || value.gameVersion.length === 0) {
    throw new Error('packed world game version is invalid');
  }
  const player = value.player;
  if (
    !player ||
    typeof player.name !== 'string' ||
    !Number.isFinite(player.mapX) ||
    !Number.isFinite(player.mapY) ||
    !Number.isFinite(player.yaw) ||
    !isPlayerAvatar(player.avatar)
  ) {
    throw new Error('packed world player is invalid');
  }
  if (
    !value.cfPin ||
    typeof value.cfPin.version !== 'string' ||
    typeof value.cfPin.generatorVersion !== 'string'
  ) {
    throw new Error('packed world cf pin is invalid');
  }
  return value;
}

/**
 * Schema 3 = the people-store schema 2 plus `voice` and `race`.
 * Schema 4 adds `player.avatar` (name, seed, profile entry, generator, hash, race, gender).
 * Schema 5 tags that avatar with `engine` (`cf1` for a Character Forge 1 recipe) and copies a
 * stored v1 recipe into `legacyRecipe` verbatim. The runtime migrates that copy in memory.
 * The schema 2 → 3 steps still land with people in G3.
 *
 * A save's `cfPin` is separate from the schema. Pins from Character Forge 1.x
 * and from 2.2.1 (the last old-skeleton runtime this game shipped) are rewritten
 * to {@link CURRENT_CF_PIN} on load. The avatar recipe is not rewritten here.
 */
export const SAVE_SCHEMA = 5;

/** Character Forge runtime a migrated save records. Matches `current.json`. */
export const CURRENT_CF_PIN: CfPin = { version: '2.6.0', generatorVersion: '1' };

/** True for a Character Forge 1.x pin or the old-skeleton 2.2.1 pin. */
export function legacyCfPin(pin: CfPin): boolean {
  return pin.version === '2.2.1' || /^1\.\d+\.\d+$/.test(pin.version);
}

export function migrate(
  manifest: SaveManifest,
  core: PackedWorld | null,
): { manifest: SaveManifest; core: PackedWorld | null } {
  if (manifest.schema === SAVE_SCHEMA) {
    return repin(manifest, core);
  }
  if (manifest.schema !== 3 && manifest.schema !== 4) {
    throw new Error(
      `No migration from save schema ${manifest.schema} to ${SAVE_SCHEMA}. Schema 4 adds the player avatar on top of schema 3. Schema 5 records the character engine on that avatar.`,
    );
  }
  const withBodies = manifest.schema === 3 ? addAvatars(manifest, core) : { manifest, core };
  const tagged = tagEngines(withBodies.manifest, withBodies.core);
  return repin(tagged.manifest, tagged.core);
}

function repin(
  manifest: SaveManifest,
  core: PackedWorld | null,
): { manifest: SaveManifest; core: PackedWorld | null } {
  const nextManifest = pinOf(manifest);
  const nextCore = core ? pinOf(core) : core;
  if (nextManifest === manifest && nextCore === core) return { manifest, core };
  return { manifest: nextManifest, core: nextCore };
}

function pinOf<T extends { cfPin: CfPin }>(value: T): T {
  if (!legacyCfPin(value.cfPin)) return value;
  return { ...value, cfPin: { ...CURRENT_CF_PIN } };
}

function addAvatars(
  manifest: SaveManifest,
  core: PackedWorld | null,
): { manifest: SaveManifest; core: PackedWorld | null } {
  return {
    manifest: { ...manifest, schema: 4, player: withAvatar(manifest.player) },
    core: core ? { ...core, player: withAvatar(core.player) } : null,
  };
}

function tagEngines(
  manifest: SaveManifest,
  core: PackedWorld | null,
): { manifest: SaveManifest; core: PackedWorld | null } {
  return {
    manifest: { ...manifest, schema: SAVE_SCHEMA, player: tagEngine(manifest.player) },
    core: core ? { ...core, player: tagEngine(core.player) } : null,
  };
}

function withAvatar(player: PlayerSave): PlayerSave {
  if (isPlayerAvatar(player.avatar)) return { ...player, avatar: player.avatar };
  const avatar = defaultPlayerAvatar(player.name || 'Traveller');
  return { ...player, avatar };
}

/** Schema 4 avatars are Character Forge 1 recipes. Copy the stored recipe aside before any later rewrite. */
function tagEngine(player: PlayerSave): PlayerSave {
  const avatar = player.avatar;
  if (!isPlayerAvatar(avatar)) return player;
  const next: PlayerAvatar = { ...avatar, engine: 'cf1' };
  if (avatar.recipe) next.legacyRecipe = cloneRecord(avatar.recipe);
  else delete next.legacyRecipe;
  return { ...player, avatar: next };
}

function cloneRecord(value: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  return JSON.parse(JSON.stringify(value)) as Readonly<Record<string, unknown>>;
}
