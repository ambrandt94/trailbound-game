/**
 * `?cf=` picks the character backend.
 * `0` is handled by `forge.ts` and skips the runtime.
 * `1`, `v1`, and `cf1` select Character Forge 1.
 * Anything else, including a missing param, `2`, `v2`, and `cf2`, is v2.
 */
import type { CharacterBackend } from './types';
import { createV1Backend } from './v1';
import { createV2Backend } from './v2';

const V1_QUERY = new Set(['1', 'v1', 'cf1']);

export function createCharacterBackend(search?: string): CharacterBackend {
  const value = new URLSearchParams(search ?? readSearch()).get('cf');
  if (value !== null && V1_QUERY.has(value)) return createV1Backend();
  return createV2Backend();
}

function readSearch(): string {
  try {
    return globalThis.location?.search ?? '';
  } catch {
    return '';
  }
}
