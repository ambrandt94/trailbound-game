const CELL_COLORS = ['#cfe0b0', '#b7d092', '#d9d4a8', '#a9cbb4', '#e3d2a4', '#c3d59a'] as const;
const FALLBACK_CELL = '#cfe0b0';

/** Deterministic cell tint so the placeholder map is a seeded grid, not a flat fill. */
export function mix(seed: number, x: number, y: number): number {
  let n = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + (seed | 0);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return (n ^ (n >>> 16)) >>> 0;
}

export function cellColor(x: number, y: number, seed: number): string {
  const index = mix(seed, x, y) % CELL_COLORS.length;
  return CELL_COLORS[index] ?? FALLBACK_CELL;
}
