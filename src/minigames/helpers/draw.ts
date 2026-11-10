/** Parchment and wood, kept off pure black so the popup matches the camp UI. */

export const INK = '#3a2a1c';
export const WOOD = '#8d5a32';
export const WOOD_DARK = '#6b4124';
export const PARCHMENT = '#f4e2c4';
export const PARCHMENT_DEEP = '#e7d0a4';
export const MOSS = '#3f7d55';
export const BERRY = '#c45c32';
export const CREAM = '#fff8ec';
export const WATER = '#4a9eb2';

/** Softball Gold is drawn on its 16px grid. Sizes snap to multiples of 16. */
const SOFTBALL = '"Softball Gold", ui-monospace, monospace';

function softballFont(size: number): string {
  const snapped = Math.max(16, Math.round(size / 16) * 16);
  return `${snapped}px ${SOFTBALL}`;
}

export function paintField(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  const sky = ctx.createLinearGradient(0, 0, 0, height);
  sky.addColorStop(0, '#f7edd8');
  sky.addColorStop(0.55, PARCHMENT);
  sky.addColorStop(1, '#d7e2c4');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = 'rgba(141, 90, 50, 0.18)';
  ctx.fillRect(0, height - 18, width, 18);
}

export function drawLabel(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  size = 16,
  color = INK,
): void {
  const snapped = Math.max(16, Math.round(size / 16) * 16);
  ctx.fillStyle = color;
  ctx.font = softballFont(size);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(text, x, y - snapped * (3 / 16));
}

export function drawCenter(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  size = 16,
  color = INK,
): void {
  const snapped = Math.max(16, Math.round(size / 16) * 16);
  ctx.fillStyle = color;
  ctx.font = softballFont(snapped);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y + snapped / 32);
}

/** Sweep track. The notch is the strike window. `phase` is 0..1. */
export function drawTrack(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  phase: number,
  winStart: number,
  winEnd: number,
  hot: boolean,
): void {
  ctx.fillStyle = WOOD_DARK;
  ctx.fillRect(x - 3, y - 3, width + 6, height + 6);
  ctx.fillStyle = '#f1d7ae';
  ctx.fillRect(x, y, width, height);
  const notchX = x + winStart * width;
  const notchW = Math.max(4, (winEnd - winStart) * width);
  ctx.fillStyle = hot ? '#7dbe78' : MOSS;
  ctx.fillRect(notchX, y, notchW, height);
  const marker = x + Math.max(0, Math.min(1, phase)) * width;
  ctx.fillStyle = BERRY;
  ctx.fillRect(marker - 3, y - 6, 6, height + 12);
}

export function drawPips(
  ctx: CanvasRenderingContext2D,
  hits: number,
  total: number,
  x: number,
  y: number,
): void {
  for (let i = 0; i < total; i++) {
    ctx.fillStyle = i < hits ? BERRY : '#e7d3b0';
    ctx.strokeStyle = WOOD;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x + i * 22, y, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
}

export function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}
