/**
 * Placeholder v1 → v2 race ids until Alex decides the real bodies.
 * One table: the v2 backend passes it to `CF` as `policy.missingRaces`.
 */
export const V1_TO_V2_RACE = {
  elf: 'wood_elf',
  djinn: 'human',
  elder: 'human',
  thug: 'human',
} as const;

const PLACEHOLDER_NOTE = new Set<string>(['djinn', 'elder', 'thug']);

export function v2RaceId(race: string): string {
  return V1_TO_V2_RACE[race as keyof typeof V1_TO_V2_RACE] ?? race;
}

/** djinn, elder, and thug have no v2 body yet. Elf is a rename, not a placeholder. */
export function notePlaceholderRaces(races: Iterable<string>): void {
  const seen = new Set<string>();
  for (const race of races) {
    if (seen.has(race) || !PLACEHOLDER_NOTE.has(race)) continue;
    seen.add(race);
    console.info(`Character Forge v2 has no "${race}" race yet; using ${v2RaceId(race)}.`);
  }
}
