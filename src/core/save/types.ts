import type { PlayerAvatar } from '../people/avatar';

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
  /** Present from schema 4. Schema 3 saves gain one in the migration. */
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
