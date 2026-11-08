import { signal } from '@preact/signals';
import type { LandStyle } from '../core/world/models';
import type { AvatarGender } from '../core/people/avatar';

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
