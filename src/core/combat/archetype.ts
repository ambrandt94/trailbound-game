/**
 * Each weapon button is one swing shape. A heavy replays that same shape
 * with charge; it does not switch archetype.
 *
 * Fists — X thrust (jab and cross), Y bash (the kick). A punch is a line,
 * a kick is a committed body check.
 * Axe — X vertical (chop and cleave), Y horizontal (the hook). The head
 * falls and then cuts across.
 * Hammer — X vertical (swing and overhead), Y bash (sweep and slam). The
 * weight drops, or the whole body shoves.
 * Daggers — X thrust (nick and carve), Y horizontal (the dash cut). Points
 * first, edges second.
 * Sword & shield — X horizontal (slash), Y bash (the shield). The blade
 * arcs; the shield is the shove. Thrust stays with the daggers.
 * Counters use the off-hand shape: a bash for fists, hammer, and shield,
 * a horizontal hook for the axe, a thrust for the riposte.
 */

export type Archetype = 'horizontal' | 'vertical' | 'thrust' | 'bash';

export type AttackButtonName = 'x' | 'y' | 'counter';

interface Pair {
  x: Archetype;
  y: Archetype;
  counter: Archetype;
}

export const WEAPON_ARCHETYPES: Record<string, Pair> = {
  fists: { x: 'thrust', y: 'bash', counter: 'bash' },
  axe: { x: 'vertical', y: 'horizontal', counter: 'horizontal' },
  hammer: { x: 'vertical', y: 'bash', counter: 'bash' },
  daggers: { x: 'thrust', y: 'horizontal', counter: 'thrust' },
  'sword-shield': { x: 'horizontal', y: 'bash', counter: 'bash' },
};

export function archetypeFor(weaponId: string, button: AttackButtonName): Archetype {
  const pair = WEAPON_ARCHETYPES[weaponId] ?? WEAPON_ARCHETYPES.fists;
  if (!pair) return 'thrust';
  return pair[button];
}
