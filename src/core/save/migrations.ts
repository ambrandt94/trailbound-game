import type { PackedWorld, SaveManifest } from './types';

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
    !Number.isFinite(player.yaw)
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
 * G0 only accepts schema 3. The schema 2 → 3 steps land with people in G3.
 */
export const SAVE_SCHEMA = 3;

export function migrate(
  manifest: SaveManifest,
  core: PackedWorld | null,
): { manifest: SaveManifest; core: PackedWorld | null } {
  if (manifest.schema !== SAVE_SCHEMA) {
    throw new Error(
      `No migration from save schema ${manifest.schema} to ${SAVE_SCHEMA}. Schema 3 is people-store schema 2 plus voice and race.`,
    );
  }
  return { manifest, core };
}
