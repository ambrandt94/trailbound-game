import type { CfPin } from '../core/save/types';

export const GAME_VERSION = '0.0.0';
export const SAVE_SLOT = 'slot-1';

/** Matches `public/vendor/character-forge/current.json`. generatorVersion is stored as text on the save. */
export const CF_PIN: CfPin = {
  version: '1.2.0',
  generatorVersion: '1',
};

export const PLAYER_NAME = 'Traveller';
