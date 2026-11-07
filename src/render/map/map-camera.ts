import {
  MAP_ZOOM_CAP,
  TILE,
  clamp,
  clampLatY,
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
 * frames the world map, and the dive past the cap enters 3D.
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
  private width = 192;
  private height = 192;
  private zoomPivot: {
    wx: number;
    wy: number;
    sx: number;
    sy: number;
    viewW: number;
    viewH: number;
  } | null = null;

  frame(width: number, height: number, heroX: number, heroY: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    const scale = startScaleFor(this.width);
    this.scale = scale;
    this.targetScale = scale;
    this.x = heroX;
    this.y = heroY;
    this.targetX = heroX;
    this.targetY = heroY;
    this.follow = true;
  }

  zoomAt(sx: number, sy: number, factor: number, viewW: number, viewH: number): void {
    const next = clamp(this.targetScale * factor, minScaleFor(this.width), MAP_ZOOM_CAP);
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
    this.x = wrapX(this.x - tilesX, this.width);
    this.y = clampLatY(this.y - tilesY, this.height);
    this.targetX = this.x;
    this.targetY = this.y;
  }

  lookAt(x: number, y: number, scale?: number): void {
    this.follow = false;
    this.zoomPivot = null;
    this.targetX = wrapX(x, this.width);
    this.targetY = clampLatY(y, this.height);
    this.x = this.targetX;
    this.y = this.targetY;
    if (scale) {
      this.targetScale = clamp(scale, minScaleFor(this.width), MAP_ZOOM_CAP);
      this.scale = this.targetScale;
    }
  }

  update(dt: number, heroX: number, heroY: number): void {
    if (this.follow) {
      this.zoomPivot = null;
      this.targetX = heroX;
      this.targetY = heroY;
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
    this.x = lerpWrapX(this.x, this.targetX, panT, this.width);
    this.y = clampLatY(this.y + (this.targetY - this.y) * panT, this.height);
  }

  /** Keep the world point from the last free zoom under the cursor while scale eases. */
  private holdZoomPivot(): void {
    const pivot = this.zoomPivot;
    if (!pivot || this.scale <= 0) return;
    this.targetX = wrapX(pivot.wx - (pivot.sx - pivot.viewW / 2) / (this.scale * TILE), this.width);
    this.targetY = clampLatY(
      pivot.wy - (pivot.sy - pivot.viewH / 2) / (this.scale * TILE),
      this.height,
    );
    this.x = this.targetX;
    this.y = this.targetY;
  }

  screenToWorld(sx: number, sy: number, viewW: number, viewH: number): { x: number; y: number } {
    return {
      x: wrapX(this.x + (sx - viewW / 2) / (this.scale * TILE), this.width),
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
