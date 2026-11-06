import { music } from '../../audio/music';
import type { AreaHandoff } from '../../core/state/world-state';
import type { AreaEntry } from '../../render/area/area-from-export';
import { AreaRenderer } from '../../render/area/area-renderer';
import { hint, settings, settingsOpen } from '../../ui/state';
import {
  controllerExitToMap,
  exitFromCancel,
  type AreaExit,
  type ControllerExit,
} from '../area-exit';
import type { GameHost } from '../host';
import type { Scene } from '../scene-stack';
import { TransitionScene } from './transition';

export interface AreaEnter {
  areaExport: unknown;
  entry?: AreaEntry;
}

const CONTROLS =
  'WASD move · Space jump · Shift sprint · Ctrl sneak · Alt roll · F use · Q/E orbit · Z/X pitch · V zoom · C overhead/3rd · wheel zoom. Walk off the edge to leave.';

export class AreaView implements Scene {
  readonly id = 'area';
  private leaving = false;

  readonly handoff: AreaHandoff | null;

  constructor(
    private readonly host: GameHost,
    private renderer: AreaRenderer | null,
    handoff: AreaHandoff | null = null,
  ) {
    this.handoff = handoff;
  }

  get areaExport(): AreaHandoff['areaExport'] | null {
    return this.handoff?.areaExport ?? null;
  }

  get entry(): AreaHandoff['entry'] | null {
    return this.handoff?.entry ?? null;
  }

  /** Stack calls this with no args after the town is already loaded. */
  async enter(ctx?: AreaEnter): Promise<void> {
    this.host.keyboard.clearPresses();
    this.host.setMode('area');
    this.host.setView('area');
    if (ctx?.areaExport && this.renderer) {
      await this.renderer.start(ctx.areaExport, ctx.entry);
    }
    music.start();
  }

  update(dt: number): void {
    if (this.leaving || !this.renderer) return;
    this.renderer.step(dt);
    this.host.world.advanceClock(dt);
    if (this.host.keyboard.consumePress('Escape')) {
      if (settingsOpen.value) {
        settingsOpen.value = false;
        return;
      }
      this.leave(exitFromCancel(0));
    }
  }

  render(_alpha: number): void {
    if (!this.renderer) return;
    this.renderer.frame();
    const mix = settings.value;
    music.setVolume((mix.music / 100) * (mix.master / 100));
    music.setMuffle(this.renderer.indoors() ? 1 : 0);
    const line = this.renderer.prompt();
    hint.value = line ? `${line}  ·  ${CONTROLS}` : CONTROLS;
  }

  exit(): void {
    this.renderer?.dispose();
    this.renderer = null;
  }

  leaveFromController(info: ControllerExit): void {
    this.leave(controllerExitToMap(info, this.renderer?.bounds() ?? null));
  }

  private leave(exit: AreaExit): void {
    if (this.leaving) return;
    this.leaving = true;
    void this.host.stack.push(new TransitionScene(this.host, 'to-map', exit));
  }
}
