/**
 * `?cf=` picks the character backend.
 * `0` is handled by `forge.ts` and skips the runtime.
 * Anything else, including a missing param, is Character Forge 2.6.0.
 * The old `1` / `v1` / `cf1` switch is gone with the v1 runtime.
 */
import type { CharacterBackend } from './types';
import { createV2Backend } from './v2';

export function createCharacterBackend(_search?: string): CharacterBackend {
  return createV2Backend();
}
