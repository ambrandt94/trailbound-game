import { assertPackedWorld, migrate, SAVE_SCHEMA } from '../../core/save/migrations';
import type { PackedWorld, SaveManifest } from '../../core/save/types';

const SLOT_NAME = /^[A-Za-z0-9_-]{1,64}$/;

export function assertSlot(slot: string): void {
  if (!SLOT_NAME.test(slot)) throw new Error(`invalid save slot "${slot}"`);
}

export function manifestFor(core: PackedWorld, savedAt: string): SaveManifest {
  const checked = assertPackedWorld(core);
  const manifest: SaveManifest = {
    schema: SAVE_SCHEMA,
    gameVersion: checked.gameVersion,
    worldSeed: checked.worldSeed,
    clockHours: checked.clockHours,
    player: { ...checked.player },
    cfPin: { ...checked.cfPin },
    savedAt,
  };
  return migrate(manifest, checked).manifest;
}

export function clone<T>(value: T): T {
  return structuredClone(value);
}
