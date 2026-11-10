/**
 * Draft party supplies. Numbers live here so the wagon stubs stay easy to retune.
 * `rawFood` is the uncooked stock. `meals` are cooked. Hungry clears only by eating.
 */
import { hoursUntilNextDawn, SLEEP_ONLY_TU, tuOfDay } from './time';

export const START_RAW_FOOD = 40;
export const START_MORALE = 0;
export const HUNT_TU = 15;
export const HUNT_FOOD = 10;
export const COOK_TU = 10;
/** Split from the old 5 TU eat-and-wash stub. */
export const EAT_TU = 3;
export const WASH_TU = 3;
export const EAT_MORALE = 5;
/** A clean camp is a smaller lift than a hot meal. */
export const WASH_MORALE = 2;
export const OVERNIGHT_FOOD = 10;
export const HUNGRY_MORALE = 10;

export type WagonActionId = 'hunt' | 'cook' | 'eat' | 'wash' | 'sleep';
export type WagonPlayId = Exclude<WagonActionId, 'sleep'>;

export interface PartyState {
  hasWagon: boolean;
  rawFood: number;
  meals: number;
  morale: number;
  hungry: boolean;
  /** Plates left from meals. Older saves omit it and load as 0. */
  dirtyDishes: number;
  /** Purse. Demo minigames pay this. Older saves omit it and load as 0. */
  coins: number;
}

export interface WagonRow {
  id: WagonActionId;
  label: string;
  detail: string;
}

export interface WagonResult {
  party: PartyState;
  /** TU to add after the action. Zero when the action is refused or is Sleep. */
  tu: number;
  /** Skip the clock to the next dawn. */
  sleep: boolean;
  message: string;
}

/** What a finished minigame asks the world to apply. */
export interface MinigameResult {
  ok: boolean;
  message: string;
  coins?: number;
  tu?: number;
  rawFoodDelta?: number;
  mealsDelta?: number;
  dirtyDishesDelta?: number;
  moraleDelta?: number;
  clearHungry?: boolean;
  /** Set on wagon games. A miss or a quit spends half that activity's TU. */
  activity?: WagonPlayId;
}

export interface ResolvedMinigame {
  party: PartyState;
  tu: number;
  message: string;
  /** Lines for the result card, including a zero food line on wagon misses. */
  lines: string[];
}

export function createParty(): PartyState {
  return {
    hasWagon: true,
    rawFood: START_RAW_FOOD,
    meals: 0,
    morale: START_MORALE,
    hungry: false,
    dirtyDishes: 0,
    coins: 0,
  };
}

export function normalizeParty(value: unknown): PartyState {
  const fallback = createParty();
  if (!value || typeof value !== 'object') return fallback;
  const raw = value as Partial<PartyState>;
  return {
    hasWagon: raw.hasWagon !== false,
    rawFood: count(raw.rawFood, fallback.rawFood),
    meals: count(raw.meals, 0),
    morale: Number.isFinite(raw.morale) ? Math.round(raw.morale as number) : fallback.morale,
    hungry: raw.hungry === true,
    dirtyDishes: count(raw.dirtyDishes, 0),
    coins: count(raw.coins, 0),
  };
}

/** One overnight: eat `OVERNIGHT_FOOD`. At zero the party becomes Hungry once. */
export function applyOvernight(party: PartyState): PartyState {
  const rawFood = Math.max(0, party.rawFood - OVERNIGHT_FOOD);
  const becameHungry = rawFood === 0 && !party.hungry;
  return {
    ...party,
    rawFood,
    hungry: rawFood === 0 ? true : party.hungry,
    morale: becameHungry ? party.morale - HUNGRY_MORALE : party.morale,
  };
}

export function wagonMenuRows(tu: number): WagonRow[] {
  const t = ((tu % 100) + 100) % 100;
  if (t >= SLEEP_ONLY_TU) {
    return [{ id: 'sleep', label: 'Sleep', detail: 'Skip to dawn' }];
  }
  return [
    { id: 'hunt', label: 'Go hunting', detail: `${HUNT_TU} TU · food +${HUNT_FOOD}` },
    { id: 'cook', label: 'Cook meal', detail: `${COOK_TU} TU · 1 food → 1 meal` },
    {
      id: 'eat',
      label: 'Eat',
      detail: `${EAT_TU} TU · a meal, morale +${EAT_MORALE}, a dirty dish`,
    },
    {
      id: 'wash',
      label: 'Wash dishes',
      detail: `${WASH_TU} TU · clear dishes, morale +${WASH_MORALE}`,
    },
  ];
}

export function activityTu(id: WagonActionId): number {
  switch (id) {
    case 'hunt':
      return HUNT_TU;
    case 'cook':
      return COOK_TU;
    case 'eat':
      return EAT_TU;
    case 'wash':
      return WASH_TU;
    case 'sleep':
      return 0;
    default: {
      const unknown: never = id;
      return unknown;
    }
  }
}

/** Half the activity, rounded. A miss or a quit spends this and nothing else. */
export function halfActivityTu(id: WagonActionId): number {
  return Math.round(activityTu(id) / 2);
}

/** Why the row should not open. Null means the minigame may start. */
export function wagonRefusal(party: PartyState, id: WagonActionId, tu: number): string | null {
  const offered = wagonMenuRows(tu).some((row) => row.id === id);
  if (!offered) return 'Not now.';
  if (id === 'cook' && party.rawFood < 1) return 'No food to cook.';
  if (id === 'eat' && party.meals < 1) return 'No meal ready.';
  if (id === 'wash' && party.dirtyDishes < 1) return 'No dishes to wash.';
  return null;
}

const WAGON_MISS: Record<WagonPlayId, string> = {
  hunt: 'The trail goes cold.',
  cook: 'The pot scorches. Nothing is served.',
  eat: 'You push the bowl away.',
  wash: 'The grease stays put.',
};

/** Result a wagon minigame hands the host. `foodScale` scales a successful hunt. */
export function wagonPlayResult(
  id: WagonPlayId,
  outcome: { ok: boolean; foodScale?: number; message?: string },
): MinigameResult {
  if (!outcome.ok) {
    return {
      ok: false,
      activity: id,
      message: outcome.message ?? WAGON_MISS[id],
    };
  }
  if (id === 'hunt') {
    const scale = outcome.foodScale ?? 1;
    return {
      ok: true,
      activity: id,
      tu: HUNT_TU,
      rawFoodDelta: Math.max(0, Math.round(HUNT_FOOD * scale)),
      message: outcome.message ?? `The hunt brings back food.`,
    };
  }
  if (id === 'cook') {
    return {
      ok: true,
      activity: id,
      tu: COOK_TU,
      rawFoodDelta: -1,
      mealsDelta: 1,
      message: outcome.message ?? 'Cooked a meal.',
    };
  }
  if (id === 'eat') {
    return {
      ok: true,
      activity: id,
      tu: EAT_TU,
      mealsDelta: -1,
      dirtyDishesDelta: 1,
      moraleDelta: EAT_MORALE,
      clearHungry: true,
      message: outcome.message ?? `You eat. Morale +${EAT_MORALE}. A dish is left dirty.`,
    };
  }
  return {
    ok: true,
    activity: id,
    tu: WASH_TU,
    moraleDelta: WASH_MORALE,
    message: outcome.message ?? `The plates come clean. Morale +${WASH_MORALE}.`,
  };
}

/**
 * Apply a finished minigame to a party copy. Wagon misses spend half TU and
 * leave food, meals, dishes, morale, hunger, and coins alone.
 * A successful wash clears every dirty dish.
 */
export function resolveMinigame(party: PartyState, result: MinigameResult): ResolvedMinigame {
  const before = { ...party };
  if (!result.ok) {
    const tu = result.activity ? halfActivityTu(result.activity) : 0;
    return {
      party: before,
      tu,
      message: result.message,
      lines: result.activity ? wagonLines(before, before, tu) : [],
    };
  }
  const next: PartyState = {
    ...party,
    rawFood: count(party.rawFood + (result.rawFoodDelta ?? 0), 0),
    meals: count(party.meals + (result.mealsDelta ?? 0), 0),
    dirtyDishes: count(party.dirtyDishes + (result.dirtyDishesDelta ?? 0), 0),
    coins: count(party.coins + (result.coins ?? 0), 0),
    morale:
      party.morale + (Number.isFinite(result.moraleDelta) ? Math.round(result.moraleDelta!) : 0),
    hungry: result.clearHungry ? false : party.hungry,
  };
  if (result.activity === 'wash') next.dirtyDishes = 0;
  const tu = result.tu ?? (result.activity ? activityTu(result.activity) : 0);
  return {
    party: next,
    tu,
    message: result.message,
    lines: result.activity ? wagonLines(before, next, tu) : rewardLines(before, next, tu),
  };
}

/** Sleep still resolves here. Hunt, cook, eat, and wash open a minigame instead. */
export function applyWagonAction(party: PartyState, id: WagonActionId, tu: number): WagonResult {
  const refusal = wagonRefusal(party, id, tu);
  if (refusal) return { party, tu: 0, sleep: false, message: refusal };
  if (id === 'sleep') return { party, tu: 0, sleep: true, message: 'You sleep until dawn.' };
  return { party, tu: 0, sleep: false, message: 'Step up to it.' };
}

export function formatPartyReadout(clockHours: number, party: PartyState): string {
  const tu = Math.floor(tuOfDay(clockHours));
  const hungry = party.hungry ? '  Hungry' : '';
  return `TU ${tu}  food ${party.rawFood}  meals ${party.meals}  dishes ${party.dirtyDishes}  coins ${party.coins}  morale ${party.morale}${hungry}`;
}

/** Hours a Sleep action should add. Kept next to the action so the clock stays one. */
export function sleepHours(clockHours: number): number {
  return hoursUntilNextDawn(clockHours);
}

function wagonLines(before: PartyState, after: PartyState, tu: number): string[] {
  const lines = [`TU +${tu}`, `food ${signed(after.rawFood - before.rawFood)}`];
  pushDelta(lines, 'meals', after.meals - before.meals);
  pushDelta(lines, 'dishes', after.dirtyDishes - before.dirtyDishes);
  pushDelta(lines, 'morale', after.morale - before.morale);
  pushDelta(lines, 'coins', after.coins - before.coins);
  if (before.hungry && !after.hungry) lines.push('Hungry cleared');
  return lines;
}

function rewardLines(before: PartyState, after: PartyState, tu: number): string[] {
  const lines: string[] = [];
  if (tu) lines.push(`TU +${tu}`);
  pushDelta(lines, 'food', after.rawFood - before.rawFood);
  pushDelta(lines, 'meals', after.meals - before.meals);
  pushDelta(lines, 'dishes', after.dirtyDishes - before.dirtyDishes);
  pushDelta(lines, 'morale', after.morale - before.morale);
  pushDelta(lines, 'coins', after.coins - before.coins);
  if (before.hungry && !after.hungry) lines.push('Hungry cleared');
  return lines;
}

function pushDelta(lines: string[], label: string, delta: number): void {
  if (delta !== 0) lines.push(`${label} ${signed(delta)}`);
}

function signed(delta: number): string {
  if (delta > 0) return `+${delta}`;
  if (delta === 0) return '+0';
  return String(delta);
}

function count(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.round(value));
}
