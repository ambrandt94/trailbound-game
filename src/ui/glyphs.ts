/**
 * Softball Gold's cmap has no ellipsis, middle dot, multiply, or divide.
 * Map those to glyphs the face actually draws so menu labels do not tofu.
 * This is display-only. Stored settings and save text stay as written.
 */
const REPLACEMENTS: readonly (readonly [string, string])[] = [
  ['\u2026', '...'],
  ['\u00B7', '|'],
  ['\u00D7', 'x'],
  ['\u00F7', '/'],
  ['\u2014', '-'],
  ['\u2013', '-'],
  ['\u2713', '+'],
];

export function skinText(value: string): string {
  let next = value;
  for (const [from, to] of REPLACEMENTS) next = next.replaceAll(from, to);
  return next;
}
