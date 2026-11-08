import {
  SETTLEMENT_STOP_SCALE,
  clampStepToSettlement,
  describeMapStand,
} from '../../core/area/area-window';
import {
  diveCueAmount,
  emptyDiveIntent,
  stepDiveIntent,
  type DiveIntentState,
} from '../../core/world/map-zoom';
import {
  MAP_ZOOM_CAP,
  METERS_PER_WORLD_TILE,
  formatMapClockRate,
  mapClockHoursPerRealSec,
  travelChargePaceMps,
  travelSpeedTilesPerSec,
} from '../../core/world/models';
import { attachMapInput } from '../../input/map-input';
import { MapCamera } from '../../render/map/map-camera';
import {
  canEnter,
  clockRate,
  diveCue,
  diveIntent,
  hint,
  nearTown,
  placeKind,
  placeName,
  placeTier,
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
  private dive: DiveIntentState = emptyDiveIntent();
  /** Holds the full ring while the fade into 3D is starting. */
  private diveShown = 0;
  /** Zoom-in events that hit the cap this frame. Consumed in update. */
  private zoomInNotches = 0;

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
    const canDive = world.data
      ? describeMapStand(world.data, world.hero.x, world.hero.y).canEnter
      : false;
    const atCap = this.camera.targetScale >= MAP_ZOOM_CAP - 1e-3;
    const stepped = stepDiveIntent(this.dive, dt, this.zoomInNotches, atCap, canDive);
    this.zoomInNotches = 0;
    this.dive = stepped.state;
    if (stepped.dive) {
      this.diveShown = 1;
      this.host.enterArea();
    } else if (this.dive.intent <= 0) {
      this.diveShown = 0;
    }
    this.camera.update(dt, world.hero.x, world.hero.y);
    if (this.host.keyboard.consumePress('Enter')) this.host.enterArea();
  }

  render(_alpha: number): void {
    const world = this.host.world;
    const data = world.data;
    if (this.host.view !== 'map' || !data) {
      nearTown.value = false;
      canEnter.value = false;
      placeName.value = '';
      clockRate.value = '';
      diveIntent.value = 0;
      diveCue.value = 0;
      this.diveShown = 0;
    } else {
      const stand = describeMapStand(data, world.hero.x, world.hero.y);
      nearTown.value = stand.kind !== 'wilderness' && stand.kind !== 'water' && !!stand.tier;
      canEnter.value = stand.canEnter;
      placeName.value = stand.name;
      placeTier.value = stand.tier;
      placeKind.value = stand.kind;
      clockRate.value = formatMapClockRate(this.camera.scale / this.camera.step);
      const shown = stand.canEnter ? Math.max(this.dive.intent, this.diveShown) : 0;
      diveIntent.value = shown;
      diveCue.value = diveCueAmount(this.camera.scale, shown, stand.canEnter);
      hint.value = stand.blockedReason
        ? 'Open water. Walk ashore to enter.'
        : shown > 0.04
          ? 'Keep zooming to step into 3D.'
          : stand.tier === 'Wilderness'
            ? 'Enter walks this ground in 3D. Scroll in at the closest zoom to step through.'
            : '';
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
    const canvas = this.host.mapCanvas;
    this.camera.zoomAt(sx, sy, factor, canvas.clientWidth, canvas.clientHeight);
    if (factor > 1.001 && this.camera.targetScale >= MAP_ZOOM_CAP - 1e-3) {
      this.zoomInNotches += 1;
    }
  }
}
