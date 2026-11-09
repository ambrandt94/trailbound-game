import { registerMinigame } from '../registry';
import { wagonCook } from './wagon-cook';
import { wagonEat } from './wagon-eat';
import { wagonHunt } from './wagon-hunt';
import { wagonWash } from './wagon-wash';

let booted = false;

/** Register the wagon games once. Later packs call this and add their own. */
export function registerWagonMinigames(): void {
  if (booted) return;
  booted = true;
  registerMinigame(wagonHunt);
  registerMinigame(wagonCook);
  registerMinigame(wagonEat);
  registerMinigame(wagonWash);
}
