import type { AreaExit } from '../area-exit';
import type { AreaLanding, GameHost } from '../host';
import type { Scene } from '../scene-stack';

/** Map camera dive from the current view down onto the target, seconds. */
export const DIVE_ZOOM_SEC = 0.95;
/** Cross-fade from the magnified map into the 3D view, seconds. */
export const DIVE_REVEAL_SEC = 0.65;
/** 3D camera ease from the overhead start down to the follow view, seconds. */
export const DIVE_SWEEP_SEC = 1.6;
/** Leaving: the 3D camera climbs while the map fades back in, seconds. */
export const RISE_SEC = 0.7;
/** Leaving: the magnified map settles back to its normal scale, seconds. */
export const SETTLE_SEC = 0.45;
/** CSS magnification of the map canvas at the bottom of the dive. */
export const DIVE_MAP_MAGNIFY = 3.2;

export type DiveDirection = 'to-area' | 'to-map';

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const easeOut = (t: number) => 1 - (1 - t) ** 3;
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

/** Map scale and position at `u` (0..1) of the dive. Scale moves in log space. */
export function divePose(
  from: { x: number; y: number; scale: number },
  to: { x: number; y: number; scale: number },
  u: number,
): { x: number; y: number; scale: number; magnify: number } {
  const e = easeInOut(clamp01(u));
  const s0 = Math.max(1e-4, from.scale);
  const s1 = Math.max(s0, to.scale);
  return {
    x: from.x + (to.x - from.x) * e,
    y: from.y + (to.y - from.y) * e,
    scale: s0 * (s1 / s0) ** e,
    magnify: 1 + (DIVE_MAP_MAGNIFY - 1) * e * e,
  };
}

/**
 * One continuous move between the map and a 3D area, with no black frame.
 * In: the map camera dives onto the caravan (or the hero), the area builds
 * under the held frame, then the 3D canvas cross-fades in while its camera
 * eases down from overhead. Out reverses it: the 3D camera climbs as the map,
 * already parked on the landing spot, fades back and settles.
 */
export class DiveScene implements Scene {
  readonly id = 'transition';
  private phase: 'zoom' | 'build' | 'reveal' | 'rise' | 'settle' | 'done' = 'zoom';
  private elapsed = 0;
  private from = { x: 0, y: 0, scale: 1 };
  private to = { x: 0, y: 0, scale: 1 };

  constructor(
    private readonly host: GameHost,
    private readonly direction: DiveDirection,
    private readonly exitPayload?: AreaExit,
    private readonly landing?: AreaLanding | null,
  ) {}

  enter(): void {
    this.host.setMode('transition');
    this.host.setFade(0);
    if (this.direction === 'to-area') {
      const target = this.host.diveTarget();
      this.from = this.host.mapPose();
      this.to = { x: target.x, y: target.y, scale: this.host.mapCloseScale() };
      this.phase = 'zoom';
      return;
    }
    // Leaving: settle the world first, then park the map on the landing spot.
    this.host.landFromArea(this.exitPayload, this.landing ?? null);
    const hero = this.host.world.hero;
    this.host.diveMap(hero.x, hero.y, this.host.mapCloseScale());
    this.host.setLayers(DIVE_MAP_MAGNIFY, 1);
    this.host.areaSweep('out', RISE_SEC);
    this.phase = 'rise';
  }

  update(dt: number): void {
    const step = Math.max(0, Number.isFinite(dt) ? dt : 0);
    this.elapsed += step;
    switch (this.phase) {
      case 'zoom': {
        const u = this.elapsed / DIVE_ZOOM_SEC;
        const pose = divePose(this.from, this.to, u);
        this.host.diveMap(pose.x, pose.y, pose.scale);
        this.host.setLayers(pose.magnify, 0);
        if (u >= 1) {
          this.phase = 'build';
          this.elapsed = 0;
          void this.host.buildArea().finally(() => {
            if (this.host.view === 'area') {
              this.host.areaSweep('in', DIVE_SWEEP_SEC);
              this.phase = 'reveal';
            } else {
              this.finish('map');
            }
            this.elapsed = 0;
          });
        }
        return;
      }
      case 'build':
        return;
      case 'reveal': {
        const u = clamp01(this.elapsed / DIVE_REVEAL_SEC);
        this.host.setLayers(DIVE_MAP_MAGNIFY * (1 + 0.35 * easeOut(u)), easeOut(u));
        if (u >= 1) this.finish('area');
        return;
      }
      case 'rise': {
        const u = clamp01(this.elapsed / RISE_SEC);
        const e = easeInOut(u);
        this.host.setLayers(DIVE_MAP_MAGNIFY - (DIVE_MAP_MAGNIFY - 1.6) * e, 1 - e);
        if (u >= 1) {
          this.host.leaveArea(this.exitPayload, { landed: true, keepLayers: true });
          this.phase = 'settle';
          this.elapsed = 0;
        }
        return;
      }
      case 'settle': {
        const u = clamp01(this.elapsed / SETTLE_SEC);
        this.host.setLayers(1.6 - 0.6 * easeOut(u), 0);
        if (u >= 1) this.finish('map');
        return;
      }
      default:
        return;
    }
  }

  render(_alpha: number): void {
    return;
  }

  exit(): void {
    this.host.setLayers(1, 1);
    this.host.endMapDive();
  }

  private finish(next: 'map' | 'area'): void {
    if (this.phase === 'done') return;
    this.phase = 'done';
    this.host.setLayers(1, 1);
    this.host.endMapDive();
    this.host.enqueue(() => {
      void this.host.stack.pop();
      const top = this.host.stack.current();
      this.host.setMode(top?.id === 'area' ? 'area' : next === 'area' ? 'area' : 'map');
    });
  }
}
