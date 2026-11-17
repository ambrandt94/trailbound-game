/**
 * Map clicks that route the caravan. Pan, wheel, and pinch stay in
 * `input/map-input`; this only listens for a short, still press so a drag
 * never sets a route. Shift+click appends a waypoint.
 */
import type { CaravanState, CaravanTarget } from '../core/sim/caravan';
import { hasRoute } from '../core/sim/caravan';
import { MAP_ZOOM_CAP, TILE, nodeContaining, waterAt, type WorldData } from '../core/world/models';
import { tierForKind } from '../core/world/settlement-tiers';

/**
 * "Show route" never frames closer than this. Below 0.45 the map drops POI
 * name pills (see `drawPois`), so the route line reads cleanly.
 */
export const ROUTE_FIT_MAX_SCALE = 0.42;
/** A press that moves less than this many CSS pixels is a click. */
const CLICK_SLOP_PX = 6;
const CLICK_MAX_MS = 450;

export function attachRouteClicks(
  canvas: HTMLElement,
  onClick: (sx: number, sy: number, append: boolean) => void,
): () => void {
  const downs = new Map<number, { x: number; y: number; t: number }>();
  let multi = false;
  const local = (event: PointerEvent): { x: number; y: number } => {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  const onDown = (event: PointerEvent): void => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    downs.set(event.pointerId, { ...local(event), t: performance.now() });
    if (downs.size > 1) multi = true;
  };
  const onUp = (event: PointerEvent): void => {
    const down = downs.get(event.pointerId);
    downs.delete(event.pointerId);
    if (!down) return;
    const wasMulti = multi;
    if (downs.size === 0) multi = false;
    if (wasMulti) return;
    const at = local(event);
    const moved = Math.hypot(at.x - down.x, at.y - down.y);
    if (moved > CLICK_SLOP_PX || performance.now() - down.t > CLICK_MAX_MS) return;
    onClick(at.x, at.y, event.shiftKey);
  };
  const onCancel = (event: PointerEvent): void => {
    downs.delete(event.pointerId);
    if (downs.size === 0) multi = false;
  };
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onCancel);
  return () => {
    canvas.removeEventListener('pointerdown', onDown);
    canvas.removeEventListener('pointerup', onUp);
    canvas.removeEventListener('pointercancel', onCancel);
  };
}

/**
 * What a click at fine-tile `(x, y)` routes to. A settlement or named place
 * snaps to its centre, a POI within `pickTiles` snaps to the site, and any
 * other land is that tile's centre. Open water returns null.
 */
export function resolveRouteTarget(
  world: WorldData,
  x: number,
  y: number,
  pickTiles: number,
): CaravanTarget | null {
  const node = nodeContaining(world.nodes, x, y);
  if (node) {
    return {
      x: node.cx,
      y: node.cy,
      name: node.name,
      placeId: tierForKind(node.kind) ? node.id : null,
    };
  }
  let best: { x: number; y: number; name: string } | null = null;
  let bestD = Infinity;
  for (const poi of world.pois) {
    const d = Math.hypot(poi.x - x, poi.y - y);
    const reach = Math.max(poi.radius, pickTiles);
    if (d <= reach && d < bestD) {
      best = { x: poi.x, y: poi.y, name: poi.name };
      bestD = d;
    }
  }
  if (best && !waterAt(world, best.x, best.y)) {
    return { x: best.x, y: best.y, name: best.name, placeId: null };
  }
  if (waterAt(world, x, y)) return null;
  return { x: Math.floor(x) + 0.5, y: Math.floor(y) + 0.5, name: null, placeId: null };
}

/**
 * Camera centre (display tiles) and scale that fit the caravan and its whole
 * route, with a margin for the HUD. Null without a route.
 */
export function routeFrame(
  caravan: CaravanState,
  step: number,
  viewW: number,
  viewH: number,
): { x: number; y: number; scale: number } | null {
  if (!hasRoute(caravan) || !(viewW > 0) || !(viewH > 0)) return null;
  const s = step > 0 ? step : 1;
  let x0 = caravan.x;
  let x1 = caravan.x;
  let y0 = caravan.y;
  let y1 = caravan.y;
  const route = caravan.route;
  for (let i = 0; i + 1 < route.length; i += 2) {
    x0 = Math.min(x0, route[i]!);
    x1 = Math.max(x1, route[i]!);
    y0 = Math.min(y0, route[i + 1]!);
    y1 = Math.max(y1, route[i + 1]!);
  }
  const spanX = Math.max(4, (x1 - x0) / s);
  const spanY = Math.max(4, (y1 - y0) / s);
  const scale = Math.min((viewW * 0.5) / (spanX * TILE), (viewH * 0.6) / (spanY * TILE));
  return {
    x: (x0 + x1) / 2 / s,
    y: (y0 + y1) / 2 / s,
    scale: Math.min(MAP_ZOOM_CAP, ROUTE_FIT_MAX_SCALE, scale),
  };
}
