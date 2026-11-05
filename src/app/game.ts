import { migrate } from '../core/save/migrations';
import type { SaveBackend } from '../core/save/types';
import { normalizeSettings } from '../core/state/settings';
import { createWorld, type AreaExit, type WorldState } from '../core/state/world-state';
import type { ContentSource, PlaceContent } from '../core/content/parse';
import { formatClock } from '../core/sim/clock';
import { Keyboard } from '../input/keyboard';
import { attachTouchControls } from '../input/touch/index';
import { AreaRenderer } from '../render/area/area-renderer';
import { MapRenderer } from '../render/map/map-renderer';
import type { SettingsStore } from '../platform/settings';
import {
  bindCommands,
  canContinue,
  clockText,
  hint,
  nearTown,
  savedFlash,
  screen,
  settings,
  settingsOpen,
} from '../ui/state';
import type { Clock } from './fixed-step';
import { FrameClock } from './fixed-step';
import type { AppMode, GameHost } from './host';
import { SceneStack } from './scene-stack';
import { AreaView } from './scenes/area-view';
import { BootScene } from './scenes/boot';
import { MapView } from './scenes/map-view';
import { codeForTouchAction } from './touch-wire';
import { CF_PIN, GAME_VERSION, PLAYER_NAME, SAVE_SLOT } from './version';

export interface GameOptions {
  clock: Clock;
  root: HTMLElement;
  mapCanvas: HTMLCanvasElement;
  areaCanvas: HTMLCanvasElement;
  fade: HTMLElement;
  content: ContentSource;
  saves: SaveBackend;
  settings: SettingsStore;
  slotId?: string;
}

export class Game implements GameHost {
  readonly stack: SceneStack;
  readonly keyboard = new Keyboard();
  world: WorldState;
  place: PlaceContent | null = null;
  view: 'map' | 'area' = 'map';

  private readonly options: GameOptions;
  private readonly clockLoop: FrameClock;
  private readonly mapRenderer: MapRenderer;
  private readonly slot: string;
  private mapScene: MapView | null = null;
  private areaScene: AreaView | null = null;
  private mode: AppMode = 'boot';
  private fadeOpacity = 0;
  private running = false;
  private raf = 0;
  private saveCount = 0;
  private saved = false;
  private detachTouch: (() => void) | null = null;
  private readonly jobs: Array<() => void> = [];

  constructor(options: GameOptions) {
    this.options = options;
    this.slot = options.slotId ?? SAVE_SLOT;
    this.stack = new SceneStack();
    this.clockLoop = new FrameClock(options.clock);
    this.world = createWorld({ id: 'waystead', name: 'Waystead', x: 8, y: 8 });
    this.mapRenderer = new MapRenderer(options.mapCanvas);
    settings.value = normalizeSettings(options.settings.load());
    this.bindUi();
    this.setMode('boot');
    this.setFade(0);
    this.setView('map');
  }

  get content(): ContentSource {
    return this.options.content;
  }

  get saves(): SaveBackend {
    return this.options.saves;
  }

  get areaCanvas(): HTMLCanvasElement {
    return this.options.areaCanvas;
  }

  async start(): Promise<void> {
    this.keyboard.attach(window);
    this.detachTouch = attachTouchControls(this.options.root, {
      setHeld: (action, held) => {
        this.keyboard.setHeld(codeForTouchAction(action), held);
      },
    });
    this.running = true;
    await this.stack.push(new BootScene(this));
    this.raf = requestAnimationFrame(this.onFrame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.keyboard.detach(window);
    this.detachTouch?.();
    this.detachTouch = null;
    this.areaScene?.exit();
    this.areaScene = null;
    this.mapRenderer.dispose();
  }

  setMode(mode: AppMode): void {
    this.mode = mode;
    this.options.root.dataset.mode = mode;
    if (mode === 'boot') screen.value = 'boot';
    else if (mode === 'title') screen.value = 'title';
    else screen.value = 'play';
  }

  setView(view: 'map' | 'area'): void {
    this.view = view;
    this.options.mapCanvas.style.visibility = 'visible';
    this.options.areaCanvas.style.visibility = view === 'area' ? 'visible' : 'hidden';
  }

  setFade(opacity: number): void {
    const clamped = Math.min(1, Math.max(0, opacity));
    this.fadeOpacity = clamped;
    this.options.fade.style.opacity = String(clamped);
    this.options.root.dataset.fade = clamped.toFixed(3);
  }

  paintMap(pose: { x: number; y: number; yaw: number }): void {
    this.mapRenderer.draw({
      seed: this.world.seed,
      heroX: pose.x,
      heroY: pose.y,
      heroYaw: pose.yaw,
      townX: this.world.town.x,
      townY: this.world.town.y,
      townName: this.world.town.name,
    });
  }

  buildArea(): void {
    if (this.areaScene) return;
    try {
      const renderer = new AreaRenderer(this.options.areaCanvas);
      const view = new AreaView(this, renderer);
      this.areaScene = view;
      this.stack.insertUnderTop(view);
      this.setView('area');
    } catch (error) {
      hint.value = error instanceof Error ? error.message : 'Could not start the 3D view';
    }
  }

  leaveArea(exit?: AreaExit): void {
    if (this.areaScene) {
      this.stack.remove(this.areaScene);
      this.areaScene = null;
    }
    if (exit) this.world.placeHeroOutside(exit);
    this.setView('map');
    void this.persist();
  }

  enqueue(job: () => void): void {
    this.jobs.push(job);
  }

  private bindUi(): void {
    bindCommands({
      newGame: () => {
        void this.newGame();
      },
      continueGame: () => {
        void this.continueGame();
      },
      openSettings: () => {
        settingsOpen.value = true;
      },
      closeSettings: () => {
        settingsOpen.value = false;
      },
      changeSettings: (partial) => {
        const next = normalizeSettings({ ...settings.value, ...partial });
        settings.value = next;
        this.options.settings.save(next);
      },
      save: () => {
        void this.save();
      },
    });
  }

  private async newGame(): Promise<void> {
    if (!this.place) return;
    this.world = createWorld({
      id: this.place.id,
      name: this.place.name,
      x: this.place.map.x,
      y: this.place.map.y,
    });
    settingsOpen.value = false;
    savedFlash.value = '';
    await this.enterMap();
  }

  private async continueGame(): Promise<void> {
    const manifest = await this.saves.readManifest(this.slot);
    const core = await this.saves.readCore(this.slot);
    if (!manifest || !core) {
      canContinue.value = false;
      return;
    }
    const migrated = migrate(manifest, core);
    if (!migrated.core) return;
    this.world.load(migrated.core);
    if (this.place) {
      this.world.town = {
        id: this.place.id,
        name: this.place.name,
        x: this.place.map.x,
        y: this.place.map.y,
      };
    }
    settingsOpen.value = false;
    savedFlash.value = '';
    await this.enterMap();
  }

  private async enterMap(): Promise<void> {
    const map = new MapView(this);
    this.mapScene = map;
    await this.stack.replace(map);
    this.setMode('map');
    this.setView('map');
  }

  private async save(): Promise<void> {
    try {
      await this.persist();
    } catch {
      this.saved = false;
      savedFlash.value = 'Save failed';
      this.options.root.dataset.saved = 'false';
    }
  }

  private async persist(): Promise<void> {
    const core = this.world.toPacked({
      gameVersion: GAME_VERSION,
      cfPin: CF_PIN,
      playerName: PLAYER_NAME,
    });
    await this.saves.write(this.slot, { core });
    this.saveCount += 1;
    this.saved = true;
    savedFlash.value = 'Saved';
    canContinue.value = true;
    this.options.root.dataset.saveCount = String(this.saveCount);
    this.options.root.dataset.saved = 'true';
    this.options.root.dataset.canContinue = 'true';
  }

  private flushJobs(): void {
    const pending = this.jobs.splice(0, this.jobs.length);
    for (const job of pending) job();
  }

  private renderFrame(alpha: number): void {
    const top = this.stack.current();
    if (this.mapScene) this.mapScene.render(alpha);
    if (this.view === 'area') this.areaScene?.render(alpha);
    if (top && top !== this.mapScene && top !== this.areaScene) top.render(alpha);
    this.publish();
  }

  private publish(): void {
    const root = this.options.root;
    root.dataset.mode = this.mode;
    root.dataset.fade = this.fadeOpacity.toFixed(3);
    root.dataset.heroX = this.world.hero.x.toFixed(3);
    root.dataset.heroY = this.world.hero.y.toFixed(3);
    root.dataset.nearTown = nearTown.value ? 'true' : 'false';
    root.dataset.saved = this.saved ? 'true' : 'false';
    root.dataset.saveCount = String(this.saveCount);
    root.dataset.canContinue = canContinue.value ? 'true' : 'false';
    const text = formatClock(this.world.clockHours);
    root.dataset.clock = text;
    if (clockText.value !== text) clockText.value = text;
  }

  private readonly onFrame = (): void => {
    if (!this.running) return;
    this.clockLoop.frame(
      (dt) => {
        this.stack.update(dt);
        this.flushJobs();
      },
      (alpha) => {
        this.renderFrame(alpha);
      },
    );
    this.raf = requestAnimationFrame(this.onFrame);
  };
}
