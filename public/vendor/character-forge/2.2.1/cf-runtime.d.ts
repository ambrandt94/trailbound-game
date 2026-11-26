// Character Forge runtime 2.2.0 (api 2). three is a peer dependency (>=0.187 <0.190).
import type * as THREE_NS from 'three';
export type RaceId = 'human' | 'wood_elf' | 'dark_elf' | 'great_elf' | 'mousefolk' | 'tiefling' | 'halfling' | 'gnome' | 'dwarf' | 'goliath' | 'firbolg' | 'orc' | 'goblin' | 'kobold' | 'imp' | 'pixie' | 'dragonborn';
export type BodyType = 'neutral' | 'masc' | 'fem';
export interface OutfitItem { id: string; variant?: string; states?: Record<string, string | boolean> }
export interface Recipe {
  format: 'cf.character'; v: 2; generatorVersion: number; seed: number | string; style?: string; race: RaceId | `${string}/${string}`; bodyType: BodyType; bodyAmt?: number;
  tone: number; marks?: boolean; hair: string; hairColor: string; fade?: string; beard: string; beardColor?: string;
  ears: string; snout: string; horns: string; hornSize?: number; hornDye?: string; wings: string;
  eyes: string; brows: string; iris: string; browColor?: string; eyeOffset?: [number, number]; expression?: { eye?: string; brow?: string; mouth?: string };
  body: { h: number; b: number; s: number }; outfit: Record<string, OutfitItem>; dye: Record<string, Record<string, string>>; /** 2.2.0: kits this recipe uses (only when non-empty) */ kits?: KitRef[]; name?: string; [k: string]: unknown;
}
export interface Issue { path: string; msg: string }
export interface WardrobeResult { recipe: Recipe; displaced: { slot: string; id: string; variant?: string }[]; hidden: { what: string; by: string; note?: string }[]; warnings: Issue[] }
export interface Policy { animationSet: 'cf' | 'cf+cc0' | 'cf+ki' | 'cf+cc0+ki'; migration: 'regenerate' | 'wipe'; missingRaces: Record<string, RaceId>; tieflingPlayable: boolean; regalia: 'kits' | 'richness'; regaliaMinRichness: number; adoption: string; wingsUnderCloak: 'show' | 'hide'; /** 2.2.1: 'full' (default) = Idle/Walk/Run are full mocap (KI when enabled, else CC0 Quaternius), CF_Idle/CF_Walk keep the CF clips; 'cf' = pre-2.2.1 */ locomotion: 'full' | 'cf' }
export interface RandomOpts { race?: RaceId | string; races?: Record<string, number>; bodyType?: BodyType; role?: string; style?: string; tier?: 'hamlet' | 'village' | 'town' | 'city' | 'capital'; richness?: number; outfit?: Record<string, OutfitItem | null> }
export interface BuildOpts { /** ms per cooperative step, default 6; 0 | Infinity = one synchronous step */ budgetMs?: number; texSize?: 128 | 256 | 512; signal?: AbortSignal; lod?: boolean; trace?: boolean }
export type StepTrace = [ms: number, from: string | number, to: string | number][];
/** headless / injected platform: no DOM globals needed when given (unknown keys throw) */
export interface Platform { createCanvas?: () => HTMLCanvasElement | OffscreenCanvas | any; createImageBitmap?: (blob: Blob, opts?: object) => Promise<CanvasImageSource | any>; decodeImage?: (b64png: string) => Promise<CanvasImageSource | any>; fetch?: (url: string, init?: RequestInit) => Promise<Response>; document?: { createElement(t: 'canvas'): any } }
export interface LightingOpts { mode?: 'current' | 'tb' | 'flat' | 'pixel'; sunDir?: [number, number, number]; dir?: string; yaw?: number; pattern?: number; space?: 'texel' | 'screen'; edge?: number; strength?: number; hue?: number }
/** edit patch: recipe fields + aliases skin|skinTone -> tone, hairStyle -> hair; any other key is an error */
export type EditPatch = Partial<Omit<Recipe, 'name'>> & { skin?: number; skinTone?: number; hairStyle?: string };
export type AnimPackLoader = (name: string, o: { signal?: AbortSignal }) => Promise<Response | ArrayBuffer | Uint8Array>;
/** 2.2.0 kits (cf-kit/1) */
export interface KitRef { namespace: string; version: string | null }
export type BodyRegion = 'pelvis' | 'torso' | 'neck' | 'thigh_L' | 'thigh_R' | 'shin_L' | 'shin_R' | 'foot_L' | 'foot_R' | 'upperarm_L' | 'upperarm_R' | 'forearm_L' | 'forearm_R' | 'hand_L' | 'hand_R' | 'covered';
export interface KitDye { region: string; kind: 'tint'; default?: string; mask?: string }
export interface KitFit { mode?: 'auto' | 'hug' | 'keep'; hugMm?: number; minGapMm?: number; weights?: 'surface' | 'garment' }
export interface KitGarment { id?: string; kind?: 'mesh'; slot: string; band?: 'under' | 'base' | 'mid' | 'armor' | 'outer'; layer?: number; label?: string; file: string | Record<string, string>; nodes?: string[]; segments?: Record<string, string>;
  texture?: string; mask?: string; material?: 'TeamTint' | string; dye?: KitDye[]; variants?: Record<string, { label?: string; texture?: string; mask?: string }>; defaultVariant?: string;
  /** 'body:<region>' | 'slot:<slotId>' | '<garmentId>' | '<garmentId>:<segment>' | 'horns' | 'wings' */ hides?: string[]; hiddenBy?: string[]; displaces?: string[];
  races?: '*' | string[]; fit?: KitFit; shellOffsetM?: number[]; override?: boolean }
export interface KitSlot { id?: string; band: 'under' | 'base' | 'mid' | 'armor' | 'outer'; region?: string; side?: 'l' | 'r' | null; pairWith?: string; layer?: number }
export interface KitRace { id?: string; base: RaceId; label?: string; tones?: number[]; defaults?: Record<string, unknown>; playable?: boolean; heightScale?: number }
export interface KitClip { id?: string; name?: string; file?: string; duration?: number; tracks?: { name: string; type: string; times: number[]; values: number[] }[]; loop?: boolean; license?: string; override?: boolean }
export interface KitManifest { format: 'cf-kit/1'; namespace: string; version: string; label?: string; license?: string; baseUrl?: string; authoredOn?: { race: 'human'; bodyType: 'neutral' };
  rig?: { id: 'cf-humanoid-29'; joints?: string[]; [k: string]: unknown }; slots?: Record<string, KitSlot>; garments?: Record<string, KitGarment>; races?: Record<string, KitRace>; clips?: Record<string, KitClip>; [k: string]: unknown }
export interface KitLoadResult { namespace: string; version: string; slots: string[]; garments: string[]; races: string[]; clips: string[]; overrides: string[]; warnings: Issue[] }
export interface KitFitReport { id: string; layer: number; verts: number; anchors: number; guardMaxMm: number; minGapMm: number; maxGapMm: number; hiddenSegments: string[]; bodyTrisHidden?: number; fitMs?: number; guardMs?: number; statsMs?: number; coverMs?: number }
export interface BodyInfo { /** 2.2.0: kit garment fit reports (when the recipe uses kit garments) */ kit?: KitFitReport[]; ms: number; slices: [string, number][]; maxSliceMs: number; budgetMs: number; steps: number; maxStepMs: number; maxStepAt: string | number | null; workMs: number; trace: StepTrace | null; tris: number; texBytes: number; race: RaceId; bodyType: BodyType; heightM: number; hash: string; lodLevel: 0; clips: string[]; sockets: string[] }
export interface Body {
  object3D: THREE_NS.Group; mixer: THREE_NS.AnimationMixer; readonly clips: Record<string, THREE_NS.AnimationClip>; info: BodyInfo;
  play(name?: 'Idle' | 'Walk' | 'Hover' | 'FlyMove' | 'Run' | 'Attack1H' | 'Magic' | 'PickUp' | 'Cheer' | string, opts?: { fade?: number; timeScale?: number }): THREE_NS.AnimationAction;
  setTimeScale(n: number): void;
  socket(name: 'hand_l' | 'hand_r' | 'back' | 'belt' | 'head' | string): THREE_NS.Object3D | null;
  /** stable for the Body's lifetime (layers / rebuild swap the Character under object3D and re-bind this mixer) */
  setRecipe(next: Recipe, opts?: { signal?: AbortSignal; budgetMs?: number; trace?: boolean }): Promise<{ path: 'painted' | 'layers' | 'rebuild'; ms: number; maxStepMs: number; steps: number; trace: StepTrace | null }>;
  dispose(): void;
}
export interface CFRuntime {
  readonly version: '2.1.1'; readonly api: 2; readonly generatorVersion: number; readonly recipeVersion: 2; readonly bundle: object; freeCpuGeometry: false;
  readonly supports: { api: number[]; generatorVersions: number[]; recipeVersions: number[]; three: string };
  init(o: { THREE?: typeof THREE_NS; baseUrl?: string; bundle?: object; fetch?: typeof fetch; createCanvas?: () => HTMLCanvasElement | OffscreenCanvas; canvasFactory?: () => HTMLCanvasElement | OffscreenCanvas; decodeImage?: (b64png: string) => Promise<CanvasImageSource>; document?: { createElement(t: 'canvas'): HTMLCanvasElement }; policy?: Partial<Policy>; assets?: object; /** = registerAnimSet('ki', url); does NOT change policy.animationSet */ privateAnimBaseUrl?: string; /** = setPolicy({animationSet}) */ animationSet?: Policy['animationSet']; platform?: Platform }): Promise<{ version: string; api: number; generatorVersion: number; policy: Policy; three: boolean; animSets: Record<string, { registered: boolean; loaded: boolean; clips: string[] | null }>; notes: string[] }>;
  setPolicy(p: Partial<Policy>): Policy; getPolicy(): Policy;
  /** private licensed clip pack (KI): folder / manifest URL or loader; enable with policy.animationSet 'cf+ki' | 'cf+cc0+ki' */
  /** 2.2.0 kits: throws Error{code:'CF_KIT_INVALID'|'CF_KIT_CONFLICT'|'CF_KIT_FETCH'} */
  loadKit(src: string | KitManifest, o?: { baseUrl?: string; namespace?: string; signal?: AbortSignal; preload?: boolean }): Promise<KitLoadResult>;
  unloadKit(namespace: string): boolean; validateKit(m: object): { ok: boolean; errors: Issue[]; warnings: Issue[] };
  registry(): { format: 'cf-kit/1'; rig: 'cf-humanoid-29'; kits: Record<string, { version: string; label: string; license: string | null; baseUrl: string; [k: string]: unknown }>; slots: Record<string, object>; garments: Record<string, object>; races: Record<string, object>; clips: Record<string, object> };
  registerSlot(def: KitSlot & { id: string }, o?: { namespace?: string }): KitLoadResult; registerGarment(def: KitGarment & { id: string }, o?: { namespace?: string; baseUrl?: string }): KitLoadResult;
  registerRace(def: KitRace & { id: string }, o?: { namespace?: string }): KitLoadResult; registerClip(def: KitClip, o?: { namespace?: string; baseUrl?: string }): KitLoadResult;
  registerAnimSet(name: 'ki', urlOrLoader: string | AnimPackLoader): { name: string; registered: true };
  animSets(): Record<string, { registered: boolean; loaded: boolean; clips: string[] | null }>;
  catalog(): any; races(): RaceId[]; hideTable(): Record<string, { hides: string[]; hiddenBy: string[] }>;
  options(race: RaceId | string, bodyType?: BodyType): any; describe(recipe: Recipe): any;
  checkEdit(recipe: Recipe, patch: EditPatch): { ok: boolean; recipe: Recipe; errors: Issue[]; warnings: Issue[]; notes?: string[] }; /** throws Error{code:'CF_EDIT_REJECTED', errors} */ edit(recipe: Recipe, patch: EditPatch): Recipe;
  equip(recipe: Recipe, slot: string, garmentId: string, o?: { variant?: string; states?: object; side?: 'both' | 'l' | 'r' }): WardrobeResult;
  unequip(recipe: Recipe, slot: string, o?: { side?: 'both' | 'l' | 'r' }): WardrobeResult;
  dye(recipe: Recipe, garmentId: string, region: string | Record<string, string>, value?: string): WardrobeResult;
  randomRecipe(seed: number | string, opts?: RandomOpts): Recipe; generate(seed: number | string, profileEntry?: object, o?: object): Recipe;
  defaultRecipe(race: RaceId | string, bodyType?: BodyType): Recipe; blankRecipe(race?: RaceId | string, seed?: number): Recipe; normalize(r: object): Recipe;
  validateRecipe(r: object): { ok: boolean; errors: Issue[]; warnings: Issue[] }; validateProfile(p: object): { ok: boolean; errors: Issue[]; warnings: Issue[] };
  recipeHash(r: Recipe): string; migrate(r: object, o?: { to?: 2 }): { recipe: Recipe; lossy: boolean; notes: string[]; carried?: object };
  assetsFor(recipes: Recipe | Recipe[]): Promise<string[]>; assetBytes(recipes: Recipe | Recipe[]): Promise<number>; preload(what: (Recipe | RaceId | string)[], o?: { signal?: AbortSignal }): Promise<void>;
  build(recipe: Recipe, opts?: BuildOpts): Promise<Body>;
  /** 'pixel' = alias of 'tb' (reported in aliases); sunColor / unknown keys throw Error{code:'CF_LIGHTING'} */ setLighting(o: LightingOpts): { mode: string; aliases?: string[]; pending?: true; [k: string]: any };
  updateLods(...a: any[]): number; stats(): { bodies: number; engineLoaded: boolean; timings: [string, number][] }; dispose(): void;
}
declare const CF: CFRuntime; export default CF; export { CF };
