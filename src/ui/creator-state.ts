import { signal } from '@preact/signals';
import {
  DEFAULT_WORLD_SETTINGS,
  clampSettings,
  type LandStyle,
  type WorldSettings,
} from '../core/world/models';
import type { AvatarGender } from '../core/people/avatar';
import { DEFAULT_WORLD_SEED } from '../core/world/index';

export interface SwatchView {
  id: string;
  rgb: number[];
  label: string;
}

export interface SliderView {
  id: string;
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
}

export interface PartView {
  key: 'shape' | 'brow' | 'nose' | 'noseType' | 'mouth';
  label: string;
  value: string;
  options: string[];
}

export interface DyeView {
  region: string;
  rgb: number[];
  swatches: number[][];
}

export interface StateView {
  name: string;
  value: string;
  options: string[];
}

export interface CreatorView {
  intent: 'new' | 'edit';
  name: string;
  race: string;
  gender: AvatarGender;
  races: string[];
  seed: number;
  skins: SwatchView[];
  skin: string;
  hairColors: SwatchView[];
  hairColor: string;
  showHairColor: boolean;
  iris: SwatchView[];
  eyeColor: string;
  scleras: SwatchView[];
  sclera: string;
  styles: Array<{ id: string; label: string }>;
  hairStyle: string;
  showHairStyle: boolean;
  hatNote: string;
  facialHair: Array<{ id: string; label: string }>;
  facial: string;
  showFacial: boolean;
  showStubble: boolean;
  stubble: number;
  lengths: SliderView[];
  heightSliders: SliderView[];
  buildSliders: SliderView[];
  shapeSliders: SliderView[];
  facePresets: string[];
  facePreset: string;
  faceParts: PartView[];
  faceParams: SliderView[];
  slots: string[];
  slot: string;
  garment: string;
  garments: string[];
  worn: Record<string, string>;
  dyes: DyeView[];
  paperdoll: boolean;
  focus: 'full' | 'upper' | 'lower';
  /** Upper and lower lists exist only when the edit catalog published slot regions. */
  regionsReady: boolean;
  states: StateView[];
  homes: string[];
  notice: string;
  warnings: string[];
  errors: string[];
  note: string;
  hash: string;
  canUndo: boolean;
  canRedo: boolean;
  clip: 'Idle' | 'Walk';
  turntable: boolean;
  pixieNote: string;
}

export const creatorView = signal<CreatorView>(emptyCreatorView());

/** Land shape for the next new world. Random picks a style from the world seed. */
export const newWorldLand = signal<LandStyle>('random');

/** New-world generation choices beside the land shape. Ranges follow `clampSettings`. */
export type NewWorldGen = Pick<
  WorldSettings,
  | 'worldScale'
  | 'poiCount'
  | 'wanderers'
  | 'caravans'
  | 'armies'
  | 'residentsMode'
  | 'avgPerHouse'
  | 'avgPerPlace'
  | 'planet'
  | 'worldSource'
  | 'homeChunk'
  | 'seaLevel'
  | 'tempBias'
  | 'moistBias'
  | 'cultureOverride'
>;

/** Seed of the next new world (World Gen's seed field and re-roll). */
export const newWorldSeed = signal<number>(DEFAULT_WORLD_SEED);

export function defaultNewWorldGen(): NewWorldGen {
  const d = DEFAULT_WORLD_SETTINGS;
  return {
    worldScale: d.worldScale,
    poiCount: d.poiCount,
    wanderers: d.wanderers,
    caravans: d.caravans,
    armies: d.armies,
    residentsMode: d.residentsMode,
    avgPerHouse: d.avgPerHouse,
    avgPerPlace: d.avgPerPlace,
    planet: d.planet,
    worldSource: d.worldSource,
    homeChunk: d.homeChunk,
    seaLevel: d.seaLevel,
    tempBias: d.tempBias,
    moistBias: d.moistBias,
  };
}

export const newWorldGen = signal<NewWorldGen>(defaultNewWorldGen());

/** Merge one change and clamp it to the world-settings ranges. */
export function setNewWorldGen(patch: Partial<NewWorldGen>): void {
  const next = clampSettings({ ...DEFAULT_WORLD_SETTINGS, ...newWorldGen.value, ...patch });
  newWorldGen.value = {
    worldScale: next.worldScale,
    poiCount: next.poiCount,
    wanderers: next.wanderers,
    caravans: next.caravans,
    armies: next.armies,
    residentsMode: next.residentsMode,
    avgPerHouse: next.avgPerHouse,
    avgPerPlace: next.avgPerPlace,
    planet: next.planet,
    worldSource: next.worldSource,
    homeChunk: next.homeChunk,
    seaLevel: next.seaLevel,
    tempBias: next.tempBias,
    moistBias: next.moistBias,
    ...(next.cultureOverride ? { cultureOverride: next.cultureOverride } : {}),
  };
}

/**
 * Full settings for the next new world: land shape plus the generation choices.
 * `?settlementGen=1|2|3` forces a generation. `?culture=orc` forces a layout style.
 */
export function newWorldSettings(): WorldSettings {
  const settings = clampSettings({
    ...DEFAULT_WORLD_SETTINGS,
    ...newWorldGen.value,
    mapStyle: newWorldLand.value,
  });
  try {
    const params = new URLSearchParams(globalThis.location?.search ?? '');
    const flag = params.get('settlementGen');
    const culture = params.get('culture');
    const patch: Partial<WorldSettings> = {};
    if (flag === '1' || flag === '2' || flag === '3')
      patch.settlementGen = Number(flag) as 1 | 2 | 3;
    if (culture === 'human' || culture === 'orc' || culture === 'mouse')
      patch.cultureOverride = culture;
    if (patch.settlementGen || patch.cultureOverride)
      return clampSettings({ ...settings, ...patch });
  } catch {
    /* location is absent in some test runners */
  }
  return settings;
}
export const creatorBusy = signal(false);
export const creatorSource = signal<'forge' | 'placeholder' | ''>('');
export const creatorSerial = signal(0);

export interface CreatorCommands {
  setName(name: string): void;
  commitName(): void;
  setRace(race: string): void;
  setGender(gender: AvatarGender): void;
  randomize(): void;
  undo(): void;
  redo(): void;
  setSkin(id: string): void;
  setHairColor(id: string): void;
  setEye(id: string): void;
  setSclera(id: string): void;
  setHairStyle(id: string): void;
  setFacialHair(id: string): void;
  setStubble(value: number): void;
  beginGesture(): void;
  setLength(id: string, value: number): void;
  setSlider(id: string, value: number): void;
  setFaceParam(id: string, value: number): void;
  endGesture(): void;
  setFacePreset(id: string): void;
  setFacePart(key: PartView['key'], value: string): void;
  setSlot(slot: string): void;
  setGarment(id: string): void;
  setDye(region: string, rgb: number[]): void;
  openPaperdoll(): void;
  closePaperdoll(): void;
  setFocus(focus: 'full' | 'upper' | 'lower'): void;
  setGarmentState(name: string, value: string): void;
  setClip(clip: 'Idle' | 'Walk'): void;
  setTurntable(on: boolean): void;
  frame(mode: 'face' | 'body'): void;
  confirm(): void;
  cancel(): void;
}

function noop(): void {
  return;
}

export const creatorCommands: CreatorCommands = {
  setName: noop,
  commitName: noop,
  setRace: noop,
  setGender: noop,
  randomize: noop,
  undo: noop,
  redo: noop,
  setSkin: noop,
  setHairColor: noop,
  setEye: noop,
  setSclera: noop,
  setHairStyle: noop,
  setFacialHair: noop,
  setStubble: noop,
  beginGesture: noop,
  setLength: noop,
  setSlider: noop,
  setFaceParam: noop,
  endGesture: noop,
  setFacePreset: noop,
  setFacePart: noop,
  setSlot: noop,
  setGarment: noop,
  setDye: noop,
  openPaperdoll: noop,
  closePaperdoll: noop,
  setFocus: noop,
  setGarmentState: noop,
  setClip: noop,
  setTurntable: noop,
  frame: noop,
  confirm: noop,
  cancel: noop,
};

export function bindCreator(next: CreatorCommands): void {
  Object.assign(creatorCommands, next);
}

export function emptyCreatorView(): CreatorView {
  return {
    intent: 'new',
    name: 'Traveller',
    race: 'human',
    gender: 'm',
    races: ['human'],
    seed: 1,
    skins: [],
    skin: '',
    hairColors: [],
    hairColor: '',
    showHairColor: true,
    iris: [],
    eyeColor: '',
    scleras: [],
    sclera: '',
    styles: [],
    hairStyle: '',
    showHairStyle: true,
    hatNote: '',
    facialHair: [],
    facial: '',
    showFacial: false,
    showStubble: false,
    stubble: 0,
    lengths: [],
    heightSliders: [],
    buildSliders: [],
    shapeSliders: [],
    facePresets: [],
    facePreset: 'race',
    faceParts: [],
    faceParams: [],
    slots: [],
    slot: '',
    garment: '',
    garments: [],
    worn: {},
    dyes: [],
    paperdoll: false,
    focus: 'full',
    regionsReady: false,
    states: [],
    homes: [],
    notice: '',
    warnings: [],
    errors: [],
    note: '',
    hash: '',
    canUndo: false,
    canRedo: false,
    clip: 'Idle',
    turntable: false,
    pixieNote: '',
  };
}
