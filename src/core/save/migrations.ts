import { defaultPlayerAvatar, isPlayerAvatar } from '../people/avatar';
import type { PackedWorld, PlayerSave, SaveManifest } from './types';

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
 * The schema 2 → 3 steps still land with people in G3.
 */
export const SAVE_SCHEMA = 4;

export function migrate(
  manifest: SaveManifest,
  core: PackedWorld | null,
): { manifest: SaveManifest; core: PackedWorld | null } {
  if (manifest.schema === SAVE_SCHEMA) {
    return { manifest, core };
  }
  if (manifest.schema === 3) {
    const player = withAvatar(manifest.player);
    const nextManifest: SaveManifest = { ...manifest, schema: SAVE_SCHEMA, player };
    const nextCore = core ? { ...core, player: withAvatar(core.player) } : null;
    return { manifest: nextManifest, core: nextCore };
  }
  throw new Error(
    `No migration from save schema ${manifest.schema} to ${SAVE_SCHEMA}. Schema 4 adds the player avatar on top of schema 3.`,
  );
}

function withAvatar(player: PlayerSave): PlayerSave {
  if (isPlayerAvatar(player.avatar)) return { ...player, avatar: player.avatar };
  const avatar = defaultPlayerAvatar(player.name || 'Traveller');
  return { ...player, avatar };
}
