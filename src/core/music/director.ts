import type { MusicTrack } from './catalog';
import type { MusicContext, MusicSceneClass } from './context';
import { MUSIC_RULES, type MusicRules } from './rules';
import { contextKey, pickTrack, sceneClass, type Pick } from './select';

export interface MusicDecision {
  track: MusicTrack;
  /** Crossfade length for this change; 0 means start without a fade-out (first track). */
  fadeSec: number;
  reason: 'first' | 'context' | 'class' | 'rotate' | 'ended';
  key: string;
}

export interface DirectorOptions {
  rules?: MusicRules;
  /** Overrides for rules.timing, e.g. a configurable crossfade length. */
  timing?: Partial<MusicRules['timing']>;
}

/**
 * Decides when the soundtrack changes. Pure: the caller feeds it the context
 * and a clock in seconds, and acts on the decision it returns. No audio here.
 *
 * - A new context must hold `holdSec` (a scene-class change, `classHoldSec`)
 *   before the music follows, so biome flicker never switches tracks.
 * - A track plays at least `minTrackSec` unless the scene class changed.
 * - A context with alternates rotates after a while and never repeats the
 *   playing track while another fits as well.
 */
export class MusicDirector {
  private readonly rules: MusicRules;
  private readonly timing: MusicRules['timing'];
  private current: MusicTrack | null = null;
  private trackStart = 0;
  private trackClass: MusicSceneClass | null = null;
  private committedKey: string | null = null;
  private pendingKey: string | null = null;
  private pendingSince = 0;
  private avoidId: string | null = null;
  private readonly lastPlayed = new Map<string, number>();
  private lastPick: Pick | null = null;
  private lastCtx: MusicContext | null = null;

  constructor(
    private tracks: readonly MusicTrack[],
    options: DirectorOptions = {},
  ) {
    this.rules = options.rules ?? MUSIC_RULES;
    this.timing = { ...this.rules.timing, ...options.timing };
  }

  setTracks(tracks: readonly MusicTrack[]): void {
    this.tracks = tracks;
  }

  setTiming(timing: Partial<MusicRules['timing']>): void {
    Object.assign(this.timing, timing);
  }

  get playing(): MusicTrack | null {
    return this.current;
  }

  /** The tracks that fit the last context, best first (for the debug hook). */
  get candidates(): readonly { id: string; score: number; matched: string[] }[] {
    return (this.lastPick?.scored ?? []).map((entry) => ({
      id: entry.track.id,
      score: Math.round(entry.score * 100) / 100,
      matched: entry.matched,
    }));
  }

  get pending(): { key: string; since: number } | null {
    return this.pendingKey === null ? null : { key: this.pendingKey, since: this.pendingSince };
  }

  /** A non-looping track ran out: choose another at the next update. */
  trackEnded(): void {
    this.avoidId = this.current?.id ?? null;
    this.current = null;
    this.committedKey = null;
    this.pendingKey = null;
  }

  update(ctx: MusicContext, now: number, force = false): MusicDecision | null {
    this.lastCtx = ctx;
    const key = contextKey(ctx, this.rules);
    const cls = sceneClass(ctx);
    const current = this.current;
    if (!current) {
      const reason = this.avoidId ? 'ended' : 'first';
      const pick = this.choose(ctx, null, this.avoidId);
      if (!pick) return null;
      this.avoidId = null;
      return this.start(
        pick.track,
        now,
        cls,
        key,
        reason === 'first' ? 0 : this.timing.crossfadeSec,
        reason,
      );
    }
    if (key === this.committedKey) {
      this.pendingKey = null;
      return this.maybeRotate(ctx, current, now, cls, key);
    }
    if (this.pendingKey !== key) {
      this.pendingKey = key;
      this.pendingSince = now;
    }
    const classChange = cls !== this.trackClass;
    const hold = classChange ? this.timing.classHoldSec : this.timing.holdSec;
    if (!force && now - this.pendingSince < hold) return null;
    const pick = this.choose(ctx, current.id, null);
    if (!pick) return null;
    if (pick.track.id === current.id) {
      // The playing track still fits the new context best: stay, and take the new context as the baseline.
      this.committedKey = key;
      this.trackClass = cls;
      this.pendingKey = null;
      return null;
    }
    if (!force && !classChange && now - this.trackStart < this.timing.minTrackSec) return null;
    return this.start(
      pick.track,
      now,
      cls,
      key,
      this.timing.crossfadeSec,
      classChange ? 'class' : 'context',
    );
  }

  /** Switch to whatever fits now, skipping the holds (debug and tests). */
  settle(ctx: MusicContext, now: number): MusicDecision | null {
    return this.update(ctx, now, true);
  }

  private maybeRotate(
    ctx: MusicContext,
    current: MusicTrack,
    now: number,
    cls: MusicSceneClass,
    key: string,
  ): MusicDecision | null {
    const after = Math.max(this.timing.rotateMinSec, current.durationSec * 2);
    if (now - this.trackStart < after) return null;
    const pick = this.choose(ctx, null, current.id);
    if (!pick || pick.track.id === current.id) return null;
    // Only a real alternate: it has to be inside the tie margin, which `choose` guarantees.
    return this.start(pick.track, now, cls, key, this.timing.crossfadeSec, 'rotate');
  }

  private choose(ctx: MusicContext, currentId: string | null, avoidId: string | null): Pick | null {
    const pick = pickTrack(this.tracks, ctx, {
      currentId,
      avoidId,
      lastPlayed: this.lastPlayed,
      rules: this.rules,
    });
    this.lastPick = pick;
    return pick;
  }

  private start(
    track: MusicTrack,
    now: number,
    cls: MusicSceneClass,
    key: string,
    fadeSec: number,
    reason: MusicDecision['reason'],
  ): MusicDecision {
    this.current = track;
    this.trackStart = now;
    this.trackClass = cls;
    this.committedKey = key;
    this.pendingKey = null;
    this.lastPlayed.set(track.id, now);
    return { track, fadeSec, reason, key };
  }

  /** Last context seen (debug). */
  get context(): MusicContext | null {
    return this.lastCtx;
  }
}
