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
export interface PackedWorld {
  clockHours: number;
  worldSeed: number;
  player: PlayerSave;
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
