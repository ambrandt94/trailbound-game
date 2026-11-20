/**
 * `?cf=` picks the character backend.
 * `0` is handled by `forge.ts` and skips the runtime.
 * `2`, `v2`, and `cf2` select Character Forge 2. Anything else, including a
 * missing param, is v1.
 */
import type { CharacterBackend } from './types';
import { createV1Backend } from './v1';
import { createV2Backend } from './v2';

const V2_QUERY = new Set(['2', 'v2', 'cf2']);

export function createCharacterBackend(search?: string): CharacterBackend {
  const value = new URLSearchParams(search ?? readSearch()).get('cf');
  if (value !== null && V2_QUERY.has(value)) return createV2Backend();
  return createV1Backend();
}

function readSearch(): string {
  try {
    return globalThis.location?.search ?? '';
  } catch {
    return '';
  }
}
