import type { CfPin } from '../core/save/types';

export const GAME_VERSION = '0.0.0';
export const SAVE_SLOT = 'slot-1';

/** No Character Forge bundle is vendored in G0. The pin is stored so saves stay shaped for G4. */
export const CF_PIN: CfPin = {
  version: 'unvendored',
  generatorVersion: 'none',
};

export const PLAYER_NAME = 'Traveller';
