import type { CfPin } from '../../core/save/types';
import pin from '../../../public/vendor/character-forge/current.json';
import pinV2 from '../../../public/vendor/character-forge/current-v2.json';

const VERSION = /^\d+\.\d+\.\d+$/;

/** The vendored pin. `npm run sync:cf` writes this file and the matching runtime directory. */
export function readCfPin(value: { version: string; generatorVersion: number }): CfPin {
  if (!VERSION.test(value.version)) throw new Error('CF pin version is invalid');
  if (!Number.isInteger(value.generatorVersion))
    throw new Error('CF pin generatorVersion is invalid');
  return { version: value.version, generatorVersion: String(value.generatorVersion) };
}

/**
 * Save pin (`current.json`). A 2.x sync writes this and `current-v2.json` to
 * the same version. Saves record it. There is no separate v1 pin.
 */
export const CF_PIN: CfPin = readCfPin(pin);

/** Runtime pin (`current-v2.json`). This is the Character Forge the game loads. */
export const CF2_PIN: CfPin = readCfPin(pinV2);

/** Runtime and asset root for a Character Forge version. */
export function characterForgePaths(version: string = CF_PIN.version): {
  runtime: string;
  base: string;
} {
  if (!VERSION.test(version)) throw new Error('CF pin version is invalid');
  const root = `vendor/character-forge/${version}`;
  return { runtime: `${root}/cf-runtime.mjs`, base: `${root}/` };
}

/** Runtime and asset root for the vendored Character Forge 2 pin. */
export function characterForgeV2Paths(version: string = CF2_PIN.version): {
  runtime: string;
  base: string;
} {
  return characterForgePaths(version);
}
