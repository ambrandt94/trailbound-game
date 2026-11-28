import type { CfPin } from '../core/save/types';
import { CF_PIN as PINNED } from '../render/characters/cf-pin';

export const GAME_VERSION = '0.0.0';
export const SAVE_SLOT = 'slot-1';

/**
 * Character Forge pin from `current.json`. generatorVersion is stored as text
 * on the save. `current-v2.json` (`CF2_PIN`) names the same runtime.
 */
export const CF_PIN: CfPin = PINNED;

export const PLAYER_NAME = 'Traveller';
