import { createTimingGame } from './timing';

/** Four strikes along a trail. Any hit brings food back, scaled by the hits. */
export const HUNT_BEATS = 4;
export const HUNT_BEAT_SEC = 5.6;
export const HUNT_WIN = { start: 0.46, end: 0.62 };

export const wagonHunt = createTimingGame({
  id: 'wagon_hunt',
  name: 'Go hunting',
  activity: 'hunt',
  beats: HUNT_BEATS,
  beatSec: HUNT_BEAT_SEC,
  winStart: HUNT_WIN.start,
  winEnd: HUNT_WIN.end,
  need: 1,
  scaleFood: true,
  hint: 'Strike while the mark sits in the moss.',
  doodle: 'tracks',
});
