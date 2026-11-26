/**
 * Debug role colours on the world map: rotated footprints, curved streets,
 * the wall line, and a glyph on each building. Player hover labels are drawn
 * separately. This layer is off unless `?roles=1` or the World Gen checkbox.
 */
import { ROLE_STYLE, type BuildingRole, type RoleGroup } from '../../core/world/building-roles';
import { settlementPlan } from '../../core/world/layout-v2';
import { fineToDisplay } from '../../core/world/map-grid';
import { TILE, nodeContaining, type CameraState, type WorldData } from '../../core/world/models';

const GROUPS: RoleGroup[] = ['dwelling', 'trade', 'craft', 'faith', 'civic', 'martial', 'none'];

export function drawRoleLegend(ctx: CanvasRenderingContext2D, viewW: number): void {
  const x = viewW - 168;
  const y = 16;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = 'rgba(28, 24, 18, 0.88)';
  ctx.fillRect(x, y, 152, 22 + GROUPS.length * 18);
  ctx.font = '12px monospace';
  ctx.fillStyle = '#f0e2c4';
  ctx.fillText('Roles', x + 10, y + 16);
  GROUPS.forEach((group, index) => {
    const sample = Object.values(ROLE_STYLE).find((style) => style.group === group);
    ctx.fillStyle = sample?.colour ?? '#a3a096';
    ctx.fillRect(x + 10, y + 26 + index * 18, 12, 12);
    ctx.fillStyle = '#f4ead8';
    ctx.fillText(group, x + 28, y + 36 + index * 18);
  });
  ctx.restore();
}

export function drawRoleOverlay(
  ctx: CanvasRenderingContext2D,
  world: WorldData,
  camera: CameraState,
  mapStep: number,
  viewW: number,
  viewH: number,
): void {
  if (world.settings.settlementGen !== 3) return;
  const margin = Math.max(viewW, viewH) / Math.max(0.2, camera.scale) / TILE;
  for (const node of world.nodes) {
    if (
      !node.settlementClass ||
      node.settlementClass === 'capital' ||
      node.settlementClass === 'metropolis'
    ) {
      continue;
    }
    const dx = fineToDisplay(node.cx, mapStep) - camera.x;
    const dy = fineToDisplay(node.cy, mapStep) - camera.y;
    if (Math.hypot(dx, dy) > fineToDisplay(node.radius, mapStep) + margin) continue;
    const plan = settlementPlan(world, node);
    if (!plan || plan.layoutGen !== 3) continue;
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (const road of plan.roads) {
      if (road.points.length < 2) continue;
      ctx.beginPath();
      road.points.forEach((p, i) => {
        const x = fineToDisplay(p[0] / 8, mapStep) * TILE;
        const y = fineToDisplay(p[1] / 8, mapStep) * TILE;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.strokeStyle = road.rank === 1 ? 'rgba(90, 72, 48, 0.9)' : 'rgba(120, 98, 64, 0.75)';
      ctx.lineWidth = (road.rank === 1 ? 2.4 : 1.3) / Math.max(0.4, camera.scale);
      ctx.stroke();
    }
    const wall = plan.wallLoop ?? [];
    if (wall.length > 2) {
      ctx.beginPath();
      wall.forEach((p, i) => {
        const x = fineToDisplay(p[0] / 8, mapStep) * TILE;
        const y = fineToDisplay(p[1] / 8, mapStep) * TILE;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.strokeStyle = 'rgba(72, 64, 52, 0.95)';
      ctx.lineWidth = 1.6 / Math.max(0.4, camera.scale);
      ctx.stroke();
    }
    for (const building of plan.buildings) {
      const obb = building.obb;
      if (!obb) continue;
      const colour =
        building.roleColour ?? ROLE_STYLE[(building.role as BuildingRole) || 'unassigned'].colour;
      const rad = (obb.yawDeg * Math.PI) / 180;
      const fx = Math.sin(rad);
      const fy = Math.cos(rad);
      const rx = fy;
      const ry = -fx;
      const hw = obb.w / 2;
      const hd = obb.d / 2;
      const corners = [
        [1, 1],
        [-1, 1],
        [-1, -1],
        [1, -1],
      ].map(([sx, sy]) => {
        const mx = obb.cx + rx * hw * sx! + fx * hd * sy!;
        const my = obb.cy + ry * hw * sx! + fy * hd * sy!;
        return [
          fineToDisplay(mx / 8, mapStep) * TILE,
          fineToDisplay(my / 8, mapStep) * TILE,
        ] as const;
      });
      ctx.beginPath();
      corners.forEach((p, i) => (i === 0 ? ctx.moveTo(p[0], p[1]) : ctx.lineTo(p[0], p[1])));
      ctx.closePath();
      ctx.fillStyle = colour;
      ctx.globalAlpha = 0.82;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = 'rgba(42, 32, 22, 0.85)';
      ctx.lineWidth = 1 / Math.max(0.4, camera.scale);
      ctx.stroke();
      const gx = fineToDisplay(obb.cx / 8, mapStep) * TILE;
      const gy = fineToDisplay(obb.cy / 8, mapStep) * TILE;
      const glyph = ROLE_STYLE[(building.role as BuildingRole) || 'unassigned'].glyph;
      ctx.fillStyle = '#2a2418';
      ctx.font = `${Math.max(8, 11 / Math.max(0.8, camera.scale / 2))}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(glyph, gx, gy);
    }
    ctx.restore();
  }
}

/** Readable plan of the settlement under the hero. The world map's closest zoom is still only a few pixels per building. */
export function drawRoleInset(
  ctx: CanvasRenderingContext2D,
  world: WorldData,
  heroX: number,
  heroY: number,
  viewW: number,
  viewH: number,
): void {
  if (world.settings.settlementGen !== 3) return;
  const node = nodeContaining(world.nodes, heroX, heroY);
  if (
    !node?.settlementClass ||
    node.settlementClass === 'capital' ||
    node.settlementClass === 'metropolis'
  )
    return;
  const plan = settlementPlan(world, node);
  if (!plan || plan.layoutGen !== 3 || !plan.buildings.length) return;
  const box = { x: viewW - 336, y: viewH - 292, w: 320, h: 250 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const building of plan.buildings) {
    const obb = building.obb;
    if (!obb) continue;
    minX = Math.min(minX, obb.cx - obb.w);
    minY = Math.min(minY, obb.cy - obb.d);
    maxX = Math.max(maxX, obb.cx + obb.w);
    maxY = Math.max(maxY, obb.cy + obb.d);
  }
  if (!Number.isFinite(minX)) return;
  const pad = 8;
  const span = Math.max(12, maxX - minX, maxY - minY);
  const scale = (box.w - pad * 2) / span;
  const toX = (mx: number) => box.x + pad + (mx - minX) * scale;
  const toY = (my: number) => box.y + pad + 16 + (my - minY) * scale;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = 'rgba(28, 24, 18, 0.9)';
  ctx.fillRect(box.x, box.y, box.w, box.h);
  ctx.fillStyle = '#f4ead8';
  ctx.font = '12px monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(
    `${node.name} · ${plan.culture ?? 'human'} · ${plan.biomeSet ?? ''}`,
    box.x + 8,
    box.y + 6,
  );
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (const road of plan.roads) {
    if (road.points.length < 2) continue;
    ctx.beginPath();
    road.points.forEach((p, i) => {
      const x = toX(p[0]);
      const y = toY(p[1]);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = road.rank === 1 ? '#c4a574' : '#8d6b45';
    ctx.lineWidth = road.rank === 1 ? 3 : 1.5;
    ctx.stroke();
  }
  const wall = plan.wallLoop ?? [];
  if (wall.length > 2) {
    ctx.beginPath();
    wall.forEach((p, i) =>
      i === 0 ? ctx.moveTo(toX(p[0]), toY(p[1])) : ctx.lineTo(toX(p[0]), toY(p[1])),
    );
    ctx.strokeStyle = '#6b4428';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
  for (const building of plan.buildings) {
    const obb = building.obb;
    if (!obb) continue;
    const colour = building.roleColour ?? '#a3a096';
    const rad = (obb.yawDeg * Math.PI) / 180;
    const fx = Math.sin(rad);
    const fy = Math.cos(rad);
    const hw = obb.w / 2;
    const hd = obb.d / 2;
    ctx.beginPath();
    for (const [sx, sy] of [
      [1, 1],
      [-1, 1],
      [-1, -1],
      [1, -1],
    ] as const) {
      const mx = obb.cx + fy * hw * sx + fx * hd * sy;
      const my = obb.cy + -fx * hw * sx + fy * hd * sy;
      const x = toX(mx);
      const y = toY(my);
      if (sx === 1 && sy === 1) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = colour;
    ctx.fill();
    ctx.strokeStyle = '#2a2418';
    ctx.lineWidth = 1;
    ctx.stroke();
    const glyph = ROLE_STYLE[(building.role as BuildingRole) || 'unassigned'].glyph;
    ctx.fillStyle = '#2a2418';
    ctx.font = '9px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(glyph, toX(obb.cx), toY(obb.cy));
  }
  ctx.restore();
}
