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
      world.advanceTravel(travelled * METERS_PER_WORLD_TILE, travelChargePaceMps(0, sprint));
      if (step.holdId) this.settlementHold = step.holdId;
    } else {
      if (move.x === 0 && move.y === 0) this.settlementHold = null;
      world.stepIdle(dt, rate);
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
    this.entryCooldown = stepEntryCooldown(this.entryCooldown, dt);
    this.camera.update(dt, world.hero.x, world.hero.y);
    if (this.entryCooldown > 0) {
      this.host.keyboard.consumePress('Enter');
    } else if (this.host.keyboard.consumePress('Enter')) {
      this.host.enterArea();
    }
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
    } else {
      const stand = describeMapStand(data, world.hero.x, world.hero.y);
      nearTown.value = stand.kind !== 'wilderness' && stand.kind !== 'water' && !!stand.tier;
      canEnter.value = stand.canEnter;
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
    });
  }

  exit(): void {
    this.detachInput?.();
    this.detachInput = null;
  }

  lookAt(x: number, y: number, scale?: number): void {
    this.camera.lookAt(x, y, scale);
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
