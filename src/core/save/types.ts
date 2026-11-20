import type { PlayerAvatar } from '../people/avatar';
import type { ZoneRecord } from '../area/zone-history';
import type { CaravanSave } from '../sim/caravan';
import type { WorldSettings } from '../world/models';

/**
 * Save seam from the project plan. Platform backends implement this.
 * Game saves never go through localStorage.
 */
export interface CfPin {
  version: string;
  generatorVersion: string;
}

export interface PlayerSave {
  name: string;
  mapX: number;
  mapY: number;
  yaw: number;
  /**
   * Present from schema 4. Schema 3 saves gain one in the migration.
   * Schema 5 adds `engine` and, when a recipe was stored, `legacyRecipe`.
   */
  avatar?: PlayerAvatar;
}

export interface SaveManifest {
  schema: number;
  gameVersion: string;
  worldSeed: number;
  clockHours: number;
  player: PlayerSave;
  cfPin: CfPin;
  savedAt: string;
}

/** People core, parties, camps, wallets, and clock. G0 stores the hero and the clock. */
/** Party supplies. Missing on older saves; the loader fills the draft defaults. */
export interface PartySave {
  hasWagon: boolean;
  rawFood: number;
  meals: number;
  morale: number;
  hungry: boolean;
  /** Missing on older saves. The loader fills 0. */
  dirtyDishes?: number;
  /** Missing on older saves. The loader fills 0. */
  coins?: number;
}

export interface PackedWorld {
  clockHours: number;
  worldSeed: number;
  player: PlayerSave;
  party?: PartySave;
  /** Caravan position, route, and role. Missing on older saves; it starts on the hero. */
  caravan?: CaravanSave;
  /** The last zones entered, newest first. Missing on older saves; the history starts empty. */
  zones?: ZoneRecord[];
  /**
   * Generation settings with the land style resolved, so Continue rebuilds the
   * same size and shape. Missing on older saves; those load the default world.
   */
  worldSettings?: WorldSettings;
  gameVersion: string;
  cfPin: CfPin;
}

export interface PersonDetail {
  personId: string;
}

export interface LedgerEntry {
  id: string;
  amount?: number;
  note?: string;
}

export interface SavePatch {
  core?: PackedWorld;
  details?: Readonly<Record<string, PersonDetail>>;
  ledgerAppend?: readonly LedgerEntry[];
}

export interface SlotInfo {
  slot: string;
  manifest: SaveManifest;
}

export interface SaveBackend {
  listSlots(): Promise<SlotInfo[]>;
  readManifest(slot: string): Promise<SaveManifest | null>;
  readCore(slot: string): Promise<PackedWorld | null>;
  readDetail(slot: string, personId: string): Promise<PersonDetail | null>;
  write(slot: string, patch: SavePatch): Promise<void>;
  deleteSlot(slot: string): Promise<void>;
}
