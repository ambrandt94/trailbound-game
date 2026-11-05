import { hint, nearTown } from '../../ui/state';
import type { GameHost } from '../host';
import type { Scene } from '../scene-stack';
import { TransitionScene } from './transition';
import { HERO_SPEED, MAP_LIMIT, TOWN_ENTER_RADIUS } from '../travel';

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function lerp(from: number, to: number, alpha: number): number {
  return from + (to - from) * alpha;
}

export class MapView implements Scene {
  readonly id = 'map';
  private prevX = 0;
  private prevY = 0;

  constructor(private readonly host: GameHost) {}

  enter(): void {
    const hero = this.host.world.hero;
    this.prevX = hero.x;
    this.prevY = hero.y;
    this.host.keyboard.clearPresses();
    this.host.setMode('map');
    this.host.setView('map');
  }

  update(dt: number): void {
    const hero = this.host.world.hero;
    this.prevX = hero.x;
    this.prevY = hero.y;
    const move = this.host.keyboard.mapAxis();
    if (move.x !== 0 || move.y !== 0) {
      const len = Math.hypot(move.x, move.y);
      hero.x = clamp(hero.x + (move.x / len) * HERO_SPEED * dt, MAP_LIMIT.min, MAP_LIMIT.max);
      hero.y = clamp(hero.y + (move.y / len) * HERO_SPEED * dt, MAP_LIMIT.min, MAP_LIMIT.max);
      hero.yaw = Math.atan2(move.x, -move.y);
    }
    this.host.world.advanceClock(dt);
    const near = this.isNear();
    if (near && this.host.keyboard.consumePress('Enter')) {
      void this.host.stack.push(new TransitionScene(this.host, 'to-area'));
    }
  }

  render(alpha: number): void {
    const hero = this.host.world.hero;
    this.host.paintMap({
      x: lerp(this.prevX, hero.x, alpha),
      y: lerp(this.prevY, hero.y, alpha),
      yaw: hero.yaw,
    });
    const near = this.isNear();
    nearTown.value = near;
    const name = this.host.world.town.name;
    hint.value = near ? `Press Enter to visit ${name}.` : `Walk to ${name}.`;
  }

  exit(): void {
    return;
  }

  private isNear(): boolean {
    const hero = this.host.world.hero;
    const town = this.host.world.town;
    return Math.hypot(hero.x - town.x, hero.y - town.y) <= TOWN_ENTER_RADIUS;
  }
}
