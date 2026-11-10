import { CHOP_COINS } from './rewards';
import { createTimingGame } from './timing';

/** Four axe swings. Three in the notch fells the log. */
export const CHOP_BEATS = 4;
export const CHOP_BEAT_SEC = 5.4;
export const CHOP_NEED = 3;

export const chopGame = createTimingGame({
  id: 'chop',
  name: 'Chop wood',
  type: 'world',
  beats: CHOP_BEATS,
  beatSec: CHOP_BEAT_SEC,
  winStart: 0.42,
  winEnd: 0.58,
  need: CHOP_NEED,
  scaleFood: false,
  hint: 'Chop while the axe is in the notch.',
  doodle: 'axe',
  reward(hits) {
    if (hits < CHOP_NEED) return { ok: false, message: 'The log holds.' };
    return { ok: true, coins: CHOP_COINS, message: `The log splits. +${CHOP_COINS} coins.` };
  },
});
