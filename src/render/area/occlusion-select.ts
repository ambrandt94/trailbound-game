/**
 * Cheap camera-occlusion picks. Bounds live in a spatial grid; a frame only
 * tests the cells the camera-to-player capsule and the near-camera sphere touch.
 * No triangle tests.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Aabb {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

export const OCCLUSION = {
  capsuleRadius: 1.25,
  cameraRadius: 1.75,
  fadeSeconds: 0.2,
  cellSize: 8,
  maxBuildingFades: 8,
  holeVisible: 0.14,
  visible: {
    canopy: 0.3,
    bush: 0.3,
    rock: 0.32,
    building: 0.3,
    trunk: 0.46,
  },
} as const;

export type OccRole = keyof typeof OCCLUSION.visible;

const ROLES: readonly OccRole[] = ['canopy', 'trunk', 'bush', 'rock', 'building'];

export interface OccCandidate {
  id: number;
  role: OccRole;
  bounds: Aabb;
}

export function isFadeRole(role: string): role is OccRole {
  return (ROLES as readonly string[]).includes(role);
}

/** Player, wagon, and NPC nodes stay solid even if a parent is an occluder. */
export function isProtectedNode(
  name: string,
  flags: { person?: boolean; npc?: boolean; wagon?: boolean },
): boolean {
  if (flags.person || flags.npc || flags.wagon) return true;
  const id = name.toLowerCase();
  return id === 'party-wagon' || id.includes('player') || id.includes('npc');
}

/**
 * Kit part role. Trunks are the first tree part. Small rocks, flowers, and
 * fences stay solid. Carts and wagons are not nature props.
 */
export function propOccluderRole(
  category: string,
  name: string,
  partIndex: number,
  w: number,
  d: number,
  h: number,
): OccRole | null {
  const cat = category || '';
  const id = name || '';
  if (cat === 'tree' || id.startsWith('tree_')) return partIndex <= 0 ? 'trunk' : 'canopy';
  if (cat === 'rock' || id.startsWith('rock_')) {
    return Math.max(w, d, h) >= 1.5 ? 'rock' : null;
  }
  if (cat === 'plant' || id.startsWith('bush_')) {
    if (/flower|grass_|lilypad|reeds_|beach_grass|mushroom_|crop_/.test(id)) return null;
    if (h > 0 && h < 0.6 && !id.startsWith('bush_')) return null;
    return 'bush';
  }
  return null;
}

export function expandAabb(box: Aabb, radius: number): Aabb {
  return {
    minX: box.minX - radius,
    minY: box.minY - radius,
    minZ: box.minZ - radius,
    maxX: box.maxX + radius,
    maxY: box.maxY + radius,
    maxZ: box.maxZ + radius,
  };
}

export function pointInsideAabb(point: Vec3, box: Aabb): boolean {
  return (
    point.x >= box.minX &&
    point.x <= box.maxX &&
    point.y >= box.minY &&
    point.y <= box.maxY &&
    point.z >= box.minZ &&
    point.z <= box.maxZ
  );
}

/** Distance from a point to an AABB, compared to a radius. */
export function pointNearAabb(point: Vec3, box: Aabb, radius: number): boolean {
  const x = Math.max(box.minX, Math.min(point.x, box.maxX));
  const y = Math.max(box.minY, Math.min(point.y, box.maxY));
  const z = Math.max(box.minZ, Math.min(point.z, box.maxZ));
  const dx = point.x - x;
  const dy = point.y - y;
  const dz = point.z - z;
  return dx * dx + dy * dy + dz * dz <= radius * radius + 1e-8;
}

/** Inclusive slab test. A zero-length segment hits when the point is inside. */
export function segmentHitsAabb(a: Vec3, b: Vec3, box: Aabb): boolean {
  const delta = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
  let t0 = 0;
  let t1 = 1;
  const axes = ['x', 'y', 'z'] as const;
  for (const axis of axes) {
    const origin = a[axis];
    const span = delta[axis];
    const min = axis === 'x' ? box.minX : axis === 'y' ? box.minY : box.minZ;
    const max = axis === 'x' ? box.maxX : axis === 'y' ? box.maxY : box.maxZ;
    if (Math.abs(span) < 1e-8) {
      if (origin < min || origin > max) return false;
      continue;
    }
    let enter = (min - origin) / span;
    let exit = (max - origin) / span;
    if (enter > exit) {
      const swap = enter;
      enter = exit;
      exit = swap;
    }
    if (enter > t0) t0 = enter;
    if (exit < t1) t1 = exit;
    if (t0 > t1) return false;
  }
  return true;
}

export function occludes(
  camera: Vec3,
  player: Vec3,
  bounds: Aabb,
  role: OccRole,
  capsuleRadius = OCCLUSION.capsuleRadius,
  cameraRadius = OCCLUSION.cameraRadius,
): boolean {
  if (role === 'building' && pointInsideAabb(camera, bounds) && pointInsideAabb(player, bounds)) {
    return false;
  }
  if (segmentHitsAabb(camera, player, expandAabb(bounds, capsuleRadius))) return true;
  return pointNearAabb(camera, bounds, cameraRadius);
}

/** Column-major 4×4, the layout of three.js Matrix4.elements. */
export function aabbFromMatrix(local: Aabb, elements: ArrayLike<number>): Aabb {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  const xs = [local.minX, local.maxX];
  const ys = [local.minY, local.maxY];
  const zs = [local.minZ, local.maxZ];
  for (const x of xs) {
    for (const y of ys) {
      for (const z of zs) {
        const wx =
          (elements[0] ?? 0) * x +
          (elements[4] ?? 0) * y +
          (elements[8] ?? 0) * z +
          (elements[12] ?? 0);
        const wy =
          (elements[1] ?? 0) * x +
          (elements[5] ?? 0) * y +
          (elements[9] ?? 0) * z +
          (elements[13] ?? 0);
        const wz =
          (elements[2] ?? 0) * x +
          (elements[6] ?? 0) * y +
          (elements[10] ?? 0) * z +
          (elements[14] ?? 0);
        if (wx < minX) minX = wx;
        if (wy < minY) minY = wy;
        if (wz < minZ) minZ = wz;
        if (wx > maxX) maxX = wx;
        if (wy > maxY) maxY = wy;
        if (wz > maxZ) maxZ = wz;
      }
    }
  }
  return { minX, minY, minZ, maxX, maxY, maxZ };
}

function hashCell(x: number, y: number, z: number): number {
  return (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)) | 0;
}

export class OccluderGrid {
  private readonly cell: number;
  private readonly buckets = new Map<number, number[]>();
  private readonly items: OccCandidate[] = [];
  private seen = new Uint32Array(0);
  private stamp = 1;

  constructor(cellSize = OCCLUSION.cellSize) {
    this.cell = cellSize > 0 ? cellSize : OCCLUSION.cellSize;
  }

  clear(): void {
    this.buckets.clear();
    this.items.length = 0;
    this.seen = new Uint32Array(0);
    this.stamp = 1;
  }

  insert(item: OccCandidate): void {
    const index = this.items.length;
    this.items.push(item);
    const size = this.cell;
    const x0 = Math.floor(item.bounds.minX / size);
    const x1 = Math.floor(item.bounds.maxX / size);
    const y0 = Math.floor(item.bounds.minY / size);
    const y1 = Math.floor(item.bounds.maxY / size);
    const z0 = Math.floor(item.bounds.minZ / size);
    const z1 = Math.floor(item.bounds.maxZ / size);
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        for (let z = z0; z <= z1; z++) {
          const key = hashCell(x, y, z);
          const list = this.buckets.get(key);
          if (list) list.push(index);
          else this.buckets.set(key, [index]);
        }
      }
    }
  }

  /** Ids whose bounds meet the capsule or the camera sphere. */
  collect(
    camera: Vec3,
    player: Vec3,
    capsuleRadius = OCCLUSION.capsuleRadius,
    cameraRadius = OCCLUSION.cameraRadius,
  ): number[] {
    const hits: number[] = [];
    if (this.items.length === 0) return hits;
    if (this.seen.length < this.items.length) this.seen = new Uint32Array(this.items.length);
    this.stamp += 1;
    if (this.stamp >= 0xfffffffe) {
      this.seen.fill(0);
      this.stamp = 1;
    }
    const pad = Math.max(capsuleRadius, cameraRadius);
    const size = this.cell;
    const minX = Math.floor((Math.min(camera.x, player.x) - pad) / size);
    const maxX = Math.floor((Math.max(camera.x, player.x) + pad) / size);
    const minY = Math.floor((Math.min(camera.y, player.y) - pad) / size);
    const maxY = Math.floor((Math.max(camera.y, player.y) + pad) / size);
    const minZ = Math.floor((Math.min(camera.z, player.z) - pad) / size);
    const maxZ = Math.floor((Math.max(camera.z, player.z) + pad) / size);
    const mark = this.stamp;
    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        for (let z = minZ; z <= maxZ; z++) {
          const list = this.buckets.get(hashCell(x, y, z));
          if (!list) continue;
          for (const index of list) {
            if (this.seen[index] === mark) continue;
            this.seen[index] = mark;
            const item = this.items[index];
            if (!item) continue;
            if (occludes(camera, player, item.bounds, item.role, capsuleRadius, cameraRadius)) {
              hits.push(item.id);
            }
          }
        }
      }
    }
    return hits;
  }
}

/** Linear approach. A full 0→1 change takes `seconds`. */
export function stepFade(current: number, target: number, dt: number, seconds: number): number {
  if (!(dt > 0) || !(seconds > 0)) return current;
  const step = dt / seconds;
  const delta = target - current;
  if (Math.abs(delta) <= step) return target;
  return current + Math.sign(delta) * step;
}

/** `fade` 0 is solid. `fade` 1 is that role's see-through visibility. */
export function visibilityFor(role: OccRole, fade: number): number {
  const floor = OCCLUSION.visible[role];
  const t = Math.max(0, Math.min(1, fade));
  return 1 + (floor - 1) * t;
}

/** `fades[i]` moves toward 1 when `active` contains i, else toward 0. */
export function advanceFades(fades: Float32Array, active: readonly number[], dt: number): boolean {
  const on = new Uint8Array(fades.length);
  for (const id of active) {
    if (id >= 0 && id < on.length) on[id] = 1;
  }
  let changed = false;
  for (let i = 0; i < fades.length; i++) {
    const next = stepFade(fades[i] ?? 0, on[i] ? 1 : 0, dt, OCCLUSION.fadeSeconds);
    if (next !== fades[i]) {
      fades[i] = next;
      changed = true;
    }
  }
  return changed;
}
