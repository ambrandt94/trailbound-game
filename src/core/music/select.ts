import type { MusicTrack } from './catalog';
import type { MusicContext, MusicSceneClass } from './context';
import { MUSIC_RULES, type MusicRules, type TagWant } from './rules';

export function sceneClass(ctx: MusicContext): MusicSceneClass {
  if (ctx.scene === 'title') return 'title';
  if (ctx.minigame) return 'minigame';
  if (ctx.camp || ctx.place === 'camp') return 'camp';
  if (ctx.place !== null && MUSIC_RULES.place[ctx.place]?.some((want) => want.tag === 'town')) {
    return 'town';
  }
  return ctx.scene === 'map' ? 'map' : 'travel';
}

function add(into: Map<string, number>, wants: readonly TagWant[] | undefined): void {
  for (const { tag, weight } of wants ?? []) into.set(tag, Math.max(into.get(tag) ?? 0, weight));
}

/** Tag -> weight the context asks for. */
export function wantedTags(
  ctx: MusicContext,
  rules: MusicRules = MUSIC_RULES,
): Map<string, number> {
  const out = new Map<string, number>();
  if (ctx.scene === 'title') {
    add(out, rules.scene.title);
    return out;
  }
  const cls = sceneClass(ctx);
  // Towns, camps, and minigames are their own place: the road and its biome do not weigh in.
  const travelling = cls === 'map' || cls === 'travel';
  if (travelling) add(out, rules.scene[ctx.scene]);
  if (ctx.minigame) add(out, rules.minigame);
  if (ctx.camp) add(out, rules.camp);
  if (ctx.place) add(out, rules.place[ctx.place]);
  if (travelling) {
    if (ctx.biome !== null) add(out, rules.biome[ctx.biome]);
    add(out, ctx.night ? rules.night : rules.day);
  }
  return out;
}

/** Same key = same musical situation. Used for hysteresis. */
export function contextKey(ctx: MusicContext, rules: MusicRules = MUSIC_RULES): string {
  const tags = [...wantedTags(ctx, rules)].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `${sceneClass(ctx)}|${intensityPreference(ctx, rules).toFixed(2)}|${tags
    .map(([tag, weight]) => `${tag}:${weight}`)
    .join(',')}`;
}

export function intensityPreference(ctx: MusicContext, rules: MusicRules = MUSIC_RULES): number {
  const cls = sceneClass(ctx);
  let pref = rules.intensity.byClass[cls];
  if (cls === 'town' && ctx.place) pref = rules.intensity.byPlace[ctx.place] ?? pref;
  if (ctx.night && cls !== 'title' && cls !== 'minigame') pref += rules.intensity.nightShift;
  return Math.min(1, Math.max(0, pref));
}

export interface ScoredTrack {
  track: MusicTrack;
  score: number;
  /** Tag part of the score (no intensity, no stickiness). */
  tagScore: number;
  matched: string[];
}

function scoreWith(
  tracks: readonly MusicTrack[],
  wants: Map<string, number>,
  ctx: MusicContext,
  rules: MusicRules,
  currentId: string | null,
  travelling: boolean,
): ScoredTrack[] {
  const pref = intensityPreference(ctx, rules);
  return tracks.map((track) => {
    let tagScore = 0;
    const matched: string[] = [];
    for (const tag of track.context) {
      const weight = wants.get(tag);
      if (weight !== undefined) {
        tagScore += weight;
        matched.push(tag);
      } else {
        tagScore -= rules.unwanted[tag] ?? 0;
        if (travelling) tagScore -= rules.wrongTimePenalty[tag] ?? 0;
      }
    }
    const fit = rules.intensity.weight * (1 - Math.abs(pref - track.intensity));
    const stick = currentId === track.id ? rules.stickiness : 0;
    return { track, score: tagScore + fit + stick, tagScore, matched };
  });
}

/** All tracks, best first. Ties break on id so the order is stable. */
export function scoreTracks(
  tracks: readonly MusicTrack[],
  ctx: MusicContext,
  options: { currentId?: string | null; rules?: MusicRules } = {},
): ScoredTrack[] {
  const rules = options.rules ?? MUSIC_RULES;
  const currentId = options.currentId ?? null;
  const cls = sceneClass(ctx);
  const travelling = cls === 'map' || cls === 'travel';
  let scored = scoreWith(tracks, wantedTags(ctx, rules), ctx, rules, currentId, travelling);
  if (!scored.some((entry) => entry.matched.length > 0)) {
    const fallback = new Map<string, number>();
    add(fallback, rules.fallback);
    scored = scoreWith(tracks, fallback, ctx, rules, currentId, travelling);
  }
  return scored.sort((a, b) => b.score - a.score || (a.track.id < b.track.id ? -1 : 1));
}

export interface PickOptions {
  /** The track playing now. It gets the stickiness bonus. */
  currentId?: string | null;
  /** Never return this track while another is in the running (rotation, track ended). */
  avoidId?: string | null;
  /** Track id -> when it last started, any unit. Older starts win ties. */
  lastPlayed?: ReadonlyMap<string, number>;
  rules?: MusicRules;
}

export interface Pick {
  track: MusicTrack;
  /** Tracks within the tie margin of the best, in the order they would play. */
  candidates: ScoredTrack[];
  scored: ScoredTrack[];
}

/**
 * Best track for the context. Tracks within `tieMargin` of the top score are
 * interchangeable; among them the playing track stays unless `avoidId` names it,
 * and otherwise the one played longest ago wins, so a context with several tracks
 * rotates instead of repeating.
 */
export function pickTrack(
  tracks: readonly MusicTrack[],
  ctx: MusicContext,
  options: PickOptions = {},
): Pick | null {
  if (tracks.length === 0) return null;
  const rules = options.rules ?? MUSIC_RULES;
  const scored = scoreTracks(tracks, ctx, { currentId: options.currentId ?? null, rules });
  const best = scored[0];
  if (!best) return null;
  const near = scored.filter((entry) => entry.score >= best.score - rules.tieMargin);
  const avoid = options.avoidId ?? null;
  let pool = near.filter((entry) => entry.track.id !== avoid);
  if (pool.length === 0) pool = near;
  const last = options.lastPlayed;
  const current = options.currentId ?? null;
  const candidates = [...pool].sort((a, b) => {
    // Stay put when the playing track is still in the running.
    const aStay = a.track.id === current ? 0 : 1;
    const bStay = b.track.id === current ? 0 : 1;
    if (aStay !== bStay) return aStay - bStay;
    const aPlayed = last?.get(a.track.id) ?? -Infinity;
    const bPlayed = last?.get(b.track.id) ?? -Infinity;
    if (aPlayed !== bPlayed) return aPlayed - bPlayed;
    return b.score - a.score || (a.track.id < b.track.id ? -1 : 1);
  });
  const first = candidates[0];
  return first ? { track: first.track, candidates, scored } : null;
}
