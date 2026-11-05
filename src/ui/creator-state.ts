import { signal } from '@preact/signals';
import type { AvatarGender, SlotMode } from '../core/people/avatar';

export interface StyleOption {
  id: string;
  label: string;
}

export interface SlotChip {
  slot: string;
  label: string;
  mode: SlotMode;
  garment: string;
}

export interface CreatorView {
  intent: 'new' | 'edit';
  name: string;
  race: string;
  gender: AvatarGender;
  style: string;
  richness: number;
  seed: number;
  locks: {
    race: boolean;
    gender: boolean;
    style: boolean;
    richness: boolean;
    slots: boolean;
  };
  races: string[];
  styles: StyleOption[];
  slots: string[];
  garments: string[];
  slot: string;
  garment: string;
  slotMode: 'any' | SlotMode;
  chips: SlotChip[];
  regaliaWarning: string;
  pixieNote: string;
  note: string;
  hash: string;
  canUndo: boolean;
  canRedo: boolean;
  clip: 'Idle' | 'Walk';
  turntable: boolean;
}

export const creatorView = signal<CreatorView>(emptyCreatorView());
export const creatorBusy = signal(false);
export const creatorSource = signal<'forge' | 'placeholder' | ''>('');
export const creatorSerial = signal(0);

export interface CreatorCommands {
  setName(name: string): void;
  commitName(): void;
  setRace(race: string): void;
  setGender(gender: AvatarGender): void;
  setStyle(style: string): void;
  beginGesture(): void;
  setRichness(value: number): void;
  endGesture(): void;
  toggleLock(field: 'race' | 'gender' | 'style' | 'richness' | 'slots'): void;
  setSlot(slot: string): void;
  setGarment(garment: string): void;
  setSlotMode(mode: 'any' | SlotMode): void;
  applySlot(): void;
  clearSlot(slot: string): void;
  randomize(): void;
  undo(): void;
  redo(): void;
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
  setStyle: noop,
  beginGesture: noop,
  setRichness: noop,
  endGesture: noop,
  toggleLock: noop,
  setSlot: noop,
  setGarment: noop,
  setSlotMode: noop,
  applySlot: noop,
  clearSlot: noop,
  randomize: noop,
  undo: noop,
  redo: noop,
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
    style: 'wanderer',
    richness: 0.45,
    seed: 1,
    locks: { race: false, gender: false, style: false, richness: false, slots: false },
    races: ['human'],
    styles: [{ id: 'wanderer', label: 'Wanderer' }],
    slots: [],
    garments: [],
    slot: '',
    garment: '',
    slotMode: 'any',
    chips: [],
    regaliaWarning: '',
    pixieNote: '',
    note: '',
    hash: '',
    canUndo: false,
    canRedo: false,
    clip: 'Idle',
    turntable: false,
  };
}
