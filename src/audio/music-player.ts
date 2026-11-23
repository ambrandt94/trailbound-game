/**
 * Streams the soundtrack OGGs and crossfades between them.
 *
 * Each playing track is an HTMLAudioElement (streamed, so a 340 s track does
 * not become half a gigabyte of decoded PCM) routed through its own GainNode
 * into one bus: voices -> lowpass (indoor muffle) -> output (volume) -> speakers.
 * Nothing is created before `unlock()`, which the first user gesture calls, so
 * the browser's autoplay rules are never fought. A track asked for before then
 * is kept and fades in once the context is running.
 */
import type { MusicTrack } from '../core/music/catalog';
import { fadeCurve, fadeDone, fadeGain, type Fade } from './crossfade';

interface Voice {
  track: MusicTrack;
  el: HTMLAudioElement;
  node: MediaElementAudioSourceNode;
  gain: GainNode;
  fade: Fade;
}

export interface PlayerLevel {
  id: string;
  /** Model gain from the fade curve. */
  gain: number;
  /** What the GainNode itself reports. */
  node: number;
  fading: boolean;
}

export interface MusicPlayerOptions {
  /** URL prefix the manifest's file names hang off, with a trailing slash. */
  base: string;
  /** A non-looping track reached its end. */
  onEnded?: (track: MusicTrack) => void;
  /** Seconds to fade in from silence, e.g. the first track after unlock. */
  fadeInSec?: number;
}

export class MusicPlayer {
  private ac: AudioContext | null = null;
  private bus: GainNode | null = null;
  private filter: BiquadFilterNode | null = null;
  private output: GainNode | null = null;
  private readonly voices: Voice[] = [];
  private wanted: { track: MusicTrack; fadeSec: number; resume?: boolean } | null = null;
  private listening = false;
  private volume = 0.45;
  private on = true;
  private muffle = 0;
  private lastMuffle = -1;
  private readonly fadeInSec: number;
  /** Where each released track stopped (seconds into the file), to pick it up again. */
  private readonly stoppedAt = new Map<string, number>();

  constructor(private readonly options: MusicPlayerOptions) {
    this.fadeInSec = options.fadeInSec ?? 1.5;
  }

  get unlocked(): boolean {
    return this.ac !== null && this.ac.state === 'running';
  }

  /** Track that is audible or fading in, newest first. */
  get currentId(): string | null {
    const newest = this.voices[this.voices.length - 1];
    return newest?.track.id ?? this.wanted?.track.id ?? null;
  }

  /**
   * Call from a user gesture. Creates the context on first use and resumes it
   * after the browser suspends it. Safe to call on every gesture.
   */
  unlock(): void {
    if (typeof window === 'undefined') return;
    if (!this.ac) {
      const Ctx = window.AudioContext ?? window.webkitAudioContext;
      if (!Ctx) return;
      this.init(new Ctx());
    }
    const ac = this.ac;
    if (!ac) return;
    const begin = () => {
      this.startWanted();
      // A voice the browser paused while it was suspended starts again.
      for (const voice of this.voices) if (voice.el.paused) void this.playEl(voice);
    };
    if (ac.state === 'running') begin();
    else void ac.resume().then(begin, () => undefined);
  }

  /** Hook the first-gesture unlock to the window. Idempotent. */
  listen(target: Window = window): void {
    if (this.listening) return;
    this.listening = true;
    const kick = () => this.unlock();
    for (const type of ['pointerdown', 'keydown', 'touchend'] as const) {
      target.addEventListener(type, kick, { passive: true });
    }
  }

  /**
   * Crossfade to `track` over `fadeSec` (the first track fades in over the default fade-in).
   * With `resume`, the track starts where it last stopped (or keeps going if it is still fading out).
   */
  play(track: MusicTrack, fadeSec: number, resume = false): void {
    if (this.voices.some((voice) => voice.track.id === track.id && voice.fade.to === 1)) return;
    if (resume && this.ac) {
      // Still fading out: turn it back up instead of starting it over.
      const fading = this.voices.find((voice) => voice.track.id === track.id);
      if (fading) {
        for (const voice of this.voices) if (voice !== fading) this.ramp(voice, 0, fadeSec);
        this.ramp(fading, 1, fadeSec);
        this.voices.splice(this.voices.indexOf(fading), 1);
        this.voices.push(fading);
        this.wanted = null;
        return;
      }
    }
    this.wanted = { track, fadeSec, resume };
    if (this.unlocked) this.startWanted();
  }

  /** Fade everything out. */
  stop(fadeSec: number): void {
    this.wanted = null;
    const ac = this.ac;
    if (!ac) return;
    for (const voice of this.voices) this.ramp(voice, 0, fadeSec);
  }

  setOn(value: boolean): void {
    this.on = value;
    this.apply();
  }

  setVolume(value: number): void {
    this.volume = Math.max(0, Math.min(1, value));
    this.apply();
  }

  /** 0 = open, 1 = indoors (low-passed and quieter), like the old chiptune. */
  setMuffle(value: number): void {
    const next = Math.max(0, Math.min(1, value));
    if (Math.abs(next - this.lastMuffle) <= 0.01) return;
    this.lastMuffle = next;
    this.muffle = next;
    this.apply();
  }

  /** Call every update: frees voices whose fade-out is over, and re-arms stalled ones. */
  tick(): void {
    const ac = this.ac;
    if (!ac) return;
    const now = ac.currentTime;
    for (let i = this.voices.length - 1; i >= 0; i--) {
      const voice = this.voices[i];
      if (!voice) continue;
      if (voice.fade.to === 0 && fadeDone(voice.fade, now)) this.release(i);
    }
  }

  levels(): PlayerLevel[] {
    const ac = this.ac;
    if (!ac) return [];
    return this.voices.map((voice) => ({
      id: voice.track.id,
      gain: fadeGain(voice.fade, ac.currentTime),
      node: voice.gain.gain.value,
      fading: !fadeDone(voice.fade, ac.currentTime),
    }));
  }

  /** Master level the player applies right now (after volume, mute, muffle). */
  get outputLevel(): number {
    return this.on ? this.volume * 0.9 * (1 - 0.45 * this.muffle) : 0;
  }

  get audioTime(): number | null {
    return this.ac?.currentTime ?? null;
  }

  private init(ac: AudioContext): void {
    this.ac = ac;
    const bus = ac.createGain();
    const filter = ac.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 0.7;
    const output = ac.createGain();
    bus.connect(filter);
    filter.connect(output);
    output.connect(ac.destination);
    this.bus = bus;
    this.filter = filter;
    this.output = output;
    this.apply(true);
  }

  private startWanted(): void {
    const want = this.wanted;
    const ac = this.ac;
    if (!want || !ac || ac.state !== 'running') return;
    this.wanted = null;
    const hasVoice = this.voices.some((voice) => voice.fade.to === 1);
    const fadeSec = hasVoice ? want.fadeSec : Math.max(want.fadeSec, this.fadeInSec);
    for (const voice of this.voices) this.ramp(voice, 0, fadeSec);
    const voice = this.spawn(want.track);
    if (!voice) return;
    const at = want.resume ? this.stoppedAt.get(want.track.id) : undefined;
    if (at !== undefined && at > 0) seek(voice.el, at);
    voice.fade = { start: ac.currentTime, dur: fadeSec, from: 0, to: 1 };
    this.schedule(voice);
    void this.playEl(voice);
  }

  private spawn(track: MusicTrack): Voice | null {
    const ac = this.ac;
    const bus = this.bus;
    if (!ac || !bus) return null;
    const el = new Audio(`${this.options.base}${track.file}`);
    el.loop = track.loop;
    el.preload = 'auto';
    const node = ac.createMediaElementSource(el);
    const gain = ac.createGain();
    gain.gain.value = 0;
    node.connect(gain);
    gain.connect(bus);
    const voice: Voice = {
      track,
      el,
      node,
      gain,
      fade: { start: ac.currentTime, dur: 0, from: 0, to: 0 },
    };
    el.addEventListener('ended', () => {
      if (!track.loop) this.options.onEnded?.(track);
    });
    this.voices.push(voice);
    return voice;
  }

  private async playEl(voice: Voice): Promise<void> {
    try {
      await voice.el.play();
    } catch {
      // Blocked or interrupted: the next gesture calls unlock() and retries.
    }
  }

  /** Re-aim a voice at `to` from wherever its gain is now. */
  private ramp(voice: Voice, to: number, sec: number): void {
    const ac = this.ac;
    if (!ac) return;
    const now = ac.currentTime;
    voice.fade = { start: now, dur: sec, from: fadeGain(voice.fade, now), to };
    this.schedule(voice);
  }

  private schedule(voice: Voice): void {
    const ac = this.ac;
    if (!ac) return;
    const { fade } = voice;
    const param = voice.gain.gain;
    param.cancelScheduledValues(fade.start);
    param.setValueAtTime(fade.from, fade.start);
    if (fade.dur <= 0) param.setValueAtTime(fade.to, fade.start);
    else param.setValueCurveAtTime(fadeCurve(fade), fade.start, fade.dur);
  }

  private release(index: number): void {
    const [voice] = this.voices.splice(index, 1);
    if (!voice) return;
    if (Number.isFinite(voice.el.currentTime))
      this.stoppedAt.set(voice.track.id, voice.el.currentTime);
    voice.el.pause();
    voice.el.removeAttribute('src');
    voice.el.load();
    voice.node.disconnect();
    voice.gain.disconnect();
  }

  private apply(now = false): void {
    const ac = this.ac;
    const filter = this.filter;
    const output = this.output;
    if (!ac || !filter || !output) return;
    const t = ac.currentTime;
    const tc = now ? 0.001 : 0.35;
    filter.frequency.setTargetAtTime(18000 * Math.pow(500 / 18000, this.muffle), t, tc);
    filter.Q.setTargetAtTime(0.7 + this.muffle * 2.5, t, tc);
    output.gain.setTargetAtTime(this.outputLevel, t, now ? 0.001 : 0.2);
  }
}

/** Jump to `sec` once the element knows its duration (setting it earlier is ignored by some browsers). */
function seek(el: HTMLAudioElement, sec: number): void {
  const go = () => {
    const end = Number.isFinite(el.duration) ? el.duration : Infinity;
    if (sec < end - 0.25) el.currentTime = sec;
  };
  if (el.readyState >= 1) go();
  else el.addEventListener('loadedmetadata', go, { once: true });
}
