/**
 * Per-building role names on the world map.
 *
 * The C2 overlay drew a glyph for every building in world space, with a font
 * size that stayed at least 8px in that space. The camera then scaled the
 * canvas, so at map zoom a whole town was a few pixels and the letters stacked
 * into a black scribble on the icon. Names are screen-space instead, and only
 * once the buildings are far enough apart to read. Closer than that, the one
 * label is the hover tooltip.
 */
import { fineToDisplay } from '../../core/world/map-grid';
import { settlementPlan } from '../../core/world/layout-v2';
import { usesLayoutV3 } from '../../core/world/layout-v3';
import { TILE, ZONE_SCALE, type CameraState, type WorldData } from '../../core/world/models';
import { pixelSnapScale } from './map-camera';

/** Median gap, in screen pixels, before a settlement may show any name. */
export const LABEL_SPREAD_PX = 18;

const PAD_X = 6;
const PAD_Y = 3;
const LIFT = 6;
const FONT = '13px monospace';
const TEXT_H = 14;

export interface ScreenMark {
  text: string;
  x: number;
  y: number;
}

export interface PlacedLabel {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

function rectsOverlap(a: PlacedLabel, b: PlacedLabel): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] ?? 0;
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

/**
 * Labels for one settlement. A pile (median nearest neighbour under
 * `spreadPx`) draws nothing. Otherwise each name sits above its building,
 * and any rect that hits one already accepted is skipped.
 */
export function placeBuildingLabels(
  marks: readonly ScreenMark[],
  measure: (text: string) => { w: number; h: number },
  spreadPx = LABEL_SPREAD_PX,
): PlacedLabel[] {
  const usable = marks.filter((mark) => mark.text.trim().length > 0);
  if (!usable.length) return [];
  if (usable.length > 1) {
    const gaps: number[] = [];
    for (let i = 0; i < usable.length; i++) {
      let best = Number.POSITIVE_INFINITY;
      const a = usable[i]!;
      for (let j = 0; j < usable.length; j++) {
        if (i === j) continue;
        const b = usable[j]!;
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        if (dist < best) best = dist;
      }
      if (best < Number.POSITIVE_INFINITY) gaps.push(best);
    }
    if (median(gaps) < spreadPx) return [];
  }
  const placed: PlacedLabel[] = [];
  for (const mark of usable) {
    const size = measure(mark.text);
    const w = size.w + PAD_X * 2;
    const h = Math.max(size.h, 1) + PAD_Y * 2;
    const label: PlacedLabel = {
      text: mark.text,
      x: mark.x - w / 2,
      y: mark.y - h - LIFT,
      w,
      h,
    };
    if (placed.some((other) => rectsOverlap(label, other))) continue;
    placed.push(label);
  }
  return placed;
}

function buildingScreen(
  cx: number,
  cy: number,
  mapStep: number,
  camera: CameraState,
  viewW: number,
  viewH: number,
  scale: number,
): { x: number; y: number } {
  const wx = fineToDisplay(cx / ZONE_SCALE, mapStep);
  const wy = fineToDisplay(cy / ZONE_SCALE, mapStep);
  const ox = Math.round(viewW / 2 - camera.x * TILE * scale);
  const oy = Math.round(viewH / 2 - camera.y * TILE * scale);
  return { x: ox + wx * TILE * scale, y: oy + wy * TILE * scale };
}

/** Screen-space role names. Empty at overworld zoom, where buildings share the icon. */
export function drawBuildingRoleLabels(
  ctx: CanvasRenderingContext2D,
  world: WorldData,
  camera: CameraState,
  mapStep: number,
  viewW: number,
  viewH: number,
): void {
  if (world.settings.settlementGen !== 3) return;
  const scale = pixelSnapScale(camera.scale);
  const reach = Math.max(viewW, viewH) / Math.max(0.25, scale) / TILE;
  const marksByPlace: ScreenMark[][] = [];
  for (const node of world.nodes) {
    if (!usesLayoutV3(world, node)) continue;
    if (node.settlementClass === 'capital' || node.settlementClass === 'metropolis') continue;
    const dx = fineToDisplay(node.cx, mapStep) - camera.x;
    const dy = fineToDisplay(node.cy, mapStep) - camera.y;
    if (Math.hypot(dx, dy) > fineToDisplay(node.radius, mapStep) + reach) continue;
    const span = fineToDisplay(node.radius, mapStep) * 2 * TILE * scale;
    if (span < LABEL_SPREAD_PX * 4) continue;
    const plan = settlementPlan(world, node);
    if (!plan || plan.layoutGen !== 3) continue;
    const marks: ScreenMark[] = [];
    for (const building of plan.buildings) {
      if (!building.obb || !building.role) continue;
      const at = buildingScreen(
        building.obb.cx,
        building.obb.cy,
        mapStep,
        camera,
        viewW,
        viewH,
        scale,
      );
      if (at.x < -180 || at.y < -40 || at.x > viewW + 180 || at.y > viewH + 40) continue;
      const name = building.roleLabel ?? building.label;
      if (!name) continue;
      marks.push({ text: `${name} — ${node.name}`, x: at.x, y: at.y });
    }
    if (marks.length) marksByPlace.push(marks);
  }
  if (!marksByPlace.length) return;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.font = FONT;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const measure = (text: string) => ({ w: ctx.measureText(text).width, h: TEXT_H });
  for (const marks of marksByPlace) {
    for (const label of placeBuildingLabels(marks, measure)) {
      ctx.fillStyle = 'rgba(28, 24, 18, 0.92)';
      ctx.fillRect(label.x, label.y, label.w, label.h);
      ctx.fillStyle = '#f4ead8';
      ctx.fillText(label.text, label.x + PAD_X, label.y + label.h / 2);
    }
  }
  ctx.restore();
}
