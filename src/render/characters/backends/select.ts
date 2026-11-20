/**
 * `?cf=` picks the character backend.
 * `0` is handled by `forge.ts` and skips the runtime.
 * `1`, `v1`, and `cf1` select the legacy Character Forge 1.2 backend.
 * Anything else, including a missing param, is Character Forge 2 (the default).
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
