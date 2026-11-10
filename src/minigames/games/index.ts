import { registerMinigame } from '../registry';
import { applesGame } from './apples';
import { arenaGame } from './arena';
import { caveGame } from './cave';
import { chopGame } from './chop';
import { fishGame } from './fish';
import { flapGame } from './flap';
import { runesGame } from './runes';
import { stackGame } from './stack';
import { wagonCook } from './wagon-cook';
import { wagonEat } from './wagon-eat';
import { wagonHunt } from './wagon-hunt';
import { wagonWash } from './wagon-wash';

let wagonBooted = false;
let demoBooted = false;

/** Register the wagon games once. Later packs call this and add their own. */
export function registerWagonMinigames(): void {
  if (wagonBooted) return;
  wagonBooted = true;
  registerMinigame(wagonHunt);
  registerMinigame(wagonCook);
  registerMinigame(wagonEat);
  registerMinigame(wagonWash);
}

/** The eight controller demos. Fish and chop are the world-slot games. */
export function registerDemoMinigames(): void {
  if (demoBooted) return;
  demoBooted = true;
  registerMinigame(fishGame);
  registerMinigame(chopGame);
  registerMinigame(flapGame);
  registerMinigame(applesGame);
  registerMinigame(arenaGame);
  registerMinigame(caveGame);
  registerMinigame(stackGame);
  registerMinigame(runesGame);
}
