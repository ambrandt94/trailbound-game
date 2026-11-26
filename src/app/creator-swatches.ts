/**
 * Character Forge 2 options only return hair and iris ids, with empty `rgb`.
 * Skin tones already include rgb, so they paint correctly. This fills the
 * missing channels so the creator swatches are not solid black.
 *
 * Hair mid-ramp colours come from
 * `public/vendor/character-forge/2.2.1/assets/shared/hair.json`.
 * Iris mid colours come from the v2 engine `IRIS` table.
 */
import type { AvatarEngine } from '../core/people/avatar';
import { characterEngine } from '../render/characters/forge';
import type { EditPatch } from '../render/characters/forge';

const HAIR: Record<string, { rgb: number[]; name: string }> = {
  black: { name: 'Black', rgb: hex('#262638') },
  dark_brown: { name: 'Dark brown', rgb: hex('#482818') },
  brown: { name: 'Brown', rgb: hex('#6a3b20') },
  auburn: { name: 'Auburn', rgb: hex('#73301f') },
  ginger: { name: 'Ginger / orange', rgb: hex('#b04a18') },
  blonde: { name: 'Blonde', rgb: hex('#d4a955') },
  platinum: { name: 'Platinum', rgb: hex('#bcb2b8') },
  silver: { name: 'Grey / silver', rgb: hex('#868c94') },
  forest: { name: 'Forest green (elf)', rgb: hex('#406e30') },
  midnight: { name: 'Midnight blue (elf)', rgb: hex('#323c7a') },
  lilac: { name: 'Lilac (elf)', rgb: hex('#7e5a9e') },
  snow: { name: 'Snow white (elf)', rgb: hex('#c6ccdc') },
  pink: { name: 'Bubblegum pink', rgb: hex('#c25c96') },
  teal: { name: 'Teal', rgb: hex('#26928a') },
  sky: { name: 'Sky blue', rgb: hex('#4a8cc8') },
};

const IRIS: Record<string, { rgb: number[]; name: string }> = {
  glow_gold: { name: 'Glow gold', rgb: hex('#f0b820') },
  glow_ember: { name: 'Glow ember', rgb: hex('#f06a1c') },
  glow_red: { name: 'Glow red', rgb: hex('#e02828') },
  glow_white: { name: 'Glow white', rgb: hex('#e6e6ee') },
  glow_violet: { name: 'Glow violet', rgb: hex('#9a5ae6') },
  gold: { name: 'Gold', rgb: hex('#b8862a') },
  brown: { name: 'Brown', rgb: hex('#7a4a2a') },
  hazel: { name: 'Hazel', rgb: hex('#7f6a34') },
  green: { name: 'Green', rgb: hex('#4f7f46') },
  blue: { name: 'Blue', rgb: hex('#4a7fb8') },
  grey: { name: 'Grey', rgb: hex('#8590a0') },
  black: { name: 'Black', rgb: hex('#2a2430') },
  amber: { name: 'Amber', rgb: hex('#c07a20') },
  violet: { name: 'Violet', rgb: hex('#7a52b8') },
  red: { name: 'Red', rgb: hex('#a83030') },
};

export function paintCreatorSwatch(item: { id: string; rgb: number[]; name?: string }): {
  id: string;
  rgb: number[];
  name?: string;
} {
  if (hasRgb(item.rgb)) return item;
  const painted = HAIR[item.id] ?? IRIS[item.id];
  if (!painted) return item;
  return {
    id: item.id,
    rgb: painted.rgb,
    name: item.name ?? painted.name,
  };
}

/** v2 edits eye colour through `iris`. v1 uses `eyeColor`. */
export function eyeColorPatch(
  id: string,
  engine: AvatarEngine | null = characterEngine(),
): EditPatch {
  return engine === 'cf2' ? { iris: id } : { eyeColor: id };
}

export function hairColorIds(): string[] {
  return Object.keys(HAIR);
}

export function irisColorIds(): string[] {
  return Object.keys(IRIS);
}

function hasRgb(channels: number[]): boolean {
  return channels.length >= 3 && channels.every((channel) => Number.isFinite(channel));
}

function hex(value: string): number[] {
  const raw = value.startsWith('#') ? value.slice(1) : value;
  return [
    Number.parseInt(raw.slice(0, 2), 16),
    Number.parseInt(raw.slice(2, 4), 16),
    Number.parseInt(raw.slice(4, 6), 16),
  ];
}
