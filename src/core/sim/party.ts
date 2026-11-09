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
export const EAT_TU = 5;
export const EAT_MORALE = 5;
export const OVERNIGHT_FOOD = 10;
export const HUNGRY_MORALE = 10;

export type WagonActionId = 'hunt' | 'cook' | 'eat' | 'sleep';

export interface PartyState {
  hasWagon: boolean;
  rawFood: number;
  meals: number;
  morale: number;
  hungry: boolean;
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

export function createParty(): PartyState {
  return {
    hasWagon: true,
    rawFood: START_RAW_FOOD,
    meals: 0,
    morale: START_MORALE,
    hungry: false,
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
      label: 'Eat / wash dishes',
      detail: `${EAT_TU} TU · a meal, morale +${EAT_MORALE}`,
    },
  ];
}

export function applyWagonAction(party: PartyState, id: WagonActionId, tu: number): WagonResult {
  const offered = wagonMenuRows(tu).some((row) => row.id === id);
  if (!offered) {
    return { party, tu: 0, sleep: false, message: 'Not now.' };
  }
  if (id === 'hunt') {
    return {
      party: { ...party, rawFood: party.rawFood + HUNT_FOOD },
      tu: HUNT_TU,
      sleep: false,
      message: `The hunt brings back ${HUNT_FOOD} food.`,
    };
  }
  if (id === 'cook') {
    if (party.rawFood < 1) {
      return { party, tu: 0, sleep: false, message: 'No food to cook.' };
    }
    return {
      party: { ...party, rawFood: party.rawFood - 1, meals: party.meals + 1 },
      tu: COOK_TU,
      sleep: false,
      message: 'Cooked a meal.',
    };
  }
  if (id === 'eat') {
    if (party.meals < 1) {
      return { party, tu: 0, sleep: false, message: 'No meal ready.' };
    }
    return {
      party: {
        ...party,
        meals: party.meals - 1,
        hungry: false,
        morale: party.morale + EAT_MORALE,
      },
      tu: EAT_TU,
      sleep: false,
      message: `You eat and wash the dishes. Morale +${EAT_MORALE}.`,
    };
  }
  return { party, tu: 0, sleep: true, message: 'You sleep until dawn.' };
}

export function formatPartyReadout(clockHours: number, party: PartyState): string {
  const tu = Math.floor(tuOfDay(clockHours));
  const hungry = party.hungry ? '  Hungry' : '';
  return `TU ${tu}  food ${party.rawFood}  meals ${party.meals}  morale ${party.morale}${hungry}`;
}

/** Hours a Sleep action should add. Kept next to the action so the clock stays one. */
export function sleepHours(clockHours: number): number {
  return hoursUntilNextDawn(clockHours);
}

function count(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.round(value));
}
