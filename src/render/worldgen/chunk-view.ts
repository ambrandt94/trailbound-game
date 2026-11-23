/**
 * World Gen's chunk view: one inspected chunk map on a 2D canvas, with pan
 * and zoom, town labels and its biome or height layer. The raster comes from
 * the worker (`jobs.ts`); this only draws it.
 */
import { biomeWashRgba, type ChunkRaster } from '../../core/planet';

export interface ChunkViewState {
  /** Raster px per CSS px, relative to fitting the map in the view. */
  zoom: number;
  /** Map centre in raster px. */
  cx: number;
  cy: number;
}

export class ChunkView {
  readonly canvas: HTMLCanvasElement;
  private raster: ChunkRaster | null = null;
  private images: { biome: HTMLCanvasElement; height: HTMLCanvasElement } | null = null;
  private dirty = true;
  private w = 0;
  private h = 0;
  state: ChunkViewState = { zoom: 1, cx: 0, cy: 0 };
  showHeight = false;
  showLabels = true;
  /** Biome overlay: the legend's flat colours washed over the map. */
  overlay = false;
  /** Biome the legend singles out, or null. */
  focus: number | null = null;
  private wash: { key: string; canvas: HTMLCanvasElement } | null = null;

  constructor(private readonly host: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'wg-chunk';
    host.append(this.canvas);
  }

  get hasRaster(): boolean {
    return !!this.raster;
  }

  invalidate(): void {
    this.dirty = true;
  }

  setRaster(raster: ChunkRaster | null): void {
    if (raster === this.raster) return;
    this.raster = raster;
    this.wash = null;
    this.images = raster
      ? { biome: toCanvas(raster.biome, raster.size), height: toCanvas(raster.height, raster.size) }
      : null;
    if (raster) this.state = { zoom: 1, cx: raster.size / 2, cy: raster.size / 2 };
    this.dirty = true;
  }

  /** The map image on show (biome or height), for the planet view's crossfade overlay. */
  image(): HTMLCanvasElement | null {
    if (!this.images) return null;
    return this.showHeight ? this.images.height : this.images.biome;
  }

  /** Side of the whole map on screen at its fitted zoom, CSS px. */
  fitSidePx(viewW: number, viewH: number): number {
    return Math.min(viewW, viewH) * 0.92;
  }

  /** Back to the whole map, fitted and centred (where a fly in lands). */
  resetView(): void {
    if (!this.raster) return;
    this.state = { zoom: 1, cx: this.raster.size / 2, cy: this.raster.size / 2 };
    this.dirty = true;
  }

  /** Screen px per raster px at the current zoom. */
  scale(): number {
    if (!this.raster) return 1;
    const fit = (Math.min(this.w, this.h) * 0.92) / this.raster.size;
    return fit * this.state.zoom;
  }

  pan(dx: number, dy: number): void {
    const s = this.scale();
    this.state.cx -= dx / s;
    this.state.cy -= dy / s;
    this.clampCentre();
    this.dirty = true;
  }

  /** Zoom by `factor` about a client point. */
  zoomAt(factor: number, clientX: number, clientY: number): void {
    if (!this.raster) return;
    const rect = this.canvas.getBoundingClientRect();
    const ox = clientX - rect.left - rect.width / 2;
    const oy = clientY - rect.top - rect.height / 2;
    const s0 = this.scale();
    const mx = this.state.cx + ox / s0;
    const my = this.state.cy + oy / s0;
    this.state.zoom = Math.max(0.6, Math.min(24, this.state.zoom * factor));
    const s1 = this.scale();
    this.state.cx = mx - ox / s1;
    this.state.cy = my - oy / s1;
    this.clampCentre();
    this.dirty = true;
  }

  render(): boolean {
    const rect = this.host.getBoundingClientRect();
    const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    if (w !== this.w || h !== this.h) {
      this.w = w;
      this.h = h;
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
      this.canvas.style.width = `${w}px`;
      this.canvas.style.height = `${h}px`;
      this.dirty = true;
    }
    if (!this.dirty) return false;
    this.dirty = false;
    const g = this.canvas.getContext('2d');
    if (!g) return false;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const r = this.raster;
    const img = this.images;
    if (!r || !img) return true;
    const s = this.scale();
    const x0 = w / 2 - this.state.cx * s;
    const y0 = h / 2 - this.state.cy * s;
    g.imageSmoothingEnabled = s < 1;
    g.drawImage(this.showHeight ? img.height : img.biome, x0, y0, r.size * s, r.size * s);
    const wash = this.washCanvas();
    if (wash) {
      g.imageSmoothingEnabled = false;
      g.drawImage(wash, x0, y0, r.size * s, r.size * s);
    }
    g.strokeStyle = 'rgba(255,255,255,0.85)';
    g.lineWidth = 2;
    g.strokeRect(x0 - 1, y0 - 1, r.size * s + 2, r.size * s + 2);
    if (!this.showLabels) return true;
    g.font = '12px "Pixel Operator", monospace';
    g.textAlign = 'center';
    g.textBaseline = 'bottom';
    for (const node of r.nodes) {
      const x = x0 + node.x * s;
      const y = y0 + node.y * s;
      if (x < -60 || y < -20 || x > w + 60 || y > h + 20) continue;
      const big = node.kind === 'city' || node.kind === 'town';
      g.fillStyle = big ? '#f5d77a' : '#e8e2cf';
      g.strokeStyle = '#2a1a0c';
      g.lineWidth = 2;
      g.beginPath();
      g.arc(x, y, big ? 4 : 2.5, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      if (big || s > 0.8) {
        g.lineWidth = 3;
        g.strokeText(node.name, x, y - 6);
        g.fillText(node.name, x, y - 6);
      }
    }
    return true;
  }

  /** The overlay / focus wash for the current raster, rebuilt only when either changes. */
  private washCanvas(): HTMLCanvasElement | null {
    const r = this.raster;
    if (!r || (!this.overlay && this.focus === null)) return null;
    const key = `${this.overlay}|${this.focus}`;
    if (this.wash?.key === key) return this.wash.canvas;
    const w = biomeWashRgba(r.ids, r.size, r.size, 768, this.overlay ? 0.62 : 0, this.focus);
    const c = document.createElement('canvas');
    c.width = w.w;
    c.height = w.h;
    c.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(w.rgba), w.w, w.h), 0, 0);
    this.wash = { key, canvas: c };
    return c;
  }

  dispose(): void {
    this.canvas.remove();
    this.raster = null;
    this.images = null;
  }

  private clampCentre(): void {
    if (!this.raster) return;
    const n = this.raster.size;
    this.state.cx = Math.max(0, Math.min(n, this.state.cx));
    this.state.cy = Math.max(0, Math.min(n, this.state.cy));
  }
}

function toCanvas(rgba: Uint8ClampedArray, size: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const g = c.getContext('2d');
  if (g) g.putImageData(new ImageData(new Uint8ClampedArray(rgba), size, size), 0, 0);
  return c;
}
