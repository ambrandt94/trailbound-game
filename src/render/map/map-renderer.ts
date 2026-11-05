import { cellColor } from './grid';

export interface MapDrawState {
  seed: number;
  heroX: number;
  heroY: number;
  heroYaw: number;
  townX: number;
  townY: number;
  townName: string;
}

const VIEW_WORLD = 14;

/**
 * Placeholder overworld. A seeded flat grid, a town marker, and a hero dot.
 * The real Canvas2D map port replaces this in G1; the class stays resident
 * across 3D visits so the return does not rebuild it.
 */
export class MapRenderer {
  private disposed = false;

  constructor(private readonly canvas: HTMLCanvasElement) {}

  draw(state: MapDrawState): void {
    if (this.disposed) return;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    const cssW = this.canvas.clientWidth;
    const cssH = this.canvas.clientHeight;
    if (cssW < 2 || cssH < 2) return;
    const dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
    const bufferW = Math.floor(cssW * dpr);
    const bufferH = Math.floor(cssH * dpr);
    if (this.canvas.width !== bufferW || this.canvas.height !== bufferH) {
      this.canvas.width = bufferW;
      this.canvas.height = bufferH;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#c9d7a4';
    ctx.fillRect(0, 0, cssW, cssH);

    const scale = cssW / VIEW_WORLD;
    const viewH = cssH / scale;
    const toX = (worldX: number) => cssW / 2 + (worldX - state.heroX) * scale;
    const toY = (worldY: number) => cssH / 2 + (worldY - state.heroY) * scale;

    const i0 = Math.floor(state.heroX - VIEW_WORLD / 2 - 1);
    const i1 = Math.ceil(state.heroX + VIEW_WORLD / 2 + 1);
    const j0 = Math.floor(state.heroY - viewH / 2 - 1);
    const j1 = Math.ceil(state.heroY + viewH / 2 + 1);

    for (let i = i0; i < i1; i += 1) {
      for (let j = j0; j < j1; j += 1) {
        ctx.fillStyle = cellColor(i, j, state.seed);
        ctx.fillRect(toX(i), toY(j), scale + 0.5, scale + 0.5);
      }
    }

    ctx.strokeStyle = 'rgba(70, 90, 52, 0.18)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = i0; i <= i1; i += 1) {
      ctx.moveTo(toX(i), toY(j0));
      ctx.lineTo(toX(i), toY(j1));
    }
    for (let j = j0; j <= j1; j += 1) {
      ctx.moveTo(toX(i0), toY(j));
      ctx.lineTo(toX(i1), toY(j));
    }
    ctx.stroke();

    const townX = toX(state.townX);
    const townY = toY(state.townY);
    ctx.fillStyle = '#ead9b4';
    ctx.beginPath();
    ctx.arc(townX, townY, scale * 0.95, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#f3e6cf';
    ctx.fillRect(townX - scale * 0.34, townY - scale * 0.08, scale * 0.68, scale * 0.5);
    ctx.beginPath();
    ctx.moveTo(townX - scale * 0.48, townY - scale * 0.05);
    ctx.lineTo(townX, townY - scale * 0.48);
    ctx.lineTo(townX + scale * 0.48, townY - scale * 0.05);
    ctx.closePath();
    ctx.fillStyle = '#c4532c';
    ctx.fill();
    ctx.fillStyle = '#6a4636';
    ctx.fillRect(townX - scale * 0.08, townY + scale * 0.12, scale * 0.16, scale * 0.28);

    ctx.font = '600 15px Candara, "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#3a2e24';
    ctx.fillText(state.townName, townX, townY - scale * 0.7);

    const heroX = toX(state.heroX);
    const heroY = toY(state.heroY);
    const radius = Math.max(8, scale * 0.28);
    ctx.beginPath();
    ctx.arc(heroX, heroY, radius, 0, Math.PI * 2);
    ctx.fillStyle = '#f7f3ea';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#2c261f';
    ctx.stroke();
    const noseX = Math.sin(state.heroYaw);
    const noseY = -Math.cos(state.heroYaw);
    ctx.beginPath();
    ctx.moveTo(heroX + noseX * radius * 1.7, heroY + noseY * radius * 1.7);
    ctx.lineTo(heroX + noseY * radius * 0.45, heroY - noseX * radius * 0.45);
    ctx.lineTo(heroX - noseY * radius * 0.45, heroY + noseX * radius * 0.45);
    ctx.closePath();
    ctx.fillStyle = '#2c261f';
    ctx.fill();
  }

  dispose(): void {
    this.disposed = true;
  }

  get isDisposed(): boolean {
    return this.disposed;
  }
}
