/**
 * World Gen's Regions tab (R1): a debug preview of the belief map. Owns the
 * Regions view (shader), its 2D overlay, the simulated knowledge (a block, a
 * random walk, or a played-back journey, plus clicked visits), rumours with
 * "Show me" (fly or poof) and "Arrive here", and a lazily filled detail atlas of
 * the known chunks' own maps. Nothing is saved.
 */
import { effect } from '@preact/signals';
import {
  angleBetween,
  bentRadius,
  chunkAngle,
  chunkKey,
  chunkToSphere,
  DEFAULT_REGIONS_TUNING,
  exploreBlock,
  fadeAmount,
  frameAxes,
  glimpsed,
  journeyPath,
  knowledgeFromPath,
  knownExtent,
  makeRumor,
  maxVisibleAngle,
  normalize3,
  randomWalk,
  regionsProject,
  regionsTarget,
  regionsUnproject,
  rumorClearing,
  rumorUncertainty,
  slerp3,
  smoothstep,
  sphereToChunk,
  unbendRadius,
  type ChunkAddr,
  type Knowledge,
  type RegionsFrame,
  type RegionsTuning,
  type Rumor,
  type Vec3,
  type WorldBake,
} from '../../core/planet';
import { clampSettings, type WorldSettings } from '../../core/world/models';
import { loadCloudAtlas, type CloudAtlas } from '../../render/worldgen/cloud-atlas';
import { JobRunner } from '../../render/worldgen/job-runner';
import type { WorldGenReply } from '../../render/worldgen/jobs';
import { RegionsOverlay } from '../../render/worldgen/regions-overlay';
import {
  DETAIL_GRID,
  DETAIL_SLOT,
  MAX_RUMORS,
  RegionsView,
} from '../../render/worldgen/regions-view';
import {
  bindRegions,
  regionsCommands,
  DEFAULT_REGIONS_DEBUG,
  regionsDebug,
  regionsJourney,
  regionsNote,
  regionsReadout,
  regionsRumors,
  regionsSelected,
  type RegionsDebug,
} from '../../ui/regions-state';

const SLOTS = DETAIL_GRID * DETAIL_GRID;
const FLY_MS = 1100;
const POOF_MS = 900;
const ARRIVE_MS = 1900;
/** Chunk maps fade in over the bake between these on-screen chunk sizes (px). */
const DETAIL_MIN_PX = 44;
const DETAIL_FULL_PX = 110;

export interface RegionsHost {
  n(): number;
  seed(): number;
  settings(): WorldSettings;
  /** The world's start chunk (the default centre). */
  start(): ChunkAddr | null;
  chunkKm(): number;
}

interface ViewNow {
  c: Vec3;
  logR: number;
  bend: number;
}

type Anim =
  | {
      kind: 'fly';
      from: ViewNow;
      to: ViewNow;
      t0: number;
      dur: number;
      dip: number;
      then: 'rumor' | 'you';
    }
  | {
      kind: 'poof';
      t0: number;
      dur: number;
      switched: boolean;
      to: 'isolate' | 'you';
      rumor: number | null;
    }
  | { kind: 'arrive'; t0: number; dur: number; rumor: number };

export class RegionsController {
  private view: RegionsView | null = null;
  private overlay: RegionsOverlay | null = null;
  private atlas: CloudAtlas | null = null;
  private atlasState: 'loading' | 'loaded' | 'failed' = 'loading';
  private active = false;
  private readonly cleanups: Array<() => void> = [];
  /** Knowledge from the simulation plus clicked visits and arrivals. */
  private known: Knowledge = new Map();
  private glimpse = new Map<string, ChunkAddr>();
  private manual = new Map<string, { addr: ChunkAddr; on: boolean }>();
  private arrivals = new Map<string, ChunkAddr>();
  private path: ChunkAddr[] = [];
  private waypoints: Vec3[] = [];
  private journeyAt = 0;
  private playing = false;
  private player: Vec3 | null = null;
  private today = 0;
  private maskDirty = true;
  private cur: ViewNow | null = null;
  private target: ReturnType<typeof regionsTarget> | null = null;
  /** Hand pan / zoom on top of the knowledge-driven view. */
  private pan: Vec3 | null = null;
  private zoomMul = 1;
  private mode: 'you' | 'rumor' | 'isolate' = 'you';
  private focusRumor: number | null = null;
  private anim: Anim | null = null;
  private nextRumorId = 1;
  private cloudOff = { x: 0, y: 0 };
  private lastFrameAt = 0;
  private lastC: Vec3 | null = null;
  private lastR = 0;
  private frameTimes: number[] = [];
  private lastReadout = 0;
  private overlayMs = 0;
  private visible: ChunkAddr[] = [];
  private time = 0;
  // Detail atlas: chunk key → slot, filled by a worker one chunk at a time.
  private readonly runner: JobRunner;
  private slots = new Map<string, number>();
  private slotUse: Array<{ key: string; addr: ChunkAddr } | null> = Array.from(
    { length: SLOTS },
    () => null,
  );
  private job: { id: number; key: string; addr: ChunkAddr } | null = null;
  private detailKey = '';

  constructor(
    private readonly stage: HTMLElement,
    private readonly host: RegionsHost,
  ) {
    this.runner = new JobRunner((reply) => this.onDetail(reply));
    this.view = new RegionsView(stage);
    this.overlay = new RegionsOverlay(stage);
    void loadCloudAtlas().then((atlas) => {
      this.atlas = atlas;
      this.atlasState = atlas ? 'loaded' : 'failed';
      this.view?.setAtlas(atlas);
    });
    bindRegions({
      setDebug: (patch) => {
        regionsDebug.value = { ...regionsDebug.value, ...patch };
      },
      reset: () => {
        this.manual.clear();
        this.arrivals.clear();
        this.waypoints = [];
        this.pan = null;
        this.zoomMul = 1;
        regionsRumors.value = [];
        regionsSelected.value = null;
        regionsNote.value = null;
        this.mode = 'you';
        regionsDebug.value = { ...DEFAULT_REGIONS_DEBUG, collapsed: regionsDebug.value.collapsed };
      },
      newWalk: () => {
        const d = regionsDebug.value;
        regionsDebug.value = { ...d, explore: 'walk', walkSeed: d.walkSeed + 1 };
      },
      clearVisits: () => {
        this.manual.clear();
        this.arrivals.clear();
        this.simulate();
      },
      playJourney: () => {
        if (regionsDebug.value.explore !== 'journey') {
          regionsDebug.value = { ...regionsDebug.value, explore: 'journey' };
        }
        if (this.path.length < 2) this.autoJourney();
        if (this.journeyAt >= this.path.length - 1) this.journeyAt = 0;
        this.playing = true;
        this.pan = null;
        this.syncJourney();
      },
      pauseJourney: () => {
        this.playing = false;
        this.syncJourney();
      },
      rewindJourney: () => {
        this.playing = false;
        this.journeyAt = 0;
        this.simulate();
      },
      clearWaypoints: () => {
        this.waypoints = [];
        this.playing = false;
        this.journeyAt = 0;
        this.simulate();
      },
      select: (id) => {
        regionsSelected.value = id;
      },
      showMe: (id) => this.showMe(id),
      backToMe: () => this.backToMe(),
      arrive: (id) => this.arrive(id),
      forget: (id) => {
        regionsRumors.value = regionsRumors.value.filter((r) => r.id !== id);
        if (regionsSelected.value === id) regionsSelected.value = null;
        if (this.focusRumor === id) this.backToMe();
        this.maskDirty = true;
      },
      clearRumors: () => {
        regionsRumors.value = [];
        regionsSelected.value = null;
        if (this.mode !== 'you') this.backToMe();
        this.maskDirty = true;
      },
      recentre: () => {
        this.pan = null;
        this.zoomMul = 1;
      },
    });
    // Debug hook for shots and tuning (World Gen only; gone on exit).
    const g = globalThis as unknown as { __tbRegions?: unknown };
    g.__tbRegions = {
      state: () => this.debug(),
      set: (patch: Partial<RegionsDebug>) => {
        regionsDebug.value = { ...regionsDebug.value, ...patch };
      },
      commands: regionsCommands,
      rumors: () => regionsRumors.value,
      /** Add a rumour `east` / `north` chunk widths from the centre chunk. */
      addRumor: (east: number, north: number, confidence: number, directionKnown: boolean) => {
        const n = this.host.n();
        const c = chunkToSphere(n, this.centreChunk());
        const ca = chunkAngle(n);
        const ax = frameAxes(c);
        const at = normalize3([
          c[0] + (ax.east[0] * east + ax.north[0] * north) * ca,
          c[1] + (ax.east[1] * east + ax.north[1] * north) * ca,
          c[2] + (ax.east[2] * east + ax.north[2] * north) * ca,
        ]);
        const r = makeRumor(
          n,
          this.nextRumorId++,
          at,
          confidence,
          directionKnown,
          this.host.seed(),
        );
        regionsRumors.value = [...regionsRumors.value, r];
        regionsSelected.value = r.id;
        return r.id;
      },
      /** Screen point (client px) of a sphere point, for scripted clicks. */
      screenOf: (p: Vec3) => {
        if (!this.cur) return null;
        const s = regionsProject(this.frameNow(), p);
        const rect = this.stage.getBoundingClientRect();
        return s
          ? { x: s.x + rect.left + rect.width / 2, y: s.y + rect.top + rect.height / 2 }
          : null;
      },
    };
    this.cleanups.push(() => {
      delete g.__tbRegions;
    });
    this.cleanups.push(
      effect(() => {
        const d = regionsDebug.value;
        void d;
        this.simulate();
      }),
    );
  }

  setBake(bake: WorldBake): void {
    this.view?.setBake(bake);
  }

  /** The world changed (seed / settings): drop chunk maps. */
  worldChanged(): void {
    this.runner.cancel();
    this.job = null;
    this.slots.clear();
    this.slotUse = Array.from({ length: SLOTS }, () => null);
    this.detailKey = '';
    this.simulate();
  }

  setActive(on: boolean): void {
    this.active = on;
    this.stage.dataset.regions = on ? 'on' : 'off';
    if (on) {
      this.cur = null;
      this.lastFrameAt = 0;
      this.simulate();
    } else {
      this.playing = false;
      this.runner.cancel();
      this.job = null;
    }
  }

  dispose(): void {
    for (const off of this.cleanups.splice(0)) off();
    this.runner.dispose();
    this.view?.dispose();
    this.overlay?.dispose();
    this.view = null;
    this.overlay = null;
    regionsReadout.value = null;
  }

  // —— knowledge ——

  private tuning(): RegionsTuning {
    const d = regionsDebug.value;
    return {
      ...DEFAULT_REGIONS_TUNING,
      bendStart: d.bendStart,
      spanFull: Math.max(d.bendStart + 1, d.spanFull),
      margin: d.margin,
    };
  }

  private centreChunk(): ChunkAddr {
    const n = this.host.n();
    const c = regionsDebug.value.centre ?? this.host.start();
    if (c && c.cx < n && c.cy < n) return c;
    return { face: 0, cx: Math.floor(n / 2), cy: Math.floor(n / 2) };
  }

  /** Rebuild the simulated knowledge from the debug settings. */
  private simulate(): void {
    const d = regionsDebug.value;
    const n = this.host.n();
    const centre = this.centreChunk();
    let base: Knowledge;
    if (d.explore === 'walk') {
      this.path = randomWalk(n, centre, d.walkSteps, d.walkSeed);
      base = knowledgeFromPath(this.path);
      this.player = chunkToSphere(n, this.path[this.path.length - 1]!);
    } else if (d.explore === 'journey') {
      if (this.waypoints.length === 0) this.waypoints = [chunkToSphere(n, centre)];
      this.path = journeyPath(n, this.waypoints);
      this.journeyAt = Math.min(this.journeyAt, Math.max(0, this.path.length - 1));
      base = knowledgeFromPath(this.path, Math.floor(this.journeyAt) + 1);
      this.player = chunkToSphere(n, this.path[Math.floor(this.journeyAt)] ?? centre);
    } else {
      this.path = [];
      const block = exploreBlock(n, centre, Math.max(1, Math.round(d.block)));
      base = new Map(block.map((a) => [chunkKey(a), { addr: a, lastVisit: 0 }]));
      this.player = chunkToSphere(n, centre);
    }
    let last = 0;
    for (const k of base.values()) last = Math.max(last, k.lastVisit);
    for (const [key, m] of this.manual) {
      if (m.on) base.set(key, { addr: m.addr, lastVisit: last });
      else base.delete(key);
    }
    for (const [key, addr] of this.arrivals) base.set(key, { addr, lastVisit: last });
    this.known = base;
    this.today = last + d.timeSkip;
    this.glimpse = glimpsed(n, base);
    this.openCache.clear();
    this.maskDirty = true;
    this.syncJourney();
  }

  private syncJourney(): void {
    regionsJourney.value = {
      waypoints: this.waypoints.length,
      length: this.path.length,
      progress: this.path.length > 1 ? this.journeyAt / (this.path.length - 1) : 0,
      playing: this.playing,
    };
  }

  private autoJourney(): void {
    const n = this.host.n();
    const c = chunkToSphere(n, this.centreChunk());
    const ca = chunkAngle(n);
    const axes = frameAxes(c);
    const at = (east: number, north: number): Vec3 => {
      const e = east * ca;
      const no = north * ca;
      return normalize3([
        c[0] + axes.east[0] * e + axes.north[0] * no,
        c[1] + axes.east[1] * e + axes.north[1] * no,
        c[2] + axes.east[2] * e + axes.north[2] * no,
      ]);
    };
    this.waypoints = [c, at(3, 1), at(5, -2), at(9, -1), at(12, 3), at(16, 2)];
    this.journeyAt = 0;
    this.simulate();
  }

  private openCache = new Map<string, number>();

  /** Open (not clouded) neighbours of a chunk, as bits in its own frame (see the overlay). */
  private openAround(addr: ChunkAddr): number {
    const key = chunkKey(addr);
    const hit = this.openCache.get(key);
    if (hit !== undefined) return hit;
    const n = this.host.n();
    let bits = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nb = sphereToChunk(n, chunkToSphere(n, addr, 0.5 + dx * 0.6, 0.5 + dy * 0.6)).chunk;
        if (this.levelOf(nb) < 2) bits |= 1 << ((dy + 1) * 3 + dx + 1);
      }
    }
    this.openCache.set(key, bits);
    return bits;
  }

  levelOf(addr: ChunkAddr): 0 | 1 | 2 {
    const key = chunkKey(addr);
    if (this.known.has(key)) return 0;
    if (this.glimpse.has(key)) return 1;
    return 2;
  }

  private rebuildMask(): void {
    const view = this.view;
    if (!view) return;
    const n = this.host.n();
    const t = this.tuning();
    const d = regionsDebug.value;
    view.setMask(n, (addr) => {
      const key = chunkKey(addr);
      const k = this.known.get(key);
      const slot = d.detail ? (this.slots.get(key) ?? -1) : -1;
      if (k) return { level: 0, fade: fadeAmount(this.today - k.lastVisit, t), slot };
      return { level: this.glimpse.has(key) ? 1 : 2, fade: 0, slot: -1 };
    });
    this.maskDirty = false;
  }

  // —— detail maps ——

  private pumpDetail(): void {
    const d = regionsDebug.value;
    if (!d.detail || this.job || !this.cur) return;
    const n = this.host.n();
    const c = this.cur.c;
    const s = this.host.settings();
    const key = `${this.host.seed()}|${s.worldSource}|${s.planet}|${s.seaLevel}|${s.tempBias}|${s.moistBias}|${d.detailScale}`;
    if (key !== this.detailKey) {
      this.detailKey = key;
      this.slots.clear();
      this.slotUse = Array.from({ length: SLOTS }, () => null);
      this.maskDirty = true;
    }
    // Nearest known chunks first; only what the view could show at a useful size.
    const R = Math.exp(this.cur.logR);
    if (R * chunkAngle(n) < DETAIL_MIN_PX) return;
    const wanted = [...this.known.values()]
      .map((k) => ({ k, d: angleBetween(c, chunkToSphere(n, k.addr)) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, SLOTS);
    const next = wanted.find((w) => !this.slots.has(chunkKey(w.k.addr)));
    if (!next) return;
    const settings = clampSettings({
      ...s,
      worldScale: d.detailScale === 'world' ? s.worldScale : d.detailScale,
    });
    const addr = next.k.addr;
    const id = this.runner.start({
      type: 'chunk',
      seed: this.host.seed(),
      settings,
      addr,
      raster: DETAIL_SLOT,
    });
    this.job = { id, key: chunkKey(addr), addr };
    // Free a slot now if all are taken: the furthest one not wanted.
    void wanted;
  }

  private onDetail(reply: WorldGenReply): void {
    const job = this.job;
    if (!job || reply.id !== job.id || reply.type === 'progress') return;
    this.job = null;
    if (reply.type !== 'chunk') return;
    let slot = this.slotUse.findIndex((s) => s === null);
    if (slot < 0) {
      // Evict the slot furthest from the view.
      const c = this.cur?.c ?? [0, 0, 1];
      const n = this.host.n();
      let far = -1;
      this.slotUse.forEach((s, i) => {
        const dd = s ? angleBetween(c, chunkToSphere(n, s.addr)) : 0;
        if (dd > far) {
          far = dd;
          slot = i;
        }
      });
      const old = this.slotUse[slot];
      if (old) this.slots.delete(old.key);
    }
    this.slotUse[slot] = { key: job.key, addr: job.addr };
    this.slots.set(job.key, slot);
    this.view?.setDetail(slot, reply.raster);
    this.maskDirty = true;
  }

  // —— rumours ——

  private rumorIndex(id: number): number {
    return regionsRumors.value.findIndex((r) => r.id === id);
  }

  private rumorView(r: Rumor): ViewNow {
    const n = this.host.n();
    const { w, h } = this.view?.size ?? { w: 800, h: 600 };
    const bend = this.cur?.bend ?? 0;
    const want = rumorUncertainty(n, r.confidence) * 1.6;
    const R = (Math.min(w, h) * 0.45) / Math.max(1e-4, bentRadius(want, bend));
    return { c: r.at, logR: Math.log(R), bend };
  }

  private showMe(id: number): void {
    const r = regionsRumors.value.find((x) => x.id === id);
    if (!r || !this.cur || this.anim) return;
    regionsSelected.value = id;
    this.focusRumor = id;
    regionsNote.value = null;
    if (r.directionKnown) this.flyTo(this.rumorView(r), 'rumor');
    else
      this.anim = {
        kind: 'poof',
        t0: performance.now(),
        dur: POOF_MS,
        switched: false,
        to: 'isolate',
        rumor: id,
      };
  }

  private backToMe(): void {
    if (!this.cur || this.anim) return;
    if (this.mode === 'isolate') {
      this.anim = {
        kind: 'poof',
        t0: performance.now(),
        dur: POOF_MS,
        switched: false,
        to: 'you',
        rumor: null,
      };
      return;
    }
    if (this.mode === 'rumor' && this.target) {
      this.flyTo(this.youView(), 'you');
      return;
    }
    this.mode = 'you';
    this.focusRumor = null;
  }

  private youView(): ViewNow {
    const t = this.target!;
    return { c: this.pan ?? t.centre, logR: Math.log(t.R * this.zoomMul), bend: t.bend };
  }

  private flyTo(to: ViewNow, then: 'rumor' | 'you'): void {
    const from = this.cur!;
    const { w, h } = this.view?.size ?? { w: 800, h: 600 };
    const ang = angleBetween(from.c, to.c);
    const ca = chunkAngle(this.host.n());
    const bend = Math.max(from.bend, to.bend);
    const fit =
      (Math.min(w, h) * 0.42) /
      Math.max(1e-4, bentRadius(Math.min(maxVisibleAngle(bend), ang / 2 + ca), bend));
    const dip = Math.max(0, Math.max(from.logR, to.logR) - Math.log(fit));
    const dur = Math.min(1600, Math.max(900, FLY_MS * (0.8 + Math.min(1, ang / (ca * 12)) * 0.5)));
    this.anim = { kind: 'fly', from: { ...from }, to, t0: performance.now(), dur, dip, then };
  }

  private arrive(id: number): void {
    const r = regionsRumors.value.find((x) => x.id === id);
    if (!r || r.arrived || this.anim) return;
    regionsSelected.value = id;
    if (this.mode === 'isolate') this.mode = 'rumor';
    this.focusRumor = id;
    if (!this.cur) return;
    // Centre on the spot first (instantly when already there), then reveal.
    const to = this.rumorView({ ...r, at: r.trueAt });
    this.cur = { ...to };
    this.mode = 'rumor';
    this.anim = { kind: 'arrive', t0: performance.now(), dur: ARRIVE_MS, rumor: id };
  }

  private finishArrive(id: number): void {
    const r = regionsRumors.value.find((x) => x.id === id);
    if (!r) return;
    regionsRumors.value = regionsRumors.value.map((x) =>
      x.id === id ? { ...x, arrived: true } : x,
    );
    const addr = sphereToChunk(this.host.n(), r.trueAt).chunk;
    this.arrivals.set(chunkKey(addr), addr);
    regionsNote.value = { heard: r.believed.name, source: r.source, found: r.truth.name };
    this.simulate();
  }

  // —— pointer ——

  click(clientX: number, clientY: number): void {
    const view = this.view;
    if (!view || !this.cur || this.anim) return;
    const rect = this.stage.getBoundingClientRect();
    const x = clientX - rect.left - rect.width / 2;
    const y = clientY - rect.top - rect.height / 2;
    const frame = this.frameNow();
    // A rumour marker under the pointer: select it.
    for (const r of regionsRumors.value) {
      const s = regionsProject(frame, r.arrived ? r.trueAt : r.at);
      if (s && Math.hypot(s.x - x, s.y + 12 - y) < 26) {
        regionsSelected.value = r.id;
        return;
      }
    }
    if (this.mode === 'isolate') return;
    const p = regionsUnproject(frame, x, y);
    if (!p) return;
    const n = this.host.n();
    const addr = sphereToChunk(n, p).chunk;
    const d = regionsDebug.value;
    if (d.tool === 'rumor') {
      if (regionsRumors.value.length >= MAX_RUMORS) return;
      const r = makeRumor(
        n,
        this.nextRumorId++,
        p,
        d.rumorConfidence,
        d.rumorDirection,
        this.host.seed(),
      );
      regionsRumors.value = [...regionsRumors.value, r];
      regionsSelected.value = r.id;
      return;
    }
    if (d.tool === 'waypoint') {
      if (d.explore !== 'journey') regionsDebug.value = { ...d, explore: 'journey' };
      this.waypoints = [...this.waypoints, p];
      this.simulate();
      return;
    }
    if (d.tool === 'centre') {
      this.waypoints = [];
      this.pan = null;
      regionsDebug.value = { ...d, centre: addr };
      return;
    }
    const key = chunkKey(addr);
    const isKnown = this.known.has(key);
    this.manual.set(key, { addr, on: !isKnown });
    this.simulate();
  }

  drag(dx: number, dy: number): void {
    if (!this.cur || this.anim || this.mode === 'isolate') return;
    const frame = this.frameNow();
    const p = regionsUnproject(frame, -dx, -dy);
    if (!p) return;
    this.pan = p;
    this.cur = { ...this.cur, c: p };
  }

  zoom(factor: number): void {
    if (!this.cur || this.anim) return;
    this.zoomMul = Math.max(0.25, Math.min(8, this.zoomMul * factor));
    this.cur = { ...this.cur, logR: this.cur.logR + Math.log(factor) };
  }

  // —— frame ——

  private frameNow(): RegionsFrame {
    const c = this.cur!;
    return { centre: c.c, R: Math.exp(c.logR), bend: c.bend };
  }

  render(now: number): void {
    if (!this.active || !this.view || !this.overlay) return;
    const dt = this.lastFrameAt ? Math.min(0.1, (now - this.lastFrameAt) / 1000) : 1 / 60;
    if (this.lastFrameAt) {
      this.frameTimes.push(now - this.lastFrameAt);
      if (this.frameTimes.length > 60) this.frameTimes.shift();
    }
    this.lastFrameAt = now;
    this.time += dt;
    const d = regionsDebug.value;
    const n = this.host.n();
    const { w, h } = this.view.size;

    if (this.playing && this.path.length > 1) {
      const was = Math.floor(this.journeyAt);
      this.journeyAt = Math.min(this.path.length - 1, this.journeyAt + dt * d.playSpeed);
      if (this.journeyAt >= this.path.length - 1) this.playing = false;
      if (Math.floor(this.journeyAt) !== was || !this.playing) this.simulate();
    }

    const ext = knownExtent(n, this.known, this.player ?? chunkToSphere(n, this.centreChunk()));
    this.target = regionsTarget(n, ext, w, h, this.tuning(), {
      k: d.kAuto ? null : d.k,
      bend: d.bendAuto ? null : d.bend,
    });
    if (!this.cur) {
      this.cur = { c: this.target.centre, logR: Math.log(this.target.R), bend: this.target.bend };
    }
    this.step(now, dt);
    if (this.maskDirty) this.rebuildMask();
    this.pumpDetail();

    const frame = this.frameNow();
    const axes = frameAxes(frame.centre);
    const ca = chunkAngle(n);
    const chunkPx = frame.R * ca;
    const pixel = Math.max(2, Math.min(4, Math.round(chunkPx / 160) + 2));
    // Clouds ride along with the view (whole art pixels) and drift east.
    if (this.lastC) {
      const dc: Vec3 = [
        frame.centre[0] - this.lastC[0],
        frame.centre[1] - this.lastC[1],
        frame.centre[2] - this.lastC[2],
      ];
      const de = dc[0] * axes.east[0] + dc[1] * axes.east[1] + dc[2] * axes.east[2];
      const dn = dc[0] * axes.north[0] + dc[1] * axes.north[1] + dc[2] * axes.north[2];
      this.cloudOff.x += (de * frame.R) / pixel;
      this.cloudOff.y -= (dn * frame.R) / pixel;
      if (this.lastR > 0 && Math.abs(frame.R / this.lastR - 1) > 1e-4) {
        this.cloudOff.x *= frame.R / this.lastR;
        this.cloudOff.y *= frame.R / this.lastR;
      }
    }
    this.lastC = frame.centre;
    this.lastR = frame.R;
    this.cloudOff.x += dt * d.drift * 2.2;

    const tmax = maxVisibleAngle(frame.bend);
    const reach = unbendRadius(Math.hypot(w, h) / 2 / frame.R, frame.bend) ?? tmax;
    this.visible = [];
    const cosReach = Math.cos(Math.min(Math.PI, reach + ca));
    for (let face = 0; face < 6; face++) {
      for (let cy = 0; cy < n; cy++) {
        for (let cx = 0; cx < n; cx++) {
          const a = { face: face as ChunkAddr['face'], cx, cy };
          const p = chunkToSphere(n, a);
          if (p[0] * frame.centre[0] + p[1] * frame.centre[1] + p[2] * frame.centre[2] >= cosReach)
            this.visible.push(a);
        }
      }
    }

    const rumors = regionsRumors.value;
    const isolateIdx =
      this.mode === 'isolate' && this.focusRumor !== null ? this.rumorIndex(this.focusRumor) : -1;
    const clouds = d.clouds;
    this.view.render({
      centre: axes.c,
      east: axes.east,
      north: axes.north,
      R: frame.R,
      bend: frame.bend,
      thetaMax: tmax,
      rhoMax: bentRadius(tmax, frame.bend),
      n,
      cloudMode: clouds === 'off' ? 0 : clouds === 'art' ? 1 : 2,
      fog: d.fog,
      pixel,
      cloudOff: [Math.round(this.cloudOff.x), Math.round(this.cloudOff.y)],
      density: d.density,
      coverTile: d.coverTile,
      maskView: d.maskView,
      truth: d.truth,
      time: this.time,
      rumors: rumors.map((r) => ({
        at: r.arrived ? r.trueAt : r.at,
        radius: rumorClearing(n, r.confidence) * (r.arrived ? 1.4 : 1),
        confidence: r.confidence,
        arrived: r.arrived,
        selected: regionsSelected.value === r.id,
      })),
      isolate: isolateIdx,
      detailMix: d.detail ? smoothstep(DETAIL_MIN_PX, DETAIL_FULL_PX, chunkPx) : 0,
    });
    const t1 = performance.now();
    const a = this.anim;
    const selected = rumors.find((r) => r.id === regionsSelected.value) ?? null;
    let directionTo: Vec3 | null = null;
    if (selected && selected.directionKnown && !selected.arrived && this.mode !== 'isolate')
      directionTo = selected.at;
    this.overlay.draw({
      frame,
      axes,
      n,
      w,
      h,
      atlas: clouds === 'art' ? this.atlas : null,
      pixel,
      time: this.time,
      fog: d.fog,
      clouds: clouds !== 'off',
      drift: d.drift,
      density: d.density,
      levelOf: (addr) => (d.fog ? this.levelOf(addr) : 0),
      openAround: (addr) => this.openAround(addr),
      visible: this.visible,
      known: [...this.known.values()].map((k) => k.addr),
      rumors,
      selected: regionsSelected.value,
      player: this.player,
      path: this.path.slice(0, Math.floor(this.journeyAt) + 1).map((p) => chunkToSphere(n, p)),
      truth: d.truth,
      directionTo,
      isolate: this.mode === 'isolate' ? this.focusRumor : null,
      poof: a?.kind === 'poof' ? Math.min(1, (now - a.t0) / a.dur) : null,
      arrive: a?.kind === 'arrive' ? { id: a.rumor, t: Math.min(1, (now - a.t0) / a.dur) } : null,
      clearing: (r) => rumorClearing(n, r.confidence),
      uncertainty: (r) => rumorUncertainty(n, r.confidence),
    });
    this.overlayMs = performance.now() - t1;

    if (now - this.lastReadout > 250) {
      this.lastReadout = now;
      const ft = this.frameTimes;
      const avg = ft.length ? ft.reduce((s, v) => s + v, 0) / ft.length : 0;
      const t = this.target;
      regionsReadout.value = {
        known: this.known.size,
        glimpsed: this.glimpse.size,
        span: t.span,
        km: t.span * this.host.chunkKm(),
        k: t.k,
        bend: frame.bend,
        visibleDeg: (t.visible * 180) / Math.PI,
        chunkPx,
        pixel,
        today: this.today,
        frameMs: avg,
        frameMax: ft.length ? Math.max(...ft) : 0,
        drawMs: this.view.drawMs,
        overlayMs: this.overlayMs,
        stamps: this.overlay.stamps,
        detailReady: this.slots.size,
        detailQueued: this.job ? 1 : 0,
        atlas: this.atlasState,
        view: this.mode === 'isolate' ? 'isolated' : this.mode === 'rumor' ? 'rumor' : 'you',
      };
    }
  }

  /** Ease toward the knowledge target, or run the fly / poof / arrive animation. */
  private step(now: number, dt: number): void {
    const cur = this.cur!;
    const a = this.anim;
    if (a?.kind === 'fly') {
      const t = Math.min(1, (now - a.t0) / a.dur);
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      this.cur = {
        c: slerp3(a.from.c, a.to.c, e),
        logR: a.from.logR + (a.to.logR - a.from.logR) * e - a.dip * Math.sin(Math.PI * t),
        bend: a.from.bend + (a.to.bend - a.from.bend) * e,
      };
      if (t >= 1) {
        this.anim = null;
        this.mode = a.then;
        if (a.then === 'you') this.focusRumor = null;
      }
      return;
    }
    if (a?.kind === 'poof') {
      const t = (now - a.t0) / a.dur;
      if (t >= 0.5 && !a.switched) {
        a.switched = true;
        if (a.to === 'isolate' && a.rumor !== null) {
          const r = regionsRumors.value.find((x) => x.id === a.rumor);
          if (r) this.cur = this.rumorView(r);
          this.mode = 'isolate';
        } else {
          this.mode = 'you';
          this.focusRumor = null;
          if (this.target) this.cur = this.youView();
        }
      }
      if (t >= 1) this.anim = null;
      return;
    }
    if (a?.kind === 'arrive') {
      if (now - a.t0 >= a.dur) {
        this.anim = null;
        this.finishArrive(a.rumor);
      }
      return;
    }
    if (this.mode !== 'you' || !this.target) return;
    const to = this.youView();
    const k = 1 - Math.exp(-dt * 3.2);
    this.cur = {
      c: slerp3(cur.c, to.c, k),
      logR: cur.logR + (to.logR - cur.logR) * k,
      bend: cur.bend + (to.bend - cur.bend) * k,
    };
  }

  /** Debug hook for shots and tests. */
  debug(): Record<string, unknown> {
    return {
      known: this.known.size,
      glimpsed: this.glimpse.size,
      mode: this.mode,
      anim: this.anim?.kind ?? null,
      detail: this.slots.size,
      job: !!this.job,
      atlas: this.atlasState,
      today: this.today,
      target: this.target,
    };
  }
}

export type { RegionsDebug };
