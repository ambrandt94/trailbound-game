import { hasRoute, isRolling, pointAlong } from '../core/sim/caravan';
import {
  CONVOY_LOOKAHEAD_M,
  convoyMps,
  convoyNeedsRecut,
  localToTile,
  mapYawToArea,
  areaYawToMap,
  metresToTiles,
  tileToLocal,
} from '../core/sim/convoy';
import type { CaravanEvent } from '../core/sim/caravan';
import type { ConvoyHandoff, WorldState } from '../core/state/world-state';
import type { ConvoyFrame } from '../render/area/area-renderer';

/**
 * Drives the caravan through a convoy area. The world caravan is the one
 * source of truth: each frame it rolls by the wagon's metres, and the 3D
 * wagon is drawn where the caravan now stands, in this window's metres.
 */
export class ConvoyDriver {
  private speed = 0;

  constructor(
    private readonly world: () => WorldState,
    readonly handoff: ConvoyHandoff,
  ) {}

  /** Advance the caravan for `dt` real seconds of 3D time. */
  step(dt: number): CaravanEvent[] {
    const world = this.world();
    this.speed = 0;
    if (!(dt > 0) || !isRolling(world.caravan)) return world.takeCaravanEvents();
    const metres = convoyMps(world.caravanSpeedAt()) * dt;
    const units = world.rollConvoy(metresToTiles(metres));
    this.speed = units > 0 ? metres / dt : 0;
    return world.takeCaravanEvents();
  }

  /** Wagon pose in area metres for the renderer. */
  frame(): ConvoyFrame {
    const caravan = this.world().caravan;
    const at = tileToLocal(this.handoff.frame, caravan.x, caravan.y);
    return { x: at.x, z: at.z, yaw: mapYawToArea(caravan.yaw), speed: this.speed };
  }

  /** The wagon is close to the playable edge and the route goes on. */
  needsRecut(): boolean {
    if (!hasRoute(this.world().caravan)) return false;
    return convoyNeedsRecut(this.frame(), this.handoff.bounds);
  }

  /** Where the next window should centre: ahead of the wagon along the route. */
  recutCentre(): { x: number; y: number } {
    const caravan = this.world().caravan;
    if (!hasRoute(caravan)) return { x: caravan.x, y: caravan.y };
    const ahead = Math.min(caravan.length, caravan.along + metresToTiles(CONVOY_LOOKAHEAD_M));
    const at = pointAlong(caravan.route, ahead);
    return { x: at.x, y: at.y };
  }

  /** Area pose of the hero to a map pose. */
  toMap(x: number, z: number, yaw: number): { x: number; y: number; yaw: number } {
    const tile = localToTile(this.handoff.frame, x, z);
    return { x: tile.x, y: tile.y, yaw: areaYawToMap(yaw) };
  }

  /** Map point to this window's metres. */
  toLocal(x: number, y: number): { x: number; z: number } {
    return tileToLocal(this.handoff.frame, x, y);
  }

  inside(x: number, z: number, margin = 2): boolean {
    const b = this.handoff.bounds;
    return x > b.minX + margin && x < b.maxX - margin && z > b.minZ + margin && z < b.maxZ - margin;
  }
}
