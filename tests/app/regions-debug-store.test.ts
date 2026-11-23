import { afterEach, describe, expect, test } from 'vitest';
import {
  clearRegionsDebug,
  DEFAULT_REGIONS_DEBUG,
  loadRegionsDebug,
  saveRegionsDebug,
} from '../../src/ui/regions-state';

const g = globalThis as { localStorage?: Storage };
const before = g.localStorage;

function fakeStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
}

afterEach(() => {
  g.localStorage = before;
});

describe('Regions debug panel memory', () => {
  test('remembers panel values and ignores junk', () => {
    g.localStorage = fakeStorage();
    expect(loadRegionsDebug()).toEqual(DEFAULT_REGIONS_DEBUG);
    saveRegionsDebug({ ...DEFAULT_REGIONS_DEBUG, widenAfter: 6, spanFull: 55, revealSeconds: 2 });
    const back = loadRegionsDebug();
    expect(back.widenAfter).toBe(6);
    expect(back.spanFull).toBe(55);
    expect(back.revealSeconds).toBe(2);
    g.localStorage.setItem('tb-regions-debug', JSON.stringify({ widenAfter: 'lots', fog: false }));
    expect(loadRegionsDebug().widenAfter).toBe(DEFAULT_REGIONS_DEBUG.widenAfter);
    expect(loadRegionsDebug().fog).toBe(false);
    clearRegionsDebug();
    expect(loadRegionsDebug()).toEqual(DEFAULT_REGIONS_DEBUG);
  });

  test('works without storage', () => {
    g.localStorage = undefined;
    expect(loadRegionsDebug()).toEqual(DEFAULT_REGIONS_DEBUG);
    expect(() => saveRegionsDebug(DEFAULT_REGIONS_DEBUG)).not.toThrow();
  });
});
