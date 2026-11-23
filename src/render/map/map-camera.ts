import {
  MAP_ZOOM_CAP,
  TILE,
  WORLD_BASE,
  clamp,
  clampLatY,
  globeMinScaleFor,
  lerpWrapX,
  minScaleFor,
  startScaleFor,
  wrapX,
  type CameraState,
} from '../../core/world/models';

/**
 * Same easing as the original trailbound-world-map viewport:
 * ZOOM_FOLLOW 14 eases the scale, and a 0.18 catch on the wheel event
 * keeps the tick responsive. While the scale is moving, the world point
 * under the cursor (or pinch) stays fixed. Follow mode keeps the hero centred.
 * A future 2D settlement view would be a separate mode; this camera only
 * frames the world map. Zoom stops at the cap; Enter opens the 3D area.
 */
const ZOOM_FOLLOW = 14;
const ZOOM_CATCH = 0.18;
const PAN_FOLLOW = 11;

/** Draw scale whose world pixel lands on a whole screen pixel once a tile is at least 1px. */
export function pixelSnapScale(scale: number, tile = TILE): number {
  const raw = scale * tile;
  if (raw < 1) return scale;
  return Math.max(1, Math.round(raw)) / tile;
}

/** Camera in world tiles. `scale` matches the frozen map: screen pixels per 16px world pixel. */
export class MapCamera {
  x = 0;
  y = 0;
  scale = 0.2;
  targetX = 0;
  targetY = 0;
  targetScale = 0.2;
  follow = true;
  /** Fine world tiles covered by one map tile. 16 on a 16× continent. */
  step = 1;
  private width = 192;
  private height = 192;
  /** False on planet chunks: the map has east and west edges. */
  private wraps = true;
  /** When the planet globe is ready, zoom may continue out past the flat map. */
  private globeZoom = false;
  private zoomPivot: {
    wx: number;
    wy: number;
    sx: number;
    sy: number;
    viewW: number;
    viewH: number;
  } | null = null;

  frame(width: number, height: number, heroX: number, heroY: number, wraps = true): void {
    this.wraps = wraps;
    this.step = width >= WORLD_BASE && width % WORLD_BASE === 0 ? width / WORLD_BASE : 1;
    this.width = Math.max(1, Math.round(width / this.step));
    this.height = Math.max(1, Math.round(height / this.step));
    const scale = startScaleFor(this.width);
    this.scale = scale;
    this.targetScale = scale;
    this.x = heroX / this.step;
    this.y = heroY / this.step;
    this.targetX = this.x;
    this.targetY = this.y;
    this.follow = true;
  }

  /** Let zoom continue past the flat map into the globe band, or pull back to the map. */
  setGlobeZoom(on: boolean): void {
    if (this.globeZoom === on) return;
    this.globeZoom = on;
    if (!on) {
      this.targetScale = Math.max(this.targetScale, minScaleFor(this.width));
      this.scale = Math.max(this.scale, minScaleFor(this.width));
    }
  }

  /** Smallest scale the camera allows right now. */
  minScale(): number {
    return this.globeZoom ? globeMinScaleFor(this.width) : minScaleFor(this.width);
  }

  /** Scale where the flat map hands over to the globe (`globeActive` below it). */
  globeSwitchScale(): number {
    return minScaleFor(this.width);
  }

  /** True while zoomed out past the flat map. */
  inGlobe(): boolean {
    return this.scale < minScaleFor(this.width) * (1 - 1e-6);
  }

  /** Scale for map pace and clock: the globe band reads as the furthest flat zoom. */
  mapScale(): number {
    return Math.max(this.scale, minScaleFor(this.width));
  }

  /** Whether this map wraps east–west (planet chunks do not). */
  get wrapsX(): boolean {
    return this.wraps;
  }

  private edgeX(x: number): number {
    return this.wraps ? wrapX(x, this.width) : clamp(x, 0, this.width);
  }

  /** Map width in map cells (192 on today's worlds). */
  cellsWide(): number {
    return this.width;
  }

  zoomAt(sx: number, sy: number, factor: number, viewW: number, viewH: number): void {
    const next = clamp(this.targetScale * factor, this.minScale(), MAP_ZOOM_CAP);
    const before = this.follow ? null : this.screenToWorld(sx, sy, viewW, viewH);
    this.targetScale = next;
    this.scale += (next - this.scale) * ZOOM_CATCH;
    if (!before) {
      this.zoomPivot = null;
      return;
    }
    this.zoomPivot = { wx: before.x, wy: before.y, sx, sy, viewW, viewH };
    this.holdZoomPivot();
  }

  panPixels(dx: number, dy: number): void {
    this.follow = false;
    this.zoomPivot = null;
    const tilesX = dx / (this.scale * TILE);
    const tilesY = dy / (this.scale * TILE);
    this.x = this.edgeX(this.x - tilesX);
    this.y = clampLatY(this.y - tilesY, this.height);
    this.targetX = this.x;
    this.targetY = this.y;
  }

  /** Ease toward a scale. The current scale catches up in `update`. */
  easeScale(scale: number): void {
    this.targetScale = clamp(scale, this.minScale(), MAP_ZOOM_CAP);
  }

  lookAt(x: number, y: number, scale?: number): void {
    this.follow = false;
    this.zoomPivot = null;
    this.targetX = this.edgeX(x / this.step);
    this.targetY = clampLatY(y / this.step, this.height);
    this.x = this.targetX;
    this.y = this.targetY;
    if (scale) {
      this.targetScale = clamp(scale, this.minScale(), MAP_ZOOM_CAP);
      this.scale = this.targetScale;
    }
  }

  update(dt: number, heroX: number, heroY: number): void {
    if (this.follow) {
      this.zoomPivot = null;
      this.targetX = heroX / this.step;
      this.targetY = heroY / this.step;
    }
    const zoomT = 1 - Math.exp(-ZOOM_FOLLOW * dt);
    const panT = 1 - Math.exp(-PAN_FOLLOW * dt);
    this.scale += (this.targetScale - this.scale) * zoomT;
    if (Math.abs(this.scale - this.targetScale) <= this.targetScale * 0.0015) {
      this.scale = this.targetScale;
    }
    if (this.zoomPivot && !this.follow) {
      this.holdZoomPivot();
      return;
    }
    this.x = this.wraps
      ? lerpWrapX(this.x, this.targetX, panT, this.width)
      : this.x + (this.targetX - this.x) * panT;
    this.y = clampLatY(this.y + (this.targetY - this.y) * panT, this.height);
  }

  /** Keep the world point from the last free zoom under the cursor while scale eases. */
  private holdZoomPivot(): void {
    const pivot = this.zoomPivot;
    if (!pivot || this.scale <= 0) return;
    this.targetX = this.edgeX(pivot.wx - (pivot.sx - pivot.viewW / 2) / (this.scale * TILE));
    this.targetY = clampLatY(
      pivot.wy - (pivot.sy - pivot.viewH / 2) / (this.scale * TILE),
      this.height,
    );
    this.x = this.targetX;
    this.y = this.targetY;
  }

  screenToWorld(sx: number, sy: number, viewW: number, viewH: number): { x: number; y: number } {
    return {
      x: this.edgeX(this.x + (sx - viewW / 2) / (this.scale * TILE)),
      y: this.y + (sy - viewH / 2) / (this.scale * TILE),
    };
  }

  state(): CameraState {
    return {
      x: this.x,
      y: this.y,
      scale: this.scale,
      targetX: this.targetX,
      targetY: this.targetY,
      targetScale: this.targetScale,
      followPlayer: this.follow,
    };
  }
}
