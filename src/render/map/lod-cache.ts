export interface LodSlot<T> {
  key: string;
  value: T;
  bytes: number;
  level: number;
  tick: number;
}

/**
 * Byte-capped store for chunk and block images.
 * A read counts as a use, so the visible set stays and the cold set leaves.
 */
export class ImageLodCache<T> {
  private readonly slots = new Map<string, LodSlot<T>>();
  private tick = 0;
  bytes = 0;

  constructor(readonly maxBytes: number) {}

  get size(): number {
    return this.slots.size;
  }

  has(key: string): boolean {
    return this.slots.has(key);
  }

  keys(): IterableIterator<string> {
    return this.slots.keys();
  }

  peek(key: string): T | undefined {
    return this.slots.get(key)?.value;
  }

  /** Read and mark the entry as recently used. */
  get(key: string): T | undefined {
    const slot = this.slots.get(key);
    if (!slot) return undefined;
    slot.tick = ++this.tick;
    return slot.value;
  }

  /** Level of a stored image. A read keeps the entry. */
  levelOf(key: string): number | undefined {
    const slot = this.slots.get(key);
    if (!slot) return undefined;
    slot.tick = ++this.tick;
    return slot.level;
  }

  set(key: string, value: T, bytes: number, level = 0): void {
    const prev = this.slots.get(key);
    if (prev) {
      this.bytes -= prev.bytes;
      this.slots.delete(key);
    }
    const slot: LodSlot<T> = {
      key,
      value,
      bytes: Math.max(0, Math.round(bytes)),
      level,
      tick: ++this.tick,
    };
    this.slots.set(key, slot);
    this.bytes += slot.bytes;
    this.evict(key);
  }

  delete(key: string): void {
    const slot = this.slots.get(key);
    if (!slot) return;
    this.bytes -= slot.bytes;
    this.slots.delete(key);
  }

  clear(): void {
    this.slots.clear();
    this.bytes = 0;
  }

  private evict(keep: string): void {
    while (this.bytes > this.maxBytes && this.slots.size > 0) {
      let oldest: LodSlot<T> | null = null;
      for (const slot of this.slots.values()) {
        if (slot.key === keep) continue;
        if (!oldest || slot.tick < oldest.tick) oldest = slot;
      }
      if (!oldest) break;
      this.bytes -= oldest.bytes;
      this.slots.delete(oldest.key);
    }
  }
}

type PixelSource = CanvasImageSource & { width: number; height: number };

/** Box-filter minify. Used when a canvas 2d context cannot be read back. */
export function downsamplePixels(
  src: Uint8ClampedArray,
  width: number,
  height: number,
  factor: number,
): { data: Uint8ClampedArray; width: number; height: number } {
  const dw = Math.max(1, Math.round(width / Math.max(1, factor)));
  const dh = Math.max(1, Math.round(height / Math.max(1, factor)));
  const data = new Uint8ClampedArray(dw * dh * 4);
  for (let y = 0; y < dh; y++) {
    const y0 = Math.min(height - 1, Math.floor((y * height) / dh));
    const y1 = Math.min(height, Math.max(y0 + 1, Math.floor(((y + 1) * height) / dh)));
    for (let x = 0; x < dw; x++) {
      const x0 = Math.min(width - 1, Math.floor((x * width) / dw));
      const x1 = Math.min(width, Math.max(x0 + 1, Math.floor(((x + 1) * width) / dw)));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const o = (sy * width + sx) * 4;
          r += src[o] ?? 0;
          g += src[o + 1] ?? 0;
          b += src[o + 2] ?? 0;
          a += src[o + 3] ?? 0;
          n += 1;
        }
      }
      const count = Math.max(1, n);
      const d = (y * dw + x) * 4;
      data[d] = r / count;
      data[d + 1] = g / count;
      data[d + 2] = b / count;
      data[d + 3] = a / count;
    }
  }
  return { data, width: dw, height: dh };
}

/** Half, quarter, or eighth of a chunk bake. Smoothing is the minify filter. */
export function downsampleCanvas(source: PixelSource, factor: number): HTMLCanvasElement {
  const scale = Math.max(1, factor);
  const width = Math.max(1, Math.round(source.width / scale));
  const height = Math.max(1, Math.round(source.height / scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, width, height);
  return canvas;
}
