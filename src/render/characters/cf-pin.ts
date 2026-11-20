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
 * v1 fallback pin (`current.json`). The v1 backend checks its runtime against
 * this, and saves record it. A 2.x sync does not replace it: pointing it at
 * a 2.x version would make the 1.2.1 fallback fail its own pin check.
 */
export const CF_PIN: CfPin = readCfPin(pin);

/** Default runtime pin (`current-v2.json`). Loaded when `?cf=` is absent. */
export const CF2_PIN: CfPin = readCfPin(pinV2);

/** Runtime and asset root for the pinned version. 1.2.0 stays on disk when a later pin is synced. */
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
