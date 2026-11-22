import {
  SETTLEMENT_STOP_SCALE,
  clampStepToSettlement,
  describeMapStand,
} from '../../core/area/area-window';
import {
  MAP_ENTRY_COOLDOWN_SEC,
  stepEntryCooldown,
  zoomAfterArea,
} from '../../core/world/map-zoom';
import {
  METERS_PER_WORLD_TILE,
  formatMapClockRate,
  mapClockHoursPerRealSec,
  walkTilesPerSec,
} from '../../core/world/models';
import { onFootPaceMps } from '../../core/sim/map-pace';
import { attachMapInput } from '../../input/map-input';
import { MapCamera } from '../../render/map/map-camera';
import { dayLightAt } from '../../core/sim/time';
import { hasRoute, splitRoute } from '../../core/sim/caravan';
import { leaderToggleHalt } from '../leader-halt';
import { travelHudFor, travelHudKey } from '../travel-hud';
import { MAP_ZOOM_CAP, TILE } from '../../core/world/models';
import type { MapCaravanDraw, MapZonesDraw } from '../../render/map/map-renderer';
import { showsZonePreview, zoneDistance, zoneOutlineAlpha } from '../../core/area/zone-history';
import { attachRouteClicks, resolveRouteTarget, routeFrame } from '../map-route';
import {
  canEnter,
  clockRate,
  hint,
  mapNight,
  nearTown,
  nearestLine,
  placeKind,
  placeName,
  placeTier,
  prompt,
  settings,
  standLine,
  travelHud,
} from '../../ui/state';
import type { GameHost } from '../host';
import {
  PLANET_PRESET_SPECS,
  chunkToSphere,
  globeDiameterPx,
  globeLook,
  globeTurnWeight,
  homeChunk,
  type WorldSource,
  homePatchRgba,
} from '../../core/planet';

/** Home world texture on the globe, texels per side. */
const HOME_PATCH_TEXELS = 256;
/** Wait this long after the map first draws before baking the globe in the background. */
const GLOBE_PREFETCH_SEC = 1.2;
import type { Scene } from '../scene-stack';

const MAP_CONTROLS =
  'WASD walk · Shift sprint · H halt / roll out · T time waits / time runs · wheel or +/- zoom · drag to pan · click a town, site, or land to route · Shift+click adds a stop · Enter walks this ground in 3D';

export class MapView implements Scene {
  readonly id = 'map';
  private readonly camera = new MapCamera();
  private detachInput: (() => void) | null = null;
  private framed = false;
  /** Settlement id the walker just stepped onto. Held until the keys are released. */
  private settlementHold: string | null = null;
  /** Seconds left before Enter can open 3D again after a return. */
  private entryCooldown = 0;
  private detachClicks: (() => void) | null = null;
  /** Route clicks in fine tiles, converted with the camera as it was when clicked. */
  private readonly clicks: Array<{ x: number; y: number; pick: number; append: boolean }> = [];
  private hudKey = '';
  /** Hero walked under move input this frame. Drives the paused-clock readout. */
  private walking = false;
  private bare = false;
  private barePainted = false;
  /** Seconds the map has been up with a world, for the globe prefetch. */
  private mapAge = 0;
  /** Player's turn of the globe, radians (latitude, longitude). */
  private globeTurn = { lat: 0, lon: 0 };
  private globeRadiusPx = 1;

  constructor(private readonly host: GameHost) {}

  enter(): void {
    this.host.keyboard.clearPresses();
    this.host.setMode('map');
    this.host.setView('map');
    this.detachInput = attachMapInput(this.host.mapCanvas, {
      pan: (dx, dy) => {
        if (this.camera.inGlobe()) {
          // Look-only globe: dragging turns the planet.
          const r = Math.max(1, this.globeRadiusPx);
          this.globeTurn.lon -= dx / r;
          this.globeTurn.lat = Math.max(-1.4, Math.min(1.4, this.globeTurn.lat + dy / r));
          return;
        }
        this.camera.panPixels(dx, dy);
      },
      zoom: (sx, sy, factor) => {
        this.applyZoom(sx, sy, factor);
      },
    });
    this.detachClicks = attachRouteClicks(this.host.mapCanvas, (sx, sy, append) => {
      if (this.camera.inGlobe()) return;
      const canvas = this.host.mapCanvas;
      const at = this.camera.screenToWorld(sx, sy, canvas.clientWidth, canvas.clientHeight);
      const step = this.camera.step;
      const pick = (14 / (this.camera.scale * TILE)) * step;
      this.clicks.push({ x: at.x * step, y: at.y * step, pick, append });
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
    this.prepareGlobe(dt);
    const inGlobe = this.camera.inGlobe();
    // The globe is look-only: no walking under it.
    const move = inGlobe ? { x: 0, y: 0 } : this.host.keyboard.mapAxis();
    const motionScale = this.camera.mapScale() / this.camera.step;
    // Map-only pace settings. 3D areas never read these.
    const mapSpeed = settings.value.mapSpeed;
    const onlyWhenMoving = settings.value.timeOnlyWhenMoving;
    // On-foot pace is a multiple of the wagon's map pace, so a scout is only a
    // little quicker than the caravan. The zoom slowdown is measured against it.
    const footWalk = onFootPaceMps(settings.value.onFootSpeed, false);
    const rate = mapClockHoursPerRealSec(motionScale, footWalk);
    if (motionScale < SETTLEMENT_STOP_SCALE) this.settlementHold = null;
    this.flushClicks();
    if ((move.x !== 0 || move.y !== 0) && world.heroAboard) world.leaveCaravan();
    if ((move.x !== 0 || move.y !== 0) && world.data && !this.settlementHold) {
      this.camera.follow = true;
      const footPace = onFootPaceMps(settings.value.onFootSpeed, sprint);
      const speed = walkTilesPerSec(footPace, motionScale, footWalk);
      const dist = speed * mapSpeed * dt;
      const len = Math.hypot(move.x, move.y);
      const step = clampStepToSettlement(
        world.data,
        world.hero.x,
        world.hero.y,
        (move.x / len) * dist,
        (move.y / len) * dist,
        motionScale,
      );
      world.moveHero(step.dx, step.dy);
      const travelled = Math.hypot(step.dx, step.dy);
      this.walking = travelled > 0;
      world.advanceTravel(travelled * METERS_PER_WORLD_TILE, footPace, mapSpeed);
      if (step.holdId) this.settlementHold = step.holdId;
    } else {
      if (move.x === 0 && move.y === 0) this.settlementHold = null;
      this.walking = false;
      // Time only moves while something travels. With "time moves only when I
      // move" on, that is the hero's own walk above (charged by distance) and
      // nothing here. Off, the rolling caravan runs the clock by itself.
      world.stepMapIdle(dt, rate, mapSpeed, onlyWhenMoving);
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
    // H is the leader's Halt / Roll out, the same key as in 3D. The map does not use H otherwise.
    if (this.host.keyboard.consumePress('KeyH')) leaderToggleHalt(this.host);
    for (const event of world.takeCaravanEvents()) {
      this.host.toast(`The caravan reaches ${event.name ?? 'its destination'}.`);
    }
    this.entryCooldown = stepEntryCooldown(this.entryCooldown, dt);
    this.camera.update(dt, world.hero.x, world.hero.y);
    if (this.entryCooldown > 0 || inGlobe) {
      this.host.keyboard.consumePress('Enter');
    } else if (this.host.keyboard.consumePress('Enter')) {
      this.host.enterArea();
    }
  }

  /**
   * The dive out has finished. The map did not tick under it, so the cooldown
   * set at hand-back would only now start; the dive already kept the leaving
   * key from re-entering, so drop stray presses and allow Enter at once.
   */
  settleAreaReturn(): void {
    this.entryCooldown = 0;
    this.host.keyboard.clearPresses();
  }

  /** True once the post-exit cooldown has elapsed. */
  allowEnter(): boolean {
    return this.entryCooldown <= 0;
  }

  /**
   * Called when 3D hands back to the map. Ease off the zoom cap and ignore
   * Enter until the cooldown elapses, so the leaving key cannot re-enter.
   */
  noteAreaReturn(): void {
    this.entryCooldown = MAP_ENTRY_COOLDOWN_SEC;
    this.camera.easeScale(zoomAfterArea(this.camera.targetScale));
    this.host.keyboard.clearPresses();
  }

  render(_alpha: number): void {
    const world = this.host.world;
    const data = world.data;
    if (this.host.view !== 'map' || !data) {
      this.host.globe.hide();
      nearTown.value = false;
      canEnter.value = false;
      placeName.value = '';
      standLine.value = '';
      nearestLine.value = '';
      clockRate.value = '';
      mapNight.value = 0;
      // The 3D view owns the travel HUD while it is up.
      this.hudKey = '';
    } else {
      this.publishTravel();
      const stand = describeMapStand(data, world.hero.x, world.hero.y);
      nearTown.value = stand.kind !== 'wilderness' && stand.kind !== 'water' && !!stand.tier;
      // The Enter button is live only when Enter would act (not in the cooldown).
      canEnter.value = stand.canEnter && this.allowEnter() && !this.camera.inGlobe();
      placeName.value = stand.name;
      placeTier.value = stand.tier;
      placeKind.value = stand.kind;
      standLine.value = stand.standLine;
      nearestLine.value = stand.nearestLine;
      clockRate.value = formatMapClockRate(
        this.camera.mapScale() / this.camera.step,
        onFootPaceMps(settings.value.onFootSpeed, false),
      );
      mapNight.value = dayLightAt(world.clockHours).mapNight;
      hint.value = MAP_CONTROLS;
      prompt.value = stand.blockedReason ? 'Open water. Walk ashore to enter.' : '';
    }
    this.host.mapCanvas.dataset.scale = this.camera.scale.toFixed(4);
    if (this.host.view === 'map' && data && this.showGlobe()) return;
    // Under the 3D view the dive holds the map still: keep its last bare frame.
    if (this.bare && this.host.view !== 'map' && this.barePainted) return;
    this.barePainted = this.bare;
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
      caravan: this.caravanDraw(),
      zones: this.zonesDraw(),
      bare: this.bare,
    });
  }

  /**
   * Bake the planet globe in the background once the map has settled. Until it
   * is ready the camera stops at the flat map's furthest zoom, as before.
   */
  private prepareGlobe(dt: number): void {
    const world = this.host.world;
    const data = world.data;
    if (!data || this.host.view !== 'map') {
      this.camera.setGlobeZoom(false);
      return;
    }
    this.mapAge += dt;
    const globe = this.host.globe;
    const preset = data.settings.planet;
    const spec = PLANET_PRESET_SPECS[preset];
    const preview = globePreviewSource();
    const key = `${world.seed}:${preset}:${data.width}:${preview ?? 'island'}`;
    if (this.mapAge >= GLOBE_PREFETCH_SEC) {
      if (globe.requestedFor() !== key) {
        globe.prepare(
          preview
            ? // Preview another world source: the planet alone, pinned at its start chunk.
              {
                key,
                source: preview,
                seed: world.seed,
                n: spec.n,
                faceTexels: spec.faceTexels,
                home: null,
                homePatch: null,
              }
            : {
                key,
                source: 'island',
                seed: world.seed,
                n: spec.n,
                faceTexels: spec.faceTexels,
                home: homeChunk(spec.n),
                homePatch: {
                  size: HOME_PATCH_TEXELS,
                  rgba: homePatchRgba(data, HOME_PATCH_TEXELS),
                },
              },
        );
      }
    }
    this.camera.setGlobeZoom(globe.ready);
  }

  /** Draw the globe instead of the map while zoomed out past it. True when the globe is up. */
  private showGlobe(): boolean {
    const globe = this.host.globe;
    const data = this.host.world.data;
    if (!data || !globe.ready || !this.camera.inGlobe()) {
      globe.hide();
      if (!this.camera.inGlobe() && (this.globeTurn.lat !== 0 || this.globeTurn.lon !== 0)) {
        this.globeTurn = { lat: 0, lon: 0 };
      }
      return false;
    }
    const canvas = this.host.mapCanvas;
    const viewW = canvas.clientWidth;
    const viewH = canvas.clientHeight;
    const spec = PLANET_PRESET_SPECS[data.settings.planet];
    const home = globe.home ?? homeChunk(spec.n);
    const hero = this.host.world.hero;
    const clamp01 = (v: number) => Math.min(0.9999, Math.max(0, v));
    const pin = globePreviewSource()
      ? chunkToSphere(spec.n, home)
      : chunkToSphere(spec.n, home, clamp01(hero.x / data.width), clamp01(hero.y / data.height));
    const scale = this.camera.scale;
    const diameterPx = globeDiameterPx(scale, this.camera.cellsWide(), spec.n, viewW, viewH);
    this.globeRadiusPx = diameterPx / 2;
    const weight = globeTurnWeight(scale, this.camera.globeSwitchScale());
    globe.show({
      viewW,
      viewH,
      diameterPx,
      look: globeLook(pin, this.globeTurn.lat, this.globeTurn.lon, weight),
      pin,
    });
    return true;
  }

  /** Terrain-only frames while the dive magnifies the map. */
  setBare(bare: boolean): void {
    this.bare = bare;
  }

  /**
   * Remembered zones (faded by age and by distance from the hero) and the
   * block a zoom-in would open, each behind its own map setting. Null with both off.
   */
  private zonesDraw(): MapZonesDraw | null {
    const { zoneOutlines, zonePreview } = settings.value;
    if (!zoneOutlines && !zonePreview) return null;
    const world = this.host.world;
    const data = world.data;
    if (!data) return null;
    const hero = world.hero;
    const history = (zoneOutlines ? world.zones : []).map((zone, rank) => ({
      x0: zone.x0,
      y0: zone.y0,
      x1: zone.x1,
      y1: zone.y1,
      alpha: zoneOutlineAlpha(rank, zoneDistance(zone, hero.x, hero.y, data.width)),
    }));
    const choice = zonePreview ? world.zoneChoice() : null;
    return {
      history,
      // Over a town the town outline already shows what opens; no preview box.
      preview: choice && showsZonePreview(choice.source) ? { ...choice.rect, alpha: 0.9 } : null,
    };
  }

  /** Caravan wagon, route halves, and pins for the renderer. */
  private caravanDraw(): MapCaravanDraw {
    const caravan = this.host.world.caravan;
    const split = splitRoute(caravan);
    return {
      x: caravan.x,
      y: caravan.y,
      yaw: caravan.yaw,
      done: split.done,
      rest: split.rest,
      targets: hasRoute(caravan)
        ? caravan.targets.map((t) => ({ x: t.x, y: t.y, name: t.name }))
        : [],
      heroApart: !this.host.world.heroAboard,
    };
  }

  private publishTravel(): void {
    const world = this.host.world;
    const hud = travelHudFor(world, {
      clockPaused: !world.mapClockRuns(this.walking, settings.value.timeOnlyWhenMoving),
      view: 'map',
      convoy: null,
    });
    const key = travelHudKey(hud);
    if (key === this.hudKey) return;
    this.hudKey = key;
    travelHud.value = hud;
  }

  private flushClicks(): void {
    const world = this.host.world;
    const data = world.data;
    const pending = this.clicks.splice(0, this.clicks.length);
    if (!data || this.host.view !== 'map') return;
    for (const click of pending) {
      const target = resolveRouteTarget(data, click.x, click.y, click.pick);
      if (!target) {
        this.host.toast('Open water. Pick a spot on land.');
        continue;
      }
      const result = world.routeCaravanTo(target, click.append);
      this.host.toast(result.message);
    }
  }

  clearRoute(): void {
    if (!this.host.world.clearCaravanRoute()) this.host.toast('The leader sets the route.');
  }

  rejoinCaravan(): void {
    this.host.world.rejoinCaravan();
    this.camera.follow = true;
  }

  /** Zoom out until the whole route is on screen. Zoom stays a camera scale. */
  fitRoute(): void {
    const world = this.host.world;
    const canvas = this.host.mapCanvas;
    const frame = routeFrame(
      world.caravan,
      this.camera.step,
      canvas.clientWidth,
      canvas.clientHeight,
    );
    if (!frame) return;
    this.camera.lookAt(frame.x * this.camera.step, frame.y * this.camera.step, frame.scale);
  }

  exit(): void {
    this.host.globe.hide();
    this.detachInput?.();
    this.detachInput = null;
    this.detachClicks?.();
    this.detachClicks = null;
    travelHud.value = null;
    this.hudKey = '';
  }

  lookAt(x: number, y: number, scale?: number): void {
    this.camera.lookAt(x, y, scale);
  }

  /** Screen pixels per ground metre at a map scale. */
  pxPerMetre(scale: number): number {
    return (scale * TILE) / (this.camera.step * METERS_PER_WORLD_TILE);
  }

  /** Camera pose for the 3D dive: centre in tiles and scale. */
  cameraPose(): { x: number; y: number; scale: number } {
    return {
      x: this.camera.x * this.camera.step,
      y: this.camera.y * this.camera.step,
      scale: this.camera.scale,
    };
  }

  /**
   * Hold the camera on a dive frame. `scale` may pass the zoom cap; the dive
   * owns the camera until `endDive`, and the follow camera resumes after.
   */
  diveTo(x: number, y: number, scale: number): void {
    this.barePainted = false;
    this.camera.follow = false;
    this.camera.x = this.camera.targetX = x / this.camera.step;
    this.camera.y = this.camera.targetY = y / this.camera.step;
    this.camera.scale = this.camera.targetScale = scale;
  }

  endDive(): void {
    this.camera.follow = true;
  }

  /** Map scale at the zoom cap, the closest the 2D map draws. */
  closestScale(): number {
    return MAP_ZOOM_CAP;
  }

  private zoom(factor: number): void {
    const canvas = this.host.mapCanvas;
    this.applyZoom(canvas.clientWidth / 2, canvas.clientHeight / 2, factor);
  }

  private applyZoom(sx: number, sy: number, factor: number): void {
    if (this.host.view !== 'map') return;
    const canvas = this.host.mapCanvas;
    this.camera.zoomAt(sx, sy, factor, canvas.clientWidth, canvas.clientHeight);
  }
}

/**
 * Dev preview of another world source on the globe (`?world=trailbound` or
 * `?world=procedural`). The home map itself is unchanged.
 */
function globePreviewSource(): Exclude<WorldSource, 'island'> | null {
  if (typeof location === 'undefined') return null;
  const want = new URLSearchParams(location.search).get('world');
  return want === 'trailbound' || want === 'procedural' ? want : null;
}
