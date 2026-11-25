/**
 * Regions view, 2D layer over the shader: Alex's cloud rims (nine-slice strips
 * and corners around cleared holes), drifting puffs with their shadows,
 * rumour clearings' puff rings, markers, the journey, and the poof / reveal
 * animations. Pixel art is drawn with smoothing off at a whole-number scale.
 */
import {
  chunkToSphere,
  sphereToChunk,
  regionsProject,
  type ChunkAddr,
  type FrameAxes,
  type RegionsFrame,
  type Rumor,
  type Vec3,
} from '../../core/planet';
import type { AtlasRect, CloudAtlas } from './cloud-atlas';

export interface OverlayInput {
  frame: RegionsFrame;
  axes: FrameAxes;
  n: number;
  w: number;
  h: number;
  atlas: CloudAtlas | null;
  /** Cloud art pixel scale. */
  pixel: number;
  time: number;
  fog: boolean;
  clouds: boolean;
  drift: number;
  density: number;
  /** 0 known, 1 glimpsed, 2 unknown (fog cover). */
  levelOf: (addr: ChunkAddr) => 0 | 1 | 2;
  /**
   * Which of a chunk's 8 neighbours are open (not under cloud), as bits:
   * bit `(dy + 1) * 3 + (dx + 1)` in the chunk's own frame. Cached by the caller.
   */
  openAround: (addr: ChunkAddr) => number;
  /** Chunks worth drawing around (on screen). */
  visible: readonly ChunkAddr[];
  known: readonly ChunkAddr[];
  rumors: readonly Rumor[];
  selected: number | null;
  player: Vec3 | null;
  path: readonly Vec3[];
  truth: boolean;
  /** Dashed line player → rumour (direction known), while flying or selected. */
  directionTo: Vec3 | null;
  /** The poof view: only this rumour shows. */
  isolate: number | null;
  /** Screen-centre poof, 0..1 progress (null = none). */
  poof: number | null;
  /** Arrive reveal: rumour id and 0..1 progress. */
  arrive: { id: number; t: number } | null;
  clearing: (r: Rumor) => number;
  uncertainty: (r: Rumor) => number;
}

const ICONS: Record<string, { rows: string[]; pal: Record<string, string> }> = {
  pyramid: {
    rows: [
      '.....a.....',
      '....aab....',
      '...aaabb...',
      '...aaabb...',
      '..aaaabbb..',
      '..aaaabbb..',
      '.aaaaabbbb.',
      '.aaaaabbbb.',
      'cccccdddddc',
    ],
    pal: { a: '#f2c94c', b: '#c08a2a', c: '#8a6a3a', d: '#6e5230' },
  },
  jars: {
    rows: [
      '...........',
      '.......aa..',
      '..bb..abba.',
      '.bccb.abba.',
      '.bccbcabba.',
      'ddbbdcddaad',
      'ddddddddddd',
    ],
    pal: { a: '#b77a3e', b: '#9a5a2e', c: '#f2d36b', d: '#8d8a80' },
  },
  tower: {
    rows: [
      '...a.a.a...',
      '...aaaaa...',
      '....bbb....',
      '....bcb....',
      '....bbb....',
      '....bbb....',
      '...bbbbb...',
      '..ddddddd..',
    ],
    pal: { a: '#8d7fc7', b: '#b5aed6', c: '#ffe08a', d: '#6b6480' },
  },
  ruin: {
    rows: [
      '...........',
      '....a......',
      '....aa.a...',
      '....bba....',
      '....bbb....',
      '...bb.b....',
      '..ddddddd..',
    ],
    pal: { a: '#8a8478', b: '#a39d90', d: '#6b665c' },
  },
  'lake-town': {
    rows: [
      '...a...a...',
      '..aaa.aaa..',
      '..bbb.bbb..',
      '.ccccccccc.',
      'ccddcccddcc',
      '.ccccccccc.',
    ],
    pal: { a: '#b0482c', b: '#efe0c0', c: '#4f8fc4', d: '#8cc4e8' },
  },
  cave: {
    rows: [
      '....aaa....',
      '..aaaaaaa..',
      '.aaabbbaaa.',
      '.aabbbbbaa.',
      'aaabbbbbaaa',
      'cccccccccc.',
    ],
    pal: { a: '#7d746a', b: '#1e1a20', c: '#5e574f' },
  },
  shrine: {
    rows: [
      '....aaa....',
      '...aaaaa...',
      '....b.b....',
      '....b.b....',
      '...ccccc...',
      '..ddddddd..',
    ],
    pal: { a: '#c0563a', b: '#e8d4a8', c: '#b5aea0', d: '#77705f' },
  },
  wagon: {
    rows: ['..aaaaaa...', '.aaaaaaaa..', '.abbbbbbab.', '.bbbbbbbbb.', '..c....c...'],
    pal: { a: '#f4ecd8', b: '#8b5a2b', c: '#2b2118' },
  },
};

function drawIcon(
  ctx: CanvasRenderingContext2D,
  id: string,
  x: number,
  y: number,
  px: number,
  opts: { alpha?: number; grey?: boolean; outline?: string } = {},
): void {
  const icon = ICONS[id] ?? ICONS.ruin!;
  const h = icon.rows.length;
  const w = icon.rows[0]!.length;
  const ox = Math.round(x - (w * px) / 2);
  const oy = Math.round(y - h * px);
  ctx.save();
  ctx.globalAlpha = opts.alpha ?? 1;
  if (opts.outline) {
    ctx.fillStyle = opts.outline;
    for (let j = 0; j < h; j++) {
      const row = icon.rows[j]!;
      for (let i = 0; i < w; i++) {
        if (row[i] === '.') continue;
        ctx.fillRect(ox + i * px - px, oy + j * px - px, px * 3, px * 3);
      }
    }
  }
  for (let j = 0; j < h; j++) {
    const row = icon.rows[j]!;
    for (let i = 0; i < w; i++) {
      const ch = row[i]!;
      if (ch === '.') continue;
      let c = icon.pal[ch] ?? '#fff';
      if (opts.grey) c = greyOf(c);
      ctx.fillStyle = c;
      ctx.fillRect(ox + i * px, oy + j * px, px, px);
    }
  }
  ctx.restore();
}

function greyOf(hex: string): string {
  const v = parseInt(hex.slice(1), 16);
  const r = (v >> 16) & 255;
  const g = (v >> 8) & 255;
  const b = v & 255;
  const l = Math.round(r * 0.3 + g * 0.59 + b * 0.11);
  return `rgb(${Math.round(l * 0.92 + 14)},${Math.round(l * 0.9 + 10)},${Math.round(l + 24)})`;
}

function hash2(a: number, b: number): number {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** A rumour's believed look, for the codex card and tests. */
export function iconIds(): string[] {
  return Object.keys(ICONS);
}

export class RegionsOverlay {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private w = 0;
  private h = 0;
  /** Stamps drawn last frame (perf readout). */
  stamps = 0;

  constructor(host: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'wg-regions-overlay';
    host.append(this.canvas);
    this.ctx = this.canvas.getContext('2d');
  }

  dispose(): void {
    this.canvas.remove();
  }

  draw(o: OverlayInput): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const w = Math.max(1, Math.round(o.w));
    const h = Math.max(1, Math.round(o.h));
    if (w !== this.w || h !== this.h) {
      this.w = w;
      this.h = h;
      this.canvas.width = w;
      this.canvas.height = h;
      this.canvas.style.width = `${w}px`;
      this.canvas.style.height = `${h}px`;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.imageSmoothingEnabled = false;
    this.stamps = 0;
    const proj = (p: Vec3) => {
      const s = regionsProject(o.frame, p, o.axes);
      return s ? { x: s.x + w / 2, y: s.y + h / 2 } : null;
    };
    const isolated = o.isolate !== null;
    if (o.fog && o.clouds && o.atlas && !isolated) {
      this.drawPuffs(ctx, o, proj);
      this.drawRims(ctx, o, proj);
    }
    if (o.fog && o.clouds && o.atlas) this.drawRumorRings(ctx, o, proj);
    if (!isolated) this.drawPath(ctx, o, proj);
    if (o.directionTo && o.player) this.drawDirection(ctx, o, o.player, o.directionTo, proj);
    this.drawRumors(ctx, o, proj);
    if (o.player && !isolated) {
      const s = proj(o.player);
      if (s) drawIcon(ctx, 'wagon', s.x, s.y + 4, 3, { outline: 'rgba(30,20,12,0.85)' });
    }
    if (o.arrive) this.drawArrive(ctx, o, proj);
    if (o.poof !== null && o.atlas) this.drawPoof(ctx, o);
  }

  private sprite(
    ctx: CanvasRenderingContext2D,
    atlas: CloudAtlas,
    r: AtlasRect,
    x: number,
    y: number,
    scale: number,
  ): void {
    ctx.drawImage(
      atlas.image,
      r.x,
      r.y,
      r.w,
      r.h,
      Math.round(x),
      Math.round(y),
      r.w * scale,
      r.h * scale,
    );
    this.stamps++;
  }

  /** Drifting puffs and their shadows over what is known. */
  private drawPuffs(
    ctx: CanvasRenderingContext2D,
    o: OverlayInput,
    proj: (p: Vec3) => { x: number; y: number } | null,
  ): void {
    const atlas = o.atlas!;
    const P = o.pixel;
    const cpx = this.chunkPx(o);
    if (cpx < 40) return;
    const per = Math.max(1, Math.min(4, Math.round((cpx / 260) * o.density * 2)));
    for (const a of o.known) {
      for (let i = 0; i < per; i++) {
        const hx = hash2(a.face * 97 + a.cx * 13 + i, a.cy * 31 + i * 7);
        const hy = hash2(a.cy * 17 + i * 3, a.face * 11 + a.cx * 5 + i);
        // Drift east across the chunk and wrap, fading in and out at the ends.
        const t = (hx + o.time * o.drift * 0.012) % 1;
        const fadeIn = Math.min(1, t * 6, (1 - t) * 6);
        const p = proj(chunkToSphere(o.n, a, t, 0.1 + hy * 0.8));
        if (!p) continue;
        const k = Math.floor(hash2(hx * 9, hy * 7) * o.atlas!.meta.puffs.length);
        const puff = atlas.rect(atlas.meta.puffs[k]!);
        const shadow = atlas.rect(atlas.meta.shadows[k]!);
        ctx.globalAlpha = 0.45 * fadeIn;
        this.sprite(
          ctx,
          atlas,
          shadow,
          p.x - (shadow.w * P) / 2 + 7 * P,
          p.y - (shadow.h * P) / 2 + 9 * P,
          P,
        );
        ctx.globalAlpha = 0.95 * fadeIn;
        this.sprite(ctx, atlas, puff, p.x - (puff.w * P) / 2, p.y - (puff.h * P) / 2, P);
      }
    }
    ctx.globalAlpha = 1;
  }

  private chunkPx(o: OverlayInput): number {
    return o.frame.R * (Math.PI / 2 / o.n);
  }

  /** Nine-slice rims: strips along every open edge of a clouded chunk, corners where a hole turns. */
  private drawRims(
    ctx: CanvasRenderingContext2D,
    o: OverlayInput,
    proj: (p: Vec3) => { x: number; y: number } | null,
  ): void {
    const atlas = o.atlas!;
    const P = o.pixel;
    const cpx = this.chunkPx(o);
    if (cpx < 14) return;
    const inset = 3;
    const north = atlas.meta.edges.north.map((s) => atlas.rect(s));
    const south = atlas.meta.edges.south.map((s) => atlas.rect(s));
    const [tl, tr, bl, br] = atlas.meta.edges.corners.map((s) => atlas.rect(s));
    for (const a of o.visible) {
      if (o.levelOf(a) !== 2) continue;
      const bits = o.openAround(a);
      if (bits === 0) continue;
      const open = (dx: number, dy: number) => (bits & (1 << ((dy + 1) * 3 + dx + 1))) !== 0;
      const sides: Array<[number, number]> = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ];
      for (const [dx, dy] of sides) {
        if (!open(dx, dy)) continue;
        // Edge endpoints in chunk-local units, and the direction into the hole.
        const e0: [number, number] = dx !== 0 ? [dx > 0 ? 1 : 0, 0] : [0, dy > 0 ? 1 : 0];
        const e1: [number, number] = dx !== 0 ? [dx > 0 ? 1 : 0, 1] : [1, dy > 0 ? 1 : 0];
        const p0 = proj(chunkToSphere(o.n, a, e0[0], e0[1]));
        const p1 = proj(chunkToSphere(o.n, a, e1[0], e1[1]));
        const pc = proj(chunkToSphere(o.n, a, 0.5 + dx, 0.5 + dy));
        if (!p0 || !p1 || !pc) continue;
        const len = Math.hypot(p1.x - p0.x, p1.y - p0.y);
        if (len < 4) continue;
        const ax = (p1.x - p0.x) / len;
        const ay = (p1.y - p0.y) / len;
        const mx = (p0.x + p1.x) / 2;
        const my = (p0.y + p1.y) / 2;
        let ddx = pc.x - mx;
        let ddy = pc.y - my;
        const dl = Math.hypot(ddx, ddy) || 1;
        ddx /= dl;
        ddy /= dl;
        const useSouth = dy < 0 || (dx !== 0 && hash2(a.cx + dx, a.cy) > 0.5);
        const set = useSouth ? south : north;
        const sw = set[0]!.w * P;
        const count = Math.max(1, Math.ceil(len / (sw * 0.9)));
        const step = len / count;
        for (let i = 0; i < count; i++) {
          const r =
            set[
              Math.floor(hash2(a.cx * 7 + i, a.cy * 3 + a.face + dx * 5 + dy * 11) * set.length)
            ]!;
          const sx = p0.x + ax * (i * step + step / 2 - (r.w * P) / 2);
          const sy = p0.y + ay * (i * step + step / 2 - (r.w * P) / 2);
          // North art has the hole at its bottom (y toward the hole), south art at its top.
          const yx = useSouth ? -ddx : ddx;
          const yy = useSouth ? -ddy : ddy;
          const push = (useSouth ? inset : inset - r.h) * P;
          ctx.setTransform(ax, ay, yx, yy, sx + ddx * push, sy + ddy * push);
          ctx.drawImage(atlas.image, r.x, r.y, r.w, r.h, 0, 0, r.w * P, r.h * P);
          this.stamps++;
        }
      }
      // Corners: the hole is diagonal and both sides next to it are clouded.
      const corners: Array<[number, number, AtlasRect]> = [
        [1, 1, tl!],
        [-1, 1, tr!],
        [1, -1, bl!],
        [-1, -1, br!],
      ];
      for (const [dx, dy, r] of corners) {
        if (!open(dx, dy) || open(dx, 0) || open(0, dy)) continue;
        const v = proj(chunkToSphere(o.n, a, dx > 0 ? 1 : 0, dy > 0 ? 1 : 0));
        if (!v) continue;
        const ax = this.axis(o, a, proj);
        if (!ax) continue;
        // Anchor: the hole's corner sits ~10 art px in from the piece's cloud sides.
        const anchorX = dx > 0 ? 10 : r.w - 10;
        const anchorY = dy > 0 ? 10 : r.h - 10;
        ctx.setTransform(ax.ux, ax.uy, ax.vx, ax.vy, v.x, v.y);
        ctx.drawImage(
          atlas.image,
          r.x,
          r.y,
          r.w,
          r.h,
          -anchorX * P + dx * inset * P,
          -anchorY * P + dy * inset * P,
          r.w * P,
          r.h * P,
        );
        this.stamps++;
      }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  /** Screen directions of a chunk's local +x and +y (unit). */
  private axis(o: OverlayInput, a: ChunkAddr, proj: (p: Vec3) => { x: number; y: number } | null) {
    const p00 = proj(chunkToSphere(o.n, a, 0.5, 0.5));
    const p10 = proj(chunkToSphere(o.n, a, 0.6, 0.5));
    const p01 = proj(chunkToSphere(o.n, a, 0.5, 0.6));
    if (!p00 || !p10 || !p01) return null;
    const lx = Math.hypot(p10.x - p00.x, p10.y - p00.y) || 1;
    const ly = Math.hypot(p01.x - p00.x, p01.y - p00.y) || 1;
    return {
      ux: (p10.x - p00.x) / lx,
      uy: (p10.y - p00.y) / lx,
      vx: (p01.x - p00.x) / ly,
      vy: (p01.y - p00.y) / ly,
    };
  }

  /** Small puffs round each rumour clearing that sits in cloud. */
  private drawRumorRings(
    ctx: CanvasRenderingContext2D,
    o: OverlayInput,
    proj: (p: Vec3) => { x: number; y: number } | null,
  ): void {
    const atlas = o.atlas!;
    const P = o.pixel;
    for (const r of o.rumors) {
      if (o.isolate !== null && o.isolate !== r.id) continue;
      if (o.isolate === null && o.levelOf(sphereToChunk(o.n, r.at).chunk) < 2) continue;
      const c = proj(r.at);
      if (!c) continue;
      const edge = proj(offsetToward(r.at, o.axes, o.clearing(r)));
      if (!edge) continue;
      const rad = Math.hypot(edge.x - c.x, edge.y - c.y);
      if (rad < 6) continue;
      const puffs = atlas.meta.puffs.map((s) => atlas.rect(s));
      const count = Math.max(6, Math.min(40, Math.round((2 * Math.PI * rad) / (14 * P))));
      for (let i = 0; i < count; i++) {
        const t = (i / count) * Math.PI * 2 + r.id;
        const k = Math.floor(hash2(r.id * 13 + i, i * 7) * 3) + 1;
        const pr = puffs[Math.min(puffs.length - 1, k)]!;
        const wob = 1 + (hash2(i, r.id) - 0.5) * 0.12;
        const x = c.x + Math.cos(t) * rad * wob - (pr.w * P) / 2;
        const y = c.y + Math.sin(t) * rad * wob - (pr.h * P) / 2;
        this.sprite(ctx, atlas, pr, x, y, P);
      }
    }
  }

  private drawPath(
    ctx: CanvasRenderingContext2D,
    o: OverlayInput,
    proj: (p: Vec3) => { x: number; y: number } | null,
  ): void {
    if (o.path.length < 2) return;
    ctx.save();
    ctx.strokeStyle = 'rgba(122, 59, 34, 0.85)';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 5]);
    ctx.beginPath();
    let pen = false;
    for (const p of o.path) {
      const s = proj(p);
      if (!s) {
        pen = false;
        continue;
      }
      if (pen) ctx.lineTo(s.x, s.y);
      else ctx.moveTo(s.x, s.y);
      pen = true;
    }
    ctx.stroke();
    ctx.restore();
  }

  private drawDirection(
    ctx: CanvasRenderingContext2D,
    o: OverlayInput,
    from: Vec3,
    to: Vec3,
    proj: (p: Vec3) => { x: number; y: number } | null,
  ): void {
    ctx.save();
    ctx.strokeStyle = 'rgba(246, 236, 210, 0.95)';
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 6]);
    ctx.lineDashOffset = -o.time * 24;
    ctx.beginPath();
    let pen = false;
    for (let i = 0; i <= 48; i++) {
      const s = proj(slerpLocal(from, to, i / 48));
      if (!s) {
        pen = false;
        continue;
      }
      if (pen) ctx.lineTo(s.x, s.y);
      else ctx.moveTo(s.x, s.y);
      pen = true;
    }
    ctx.stroke();
    ctx.restore();
  }

  private drawRumors(
    ctx: CanvasRenderingContext2D,
    o: OverlayInput,
    proj: (p: Vec3) => { x: number; y: number } | null,
  ): void {
    ctx.font = '15px "Trailbound Pixel", monospace';
    ctx.textAlign = 'center';
    for (const r of o.rumors) {
      if (o.isolate !== null && o.isolate !== r.id) continue;
      const arriving = o.arrive?.id === r.id ? o.arrive.t : null;
      const believedAt = proj(r.at);
      const trueAt = proj(r.trueAt);
      const sel = o.selected === r.id;
      if (believedAt && !r.arrived) {
        // How far off it might be: a dashed ring.
        const edge = proj(offsetToward(r.at, o.axes, o.uncertainty(r)));
        if (edge) {
          ctx.save();
          ctx.strokeStyle = sel ? 'rgba(246, 230, 255, 0.95)' : 'rgba(214, 200, 240, 0.7)';
          ctx.setLineDash([5, 5]);
          ctx.lineWidth = sel ? 2 : 1.5;
          ctx.beginPath();
          ctx.arc(
            believedAt.x,
            believedAt.y,
            Math.hypot(edge.x - believedAt.x, edge.y - believedAt.y),
            0,
            Math.PI * 2,
          );
          ctx.stroke();
          ctx.restore();
        }
        let alpha = 0.85;
        if (arriving !== null) alpha = Math.max(0, 1 - arriving * 2.2);
        // The believed look: greyed, with a violet halo; dissolves on arrival.
        drawIcon(ctx, r.believed.id, believedAt.x, believedAt.y, 4, {
          grey: true,
          alpha,
          outline: 'rgba(120, 96, 170, 0.55)',
        });
        if (alpha > 0.1)
          this.label(ctx, believedAt.x, believedAt.y + 16, `${r.believed.name}?`, sel, alpha);
      }
      const showTruth = r.arrived || o.truth || (arriving !== null && arriving > 0.35);
      if (showTruth && trueAt) {
        let x = trueAt.x;
        let y = trueAt.y;
        let alpha = 1;
        if (arriving !== null && !r.arrived && believedAt) {
          // The marker slides from where it was said to be to where it is.
          const t = Math.min(1, Math.max(0, (arriving - 0.35) / 0.45));
          const e = t * t * (3 - 2 * t);
          x = believedAt.x + (trueAt.x - believedAt.x) * e;
          y = believedAt.y + (trueAt.y - believedAt.y) * e;
          alpha = t;
        }
        if (o.truth && !r.arrived && believedAt && arriving === null) {
          ctx.save();
          ctx.strokeStyle = 'rgba(255, 220, 120, 0.9)';
          ctx.setLineDash([3, 4]);
          ctx.beginPath();
          ctx.moveTo(believedAt.x, believedAt.y);
          ctx.lineTo(trueAt.x, trueAt.y);
          ctx.stroke();
          ctx.restore();
        }
        drawIcon(ctx, r.truth.id, x, y, 4, { alpha, outline: 'rgba(30, 20, 12, 0.8)' });
        this.label(
          ctx,
          x,
          y + 16,
          r.arrived ? r.truth.name : `Really: ${r.truth.name}`,
          sel,
          alpha,
          true,
        );
      }
    }
  }

  private label(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    text: string,
    sel: boolean,
    alpha: number,
    truth = false,
  ): void {
    ctx.save();
    ctx.globalAlpha = alpha;
    const w = ctx.measureText(text).width + 10;
    ctx.fillStyle = truth
      ? 'rgba(42, 29, 16, 0.85)'
      : sel
        ? 'rgba(70, 52, 110, 0.92)'
        : 'rgba(50, 40, 70, 0.75)';
    ctx.fillRect(Math.round(x - w / 2), Math.round(y - 2), Math.round(w), 20);
    ctx.fillStyle = truth ? '#ffe7a8' : '#efe6ff';
    ctx.fillText(text, x, y + 13);
    ctx.restore();
  }

  /** Arrival: the clearing billows open (clearing-rim frames), then the poof ring bursts over the spot. */
  private drawArrive(
    ctx: CanvasRenderingContext2D,
    o: OverlayInput,
    proj: (p: Vec3) => { x: number; y: number } | null,
  ): void {
    const a = o.arrive!;
    const r = o.rumors.find((x) => x.id === a.id);
    if (!r || !o.atlas) return;
    const at = proj(r.trueAt);
    const edge = proj(offsetToward(r.trueAt, o.axes, o.clearing(r) * 1.4));
    if (!at || !edge) return;
    const atlas = o.atlas;
    const radius = Math.max(24, Math.hypot(edge.x - at.x, edge.y - at.y));
    const rim = atlas.meta.anims.clearingRim!;
    const poof = atlas.meta.anims.poof!;
    if (a.t < 0.6) {
      // The hole opens: rim frames, scaled so the hole spans the clearing, faded to a round edge.
      const t = a.t / 0.6;
      const f = rim.frames[Math.min(rim.frames.length - 1, Math.floor(t * rim.frames.length))]!;
      const rr = atlas.rect(f);
      const s = Math.min(
        o.pixel * 3,
        Math.max(1, Math.round((radius * (1.1 + t * 1.2)) / (rr.w * 0.32))),
      );
      const side = rr.w * s;
      const buf = this.scratch(side);
      const bctx = buf.getContext('2d')!;
      bctx.globalCompositeOperation = 'source-over';
      bctx.clearRect(0, 0, side, side);
      bctx.imageSmoothingEnabled = false;
      bctx.drawImage(atlas.image, rr.x, rr.y, rr.w, rr.h, 0, 0, side, side);
      bctx.globalCompositeOperation = 'destination-in';
      const g = bctx.createRadialGradient(
        side / 2,
        side / 2,
        side * 0.3,
        side / 2,
        side / 2,
        side / 2,
      );
      g.addColorStop(0, 'rgba(0,0,0,1)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      bctx.fillStyle = g;
      bctx.fillRect(0, 0, side, side);
      ctx.globalAlpha = 1 - Math.max(0, t - 0.6) / 0.4;
      ctx.drawImage(
        buf,
        0,
        0,
        side,
        side,
        Math.round(at.x - side / 2),
        Math.round(at.y - side / 2),
        side,
        side,
      );
      this.stamps++;
    }
    if (a.t > 0.3 && a.t < 0.85) {
      const t = (a.t - 0.3) / 0.55;
      const f = poof.frames[Math.min(poof.frames.length - 1, Math.floor(t * poof.frames.length))]!;
      const rr = atlas.rect(f);
      const s = Math.min(o.pixel * 3, Math.max(2, Math.round((radius * 1.2) / rr.w)));
      ctx.globalAlpha = 1 - Math.max(0, t - 0.7) / 0.3;
      ctx.drawImage(
        atlas.image,
        rr.x,
        rr.y,
        rr.w,
        rr.h,
        Math.round(at.x - (rr.w * s) / 2),
        Math.round(at.y - 12 - (rr.h * s) / 2),
        rr.w * s,
        rr.h * s,
      );
      this.stamps++;
    }
    ctx.globalAlpha = 1;
  }

  private buf: HTMLCanvasElement | null = null;

  private scratch(side: number): HTMLCanvasElement {
    if (!this.buf) this.buf = document.createElement('canvas');
    if (this.buf.width < side || this.buf.height < side) {
      this.buf.width = Math.max(this.buf.width, side);
      this.buf.height = Math.max(this.buf.height, side);
    }
    return this.buf;
  }

  /**
   * The cut to an unknown-direction rumour: puffs swell all over the screen
   * until it is all cloud (the single poof frame, by scale and alpha), then
   * burst open (the poof frames) on the new view.
   */
  private drawPoof(ctx: CanvasRenderingContext2D, o: OverlayInput): void {
    const atlas = o.atlas!;
    const t = o.poof!;
    const frames = atlas.meta.anims.poof!.frames;
    const blob = atlas.rect(frames[0]!);
    const S = Math.max(4, Math.round(Math.min(o.w, o.h) / 150));
    const step = blob.w * S * 0.55;
    const cols = Math.ceil(o.w / step) + 2;
    const rows = Math.ceil(o.h / step) + 2;
    const cx = o.w / 2;
    const cy = o.h / 2;
    const far = Math.hypot(cx, cy);
    let fill = 0;
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const x = (i - 0.5) * step + (j % 2) * step * 0.5 + (hash2(i, j) - 0.5) * step * 0.4;
        const y = (j - 0.5) * step + (hash2(j, i) - 0.5) * step * 0.4;
        // A wave from the middle outwards.
        const lag = (Math.hypot(x - cx, y - cy) / far) * 0.18;
        if (t < 0.5) {
          const u = Math.max(0, Math.min(1, (t - lag) / 0.3));
          if (u <= 0) continue;
          const s = S * (0.4 + 0.9 * u);
          ctx.globalAlpha = Math.min(1, u * 1.6);
          ctx.drawImage(
            atlas.image,
            blob.x,
            blob.y,
            blob.w,
            blob.h,
            Math.round(x - (blob.w * s) / 2),
            Math.round(y - (blob.h * s) / 2),
            Math.round(blob.w * s),
            Math.round(blob.h * s),
          );
        } else {
          const u = Math.max(0, Math.min(1, (t - 0.5 - lag) / 0.32));
          const f = frames[Math.min(frames.length - 1, 1 + Math.floor(u * (frames.length - 1)))]!;
          const r = atlas.rect(f);
          const s = S * (1.3 + u * 0.6);
          ctx.globalAlpha = 1 - Math.max(0, u - 0.55) / 0.45;
          if (ctx.globalAlpha <= 0) continue;
          ctx.drawImage(
            atlas.image,
            r.x,
            r.y,
            r.w,
            r.h,
            Math.round(x - (r.w * s) / 2),
            Math.round(y - (r.h * s) / 2),
            Math.round(r.w * s),
            Math.round(r.h * s),
          );
        }
        this.stamps++;
      }
    }
    // Fully clouded at the cut itself.
    fill = t < 0.5 ? Math.max(0, (t - 0.3) / 0.2) : Math.max(0, 1 - (t - 0.5) / 0.12);
    if (fill > 0) {
      ctx.globalAlpha = Math.min(1, fill);
      ctx.fillStyle = '#f9ecd0';
      ctx.fillRect(0, 0, o.w, o.h);
    }
    ctx.globalAlpha = 1;
  }
}
function offsetToward(p: Vec3, axes: FrameAxes, angle: number): Vec3 {
  // Any tangent direction works for a radius; use the view's east.
  const e = axes.east;
  const d = p[0] * e[0] + p[1] * e[1] + p[2] * e[2];
  let t: [number, number, number] = [e[0] - d * p[0], e[1] - d * p[1], e[2] - d * p[2]];
  const l = Math.hypot(...t);
  if (l < 1e-6) t = [axes.north[0], axes.north[1], axes.north[2]];
  else t = [t[0] / l, t[1] / l, t[2] / l];
  return [
    p[0] * Math.cos(angle) + t[0] * Math.sin(angle),
    p[1] * Math.cos(angle) + t[1] * Math.sin(angle),
    p[2] * Math.cos(angle) + t[2] * Math.sin(angle),
  ];
}

function slerpLocal(a: Vec3, b: Vec3, t: number): Vec3 {
  const d = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
  const w = Math.acos(d);
  if (w < 1e-6) return a;
  const s = Math.sin(w);
  const ka = Math.sin((1 - t) * w) / s;
  const kb = Math.sin(t * w) / s;
  return [a[0] * ka + b[0] * kb, a[1] * ka + b[1] * kb, a[2] * ka + b[2] * kb];
}
