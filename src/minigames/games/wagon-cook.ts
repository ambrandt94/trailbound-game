import { createTimingGame } from './timing';

/** Five stirs. Three in the window serves the meal. */
export const COOK_BEATS = 5;
export const COOK_BEAT_SEC = 5.2;
export const COOK_NEED = 3;
export const COOK_WIN = { start: 0.4, end: 0.58 };

export const wagonCook = createTimingGame({
  id: 'wagon_cook',
  name: 'Cook meal',
  activity: 'cook',
  beats: COOK_BEATS,
  beatSec: COOK_BEAT_SEC,
  winStart: COOK_WIN.start,
  winEnd: COOK_WIN.end,
  need: COOK_NEED,
  scaleFood: false,
  hint: 'Stir when the spoon crosses the front of the pot.',
  doodle: 'pot',
});
