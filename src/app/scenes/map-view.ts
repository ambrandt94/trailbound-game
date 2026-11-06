import { tierForKind } from '../../core/world/settlement-tiers';
import {
  DETAIL_START,
  METERS_PER_WORLD_TILE,
  TILE,
  chunkKey,
  travelChargePaceMps,
  travelSpeedTilesPerSec,
  type ChunkData,
} from '../../core/world/models';
import { attachMapInput } from '../../input/map-input';
import { MapCamera } from '../../render/map/map-camera';
import { canEnter, hint, nearTown, placeKind, placeName, placeTier } from '../../ui/state';
import type { GameHost } from '../host';
import type { Scene } from '../scene-stack';

export class MapView implements Scene {
  readonly id = 'map';
  private readonly camera = new MapCamera();
  private detachInput: (() => void) | null = null;
  private framed = false;

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
    if ((move.x !== 0 || move.y !== 0) && world.data) {
      this.camera.follow = true;
      const speed = travelSpeedTilesPerSec('overworld', sprint, this.camera.scale);
      const dist = speed * dt;
      const len = Math.hypot(move.x, move.y);
      world.moveHero((move.x / len) * dist, (move.y / len) * dist);
      world.advanceTravel(
        dist * METERS_PER_WORLD_TILE,
        travelChargePaceMps(this.camera.scale, sprint),
      );
    } else {
      world.stepIdle(dt);
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
    if (world.data && this.camera.scale >= DETAIL_START * 0.85) {
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
    const here = world.settlementAt();
    if (here && this.host.keyboard.consumePress('Enter')) this.host.enterSettlement();
  }

  render(_alpha: number): void {
    const world = this.host.world;
    const here = world.settlementAt();
    const tier = here ? tierForKind(here.kind) : null;
    nearTown.value = !!here;
    canEnter.value = !!here;
    placeName.value = here?.name ?? '';
    placeTier.value = tier ?? '';
    placeKind.value = here?.kind ?? '';
    hint.value = here ? '' : 'Walk the road. Drag to look around. Scroll to zoom.';
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
