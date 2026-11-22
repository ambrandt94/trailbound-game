/**
 * World Gen screen: the planet as a globe or flat world map, and any chunk's
 * full local map generated on demand. New games edit the creator's world
 * draft here; an existing world opens read-only (from the map's More menu or
 * the pause menu) so its other chunks can be looked at.
 *
 * Everything inspected lives in this scene only: chunk maps are generated in
 * a worker, held in a small in-memory LRU while the screen is open, and
 * dropped on exit. Nothing is saved and game logic never sees them; the
 * playable world is still just the home chunk.
 */
import { batch } from '@preact/signals';
import {
  chunkKey,
  chunkLatLon,
  chunkToSphere,
  makePlanetField,
  PLANET_PRESET_SPECS,
  sameChunk,
  scoreStartChunk,
  homeChunk,
  type ChunkAddr,
  type PlanetField,
} from '../../core/planet';
import { Biome, clampSettings, type WorldSettings } from '../../core/world/models';
import { MIN_HOME_LAND, chunkLandShare, settingsShape } from '../../core/world/planet-chunk';
import { ChunkCache } from '../../render/worldgen/chunk-cache';
import { ChunkView } from '../../render/worldgen/chunk-view';
import { JobRunner } from '../../render/worldgen/job-runner';
import type { BakeDone, ChunkDone, WorldGenReply } from '../../render/worldgen/jobs';
import { flatFitRadius, globeFitRadius, wrapAngle } from '../../render/worldgen/projection';
import { WorldGenView } from '../../render/worldgen/view';
import {
  newWorldGen,
  newWorldSeed,
  newWorldSettings,
  setNewWorldGen,
} from '../../ui/creator-state';
import {
  bindWorldGen,
  DEFAULT_WG_LAYERS,
  wgBake,
  wgCached,
  wgChunk,
  wgClock,
  wgExisting,
  wgInspect,
  wgLayers,
  wgMode,
  wgPickStart,
  wgStart,
  wgStarts,
  type WgMode,
} from '../../ui/worldgen-state';
import type { Scene } from '../scene-stack';

/** Slider previews: small and quick (≈0.4 s); the full bake follows. */
const PREVIEW = { w: 512, h: 256 };
const FULL = { w: 1536, h: 768 };
const PREVIEW_DEBOUNCE_MS = 140;
/** Inspector raster side (the map is generated at full size, then shrunk). */
const CHUNK_RASTER = 1536;
const DRAG_PX = 5;
/** First guesses at generation time by world scale, ms; refined by measurement. */
const GEN_GUESS_MS: Record<number, number> = {
  1: 350,
  2: 500,
  4: 800,
  8: 1400,
  16: 3200,
  32: 12000,
};

export interface WorldGenOptions {
  /** Open an existing world read-only; null edits the next new world. */
  existing: { seed: number; settings: WorldSettings } | null;
  onConfirm(): void | Promise<void>;
  onQuickStart(): void | Promise<void>;
  onClose(): void | Promise<void>;
}

export class WorldGenScene implements Scene {
  readonly id = 'WorldGen';
  private stage: HTMLDivElement | null = null;
  private view: WorldGenView | null = null;
  private chunkView: ChunkView | null = null;
  private readonly bakeRunner = new JobRunner((r) => this.onBake(r));
  private readonly chunkRunner = new JobRunner((r) => this.onChunk(r));
  private readonly cache = new ChunkCache();
  private bakeKey = '';
  private bakeStage: 'preview' | 'full' | '' = '';
  private debounce: ReturnType<typeof setTimeout> | null = null;
  private field: { key: string; field: PlanetField } | null = null;
  private chunkJob: { id: number; addr: ChunkAddr; key: string } | null = null;
  private genRatio = 1;
  private lastMode: Exclude<WgMode, 'chunk'> = 'globe';
  private pointer: { id: number; x: number; y: number; moved: boolean } | null = null;
  /** The view has been dragged or zoomed: stop re-centring it on the start. */
  private steered = false;
  /** The globe's tilt, kept while the flat map (always level) is shown. */
  private globeLat0 = 0.35;
  private readonly cleanups: Array<() => void> = [];

  constructor(private readonly options: WorldGenOptions) {}

  /** The world being shown: the new-world draft, or the existing world's settings. */
  settings(): WorldSettings {
    return this.options.existing ? this.options.existing.settings : newWorldSettings();
  }

  seed(): number {
    return this.options.existing ? this.options.existing.seed : newWorldSeed.value;
  }

  get readOnly(): boolean {
    return !!this.options.existing;
  }

  enter(): void {
    batch(() => {
      wgExisting.value = this.options.existing;
      wgMode.value = 'globe';
      wgLayers.value = { ...DEFAULT_WG_LAYERS };
      wgInspect.value = null;
      wgChunk.value = null;
      wgCached.value = [];
      wgPickStart.value = false;
      wgStarts.value = [];
      wgStart.value = null;
    });
    if (typeof document !== 'undefined') this.mount();
    bindWorldGen({
      setSettings: (patch) => this.patchSettings(patch),
      setSeed: (seed) => {
        if (this.readOnly) return;
        newWorldSeed.value = Math.max(1, Math.min(2 ** 31 - 1, Math.floor(seed) || 1));
        setNewWorldGen({ homeChunk: null });
        this.settingsChanged();
      },
      rerollSeed: () => {
        if (this.readOnly) return;
        newWorldSeed.value = 1 + Math.floor(Math.random() * 999_999);
        setNewWorldGen({ homeChunk: null });
        this.settingsChanged();
      },
      setMode: (mode) => this.setMode(mode),
      setLayers: (patch) => {
        wgLayers.value = { ...wgLayers.value, ...patch };
        this.applyLayers();
      },
      autoStart: () => {
        if (this.readOnly) return;
        setNewWorldGen({ homeChunk: null });
        this.syncStart();
      },
      rerollStart: () => this.rerollStart(),
      togglePickStart: () => {
        if (this.readOnly) return;
        wgPickStart.value = !wgPickStart.value;
      },
      openChunk: (addr) => this.openChunk(addr),
      cancelChunk: () => this.cancelChunk(),
      backToPlanet: () => this.backToPlanet(),
      confirm: () => void this.options.onConfirm(),
      quickStart: () => void this.options.onQuickStart(),
      close: () => void this.options.onClose(),
    });
    this.requestBake(true);
    this.syncStart();
  }

  update(): void {
    const job = wgChunk.value;
    if (job?.state === 'generating') {
      const now = Math.floor(performance.now() / 100);
      if (wgClock.value !== now) wgClock.value = now;
    }
  }

  render(): void {
    if (wgMode.value === 'chunk') this.chunkView?.render();
    else this.view?.render();
  }

  exit(): void {
    if (this.debounce) clearTimeout(this.debounce);
    this.bakeRunner.dispose();
    this.chunkRunner.dispose();
    this.cache.clear();
    for (const off of this.cleanups.splice(0)) off();
    this.view?.dispose();
    this.chunkView?.dispose();
    this.stage?.remove();
    this.stage = null;
    this.view = null;
    this.chunkView = null;
    this.field = null;
    batch(() => {
      wgExisting.value = null;
      wgInspect.value = null;
      wgChunk.value = null;
      wgCached.value = [];
      wgStarts.value = [];
      wgStart.value = null;
      wgBake.value = { state: 'idle', progress: 0, landShare: 0, ms: 0, message: '' };
    });
  }

  // —— settings and bakes ——

  private patchSettings(patch: Partial<WorldSettings>): void {
    if (this.readOnly) return;
    const before = this.settings();
    const next: Partial<WorldSettings> = { ...patch };
    // A different planet or source moves every chunk: drop the start choice.
    if (
      (patch.worldSource && patch.worldSource !== before.worldSource) ||
      (patch.planet && patch.planet !== before.planet)
    ) {
      next.homeChunk = null;
    }
    if ('mapStyle' in patch) {
      // The land shape is a creator signal of its own; WG writes it through.
      delete next.mapStyle;
    }
    setNewWorldGen(next as Partial<typeof newWorldGen.value>);
    this.settingsChanged();
  }

  private settingsChanged(): void {
    this.cache.clear();
    wgCached.value = [];
    this.cancelChunk();
    wgChunk.value = null;
    wgInspect.value = null;
    this.requestBake(false);
    this.syncStart();
  }

  private planetKey(): string {
    const s = this.settings();
    return [this.seed(), s.worldSource, s.planet, s.seaLevel, s.tempBias, s.moistBias].join('|');
  }

  private requestBake(immediate: boolean): void {
    const key = this.planetKey();
    if (key === this.bakeKey && this.bakeStage === 'full') return;
    this.bakeKey = key;
    if (this.debounce) clearTimeout(this.debounce);
    const go = () => {
      this.debounce = null;
      this.bakeStage = 'preview';
      wgBake.value = { ...wgBake.value, state: 'baking', progress: 0, message: '' };
      this.bakeRunner.start({
        type: 'bake',
        seed: this.seed(),
        settings: this.settings(),
        ...PREVIEW,
        starts: false,
      });
    };
    if (immediate) go();
    else this.debounce = setTimeout(go, PREVIEW_DEBOUNCE_MS);
  }

  private onBake(reply: WorldGenReply): void {
    if (reply.type === 'progress') {
      wgBake.value = { ...wgBake.value, progress: reply.done };
      return;
    }
    if (reply.type === 'error') {
      wgBake.value = { ...wgBake.value, state: 'error', message: reply.message };
      return;
    }
    if (reply.type !== 'bake') return;
    const done: BakeDone = reply;
    this.view?.setBake(done.bake);
    if (this.bakeStage === 'preview') {
      wgBake.value = {
        state: 'preview',
        progress: 0,
        landShare: done.bake.landShare,
        ms: done.ms,
        message: '',
      };
      this.bakeStage = 'full';
      this.bakeRunner.start({
        type: 'bake',
        seed: this.seed(),
        settings: this.settings(),
        ...FULL,
        starts: true,
      });
      return;
    }
    wgBake.value = {
      state: 'ready',
      progress: 1,
      landShare: done.bake.landShare,
      ms: done.ms,
      message: '',
    };
    wgStarts.value = done.starts;
    this.syncStart();
    if (!this.steered) this.centreOn(wgStart.value?.addr ?? null);
  }

  /** Turn the planet so a chunk sits in the middle of the view. */
  private centreOn(addr: ChunkAddr | null): void {
    const view = this.view;
    if (!view || !addr) return;
    const ll = chunkLatLon(PLANET_PRESET_SPECS[this.settings().planet].n, addr);
    const flat = view.view.morph >= 0.5;
    view.view = {
      ...view.view,
      lon0: ll.lon,
      lat0: flat ? view.view.lat0 : Math.max(-1.2, Math.min(1.2, ll.lat)),
    };
    view.invalidate();
  }

  // —— start chunk ——

  private syncStart(): void {
    const s = this.settings();
    const n = PLANET_PRESET_SPECS[s.planet].n;
    let start: typeof wgStart.value = null;
    if (s.worldSource === 'island') {
      start = { addr: homeChunk(n), how: 'auto' };
    } else if (s.homeChunk && chunkLandShare(this.mainField(), s.homeChunk, 12) >= MIN_HOME_LAND) {
      const prev = wgStart.value;
      const how = prev && sameChunk(prev.addr, s.homeChunk) ? prev.how : 'pick';
      start = { addr: s.homeChunk, how: how === 'auto' ? 'pick' : how };
    } else if (s.homeChunk) {
      // The sea rose over the chosen start: generation will use the auto pick.
      const auto = wgStarts.value[0];
      start = auto ? { addr: auto.addr, how: 'auto' } : null;
      wgBake.value = {
        ...wgBake.value,
        message: 'The chosen start is under the sea now; the auto pick will be used.',
      };
    } else if (wgStarts.value[0]) {
      start = { addr: wgStarts.value[0].addr, how: 'auto' };
    }
    wgStart.value = start;
    if (this.view) {
      this.view.n = n;
      this.view.start = start?.addr ?? null;
      this.view.invalidate();
    }
  }

  private rerollStart(): void {
    if (this.readOnly) return;
    const choices = wgStarts.value;
    if (choices.length < 2) return;
    const cur = wgStart.value?.addr;
    const at = cur ? choices.findIndex((c) => sameChunk(c.addr, cur)) : -1;
    const next = choices[(at + 1) % choices.length]!;
    setNewWorldGen({ homeChunk: next.addr });
    wgStart.value = { addr: next.addr, how: 'reroll' };
    this.syncStart();
    this.centreOn(next.addr);
  }

  private pickStart(addr: ChunkAddr): void {
    const field = this.mainField();
    if (chunkLandShare(field, addr, 12) < MIN_HOME_LAND) {
      this.inspect(addr);
      wgBake.value = {
        ...wgBake.value,
        message: `That chunk is mostly sea; a start needs at least ${Math.round(MIN_HOME_LAND * 100)}% land.`,
      };
      return;
    }
    setNewWorldGen({ homeChunk: addr });
    wgStart.value = { addr, how: 'pick' };
    wgPickStart.value = false;
    wgBake.value = { ...wgBake.value, message: '' };
    this.syncStart();
    this.inspect(addr);
  }

  // —— chunks ——

  /** The planet on the main thread, for the inspector's quick numbers. */
  private mainField(): PlanetField {
    const s = this.settings();
    const key = this.planetKey();
    if (this.field?.key === key) return this.field.field;
    const n = PLANET_PRESET_SPECS[s.planet].n;
    const island = s.worldSource === 'island';
    const field = makePlanetField({
      source: s.worldSource,
      seed: this.seed(),
      n,
      home: island ? homeChunk(n) : undefined,
      shape: island ? undefined : settingsShape(s),
    });
    this.field = { key, field };
    return field;
  }

  private inspect(addr: ChunkAddr): void {
    const field = this.mainField();
    const k = 12;
    let land = 0;
    let minM = Infinity;
    let maxM = -Infinity;
    const counts = new Map<Biome, number>();
    for (let j = 0; j < k; j++) {
      for (let i = 0; i < k; i++) {
        const smp = field.sample(chunkToSphere(field.n, addr, (i + 0.5) / k, (j + 0.5) / k));
        if (smp.elevM < minM) minM = smp.elevM;
        if (smp.elevM > maxM) maxM = smp.elevM;
        if (smp.elevM <= 0) continue;
        land++;
        counts.set(smp.biome, (counts.get(smp.biome) ?? 0) + 1);
      }
    }
    const biomes = [...counts.entries()]
      .map(([biome, c]) => ({ biome, share: c / Math.max(1, land) }))
      .sort((a, b) => b.share - a.share)
      .slice(0, 4);
    const ll = chunkLatLon(field.n, addr);
    const score = scoreStartChunk(field, addr);
    wgInspect.value = {
      addr,
      latDeg: (ll.lat * 180) / Math.PI,
      lonDeg: (ll.lon * 180) / Math.PI,
      land: land / (k * k),
      minM,
      maxM,
      biomes,
      score: score.score,
      around: score.around,
    };
    if (this.view) {
      this.view.selected = addr;
      this.view.invalidate();
    }
  }

  private chunkCacheKey(addr: ChunkAddr): string {
    const s = this.settings();
    return `${this.planetKey()}|${s.worldScale}|${chunkKey(addr)}`;
  }

  private openChunk(addr: ChunkAddr): void {
    this.inspect(addr);
    const key = this.chunkCacheKey(addr);
    const hit = this.cache.get(key);
    wgCached.value = this.cache.keys();
    if (hit) {
      this.chunkRunner.cancel();
      this.chunkJob = null;
      wgChunk.value = {
        addr,
        state: 'ready',
        startedAt: performance.now(),
        estimateMs: 0,
        genMs: 0,
        cached: true,
        land: hit.land,
        minM: hit.minM,
        maxM: hit.maxM,
        towns: hit.nodes.length,
        tiles: hit.tiles,
        message: '',
      };
      this.chunkView?.setRaster(hit);
      this.setMode('chunk');
      return;
    }
    if (this.chunkJob && this.chunkJob.key === key) return;
    const s = this.settings();
    const settings = clampSettings({ ...s });
    const id = this.chunkRunner.start({
      type: 'chunk',
      seed: this.seed(),
      settings,
      addr,
      raster: CHUNK_RASTER,
    });
    this.chunkJob = { id, addr, key };
    wgChunk.value = {
      addr,
      state: 'generating',
      startedAt: performance.now(),
      estimateMs: (GEN_GUESS_MS[s.worldScale] ?? 3000) * this.genRatio,
      genMs: 0,
      cached: false,
      land: 0,
      minM: 0,
      maxM: 0,
      towns: 0,
      tiles: 0,
      message: '',
    };
  }

  private cancelChunk(): void {
    if (!this.chunkJob) return;
    this.chunkRunner.cancel();
    this.chunkJob = null;
    const cur = wgChunk.value;
    if (cur?.state === 'generating') wgChunk.value = null;
  }

  private onChunk(reply: WorldGenReply): void {
    const job = this.chunkJob;
    if (!job || reply.id !== job.id) return;
    if (reply.type === 'progress') return;
    this.chunkJob = null;
    if (reply.type === 'error') {
      const cur = wgChunk.value;
      if (cur) wgChunk.value = { ...cur, state: 'error', message: reply.message };
      return;
    }
    if (reply.type !== 'chunk') return;
    const done: ChunkDone = reply;
    this.cache.set(job.key, done.raster);
    wgCached.value = this.cache.keys();
    const s = this.settings();
    const guess = GEN_GUESS_MS[s.worldScale] ?? 3000;
    this.genRatio = this.genRatio * 0.5 + (done.genMs / guess) * 0.5;
    const cur = wgChunk.value;
    wgChunk.value = {
      addr: done.addr,
      state: 'ready',
      startedAt: cur?.startedAt ?? performance.now(),
      estimateMs: cur?.estimateMs ?? 0,
      genMs: done.genMs,
      cached: false,
      land: done.raster.land,
      minM: done.raster.minM,
      maxM: done.raster.maxM,
      towns: done.raster.nodes.length,
      tiles: done.raster.tiles,
      message: '',
    };
    this.chunkView?.setRaster(done.raster);
    this.setMode('chunk');
  }

  // —— view ——

  private setMode(mode: WgMode): void {
    if (mode === 'chunk' && !this.chunkView?.hasRaster) return;
    const prev = wgMode.value;
    if (mode !== 'chunk') this.lastMode = mode;
    wgMode.value = mode;
    if (this.stage) this.stage.dataset.mode = mode;
    const view = this.view;
    if (view && mode !== 'chunk' && prev !== mode) {
      const { w, h } = view.size;
      if (mode === 'globe') {
        view.view = {
          ...view.view,
          morph: 0,
          lat0: this.globeLat0,
          radiusPx: globeFitRadius(w, h),
        };
      } else {
        if (view.view.morph < 0.5) this.globeLat0 = view.view.lat0;
        view.view = { ...view.view, morph: 1, lat0: 0, radiusPx: flatFitRadius(w, h) };
      }
    }
    view?.invalidate();
    this.chunkView?.invalidate();
    if (this.stage) {
      this.stage.dataset.wgView = mode;
    }
  }

  /** Back from a chunk to the planet view it was opened from. */
  backToPlanet(): void {
    this.setMode(this.lastMode);
  }

  private applyLayers(): void {
    const l = wgLayers.value;
    if (this.view) {
      this.view.layers = { ...l };
      this.view.invalidate();
    }
    if (this.chunkView) {
      this.chunkView.showHeight = l.height && !l.biomes;
      this.chunkView.invalidate();
    }
  }

  private mount(): void {
    const root = document.querySelector<HTMLElement>('#app') ?? document.body;
    const stage = document.createElement('div');
    stage.id = 'worldgen';
    stage.className = 'wg-stage';
    stage.dataset.mode = 'globe';
    const ui = root.querySelector('#ui');
    if (ui) root.insertBefore(stage, ui);
    else root.append(stage);
    this.stage = stage;
    this.view = new WorldGenView(stage);
    this.chunkView = new ChunkView(stage);
    const { w, h } = this.view.size;
    const start = this.settings().homeChunk;
    const ll = start ? chunkLatLon(PLANET_PRESET_SPECS[this.settings().planet].n, start) : null;
    this.view.view = {
      lon0: ll ? ll.lon : 0,
      lat0: ll ? Math.max(-1.2, Math.min(1.2, ll.lat)) : 0.35,
      radiusPx: globeFitRadius(w, h),
      morph: 0,
    };
    this.applyLayers();
    this.bindPointer(stage);
  }

  private bindPointer(stage: HTMLElement): void {
    const on = <K extends keyof HTMLElementEventMap>(
      type: K,
      fn: (event: HTMLElementEventMap[K]) => void,
      opts?: AddEventListenerOptions,
    ) => {
      stage.addEventListener(type, fn as EventListener, opts);
      this.cleanups.push(() => stage.removeEventListener(type, fn as EventListener, opts));
    };
    on('pointerdown', (e) => {
      if (this.pointer) return;
      this.pointer = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
      stage.setPointerCapture?.(e.pointerId);
    });
    on('pointermove', (e) => {
      const p = this.pointer;
      if (!p || p.id !== e.pointerId) {
        this.hover(e.clientX, e.clientY);
        return;
      }
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      if (!p.moved && Math.hypot(dx, dy) < DRAG_PX) return;
      p.moved = true;
      this.steered = true;
      p.x = e.clientX;
      p.y = e.clientY;
      this.drag(dx, dy);
    });
    const end = (e: PointerEvent) => {
      const p = this.pointer;
      if (!p || p.id !== e.pointerId) return;
      this.pointer = null;
      if (!p.moved && e.type === 'pointerup') this.click(e.clientX, e.clientY);
    };
    on('pointerup', end);
    on('pointercancel', end);
    on(
      'wheel',
      (e) => {
        e.preventDefault();
        this.steered = true;
        const factor = Math.exp(-e.deltaY * 0.0015);
        this.zoom(factor, e.clientX, e.clientY);
      },
      { passive: false },
    );
  }

  private hover(x: number, y: number): void {
    const view = this.view;
    if (!view || wgMode.value === 'chunk') return;
    const addr = view.pick(x, y);
    const prev = view.hover;
    if ((addr && prev && sameChunk(addr, prev)) || (!addr && !prev)) return;
    view.hover = addr;
    view.invalidate();
  }

  private click(x: number, y: number): void {
    if (wgMode.value === 'chunk') return;
    const addr = this.view?.pick(x, y);
    if (!addr) return;
    if (wgPickStart.value && !this.readOnly) this.pickStart(addr);
    else this.openChunk(addr);
  }

  private drag(dx: number, dy: number): void {
    if (wgMode.value === 'chunk') {
      this.chunkView?.pan(dx, dy);
      return;
    }
    const view = this.view;
    if (!view) return;
    const v = view.view;
    const R = v.radiusPx;
    const lim = v.morph >= 0.5 ? Math.PI / 2 : 1.4;
    view.view = {
      ...v,
      lon0: wrapAngle(v.lon0 - dx / R),
      lat0: Math.max(-lim, Math.min(lim, v.lat0 + dy / R)),
    };
    view.invalidate();
  }

  private zoom(factor: number, x: number, y: number): void {
    if (wgMode.value === 'chunk') {
      this.chunkView?.zoomAt(factor, x, y);
      return;
    }
    const view = this.view;
    if (!view) return;
    const { w, h } = view.size;
    const v = view.view;
    const fit = v.morph >= 0.5 ? flatFitRadius(w, h) : globeFitRadius(w, h);
    const radiusPx = Math.max(fit * 0.6, Math.min(fit * 30, v.radiusPx * factor));
    view.view = { ...v, radiusPx };
    view.invalidate();
  }
}
