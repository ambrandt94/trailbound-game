import { FISH_COINS } from './rewards';
import { createTimingGame } from './timing';

/** Three nibbles on the live-town HUD. Any catch pays a share of the purse. */
export const FISH_BEATS = 3;
export const FISH_BEAT_SEC = 6.2;

export const fishGame = createTimingGame({
  id: 'fish',
  name: 'Fishing',
  type: 'world',
  beats: FISH_BEATS,
  beatSec: FISH_BEAT_SEC,
  winStart: 0.5,
  winEnd: 0.66,
  need: 1,
  scaleFood: false,
  hint: 'Hook when the float sits in the green.',
  doodle: 'water',
  reward(hits, beats) {
    if (hits <= 0) return { ok: false, message: 'The fish got away.' };
    const coins = Math.max(1, Math.round((FISH_COINS * hits) / beats));
    return { ok: true, coins, message: `A catch. +${coins} coins.` };
  },
});
