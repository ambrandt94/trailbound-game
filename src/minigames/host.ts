import {
  wagonPlayResult,
  type MinigameResult,
  type PartyState,
  type ResolvedMinigame,
} from '../core/sim/party';
import { createStage, disposeStage, type Stage } from './helpers/stage';
import { minigameHelpers } from './helpers/meter';
import type { SimAvatar } from './helpers/runtime';
import { PointerTracker, readMinigameInput, type MinigameActionSource } from './input-bridge';
import type {
  MinigameContext,
  MinigameDef,
  MinigameKind,
  MinigameStatus,
  WorldPose,
} from './types';

export interface MinigameHostOptions {
  root: HTMLElement;
  source: MinigameActionSource;
  readParty: () => PartyState;
  apply: (result: MinigameResult) => ResolvedMinigame;
  /** Persist after the world has applied the result. */
  onApplied?: () => void;
  world?: () => { scene: import('three').Scene; pose: WorldPose } | null;
  camYaw?: () => number;
  /** Pose the live player avatar inside an instance, if one is built. */
  syncAvatar?: (avatar: SimAvatar, dt: number) => void;
  releaseAvatar?: () => void;
}

type Phase = 'idle' | 'cover' | 'play' | 'card' | 'leaving';

/**
 * Overlay host for every minigame kind. World games keep the area simulating.
 * Popups freeze it. An instance asks the scene stack to pause the area.
 */
export class MinigameHost {
  private phase: Phase = 'idle';
  private def: MinigameDef | null = null;
  private quitButton = false;
  private wantsExitFlag = false;
  private gfx: Stage | null = null;
  private shell: HTMLElement | null = null;
  private frame: HTMLElement | null = null;
  private stageEl: HTMLElement | null = null;
  private canvas2d: HTMLCanvasElement | null = null;
  private canvas3d: HTMLCanvasElement | null = null;
  private fadeEl: HTMLElement | null = null;
  private cardEl: HTMLElement | null = null;
  private messageEl: HTMLElement | null = null;
  private linesEl: HTMLElement | null = null;
  private nameEl: HTMLElement | null = null;
  private footEl: HTMLElement | null = null;
  private hudEl: HTMLElement | null = null;
  private sideEl: HTMLElement | null = null;
  private cardAge = 0;
  private readonly pointer = new PointerTracker();
  private readonly context: MinigameContext;

  constructor(private readonly options: MinigameHostOptions) {
    this.context = {
      in: { x: 0, y: 0, hold: false },
      pointer: {
        x: 0.5,
        y: 0.5,
        down: false,
        dx: 0,
        dy: 0,
        tap: false,
        press: false,
        dragX: 0,
        dragY: 0,
        moved: false,
      },
      act: false,
      quit: false,
      canvas: null,
      gfx: null,
      scene: null,
      camera: null,
      worldScene: null,
      pose: null,
      A: null,
      camYaw: 45,
      hud: null,
      side: null,
      width: 480,
      height: 320,
      W: 160,
      H: 120,
      t: 0,
      over: false,
      supplies: options.readParty(),
      helpers: minigameHelpers,
      done: (result) => this.finish(result),
    };
  }

  get kind(): MinigameKind | null {
    return this.def?.type ?? null;
  }

  isOpen(): boolean {
    return this.phase !== 'idle';
  }

  isPlaying(): boolean {
    return this.phase === 'play';
  }

  /** While this is true the town must see a zeroed action snapshot. */
  locksAreaInput(): boolean {
    return this.isOpen();
  }

  get wantsExit(): boolean {
    return this.wantsExitFlag;
  }

  arm(def: MinigameDef): void {
    if (this.isOpen()) return;
    this.def = def;
    this.wantsExitFlag = false;
    this.quitButton = false;
    this.mount();
    this.phase = 'cover';
    this.options.root.dataset.minigame = def.id;
    this.options.root.dataset.minigamePhase = this.phase;
    if (def.type !== 'inst') this.beginPlay();
  }

  /** Called by the instance scene once the fade has covered the area. */
  beginPlay(): void {
    const def = this.def;
    if (!def || this.phase !== 'cover') return;
    this.phase = 'play';
    this.options.root.dataset.minigamePhase = 'play';
    this.ensureGraphics();
    this.layout();
    this.context.supplies = { ...this.options.readParty() };
    this.context.scene = this.gfx?.scene ?? null;
    this.context.camera = this.gfx?.camera ?? null;
    this.context.canvas = this.usesWebgl(def) ? this.canvas3d : this.canvas2d;
    this.context.gfx = this.canvas2d?.getContext('2d') ?? null;
    this.context.hud = this.hudEl;
    this.context.side = this.sideEl;
    this.context.t = 0;
    this.context.over = false;
    this.context.A = null;
    this.context.camYaw = this.options.camYaw?.() ?? 45;
    const world = this.options.world?.() ?? null;
    this.context.worldScene = world?.scene ?? null;
    this.context.pose = world?.pose ?? null;
    this.context.syncAvatar = (avatar) => this.options.syncAvatar?.(avatar, 0);
    this.options.source.areaActions();
    this.options.source.consumePress('Escape');
    def.start(this.context);
  }

  tick(dt: number): void {
    const def = this.def;
    if (!def || this.phase === 'idle' || this.phase === 'cover' || this.phase === 'leaving') return;
    this.layout();
    const input = readMinigameInput(
      this.options.source,
      this.pointer.sample(),
      def.drag === true,
      this.quitButton,
    );
    this.quitButton = false;
    this.context.in = input.in;
    this.context.pointer = input.pointer;
    this.context.act = input.act;
    this.context.quit = input.quit;
    const step = Math.min(0.05, Math.max(0, dt));
    if (this.phase === 'card') {
      this.cardAge += step;
      const wait = def.activity ? 0 : 0.4;
      if (
        this.cardAge > wait &&
        (input.act || input.quit || input.pointer.tap || input.pointer.press)
      ) {
        this.dismiss();
      }
      return;
    }
    if (input.quit) {
      if (def.activity)
        this.finish(wagonPlayResult(def.activity, { ok: false, message: 'You let it go.' }));
      else if (def.type === 'inst') this.leaveInstance();
      else this.closeNow();
      return;
    }
    this.context.t += step;
    def.update(this.context, step);
    if (this.context.A) this.options.syncAvatar?.(this.context.A, step);
    this.paintStatus();
    if (def.type === 'pop3d' || def.type === 'inst') this.render3d();
  }

  render3d(): void {
    if (!this.gfx || !this.def || (this.phase !== 'play' && this.phase !== 'card')) return;
    this.layout();
    this.gfx.renderer.render(this.gfx.scene, this.gfx.camera);
  }

  setCover(opacity: number): void {
    if (!this.fadeEl) return;
    this.fadeEl.style.opacity = String(Math.max(0, Math.min(1, opacity)));
  }

  hint(): string {
    const def = this.def;
    if (!def) return '';
    if (this.phase === 'card') return 'Space, F, or tap to close';
    const status = this.snapshot();
    return `${def.name} · ${status.detail} · Esc quits`;
  }

  snapshot(): MinigameStatus & { id: string; phase: string } {
    const fallback: MinigameStatus = { hot: false, hits: 0, beat: 0, detail: '' };
    const status = this.def?.status?.(this.context) ?? fallback;
    return { id: this.def?.id ?? '', phase: this.phase, ...status };
  }

  /** Finish the live game through the same result path a player would. */
  debugFinish(ok: boolean): void {
    const def = this.def;
    if (!def || this.phase !== 'play') return;
    if (def.activity) this.finish(wagonPlayResult(def.activity, { ok }));
    else this.finish({ ok, message: ok ? 'Done.' : 'Miss.' });
  }

  /** Hide the overlay after the instance fade has returned to the area. */
  finishExit(): void {
    this.closeNow();
  }

  private finish(result: MinigameResult): void {
    if (this.phase !== 'play' || !this.def) return;
    this.context.over = true;
    const applied = this.options.apply(result);
    this.cardAge = 0;
    this.phase = 'card';
    this.options.root.dataset.minigamePhase = 'card';
    if (this.messageEl) this.messageEl.textContent = applied.message;
    if (this.linesEl) this.linesEl.textContent = applied.lines.join('   ');
    if (this.cardEl) this.cardEl.hidden = false;
    this.options.onApplied?.();
  }

  private dismiss(): void {
    if (this.cardEl) this.cardEl.hidden = true;
    if (this.def?.type === 'inst') this.leaveInstance();
    else this.closeNow();
  }

  /** Hand the instance back to the scene stack so the fade can cover the return. */
  private leaveInstance(): void {
    this.phase = 'leaving';
    this.wantsExitFlag = true;
    this.options.root.dataset.minigamePhase = 'leaving';
  }

  private closeNow(): void {
    this.def?.end?.(this.context);
    this.options.releaseAvatar?.();
    this.phase = 'idle';
    this.wantsExitFlag = false;
    this.pointer.detach();
    this.disposeGraphics();
    if (this.shell) {
      this.shell.hidden = true;
      this.shell.className = '';
    }
    this.options.root.dataset.minigame = '';
    this.options.root.dataset.minigamePhase = '';
    this.def = null;
  }

  private mount(): void {
    const doc = this.options.root.ownerDocument;
    if (!this.shell) {
      const shell = doc.createElement('div');
      shell.id = 'mg';
      shell.hidden = true;
      shell.innerHTML =
        '<div id="mgfade"></div><div class="mg-frame"><header class="mg-bar"><strong class="mg-name"></strong><button type="button" class="mg-quit">✕ Quit</button></header><div class="mg-hud"></div><div class="mg-stage"><canvas class="mg-2d"></canvas><canvas class="mg-3d"></canvas><div class="mg-side"></div></div><p class="mg-foot"></p><div class="mg-card" hidden><p class="mg-message"></p><p class="mg-lines"></p><p class="mg-close">Space / F / tap to continue</p></div></div>';
      this.options.root.append(shell);
      this.shell = shell;
      this.fadeEl = shell.querySelector('#mgfade');
      this.frame = shell.querySelector('.mg-frame');
      this.stageEl = shell.querySelector('.mg-stage');
      this.canvas2d = shell.querySelector('.mg-2d');
      this.canvas3d = shell.querySelector('.mg-3d');
      this.cardEl = shell.querySelector('.mg-card');
      this.messageEl = shell.querySelector('.mg-message');
      this.linesEl = shell.querySelector('.mg-lines');
      this.nameEl = shell.querySelector('.mg-name');
      this.footEl = shell.querySelector('.mg-foot');
      this.hudEl = shell.querySelector('.mg-hud');
      this.sideEl = shell.querySelector('.mg-side');
      shell.querySelector('.mg-quit')?.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.quitButton = true;
      });
    }
    const def = this.def;
    if (!def || !this.shell || !this.frame) return;
    this.shell.hidden = false;
    const skin = def.activity ? 'wagon' : 'demo';
    this.shell.className = `open ${skin} ${def.type} ${def.size ?? 'part'}${def.drag ? ' drag' : ''}`;
    if (this.nameEl) this.nameEl.textContent = def.name;
    if (this.footEl) this.footEl.textContent = '';
    if (this.hudEl) this.hudEl.innerHTML = '';
    if (this.sideEl) this.sideEl.innerHTML = '';
    if (this.cardEl) this.cardEl.hidden = true;
    if (def.h && def.h > 200 && def.type !== 'world')
      this.frame.style.setProperty('--mg-h', `${def.h}px`);
    else this.frame.style.removeProperty('--mg-h');
    this.setCover(def.type === 'inst' ? 0 : 0);
    if (this.stageEl) this.pointer.attach(this.stageEl);
    if (this.canvas3d) this.canvas3d.hidden = !this.usesWebgl(def);
    if (this.canvas2d) this.canvas2d.hidden = this.usesWebgl(def);
  }

  private ensureGraphics(): void {
    const def = this.def;
    if (!def || !this.usesWebgl(def) || this.gfx || !this.canvas3d) return;
    const background = def.type === 'inst' ? '#e7c89a' : '#f4e2c4';
    try {
      this.gfx = createStage(this.canvas3d, background);
    } catch (error) {
      console.warn('minigame webgl', error);
    }
  }

  private disposeGraphics(): void {
    if (!this.gfx) return;
    disposeStage(this.gfx);
    this.gfx = null;
    this.context.scene = null;
    this.context.camera = null;
  }

  private layout(): void {
    const rect = this.stageEl?.getBoundingClientRect();
    let width = Math.round(rect?.width ?? 0);
    let height = Math.round(rect?.height ?? 0);
    if (width < 2 || height < 2) {
      width = this.def?.size === 'full' ? 960 : 520;
      height = this.def?.h ?? (this.def?.type === 'world' ? 220 : 340);
    }
    const pixel = this.def?.type === 'pop2d' && (this.def.h ?? 999) <= 200;
    if (pixel && this.canvas2d) {
      const gameH = this.def?.h ?? 120;
      const gameW = Math.max(40, Math.round((gameH * width) / Math.max(1, height)));
      if (this.canvas2d.width !== gameW) this.canvas2d.width = gameW;
      if (this.canvas2d.height !== gameH) this.canvas2d.height = gameH;
      const gfx = this.canvas2d.getContext('2d');
      if (gfx) gfx.imageSmoothingEnabled = false;
      this.context.gfx = gfx;
      this.context.W = gameW;
      this.context.H = gameH;
      this.context.width = gameW;
      this.context.height = gameH;
    } else {
      this.context.width = width;
      this.context.height = height;
      this.context.W = width;
      this.context.H = height;
      if (this.canvas2d) {
        if (this.canvas2d.width !== width) this.canvas2d.width = width;
        if (this.canvas2d.height !== height) this.canvas2d.height = height;
        this.context.gfx = this.canvas2d.getContext('2d');
      }
    }
    this.gfx?.resize(width, height);
  }

  private paintStatus(): void {
    if (!this.footEl || !this.def) return;
    const status = this.def.status?.(this.context);
    this.footEl.textContent = status?.detail ?? '';
  }

  private usesWebgl(def: MinigameDef): boolean {
    return def.type === 'pop3d' || def.type === 'inst';
  }
}
