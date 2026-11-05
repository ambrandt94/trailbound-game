import {
  MAX_SCALE,
  TILE,
  clamp,
  clampLatY,
  lerpWrapX,
  minScaleFor,
  startScaleFor,
  wrapX,
  type CameraState,
} from '../../core/world/models';

const ZOOM_FOLLOW = 14;
const PAN_FOLLOW = 11;

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
    const next = clamp(this.targetScale * factor, minScaleFor(this.width), MAX_SCALE);
    if (this.follow) {
      this.targetScale = next;
      this.scale += (next - this.scale) * 0.18;
      return;
    }
    const before = this.screenToWorld(sx, sy, viewW, viewH);
    this.targetScale = next;
    this.scale = next;
    this.targetX = wrapX(before.x - (sx - viewW / 2) / (next * TILE), this.width);
    this.targetY = clampLatY(before.y - (sy - viewH / 2) / (next * TILE), this.height);
    this.x = this.targetX;
    this.y = this.targetY;
  }

  panPixels(dx: number, dy: number): void {
    this.follow = false;
    const tilesX = dx / (this.scale * TILE);
    const tilesY = dy / (this.scale * TILE);
    this.x = wrapX(this.x - tilesX, this.width);
    this.y = clampLatY(this.y - tilesY, this.height);
    this.targetX = this.x;
    this.targetY = this.y;
  }

  lookAt(x: number, y: number, scale?: number): void {
    this.follow = false;
    this.targetX = wrapX(x, this.width);
    this.targetY = clampLatY(y, this.height);
    this.x = this.targetX;
    this.y = this.targetY;
    if (scale) {
      this.targetScale = clamp(scale, minScaleFor(this.width), MAX_SCALE);
      this.scale = this.targetScale;
    }
  }

  update(dt: number, heroX: number, heroY: number): void {
    if (this.follow) {
      this.targetX = heroX;
      this.targetY = heroY;
    }
    const zoomT = 1 - Math.exp(-ZOOM_FOLLOW * dt);
    const panT = 1 - Math.exp(-PAN_FOLLOW * dt);
    this.scale += (this.targetScale - this.scale) * zoomT;
    this.x = lerpWrapX(this.x, this.targetX, panT, this.width);
    this.y = clampLatY(this.y + (this.targetY - this.y) * panT, this.height);
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
