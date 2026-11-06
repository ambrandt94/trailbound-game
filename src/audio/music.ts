/**
 * Original chiptune loop from the controller. No sample assets.
 * Volume is pushed from the game mix; this module does not write its own save.
 */

const BPM = 112;
const STEP = 60 / BPM / 4;
const BAR = 16;
const BARS = 8;
const LOOK = 0.12;

const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

const CH: Record<string, [number, number[]]> = {
  C: [48, [60, 64, 67, 72]],
  G: [43, [55, 59, 62, 67]],
  Am: [45, [57, 60, 64, 69]],
  F: [41, [53, 57, 60, 65]],
};

const PROG = [
  ['C', 'C'],
  ['G', 'G'],
  ['Am', 'Am'],
  ['F', 'F'],
  ['C', 'C'],
  ['G', 'G'],
  ['F', 'G'],
  ['C', 'C'],
] as const;

const LEAD: Array<Array<[number, number, number]>> = [
  [
    [0, 72, 2],
    [2, 76, 2],
    [4, 79, 4],
    [8, 77, 2],
    [10, 76, 2],
    [12, 74, 4],
  ],
  [
    [0, 74, 2],
    [2, 71, 2],
    [4, 67, 4],
    [8, 71, 2],
    [10, 74, 2],
    [12, 79, 4],
  ],
  [
    [0, 76, 3],
    [3, 74, 1],
    [4, 72, 4],
    [8, 69, 2],
    [10, 72, 2],
    [12, 76, 4],
  ],
  [
    [0, 77, 2],
    [2, 76, 2],
    [4, 74, 2],
    [6, 72, 2],
    [8, 69, 8],
  ],
  [
    [0, 72, 2],
    [2, 76, 2],
    [4, 79, 2],
    [6, 84, 2],
    [8, 83, 2],
    [10, 79, 2],
    [12, 76, 4],
  ],
  [
    [0, 79, 2],
    [2, 78, 1],
    [3, 79, 1],
    [4, 83, 4],
    [8, 81, 2],
    [10, 79, 2],
    [12, 74, 4],
  ],
  [
    [0, 77, 4],
    [4, 81, 4],
    [8, 79, 4],
    [12, 74, 4],
  ],
  [
    [0, 72, 6],
    [8, 76, 2],
    [10, 74, 2],
    [12, 72, 4],
  ],
];

const BASS: Record<number, number> = { 0: 0, 3: 12, 6: 7, 8: 0, 11: 12, 14: 7 };

class Music {
  private context: AudioContext | null = null;
  private bus: GainNode | null = null;
  private filter: BiquadFilterNode | null = null;
  private output: GainNode | null = null;
  private pulse25: PeriodicWave | null = null;
  private pulse12: PeriodicWave | null = null;
  private noise: AudioBuffer | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private on = true;
  private volume = 0.45;
  private muffle = 0;
  private step = 0;
  private next = 0;
  private lastMuffle = -1;
  private listening = false;

  start(): void {
    if (typeof window === 'undefined') return;
    if (!this.listening) {
      this.listening = true;
      const kick = () => this.start();
      window.addEventListener('keydown', kick);
      window.addEventListener('pointerdown', kick);
    }
    if (!this.context) this.init();
    if (!this.context) return;
    if (this.context.state === 'suspended') void this.context.resume();
    if (!this.timer) {
      this.next = this.context.currentTime + 0.1;
      this.timer = setInterval(() => this.tick(), 25);
    }
  }

  setOn(value: boolean): void {
    this.on = value;
    this.apply(false);
  }

  setVolume(value: number): void {
    this.volume = Math.max(0, Math.min(1, value));
    this.apply(false);
  }

  setMuffle(value: number): void {
    const next = Math.max(0, Math.min(1, value));
    if (Math.abs(next - this.lastMuffle) <= 0.01) return;
    this.lastMuffle = next;
    this.muffle = next;
    this.apply(false);
  }

  private init(): void {
    const Ctx = window.AudioContext ?? window.webkitAudioContext;
    if (!Ctx) return;
    const ac = new Ctx();
    this.context = ac;
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
    this.pulse25 = this.pulseWave(0.25);
    this.pulse12 = this.pulseWave(0.125);
    const len = Math.floor(ac.sampleRate * 0.5);
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.noise = buf;
    this.apply(true);
  }

  private pulseWave(duty: number): PeriodicWave {
    const ac = this.context;
    if (!ac) throw new Error('audio');
    const n = 32;
    const re = new Float32Array(n);
    const im = new Float32Array(n);
    for (let k = 1; k < n; k++) im[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * duty);
    return ac.createPeriodicWave(re, im);
  }

  private tone(
    t: number,
    freq: number,
    dur: number,
    gain: number,
    wave: PeriodicWave | 'triangle',
  ): void {
    const ac = this.context;
    const bus = this.bus;
    if (!ac || !bus) return;
    const osc = ac.createOscillator();
    const amp = ac.createGain();
    if (wave === 'triangle') osc.type = 'triangle';
    else osc.setPeriodicWave(wave);
    osc.frequency.value = freq;
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(gain, t + 0.005);
    amp.gain.setValueAtTime(gain, t + Math.max(0.01, dur - 0.04));
    amp.gain.linearRampToValueAtTime(0, t + dur);
    osc.connect(amp);
    amp.connect(bus);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private hit(t: number, kind: 'kick' | 'snare' | 'hat'): void {
    const ac = this.context;
    const bus = this.bus;
    if (!ac || !bus) return;
    if (kind === 'kick') {
      const osc = ac.createOscillator();
      const amp = ac.createGain();
      osc.frequency.setValueAtTime(150, t);
      osc.frequency.exponentialRampToValueAtTime(45, t + 0.12);
      amp.gain.setValueAtTime(0.32, t);
      amp.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
      osc.connect(amp);
      amp.connect(bus);
      osc.start(t);
      osc.stop(t + 0.16);
      return;
    }
    if (!this.noise) return;
    const src = ac.createBufferSource();
    const filter = ac.createBiquadFilter();
    const amp = ac.createGain();
    src.buffer = this.noise;
    filter.type = 'highpass';
    filter.frequency.value = kind === 'hat' ? 7000 : 1800;
    const d = kind === 'hat' ? 0.04 : 0.12;
    const v = kind === 'hat' ? 0.05 : 0.11;
    amp.gain.setValueAtTime(v, t);
    amp.gain.exponentialRampToValueAtTime(0.001, t + d);
    src.connect(filter);
    filter.connect(amp);
    amp.connect(bus);
    src.start(t);
    src.stop(t + d + 0.01);
  }

  private schedule(t: number, s: number): void {
    const bar = Math.floor(s / BAR) % BARS;
    const st = s % BAR;
    const half = st < 8 ? 0 : 1;
    const chordName = PROG[bar]?.[half] ?? 'C';
    const chord = CH[chordName];
    if (!chord) return;
    const [root, tones] = chord;
    const lead = LEAD[bar] ?? [];
    for (const note of lead) {
      const [ns, midi, len] = note;
      if (ns === st && this.pulse25)
        this.tone(t, mtof(midi), len * STEP * 0.95, 0.07, this.pulse25);
    }
    if (st in BASS) this.tone(t, mtof(root + (BASS[st] ?? 0)), STEP * 1.8, 0.16, 'triangle');
    const toneMidi = tones[st % 4];
    if (toneMidi != null && this.pulse12)
      this.tone(t, mtof(toneMidi + 12), STEP * 0.6, 0.022, this.pulse12);
    if (st === 0 || st === 8 || st === 10) this.hit(t, 'kick');
    if (st === 4 || st === 12) this.hit(t, 'snare');
    if (st % 4 === 2) this.hit(t, 'hat');
  }

  private tick(): void {
    const ac = this.context;
    if (!ac) return;
    while (this.next < ac.currentTime + LOOK) {
      this.schedule(this.next, this.step);
      this.step += 1;
      this.next += STEP;
    }
  }

  private apply(now: boolean): void {
    const ac = this.context;
    const filter = this.filter;
    const output = this.output;
    if (!ac || !filter || !output) return;
    const t = ac.currentTime;
    const tc = now ? 0.001 : 0.35;
    filter.frequency.setTargetAtTime(18000 * Math.pow(500 / 18000, this.muffle), t, tc);
    filter.Q.setTargetAtTime(0.7 + this.muffle * 2.5, t, tc);
    output.gain.setTargetAtTime(
      this.on ? this.volume * 0.9 * (1 - 0.45 * this.muffle) : 0,
      t,
      now ? 0.001 : 0.2,
    );
  }
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}

export const music = new Music();
