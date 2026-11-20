/**
 * Character engine seam. `forge.ts` talks to this, never to a Forge runtime.
 *
 * v1 (`backends/v1.ts`) wraps Character Forge 1.x (`cf.*`, including `pixelSun`).
 * A future v2 backend maps Character Forge 2.0 onto the same methods:
 *
 *   CF.init({ THREE, baseUrl })                          -> init
 *   randomRecipe(seed, { race, bodyType, role, tier,
 *     richness, outfit }) and generate                  -> generate
 *   recipeHash                                           -> recipeHash
 *   options / describe / checkEdit / edit                -> the same names
 *   equip / unequip / dye
 *     -> { recipe, displaced, hidden, warnings }         -> equip / unequip / dye
 *   catalog (races keyed by id, with heightM / strideM) -> catalog
 *   migrate                                              -> migrateRecipe
 *   setLighting({ mode, sunDir, sunColor, strength })    -> aimSun
 *     (v1 aimSun calls pixelSun; v2 derives a light from the camera)
 *   build(recipe, { budgetMs, texSize, signal })
 *     -> { object3D, mixer, clips, play, setTimeScale,
 *          socket, setRecipe, dispose, info }            -> build
 *
 * Stage contract for every backend: feet at y = 0, +Z forward, metres.
 * Sockets, when `build` exposes them: hand_l, hand_r, back, belt, head.
 * `?cf=1` (also `v1` / `cf1`) selects the legacy `backends/v1.ts`. Anything else is v2.
 */
import type { AnimationClip, AnimationMixer, Camera, Object3D } from 'three';
import type { AvatarEngine, PlayerProfileEntry } from '../../../core/people/avatar';
import type { EditIssue, EditPatch, ForgeCatalog, ProfileReport } from '../forge';

export type { AvatarEngine };

export interface CharacterBackendInit {
  /** Vendored module URL. Each backend dynamic-imports this. */
  runtimeUrl: string;
  baseUrl: string;
  profile?: unknown;
  /**
   * Opt-in base URL for a privately hosted animation pack.
   * Unset in the public game. v2 registers it and switches to `cf+ki`.
   * v1 ignores it.
   */
  privateAnimBaseUrl?: string;
}

/** v1 `generate` input, plus the fields v2 `randomRecipe` takes. */
export interface CharacterGenerateRequest {
  seed: number;
  profileEntry: PlayerProfileEntry;
  generatorVersion?: number;
  race?: string;
  gender?: 'm' | 'f';
  /** v2 randomRecipe. v1 ignores these. */
  bodyType?: string;
  role?: string;
  tier?: string;
  richness?: number;
  outfit?: unknown;
}

export interface CharacterBuildOptions {
  budgetMs?: number;
  /** v1 atlas edge. The current caller passes 256. */
  atlasSize?: number;
  /** v2 texture edge. v1 does not read this. */
  texSize?: number;
  /** v2 build cancellation. v1 does not read this. */
  signal?: AbortSignal;
}

export type CharacterSocket = 'hand_l' | 'hand_r' | 'back' | 'belt' | 'head';

/** What `build` returns. v1 fills object3D, mixer, clips, play, dispose, and info. */
export interface BuiltCharacter {
  object3D: Object3D;
  mixer: AnimationMixer;
  clips?: Record<string, AnimationClip>;
  play(name: 'Idle' | 'Walk', phase?: number): void;
  /** v2. v1 playback sets `mixer.timeScale` directly. */
  setTimeScale?(scale: number): void;
  /** v2 attachment point. */
  socket?(name: CharacterSocket): Object3D | null;
  /** v2 live recipe swap. */
  setRecipe?(recipe: unknown): void;
  dispose(): void;
  info?: {
    ms?: number;
    hash?: string;
    clipMap?: Record<string, string>;
    /** v2 cooperative step budget. Default 6. */
    budgetMs?: number;
    /** v2 catalog height of the built body, in metres. */
    heightM?: number;
  };
}

export interface CharacterEditReport {
  ok: boolean;
  recipe: unknown;
  errors: EditIssue[];
  warnings: EditIssue[];
}

/** v2 equip / unequip / dye. Not used by the v1 game path. */
export interface CharacterEquipResult {
  recipe: unknown;
  displaced?: unknown;
  hidden?: unknown;
  warnings?: unknown;
}

/** v2 `setLighting`. v1 lighting goes through `aimSun` -> `pixelSun`. */
export interface CharacterLighting {
  mode?: string;
  sunDir?: readonly [number, number, number];
  sunColor?: string | number;
  strength?: number;
}

export interface CharacterFeatures {
  describe: boolean;
  options: boolean;
  checkEdit: boolean;
  edit: boolean;
  editCatalog: boolean;
}

export interface CharacterBackend {
  readonly id: AvatarEngine;

  init(options: CharacterBackendInit): Promise<void>;
  dispose(): void;

  features(): CharacterFeatures;
  catalog(): ForgeCatalog | null;
  /** Live edit catalog. Null when the runtime has none. */
  editCatalog(): unknown | null;
  /**
   * Compact edit blob used when `options` is missing.
   * v1 returns `bundle.tags.edit`. v2 returns null.
   */
  offlineEditSource(): unknown | null;
  stats(): Record<string, number> | null;
  validateProfile(profile: unknown): ProfileReport;

  generate(request: CharacterGenerateRequest): unknown;
  describe(recipe: unknown): unknown;
  options(race: string, gender: 'm' | 'f', age: 'adult' | 'child'): unknown;
  checkEdit(recipe: unknown, patch: EditPatch): CharacterEditReport;
  edit(recipe: unknown, patch: EditPatch): unknown;

  recipeHash(recipe: unknown): string;
  packsFor(recipes: readonly unknown[]): string[];
  build(recipe: unknown, options: CharacterBuildOptions): Promise<BuiltCharacter>;

  /** Point the character sun. v1 calls `pixelSun(camera)`. */
  aimSun(camera: Camera): void;

  /** v2 `setLighting`. Optional so v1 does not pretend to implement it. */
  setLighting?(input: CharacterLighting): void;
  /** v2 `equip` / `unequip` / `dye`. */
  equip?(recipe: unknown, item: unknown): CharacterEquipResult;
  unequip?(recipe: unknown, slot: unknown): CharacterEquipResult;
  dye?(recipe: unknown, colors: unknown): CharacterEquipResult;
  /** v2 `migrate`. Save schema migration is separate and lives in core. */
  migrateRecipe?(recipe: unknown): unknown;
  /**
   * Warm the runtime and the race assets during the loading screen.
   * v1 has no equivalent. v2 calls `CF.preload`.
   */
  preload?(): Promise<void>;
}
