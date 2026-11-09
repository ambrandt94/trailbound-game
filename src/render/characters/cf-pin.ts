import type { CfPin } from '../../core/save/types';
import pin from '../../../public/vendor/character-forge/current.json';

const VERSION = /^\d+\.\d+\.\d+$/;

/** The vendored pin. `npm run sync:cf` writes this file and the matching runtime directory. */
export function readCfPin(value: { version: string; generatorVersion: number }): CfPin {
  if (!VERSION.test(value.version)) throw new Error('CF pin version is invalid');
  if (!Number.isInteger(value.generatorVersion))
    throw new Error('CF pin generatorVersion is invalid');
  return { version: value.version, generatorVersion: String(value.generatorVersion) };
}

export const CF_PIN: CfPin = readCfPin(pin);

/** Runtime and asset root for the pinned version. 1.2.0 stays on disk when a later pin is synced. */
export function characterForgePaths(version: string = CF_PIN.version): {
  runtime: string;
  base: string;
} {
  if (!VERSION.test(version)) throw new Error('CF pin version is invalid');
  const root = `vendor/character-forge/${version}`;
  return { runtime: `${root}/cf-runtime.mjs`, base: `${root}/` };
}
