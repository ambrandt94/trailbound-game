import { clampStepToSettlement, describeMapStand } from '../../core/area/area-window';
import {
  DETAIL_START,
  METERS_PER_WORLD_TILE,
  TILE,
  chunkKey,
  formatMapClockRate,
  mapClockHoursPerRealSec,
  travelChargePaceMps,
  travelSpeedTilesPerSec,
  type ChunkData,
} from '../../core/world/models';
import { chunkDetailWanted } from '../../render/map/detail-lod';
import { attachMapInput } from '../../input/map-input';
import { MapCamera } from '../../render/map/map-camera';
import {
  canEnter,
  clockRate,
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
        const canvas = this.host.mapCanvas;
        this.camera.zoomAt(sx, sy, factor, canvas.clientWidth, canvas.clientHeight);
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
    const rate = mapClockHoursPerRealSec(this.camera.scale);
    if (this.camera.scale < DETAIL_START) this.settlementHold = null;
    if ((move.x !== 0 || move.y !== 0) && world.data && !this.settlementHold) {
      this.camera.follow = true;
      const speed = travelSpeedTilesPerSec('overworld', sprint, this.camera.scale);
      const dist = speed * dt;
      const len = Math.hypot(move.x, move.y);
      const step = clampStepToSettlement(
        world.data,
        world.hero.x,
        world.hero.y,
        (move.x / len) * dist,
        (move.y / len) * dist,
        this.camera.scale,
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
    this.camera.update(dt, world.hero.x, world.hero.y);
    if (world.data && chunkDetailWanted(this.camera.scale)) {
      const canvas = this.host.mapCanvas;
      const halfW = canvas.clientWidth / (2 * this.camera.scale) / TILE;
      const halfH = canvas.clientHeight / (2 * this.camera.scale) / TILE;
      const x0 = Math.max(0, Math.floor(this.camera.x - halfW - 1));
      const y0 = Math.max(0, Math.floor(this.camera.y - halfH - 1));
      const x1 = Math.min(world.data.width - 1, Math.ceil(this.camera.x + halfW + 1));
      const y1 = Math.min(world.data.height - 1, Math.ceil(this.camera.y + halfH + 1));
      world.ensureChunks(x0, y0, x1, y1, 8);
      const visible: ChunkData[] = [];
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const chunk = world.chunks.get(chunkKey(x, y));
          if (chunk) visible.push(chunk);
        }
      }
      this.host.syncChunks(visible);
    }
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
    } else {
      const stand = describeMapStand(data, world.hero.x, world.hero.y);
      nearTown.value = stand.kind !== 'wilderness' && stand.kind !== 'water' && !!stand.tier;
      canEnter.value = stand.canEnter;
      placeName.value = stand.name;
      placeTier.value = stand.tier;
      placeKind.value = stand.kind;
      clockRate.value = formatMapClockRate(this.camera.scale);
      hint.value = stand.blockedReason
        ? 'Open water. Walk ashore to enter.'
        : stand.tier === 'Wilderness'
          ? 'Enter walks this ground in 3D. Drag to look around. Scroll to zoom.'
          : '';
    }
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
    this.camera.zoomAt(
      canvas.clientWidth / 2,
      canvas.clientHeight / 2,
      factor,
      canvas.clientWidth,
      canvas.clientHeight,
    );
  }
}
