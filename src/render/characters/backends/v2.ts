/**
 * Character Forge 2.1 backend. This is the only file that imports the v2
 * runtime or calls `CF.*` for api 2. v1 stays in `backends/v1.ts`.
 */
import * as THREE from 'three';
import type { PlayerProfileEntry } from '../../../core/people/avatar';
import { CF2_PIN } from '../cf-pin';
import type { EditPatch, ForgeCatalog, ProfileReport } from '../forge';
import { notePlaceholderRaces, v2RaceId, V1_TO_V2_RACE } from './race-map';
import type {
  BuiltCharacter,
  CharacterBackend,
  CharacterBackendInit,
  CharacterBuildOptions,
  CharacterEditReport,
  CharacterEquipResult,
  CharacterFeatures,
  CharacterGenerateRequest,
  CharacterLighting,
  CharacterSocket,
} from './types';

/** Trailbound sun from the v2 lighting table (`dirs.tb_sun`). View space, like v1 `pixelSun`. */
const TRAILBOUND_SUN = new THREE.Vector3(-27, 28, 27).normalize();

const DEFAULT_BUDGET_MS = 6;

interface CfIssue {
  path?: string;
  code?: string;
  msg?: string;
}

interface CfRecipe {
  format?: string;
  v?: number;
  race?: string;
  preset?: string;
  seed?: number;
  generatorVersion?: number;
  richness?: number;
  style?: string | null;
  bodyType?: string;
  tone?: number;
  hair?: string;
  hairColor?: string;
  beard?: string;
  iris?: string;
  body?: { h?: number; b?: number; s?: number };
  outfit?: Record<string, { id?: string; states?: Record<string, string> } | null>;
}

interface CfBody {
  object3D: THREE.Group;
  mixer: THREE.AnimationMixer;
  clips: Record<string, THREE.AnimationClip>;
  info: {
    ms?: number;
    hash?: string;
    budgetMs?: number;
    heightM?: number;
    race?: string;
    steps?: number;
  };
  play(name?: string, opts?: { fade?: number; timeScale?: number }): THREE.AnimationAction;
  setTimeScale(scale: number): void;
  socket(name: string): THREE.Object3D | null;
  setRecipe(next: unknown, opts?: { budgetMs?: number; signal?: AbortSignal }): Promise<unknown>;
  dispose(): void;
}

interface Cf2Api {
  api: number;
  version: string;
  generatorVersion: number;
  freeCpuGeometry: boolean;
  init(options: {
    THREE: typeof import('three');
    baseUrl: string;
    policy?: { animationSet: 'cf' | 'cf+ki'; missingRaces: Record<string, string> };
    privateAnimBaseUrl?: string;
  }): Promise<unknown>;
  setPolicy(policy: { animationSet?: string; missingRaces?: Record<string, string> }): unknown;
  getPolicy(): { animationSet?: string; regaliaMinRichness?: number };
  preload(what: readonly string[], options?: { signal?: AbortSignal }): Promise<void>;
  races(): string[];
  catalog(): {
    races?: Record<
      string,
      { heightM?: number; strideM?: number; walkDuration?: number; flyer?: boolean }
    >;
    slots?: Record<string, { region?: string }>;
    garments?: Record<string, { slot?: string }>;
  };
  randomRecipe(
    seed: number,
    options?: {
      race?: string;
      races?: Record<string, number>;
      bodyType?: string;
      role?: string;
      style?: string;
      tier?: string;
      richness?: number;
      outfit?: unknown;
    },
  ): CfRecipe;
  generate(
    seed: number,
    profileEntry?: PlayerProfileEntry,
    options?: { race?: string; gender?: string },
  ): CfRecipe;
  recipeHash(recipe: unknown): string;
  describe(recipe: unknown): unknown;
  options(race: string, bodyType?: string): unknown;
  checkEdit(
    recipe: unknown,
    patch: unknown,
  ): { ok: boolean; recipe: unknown; errors?: CfIssue[]; warnings?: CfIssue[] };
  edit(recipe: unknown, patch: unknown): CfRecipe;
  equip(
    recipe: unknown,
    slot: string,
    garmentId: string,
    options?: { variant?: string; states?: unknown },
  ): CharacterEquipResult;
  unequip(recipe: unknown, slot: string): CharacterEquipResult;
  dye(
    recipe: unknown,
    garmentId: string,
    region: string | Record<string, string>,
    value?: string,
  ): CharacterEquipResult;
  migrate(
    recipe: unknown,
    options?: { to?: 2 },
  ): { recipe: CfRecipe; lossy: boolean; notes: string[] };
  validateProfile(profile: unknown): { ok: boolean; errors?: unknown; warnings?: unknown };
  stats(): { bodies?: number; engineLoaded?: boolean };
  build(
    recipe: unknown,
    options?: { budgetMs?: number; texSize?: number; signal?: AbortSignal },
  ): Promise<CfBody>;
  setLighting(input: {
    mode?: string;
    sunDir?: [number, number, number];
    strength?: number;
  }): unknown;
  dispose(): void;
}

export function createV2Backend(): CharacterBackend {
  let api: Cf2Api | null = null;
  let catalog: ForgeCatalog | null = null;

  return {
    id: 'cf2',

    async init(options: CharacterBackendInit): Promise<void> {
      const loaded = (await import(/* @vite-ignore */ options.runtimeUrl)) as { default: Cf2Api };
      const next = loaded.default;
      if (!next || typeof next.init !== 'function' || next.api !== 2) {
        throw new Error('character runtime api mismatch');
      }
      // CPU geometry stays. The area renderer is disposed on every return to
      // the map, and a later visit uploads this same body again.
      next.freeCpuGeometry = false;
      const privateUrl = resolvePrivateAnimUrl(options.privateAnimBaseUrl);
      await next.init({
        THREE,
        baseUrl: options.baseUrl,
        policy: {
          animationSet: privateUrl ? 'cf+ki' : 'cf',
          missingRaces: { ...V1_TO_V2_RACE },
        },
        ...(privateUrl ? { privateAnimBaseUrl: privateUrl } : {}),
      });
      if (
        next.version !== CF2_PIN.version ||
        next.generatorVersion !== Number(CF2_PIN.generatorVersion)
      ) {
        throw new Error(
          `character runtime ${next.version} generator ${String(next.generatorVersion)} does not match pin ${CF2_PIN.version} generator ${CF2_PIN.generatorVersion}`,
        );
      }
      if (next.getPolicy().animationSet !== (privateUrl ? 'cf+ki' : 'cf')) {
        throw new Error('character runtime animation policy mismatch');
      }
      api = next;
      catalog = readCatalog(next);
      if (options.profile) {
        const report = profileReport(next.validateProfile(options.profile));
        if (!report.ok) console.warn('trailbound character profile', report.errors);
      }
    },

    dispose(): void {
      api?.dispose();
      api = null;
      catalog = null;
    },

    features(): CharacterFeatures {
      return {
        describe: typeof api?.describe === 'function',
        options: typeof api?.options === 'function',
        checkEdit: typeof api?.checkEdit === 'function',
        edit: typeof api?.edit === 'function',
        editCatalog: false,
      };
    },

    catalog(): ForgeCatalog | null {
      return catalog;
    },

    editCatalog(): null {
      return null;
    },

    offlineEditSource(): null {
      return null;
    },

    stats(): Record<string, number> | null {
      if (!api) return null;
      const raw = api.stats();
      return {
        bodies: raw.bodies ?? 0,
        engineLoaded: raw.engineLoaded ? 1 : 0,
      };
    },

    validateProfile(profile: unknown): ProfileReport {
      if (!api) return { ok: false, errors: ['forge is not ready'], warnings: [] };
      return profileReport(api.validateProfile(profile));
    },

    generate(request: CharacterGenerateRequest): unknown {
      if (!api) throw new Error('forge is not ready');
      const entry = mapProfile(request.profileEntry);
      notePlaceholderRaces([
        ...Object.keys(request.profileEntry.races ?? {}),
        ...(request.race ? [request.race] : []),
      ]);
      const race = request.race ? v2RaceId(request.race) : undefined;
      if (
        request.bodyType ||
        request.role ||
        request.tier ||
        request.outfit != null ||
        request.richness != null
      ) {
        return api.randomRecipe(request.seed >>> 0, {
          race,
          races: entry.races,
          bodyType: request.bodyType ?? bodyTypeFor(request.gender),
          role: request.role ?? firstKey(entry.styles),
          style: firstKey(entry.styles),
          tier: request.tier,
          richness: request.richness ?? entry.richness,
          outfit: request.outfit,
        });
      }
      return api.generate(request.seed >>> 0, entry, {
        race,
        gender: request.gender,
      });
    },

    describe(recipe: unknown): unknown {
      if (!api) throw new Error('forge is not ready');
      return describeForCreator(api.describe(recipe));
    },

    options(race: string, gender: 'm' | 'f', age: 'adult' | 'child'): unknown {
      if (!api) throw new Error('forge is not ready');
      notePlaceholderRaces([race]);
      return optionsForCreator(
        api.options(v2RaceId(race), gender === 'f' ? 'fem' : 'masc'),
        gender,
        age,
      );
    },

    checkEdit(recipe: unknown, patch: EditPatch): CharacterEditReport {
      if (!api) throw new Error('forge is not ready');
      const report = api.checkEdit(recipe, toV2Patch(patch));
      return {
        ok: report.ok,
        recipe: report.recipe,
        errors: asIssues(report.errors),
        warnings: asIssues(report.warnings),
      };
    },

    edit(recipe: unknown, patch: EditPatch): unknown {
      if (!api) throw new Error('forge is not ready');
      return api.edit(recipe, toV2Patch(patch));
    },

    recipeHash(recipe: unknown): string {
      if (!api) throw new Error('forge is not ready');
      return api.recipeHash(recipe);
    },

    packsFor(): string[] {
      return [];
    },

    async build(recipe: unknown, options: CharacterBuildOptions): Promise<BuiltCharacter> {
      if (!api) throw new Error('forge is not ready');
      const budgetMs = options.budgetMs ?? DEFAULT_BUDGET_MS;
      const texSize = options.texSize === 128 || options.texSize === 512 ? options.texSize : 256;
      const body = await api.build(recipe, {
        budgetMs,
        texSize,
        signal: options.signal,
      });
      const raceId = body.info?.race;
      const metrics = raceId ? catalog?.raceMetrics?.[raceId] : undefined;
      const walk = body.clips?.Walk;
      body.object3D.userData.cfMetrics = {
        heightM: body.info?.heightM ?? metrics?.heightM ?? 0,
        strideM: metrics?.strideM ?? 0,
        walkDuration: walk?.duration ?? metrics?.walkDuration ?? 0,
      };
      return {
        object3D: body.object3D,
        mixer: body.mixer,
        clips: body.clips,
        play(name, phase) {
          const action = body.play(name);
          if (typeof phase === 'number' && Number.isFinite(phase)) action.time = phase;
        },
        setTimeScale(scale) {
          body.setTimeScale(scale);
        },
        socket(name: CharacterSocket) {
          return body.socket(name);
        },
        setRecipe(next) {
          return body.setRecipe(next, { budgetMs, signal: options.signal });
        },
        dispose() {
          body.dispose();
        },
        info: {
          ms: body.info?.ms,
          hash: body.info?.hash,
          budgetMs: body.info?.budgetMs,
          heightM: body.info?.heightM,
          clipMap: Object.fromEntries(Object.keys(body.clips ?? {}).map((name) => [name, name])),
        },
      };
    },

    aimSun(camera: THREE.Camera): void {
      if (!api) return;
      camera.updateMatrixWorld();
      const view = TRAILBOUND_SUN.clone().transformDirection(camera.matrixWorldInverse);
      // v2 rewrites mode `pixel` to its trailbound sun. `sunColor` is accepted and unused.
      api.setLighting({
        mode: 'pixel',
        sunDir: [view.x, view.y, view.z],
        strength: 1,
      });
    },

    setLighting(input: CharacterLighting): void {
      if (!api) return;
      api.setLighting({
        mode: input.mode,
        sunDir: input.sunDir ? [input.sunDir[0], input.sunDir[1], input.sunDir[2]] : undefined,
        strength: input.strength,
      });
    },

    equip(recipe: unknown, item: unknown): CharacterEquipResult {
      if (!api) throw new Error('forge is not ready');
      const record = isRecord(item) ? item : {};
      const id = typeof record.id === 'string' ? record.id : typeof item === 'string' ? item : '';
      const slot = typeof record.slot === 'string' ? record.slot : '';
      return api.equip(recipe, slot, id, {
        variant: typeof record.variant === 'string' ? record.variant : undefined,
        states: isRecord(record.states) ? record.states : undefined,
      });
    },

    unequip(recipe: unknown, slot: unknown): CharacterEquipResult {
      if (!api) throw new Error('forge is not ready');
      return api.unequip(recipe, typeof slot === 'string' ? slot : '');
    },

    dye(recipe: unknown, colors: unknown): CharacterEquipResult {
      if (!api) throw new Error('forge is not ready');
      const record = isRecord(colors) ? colors : {};
      const garment = typeof record.garment === 'string' ? record.garment : '';
      if (isRecord(record.regions)) {
        const regions: Record<string, string> = {};
        for (const [name, value] of Object.entries(record.regions)) {
          if (typeof value === 'string') regions[name] = value;
        }
        return api.dye(recipe, garment, regions);
      }
      return api.dye(
        recipe,
        garment,
        typeof record.region === 'string' ? record.region : '',
        typeof record.value === 'string' ? record.value : undefined,
      );
    },

    migrateRecipe(recipe: unknown): unknown {
      if (!api) throw new Error('forge is not ready');
      const copy = JSON.parse(JSON.stringify(recipe)) as CfRecipe;
      notePlaceholderRaces(
        [copy.preset, copy.race].filter((race): race is string => typeof race === 'string'),
      );
      return api.migrate(copy, { to: 2 }).recipe;
    },

    async preload(): Promise<void> {
      if (!api) throw new Error('forge is not ready');
      await api.preload(api.races());
    },
  };
}

function resolvePrivateAnimUrl(explicit: string | undefined): string | undefined {
  if (explicit !== undefined) {
    const trimmed = explicit.trim();
    return trimmed || undefined;
  }
  const value = (import.meta.env as { VITE_CF_PRIVATE_ANIM_URL?: unknown })
    .VITE_CF_PRIVATE_ANIM_URL;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function mapProfile(entry: PlayerProfileEntry): PlayerProfileEntry {
  if (!entry.races) return entry;
  const races: Record<string, number> = {};
  for (const [id, weight] of Object.entries(entry.races)) {
    const next = v2RaceId(id);
    races[next] = (races[next] ?? 0) + (typeof weight === 'number' ? weight : 0);
  }
  return { ...entry, races };
}

function bodyTypeFor(gender: 'm' | 'f' | undefined): string | undefined {
  if (gender === 'f') return 'fem';
  if (gender === 'm') return 'masc';
  return undefined;
}

function firstKey(table: Record<string, number> | undefined): string | undefined {
  if (!table) return undefined;
  return Object.keys(table).sort()[0];
}

function readCatalog(api: Cf2Api): ForgeCatalog {
  const raw = api.catalog();
  const races = raw.races ?? {};
  const ids = Object.keys(races);
  const garmentsBySlot: Record<string, string[]> = {};
  for (const slot of Object.keys(raw.slots ?? {})) garmentsBySlot[slot] = [];
  for (const [id, info] of Object.entries(raw.garments ?? {})) {
    const slot = info?.slot;
    if (!slot) continue;
    const list = garmentsBySlot[slot] ?? [];
    list.push(id);
    garmentsBySlot[slot] = list;
  }
  for (const list of Object.values(garmentsBySlot)) list.sort();
  const raceMetrics: Record<string, { heightM: number; strideM: number; walkDuration?: number }> =
    {};
  const flyerRaces: string[] = [];
  for (const id of ids) {
    const race = races[id];
    if (!race) continue;
    raceMetrics[id] = {
      heightM: typeof race.heightM === 'number' ? race.heightM : 0,
      strideM: typeof race.strideM === 'number' ? race.strideM : 0,
      walkDuration: typeof race.walkDuration === 'number' ? race.walkDuration : undefined,
    };
    if (race.flyer) flyerRaces.push(id);
  }
  return {
    races: ids,
    genders: ['m', 'f'],
    styles: [],
    styleKinds: {},
    slots: Object.keys(raw.slots ?? {}),
    garmentsBySlot,
    regaliaMinRichness: api.getPolicy().regaliaMinRichness ?? 0.85,
    regaliaStyles: [],
    regaliaGarments: [],
    flyerRaces,
    generatorVersion: api.generatorVersion,
    version: api.version,
    raceMetrics,
  };
}

function describeForCreator(value: unknown): unknown {
  const raw = isRecord(value) ? value : {};
  const values = isRecord(raw.values) ? raw.values : {};
  const resolved = isRecord(raw.resolved) ? raw.resolved : {};
  const tone = isRecord(raw.tone) ? raw.tone : {};
  const body = isRecord(values.body) ? values.body : {};
  const outfit: Record<string, { id: string; states?: Record<string, string> } | null> = {};
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
  const beard = typeof values.beard === 'string' ? values.beard : '';
  return {
    race: typeof raw.race === 'string' ? raw.race : 'human',
    gender: raw.bodyType === 'fem' ? 'f' : 'm',
    age: 'adult',
    skin: typeof tone.index === 'number' ? String(tone.index) : '0',
    hairColor: typeof resolved.hairColor === 'string' ? resolved.hairColor : '',
    eyeColor: typeof resolved.iris === 'string' && resolved.iris !== 'auto' ? resolved.iris : null,
    sclera: null,
    hairStyle: typeof resolved.hair === 'string' ? resolved.hair : null,
    facialHair: beard && beard !== 'none' && beard !== 'auto' ? beard : null,
    stubble: 0,
    hairGrey: 0,
    beardGrey: 0,
    hairLength: 0,
    bangLength: 0,
    beardLength: 0,
    sliders: {
      h: num(body.h),
      b: num(body.b),
      s: num(body.s),
    },
    face: {
      shape: null,
      brow: null,
      nose: null,
      noseType: null,
      mouth: null,
      params: {},
    },
    outfit,
    dye: {},
  };
}

function optionsForCreator(value: unknown, gender: 'm' | 'f', age: 'adult' | 'child'): unknown {
  const raw = isRecord(value) ? value : {};
  const body = isRecord(raw.body) ? raw.body : {};
  const labels = isRecord(raw.hairLabels) ? raw.hairLabels : {};
  const slots: Record<string, unknown[]> = {};
  if (isRecord(raw.slots)) {
    for (const [slot, info] of Object.entries(raw.slots)) {
      const garments = isRecord(info) && Array.isArray(info.garments) ? info.garments : [];
      slots[slot] = garments
        .map((item) => {
          const record = isRecord(item) ? item : {};
          const id = typeof record.id === 'string' ? record.id : '';
          return {
            id,
            dyeRegions: dyeRegionNames(record.dye),
            hairStates: null,
            states: garmentStates(record.states),
          };
        })
        .filter((item) => item.id);
    }
  }
  const slider = (
    id: string,
  ): { id: string; min: number; max: number; default: number; step: number } => {
    const range = Array.isArray(body[id]) ? body[id] : [-1, 1];
    return {
      id,
      min: num(range[0], -1),
      max: num(range[1], 1),
      default: 0,
      step: 0.01,
    };
  };
  return {
    race: typeof raw.race === 'string' ? raw.race : '',
    gender,
    age,
    skins: toneSwatches(raw.tones),
    skinCustom: false,
    hairColors: namedIds(raw.hairColors),
    iris: namedIds(raw.iris),
    sclera: [],
    styles: hairStyles(raw.hair, labels),
    facialHair: namedIds(raw.beard).filter((item) => item.id !== 'none'),
    stubble: [0],
    hsld: {},
    sliders: [slider('h'), slider('b'), slider('s')],
    face: {
      presets: [],
      shapes: [],
      brows: strings(raw.brows).filter((id) => id !== 'auto'),
      noses: [],
      noseTypes: [],
      mouths: [],
      params: [],
    },
    slots,
    palettes: {},
    controls: { hairColor: true },
  };
}

function toV2Patch(patch: EditPatch): Record<string, unknown> {
  const next: Record<string, unknown> = { ...patch };
  if (typeof patch.skin === 'string' && /^\d+$/.test(patch.skin)) {
    next.tone = Number(patch.skin);
    delete next.skin;
  }
  if (typeof patch.hairStyle === 'string') {
    next.hair = patch.hairStyle;
    delete next.hairStyle;
  }
  if (isRecord(patch.outfit)) {
    const outfit: Record<string, unknown> = {};
    for (const [slot, value] of Object.entries(patch.outfit)) {
      if (value === null) outfit[slot] = null;
      else if (typeof value === 'string') outfit[slot] = { id: value };
      else outfit[slot] = value;
    }
    next.outfit = outfit;
  }
  if (isRecord(patch.sliders)) {
    const body: Record<string, number> = {};
    for (const key of ['h', 'b', 's'] as const) {
      const value = patch.sliders[key];
      if (typeof value === 'number') body[key] = value;
    }
    if (Object.keys(body).length > 0) next.body = body;
  }
  return next;
}

function profileReport(report: {
  ok: boolean;
  errors?: unknown;
  warnings?: unknown;
}): ProfileReport {
  return {
    ok: report.ok,
    errors: issueLines(report.errors),
    warnings: issueLines(report.warnings),
  };
}

function asIssues(value: unknown): CharacterEditReport['errors'] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const record = isRecord(item) ? item : {};
    return {
      path: typeof record.path === 'string' ? record.path : '',
      code: typeof record.code === 'string' ? record.code : 'invalid',
      msg: typeof record.msg === 'string' ? record.msg : 'invalid',
    };
  });
}

function issueLines(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    if (typeof item === 'string') return item;
    const record = isRecord(item) ? item : {};
    const path = typeof record.path === 'string' && record.path ? `${record.path}: ` : '';
    const msg = typeof record.msg === 'string' ? record.msg : 'invalid';
    return `${path}${msg}`;
  });
}

function toneSwatches(value: unknown): Array<{ id: string; rgb: number[]; name?: string }> {
  if (!Array.isArray(value)) return [];
  const swatches: Array<{ id: string; rgb: number[]; name?: string }> = [];
  for (const item of value) {
    const record = isRecord(item) ? item : {};
    if (typeof record.index !== 'number') continue;
    const swatch: { id: string; rgb: number[]; name?: string } = {
      id: String(record.index),
      rgb: Array.isArray(record.rgb) ? record.rgb.map((channel) => Number(channel)) : [],
    };
    if (typeof record.name === 'string') swatch.name = record.name;
    swatches.push(swatch);
  }
  return swatches;
}

function namedIds(value: unknown): Array<{ id: string; name: string; rgb: number[] }> {
  return strings(value)
    .filter((id) => id !== 'auto')
    .map((id) => ({ id, name: id, rgb: [] }));
}

function hairStyles(
  value: unknown,
  labels: Record<string, unknown>,
): Array<{ id: string; name: string; headwear: Record<string, string> }> {
  return strings(value)
    .filter((id) => id !== 'auto')
    .map((id) => ({
      id,
      name: typeof labels[id] === 'string' ? labels[id] : id,
      headwear: {},
    }));
}

function dyeRegionNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((region) => {
      if (typeof region === 'string') return region;
      return isRecord(region) && typeof region.region === 'string' ? region.region : '';
    })
    .filter((name) => name.length > 0);
}

function garmentStates(value: unknown): Record<string, { options: string[]; default: string }> {
  if (!isRecord(value)) return {};
  const specs: Record<string, { options: string[]; default: string }> = {};
  for (const [name, spec] of Object.entries(value)) {
    if (!isRecord(spec)) continue;
    const options = (Array.isArray(spec.values) ? spec.values : [])
      .map((item) =>
        typeof item === 'string' ? item : typeof item === 'boolean' ? String(item) : '',
      )
      .filter((item) => item.length > 0);
    if (options.length === 0) continue;
    const preferred =
      typeof spec.default === 'string'
        ? spec.default
        : typeof spec.default === 'boolean'
          ? String(spec.default)
          : (options[0] ?? '');
    specs[name] = {
      options,
      default: options.includes(preferred) ? preferred : (options[0] ?? ''),
    };
  }
  return specs;
}

function stringMap(value: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'string') out[key] = item;
  }
  return out;
}

function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
