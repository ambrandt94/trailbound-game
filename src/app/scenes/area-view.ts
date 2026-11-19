import { music } from '../../audio/music';
import { GAME_HOURS_PER_REAL_SECOND } from '../../core/sim/clock';
import { hasRoute } from '../../core/sim/caravan';
import { CONVOY_STREAM_RECUT, zoneHopCentre } from '../../core/sim/convoy';
import { areaHoursPerRealSec } from '../../core/sim/time';
import { areaClockHours } from '../../core/sim/map-pace';
import type { AreaHandoff, ConvoyCut } from '../../core/state/world-state';
import type { AreaEntry } from '../../render/area/area-from-export';
import { clearAreaLeaveOverlay } from '../../render/area/leave-overlay';
import { AreaRenderer, type ConvoyStatus } from '../../render/area/area-renderer';
import { hint, prompt, settings, settingsOpen, travelHud } from '../../ui/state';
import { areaEscapeAction } from '../area-escape';
import {
  controllerExitToMap,
  exitFromCancel,
  type AreaExit,
  type ControllerExit,
} from '../area-exit';
import type { ConvoyDriver } from '../convoy-driver';
import type { AreaLanding, GameHost } from '../host';
import type { Scene } from '../scene-stack';
import { travelHudFor, travelHudKey } from '../travel-hud';
import { DiveScene } from './dive';

export interface AreaEnter {
  areaExport: unknown;
  entry?: AreaEntry;
}

const CONTROLS =
  'WASD walk · Shift jog, hold to sprint · Ctrl sneak · Space jump · Alt roll · F use · Q/E orbit · Z/X pitch · V zoom · C overhead/3rd · wheel zoom. Walk off the edge to leave.';
const CONVOY_CONTROLS = 'B ride the bench · H halt/resume · G rejoin the wagon';

/** The held still of the old window dissolves over the new one in this long. */
export const RECUT_DISSOLVE_SEC = 0.3;
/** Off the bench and this far from the wagon, leaving counts as stepping off. */
const ABOARD_RADIUS_M = 6;

export class AreaView implements Scene {
  readonly id = 'area';
  private leaving = false;
  private hudKey = '';
  /** A window swap in flight: waiting for the next render to copy a still, or loading. */
  private recut: { phase: 'snap' | 'load' } | null = null;
  /** The next window, cut ahead of the swap. */
  private prepared: AreaHandoff | null = null;
  /** The cut found no window ahead (water, a settlement). Do not retry for this route. */
  private noWindow = false;
  /** Route the prepared window was cut for. A new route makes it stale. */
  private preparedRoute: readonly number[] | null = null;
  /** The hero walked off the edge after the wagon rolled on: cut the zone beyond, here. */
  private hop: {
    centre: ConvoyCut;
    hero: { x: number; y: number; yaw: number };
  } | null = null;

  handoff: AreaHandoff | null;

  constructor(
    private readonly host: GameHost & {
      prepareConvoyRecut?: (centre: ConvoyCut) => AreaHandoff | null;
      recutConvoy?: (
        source: ConvoyCut | AreaHandoff,
        entry: (driver: ConvoyDriver) => AreaEntry,
      ) => Promise<{ renderer: AreaRenderer; driver: ConvoyDriver; handoff: AreaHandoff } | null>;
    },
    private renderer: AreaRenderer | null,
    handoff: AreaHandoff | null = null,
    private driver: ConvoyDriver | null = null,
  ) {
    this.handoff = handoff;
  }

  get areaExport(): AreaHandoff['areaExport'] | null {
    return this.handoff?.areaExport ?? null;
  }

  get entry(): AreaHandoff['entry'] | null {
    return this.handoff?.entry ?? null;
  }

  /** True while the caravan rolls through this area as a convoy. */
  get convoy(): boolean {
    return this.driver !== null;
  }

  worldView() {
    return this.renderer?.worldView() ?? null;
  }

  convoyStatus(): ConvoyStatus | null {
    return this.renderer?.convoyStatus() ?? null;
  }

  convoyCommand(command: 'bench' | 'rejoin'): void {
    if (this.driver) this.renderer?.convoyCommand(command);
  }

  cameraDistance(): number | null {
    return this.renderer?.cameraDistance() ?? null;
  }

  sweep(kind: 'in' | 'out', seconds: number): void {
    this.renderer?.cameraSweep(kind, seconds);
  }

  /** Stack calls this with no args after the town is already loaded. */
  async enter(ctx?: AreaEnter): Promise<void> {
    this.host.keyboard.clearPresses();
    // Under a dive the transition still owns the mode; it sets 'area' when done.
    if (this.host.stack.current()?.id !== 'transition') this.host.setMode('area');
    this.host.setView('area');
    if (ctx?.areaExport && this.renderer) {
      await this.renderer.start(ctx.areaExport, ctx.entry);
    }
    music.start();
  }

  update(dt: number): void {
    if (this.leaving) return;
    if (this.recut) {
      this.stepRecut(dt);
      return;
    }
    if (!this.renderer) return;
    const games = this.host.minigames;
    if (games.isOpen()) {
      if (games.kind !== 'inst') {
        const kind = games.kind;
        const wasPlaying = games.isPlaying();
        games.tick(dt);
        if (kind === 'world' && wasPlaying && games.isPlaying()) {
          // An in-world game is not a pause: the wagon keeps rolling and time runs.
          this.driver?.step(dt);
          this.renderer.step(dt);
          this.advanceAreaClock(dt);
        }
      }
      return;
    }
    if (this.driver) this.stepConvoy(dt);
    this.renderer.step(dt);
    this.advanceAreaClock(dt);
    const action = areaEscapeAction({
      minigameOpen: false,
      settingsOpen: settingsOpen.value,
      escape: this.host.keyboard.consumePress('Escape'),
    });
    if (action === 'close-settings') settingsOpen.value = false;
    if (action === 'leave') {
      this.leave(exitFromCancel(0));
      return;
    }
    this.planRecut();
  }

  render(_alpha: number): void {
    this.publishTravel();
    if (!this.renderer) return;
    const games = this.host.minigames;
    if (!games.isOpen() || games.kind === 'world') this.renderer.frame();
    // Copy the still now, in the same task as the draw, while the buffer is readable.
    const swap = this.recut?.phase === 'snap';
    if (swap) this.host.holdFrame();
    const mix = settings.value;
    music.setVolume((mix.music / 100) * (mix.master / 100));
    music.setMuffle(this.renderer.indoors() ? 1 : 0);
    if (games.isOpen()) {
      prompt.value = games.hint();
    } else {
      // The prompt is the one short line that stays on screen. The controls wait in the help panel.
      prompt.value = this.renderer.prompt();
      hint.value = this.driver ? `${CONVOY_CONTROLS}  ·  ${CONTROLS}` : CONTROLS;
    }
    // Last: opening the next window tears this renderer down.
    if (swap) this.beginSwap();
  }

  exit(): void {
    prompt.value = '';
    this.renderer?.dispose();
    this.renderer = null;
    if (this.hudKey) travelHud.value = null;
    this.hudKey = '';
  }

  leaveFromController(info: ControllerExit): void {
    if (this.recut || this.leaving) return;
    if (this.beginHop()) return;
    this.leave(controllerExitToMap(info, this.renderer?.bounds() ?? null));
  }

  /**
   * The wagon rolled off this zone and the hero walks off the edge after it:
   * cut the adjacent zone, with the road through it and the wagon where the
   * caravan now is, instead of dropping to the map. Only while a route is
   * still active (an arrived or cleared route has nothing to follow).
   */
  private beginHop(): boolean {
    const driver = this.driver;
    const status = this.renderer?.convoyStatus() ?? null;
    const world = this.host.world;
    if (!driver || !status?.gone || !hasRoute(world.caravan) || !this.host.recutConvoy) {
      return false;
    }
    const hero = driver.toMap(status.x, status.z, status.yaw);
    // The new zone leans down the road from where the hero walked out: they land near its
    // trailing edge with the road ahead, and a wagon not too far on is inside it too. With
    // no road ahead (halted, arrived) it stays centred toward the wagon as before.
    const ahead = world.convoyAhead(hero);
    this.hop = {
      centre: ahead
        ? { x: hero.x, y: hero.y, ahead }
        : zoneHopCentre(hero, { x: world.caravan.x, y: world.caravan.y }),
      hero,
    };
    this.recut = { phase: 'snap' };
    return true;
  }

  private stepConvoy(dt: number): void {
    const keys = this.host.keyboard;
    const renderer = this.renderer;
    if (!renderer || !this.driver) return;
    if (keys.consumePress('KeyB')) renderer.convoyCommand('bench');
    if (keys.consumePress('KeyG')) renderer.convoyCommand('rejoin');
    if (keys.consumePress('KeyH')) this.toggleHalt();
    for (const event of this.driver.step(dt)) {
      if (event.type === 'stopped') this.host.toast(`The caravan halts at ${event.name}.`);
      else this.host.toast(`The caravan reaches ${event.name ?? 'its destination'}.`);
    }
  }

  private toggleHalt(): void {
    const world = this.host.world;
    if (!hasRoute(world.caravan)) return;
    const halted = !world.caravan.halted;
    if (!world.setCaravanHalted(halted)) {
      this.host.toast('The leader decides when to stop.');
      return;
    }
    this.host.toast(halted ? 'The caravan halts.' : 'The caravan rolls on.');
  }

  /**
   * The 3D clock. While the wagon rolls it pays by road, the same TU per unit
   * as the map; standing still it runs at the area rate.
   */
  private advanceAreaClock(dt: number): void {
    // 3D time ignores the map's "time moves only when I move". It runs every
    // frame this scene updates; a popup or instance minigame pauses it by not
    // updating the scene at all. Halted at camp it still runs at the area rate.
    const hours = areaClockHours({
      paused: false,
      dt,
      roadHours: this.driver?.clockHours() ?? null,
      areaHoursPerRealSec: areaHoursPerRealSec(GAME_HOURS_PER_REAL_SECOND),
    });
    if (hours > 0) this.host.world.advanceClock(1, hours);
  }

  /** Cut the next window early, and start the swap once the wagon reaches the line. */
  private planRecut(): void {
    const driver = this.driver;
    if (!driver) return;
    if (!CONVOY_STREAM_RECUT) {
      this.noteWagonLeft();
      return;
    }
    if ((this.prepared || this.noWindow) && this.host.world.caravan.route !== this.preparedRoute) {
      this.prepared = null;
      this.noWindow = false;
    }
    const action = driver.recutAction(this.prepared !== null || this.noWindow, false);
    if (action === 'prepare') {
      const cut = this.host.prepareConvoyRecut?.(driver.recutCentre()) ?? null;
      this.prepared = cut;
      this.noWindow = cut === null;
      this.preparedRoute = this.host.world.caravan.route;
    } else if (action === 'swap') {
      this.recut = { phase: 'snap' };
    }
  }

  /**
   * Zones are instanced blocks: the wagon rolls on past the edge and leaves.
   * Say so once. The caravan keeps rolling on the map and the clock keeps running.
   */
  private noteWagonLeft(): void {
    const driver = this.driver;
    if (!driver || !driver.takeLeftNotice()) return;
    this.host.toast('The caravan rolled on ahead. Follow it, or return to the map.');
  }

  /** The world keeps rolling while the next window opens: no pause, no jump in the clock. */
  private stepRecut(dt: number): void {
    const driver = this.driver;
    if (!driver) return;
    for (const event of driver.step(dt)) {
      if (event.type === 'stopped') this.host.toast(`The caravan halts at ${event.name}.`);
      else this.host.toast(`The caravan reaches ${event.name ?? 'its destination'}.`);
    }
    this.advanceAreaClock(dt);
  }

  /** The still is held; open the next window behind it. */
  private beginSwap(): void {
    this.recut = { phase: 'load' };
    void this.loadRecut();
  }

  private async loadRecut(): Promise<void> {
    const driver = this.driver;
    const old = this.renderer;
    if (!driver || !old || !this.host.recutConvoy) return;
    const status = old.convoyStatus();
    const hero = status ? driver.toMap(status.x, status.z, status.yaw) : null;
    const mode = status?.mode ?? 'walk';
    const ready = this.prepared;
    const usable =
      ready?.convoy &&
      this.host.world.caravan.route === this.preparedRoute &&
      driver.fits(ready.convoy)
        ? ready
        : null;
    this.prepared = null;
    this.noWindow = false;
    const hop = this.hop;
    this.hop = null;
    const source = hop ? hop.centre : (usable ?? driver.recutCentre());
    old.dispose();
    this.renderer = null;
    const next = await this.host.recutConvoy(source, (fresh) => {
      if (mode !== 'free' || !hero || !status) return { convoyMode: mode };
      const pos = fresh.toLocal(hero.x, hero.y);
      return fresh.inside(pos.x, pos.z, 3)
        ? { convoyMode: mode, pos, yaw: status.yaw }
        : { convoyMode: 'walk' };
    });
    if (this.leaving) {
      next?.renderer.dispose();
      this.host.releaseFrame(0);
      return;
    }
    if (!next) {
      // No window ahead (water, a settlement). Hand back to the map: on foot where the
      // hero stood after a hop, otherwise beside the wagons.
      this.recut = null;
      this.host.releaseFrame(0);
      if (hop) {
        this.leave(exitFromCancel(0), { ...hop.hero, aboard: false });
        return;
      }
      this.leave(exitFromCancel(0), {
        x: this.host.world.caravan.x,
        y: this.host.world.caravan.y,
        yaw: this.host.world.caravan.yaw,
        aboard: true,
      });
      return;
    }
    // The controller's "Back on the map" card went up when the hero crossed the edge;
    // a hop stays in 3D, so take it down.
    if (hop) clearAreaLeaveOverlay(this.host.mapCanvas.ownerDocument);
    this.renderer = next.renderer;
    this.driver = next.driver;
    this.handoff = next.handoff;
    this.recut = null;
    this.host.releaseFrame(RECUT_DISSOLVE_SEC);
  }

  private publishTravel(): void {
    if (!this.driver) {
      // No convoy here (a town, say): the map's caravan panel must not linger over 3D.
      if (travelHud.peek()) travelHud.value = null;
      this.hudKey = '';
      return;
    }
    const status = this.renderer?.convoyStatus() ?? null;
    const hud = travelHudFor(this.host.world, {
      clockPaused: false,
      view: 'area',
      convoy: status
        ? { mode: status.mode, leash: status.leash, dist: status.dist, gone: status.gone === true }
        : null,
    });
    const key = travelHudKey(hud);
    if (key === this.hudKey) return;
    this.hudKey = key;
    travelHud.value = hud;
    const root = this.host.mapCanvas.parentElement;
    if (root && status) {
      root.dataset.convoyMode = status.mode;
      root.dataset.convoyLeash = status.leash;
      root.dataset.convoyDist = status.dist.toFixed(1);
    }
  }

  /** Where the hero lands: with the wagons, or wherever they walked off to. */
  private landing(): AreaLanding | null {
    const driver = this.driver;
    if (!driver) return null;
    const world = this.host.world;
    const status = this.renderer?.convoyStatus() ?? null;
    if (!status) {
      return { x: world.caravan.x, y: world.caravan.y, yaw: world.caravan.yaw, aboard: true };
    }
    const at = driver.toMap(status.x, status.z, status.yaw);
    // The wagon rolled on without them: they land on foot where they stand, and catch up.
    if (status.gone) return { ...at, aboard: false };
    return { ...at, aboard: status.mode !== 'free' || status.dist < ABOARD_RADIUS_M };
  }

  private leave(exit: AreaExit, landing?: AreaLanding | null): void {
    if (this.leaving) return;
    const land = landing ?? this.landing();
    this.leaving = true;
    void this.host.stack.push(new DiveScene(this.host, 'to-map', exit, land));
  }
}
