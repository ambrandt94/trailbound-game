import { hint } from '../../ui/state';
import { exitFromCancel, exitFromPose, type AreaExit } from '../area-exit';
import type { GameHost } from '../host';
import type { Scene } from '../scene-stack';
import { AreaRenderer } from '../../render/area/area-renderer';
import { TransitionScene } from './transition';
import { AREA_HALF, PAWN_SPEED } from '../travel';

function lerp(from: number, to: number, alpha: number): number {
  return from + (to - from) * alpha;
}

export class AreaView implements Scene {
  readonly id = 'area';
  private x = 0;
  private z = 0;
  private yaw = 0;
  private prevX = 0;
  private prevZ = 0;
  private spin = 0;
  private leaving = false;

  constructor(
    private readonly host: GameHost,
    private renderer: AreaRenderer | null,
  ) {}

  enter(): void {
    this.host.keyboard.clearPresses();
    this.host.setMode('area');
    this.host.setView('area');
  }

  update(dt: number): void {
    if (this.leaving) return;
    this.prevX = this.x;
    this.prevZ = this.z;
    const move = this.host.keyboard.areaAxis();
    if (move.x !== 0 || move.z !== 0) {
      const len = Math.hypot(move.x, move.z);
      this.x += (move.x / len) * PAWN_SPEED * dt;
      this.z += (move.z / len) * PAWN_SPEED * dt;
      this.yaw = Math.atan2(move.x, -move.z);
    }
    this.spin += dt;
    this.host.world.advanceClock(dt);
    if (this.host.keyboard.consumePress('Escape')) {
      this.leave(exitFromCancel(this.yaw));
      return;
    }
    const edged = exitFromPose(this.x, this.z, this.yaw, AREA_HALF);
    if (edged) this.leave(edged);
  }

  render(alpha: number): void {
    hint.value = 'Walk off the edge, or press Esc, to return to the map.';
    this.renderer?.draw({
      x: lerp(this.prevX, this.x, alpha),
      z: lerp(this.prevZ, this.z, alpha),
      yaw: this.yaw,
      spin: this.spin,
    });
  }

  exit(): void {
    this.renderer?.dispose();
    this.renderer = null;
  }

  private leave(exit: AreaExit): void {
    this.leaving = true;
    void this.host.stack.push(new TransitionScene(this.host, 'to-map', exit));
  }
}
