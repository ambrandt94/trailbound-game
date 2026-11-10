import { migrate } from '../core/save/migrations';
import type { SaveBackend } from '../core/save/types';
import { areaLooksEqual, normalizeAreaLook, type AreaLook } from '../core/state/area-look';
import { normalizeSettings, type GameSettings } from '../core/state/settings';
import {
  createWorld,
  type AreaExit,
  type AreaHandoff,
  type WorldState,
} from '../core/state/world-state';
import { DEFAULT_WORLD_SEED } from '../core/world/index';
import {
  Biome,
  WORLD_BASE,
  clampSettings,
  DEFAULT_WORLD_SETTINGS,
  startScaleFor,
  type ChunkData,
  type WorldData,
} from '../core/world/models';
import { resolveLandStyle } from '../core/world/world-gen';
import type { ContentSource, PlaceContent } from '../core/content/parse';
import { formatClock } from '../core/sim/clock';
import { formatPartyReadout, wagonMenuRows, wagonRefusal } from '../core/sim/party';
import {
  getMinigame,
  listMinigames,
  MinigameHost,
  registerDemoMinigames,
  registerWagonMinigames,
} from '../minigames';
import type { SimAvatar } from '../minigames/helpers/runtime';
import { dayLightAt, tuOfDay } from '../core/sim/time';
import { Keyboard, type AreaActionSnapshot } from '../input/keyboard';
import { attachTouchControls } from '../input/touch/index';
import { loadTownFixture, townFixtureId } from '../render/area/area-from-export';
import { AreaRenderer } from '../render/area/area-renderer';
import { clearAreaLeaveOverlay } from '../render/area/leave-overlay';
import { MapRenderer, type MapDrawState } from '../render/map/map-renderer';
import type { SettingsStore } from '../platform/settings';
import {
  creatorBusy,
  creatorSerial,
  creatorSource,
  creatorView,
  newWorldLand,
} from '../ui/creator-state';
import {
  bindCommands,
  canContinue,
  clockRate,
  clockText,
  generating,
  hint,
  nearTown,
  minigameCatalog,
  notice,
  partyHud,
  savedFlash,
  wagonOpen,
  wagonRows,
  screen,
  settings,
  settingsOpen,
} from '../ui/state';
import {
  adoptPlayerBody,
  buildAvatar,
  getPlayerBody,
  forgeReady,
  forgeTimings,
  generateRecipe,
  initForge,
  placeholderAvatar,
  recipeFromStored,
} from '../render/characters/forge';
import type { PlayerAvatar } from '../core/people/avatar';
import type { Clock } from './fixed-step';
import { FrameClock } from './fixed-step';
import type { AppMode, GameHost } from './host';
import { SceneStack } from './scene-stack';
import { AreaView } from './scenes/area-view';
import { MinigameScene } from './scenes/minigame-scene';
import { BootScene } from './scenes/boot';
import { CharacterCreatorScene } from './scenes/character-creator';
import { MapView } from './scenes/map-view';
import { TransitionScene } from './scenes/transition';
import { codeForTouchAction } from './touch-wire';
import { CF_PIN, GAME_VERSION, PLAYER_NAME, SAVE_SLOT } from './version';

export interface GameOptions {
  clock: Clock;
  root: HTMLElement;
  mapCanvas: HTMLCanvasElement;
  areaCanvas: HTMLCanvasElement;
  baseUrl?: string;
  fade: HTMLElement;
  content: ContentSource;
  saves: SaveBackend;
  settings: SettingsStore;
  slotId?: string;
}

export class Game implements GameHost {
  readonly stack: SceneStack;
  readonly keyboard = new Keyboard();
  readonly minigames: MinigameHost;
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
  private creatorOpen = false;
  private avatarToken = 0;
  private townFixture: string | null = null;
  private detachTouch: (() => void) | null = null;
  private readonly jobs: Array<() => void> = [];
  private noticeTimer = 0;
  private avatarRestore: (() => void) | null = null;
  private instanceRig: SimAvatar['rig'] | null = null;

  constructor(options: GameOptions) {
    this.options = options;
    this.slot = options.slotId ?? SAVE_SLOT;
    this.stack = new SceneStack();
    this.clockLoop = new FrameClock(options.clock);
    this.world = createWorld({ id: 'waystead', name: 'Waystead', x: 8, y: 8 });
    this.mapRenderer = new MapRenderer(options.mapCanvas);
    settings.value = normalizeSettings(options.settings.load());
    this.minigames = new MinigameHost({
      root: options.root,
      source: this.keyboard,
      readParty: () => this.world.party,
      apply: (result) => this.world.applyMinigameResult(result),
      onApplied: () => {
        void this.persist();
      },
      world: () => this.areaScene?.worldView() ?? null,
      camYaw: () => settings.value.look.camYaw,
      syncAvatar: (avatar, dt) => this.syncInstanceAvatar(avatar, dt),
      releaseAvatar: () => this.releaseInstanceAvatar(),
    });
    registerWagonMinigames();
    registerDemoMinigames();
    minigameCatalog.value = listMinigames().map((game) => ({ id: game.id, name: game.name }));
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

  get mapCanvas(): HTMLCanvasElement {
    return this.options.mapCanvas;
  }

  pendingArea: AreaHandoff | null = null;

  async start(): Promise<void> {
    void this.mapRenderer.load(this.options.baseUrl ?? './');
    void this.mapRenderer.setSkin(settings.value.mapSkin, null);
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
    else if (mode === 'creator') screen.value = 'creator';
    else screen.value = 'play';
  }

  setView(view: 'map' | 'area'): void {
    this.view = view;
    this.applyCanvasVisibility();
  }

  setCreatorVisible(visible: boolean): void {
    this.creatorOpen = visible;
    this.applyCanvasVisibility();
  }

  setFade(opacity: number): void {
    const clamped = Math.min(1, Math.max(0, opacity));
    this.fadeOpacity = clamped;
    this.options.fade.style.opacity = String(clamped);
    this.options.root.dataset.fade = clamped.toFixed(3);
  }

  paintMap(state: MapDrawState): void {
    this.mapRenderer.draw(state);
  }

  syncChunks(chunks: ChunkData[]): void {
    if (!this.world.data || chunks.length === 0) return;
    this.mapRenderer.syncChunks(chunks, this.world.data);
  }

  enterArea(): void {
    if (this.stack.current()?.id !== 'map') return;
    if (this.mapScene && !this.mapScene.allowEnter()) return;
    const handoff = this.world.buildHandoffHere();
    if (!handoff) {
      hint.value = 'Open water. Walk ashore to enter.';
      return;
    }
    this.pendingArea = handoff;
    void this.stack.push(new TransitionScene(this, 'to-area'));
  }

  /** Open a registered minigame. Instance games pause the area on the scene stack. */
  openMinigame(id: string): boolean {
    const def = getMinigame(id);
    if (!def || this.minigames.isOpen()) return false;
    wagonOpen.value = false;
    settingsOpen.value = false;
    this.minigames.arm(def);
    if (def.type === 'inst') void this.stack.push(new MinigameScene(this));
    return true;
  }

  /** Open the wagon menu. Used by the screenshot harness. */
  showWagon(): void {
    this.refreshWagon();
    wagonOpen.value = true;
  }

  /** Point the map camera at a settlement. Used by the screenshot harness. */
  lookAt(name: string, scale?: number): boolean {
    const node = this.world.data?.nodes.find((item) => item.name === name || item.id === name);
    if (!node || !this.mapScene) return false;
    this.mapScene.lookAt(node.cx, node.cy, scale);
    return true;
  }

  /** Move the hero and point the map camera. Used by the screenshot harness. */
  frameAt(x: number, y: number, scale?: number): boolean {
    if (!this.world.data || !this.mapScene) return false;
    this.world.moveHero(x - this.world.hero.x, y - this.world.hero.y);
    this.mapScene.lookAt(x, y, scale);
    return true;
  }

  /** Move the hero onto a settlement so the location panel names it. */
  standAt(name: string): boolean {
    const node = this.world.data?.nodes.find((item) => item.name === name || item.id === name);
    if (!node) return false;
    this.world.moveHero(node.cx - this.world.hero.x, node.cy - this.world.hero.y);
    return true;
  }

  /** Frame the whole continent, a coast with a river, or Ironmarch up close. */
  frameScene(kind: 'world' | 'coast' | 'river' | 'snow' | 'ash' | 'ironmarch'): boolean {
    const data = this.world.data;
    if (!data || !this.mapScene) return false;
    if (kind === 'ironmarch') {
      this.standAt('Ironmarch');
      return this.lookAt('Ironmarch', 9);
    }
    if (kind === 'world') {
      this.mapScene.lookAt(data.width / 2, data.height / 2, startScaleFor(WORLD_BASE));
      return true;
    }
    if (kind === 'river') {
      const river = findRiver(data);
      if (!river) return false;
      this.mapScene.lookAt(river.x, river.y, 1.15);
      return true;
    }
    if (kind === 'snow' || kind === 'ash') {
      const id = kind === 'snow' ? Biome.Snow : Biome.Ashlands;
      const spot =
        findBiomeEdge(data, id, Biome.Sand) ??
        findBiomeEdge(data, id, Biome.Plains) ??
        findAnyEdge(data, id);
      if (!spot) return false;
      this.mapScene.lookAt(spot.x, spot.y, 1.15);
      return true;
    }
    const coast = findCoast(data);
    if (!coast) return false;
    this.mapScene.lookAt(coast.x, coast.y, 1.15);
    return true;
  }

  async enterTownNow(fixtureId: string): Promise<void> {
    if (!this.place) return;
    this.townFixture = fixtureId;
    this.pendingArea = null;
    this.world = createWorld({
      id: this.place.id,
      name: this.place.name,
      x: this.place.map.x,
      y: this.place.map.y,
    });
    settingsOpen.value = false;
    this.warmAvatar();
    const map = new MapView(this);
    this.mapScene = map;
    await this.stack.replace(map);
    this.setMode('map');
    this.setView('map');
    await this.stack.push(new TransitionScene(this, 'to-area'));
  }

  async buildArea(): Promise<void> {
    if (this.areaScene) return;
    let view: AreaView | null = null;
    try {
      if (!this.pendingArea && this.world.data) this.pendingArea = this.world.buildHandoffHere();
      const areaExport = this.pendingArea
        ? this.pendingArea.areaExport
        : !this.world.data || this.townFixture
          ? await loadTownFixture(
              townFixtureId(this.townFixture ?? globalThis.location?.search ?? ''),
            )
          : null;
      if (!areaExport) throw new Error('Open water. Walk ashore to enter.');
      const renderer = new AreaRenderer(this.options.areaCanvas, {
        getActions: () =>
          this.minigames.locksAreaInput() ? lockedAreaActions() : this.keyboard.areaActions(),
        onExit: (info) => {
          view?.leaveFromController(info);
        },
        getLook: () => this.areaLook(),
        onLook: (patch) => {
          this.applyLook(patch);
        },
        onWagon: () => {
          this.openWagon();
        },
        onMinigame: (id: string) => {
          this.openMinigame(id);
        },
      });
      await renderer.start(areaExport);
      view = new AreaView(this, renderer, this.pendingArea);
      this.areaScene = view;
      this.stack.insertUnderTop(view);
      this.setView('area');
    } catch (error) {
      hint.value = error instanceof Error ? error.message : 'Could not start the 3D view';
    }
  }

  leaveArea(exit?: AreaExit): void {
    clearAreaLeaveOverlay(this.options.fade.ownerDocument);
    if (this.areaScene) {
      this.stack.remove(this.areaScene);
      this.areaScene = null;
    }
    if (exit) this.world.placeHeroOutside(exit);
    this.mapScene?.noteAreaReturn();
    wagonOpen.value = false;
    this.setView('map');
    this.setFade(1);
    void this.persist();
  }

  enqueue(job: () => void): void {
    this.jobs.push(job);
  }

  private writeSettings(partial: Partial<GameSettings>): void {
    const next = normalizeSettings({ ...settings.value, ...partial });
    if (partial.look) next.look = normalizeAreaLook({ ...settings.value.look, ...partial.look });
    settings.value = next;
    this.options.settings.save(next);
    if (partial.mapSkin) void this.mapRenderer.setSkin(next.mapSkin, this.world.data);
  }

  /** Clock-driven sun, unless the settings lock holds the slider. */
  private areaLook(): AreaLook {
    const look = settings.value.look;
    if (settings.value.lockTimeOfDay) return look;
    const light = dayLightAt(this.world.clockHours);
    return {
      ...look,
      sunHour: light.sunHour,
      sunIntensity: light.sunIntensity,
      sunWarmth: light.sunWarmth,
      hemi: light.hemi,
      shadeCool: light.shadeCool,
      shadowSoft: light.shadowSoft,
      grass: light.grass,
      haze: light.haze,
      skyTop: light.skyTop,
      skyHor: light.skyHor,
      fog: light.fog,
    };
  }

  private syncInstanceAvatar(avatar: SimAvatar, dt: number): void {
    const rig = avatar.rig;
    if (!rig) return;
    this.instanceRig = rig;
    if (this.useForgeBody(avatar, dt)) return;
    const hero = (
      globalThis as {
        TBAvatar?: {
          dressHero?: (target: SimAvatar['rig']) => boolean;
          drive?: (target: SimAvatar['rig'], pawn: SimAvatar, dt: number) => boolean;
        };
      }
    ).TBAvatar;
    if (!hero?.dressHero || !hero.drive) return;
    if (!hero.dressHero(rig)) return;
    hero.drive(rig, avatar, dt);
  }

  /** Forge body when the area has one. Otherwise the caller dresses the area hero. */
  private useForgeBody(avatar: SimAvatar, dt: number): boolean {
    const body = getPlayerBody();
    const rig = avatar.rig?.root ?? null;
    const scene = rig?.parent ?? null;
    if (!body || body.source !== 'forge' || !rig || !scene) return false;
    let meshes = 0;
    body.object3D.traverse((node) => {
      if ((node as { isMesh?: boolean }).isMesh) meshes += 1;
    });
    if (meshes < 1) return false;
    if (!this.avatarRestore) {
      const parent = body.object3D.parent;
      scene.add(body.object3D);
      rig.visible = false;
      this.avatarRestore = () => {
        rig.visible = true;
        if (parent) parent.add(body.object3D);
        else body.object3D.removeFromParent();
      };
    }
    body.object3D.visible = true;
    body.object3D.position.set(avatar.x, avatar.y, avatar.z);
    body.object3D.rotation.y = avatar.yaw;
    body.object3D.scale.setScalar(1);
    const speed = Math.hypot(avatar.vx, avatar.vz);
    body.present({
      clip: speed > 0.4 ? 'Walk' : 'Idle',
      timeScale: speed > 0.4 ? Math.max(0.6, speed / 1.4) : 1,
      fade: 0.12,
    });
    body.update(dt);
    return true;
  }

  private releaseInstanceAvatar(): void {
    const heroRoot = (this.instanceRig as { heroRoot?: { removeFromParent(): void } } | null)
      ?.heroRoot;
    heroRoot?.removeFromParent();
    this.instanceRig = null;
    this.avatarRestore?.();
    this.avatarRestore = null;
  }

  private openWagon(): void {
    wagonOpen.value = !wagonOpen.value;
    if (wagonOpen.value) this.refreshWagon();
  }

  private refreshWagon(): void {
    wagonRows.value = wagonMenuRows(tuOfDay(this.world.clockHours));
  }

  private armNotice(): void {
    this.noticeTimer += 1;
    const token = this.noticeTimer;
    setTimeout(() => {
      if (token === this.noticeTimer) notice.value = '';
    }, 2800);
  }

  private applyLook(patch: unknown): void {
    const look = normalizeAreaLook({ ...settings.value.look, ...(patch as Partial<AreaLook>) });
    if (areaLooksEqual(look, settings.value.look)) return;
    this.writeSettings({ look });
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
        this.writeSettings(partial);
      },
      enterPlace: () => {
        this.enterArea();
      },
      wagonAct: (id) => {
        if (id === 'sleep') {
          notice.value = this.world.useWagon(id);
          wagonOpen.value = false;
          this.refreshWagon();
          this.armNotice();
          return;
        }
        const refusal = wagonRefusal(this.world.party, id, tuOfDay(this.world.clockHours));
        if (refusal) {
          notice.value = refusal;
          this.armNotice();
          return;
        }
        const opened = this.openMinigame(wagonGameId(id));
        if (!opened) {
          notice.value = 'Not now.';
          this.armNotice();
        }
      },
      closeWagon: () => {
        wagonOpen.value = false;
      },
      launchMinigame: (id) => {
        settingsOpen.value = false;
        if (!this.openMinigame(id)) {
          notice.value = this.minigames.isOpen() ? 'Finish this one first.' : 'Not now.';
          this.armNotice();
        }
      },
      save: () => {
        void this.save();
      },
      editAvatar: () => {
        void this.editAvatar();
      },
    });
  }

  private async newGame(): Promise<void> {
    if (!this.place) return;
    generating.value = true;
    settingsOpen.value = false;
    savedFlash.value = '';
    await new Promise((resolve) => {
      setTimeout(resolve, 40);
    });
    this.world = createWorld({
      id: this.place.id,
      name: this.place.name,
      x: this.place.map.x,
      y: this.place.map.y,
    });
    this.world.beginGeneratedWorld(DEFAULT_WORLD_SEED, {
      settings: clampSettings({ ...DEFAULT_WORLD_SETTINGS, mapStyle: newWorldLand.value }),
    });
    await this.mapRenderer.load(this.options.baseUrl ?? './');
    await this.mapRenderer.setSkin(settings.value.mapSkin, this.world.data);
    generating.value = false;
    await this.openCreator('new');
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
    generating.value = true;
    await new Promise((resolve) => {
      setTimeout(resolve, 40);
    });
    this.world = createWorld({
      id: this.place?.id ?? 'waystead',
      name: this.place?.name ?? 'Waystead',
      x: this.place?.map.x ?? 8,
      y: this.place?.map.y ?? 8,
    });
    this.world.beginGeneratedWorld(migrated.core.worldSeed, { keepHero: true });
    this.world.load(migrated.core);
    await this.mapRenderer.load(this.options.baseUrl ?? './');
    await this.mapRenderer.setSkin(settings.value.mapSkin, this.world.data);
    generating.value = false;
    settingsOpen.value = false;
    savedFlash.value = '';
    this.warmAvatar();
    await this.enterMap();
  }

  private async openCreator(intent: 'new' | 'edit'): Promise<void> {
    if (this.stack.current()?.id === 'CharacterCreator') return;
    this.avatarToken += 1;
    const returnMode = this.mode === 'creator' ? 'map' : this.mode;
    const returnView = this.view;
    settingsOpen.value = false;
    if (intent === 'edit' && returnMode === 'title') {
      const manifest = await this.saves.readManifest(this.slot);
      const core = await this.saves.readCore(this.slot);
      if (manifest && core) {
        const migrated = migrate(manifest, core);
        if (migrated.core) this.world.load(migrated.core);
      }
    }
    await this.stack.push(
      new CharacterCreatorScene(this, {
        intent,
        initial: this.world.avatar,
        paperdoll: intent === 'edit',
        onConfirm: async (avatar) => {
          this.world.setAvatar(avatar);
          await this.persist();
          await this.stack.pop();
          if (intent === 'new') {
            const resolved = resolveLandStyle(newWorldLand.value, DEFAULT_WORLD_SEED);
            if (this.world.data?.settings.mapStyle !== resolved) {
              this.world.beginGeneratedWorld(DEFAULT_WORLD_SEED, {
                settings: clampSettings({
                  ...DEFAULT_WORLD_SETTINGS,
                  mapStyle: newWorldLand.value,
                }),
              });
              await this.mapRenderer.setSkin(settings.value.mapSkin, this.world.data);
            }
            await this.enterMap();
            return;
          }
          this.setMode(returnMode);
          this.setView(returnView);
          this.setCreatorVisible(false);
        },
        onCancel: async () => {
          await this.stack.pop();
          this.setMode(intent === 'new' ? 'title' : returnMode);
          this.setView(returnView);
          this.setCreatorVisible(false);
        },
      }),
    );
  }

  private warmAvatar(): void {
    const token = this.avatarToken;
    const avatar = this.world.avatar;
    void this.buildSaved(avatar)
      .then((body) => {
        if (token !== this.avatarToken) {
          body.dispose();
          return;
        }
        adoptPlayerBody(body);
      })
      .catch((error: unknown) => {
        console.warn('avatar warmup', error);
      });
  }

  private async buildSaved(avatar: PlayerAvatar) {
    await initForge();
    if (!forgeReady().ok) return placeholderAvatar(avatar.seed);
    if (avatar.recipe)
      return buildAvatar(recipeFromStored(avatar.recipe, avatar.seed), { budgetMs: 8 });
    return buildAvatar(
      generateRecipe({
        seed: avatar.seed,
        profileEntry: avatar.profileEntry,
        race: avatar.race,
        gender: avatar.gender,
        generatorVersion: avatar.generatorVersion,
      }),
      { budgetMs: 8 },
    );
  }

  private async editAvatar(): Promise<void> {
    await this.openCreator('edit');
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

  private applyCanvasVisibility(): void {
    this.options.mapCanvas.style.visibility = this.creatorOpen ? 'hidden' : 'visible';
    this.options.areaCanvas.style.visibility =
      !this.creatorOpen && this.view === 'area' ? 'visible' : 'hidden';
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
    root.dataset.scene = this.stack.current()?.id ?? '';
    const drafting = this.mode === 'creator';
    const draft = creatorView.value;
    root.dataset.avatarName = drafting ? draft.name : this.world.avatar.name;
    root.dataset.avatarRace = drafting ? draft.race : this.world.avatar.race;
    root.dataset.avatarGender = drafting ? draft.gender : this.world.avatar.gender;
    root.dataset.avatarSeed = String(drafting ? draft.seed : this.world.avatar.seed);
    root.dataset.avatarHash = drafting && draft.hash ? draft.hash : this.world.avatar.recipeHash;
    root.dataset.building = creatorBusy.value ? 'true' : 'false';
    root.dataset.avatarSource = creatorSource.value;
    const timings = forgeTimings();
    root.dataset.cfInitMs = timings.initMs.toFixed(0);
    root.dataset.cfBuildMs = timings.buildMs.toFixed(0);
    root.dataset.buildSerial = String(creatorSerial.value);
    const text = formatClock(this.world.clockHours);
    root.dataset.clock = text;
    root.dataset.clockRate = clockRate.value;
    const readout = formatPartyReadout(this.world.clockHours, this.world.party);
    if (partyHud.value !== readout) partyHud.value = readout;
    if (wagonOpen.value) {
      const rows = wagonMenuRows(tuOfDay(this.world.clockHours));
      const shown = wagonRows.value;
      const same =
        rows.length === shown.length && rows.every((row, index) => row.id === shown[index]?.id);
      if (!same) wagonRows.value = rows;
    }
    root.dataset.party = readout;
    root.dataset.tu = tuOfDay(this.world.clockHours).toFixed(2);
    if (this.mapScene) root.dataset.enterCooldown = this.mapScene.allowEnter() ? '0' : '1';
    root.dataset.bakeMs = this.mapRenderer.bakeMs.toFixed(1);
    root.dataset.detailMs = this.mapRenderer.detailMs.toFixed(1);
    root.dataset.drawMs = this.mapRenderer.drawMs.toFixed(2);
    root.dataset.lodBytes = String(this.mapRenderer.lodBytes);
    root.dataset.farReady = this.mapRenderer.farReady ? 'true' : 'false';
    root.dataset.fps = this.mapRenderer.fps.toFixed(1);
    root.dataset.skin = settings.value.mapSkin;
    root.dataset.place = this.world.town.name;
    root.dataset.chunks = String(this.world.chunks.size);
    if (clockText.value !== text) clockText.value = text;
  }

  private readonly onFrame = (): void => {
    if (!this.running) return;
    this.clockLoop.frame(
      (dt) => {
        this.stack.update(dt);
        const top = this.stack.current();
        if (this.minigames.isOpen() && this.minigames.kind !== 'inst' && top?.id !== 'area') {
          this.minigames.tick(dt);
        }
        this.flushJobs();
      },
      (alpha) => {
        this.renderFrame(alpha);
      },
    );
    this.raf = requestAnimationFrame(this.onFrame);
  };
}

function wagonGameId(id: 'hunt' | 'cook' | 'eat' | 'wash'): string {
  if (id === 'hunt') return 'wagon_hunt';
  if (id === 'cook') return 'wagon_cook';
  if (id === 'eat') return 'wagon_eat';
  return 'wagon_wash';
}

function lockedAreaActions(): AreaActionSnapshot {
  const pad = {
    x: 0,
    z: 0,
    jump: false,
    sprint: false,
    sneak: false,
    roll: false,
    use: false,
    emote: false,
  };
  return {
    p1: { ...pad },
    p2: { ...pad },
    camLeft: false,
    camRight: false,
    camUp: false,
    camDown: false,
    view: false,
    mode: false,
  };
}

function findRiver(world: WorldData): { x: number; y: number } | null {
  const width = world.width;
  for (let y = 20; y < world.height - 20; y += 6) {
    for (let x = 20; x < width - 20; x += 6) {
      if (world.biomes[x + y * width] !== Biome.Water) continue;
      const land =
        (world.biomes[x + 3 + y * width] !== Biome.Water ? 1 : 0) +
        (world.biomes[x - 3 + y * width] !== Biome.Water ? 1 : 0);
      const along =
        world.biomes[x + (y - 6) * width] === Biome.Water &&
        world.biomes[x + (y + 6) * width] === Biome.Water;
      if (land >= 1 && along && y > world.height * 0.2 && y < world.height * 0.8) return { x, y };
    }
  }
  return null;
}

function findAnyEdge(world: WorldData, id: Biome): { x: number; y: number } | null {
  const width = world.width;
  for (let y = 8; y < world.height - 8; y += 3) {
    for (let x = 8; x < width - 8; x += 3) {
      if (world.biomes[x + y * width] !== id) continue;
      const east = world.biomes[x + 1 + y * width];
      if (east !== undefined && east !== id) return { x, y };
    }
  }
  return null;
}

function findBiomeEdge(world: WorldData, a: Biome, b: Biome): { x: number; y: number } | null {
  const width = world.width;
  for (let y = 8; y < world.height - 8; y += 4) {
    for (let x = 8; x < width - 8; x += 4) {
      const here = world.biomes[x + y * width];
      if (here !== a) continue;
      const east = world.biomes[x + 1 + y * width];
      const south = world.biomes[x + (y + 1) * width];
      if (east === b || south === b) return { x, y };
    }
  }
  return null;
}

function findCoast(world: WorldData): { x: number; y: number } | null {
  const width = world.width;
  let best: { x: number; y: number; score: number } | null = null;
  for (let y = 12; y < width - 12; y += 8) {
    for (let x = 12; x < width - 12; x += 8) {
      if (world.biomes[x + y * width] !== Biome.Water) continue;
      let land = 0;
      let water = 0;
      for (const [dx, dy] of [
        [8, 0],
        [-8, 0],
        [0, 8],
        [0, -8],
      ] as const) {
        const neighbor = world.biomes[x + dx + (y + dy) * width];
        if (neighbor === Biome.Water) water += 1;
        else land += 1;
      }
      if (land < 1 || water < 1) continue;
      const score = land * 2 + (water === 2 ? 4 : 0);
      if (!best || score > best.score) best = { x, y, score };
    }
  }
  return best;
}
