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
    };
    clips?: { flyer?: unknown; flyerRaces?: string[] };
  };
  init(options: { THREE: typeof import('three'); baseUrl: string }): Promise<unknown>;
  generate(
    seed: number,
    profileEntry: PlayerProfileEntry,
    options?: { generatorVersion?: number; race?: string; gender?: string },
  ): {
    format?: string;
    seed?: number;
    generatorVersion?: number;
    richness?: number;
    style?: string | null;
  };
  packsFor(recipes: unknown[]): string[];
  build(recipe: unknown, options?: { budgetMs?: number; atlasSize?: number }): Promise<CfBody>;
  recipeHash(recipe: unknown): string;
  validateProfile(profile: unknown): ProfileReport;
  stats(): Record<string, number>;
  pixelSun?(camera: THREE.Camera): void;
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
}): CharacterRecipe {
  if (!cf || !status.ok) throw new Error(status.reason || 'forge is not ready');
  const generatorVersion = options.generatorVersion ?? catalog?.generatorVersion ?? 1;
  const engine = cf.generate(options.seed >>> 0, options.profileEntry, { generatorVersion });
  return {
    format: typeof engine.format === 'string' ? engine.format : 'cf.character',
    seed: typeof engine.seed === 'number' ? engine.seed : options.seed >>> 0,
    generatorVersion:
      typeof engine.generatorVersion === 'number' ? engine.generatorVersion : generatorVersion,
    richness: typeof engine.richness === 'number' ? engine.richness : 0,
    style: typeof engine.style === 'string' || engine.style === null ? engine.style : null,
    engine,
  };
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

function queryDisablesForge(): boolean {
  try {
    return new URLSearchParams(globalThis.location?.search ?? '').get('cf') === '0';
  } catch {
    return false;
  }
}

function defaultRuntimeUrl(): string {
  return resolvePublic('vendor/character-forge/1.1.0/cf-runtime.mjs');
}

function defaultBaseUrl(): string {
  return resolvePublic('vendor/character-forge/1.1.0/');
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
