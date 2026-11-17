import {
  SETTLEMENT_STOP_SCALE,
  clampStepToSettlement,
  describeMapStand,
} from '../../core/area/area-window';
import {
  MAP_ENTRY_COOLDOWN_SEC,
  stepEntryCooldown,
  zoomAfterArea,
} from '../../core/world/map-zoom';
import {
  METERS_PER_WORLD_TILE,
  formatMapClockRate,
  mapClockHoursPerRealSec,
  travelChargePaceMps,
  travelSpeedTilesPerSec,
} from '../../core/world/models';
import { attachMapInput } from '../../input/map-input';
import { MapCamera } from '../../render/map/map-camera';
import { dayLightAt } from '../../core/sim/time';
import { hasRoute, splitRoute } from '../../core/sim/caravan';
import { travelHudFor, travelHudKey } from '../travel-hud';
import { MAP_ZOOM_CAP, TILE } from '../../core/world/models';
import type { MapCaravanDraw } from '../../render/map/map-renderer';
import { attachRouteClicks, resolveRouteTarget, routeFrame } from '../map-route';
import {
  canEnter,
  clockRate,
  hint,
  mapNight,
  nearTown,
  nearestLine,
  placeKind,
  placeName,
  placeTier,
  standLine,
  travelHud,
} from '../../ui/state';
import type { GameHost } from '../host';
import type { Scene } from '../scene-stack';

export class MapView implements Scene {
  readonly id = 'map';
  private readonly camera = new MapCamera();
  private detachInput: (() => void) | null = null;
  private framed = false;
  /** Settlement id the walker just stepped onto. Held until the keys are released. */
  private settlementHold: string | null = null;
  /** Seconds left before Enter can open 3D again after a return. */
  private entryCooldown = 0;
  private detachClicks: (() => void) | null = null;
  /** Route clicks in fine tiles, converted with the camera as it was when clicked. */
  private readonly clicks: Array<{ x: number; y: number; pick: number; append: boolean }> = [];
  private hudKey = '';
  /** Hero walked under move input this frame. Drives the paused-clock readout. */
  private walking = false;
  private bare = false;
  private barePainted = false;

  constructor(private readonly host: GameHost) {}

  enter(): void {
    this.host.keyboard.clearPresses();
    this.host.setMode('map');
    this.host.setView('map');
    this.detachInput = attachMapInput(this.host.mapCanvas, {
      pan: (dx, dy) => {
        this.camera.panPixels(dx, dy);
      },
      zoom: (sx, sy, factor) => {
        this.applyZoom(sx, sy, factor);
      },
    });
    this.detachClicks = attachRouteClicks(this.host.mapCanvas, (sx, sy, append) => {
      const canvas = this.host.mapCanvas;
      const at = this.camera.screenToWorld(sx, sy, canvas.clientWidth, canvas.clientHeight);
      const step = this.camera.step;
      const pick = (14 / (this.camera.scale * TILE)) * step;
      this.clicks.push({ x: at.x * step, y: at.y * step, pick, append });
    });
  }

  update(dt: number): void {
    const world = this.host.world;
    if (world.data && !this.framed) {
      this.camera.frame(world.data.width, world.data.height, world.hero.x, world.hero.y);
      this.framed = true;
    }
    const sprint =
      this.host.keyboard.isDown('ShiftLeft') || this.host.keyboard.isDown('ShiftRight');
    const move = this.host.keyboard.mapAxis();
    const motionScale = this.camera.scale / this.camera.step;
    const rate = mapClockHoursPerRealSec(motionScale);
    if (motionScale < SETTLEMENT_STOP_SCALE) this.settlementHold = null;
    this.flushClicks();
    if ((move.x !== 0 || move.y !== 0) && world.heroAboard) world.leaveCaravan();
    if ((move.x !== 0 || move.y !== 0) && world.data && !this.settlementHold) {
      this.camera.follow = true;
      const speed = travelSpeedTilesPerSec('overworld', sprint, motionScale);
      const dist = speed * dt;
      const len = Math.hypot(move.x, move.y);
      const step = clampStepToSettlement(
        world.data,
        world.hero.x,
        world.hero.y,
        (move.x / len) * dist,
        (move.y / len) * dist,
        motionScale,
      );
      world.moveHero(step.dx, step.dy);
      const travelled = Math.hypot(step.dx, step.dy);
      this.walking = travelled > 0;
      world.advanceTravel(travelled * METERS_PER_WORLD_TILE, travelChargePaceMps(0, sprint));
      if (step.holdId) this.settlementHold = step.holdId;
    } else {
      if (move.x === 0 && move.y === 0) this.settlementHold = null;
      this.walking = false;
      // Time only moves while something travels: the rolling caravan here,
      // or the hero's own walk above (charged by distance).
      if (world.mapClockRuns(false)) world.stepIdle(dt, rate);
    }
    if (this.host.keyboard.consumePress('Equal') || this.host.keyboard.consumePress('NumpadAdd')) {
      this.zoom(1.12);
    }
    if (
      this.host.keyboard.consumePress('Minus') ||
      this.host.keyboard.consumePress('NumpadSubtract')
    ) {
      this.zoom(1 / 1.12);
    }
    for (const event of world.takeCaravanEvents()) {
      if (event.type === 'stopped') this.host.toast(`The caravan halts at ${event.name}.`);
      else this.host.toast(`The caravan reaches ${event.name ?? 'its destination'}.`);
    }
    this.entryCooldown = stepEntryCooldown(this.entryCooldown, dt);
    this.camera.update(dt, world.hero.x, world.hero.y);
    if (this.entryCooldown > 0) {
      this.host.keyboard.consumePress('Enter');
    } else if (this.host.keyboard.consumePress('Enter')) {
      this.host.enterArea();
    }
  }

  /**
   * The dive out has finished. The map did not tick under it, so the cooldown
   * set at hand-back would only now start; the dive already kept the leaving
   * key from re-entering, so drop stray presses and allow Enter at once.
   */
  settleAreaReturn(): void {
    this.entryCooldown = 0;
    this.host.keyboard.clearPresses();
  }

  /** True once the post-exit cooldown has elapsed. */
  allowEnter(): boolean {
    return this.entryCooldown <= 0;
  }

  /**
   * Called when 3D hands back to the map. Ease off the zoom cap and ignore
   * Enter until the cooldown elapses, so the leaving key cannot re-enter.
   */
  noteAreaReturn(): void {
    this.entryCooldown = MAP_ENTRY_COOLDOWN_SEC;
    this.camera.easeScale(zoomAfterArea(this.camera.targetScale));
    this.host.keyboard.clearPresses();
  }

  render(_alpha: number): void {
    const world = this.host.world;
    const data = world.data;
    if (this.host.view !== 'map' || !data) {
      nearTown.value = false;
      canEnter.value = false;
      placeName.value = '';
      standLine.value = '';
      nearestLine.value = '';
      clockRate.value = '';
      mapNight.value = 0;
      // The 3D view owns the travel HUD while it is up.
      this.hudKey = '';
    } else {
      this.publishTravel();
      const stand = describeMapStand(data, world.hero.x, world.hero.y);
      nearTown.value = stand.kind !== 'wilderness' && stand.kind !== 'water' && !!stand.tier;
      // The Enter button is live only when Enter would act (not in the cooldown).
      canEnter.value = stand.canEnter && this.allowEnter();
      placeName.value = stand.name;
      placeTier.value = stand.tier;
      placeKind.value = stand.kind;
      standLine.value = stand.standLine;
      nearestLine.value = stand.nearestLine;
      clockRate.value = formatMapClockRate(this.camera.scale / this.camera.step);
      mapNight.value = dayLightAt(world.clockHours).mapNight;
      hint.value = stand.blockedReason
        ? 'Open water. Walk ashore to enter.'
        : 'Enter walks this ground in 3D.';
    }
    this.host.mapCanvas.dataset.scale = this.camera.scale.toFixed(3);
    // Under the 3D view the dive holds the map still: keep its last bare frame.
    if (this.bare && this.host.view !== 'map' && this.barePainted) return;
    this.barePainted = this.bare;
    this.host.paintMap({
      seed: world.seed,
      heroX: world.hero.x,
      heroY: world.hero.y,
      heroYaw: world.hero.yaw,
      townX: world.town.x,
      townY: world.town.y,
      townName: world.town.name,
      world: world.data,
      camera: this.camera.state(),
      player: world.player,
      entities: world.entities,
      chunks: world.chunks,
      caravan: this.caravanDraw(),
      bare: this.bare,
    });
  }

  /** Terrain-only frames while the dive magnifies the map. */
  setBare(bare: boolean): void {
    this.bare = bare;
  }

  /** Caravan wagon, route halves, and pins for the renderer. */
  private caravanDraw(): MapCaravanDraw {
    const caravan = this.host.world.caravan;
    const split = splitRoute(caravan);
    return {
      x: caravan.x,
      y: caravan.y,
      yaw: caravan.yaw,
      done: split.done,
      rest: split.rest,
      targets: hasRoute(caravan)
        ? caravan.targets.map((t) => ({ x: t.x, y: t.y, name: t.name }))
        : [],
      heroApart: !this.host.world.heroAboard,
    };
  }

  private publishTravel(): void {
    const world = this.host.world;
    const hud = travelHudFor(world, {
      clockPaused: !world.mapClockRuns(this.walking),
      view: 'map',
      convoy: null,
    });
    const key = travelHudKey(hud);
    if (key === this.hudKey) return;
    this.hudKey = key;
    travelHud.value = hud;
  }

  private flushClicks(): void {
    const world = this.host.world;
    const data = world.data;
    const pending = this.clicks.splice(0, this.clicks.length);
    if (!data || this.host.view !== 'map') return;
    for (const click of pending) {
      const target = resolveRouteTarget(data, click.x, click.y, click.pick);
      if (!target) {
        this.host.toast('Open water. Pick a spot on land.');
        continue;
      }
      const result = world.routeCaravanTo(target, click.append);
      this.host.toast(result.message);
    }
  }

  clearRoute(): void {
    if (!this.host.world.clearCaravanRoute()) this.host.toast('The leader sets the route.');
  }

  toggleHalt(): void {
    const world = this.host.world;
    if (!hasRoute(world.caravan)) return;
    const halted = !world.caravan.halted;
    if (!world.setCaravanHalted(halted)) {
      this.host.toast('The leader decides when to stop.');
      return;
    }
    this.host.toast(halted ? 'The caravan halts.' : 'The caravan rolls on.');
  }

  rejoinCaravan(): void {
    this.host.world.rejoinCaravan();
    this.camera.follow = true;
  }

  /** Zoom out until the whole route is on screen. Zoom stays a camera scale. */
  fitRoute(): void {
    const world = this.host.world;
    const canvas = this.host.mapCanvas;
    const frame = routeFrame(
      world.caravan,
      this.camera.step,
      canvas.clientWidth,
      canvas.clientHeight,
    );
    if (!frame) return;
    this.camera.lookAt(frame.x * this.camera.step, frame.y * this.camera.step, frame.scale);
  }

  exit(): void {
    this.detachInput?.();
    this.detachInput = null;
    this.detachClicks?.();
    this.detachClicks = null;
    travelHud.value = null;
    this.hudKey = '';
  }

  lookAt(x: number, y: number, scale?: number): void {
    this.camera.lookAt(x, y, scale);
  }

  /** Screen pixels per ground metre at a map scale. */
  pxPerMetre(scale: number): number {
    return (scale * TILE) / (this.camera.step * METERS_PER_WORLD_TILE);
  }

  /** Camera pose for the 3D dive: centre in tiles and scale. */
  cameraPose(): { x: number; y: number; scale: number } {
    return {
      x: this.camera.x * this.camera.step,
      y: this.camera.y * this.camera.step,
      scale: this.camera.scale,
    };
  }

  /**
   * Hold the camera on a dive frame. `scale` may pass the zoom cap; the dive
   * owns the camera until `endDive`, and the follow camera resumes after.
   */
  diveTo(x: number, y: number, scale: number): void {
    this.barePainted = false;
    this.camera.follow = false;
    this.camera.x = this.camera.targetX = x / this.camera.step;
    this.camera.y = this.camera.targetY = y / this.camera.step;
    this.camera.scale = this.camera.targetScale = scale;
  }

  endDive(): void {
    this.camera.follow = true;
  }

  /** Map scale at the zoom cap, the closest the 2D map draws. */
  closestScale(): number {
    return MAP_ZOOM_CAP;
  }

  private zoom(factor: number): void {
    const canvas = this.host.mapCanvas;
    this.applyZoom(canvas.clientWidth / 2, canvas.clientHeight / 2, factor);
  }

  private applyZoom(sx: number, sy: number, factor: number): void {
    if (this.host.view !== 'map') return;
    const canvas = this.host.mapCanvas;
    this.camera.zoomAt(sx, sy, factor, canvas.clientWidth, canvas.clientHeight);
  }
}
