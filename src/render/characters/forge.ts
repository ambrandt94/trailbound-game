/**
 * Game-facing character API. The vendored runtime is behind `backends/`.
 * This file does not import `cf-runtime` or call `cf.*`.
 * Recipes stay opaque: generate from a seed plus a profile entry, then build.
 */
import * as THREE from 'three';
import type { AvatarEngine, PlayerAvatar, PlayerProfileEntry } from '../../core/people/avatar';
import { clipTimeScale } from '../../core/state/area-pace';
import { WALK_MAX_MPS } from '../area/locomotion';
import { createCharacterBackend } from './backends/select';
import type { BuiltCharacter, CharacterBackend, CharacterPlatform } from './backends/types';
import { createV1Backend } from './backends/v1';
import { characterForgePaths, characterForgeV2Paths } from './cf-pin';

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
  /**
   * Metres, keyed by race id. A Character Forge 2 backend fills this from its
   * catalog. The v1 backend leaves it unset.
   */
  raceMetrics?: Readonly<
    Record<string, { heightM: number; strideM: number; walkDuration?: number }>
  >;
}

/**
 * Metres used to time locomotion. `strideM` and `walkDuration` come from the
 * Walk clip (planted-foot travel and the clip length). `scale` is the one town
 * factor, 1.4 / the v2 human height, shared by every race. `runDuration` and
 * `runStrideM` are set when the body has a ground Run clip.
 */
export interface ForgeRaceMetrics {
  heightM: number;
  strideM: number;
  walkDuration: number;
  scale?: number;
  runDuration?: number;
  runStrideM?: number;
}

/** Clips a forged body can present. Flyers still use Idle and Walk. */
export type BodyClip = 'Idle' | 'Walk' | 'Run';

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

export interface GarmentStateSpec {
  options: string[];
  default: string;
}

export interface GarmentOption {
  id: string;
  dyeRegions: string[];
  hairStates: Record<string, string> | null;
  /** State names and legal values from CF.options. Empty when the garment has none. */
  states: Record<string, GarmentStateSpec>;
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

export interface AvatarPose {
  clip: BodyClip;
  /**
   * Mixer rate. With v2 metrics this is speed × clip duration / (stride × scale),
   * using the clip's own stride. Without metrics, a moving body uses speed / 1.4.
   */
  timeScale: number;
  /** Crossfade in seconds. 0 restarts the clip only when the name changes. */
  fade: number;
  /**
   * Optional Idle/Walk/Run weights. When set, the mixer rate stays 1 and each
   * clip carries `timeScale` on its own action so an overlay is not sped up.
   */
  blend?: { idle: number; walk: number; run: number };
}

/** Additive or phase-locked clip on top of locomotion. Dojo attacks and stances. */
export interface AvatarLayer {
  name: string;
  clip: THREE.AnimationClip;
  /** Seconds into the clip. Ignored unless `paused` pins the pose. */
  time: number;
  weight: number;
  /** Pin `time` instead of letting the mixer advance. */
  paused: boolean;
}

export type AvatarSocket = 'hand_l' | 'hand_r' | 'back' | 'belt' | 'head';

export interface AvatarBody {
  object3D: THREE.Object3D;
  source: 'forge' | 'placeholder';
  recipeHash: string;
  clip: BodyClip;
  play(name: BodyClip): void;
  /** Area locomotion. Blends when the clip changes and sets the mixer rate. */
  present(pose: AvatarPose): void;
  /** Replace the overlay set. Missing names are stopped. */
  layers(stack: readonly AvatarLayer[]): void;
  /** Clip names on this body. A private pack can add Sprint, Start, Stop, or Skid. */
  clipNames(): readonly string[];
  /** Attachment point. Null on the placeholder pawn and on runtimes without sockets. */
  socket(name: AvatarSocket): THREE.Object3D | null;
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
  /**
   * Pass false to force the placeholder path. `?cf=0` does the same.
   * With no `?cf=` param the Character Forge 2 backend is selected.
   * `?cf=1` (also `v1` / `cf1`) selects v1. `?cf=2` (also `v2` / `cf2`)
   * still selects v2. A v2 init or preload failure falls back to v1.
   */
  enabled?: boolean;
  profile?: unknown;
  force?: boolean;
  /** Forwarded to the backend. Unset leaves the public animation set alone. */
  privateAnimBaseUrl?: string;
  /** Headless Character Forge 2 hooks. v1 ignores them. */
  platform?: CharacterPlatform;
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

const BUDGET_MS = 8;

let backend: CharacterBackend | null = null;
let pending: Promise<ForgeStatus> | null = null;
let status: ForgeStatus = { ok: false, reason: 'not started', initMs: 0 };
let adopted: AvatarBody | null = null;
let buildMs = 0;
let buildError = '';
let initOptions: InitOptions = {};

export function initForge(options: InitOptions = {}): Promise<ForgeStatus> {
  if (pending && !options.force) return pending;
  pending = runInit(options);
  return pending;
}

export function forgeReady(): ForgeStatus {
  return status;
}

/** Active engine after a successful init. Null when the placeholder path is in use. */
export function characterEngine(): AvatarEngine | null {
  if (!status.ok || !backend) return null;
  return backend.id;
}

export function forgeCatalog(): ForgeCatalog | null {
  if (!status.ok || !backend) return null;
  return backend.catalog();
}

/** Live edit catalog, including slot regions and garment occupation when the pin provides them. */
export function forgeEditCatalog(): unknown | null {
  if (!feature('editCatalog') || !backend) return null;
  try {
    return backend.editCatalog();
  } catch {
    return null;
  }
}

export function forgeTimings(): ForgeTimings {
  return { initMs: status.initMs, buildMs };
}

export function forgeBuildError(): string {
  return buildError;
}

export function forgeStats(): Record<string, number> | null {
  if (!backend || !status.ok) return null;
  try {
    return backend.stats();
  } catch {
    return null;
  }
}

export function validateGameProfile(profile: unknown): ProfileReport {
  if (!backend || !status.ok) return { ok: false, errors: ['forge is not ready'], warnings: [] };
  return backend.validateProfile(profile);
}

export function generateRecipe(options: {
  seed: number;
  profileEntry: PlayerProfileEntry;
  generatorVersion?: number;
  race?: string;
  gender?: 'm' | 'f';
}): CharacterRecipe {
  if (!backend || !status.ok) throw new Error(status.reason || 'forge is not ready');
  const generatorVersion = options.generatorVersion ?? backend.catalog()?.generatorVersion ?? 1;
  const engine = backend.generate({
    seed: options.seed >>> 0,
    profileEntry: options.profileEntry,
    generatorVersion,
    race: options.race,
    gender: options.gender,
  });
  return wrapRecipe(engine as EngineRecipe, options.seed, generatorVersion);
}

/** Wrap a recipe that was stored in a save. The object is not edited here. */
export function recipeFromStored(engine: unknown, seed = 0): CharacterRecipe {
  if (!engine || typeof engine !== 'object') throw new Error('stored recipe is missing');
  return wrapRecipe(engine as EngineRecipe, seed, 1);
}

/**
 * Recipe to build for a saved avatar. A cf1 avatar on the v2 backend is
 * migrated in memory. The save object is not written and its cf1 recipe stays.
 */
export function recipeForAvatar(
  avatar: Pick<PlayerAvatar, 'engine' | 'recipe' | 'legacyRecipe' | 'seed'>,
): CharacterRecipe | null {
  if (!backend || !status.ok) return null;
  if (backend.id === 'cf2' && avatar.engine !== 'cf2') {
    const source = avatar.legacyRecipe ?? avatar.recipe;
    if (!source || !backend.migrateRecipe) return null;
    const migrated = backend.migrateRecipe(source);
    return wrapRecipe(migrated as EngineRecipe, avatar.seed, 1);
  }
  if (avatar.recipe) return recipeFromStored(avatar.recipe, avatar.seed);
  return null;
}

/**
 * Scale, clip, and mixer rate. Without v2 metrics this is the v1 rule:
 * scale 1, and `speed / 1.4` once the body is moving.
 * v2 uses one uniform scale for every race (`metrics.scale`), from the human
 * catalog height, so a dwarf stays shorter than a human. Walk and Run rates
 * follow that clip's duration and planted stride. Run starts once speed reaches
 * the same ceiling the town uses for a walk clip.
 */
export function forgePresentation(
  metrics: ForgeRaceMetrics | null,
  speed: number,
): { scale: number; timeScale: number; clip: BodyClip } {
  const moving = speed > 0.4;
  if (!metrics || !(metrics.heightM > 0) || !(metrics.strideM > 0) || !(metrics.walkDuration > 0)) {
    return {
      scale: 1,
      timeScale: moving ? Math.max(0.6, speed / 1.4) : 1,
      clip: moving ? 'Walk' : 'Idle',
    };
  }
  const scale = metrics.scale && metrics.scale > 0 ? metrics.scale : 1;
  if (!moving) return { scale, timeScale: 1, clip: 'Idle' };
  if (
    metrics.runDuration &&
    metrics.runStrideM &&
    metrics.runDuration > 0 &&
    metrics.runStrideM > 0 &&
    speed >= WALK_MAX_MPS * scale
  ) {
    return {
      scale,
      timeScale: clipTimeScale(speed, metrics.runDuration, metrics.runStrideM, scale),
      clip: 'Run',
    };
  }
  return {
    scale,
    timeScale: clipTimeScale(speed, metrics.walkDuration, metrics.strideM, scale),
    clip: 'Walk',
  };
}

export function describeRecipe(recipe: CharacterRecipe): EditSnapshot {
  if (!feature('describe') || !backend) throw new Error(status.reason || 'forge is not ready');
  return normalizeSnapshot(backend.describe(recipe.engine));
}

export function optionsFor(
  race: string,
  gender: 'm' | 'f',
  age: 'adult' | 'child' = 'adult',
): EditOptions {
  if (feature('options') && backend) return normalizeOptions(backend.options(race, gender, age));
  const offline = offlineOptions(race, gender, age);
  if (offline) return offline;
  throw new Error(status.reason || 'forge is not ready');
}

export function checkRecipeEdit(recipe: CharacterRecipe, patch: EditPatch): EditReport {
  if (!feature('checkEdit') || !backend) {
    return {
      ok: false,
      recipe: null,
      errors: [{ path: '', code: 'unavailable', msg: 'forge is not ready' }],
      warnings: [],
    };
  }
  const report = backend.checkEdit(recipe.engine, patch);
  const next =
    report.ok && report.recipe
      ? wrapRecipe(report.recipe as EngineRecipe, recipe.seed, recipe.generatorVersion)
      : null;
  return {
    ok: report.ok,
    recipe: next,
    errors: report.errors ?? [],
    warnings: report.warnings ?? [],
  };
}

export function editRecipe(recipe: CharacterRecipe, patch: EditPatch): CharacterRecipe {
  if (!feature('edit') || !backend) throw new Error(status.reason || 'forge is not ready');
  return wrapRecipe(
    backend.edit(recipe.engine, patch) as EngineRecipe,
    recipe.seed,
    recipe.generatorVersion,
  );
}

export function recipeHashOf(recipe: CharacterRecipe): string {
  if (!backend || !status.ok) return `ph:${recipe.seed >>> 0}`;
  return backend.recipeHash(recipe.engine);
}

export function packsForRecipe(recipe: CharacterRecipe): string[] {
  if (!backend || !status.ok) return [];
  try {
    return backend.packsFor([recipe.engine]);
  } catch {
    return [];
  }
}

/** Bake a body. `budgetMs` yields the main thread so the UI does not hitch. */
export async function buildAvatar(
  recipe: CharacterRecipe,
  options: { budgetMs?: number } = {},
): Promise<AvatarBody> {
  if (!backend || !status.ok) return placeholderAvatar(recipe.seed);
  const started = now();
  buildError = '';
  try {
    const built = await backend.build(recipe.engine, {
      budgetMs: options.budgetMs ?? (backend.id === 'cf2' ? 6 : BUDGET_MS),
      atlasSize: 256,
    });
    buildMs = now() - started;
    return wrapForge(built, backend.recipeHash(recipe.engine));
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

  const state = {
    clip: 'Idle' as BodyClip,
    time: 0,
    rate: 1,
    disposed: false,
  };
  const body: AvatarBody = {
    object3D: group,
    source: 'placeholder',
    recipeHash: `ph:${seed >>> 0}`,
    clip: 'Idle',
    play(name) {
      state.clip = name;
      state.rate = 1;
      body.clip = name;
    },
    present(pose) {
      state.clip = pose.blend ? dominantClip(pose.blend) : pose.clip;
      state.rate = Number.isFinite(pose.timeScale) ? pose.timeScale : 1;
      body.clip = state.clip;
    },
    layers() {},
    clipNames() {
      return [];
    },
    socket() {
      return null;
    },
    update(dt) {
      if (state.disposed) return;
      state.time += dt * state.rate;
      const moving = state.clip !== 'Idle';
      bob.position.y = moving
        ? Math.sin(state.time * 8) * 0.05
        : Math.sin(state.time * 2.4) * 0.012;
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
  if (!status.ok) return;
  backend?.aimSun(camera);
}

/** Warm v2 race assets during the loading screen. v1 has nothing to preload. */
export async function preloadForge(): Promise<void> {
  if (queryDisablesForge() || createCharacterBackend().id !== 'cf2') return;
  const ready = await initForge();
  if (!ready.ok || backend?.id !== 'cf2') return;
  try {
    await backend.preload?.();
  } catch (error) {
    await fallBackToV1(error, 'preload');
  }
}

async function runInit(options: InitOptions): Promise<ForgeStatus> {
  const started = now();
  initOptions = options;
  backend?.dispose();
  backend = null;
  if (options.enabled === false || queryDisablesForge()) {
    status = { ok: false, reason: 'cf=0', initMs: now() - started };
    return status;
  }
  const selected = createCharacterBackend();
  try {
    await bindBackend(selected, options, false);
    backend = selected;
    status = { ok: true, reason: '', initMs: now() - started };
    return status;
  } catch (error) {
    selected.dispose();
    backend = null;
    if (selected.id !== 'cf2') {
      status = {
        ok: false,
        reason: error instanceof Error ? error.message : 'forge init failed',
        initMs: now() - started,
      };
      return status;
    }
    const fallen = await fallBackToV1(error, 'init');
    status = { ...fallen, initMs: now() - started };
    pending = Promise.resolve(status);
    return status;
  }
}

async function bindBackend(
  selected: CharacterBackend,
  options: InitOptions,
  fallback: boolean,
): Promise<void> {
  const paths = selected.id === 'cf2' ? characterForgeV2Paths() : characterForgePaths();
  await selected.init({
    runtimeUrl: (fallback ? undefined : options.runtimeUrl) ?? resolvePublic(paths.runtime),
    baseUrl: (fallback ? undefined : options.baseUrl) ?? resolvePublic(paths.base),
    profile: options.profile,
    privateAnimBaseUrl: options.privateAnimBaseUrl,
    platform: options.platform,
  });
}

/** v2 failed. Warn and load the vendored 1.2.1 runtime so the player still has a body. */
async function fallBackToV1(error: unknown, stage: 'init' | 'preload'): Promise<ForgeStatus> {
  const reason = error instanceof Error ? error.message : `forge ${stage} failed`;
  console.warn(`Character Forge v2 failed to ${stage} (${reason}); falling back to v1.`);
  backend?.dispose();
  backend = null;
  const fallback = createV1Backend();
  const started = now();
  try {
    await bindBackend(fallback, initOptions, true);
    backend = fallback;
    status = { ok: true, reason: '', initMs: status.initMs || now() - started };
    pending = Promise.resolve(status);
    return status;
  } catch (fallbackError) {
    fallback.dispose();
    backend = null;
    status = {
      ok: false,
      reason: fallbackError instanceof Error ? fallbackError.message : 'forge init failed',
      initMs: now() - started,
    };
    pending = Promise.resolve(status);
    return status;
  }
}

function feature(name: 'describe' | 'options' | 'checkEdit' | 'edit' | 'editCatalog'): boolean {
  if (!status.ok || !backend) return false;
  return backend.features()[name];
}

function actionFor(built: BuiltCharacter, name: BodyClip): THREE.AnimationAction | null {
  const clip = built.clips?.[name];
  if (!clip) return null;
  return built.mixer.clipAction(clip);
}

function dominantClip(blend: { idle: number; walk: number; run: number }): BodyClip {
  if (blend.run >= blend.walk && blend.run >= blend.idle && blend.run > 0.2) return 'Run';
  if (blend.walk >= blend.idle && blend.walk > 0.2) return 'Walk';
  return 'Idle';
}

function wrapForge(built: BuiltCharacter, hash: string): AvatarBody {
  const state = { clip: 'Idle' as BodyClip, disposed: false };
  const overlays = new Map<string, THREE.AnimationAction>();
  built.object3D.name = 'CF_avatar';
  // The town, the creator, and instance games all borrow this one object.
  // Teardown detaches it. It must not be disposed with a scene.
  built.object3D.userData.sharedAsset = 1;
  built.object3D.userData.tbKeep = 1;
  built.play('Idle');
  const body: AvatarBody = {
    object3D: built.object3D,
    source: 'forge',
    recipeHash: hash,
    clip: 'Idle',
    play(name) {
      state.clip = name;
      body.clip = name;
      built.mixer.timeScale = 1;
      built.play(name);
    },
    present(pose) {
      const fade = Math.max(0, pose.fade);
      const rate = Number.isFinite(pose.timeScale) ? pose.timeScale : 1;
      if (pose.blend && built.clips?.Idle && built.clips.Walk) {
        const weights = { Idle: pose.blend.idle, Walk: pose.blend.walk, Run: pose.blend.run };
        for (const name of ['Idle', 'Walk', 'Run'] as const) {
          const action = actionFor(built, name);
          if (!action) continue;
          const weight = weights[name];
          action.enabled = true;
          if (weight > 0.001) {
            if (!action.isRunning()) action.reset().fadeIn(fade).play();
            action.setEffectiveWeight(weight);
            action.setEffectiveTimeScale(name === 'Idle' ? 1 : rate);
          } else if (action.isRunning()) {
            action.setEffectiveWeight(0);
          }
        }
        state.clip = dominantClip(pose.blend);
        body.clip = state.clip;
        built.mixer.timeScale = 1;
        return;
      }
      if (pose.clip !== state.clip) {
        const next = actionFor(built, pose.clip);
        const prev = actionFor(built, state.clip);
        if (next && prev && next !== prev) {
          next.enabled = true;
          next.setEffectiveWeight(1);
          next.reset().fadeIn(fade).play();
          prev.fadeOut(fade);
        } else {
          built.play(pose.clip);
        }
        state.clip = pose.clip;
        body.clip = pose.clip;
      }
      built.mixer.timeScale = rate;
    },
    layers(stack) {
      const keep = new Set(stack.map((layer) => layer.name));
      for (const [name, action] of overlays) {
        if (keep.has(name)) continue;
        action.setEffectiveWeight(0);
        action.stop();
        overlays.delete(name);
      }
      for (const layer of stack) {
        if (!(layer.weight > 0)) {
          const idle = overlays.get(layer.name);
          if (idle) {
            idle.setEffectiveWeight(0);
            idle.stop();
            overlays.delete(layer.name);
          }
          continue;
        }
        let action = overlays.get(layer.name);
        if (!action || action.getClip() !== layer.clip) {
          action = built.mixer.clipAction(layer.clip);
          action.clampWhenFinished = true;
          overlays.set(layer.name, action);
        }
        action.enabled = true;
        action.paused = layer.paused;
        action.setLoop(
          layer.paused ? THREE.LoopOnce : THREE.LoopRepeat,
          layer.paused ? 1 : Infinity,
        );
        action.setEffectiveWeight(layer.weight);
        action.setEffectiveTimeScale(1);
        if (!action.isRunning()) action.play();
        if (layer.paused) {
          const duration = Math.max(0.001, layer.clip.duration);
          action.time = Math.min(duration - 0.0001, Math.max(0, layer.time));
        }
      }
    },
    clipNames() {
      return Object.keys(built.clips ?? {});
    },
    socket(name) {
      return built.socket?.(name) ?? null;
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
          if (typeof item === 'string')
            return { id: item, dyeRegions: [], hairStates: null, states: {} };
          const record = isRecord(item) ? item : {};
          return {
            id: typeof record.id === 'string' ? record.id : '',
            dyeRegions: dyeNames(record.dyeRegions),
            hairStates: isRecord(record.hairStates) ? stringMap(record.hairStates) : null,
            states: stateSpecs(record.states),
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
  const edit = backend?.offlineEditSource();
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
        dyeRegions: dyeNames(regions),
        hairStates: isRecord(row.hairStates) ? stringMap(row.hairStates) : null,
        states: stateSpecs(row.states),
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

function dyeNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((region) => {
      if (typeof region === 'string') return region;
      return isRecord(region) && typeof region.name === 'string' ? region.name : '';
    })
    .filter((name) => name.length > 0);
}

function stateSpecs(value: unknown): Record<string, GarmentStateSpec> {
  if (!isRecord(value)) return {};
  const specs: Record<string, GarmentStateSpec> = {};
  for (const [name, spec] of Object.entries(value)) {
    if (!isRecord(spec)) continue;
    const options = strings(spec.options);
    if (options.length === 0) continue;
    const fallback = options[0] ?? '';
    const preferred = typeof spec.default === 'string' ? spec.default : fallback;
    specs[name] = { options, default: options.includes(preferred) ? preferred : fallback };
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
