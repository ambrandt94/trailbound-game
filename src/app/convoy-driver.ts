import { hasRoute, isRolling, pointAlong } from '../core/sim/caravan';
import {
  CONVOY_LOOKAHEAD_M,
  convoyClockHours,
  convoyLeftZone,
  convoyRollMetres,
  convoyRoom,
  preparedWindowFits,
  recutAction,
  routeCrossing,
  type RecutAction,
  localToTile,
  mapYawToArea,
  areaYawToMap,
  metresToTiles,
  tileToLocal,
} from '../core/sim/convoy';
import { METERS_PER_WORLD_TILE } from '../core/world/models';
import type { CaravanEvent } from '../core/sim/caravan';
import type { ConvoyHandoff, WorldState } from '../core/state/world-state';
import type { ConvoyFrame } from '../render/area/area-renderer';

/** How far down the route to look for the re-cut line, metres. */
const PRECUT_SEARCH_M = 160;

/**
 * Drives the caravan through a convoy area. The world caravan is the one
 * source of truth: each frame it rolls by the wagon's metres, and the 3D
 * wagon is drawn where the caravan now stands, in this window's metres.
 */
export class ConvoyDriver {
  private speed = 0;
  /** Units rolled by the last `step`, and the clock hours that road costs. */
  private rolled = 0;
  /** The wagon has rolled off this zone. Latched; it never comes back to this block. */
  private left = false;
  private noticed = false;
  private cross: { route: readonly number[]; from: number; at: number | null } | null = null;

  constructor(
    private readonly world: () => WorldState,
    readonly handoff: ConvoyHandoff,
  ) {}

  /** Advance the caravan for `dt` real seconds of 3D time. */
  step(dt: number): CaravanEvent[] {
    const world = this.world();
    this.speed = 0;
    this.rolled = 0;
    const metres = convoyRollMetres({
      rolling: isRolling(world.caravan),
      paused: false,
      speedMod: world.caravanSpeedAt(),
      dt,
    });
    if (!(metres > 0)) return world.takeCaravanEvents();
    const units = world.rollConvoy(metresToTiles(metres));
    this.speed = units > 0 ? metres / dt : 0;
    this.rolled = units;
    return world.takeCaravanEvents();
  }

  /**
   * Game hours the clock owes for the road the last `step` rolled, or null
   * when the wagon did not move (the area clock runs then).
   */
  clockHours(): number | null {
    if (!(this.rolled > 0)) return null;
    return convoyClockHours(this.rolled, this.world().caravanSpeedAt());
  }

  /** Wagon pose in area metres for the renderer. `gone` once it has rolled off the zone. */
  frame(): ConvoyFrame {
    const caravan = this.world().caravan;
    const at = tileToLocal(this.handoff.frame, caravan.x, caravan.y);
    if (!this.left && convoyLeftZone(convoyRoom(at, this.handoff.bounds))) this.left = true;
    return {
      x: at.x,
      z: at.z,
      yaw: mapYawToArea(caravan.yaw),
      speed: this.speed,
      gone: this.left,
      edge: this.handoff.bounds,
    };
  }

  /** The wagon has rolled off this zone block. */
  get gone(): boolean {
    return this.frame().gone === true;
  }

  /** True once, the first time the wagon is seen to have left. */
  takeLeftNotice(): boolean {
    if (!this.gone || this.noticed) return false;
    this.noticed = true;
    return true;
  }

  /** Metres from the wagon to this window's nearest edge. */
  room(): number {
    return convoyRoom(this.frame(), this.handoff.bounds);
  }

  /** What the re-cut machinery should do now. */
  recutAction(prepared: boolean, swapping: boolean): RecutAction {
    const caravan = this.world().caravan;
    const cross = this.crossAlong();
    return recutAction({
      routed: hasRoute(caravan),
      room: this.room(),
      crossing:
        cross === null ? Number.POSITIVE_INFINITY : (cross - caravan.along) * METERS_PER_WORLD_TILE,
      prepared,
      swapping,
    });
  }

  /** The cut window still holds the wagon with room to spare. */
  fits(handoff: ConvoyHandoff): boolean {
    const at = tileToLocal(handoff.frame, this.world().caravan.x, this.world().caravan.y);
    return preparedWindowFits(at, handoff.bounds);
  }

  /**
   * Route distance where the wagon will cross the re-cut line of this window.
   * Searched once per route and cached; a clear route is looked at again after
   * the wagon has moved a good way down it.
   */
  private crossAlong(): number | null {
    const caravan = this.world().caravan;
    if (!hasRoute(caravan)) return null;
    const cache = this.cross;
    const stale =
      !cache ||
      cache.route !== caravan.route ||
      caravan.along < cache.from ||
      (cache.at === null && caravan.along > cache.from + metresToTiles(PRECUT_SEARCH_M / 3));
    if (stale) {
      this.cross = {
        route: caravan.route,
        from: caravan.along,
        at: routeCrossing(
          caravan.route,
          caravan.along,
          this.handoff.frame,
          this.handoff.bounds,
          metresToTiles(PRECUT_SEARCH_M),
        ),
      };
    }
    return this.cross?.at ?? null;
  }

  /**
   * Where the next window should centre when it is swapped in at the re-cut
   * line: the route point `CONVOY_LOOKAHEAD_M` past where the wagon crosses
   * the line. Cutting for that point, not for where the wagon is now, is what
   * lets the window be built early and still fit when the swap comes.
   */
  recutCentre(): { x: number; y: number } {
    const caravan = this.world().caravan;
    if (!hasRoute(caravan)) return { x: caravan.x, y: caravan.y };
    const cross = this.crossAlong() ?? caravan.along;
    const ahead = Math.min(caravan.length, cross + metresToTiles(CONVOY_LOOKAHEAD_M));
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
