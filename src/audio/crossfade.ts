/**
 * Equal-power crossfade math, shared by the player and its tests.
 * The incoming gain follows sin and the outgoing gain follows cos over the
 * fade, so in² + out² = 1 at every moment and the loudness stays level.
 */

export interface Fade {
  /** Audio-clock time the fade began, seconds. */
  start: number;
  /** Length in seconds. 0 jumps to `to` at once. */
  dur: number;
  from: number;
  to: number;
}

/** Gain of a fading voice at audio-clock time `now`. */
export function fadeGain(fade: Fade, now: number): number {
  if (fade.dur <= 0) return fade.to;
  const p = Math.min(1, Math.max(0, (now - fade.start) / fade.dur));
  return fade.from * Math.cos((p * Math.PI) / 2) + fade.to * Math.sin((p * Math.PI) / 2);
}

export function fadeDone(fade: Fade, now: number): boolean {
  return now - fade.start >= fade.dur;
}

/** Sample the fade for `AudioParam.setValueCurveAtTime`. */
export function fadeCurve(fade: Fade, points = 128): Float32Array {
  const out = new Float32Array(points);
  for (let i = 0; i < points; i++) {
    out[i] = fadeGain({ ...fade, start: 0 }, (i / (points - 1)) * fade.dur);
  }
  return out;
}
