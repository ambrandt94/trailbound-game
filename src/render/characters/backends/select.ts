/**
 * `?cf=` picks the character backend.
 * `0` is handled by `forge.ts` and skips the runtime.
 * `2`, `v2`, and `cf2` are reserved for Character Forge 2. That bundle is not
 * vendored (asset licensing is unresolved), so those values warn and use v1.
 * Anything else, including a missing param, is v1.
 */
import { createV1Backend } from './v1';
import type { CharacterBackend } from './types';

const V2_QUERY = new Set(['2', 'v2', 'cf2']);

export function createCharacterBackend(search?: string): CharacterBackend {
  const value = new URLSearchParams(search ?? readSearch()).get('cf');
  if (value !== null && V2_QUERY.has(value)) {
    console.warn(`Character Forge v2 (?cf=${value}) is not available yet; using the v1 backend.`);
  }
  return createV1Backend();
}

function readSearch(): string {
  try {
    return globalThis.location?.search ?? '';
  } catch {
    return '';
  }
}
