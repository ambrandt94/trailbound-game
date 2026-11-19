import { parseMusicManifest, type MusicTrack } from '../core/music/catalog';
import { DEFAULT_MUSIC_CONTEXT, type MusicContext } from '../core/music/context';
import { MusicDirector, type MusicDecision } from '../core/music/director';
import { MUSIC_RULES, type MusicRules } from '../core/music/rules';
import { contextKey, sceneClass } from '../core/music/select';
import { music as chiptune } from '../audio/music';
import { MusicPlayer } from '../audio/music-player';

export interface MusicSource {
  /** Current context, or null while booting. Called a few times a second. */
  context(): MusicContext | null;
  /** Indoors: low-pass the music. */
  indoors(): boolean;
  /** 0..1 music volume with the master level folded in. */
  volume(): number;
}

export interface MusicLogEntry {
  at: number;
  event: 'decision' | 'unlock' | 'manifest';
  detail: string;
}

/** How often the context is read. The director's holds are seconds, so 4 Hz is plenty. */
const POLL_SEC = 0.25;

/**
 * Wires the game to the soundtrack: reads the context, asks the director
 * when to change, and tells the player to crossfade. Also owns the debug hook.
 */
export class MusicConductor {
  private director: MusicDirector | null = null;
  private player: MusicPlayer | null = null;
  private catalog: readonly MusicTrack[] = [];
  private problems: string[] = [];
  private lastPoll = -Infinity;
  private forced: MusicContext | null = null;
  private current: MusicContext | null = null;
  private fallback = false;
  private clock: () => number = () => performance.now() / 1000;
  private readonly log: MusicLogEntry[] = [];

  constructor(
    private readonly source: MusicSource,
    private readonly baseUrl: string,
    private readonly rules: MusicRules = MUSIC_RULES,
  ) {}

  /** Fetch the manifest. A failure falls back to the old chiptune loop instead of silence. */
  async load(fetchImpl: typeof fetch = globalThis.fetch): Promise<void> {
    const dir = `${this.baseUrl}assets/audio/music/`;
    try {
      const response = await fetchImpl(`${dir}manifest.json`);
      if (!response.ok) throw new Error(`manifest ${response.status}`);
      const { catalog, problems } = parseMusicManifest(await response.json());
      this.problems = problems;
      this.catalog = catalog.tracks;
    } catch (error) {
      this.problems = [error instanceof Error ? error.message : String(error)];
      this.catalog = [];
    }
    this.record('manifest', `${this.catalog.length} tracks, ${this.problems.length} problems`);
    if (this.catalog.length === 0) {
      this.fallback = true;
      chiptune.start();
      return;
    }
    this.director = new MusicDirector(this.catalog, { rules: this.rules });
    this.player = new MusicPlayer({
      base: dir,
      fadeInSec: this.rules.timing.fadeInSec,
      onEnded: () => this.director?.trackEnded(),
    });
    this.player.listen();
  }

  /** Call every frame with the real time passing since the last call. */
  tick(): void {
    const now = this.clock();
    if (now - this.lastPoll < POLL_SEC) {
      this.player?.tick();
      return;
    }
    this.lastPoll = now;
    const volume = this.source.volume();
    if (this.fallback) {
      chiptune.setVolume(volume);
      chiptune.setMuffle(this.source.indoors() ? 1 : 0);
      return;
    }
    const player = this.player;
    const director = this.director;
    if (!player || !director) return;
    player.setVolume(volume);
    player.setMuffle(this.source.indoors() ? 1 : 0);
    player.tick();
    const ctx = this.forced ?? this.source.context();
    if (!ctx) return;
    this.current = ctx;
    const decision = director.update(ctx, now);
    if (decision) this.apply(decision, now);
  }

  private apply(decision: MusicDecision, now: number): void {
    this.player?.play(decision.track, decision.fadeSec);
    this.record(
      'decision',
      `${decision.reason} -> ${decision.track.id} fade ${decision.fadeSec}s [${decision.key}]`,
      now,
    );
  }

  private record(event: MusicLogEntry['event'], detail: string, at = this.clock()): void {
    this.log.push({ at, event, detail });
    if (this.log.length > 200) this.log.shift();
  }

  /** `__tbMusic`, for tests and tuning. */
  debug() {
    return {
      get: () => ({
        track: this.director?.playing?.id ?? null,
        context: this.current,
        forced: this.forced !== null,
        sceneClass: this.current ? sceneClass(this.current) : null,
        key: this.current ? contextKey(this.current, this.rules) : null,
        candidates: this.director?.candidates ?? [],
        pending: this.director?.pending ?? null,
        unlocked: this.player?.unlocked ?? false,
        fallbackChiptune: this.fallback,
        levels: this.player?.levels() ?? [],
        outputLevel: this.player?.outputLevel ?? 0,
        audioTime: this.player?.audioTime ?? null,
        problems: this.problems,
      }),
      /** Pin the context (merged over a default one). `force(null)` hands control back to the game. */
      force: (patch: Partial<MusicContext> | null) => {
        this.forced = patch ? { ...DEFAULT_MUSIC_CONTEXT, ...patch } : null;
        this.lastPoll = -Infinity;
      },
      /** Skip the holds and switch to whatever fits now. */
      settle: () => {
        const ctx = this.forced ?? this.source.context();
        const now = this.clock();
        const decision = ctx ? this.director?.settle(ctx, now) : null;
        if (decision) this.apply(decision, now);
        return decision?.track.id ?? null;
      },
      setTiming: (timing: Partial<MusicRules['timing']>) => this.director?.setTiming(timing),
      log: () => [...this.log],
      /** Replace the clock (seconds) so a test can run the holds without waiting. */
      useClock: (clock: (() => number) | null) => {
        this.clock = clock ?? (() => performance.now() / 1000);
      },
      unlock: () => this.player?.unlock(),
      setOn: (on: boolean) => this.player?.setOn(on),
    };
  }
}
