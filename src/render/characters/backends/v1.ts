/**
 * Character Forge 1.x backend. This is the only file that imports the
 * vendored runtime or calls `cf.*`.
 */
import * as THREE from 'three';
import { CF_PIN } from '../cf-pin';
import type { EditPatch, ForgeCatalog, ProfileReport } from '../forge';
import type {
  BuiltCharacter,
  CharacterBackend,
  CharacterBackendInit,
  CharacterBuildOptions,
  CharacterEditReport,
  CharacterFeatures,
  CharacterGenerateRequest,
} from './types';

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
  /**
   * Default true discards CPU arrays and the atlas image after the first GPU
   * upload. The adopted body outlives the renderer that uploaded it, so this
   * stays false.
   */
  freeCpuGeometry?: boolean;
  generate(
    seed: number,
    profileEntry: CharacterGenerateRequest['profileEntry'],
    options?: { generatorVersion?: number; race?: string; gender?: string },
  ): EngineRecipe;
  packsFor(recipes: readonly unknown[]): string[];
  build(
    recipe: unknown,
    options?: { budgetMs?: number; atlasSize?: number },
  ): Promise<BuiltCharacter>;
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
  ): {
    ok: boolean;
    recipe: EngineRecipe | null;
    errors: CharacterEditReport['errors'];
    warnings: CharacterEditReport['warnings'];
  };
  edit?(recipe: unknown, patch: unknown, opts?: { strict?: boolean }): EngineRecipe;
  editCatalog?(): unknown;
}

export function createV1Backend(): CharacterBackend {
  let api: CfApi | null = null;
  let catalog: ForgeCatalog | null = null;
  let pixelSun: ((camera: THREE.Camera) => void) | null = null;

  return {
    id: 'cf1',

    async init(options: CharacterBackendInit): Promise<void> {
      const loaded = (await import(/* @vite-ignore */ options.runtimeUrl)) as { default: CfApi };
      const next = loaded.default;
      if (!next || typeof next.init !== 'function' || next.api !== 1) {
        throw new Error('character runtime api mismatch');
      }
      // Keep the bake on the CPU. The area renderer is disposed on every return
      // to the map, which deletes the GPU buffers, and a later visit has to
      // upload this same body again.
      next.freeCpuGeometry = false;
      await next.init({ THREE, baseUrl: options.baseUrl });
      const runtimeVersion = next.bundle?.engine?.version ?? next.version ?? '';
      const generatorVersion = next.bundle?.generator?.version;
      if (
        runtimeVersion !== CF_PIN.version ||
        generatorVersion !== Number(CF_PIN.generatorVersion)
      ) {
        throw new Error(
          `character runtime ${runtimeVersion} generator ${String(generatorVersion)} does not match pin ${CF_PIN.version} generator ${CF_PIN.generatorVersion}`,
        );
      }
      if (next.api !== 1) throw new Error('character runtime api mismatch');
      api = next;
      pixelSun = typeof next.pixelSun === 'function' ? next.pixelSun.bind(next) : null;
      catalog = readCatalog(next);
      if (options.profile) {
        const report = next.validateProfile(options.profile);
        if (!report.ok) console.warn('trailbound character profile', report.errors);
      }
    },

    dispose(): void {
      api = null;
      catalog = null;
      pixelSun = null;
    },

    features(): CharacterFeatures {
      return {
        describe: typeof api?.describe === 'function',
        options: typeof api?.options === 'function',
        checkEdit: typeof api?.checkEdit === 'function',
        edit: typeof api?.edit === 'function',
        editCatalog: typeof api?.editCatalog === 'function',
      };
    },

    catalog(): ForgeCatalog | null {
      return catalog;
    },

    editCatalog(): unknown | null {
      if (!api?.editCatalog) return null;
      return api.editCatalog();
    },

    offlineEditSource(): unknown | null {
      return api?.bundle?.tags?.edit ?? null;
    },

    stats(): Record<string, number> | null {
      if (!api) return null;
      return api.stats();
    },

    validateProfile(profile: unknown): ProfileReport {
      if (!api) return { ok: false, errors: ['forge is not ready'], warnings: [] };
      return api.validateProfile(profile);
    },

    generate(request: CharacterGenerateRequest): unknown {
      if (!api) throw new Error('forge is not ready');
      return api.generate(request.seed >>> 0, request.profileEntry, {
        generatorVersion: request.generatorVersion,
        race: request.race,
        gender: request.gender,
      });
    },

    describe(recipe: unknown): unknown {
      if (!api?.describe) throw new Error('forge is not ready');
      return api.describe(recipe);
    },

    options(race: string, gender: 'm' | 'f', age: 'adult' | 'child'): unknown {
      if (!api?.options) throw new Error('forge is not ready');
      return api.options(race, gender, { age });
    },

    checkEdit(recipe: unknown, patch: EditPatch): CharacterEditReport {
      if (!api?.checkEdit) throw new Error('forge is not ready');
      const report = api.checkEdit(recipe, patch);
      return {
        ok: report.ok,
        recipe: report.recipe,
        errors: report.errors ?? [],
        warnings: report.warnings ?? [],
      };
    },

    edit(recipe: unknown, patch: EditPatch): unknown {
      if (!api?.edit) throw new Error('forge is not ready');
      return api.edit(recipe, patch);
    },

    recipeHash(recipe: unknown): string {
      if (!api) throw new Error('forge is not ready');
      return api.recipeHash(recipe);
    },

    packsFor(recipes: readonly unknown[]): string[] {
      if (!api) return [];
      return api.packsFor(recipes);
    },

    async build(recipe: unknown, options: CharacterBuildOptions): Promise<BuiltCharacter> {
      if (!api) throw new Error('forge is not ready');
      return api.build(recipe, {
        budgetMs: options.budgetMs,
        atlasSize: options.atlasSize,
      });
    },

    aimSun(camera: THREE.Camera): void {
      pixelSun?.(camera);
    },
  };
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
