import {
  bakeNodes,
  clockLabelFor,
  groundLight,
  hexToRgb,
  isDaylight,
  lerpRgb,
  litTint,
  litUnits,
  rgbToHex,
  skyAt,
  thresholdsFor,
  unitColor,
  type DayThresholds,
  type Rgb,
  type SeasonId,
  type SeasonPreset,
  type SkyState,
} from '../../core/sim/day-cycle';
import {
  BASE_SLOTS,
  DEFAULT_RECIPE,
  detailSlot,
  layerTint,
  recipeFor,
  type BiomeRecipe,
  type DetailLayer,
} from './biome-recipes';
import { HUD_NATIVE_H, HUD_NATIVE_W, NODE_LAYOUT, SKY_RECT } from './layout';
import type { HudSprites, Sprite } from './sprites';

export interface HudFrame {
  /** Continuous TU left in the day, `(0, 100]`. */
  tuRemaining: number;
  day: number;
  season: SeasonId | SeasonPreset;
  /** Beads on the left that sit under pre-dawn fog. 0 turns the fog off. */
  fogUnits: number;
  timeMs: number;
  reducedMotion: boolean;
  /**
   * Biome under the party: a world biome id, a biome name or a recipe id.
   * Missing or unknown draws the default hills strip. A change crossfades over `BIOME_FADE_MS`.
   */
  biome?: number | string | null;
}

/** How long the sky strip's terrain takes to crossfade when the biome changes. */
export const BIOME_FADE_MS = 1000;

type Canvas2D = CanvasRenderingContext2D;

const STARS: ReadonlyArray<readonly [number, number]> = [
  [0.08, 0.22],
  [0.18, 0.45],
  [0.28, 0.18],
  [0.42, 0.35],
  [0.55, 0.2],
  [0.68, 0.4],
  [0.8, 0.24],
  [0.92, 0.42],
  [0.35, 0.1],
  [0.74, 0.12],
];

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function css(c: Rgb): string {
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

/** Draws the HUD at native size. Call `draw` with a 1x canvas context. */
export class DayCycleRenderer {
  readonly width = HUD_NATIVE_W;
  readonly height = HUD_NATIVE_H;
  private readonly tintCache = new Map<string, HTMLCanvasElement>();
  private readonly fontCache = new Map<string, HTMLCanvasElement>();
  private staticLayer: HTMLCanvasElement | null = null;
  private staticKey = '';
  private shown: BiomeRecipe | null = null;
  private fadingFrom: BiomeRecipe | null = null;
  private fadeStartMs = 0;
  private scratch: HTMLCanvasElement | null = null;

  constructor(private readonly art: HudSprites) {}

  draw(ctx: Canvas2D, frame: HudFrame): void {
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, this.width, this.height);
    const th = thresholdsFor(frame.season);
    const nodes = bakeNodes(NODE_LAYOUT, 1);
    const lit = litUnits(frame.tuRemaining);
    const tuInt = lit;
    const daylight = isDaylight(tuInt, th);
    const special = this.specialUnits(th);

    this.drawSky(ctx, frame, th);
    this.drawStatic(ctx, special);

    // Lit beads, then medallions.
    for (const node of nodes) {
      const unit = node.unit;
      const isLit = unit <= lit;
      const rx = Math.round(node.x);
      const ry = Math.round(node.y);
      const kind = special.get(unit);
      if (kind) {
        this.drawMedallion(ctx, kind, rx, ry, isLit, unitColor(unit, th));
      } else if (isLit) {
        const base = unitColor(unit, th);
        const color = unit === lit ? lerpRgb(base, [255, 255, 255], 0.35) : base;
        this.drawSprite(ctx, 'node_gem_lit', 0, rx, ry, color);
      }
    }

    // End-caps and their labels.
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (first && last) {
      this.drawSprite(ctx, 'anchor_left_moon', 0, Math.round(first.x - 4), Math.round(first.y));
      this.drawSprite(ctx, 'anchor_right_dawn', 0, Math.round(last.x + 4), Math.round(last.y));
      this.drawText(
        ctx,
        '0',
        Math.round(first.x - 4),
        Math.round(first.y) + 9,
        '#93c5fd',
        'center',
      );
      this.drawText(
        ctx,
        '100',
        Math.round(last.x + 4),
        Math.round(last.y) + 9,
        '#fde047',
        'center',
      );
    }
    for (const [unit, kind] of special) {
      if (kind !== 'sunset') continue;
      const node = nodes[unit - 1];
      if (!node) continue;
      this.drawText(
        ctx,
        String(unit),
        Math.round(node.x),
        Math.round(node.y) + 7,
        unit <= lit ? '#fb923c' : '#7c7a8c',
        'center',
      );
    }

    // Pre-dawn fog over the first N beads.
    if (frame.fogUnits > 0) {
      for (const node of nodes) {
        if (node.unit > frame.fogUnits) break;
        this.drawSprite(ctx, 'fog_shroud', 0, Math.round(node.x), Math.round(node.y));
      }
    }

    // Leading pulse and the tooltip pill ride the active bead.
    const active = nodes[Math.max(0, Math.min(nodes.length - 1, lit - 1))];
    if (active) {
      const pulse = this.art.sprites.node_leading_pulse;
      if (pulse && lit > 0) {
        const fps = pulse.def.fps ?? 7;
        const f = frame.reducedMotion
          ? 0
          : Math.floor((frame.timeMs / 1000) * fps) % pulse.def.states.length;
        this.drawSprite(ctx, 'node_leading_pulse', f, Math.round(active.x), Math.round(active.y));
      }
      this.drawPill(ctx, active.x, active.y, tuInt, daylight);
    }

    this.drawDayLabel(ctx, frame.day);
  }

  // ----------------------------------------------------------------- sky

  private drawSky(ctx: Canvas2D, frame: HudFrame, th: DayThresholds): void {
    const r = SKY_RECT;
    const frameSprite = this.art.sprites.sky_frame;
    const inset = frameSprite ? (frameSprite.def.slice?.[0] ?? 2) : 2;
    const ix = r.x + inset;
    const iy = r.y + inset;
    const iw = r.w - inset * 2;
    const ih = r.h - inset * 2;
    const sky = skyAt(frame.tuRemaining, th);
    const terrain = this.art.sprites.terrain_mask;
    const groundRows = terrain ? Math.min(terrain.def.h, ih) : 5;
    const skyH = ih - Math.max(0, groundRows - 3);
    const midRow = Math.floor(skyH * 0.55);

    ctx.save();
    ctx.beginPath();
    ctx.rect(ix, iy, iw, ih);
    ctx.clip();

    for (let row = 0; row < ih; row++) {
      const c =
        row <= midRow
          ? lerpRgb(sky.top, sky.mid, row / Math.max(1, midRow))
          : lerpRgb(sky.mid, sky.horizon, (row - midRow) / Math.max(1, skyH - 1 - midRow));
      ctx.fillStyle = css(c);
      ctx.fillRect(ix, iy + row, iw, 1);
    }

    if (sky.glowAlpha > 0.04) {
      ctx.globalAlpha = sky.glowAlpha * 0.75;
      ctx.fillStyle = css(sky.glowColor);
      ctx.fillRect(ix, iy + skyH - 3, iw, 3);
      ctx.globalAlpha = sky.glowAlpha * 0.95;
      ctx.fillStyle = '#fde047';
      ctx.fillRect(ix, iy + skyH - 1, iw, 1);
      ctx.globalAlpha = 1;
    }

    if (sky.starAlpha > 0.05) {
      ctx.globalAlpha = sky.starAlpha;
      STARS.forEach(([sx, sy], idx) => {
        ctx.fillStyle = idx % 2 === 0 ? '#f8fafc' : '#93c5fd';
        ctx.fillRect(ix + Math.floor(sx * iw), iy + Math.floor(sy * (skyH - 3)), 1, 1);
      });
      ctx.globalAlpha = 1;
    }

    // The sun and moon glide on the continuous tuFloat, not the bead count.
    const bx = Math.round(ix + iw * sky.bodyX);
    const by = Math.round(iy + skyH - 2 - sky.bodyElev * (skyH - 6));
    this.drawSprite(ctx, sky.daylight ? 'sky_sun' : 'sky_moon', 0, bx, by);

    this.drawTerrain(ctx, frame, sky, ix, iy, iw, ih);
    ctx.restore();

    if (frameSprite) this.drawNine(ctx, frameSprite, 0, r.x, r.y, r.w, r.h);
  }

  // ------------------------------------------------------------- terrain

  /** Id of the recipe on screen (or fading in). For tests and the debug hook. */
  get recipeId(): string {
    return this.shown?.id ?? DEFAULT_RECIPE.id;
  }

  /**
   * The ground of the sky strip: the recipe of the biome, crossfaded from the
   * old one when it changes. Draws into the sky's clip rectangle.
   */
  private drawTerrain(
    ctx: Canvas2D,
    frame: HudFrame,
    sky: SkyState,
    ix: number,
    iy: number,
    iw: number,
    ih: number,
  ): void {
    const target = recipeFor(frame.biome ?? null);
    if (!this.shown) {
      this.shown = target;
    } else if (target.id !== this.shown.id) {
      this.fadingFrom = frame.reducedMotion ? null : this.shown;
      this.shown = target;
      this.fadeStartMs = frame.timeMs;
    }
    let t = 1;
    if (this.fadingFrom) {
      t = (frame.timeMs - this.fadeStartMs) / BIOME_FADE_MS;
      if (!(t < 1)) {
        this.fadingFrom = null;
        t = 1;
      }
    }
    if (!this.fadingFrom) {
      this.drawRecipe(ctx, this.shown, sky, ix, iy, iw, ih);
      return;
    }
    this.drawRecipe(ctx, this.fadingFrom, sky, ix, iy, iw, ih);
    // The new ground goes to its own layer first, so its parts do not show through each other.
    if (!this.scratch || this.scratch.width !== iw || this.scratch.height !== ih) {
      this.scratch = makeCanvas(iw, ih);
    }
    const sc = this.scratch.getContext('2d');
    if (!sc) return;
    sc.imageSmoothingEnabled = false;
    sc.clearRect(0, 0, iw, ih);
    this.drawRecipe(sc, this.shown, sky, 0, 0, iw, ih);
    ctx.globalAlpha = Math.max(0, Math.min(1, t));
    ctx.drawImage(this.scratch, ix, iy);
    ctx.globalAlpha = 1;
  }

  /** One recipe, back to front: behind details, the base mask, then the details. */
  private drawRecipe(
    ctx: Canvas2D,
    recipe: BiomeRecipe,
    sky: SkyState,
    ix: number,
    iy: number,
    iw: number,
    ih: number,
  ): void {
    const base = this.art.sprites[BASE_SLOTS[recipe.base]];
    if (!base) {
      // Art without this recipe's masks: the original strip, so nothing disappears.
      if (recipe.id !== DEFAULT_RECIPE.id)
        this.drawRecipe(ctx, DEFAULT_RECIPE, sky, ix, iy, iw, ih);
      return;
    }
    const light = groundLight(sky);
    const paint = (sprite: typeof base, color: Rgb, dx: number, dy: number) => {
      const w = sprite.def.w;
      const tinted = this.tinted(sprite, 0, color);
      const y = iy + ih - sprite.def.h - dy;
      for (let x = -(((dx % w) + w) % w); x < iw; x += w) ctx.drawImage(tinted, ix + x, y);
    };
    const detailColor = (layer: DetailLayer): Rgb => {
      const kind = layerTint(layer);
      const hex = recipe.tints[kind] ?? recipe.tints.detail ?? recipe.tints.ground;
      return hex ? litTint(hexToRgb(hex), light, layer.mul ?? 1) : sky.ground;
    };
    const drawDetail = (layer: DetailLayer) => {
      const sprite = this.art.sprites[detailSlot(layer.id)];
      if (sprite) paint(sprite, detailColor(layer), layer.dx ?? 0, layer.dy ?? 0);
    };
    for (const layer of recipe.details) if (layer.behind) drawDetail(layer);
    const ground = recipe.tints.ground;
    paint(base, ground ? litTint(hexToRgb(ground), light) : sky.ground, 0, 0);
    for (const layer of recipe.details) if (!layer.behind) drawDetail(layer);
  }

  private drawDayLabel(ctx: Canvas2D, day: number): void {
    const text = `DAY ${Math.max(1, Math.floor(day))}`;
    const x = SKY_RECT.x + 5;
    const y = SKY_RECT.y + 4;
    this.drawText(ctx, text, x + 1, y + 1, '#1c1610', 'left');
    this.drawText(ctx, text, x, y, '#fff7d6', 'left');
  }

  // ----------------------------------------------------- spine and sockets

  /** Which beads carry a medallion: sunset, sunrise, solar noon, midnight. */
  private specialUnits(th: DayThresholds): Map<number, 'sunset' | 'sunrise' | 'sub'> {
    const m = new Map<number, 'sunset' | 'sunrise' | 'sub'>();
    m.set(th.midnightTU, 'sub');
    m.set(th.noonTU, 'sub');
    m.set(th.sunriseTU, 'sunrise');
    m.set(th.sunsetTU, 'sunset');
    return m;
  }

  /** Spine and empty sockets never change, so they are drawn once per season. */
  private drawStatic(ctx: Canvas2D, special: Map<number, string>): void {
    const key = [...special.keys()].join(',');
    if (!this.staticLayer || key !== this.staticKey) {
      const layer = makeCanvas(this.width, this.height);
      const c = layer.getContext('2d');
      if (c) {
        c.imageSmoothingEnabled = false;
        const nodes = bakeNodes(NODE_LAYOUT, 1);
        for (let i = 0; i < nodes.length - 1; i++) {
          const a = nodes[i];
          const b = nodes[i + 1];
          if (!a || !b) continue;
          for (let s = 0; s <= 4; s++) {
            this.drawSprite(
              c,
              'spine_link',
              0,
              Math.round(a.x + ((b.x - a.x) * s) / 4),
              Math.round(a.y + ((b.y - a.y) * s) / 4),
            );
          }
        }
        for (const n of nodes) {
          if (special.has(n.unit)) continue;
          this.drawSprite(c, 'node_socket_empty', 0, Math.round(n.x), Math.round(n.y));
        }
      }
      this.staticLayer = layer;
      this.staticKey = key;
    }
    ctx.drawImage(this.staticLayer, 0, 0);
  }

  private drawMedallion(
    ctx: Canvas2D,
    kind: 'sunset' | 'sunrise' | 'sub',
    x: number,
    y: number,
    lit: boolean,
    color: Rgb,
  ): void {
    const state = lit ? 0 : 1;
    if (kind === 'sunset') this.drawSprite(ctx, 'medallion_sunset', state, x, y);
    else if (kind === 'sunrise') this.drawSprite(ctx, 'medallion_sunrise', state, x, y);
    else this.drawSprite(ctx, 'sub_node', state, x, y, lit ? color : undefined);
  }

  // -------------------------------------------------------------- tooltip

  private drawPill(
    ctx: Canvas2D,
    nodeX: number,
    nodeY: number,
    tu: number,
    daylight: boolean,
  ): void {
    const label = `${tu}TU ${clockLabelFor(tu).short}`;
    const textW = this.measure(label);
    const pillW = textW + 6;
    const pillH = 9;
    // Keep the box clear of the two end-caps (13 px, centred 4 px outside the first and last bead).
    const nodes = bakeNodes(NODE_LAYOUT, 1);
    const minX = Math.round((nodes[0]?.x ?? 0) - 4 + 7);
    const maxX = Math.round((nodes[nodes.length - 1]?.x ?? this.width) + 4 - 7) - pillW;
    const x = Math.max(minX, Math.min(maxX, Math.round(nodeX - pillW / 2)));
    const y = Math.max(SKY_RECT.y + SKY_RECT.h + 2, Math.round(nodeY - 16));
    const stem = this.art.sprites[daylight ? 'cursor_stem_day' : 'cursor_stem_night'];
    const box = this.art.sprites[daylight ? 'cursor_pill_day' : 'cursor_pill_night'];
    if (stem) {
      const len = Math.max(2, Math.round(nodeY) - 3 - (y + pillH));
      ctx.drawImage(
        stem.image,
        0,
        0,
        stem.def.w,
        stem.def.h,
        Math.round(nodeX),
        y + pillH,
        stem.def.w,
        len,
      );
    }
    if (box) this.drawNine(ctx, box, 0, x, y, pillW, pillH);
    this.drawText(ctx, label, x + 3, y + 2, daylight ? '#fef08a' : '#ddd6fe', 'left');
  }

  // ------------------------------------------------------------ primitives

  private drawSprite(
    ctx: Canvas2D,
    id: string,
    state: number,
    x: number,
    y: number,
    tint?: Rgb,
  ): void {
    const sprite = this.art.sprites[id];
    if (!sprite) return;
    const { w, h, anchor } = sprite.def;
    const source = tint && sprite.def.tint ? this.tinted(sprite, state, tint) : null;
    if (source) {
      ctx.drawImage(source, x - anchor[0], y - anchor[1]);
    } else {
      ctx.drawImage(sprite.image, state * w, 0, w, h, x - anchor[0], y - anchor[1], w, h);
    }
  }

  /** Nine-slice a sprite into `(x, y, w, h)`. */
  private drawNine(
    ctx: Canvas2D,
    sprite: Sprite,
    state: number,
    x: number,
    y: number,
    w: number,
    h: number,
  ): void {
    const { w: sw, h: sh } = sprite.def;
    const [l, t, r, b] = sprite.def.slice ?? [0, 0, 0, 0];
    const sx = state * sw;
    const img = sprite.image;
    const mw = sw - l - r;
    const mh = sh - t - b;
    const dw = w - l - r;
    const dh = h - t - b;
    const blit = (
      s0: number,
      t0: number,
      sw0: number,
      sh0: number,
      d0: number,
      e0: number,
      dw0: number,
      dh0: number,
    ) => {
      if (sw0 > 0 && sh0 > 0 && dw0 > 0 && dh0 > 0) {
        ctx.drawImage(img, sx + s0, t0, sw0, sh0, x + d0, y + e0, dw0, dh0);
      }
    };
    blit(0, 0, l, t, 0, 0, l, t);
    blit(l, 0, mw, t, l, 0, dw, t);
    blit(sw - r, 0, r, t, w - r, 0, r, t);
    blit(0, t, l, mh, 0, t, l, dh);
    blit(l, t, mw, mh, l, t, dw, dh);
    blit(sw - r, t, r, mh, w - r, t, r, dh);
    blit(0, sh - b, l, b, 0, h - b, l, b);
    blit(l, sh - b, mw, b, l, h - b, dw, b);
    blit(sw - r, sh - b, r, b, w - r, h - b, r, b);
  }

  /** Colour one frame: gray pixels multiply, pure white mixes toward white, the rest stay. */
  private tinted(sprite: Sprite, state: number, color: Rgb): HTMLCanvasElement {
    const key = `${sprite.id}:${state}:${rgbToHex(color)}`;
    const hit = this.tintCache.get(key);
    if (hit) return hit;
    const { w, h } = sprite.def;
    const out = makeCanvas(w, h);
    const c = out.getContext('2d', { willReadFrequently: true });
    if (c) {
      c.imageSmoothingEnabled = false;
      c.drawImage(sprite.image, state * w, 0, w, h, 0, 0, w, h);
      try {
        const data = c.getImageData(0, 0, w, h);
        const px = data.data;
        for (let i = 0; i < px.length; i += 4) {
          const r = px[i] ?? 0;
          const g = px[i + 1] ?? 0;
          const b = px[i + 2] ?? 0;
          if (px[i + 3] === 0) continue;
          if (r === 255 && g === 255 && b === 255) {
            px[i] = Math.round(color[0] + (255 - color[0]) * 0.6);
            px[i + 1] = Math.round(color[1] + (255 - color[1]) * 0.6);
            px[i + 2] = Math.round(color[2] + (255 - color[2]) * 0.6);
          } else if (r === g && g === b) {
            px[i] = Math.round((r * color[0]) / 255);
            px[i + 1] = Math.round((g * color[1]) / 255);
            px[i + 2] = Math.round((b * color[2]) / 255);
          }
        }
        c.putImageData(data, 0, 0);
      } catch {
        // A tainted canvas cannot be read back: multiply the whole frame instead.
        c.globalCompositeOperation = 'multiply';
        c.fillStyle = css(color);
        c.fillRect(0, 0, w, h);
        c.globalCompositeOperation = 'destination-in';
        c.drawImage(sprite.image, state * w, 0, w, h, 0, 0, w, h);
      }
    }
    // Light changes the colour every few frames: keep the cache from growing for ever.
    if (this.tintCache.size > 600) this.tintCache.clear();
    this.tintCache.set(key, out);
    return out;
  }

  private advance(ch: string): number {
    const { cellW, spacing, widths } = this.art.font.def;
    return (widths[ch] ?? cellW) + spacing;
  }

  measure(text: string): number {
    let w = 0;
    for (const raw of text.toUpperCase()) w += this.advance(raw);
    return Math.max(0, w - this.art.font.def.spacing);
  }

  private fontTinted(hex: string): HTMLCanvasElement {
    const hit = this.fontCache.get(hex);
    if (hit) return hit;
    const img = this.art.font.image;
    const out = makeCanvas(img.width, img.height);
    const c = out.getContext('2d');
    if (c) {
      c.imageSmoothingEnabled = false;
      c.drawImage(img, 0, 0);
      c.globalCompositeOperation = 'source-in';
      c.fillStyle = hex;
      c.fillRect(0, 0, out.width, out.height);
    }
    this.fontCache.set(hex, out);
    return out;
  }

  drawText(
    ctx: Canvas2D,
    text: string,
    x: number,
    y: number,
    color: string,
    align: 'left' | 'center' | 'right',
  ): void {
    const { cellW, cellH, glyphs } = this.art.font.def;
    const sheet = this.fontTinted(color);
    const total = this.measure(text);
    let dx = Math.round(x);
    if (align === 'center') dx -= Math.floor(total / 2);
    else if (align === 'right') dx -= total;
    const dy = Math.round(y);
    for (const raw of text.toUpperCase()) {
      const index = glyphs.indexOf(raw);
      const glyph = index < 0 ? glyphs.indexOf(' ') : index;
      const width = this.art.font.def.widths[raw] ?? cellW;
      if (glyph >= 0 && raw !== ' ') {
        ctx.drawImage(sheet, glyph * cellW, 0, width, cellH, dx, dy, width, cellH);
      }
      dx += this.advance(raw);
    }
  }
}
