import { createTimingGame } from './timing';

/** Four bites. Three land the meal. */
export const EAT_BEATS = 4;
export const EAT_BEAT_SEC = 5.8;
export const EAT_NEED = 3;
export const EAT_WIN = { start: 0.48, end: 0.64 };

export const wagonEat = createTimingGame({
  id: 'wagon_eat',
  name: 'Eat',
  activity: 'eat',
  beats: EAT_BEATS,
  beatSec: EAT_BEAT_SEC,
  winStart: EAT_WIN.start,
  winEnd: EAT_WIN.end,
  need: EAT_NEED,
  scaleFood: false,
  hint: 'Bite while the spoon is in the bowl.',
  doodle: 'bowl',
});
