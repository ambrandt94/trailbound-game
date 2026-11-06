/**
 * The only Character Forge caller. Everyone else asks this module for a body.
 * Recipes stay opaque: generate from a seed plus a profile entry, then build.
 */
import * as THREE from 'three';
import type { PlayerProfileEntry } from '../../core/people/avatar';

export interface ForgeStatus {
  ok: boolean;
  reason: string;
  initMs: number;
}

export interface ProfileReport {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

export interface ForgeCatalog {
  races: string[];
  genders: Array<'m' | 'f'>;
  styles: string[];
  styleKinds: Record<string, string>;
  slots: string[];
  garmentsBySlot: Record<string, string[]>;
  regaliaMinRichness: number;
  regaliaStyles: string[];
  regaliaGarments: string[];
  flyerRaces: string[];
  generatorVersion: number;
  version: string;
}

/** Public fields the API documents, plus the untouched engine recipe. */
export interface CharacterRecipe {
  format: string;
  seed: number;
  generatorVersion: number;
  richness: number;
  style: string | null;
  readonly engine: unknown;
}

export interface EditIssue {
  path: string;
  code: string;
  msg: string;
  allowed?: unknown;
  from?: unknown;
  to?: unknown;
}

export interface EditReport {
  ok: boolean;
  recipe: CharacterRecipe | null;
  errors: EditIssue[];
  warnings: EditIssue[];
}

export type EditPatch = Record<string, unknown>;

export interface Swatch {
  id: string;
  rgb: number[];
  name?: string;
  suggested?: boolean;
  deniedSkins?: string[];
}

export interface HairStyleOption {
  id: string;
  name: string;
  /** Garment id → hair state while that hat is worn (under_hat, compressed, hidden). */
  headwear: Record<string, string>;
}

export interface SliderSpec {
  id: string;
  min: number;
  max: number;
  default: number;
  step: number;
  group?: string;
}

export interface GarmentOption {
  id: string;
  dyeRegions: string[];
  hairStates: Record<string, string> | null;
}

export interface EditOptions {
  race: string;
  gender: 'm' | 'f';
  age: 'adult' | 'child';
  skins: Swatch[];
  skinCustom: boolean;
  hairColors: Swatch[];
  iris: Swatch[];
  sclera: Swatch[];
  styles: HairStyleOption[];
  facialHair: Array<{ id: string; name: string }>;
  stubble: number[];
  hsld: Record<string, SliderSpec>;
  sliders: SliderSpec[];
  face: {
    presets: string[];
    shapes: string[];
    brows: string[];
    noses: string[];
    noseTypes: string[];
    mouths: string[];
    params: SliderSpec[];
  };
  slots: Record<string, GarmentOption[]>;
  palettes: Record<string, number[][]>;
  controls: Record<string, boolean>;
}

export interface WornPiece {
  id: string;
  states?: Record<string, string>;
}

export interface EditSnapshot {
  race: string;
  gender: 'm' | 'f';
  age: 'adult' | 'child';
  skin: string;
  hairColor: string;
  eyeColor: string | null;
  sclera: string | null;
  hairStyle: string | null;
  facialHair: string | null;
  stubble: number;
  hairGrey: number;
  beardGrey: number;
  hairLength: number;
  bangLength: number;
  beardLength: number;
  sliders: Record<string, number>;
  face: {
    preset?: string;
    shape: string | null;
    brow: string | null;
    nose: string | null;
    noseType: string | null;
    mouth: string | null;
    params: Record<string, number>;
  };
  outfit: Record<string, WornPiece | null>;
  dye: Record<string, Record<string, number[]>>;
}

export interface AvatarBody {
  object3D: THREE.Object3D;
  source: 'forge' | 'placeholder';
  recipeHash: string;
  clip: 'Idle' | 'Walk';
  play(name: 'Idle' | 'Walk'): void;
  update(dt: number): void;
  dispose(): void;
}

export interface ForgeTimings {
  initMs: number;
  buildMs: number;
}

interface InitOptions {
  baseUrl?: string;
  runtimeUrl?: string;
  /** Pass false to force the placeholder path. `?cf=0` does the same. */
  enabled?: boolean;
  profile?: unknown;
  force?: boolean;
}

interface CfBody {
  object3D: THREE.Group;
  mixer: THREE.AnimationMixer;
  play(name: 'Idle' | 'Walk', phase?: number): void;
  dispose(): void;
  info?: { ms?: number; hash?: string; clipMap?: Record<string, string> };
}

interface EngineRecipe {
  format?: string;
  seed?: number;
  generatorVersion?: number;
  richness?: number;
  style?: string | null;
  preset?: string;
  gender?: string;
}

interface CfApi {
  api: number;
  version: string | null;
  bundle: {
    engine?: { version?: string };
    generator?: { version?: number };
    tags?: {
      races?: string[];
      styles?: string[];
      styleKinds?: Record<string, string>;
      slots?: string[];
      garments?: Record<string, { slot?: string }>;
      regalia?: { minRichness?: number; styles?: string[]; garments?: string[]; races?: string[] };
      edit?: unknown;
    };
    clips?: { flyer?: unknown; flyerRaces?: string[] };
  };
  init(options: { THREE: typeof import('three'); baseUrl: string }): Promise<unknown>;
  generate(
    seed: number,
    profileEntry: PlayerProfileEntry,
    options?: { generatorVersion?: number; race?: string; gender?: string },
  ): EngineRecipe;
  packsFor(recipes: unknown[]): string[];
  build(recipe: unknown, options?: { budgetMs?: number; atlasSize?: number }): Promise<CfBody>;
  recipeHash(recipe: unknown): string;
  validateProfile(profile: unknown): ProfileReport;
  stats(): Record<string, number>;
  pixelSun?(camera: THREE.Camera): void;
  options?(race: string, gender: string, opts?: { age?: string }): unknown;
  describe?(recipe: unknown): unknown;
  checkEdit?(
    recipe: unknown,
    patch: unknown,
    opts?: { strict?: boolean },
  ): { ok: boolean; recipe: EngineRecipe | null; errors: EditIssue[]; warnings: EditIssue[] };
  edit?(recipe: unknown, patch: unknown, opts?: { strict?: boolean }): EngineRecipe;
  editCatalog?(): unknown;
}

const BUDGET_MS = 8;

let cf: CfApi | null = null;
let pixelSun: ((camera: THREE.Camera) => void) | null = null;
let pending: Promise<ForgeStatus> | null = null;
let status: ForgeStatus = { ok: false, reason: 'not started', initMs: 0 };
let catalog: ForgeCatalog | null = null;
let adopted: AvatarBody | null = null;
let buildMs = 0;
let buildError = '';

export function initForge(options: InitOptions = {}): Promise<ForgeStatus> {
  if (pending && !options.force) return pending;
  pending = runInit(options);
  return pending;
}

export function forgeReady(): ForgeStatus {
  return status;
}

export function forgeCatalog(): ForgeCatalog | null {
  return catalog;
}

export function forgeTimings(): ForgeTimings {
  return { initMs: status.initMs, buildMs };
}

export function forgeBuildError(): string {
  return buildError;
}

export function forgeStats(): Record<string, number> | null {
  if (!cf || !status.ok) return null;
  try {
    return cf.stats();
  } catch {
    return null;
  }
}

export function validateGameProfile(profile: unknown): ProfileReport {
  if (!cf || !status.ok) return { ok: false, errors: ['forge is not ready'], warnings: [] };
  return cf.validateProfile(profile);
}

export function generateRecipe(options: {
  seed: number;
  profileEntry: PlayerProfileEntry;
  generatorVersion?: number;
  race?: string;
  gender?: 'm' | 'f';
}): CharacterRecipe {
  if (!cf || !status.ok) throw new Error(status.reason || 'forge is not ready');
  const generatorVersion = options.generatorVersion ?? catalog?.generatorVersion ?? 1;
  const engine = cf.generate(options.seed >>> 0, options.profileEntry, {
    generatorVersion,
    race: options.race,
    gender: options.gender,
  });
  return wrapRecipe(engine, options.seed, generatorVersion);
}

/** Wrap a recipe that was stored in a save. The object is not edited here. */
export function recipeFromStored(engine: unknown, seed = 0): CharacterRecipe {
  if (!engine || typeof engine !== 'object') throw new Error('stored recipe is missing');
  return wrapRecipe(engine as EngineRecipe, seed, 1);
}

export function describeRecipe(recipe: CharacterRecipe): EditSnapshot {
  if (!cf?.describe || !status.ok) throw new Error(status.reason || 'forge is not ready');
  return normalizeSnapshot(cf.describe(recipe.engine));
}

export function optionsFor(
  race: string,
  gender: 'm' | 'f',
  age: 'adult' | 'child' = 'adult',
): EditOptions {
  if (cf?.options && status.ok) return normalizeOptions(cf.options(race, gender, { age }));
  const offline = offlineOptions(race, gender, age);
  if (offline) return offline;
  throw new Error(status.reason || 'forge is not ready');
}

export function checkRecipeEdit(recipe: CharacterRecipe, patch: EditPatch): EditReport {
  if (!cf?.checkEdit || !status.ok) {
    return {
      ok: false,
      recipe: null,
      errors: [{ path: '', code: 'unavailable', msg: 'forge is not ready' }],
      warnings: [],
    };
  }
  const report = cf.checkEdit(recipe.engine, patch);
  const next =
    report.ok && report.recipe
      ? wrapRecipe(report.recipe, recipe.seed, recipe.generatorVersion)
      : null;
  return {
    ok: report.ok,
    recipe: next,
    errors: report.errors ?? [],
    warnings: report.warnings ?? [],
  };
}

export function editRecipe(recipe: CharacterRecipe, patch: EditPatch): CharacterRecipe {
  if (!cf?.edit || !status.ok) throw new Error(status.reason || 'forge is not ready');
  return wrapRecipe(cf.edit(recipe.engine, patch), recipe.seed, recipe.generatorVersion);
}

export function recipeHashOf(recipe: CharacterRecipe): string {
  if (!cf || !status.ok) return `ph:${recipe.seed >>> 0}`;
  return cf.recipeHash(recipe.engine);
}

export function packsForRecipe(recipe: CharacterRecipe): string[] {
  if (!cf || !status.ok) return [];
  try {
    return cf.packsFor([recipe.engine]);
  } catch {
    return [];
  }
}

/** Bake a body. `budgetMs` yields the main thread so the UI does not hitch. */
export async function buildAvatar(
  recipe: CharacterRecipe,
  options: { budgetMs?: number } = {},
): Promise<AvatarBody> {
  if (!cf || !status.ok) return placeholderAvatar(recipe.seed);
  const started = now();
  buildError = '';
  try {
    const built = await cf.build(recipe.engine, {
      budgetMs: options.budgetMs ?? BUDGET_MS,
      atlasSize: 256,
    });
    buildMs = now() - started;
    return wrapForge(built, cf.recipeHash(recipe.engine));
  } catch (error) {
    buildMs = now() - started;
    buildError = error instanceof Error ? error.message : 'build failed';
    return placeholderAvatar(recipe.seed);
  }
}

export function placeholderAvatar(seed: number): AvatarBody {
  const group = new THREE.Group();
  group.name = 'tb-placeholder';
  const tunic = new THREE.MeshLambertMaterial({ color: '#c45c3a' });
  const skin = new THREE.MeshLambertMaterial({ color: '#e0b090' });
  const cloth = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.72, 4, 10), tunic);
  cloth.position.y = 0.78;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 14, 12), skin);
  head.position.y = 1.42;
  const bob = new THREE.Group();
  bob.add(cloth, head);
  group.add(bob);

  const state = { clip: 'Idle' as 'Idle' | 'Walk', time: 0, disposed: false };
  const body: AvatarBody = {
    object3D: group,
    source: 'placeholder',
    recipeHash: `ph:${seed >>> 0}`,
    clip: 'Idle',
    play(name) {
      state.clip = name;
      body.clip = name;
    },
    update(dt) {
      if (state.disposed) return;
      state.time += dt;
      bob.position.y = state.clip === 'Walk' ? Math.sin(state.time * 8) * 0.05 : 0;
    },
    dispose() {
      if (state.disposed) return;
      state.disposed = true;
      cloth.geometry.dispose();
      head.geometry.dispose();
      tunic.dispose();
      skin.dispose();
      group.removeFromParent();
      if (adopted === body) adopted = null;
    },
  };
  return body;
}

export function adoptPlayerBody(body: AvatarBody | null): void {
  if (adopted && adopted !== body) adopted.dispose();
  adopted = body;
}

/** Body the area controller should parent. Null until a look has been confirmed. */
export function getPlayerBody(): AvatarBody | null {
  return adopted;
}

export function tickPlayerBody(dt: number): void {
  adopted?.update(dt);
}

export function aimForgeSun(camera: THREE.Camera): void {
  pixelSun?.(camera);
}

async function runInit(options: InitOptions): Promise<ForgeStatus> {
  const started = now();
  catalog = null;
  cf = null;
  pixelSun = null;
  if (options.enabled === false || queryDisablesForge()) {
    status = { ok: false, reason: 'cf=0', initMs: now() - started };
    return status;
  }
  try {
    const runtimeUrl = options.runtimeUrl ?? defaultRuntimeUrl();
    const loaded = (await import(/* @vite-ignore */ runtimeUrl)) as { default: CfApi };
    const api = loaded.default;
    if (!api || typeof api.init !== 'function' || api.api !== 1) {
      throw new Error('character runtime api mismatch');
    }
    await api.init({ THREE, baseUrl: options.baseUrl ?? defaultBaseUrl() });
    cf = api;
    pixelSun = typeof api.pixelSun === 'function' ? api.pixelSun.bind(api) : null;
    catalog = readCatalog(api);
    if (options.profile) {
      const report = api.validateProfile(options.profile);
      if (!report.ok) console.warn('trailbound character profile', report.errors);
    }
    status = { ok: true, reason: '', initMs: now() - started };
    return status;
  } catch (error) {
    cf = null;
    catalog = null;
    status = {
      ok: false,
      reason: error instanceof Error ? error.message : 'forge init failed',
      initMs: now() - started,
    };
    return status;
  }
}

function wrapForge(built: CfBody, hash: string): AvatarBody {
  const state = { clip: 'Idle' as 'Idle' | 'Walk', disposed: false };
  built.object3D.name = 'CF_avatar';
  built.play('Idle');
  const body: AvatarBody = {
    object3D: built.object3D,
    source: 'forge',
    recipeHash: hash,
    clip: 'Idle',
    play(name) {
      state.clip = name;
      body.clip = name;
      built.play(name);
    },
    update(dt) {
      if (!state.disposed) built.mixer.update(dt);
    },
    dispose() {
      if (state.disposed) return;
      state.disposed = true;
      built.dispose();
      if (adopted === body) adopted = null;
    },
  };
  return body;
}

function readCatalog(api: CfApi): ForgeCatalog {
  const tags = api.bundle?.tags ?? {};
  const garmentsBySlot: Record<string, string[]> = {};
  for (const slot of tags.slots ?? []) garmentsBySlot[slot] = [];
  for (const [id, info] of Object.entries(tags.garments ?? {})) {
    const slot = info?.slot;
    if (!slot) continue;
    const list = garmentsBySlot[slot] ?? [];
    list.push(id);
    garmentsBySlot[slot] = list;
  }
  for (const list of Object.values(garmentsBySlot)) list.sort();
  const regalia = tags.regalia ?? {};
  const flyerRaces = Array.isArray(api.bundle?.clips?.flyerRaces)
    ? api.bundle.clips.flyerRaces
    : api.bundle?.clips?.flyer
      ? ['pixie']
      : [];
  return {
    races: [...(tags.races ?? [])],
    genders: ['m', 'f'],
    styles: [...(tags.styles ?? [])],
    styleKinds: { ...(tags.styleKinds ?? {}) },
    slots: [...(tags.slots ?? [])],
    garmentsBySlot,
    regaliaMinRichness: typeof regalia.minRichness === 'number' ? regalia.minRichness : 0.85,
    regaliaStyles: [...(regalia.styles ?? [])],
    regaliaGarments: [...(regalia.garments ?? [])],
    flyerRaces,
    generatorVersion: api.bundle?.generator?.version ?? 1,
    version: api.version ?? api.bundle?.engine?.version ?? '',
  };
}

function wrapRecipe(engine: EngineRecipe, seed: number, generatorVersion: number): CharacterRecipe {
  return {
    format: typeof engine.format === 'string' ? engine.format : 'cf.character',
    seed: typeof engine.seed === 'number' ? engine.seed : seed >>> 0,
    generatorVersion:
      typeof engine.generatorVersion === 'number' ? engine.generatorVersion : generatorVersion,
    richness: typeof engine.richness === 'number' ? engine.richness : 0,
    style: typeof engine.style === 'string' || engine.style === null ? engine.style : null,
    engine,
  };
}

export function cloneRecipe(recipe: CharacterRecipe): CharacterRecipe {
  return wrapRecipe(
    JSON.parse(JSON.stringify(recipe.engine)) as EngineRecipe,
    recipe.seed,
    recipe.generatorVersion,
  );
}

function normalizeSnapshot(value: unknown): EditSnapshot {
  const raw = isRecord(value) ? value : {};
  const face = isRecord(raw.face) ? raw.face : {};
  const params = isRecord(face.params) ? face.params : {};
  const outfit: Record<string, WornPiece | null> = {};
  if (isRecord(raw.outfit)) {
    for (const [slot, piece] of Object.entries(raw.outfit)) {
      if (piece === null) outfit[slot] = null;
      else if (isRecord(piece) && typeof piece.id === 'string') {
        outfit[slot] = {
          id: piece.id,
          states: isRecord(piece.states) ? stringMap(piece.states) : undefined,
        };
      }
    }
  }
  const dye: Record<string, Record<string, number[]>> = {};
  if (isRecord(raw.dye)) {
    for (const [id, regions] of Object.entries(raw.dye)) {
      if (!isRecord(regions)) continue;
      const next: Record<string, number[]> = {};
      for (const [region, rgb] of Object.entries(regions)) {
        if (Array.isArray(rgb)) next[region] = rgb.map((channel) => Number(channel));
      }
      dye[id] = next;
    }
  }
  const skin = raw.skin;
  return {
    race: typeof raw.race === 'string' ? raw.race : 'human',
    gender: raw.gender === 'f' ? 'f' : 'm',
    age: raw.age === 'child' ? 'child' : 'adult',
    skin: typeof skin === 'string' ? skin : 'custom',
    hairColor: typeof raw.hairColor === 'string' ? raw.hairColor : '',
    eyeColor: typeof raw.eyeColor === 'string' ? raw.eyeColor : null,
    sclera: typeof raw.sclera === 'string' ? raw.sclera : null,
    hairStyle: typeof raw.hairStyle === 'string' ? raw.hairStyle : null,
    facialHair: typeof raw.facialHair === 'string' ? raw.facialHair : null,
    stubble: typeof raw.stubble === 'number' ? raw.stubble : 0,
    hairGrey: num(raw.hairGrey),
    beardGrey: num(raw.beardGrey),
    hairLength: num(raw.hairLength),
    bangLength: num(raw.bangLength),
    beardLength: num(raw.beardLength),
    sliders: numberMap(raw.sliders),
    face: {
      shape: typeof face.shape === 'string' ? face.shape : null,
      brow: typeof face.brow === 'string' ? face.brow : null,
      nose: typeof face.nose === 'string' ? face.nose : null,
      noseType: typeof face.noseType === 'string' ? face.noseType : null,
      mouth: typeof face.mouth === 'string' ? face.mouth : null,
      params: numberMap(params),
    },
    outfit,
    dye,
  };
}

function normalizeOptions(value: unknown): EditOptions {
  const raw = isRecord(value) ? value : {};
  const face = isRecord(raw.face) ? raw.face : {};
  const slots: Record<string, GarmentOption[]> = {};
  if (isRecord(raw.slots)) {
    for (const [slot, list] of Object.entries(raw.slots)) {
      if (!Array.isArray(list)) continue;
      slots[slot] = list
        .map((item) => {
          if (typeof item === 'string') return { id: item, dyeRegions: [], hairStates: null };
          const record = isRecord(item) ? item : {};
          return {
            id: typeof record.id === 'string' ? record.id : '',
            dyeRegions: Array.isArray(record.dyeRegions)
              ? record.dyeRegions.filter((region): region is string => typeof region === 'string')
              : [],
            hairStates: isRecord(record.hairStates) ? stringMap(record.hairStates) : null,
          };
        })
        .filter((item) => item.id);
    }
  }
  return {
    race: typeof raw.race === 'string' ? raw.race : '',
    gender: raw.gender === 'f' ? 'f' : 'm',
    age: raw.age === 'child' ? 'child' : 'adult',
    skins: swatches(raw.skins),
    skinCustom: raw.skinCustom !== false,
    hairColors: swatches(raw.hairColors),
    iris: swatches(raw.iris),
    sclera: swatches(raw.sclera),
    styles: styleOptions(raw.styles),
    facialHair: nameList(raw.facialHair),
    stubble: Array.isArray(raw.stubble) ? raw.stubble.map((item) => Number(item)) : [0],
    hsld: sliderRecord(raw.hsld),
    sliders: sliderList(raw.sliders),
    face: {
      presets: strings(face.presets),
      shapes: strings(face.shapes),
      brows: strings(face.brows),
      noses: strings(face.noses),
      noseTypes: strings(face.noseTypes),
      mouths: strings(face.mouths),
      params: sliderList(face.params),
    },
    slots,
    palettes: paletteMap(raw.palettes),
    controls: boolMap(raw.controls),
  };
}

function offlineOptions(
  race: string,
  gender: 'm' | 'f',
  age: 'adult' | 'child',
): EditOptions | null {
  const edit = cf?.bundle?.tags?.edit;
  if (!isRecord(edit) || !isRecord(edit.options) || !isRecord(edit.catalog)) return null;
  const byRace = edit.options[race];
  if (!isRecord(byRace)) return null;
  const byGender = byRace[gender];
  if (!isRecord(byGender)) return null;
  const compact = byGender[age];
  if (!isRecord(compact)) return null;
  const catalog = edit.catalog;
  const skins = isRecord(catalog.skins) ? catalog.skins : {};
  const hair = isRecord(catalog.hairColors) ? catalog.hairColors : {};
  const iris = isRecord(catalog.iris) ? catalog.iris : {};
  const sclera = isRecord(catalog.sclera) ? catalog.sclera : {};
  const styles = isRecord(catalog.styles) ? catalog.styles : {};
  const facial = isRecord(catalog.facialHair) ? catalog.facialHair : {};
  const garments = isRecord(catalog.garments) ? catalog.garments : {};
  const slotsByAge = isRecord(catalog.slotsByAge) ? catalog.slotsByAge : {};
  const ageSlots = isRecord(slotsByAge[age]) ? slotsByAge[age] : {};
  const expand = (ids: unknown, table: Record<string, unknown>): Swatch[] =>
    strings(ids).map((id) => {
      const row = isRecord(table[id]) ? table[id] : {};
      return {
        id,
        rgb: Array.isArray(row.rgb) ? row.rgb.map((channel) => Number(channel)) : [],
        name: typeof row.name === 'string' ? row.name : undefined,
        deniedSkins: strings(row.deniedSkins),
      };
    });
  const slots: Record<string, GarmentOption[]> = {};
  for (const [slot, ids] of Object.entries(ageSlots)) {
    slots[slot] = strings(ids).map((id) => {
      const row = isRecord(garments[id]) ? garments[id] : {};
      const regions = Array.isArray(row.dyeRegions) ? row.dyeRegions : [];
      return {
        id,
        dyeRegions: regions
          .map((region) => (isRecord(region) && typeof region.name === 'string' ? region.name : ''))
          .filter((name) => name.length > 0),
        hairStates: isRecord(row.hairStates) ? stringMap(row.hairStates) : null,
      };
    });
  }
  const sliderTable = isRecord(compact.sliders) ? compact.sliders : {};
  const groups = isRecord(catalog.sliderGroups) ? catalog.sliderGroups : {};
  const sliders: SliderSpec[] = [];
  for (const [id, range] of Object.entries(sliderTable)) {
    if (!Array.isArray(range)) continue;
    sliders.push({
      id,
      min: Number(range[0] ?? -1),
      max: Number(range[1] ?? 1),
      default: Number(range[2] ?? 0),
      step: typeof catalog.sliderStep === 'number' ? catalog.sliderStep : 0.01,
      group: typeof groups[id] === 'string' ? groups[id] : undefined,
    });
  }
  const face = isRecord(compact.face) ? compact.face : {};
  const catalogFace = isRecord(catalog.face) ? catalog.face : {};
  return {
    race,
    gender,
    age,
    skins: expand(compact.skins, skins),
    skinCustom: compact.skinCustom !== false,
    hairColors: expand(compact.hairColors, hair),
    iris: expand(compact.iris, iris),
    sclera: expand(compact.sclera, sclera),
    styles: strings(compact.styles).map((id) => {
      const row = isRecord(styles[id]) ? styles[id] : {};
      return {
        id,
        name: typeof row.name === 'string' ? row.name : id,
        headwear: isRecord(row.headwear) ? stringMap(row.headwear) : {},
      };
    }),
    facialHair: strings(compact.facialHair).map((id) => {
      const row = isRecord(facial[id]) ? facial[id] : {};
      return { id, name: typeof row.name === 'string' ? row.name : id };
    }),
    stubble: Array.isArray(compact.stubble) ? compact.stubble.map((item) => Number(item)) : [0],
    hsld: {},
    sliders,
    face: {
      presets: strings(face.presets),
      shapes: strings(face.shapes),
      brows: strings(face.brows),
      noses: strings(face.noses),
      noseTypes: strings(face.noseTypes),
      mouths: strings(face.mouths),
      params: sliderList(catalogFace.params),
    },
    slots,
    palettes: paletteMap(catalog.palettes),
    controls: {},
  };
}

function swatches(value: unknown): Swatch[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === 'string') return { id: item, rgb: [] };
      const record = isRecord(item) ? item : {};
      return {
        id: typeof record.id === 'string' ? record.id : '',
        rgb: Array.isArray(record.rgb) ? record.rgb.map((channel) => Number(channel)) : [],
        name: typeof record.name === 'string' ? record.name : undefined,
        suggested: record.suggested === true,
        deniedSkins: strings(record.deniedSkins),
      };
    })
    .filter((item) => item.id);
}

function styleOptions(value: unknown): HairStyleOption[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const record = isRecord(item) ? item : {};
      const id = typeof record.id === 'string' ? record.id : typeof item === 'string' ? item : '';
      return {
        id,
        name: typeof record.name === 'string' ? record.name : id,
        headwear: isRecord(record.headwear) ? stringMap(record.headwear) : {},
      };
    })
    .filter((item) => item.id);
}

function nameList(value: unknown): Array<{ id: string; name: string }> {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === 'string') return { id: item, name: item };
      const record = isRecord(item) ? item : {};
      const id = typeof record.id === 'string' ? record.id : '';
      return { id, name: typeof record.name === 'string' ? record.name : id };
    })
    .filter((item) => item.id);
}

function sliderList(value: unknown): SliderSpec[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => sliderSpec(isRecord(item) ? item : {}, '')).filter((item) => item.id);
}

function sliderRecord(value: unknown): Record<string, SliderSpec> {
  if (!isRecord(value)) return {};
  const out: Record<string, SliderSpec> = {};
  for (const [id, spec] of Object.entries(value)) {
    if (!isRecord(spec)) continue;
    out[id] = sliderSpec(spec, id);
  }
  return out;
}

function sliderSpec(record: Record<string, unknown>, fallbackId: string): SliderSpec {
  return {
    id: typeof record.id === 'string' ? record.id : fallbackId,
    min: num(record.min, -1),
    max: num(record.max, 1),
    default: num(record.default, 0),
    step: num(record.step, 0.01),
    group: typeof record.group === 'string' ? record.group : undefined,
  };
}

function paletteMap(value: unknown): Record<string, number[][]> {
  if (!isRecord(value)) return {};
  const out: Record<string, number[][]> = {};
  for (const [name, rows] of Object.entries(value)) {
    if (!Array.isArray(rows)) continue;
    out[name] = rows
      .filter((row) => Array.isArray(row))
      .map((row) => (row as unknown[]).map((channel) => Number(channel)));
  }
  return out;
}

function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function stringMap(value: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'string') out[key] = item;
  }
  return out;
}

function numberMap(value: unknown): Record<string, number> {
  if (!isRecord(value)) return {};
  const out: Record<string, number> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'number' && Number.isFinite(item)) out[key] = item;
  }
  return out;
}

function boolMap(value: unknown): Record<string, boolean> {
  if (!isRecord(value)) return {};
  const out: Record<string, boolean> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'boolean') out[key] = item;
  }
  return out;
}

function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function queryDisablesForge(): boolean {
  try {
    return new URLSearchParams(globalThis.location?.search ?? '').get('cf') === '0';
  } catch {
    return false;
  }
}

function defaultRuntimeUrl(): string {
  return resolvePublic('vendor/character-forge/1.2.0/cf-runtime.mjs');
}

function defaultBaseUrl(): string {
  return resolvePublic('vendor/character-forge/1.2.0/');
}

function resolvePublic(path: string): string {
  const base = import.meta.env.BASE_URL || './';
  const relative = `${base.endsWith('/') ? base : `${base}/`}${path}`;
  if (typeof location !== 'undefined' && location.href)
    return new URL(relative, location.href).href;
  return relative;
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
