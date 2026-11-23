/**
 * Inspected chunk maps, in memory only and only while World Gen is open: a
 * small LRU so flipping between a few chunks is instant. Never saved.
 */
import type { ChunkRaster } from '../../core/planet';

export const CHUNK_CACHE_SIZE = 4;

export class ChunkCache {
  private readonly map = new Map<string, ChunkRaster>();

  constructor(private readonly max = CHUNK_CACHE_SIZE) {}

  get size(): number {
    return this.map.size;
  }

  keys(): string[] {
    return [...this.map.keys()];
  }

  get(key: string): ChunkRaster | undefined {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    // Most recently used goes last.
    this.map.delete(key);
    this.map.set(key, hit);
    return hit;
  }

  set(key: string, raster: ChunkRaster): void {
    this.map.delete(key);
    this.map.set(key, raster);
    while (this.map.size > this.max) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }

  clear(): void {
    this.map.clear();
  }
}
