/**
 * The player's avatar as core data. Character Forge recipes stay opaque:
 * this module stores the seed and profile entry that regenerate one, plus
 * the race and gender the rest of the game is allowed to read.
 * Nothing here imports the Forge runtime.
 */

export const REGALIA_MIN_RICHNESS = 0.85;
export const AVATAR_HISTORY_LIMIT = 12;
export const GENERATOR_VERSION = 1;

export type AvatarGender = 'm' | 'f';
export type SlotMode = 'include' | 'exclude';

export interface SlotRule {
  include?: string[];
  exclude?: string[];
}

/** Generator input. Same shape CF.generate accepts. Key order does not matter. */
export interface PlayerProfileEntry {
  races?: Record<string, number>;
  genders?: Partial<Record<AvatarGender, number>>;
  styles?: Record<string, number>;
  slots?: Record<string, SlotRule>;
  richness?: number;
  excludeRaces?: string[];
  ages?: Partial<Record<'adult' | 'child', number>>;
}

export interface PlayerAvatar {
  name: string;
  seed: number;
  profileEntry: PlayerProfileEntry;
  generatorVersion: number;
  recipeHash: string;
  race: string;
  gender: AvatarGender;
  /**
   * Opaque Character Forge recipe. Once a look is generated or edited, this
   * is what reload builds, so dye and slider edits survive a new seed roll.
   */
  recipe?: Readonly<Record<string, unknown>>;
}

export interface SlotChoice {
  mode: SlotMode;
  garment: string;
}

export interface AvatarLocks {
  race: boolean;
  gender: boolean;
  style: boolean;
  richness: boolean;
  slots: boolean;
}

export interface AvatarChoices {
  name: string;
  seed: number;
  race: string;
  gender: AvatarGender;
  style: string;
  richness: number;
  slots: Readonly<Record<string, SlotChoice>>;
  locks: AvatarLocks;
}

export interface ChoiceHistory {
  past: AvatarChoices[];
  present: AvatarChoices;
  future: AvatarChoices[];
}

export interface RandomizeCatalog {
  races: readonly string[];
  styles: readonly string[];
}

const EMPTY_LOCKS: AvatarLocks = {
  race: false,
  gender: false,
  style: false,
  richness: false,
  slots: false,
};

export function defaultChoices(name = 'Traveller'): AvatarChoices {
  return {
    name,
    seed: 1,
    race: 'human',
    gender: 'm',
    style: 'wanderer',
    richness: 0.45,
    slots: {},
    locks: { ...EMPTY_LOCKS },
  };
}

export function defaultPlayerAvatar(name = 'Traveller'): PlayerAvatar {
  const choices = defaultChoices(name);
  return {
    name: choices.name,
    seed: choices.seed,
    profileEntry: profileEntryFromChoices(choices),
    generatorVersion: GENERATOR_VERSION,
    recipeHash: '',
    race: choices.race,
    gender: choices.gender,
  };
}

export function isRegaliaId(id: string): boolean {
  const bare = id.replace(/^(look|arche):/, '');
  return bare === 'royal' || bare.startsWith('royal_');
}

/** Playable race ids. `royal_*` stays hidden until richness clears the regalia gate. */
export function playableIds(
  ids: readonly string[],
  richness: number,
  minRichness = REGALIA_MIN_RICHNESS,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    if (id.startsWith('royal_') && richness < minRichness) continue;
    out.push(id);
  }
  return out;
}

export function profileEntryFromChoices(choices: AvatarChoices): PlayerProfileEntry {
  const entry: PlayerProfileEntry = {
    races: { [choices.race]: 1 },
    genders: { [choices.gender]: 1 },
    richness: clamp01(choices.richness),
    ages: { adult: 1 },
  };
  if (choices.style) entry.styles = { [choices.style]: 1 };
  const slots: Record<string, SlotRule> = {};
  const names = Object.keys(choices.slots).sort();
  for (const slot of names) {
    const choice = choices.slots[slot];
    if (!choice || !choice.garment) continue;
    slots[slot] =
      choice.mode === 'include' ? { include: [choice.garment] } : { exclude: [choice.garment] };
  }
  if (names.length > 0 && Object.keys(slots).length > 0) entry.slots = slots;
  return entry;
}

export function avatarFromChoices(
  choices: AvatarChoices,
  recipeHash: string,
  generatorVersion = GENERATOR_VERSION,
): PlayerAvatar {
  const name = choices.name.trim() || 'Traveller';
  return {
    name,
    seed: choices.seed >>> 0,
    profileEntry: profileEntryFromChoices({ ...choices, name }),
    generatorVersion,
    recipeHash,
    race: choices.race,
    gender: choices.gender,
  };
}

export function choicesFromAvatar(avatar: PlayerAvatar): AvatarChoices {
  const styles = avatar.profileEntry.styles ?? {};
  const style = Object.keys(styles).sort()[0] ?? 'wanderer';
  const slots: Record<string, SlotChoice> = {};
  for (const [slot, rule] of Object.entries(avatar.profileEntry.slots ?? {})) {
    const include = rule?.include?.[0];
    const exclude = rule?.exclude?.[0];
    if (include) slots[slot] = { mode: 'include', garment: include };
    else if (exclude) slots[slot] = { mode: 'exclude', garment: exclude };
  }
  return {
    name: avatar.name,
    seed: avatar.seed >>> 0,
    race: avatar.race,
    gender: avatar.gender,
    style,
    richness: avatar.profileEntry.richness ?? 0.45,
    slots,
    locks: { ...EMPTY_LOCKS },
  };
}

export function cloneChoices(choices: AvatarChoices): AvatarChoices {
  return {
    name: choices.name,
    seed: choices.seed,
    race: choices.race,
    gender: choices.gender,
    style: choices.style,
    richness: choices.richness,
    slots: { ...choices.slots },
    locks: { ...choices.locks },
  };
}

export function sameChoices(a: AvatarChoices, b: AvatarChoices): boolean {
  return JSON.stringify(cloneChoices(a)) === JSON.stringify(cloneChoices(b));
}

export function choiceHistory(present: AvatarChoices): ChoiceHistory {
  return { past: [], present: cloneChoices(present), future: [] };
}

export function recordChoices(history: ChoiceHistory, next: AvatarChoices): ChoiceHistory {
  if (sameChoices(history.present, next)) return history;
  const past = [...history.past, cloneChoices(history.present)];
  while (past.length > AVATAR_HISTORY_LIMIT) past.shift();
  return { past, present: cloneChoices(next), future: [] };
}

export function undoChoices(history: ChoiceHistory): ChoiceHistory {
  const previous = history.past.at(-1);
  if (!previous) return history;
  return {
    past: history.past.slice(0, -1),
    present: cloneChoices(previous),
    future: [cloneChoices(history.present), ...history.future],
  };
}

export function redoChoices(history: ChoiceHistory): ChoiceHistory {
  const next = history.future[0];
  if (!next) return history;
  return {
    past: [...history.past, cloneChoices(history.present)],
    present: cloneChoices(next),
    future: history.future.slice(1),
  };
}

export function randomizeChoices(
  choices: AvatarChoices,
  catalog: RandomizeCatalog,
  random: () => number = Math.random,
): AvatarChoices {
  const next = cloneChoices(choices);
  next.seed = Math.floor(random() * 0x1_0000_0000) >>> 0;
  if (!choices.locks.richness) {
    let richness = Math.round(random() * 100) / 100;
    if (
      choices.locks.race &&
      choices.race.startsWith('royal_') &&
      richness < REGALIA_MIN_RICHNESS
    ) {
      richness = REGALIA_MIN_RICHNESS;
    }
    next.richness = richness;
  }
  if (!choices.locks.race) {
    const races = playableIds(catalog.races, next.richness).filter(
      (id) => !id.startsWith('royal_') || next.richness >= REGALIA_MIN_RICHNESS,
    );
    const pool = races.length > 0 ? races : ['human'];
    next.race = pool[Math.floor(random() * pool.length) % pool.length] ?? 'human';
  }
  if (!choices.locks.gender) next.gender = random() < 0.5 ? 'm' : 'f';
  if (!choices.locks.style) {
    const styles = catalog.styles.filter(
      (id) => next.richness >= REGALIA_MIN_RICHNESS || !isRegaliaId(id),
    );
    const pool = styles.length > 0 ? styles : ['wanderer'];
    next.style = pool[Math.floor(random() * pool.length) % pool.length] ?? 'wanderer';
  }
  if (!choices.locks.slots) next.slots = {};
  return next;
}

export function isPlayerAvatar(value: unknown): value is PlayerAvatar {
  if (!isRecord(value)) return false;
  if (typeof value.name !== 'string' || value.name.length === 0) return false;
  if (typeof value.seed !== 'number' || !Number.isInteger(value.seed) || value.seed < 0)
    return false;
  if (!isRecord(value.profileEntry)) return false;
  if (typeof value.generatorVersion !== 'number' || !Number.isInteger(value.generatorVersion)) {
    return false;
  }
  if (typeof value.recipeHash !== 'string') return false;
  if ('recipe' in value && value.recipe != null && !isRecord(value.recipe)) return false;
  if (typeof value.race !== 'string' || value.race.length === 0) return false;
  if (value.gender !== 'm' && value.gender !== 'f') return false;
  return true;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
