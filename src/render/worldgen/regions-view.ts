/**
 * Regions view (R1): the belief map. One full-screen quad; every pixel runs the
 * bent azimuthal projection backwards (see `core/planet/regions.ts`) and then:
 *
 * - terrain: the known chunks' own maps (a detail atlas, filled lazily) and the
 *   smooth whole-planet bake everywhere else (so chunk seams only ever show
 *   between detailed chunks);
 * - knowledge: visited chunks clear (fading after weeks away), neighbours under
 *   Alex's dithered haze, the rest under his cloud cover tile, with rumour
 *   clearings greyed under the swirl veil;
 * - clouds are pixel art: sampled on a grid snapped to a whole-number scale, so
 *   they stay chunky at any zoom. Without the atlas they are procedural.
 *
 * Rims, puffs, shadows, markers and the poof/reveal animations are drawn on the
 * 2D overlay (`regions-overlay.ts`).
 */
import * as THREE from 'three';
import type { ChunkAddr, ChunkRaster, WorldBake } from '../../core/planet';
import type { CloudAtlas } from './cloud-atlas';

export const DETAIL_SLOT = 256;
export const DETAIL_GRID = 8;
export const MAX_RUMORS = 8;
const SPACE = 0x0b1222;

export interface RegionsUniformState {
  centre: readonly [number, number, number];
  east: readonly [number, number, number];
  north: readonly [number, number, number];
  R: number;
  bend: number;
  thetaMax: number;
  rhoMax: number;
  n: number;
  /** 0 off, 1 pixel-art atlas, 2 procedural. */
  cloudMode: 0 | 1 | 2;
  fog: boolean;
  /** Cloud art pixel scale (CSS px per art pixel), a whole number. */
  pixel: number;
  /** Cloud texture offset in art pixels (drift and view motion), whole numbers. */
  cloudOff: readonly [number, number];
  /** 0..1: how thick the cover and haze are. */
  density: number;
  coverTile: 'A' | 'B';
  maskView: boolean;
  truth: boolean;
  time: number;
  /** Rumour clearings: centre + clearing angle; extra = (confidence, arrived, selected, 0). */
  rumors: ReadonlyArray<{
    at: readonly [number, number, number];
    radius: number;
    confidence: number;
    arrived: boolean;
    selected: boolean;
  }>;
  /** Index into `rumors` to isolate (the poof view), or -1. */
  isolate: number;
  /** 0..1: chunk maps over the bake (they only read once a chunk is big on screen). */
  detailMix: number;
}

const VERT = /* glsl */ `
void main() {
  gl_Position = vec4(position.xy * 2.0, 0.0, 1.0);
}`;

const FRAG = /* glsl */ `
precision highp float;
uniform vec2 uRes;
uniform float uPx;
uniform vec3 uC;
uniform vec3 uE;
uniform vec3 uNo;
uniform float uR;
uniform float uBend;
uniform float uTmax;
uniform float uRmax;
uniform float uN;
uniform sampler2D uBiome;
uniform float uHasBake;
uniform sampler2D uMaskL;
uniform sampler2D uMaskN;
uniform vec2 uMaskSize;
uniform sampler2D uDetail;
uniform sampler2D uAtlas;
uniform vec2 uAtlasSize;
uniform vec4 uCoverRect;
uniform vec4 uHazeRect;
uniform vec4 uVeilRect;
uniform float uCloudMode;
uniform float uFog;
uniform float uP;
uniform vec2 uCloudOff;
uniform float uDensity;
uniform float uMaskView;
uniform float uTruth;
uniform float uTime;
uniform vec4 uRumor[${MAX_RUMORS}];
uniform vec4 uRumorB[${MAX_RUMORS}];
uniform float uRumorCount;
uniform float uIsolate;
uniform float uDetailMix;
const float PI = 3.14159265359;

vec3 faceCoord(vec3 p) {
  vec3 a = abs(p);
  float face;
  vec3 nrm;
  vec3 u;
  vec3 v;
  if (a.z >= a.x && a.z >= a.y) {
    if (p.z >= 0.0) { face = 0.0; nrm = vec3(0.0, 0.0, 1.0); u = vec3(1.0, 0.0, 0.0); }
    else { face = 2.0; nrm = vec3(0.0, 0.0, -1.0); u = vec3(-1.0, 0.0, 0.0); }
    v = vec3(0.0, -1.0, 0.0);
  } else if (a.x >= a.y) {
    if (p.x >= 0.0) { face = 1.0; nrm = vec3(1.0, 0.0, 0.0); u = vec3(0.0, 0.0, -1.0); }
    else { face = 3.0; nrm = vec3(-1.0, 0.0, 0.0); u = vec3(0.0, 0.0, 1.0); }
    v = vec3(0.0, -1.0, 0.0);
  } else {
    u = vec3(1.0, 0.0, 0.0);
    if (p.y >= 0.0) { face = 4.0; nrm = vec3(0.0, 1.0, 0.0); v = vec3(0.0, 0.0, 1.0); }
    else { face = 5.0; nrm = vec3(0.0, -1.0, 0.0); v = vec3(0.0, 0.0, -1.0); }
  }
  float d = dot(p, nrm);
  return vec3(face, atan(dot(p, u) / d) / 0.785398163, atan(dot(p, v) / d) / 0.785398163);
}

// Screen offset from the centre (CSS px, y up) back to the sphere. w = 0 off the planet.
vec4 unproj(vec2 q) {
  float l = length(q);
  float rho = l / uR;
  if (rho > uRmax) return vec4(0.0);
  float t = rho;
  for (int i = 0; i < 6; i++) {
    float f = (1.0 - uBend) * t + uBend * sin(t) - rho;
    float d = max(0.05, 1.0 - uBend + uBend * cos(t));
    t = clamp(t - f / d, 0.0, uTmax);
  }
  vec2 dir = l > 0.0 ? q / l : vec2(0.0);
  vec3 p = uC * cos(t) + (uE * dir.x + uNo * dir.y) * sin(t);
  return vec4(normalize(p), t);
}

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}

// Knowledge at a sphere point: x = level (0 known, .5 glimpsed, 1 unknown, bilinear), y = fade.
vec2 knowledge(vec3 p, out vec3 fc, out vec2 g) {
  fc = faceCoord(p);
  g = (fc.yz + 1.0) * 0.5 * uN;
  vec2 c = clamp(g, vec2(0.5), vec2(uN - 0.5));
  vec2 uv = vec2(fc.x * uN + c.x, c.y) / uMaskSize;
  return texture2D(uMaskL, uv).rg;
}

// Rumour clearings at p: x = open (0..1, not arrived), y = arrived/known-like, z = veil weight.
vec3 rumorsAt(vec3 p, float jitter) {
  vec3 o = vec3(0.0);
  for (int i = 0; i < ${MAX_RUMORS}; i++) {
    if (float(i) >= uRumorCount) break;
    vec4 r = uRumor[i];
    float ang = acos(clamp(dot(p, r.xyz), -1.0, 1.0));
    float open = 1.0 - smoothstep(r.w * 0.72, r.w, ang + jitter * r.w * 0.12);
    if (uRumorB[i].y > 0.5) o.y = max(o.y, open);
    else o.x = max(o.x, open);
  }
  return o;
}

vec4 atlasTexel(vec4 rect, vec2 art) {
  vec2 t = mod(art, rect.zw);
  return texture2D(uAtlas, (rect.xy + floor(t) + 0.5) / uAtlasSize);
}

vec3 lum3(vec3 c) {
  return vec3(dot(c, vec3(0.3, 0.59, 0.11)));
}

void main() {
  vec2 css = vec2(gl_FragCoord.x / uPx, uRes.y - gl_FragCoord.y / uPx);
  vec2 q = vec2(css.x - uRes.x * 0.5, uRes.y * 0.5 - css.y);
  vec4 hit = unproj(q);
  if (hit.w <= 0.0 && length(q) > 0.5) {
    vec3 sky = vec3(0.043, 0.071, 0.133);
    float st = hash(floor(css / 2.0));
    if (st > 0.996) sky += vec3(0.5, 0.48, 0.42) * (st - 0.996) * 220.0;
    gl_FragColor = vec4(sky, 1.0);
    return;
  }
  vec3 p = hit.xyz;
  float theta = hit.w;
  vec3 fc;
  vec2 g;
  vec2 kn = knowledge(p, fc, g);
  vec2 cell = floor(g);
  vec2 local = g - cell;

  // —— terrain ——
  vec3 col = vec3(0.2, 0.3, 0.42);
  vec2 nuv = (vec2(fc.x * uN + min(cell.x, uN - 1.0), min(cell.y, uN - 1.0)) + 0.5) / uMaskSize;
  float slot = floor(texture2D(uMaskN, nuv).r * 255.0 + 0.5);
  if (uHasBake > 0.5) {
    float lat = asin(clamp(p.y, -1.0, 1.0));
    float lon = atan(p.x, p.z);
    col = texture2D(uBiome, vec2(fract((lon + PI) / (2.0 * PI)), 0.5 - lat / PI)).rgb;
  }
  // Known chunks in their own maps once they are big enough on screen to read.
  if (slot > 0.5 && uDetailMix > 0.0) {
    float s = slot - 1.0;
    vec2 o = vec2(mod(s, ${DETAIL_GRID}.0), floor(s / ${DETAIL_GRID}.0));
    vec2 lc = clamp(local, vec2(0.5 / ${DETAIL_SLOT}.0), vec2(1.0 - 0.5 / ${DETAIL_SLOT}.0));
    col = mix(col, texture2D(uDetail, (o + lc) / ${DETAIL_GRID}.0).rgb, uDetailMix);
  }
  col *= mix(1.0, 0.5 + 0.5 * cos(min(theta, PI * 0.5)), uBend);

  float level = uFog > 0.5 ? kn.x : 0.0;
  float fade = uFog > 0.5 ? kn.y : 0.0;
  float known = 1.0 - smoothstep(0.2, 0.3, level);
  // Memory fades: half the colour and a light haze at most.
  col = mix(col, lum3(col) * vec3(1.02, 1.0, 1.05), 0.5 * fade * known);
  col = mix(col, vec3(0.86, 0.84, 0.9), 0.22 * fade * known);
  // Glimpsed: washed out under the haze.
  col = mix(col, lum3(col) * 1.05, 0.4 * (1.0 - known));

  // —— clouds: the canvas is drawn at one pixel per cloud art pixel ——
  vec3 p2 = p;
  float level2 = level;
  vec2 art = floor(css / uP) + uCloudOff;
  float jit = hash(floor(art / 2.0)) - 0.5;
  vec3 rum = rumorsAt(p2, jit);
  vec3 rumHere = rumorsAt(p, 0.0);
  // Rumoured places: greyed and obscured under the violet swirl.
  if (uFog > 0.5 && uTruth < 0.5) {
    float grey = rumHere.x * smoothstep(0.55, 0.95, level);
    vec3 g0 = lum3(col) * vec3(0.92, 0.9, 1.04);
    col = mix(col, g0 * 0.95 + vec3(0.06, 0.05, 0.1), grey * 0.75);
    if (uCloudMode > 0.5 && grey > 0.01) {
      vec4 v = atlasTexel(uVeilRect, art + vec2(uTime * 0.6, 0.0));
      col = mix(col, v.rgb, grey * 0.38);
    }
  }

  float cover = step(0.75 + jit * 0.12, level2);
  cover *= 1.0 - max(rum.x, rum.y);
  if (uIsolate > -0.5) {
    // The poof view: only the rumour's own clearing shows.
    float open = 0.0;
    for (int i = 0; i < ${MAX_RUMORS}; i++) {
      if (abs(float(i) - uIsolate) < 0.5) {
        vec4 r = uRumor[i];
        float ang = acos(clamp(dot(p2, r.xyz), -1.0, 1.0));
        open = 1.0 - step(r.w * (0.95 + jit * 0.12), ang);
      }
    }
    cover = 1.0 - open;
  }
  if (uFog < 0.5) cover = 0.0;
  float haze = uFog > 0.5 ? (1.0 - cover) * smoothstep(0.2, 0.3, level2) * (1.0 - max(rum.x, rum.y)) : 0.0;
  float coverAlpha = uTruth > 0.5 ? 0.35 : mix(0.82, 1.0, uDensity);

  if (uCloudMode > 1.5) {
    // Procedural fallback: banded value noise in the same palette.
    vec2 cp = art / 24.0;
    float nse = vnoise(cp) * 0.55 + vnoise(cp * 2.1 + 3.7) * 0.3 + vnoise(cp * 4.3) * 0.15;
    float band = floor(nse * 4.0) / 3.0;
    vec3 cc = mix(vec3(0.6, 0.58, 0.68), vec3(0.98, 0.93, 0.8), band);
    col = mix(col, cc, cover * coverAlpha);
    float hz = step(0.5, fract((art.x + art.y) * 0.5)) * 0.5 + 0.25;
    col = mix(col, vec3(0.82, 0.8, 0.86), haze * hz * uDensity);
  } else if (uCloudMode > 0.5) {
    vec4 cc = atlasTexel(uCoverRect, art);
    col = mix(col, cc.rgb, cover * coverAlpha);
    vec4 hz = atlasTexel(uHazeRect, art + vec2(17.0, 9.0));
    col = mix(col, hz.rgb, haze * hz.a * mix(0.45, 0.8, uDensity));
  }

  if (uMaskView > 0.5) {
    vec3 mc = level < 0.25 ? vec3(0.32, 0.78, 0.42) : level < 0.75 ? vec3(0.95, 0.75, 0.3) : vec3(0.42, 0.12, 0.16);
    if (slot > 0.5) mc = mix(mc, vec3(0.2, 0.55, 0.95), 0.35);
    mc = mix(mc, mc * 0.55, fade);
    mc = mix(mc, vec3(0.62, 0.45, 0.9), max(rumHere.x, rumHere.y) * 0.8);
    vec2 e = min(local, 1.0 - local) / max(fwidth(g), vec2(1e-5));
    float line = 1.0 - clamp(min(e.x, e.y) - 0.5, 0.0, 1.0);
    col = mix(lum3(col) * 0.35 + mc * 0.65, vec3(0.05), line * 0.6);
  }
  gl_FragColor = vec4(col, 1.0);
}`;

export class RegionsView {
  readonly canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer | null = null;
  private scene: THREE.Scene | null = null;
  private camera: THREE.OrthographicCamera | null = null;
  private material: THREE.ShaderMaterial | null = null;
  private failed = false;
  private bakeTex: THREE.DataTexture | null = null;
  private maskL: THREE.DataTexture | null = null;
  private maskN: THREE.DataTexture | null = null;
  private maskData: { l: Uint8Array; n: Uint8Array; size: number } | null = null;
  private detail: THREE.DataTexture | null = null;
  private detailData: Uint8Array | null = null;
  private detailDirty = false;
  private atlasTex: THREE.Texture | null = null;
  private w = 0;
  private h = 0;
  private ratio = 1;
  drawMs = 0;
  hasAtlas = false;

  constructor(private readonly host: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'wg-regions';
    host.append(this.canvas);
  }

  get size(): { w: number; h: number } {
    const rect = this.host.getBoundingClientRect();
    return { w: rect.width, h: rect.height };
  }

  setBake(bake: WorldBake): void {
    if (!this.ensure()) return;
    this.bakeTex?.dispose();
    const tex = new THREE.DataTexture(bake.biome, bake.w, bake.h, THREE.RGBAFormat);
    tex.wrapS = THREE.RepeatWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    this.bakeTex = tex;
    const u = this.material!.uniforms;
    u.uBiome!.value = tex;
    u.uHasBake!.value = 1;
  }

  setAtlas(atlas: CloudAtlas | null): void {
    if (!this.ensure()) return;
    this.atlasTex?.dispose();
    this.atlasTex = null;
    this.hasAtlas = !!atlas;
    if (!atlas) return;
    const tex = new THREE.Texture(atlas.image);
    tex.flipY = false;
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.colorSpace = THREE.NoColorSpace;
    tex.needsUpdate = true;
    this.atlasTex = tex;
    const u = this.material!.uniforms;
    u.uAtlas!.value = tex;
    (u.uAtlasSize!.value as THREE.Vector2).set(atlas.meta.size[0], atlas.meta.size[1]);
    const rect = (name: string, v: THREE.Vector4) => {
      const r = atlas.rect(name);
      v.set(r.x, r.y, r.w, r.h);
    };
    rect(atlas.meta.tiles.coverA, u.uCoverRect!.value as THREE.Vector4);
    rect(atlas.meta.tiles.haze, u.uHazeRect!.value as THREE.Vector4);
    rect(atlas.meta.tiles.veil, u.uVeilRect!.value as THREE.Vector4);
    this.atlasMeta = atlas;
  }

  private atlasMeta: CloudAtlas | null = null;

  /**
   * Knowledge per chunk, laid out 6n × n (face-major). level: 0 known, 1 glimpsed,
   * 2 unknown; fade 0..1; slot: detail atlas slot or -1.
   */
  setMask(
    n: number,
    cells: (addr: ChunkAddr) => { level: 0 | 1 | 2; fade: number; slot: number },
  ): void {
    if (!this.ensure()) return;
    const w = 6 * n;
    if (!this.maskData || this.maskData.size !== n) {
      this.maskL?.dispose();
      this.maskN?.dispose();
      const l = new Uint8Array(w * n * 4);
      const nn = new Uint8Array(w * n * 4);
      this.maskData = { l, n: nn, size: n };
      const mk = (data: Uint8Array, filter: THREE.MagnificationTextureFilter) => {
        const t = new THREE.DataTexture(data, w, n, THREE.RGBAFormat);
        t.magFilter = filter;
        t.minFilter = filter;
        t.generateMipmaps = false;
        t.wrapS = THREE.ClampToEdgeWrapping;
        t.wrapT = THREE.ClampToEdgeWrapping;
        return t;
      };
      this.maskL = mk(l, THREE.LinearFilter);
      this.maskN = mk(nn, THREE.NearestFilter);
      const u = this.material!.uniforms;
      u.uMaskL!.value = this.maskL;
      u.uMaskN!.value = this.maskN;
      (u.uMaskSize!.value as THREE.Vector2).set(w, n);
    }
    const { l, n: nn } = this.maskData;
    for (let face = 0; face < 6; face++) {
      for (let cy = 0; cy < n; cy++) {
        for (let cx = 0; cx < n; cx++) {
          const c = cells({ face: face as ChunkAddr['face'], cx, cy });
          const i = (cy * w + face * n + cx) * 4;
          l[i] = c.level === 0 ? 0 : c.level === 1 ? 128 : 255;
          l[i + 1] = Math.round(Math.max(0, Math.min(1, c.fade)) * 255);
          l[i + 2] = 0;
          l[i + 3] = 255;
          nn[i] = c.slot >= 0 ? c.slot + 1 : 0;
          nn[i + 3] = 255;
        }
      }
    }
    this.maskL!.needsUpdate = true;
    this.maskN!.needsUpdate = true;
  }

  /** Put a chunk's map into a detail slot (0..63). */
  setDetail(slot: number, raster: ChunkRaster): void {
    if (!this.ensure()) return;
    const side = DETAIL_SLOT * DETAIL_GRID;
    if (!this.detailData) {
      this.detailData = new Uint8Array(side * side * 4);
      const t = new THREE.DataTexture(this.detailData, side, side, THREE.RGBAFormat);
      t.magFilter = THREE.NearestFilter;
      t.minFilter = THREE.LinearFilter;
      t.generateMipmaps = false;
      this.detail = t;
      this.material!.uniforms.uDetail!.value = t;
    }
    const data = this.detailData;
    const ox = (slot % DETAIL_GRID) * DETAIL_SLOT;
    const oy = Math.floor(slot / DETAIL_GRID) * DETAIL_SLOT;
    const src = raster.biome;
    const s = raster.size;
    for (let y = 0; y < DETAIL_SLOT; y++) {
      const sy = Math.min(s - 1, Math.floor(((y + 0.5) * s) / DETAIL_SLOT));
      for (let x = 0; x < DETAIL_SLOT; x++) {
        const sx = Math.min(s - 1, Math.floor(((x + 0.5) * s) / DETAIL_SLOT));
        const si = (sy * s + sx) * 4;
        const di = ((oy + y) * side + ox + x) * 4;
        data[di] = src[si]!;
        data[di + 1] = src[si + 1]!;
        data[di + 2] = src[si + 2]!;
        data[di + 3] = 255;
      }
    }
    this.detailDirty = true;
  }

  render(state: RegionsUniformState): void {
    if (!this.ensure()) return;
    const rect = this.host.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    // One canvas pixel per cloud art pixel: the art stays chunky and software GL
    // shades 1/P² of the pixels. The canvas is scaled up with nearest filtering.
    const ratio = 1 / state.pixel;
    if (w !== this.w || h !== this.h || ratio !== this.ratio) {
      this.w = w;
      this.h = h;
      this.ratio = ratio;
      this.renderer!.setPixelRatio(ratio);
      this.renderer!.setSize(w, h, false);
      this.canvas.style.width = `${w}px`;
      this.canvas.style.height = `${h}px`;
    }
    if (this.detailDirty && this.detail) {
      this.detail.needsUpdate = true;
      this.detailDirty = false;
    }
    const t0 = performance.now();
    const u = this.material!.uniforms;
    (u.uRes!.value as THREE.Vector2).set(w, h);
    u.uPx!.value = this.renderer!.getPixelRatio();
    (u.uC!.value as THREE.Vector3).set(...state.centre);
    (u.uE!.value as THREE.Vector3).set(...state.east);
    (u.uNo!.value as THREE.Vector3).set(...state.north);
    u.uR!.value = state.R;
    u.uBend!.value = state.bend;
    u.uTmax!.value = state.thetaMax;
    u.uRmax!.value = state.rhoMax;
    u.uN!.value = state.n;
    u.uCloudMode!.value = this.hasAtlas || state.cloudMode !== 1 ? state.cloudMode : 2;
    u.uFog!.value = state.fog ? 1 : 0;
    u.uP!.value = state.pixel;
    (u.uCloudOff!.value as THREE.Vector2).set(state.cloudOff[0], state.cloudOff[1]);
    u.uDensity!.value = state.density;
    u.uMaskView!.value = state.maskView ? 1 : 0;
    u.uTruth!.value = state.truth ? 1 : 0;
    u.uTime!.value = state.time;
    u.uIsolate!.value = state.isolate;
    u.uDetailMix!.value = state.detailMix;
    if (this.atlasMeta) {
      const r = this.atlasMeta.rect(
        state.coverTile === 'B'
          ? this.atlasMeta.meta.tiles.coverB
          : this.atlasMeta.meta.tiles.coverA,
      );
      (u.uCoverRect!.value as THREE.Vector4).set(r.x, r.y, r.w, r.h);
    }
    const ra = u.uRumor!.value as THREE.Vector4[];
    const rb = u.uRumorB!.value as THREE.Vector4[];
    const count = Math.min(MAX_RUMORS, state.rumors.length);
    for (let i = 0; i < count; i++) {
      const r = state.rumors[i]!;
      ra[i]!.set(r.at[0], r.at[1], r.at[2], r.radius);
      rb[i]!.set(r.confidence, r.arrived ? 1 : 0, r.selected ? 1 : 0, 0);
    }
    u.uRumorCount!.value = count;
    this.renderer!.render(this.scene!, this.camera!);
    this.drawMs = performance.now() - t0;
  }

  dispose(): void {
    this.bakeTex?.dispose();
    this.maskL?.dispose();
    this.maskN?.dispose();
    this.detail?.dispose();
    this.atlasTex?.dispose();
    this.material?.dispose();
    this.renderer?.dispose();
    this.renderer = null;
    this.canvas.remove();
  }

  private ensure(): boolean {
    if (this.renderer) return true;
    if (this.failed) return false;
    try {
      const renderer = new THREE.WebGLRenderer({
        canvas: this.canvas,
        antialias: false,
        alpha: false,
        powerPreference: 'low-power',
      });
      renderer.setPixelRatio(1);
      renderer.setClearColor(SPACE, 1);
      this.renderer = renderer;
    } catch {
      this.failed = true;
      return false;
    }
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const blank = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, THREE.RGBAFormat);
    blank.needsUpdate = true;
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uRes: { value: new THREE.Vector2(1, 1) },
        uPx: { value: 1 },
        uC: { value: new THREE.Vector3(0, 0, 1) },
        uE: { value: new THREE.Vector3(1, 0, 0) },
        uNo: { value: new THREE.Vector3(0, 1, 0) },
        uR: { value: 300 },
        uBend: { value: 0 },
        uTmax: { value: Math.PI },
        uRmax: { value: Math.PI },
        uN: { value: 20 },
        uBiome: { value: blank },
        uHasBake: { value: 0 },
        uMaskL: { value: blank },
        uMaskN: { value: blank },
        uMaskSize: { value: new THREE.Vector2(1, 1) },
        uDetail: { value: blank },
        uAtlas: { value: blank },
        uAtlasSize: { value: new THREE.Vector2(1, 1) },
        uCoverRect: { value: new THREE.Vector4(0, 0, 1, 1) },
        uHazeRect: { value: new THREE.Vector4(0, 0, 1, 1) },
        uVeilRect: { value: new THREE.Vector4(0, 0, 1, 1) },
        uCloudMode: { value: 2 },
        uFog: { value: 1 },
        uP: { value: 3 },
        uCloudOff: { value: new THREE.Vector2(0, 0) },
        uDensity: { value: 1 },
        uMaskView: { value: 0 },
        uTruth: { value: 0 },
        uTime: { value: 0 },
        uRumor: { value: Array.from({ length: MAX_RUMORS }, () => new THREE.Vector4()) },
        uRumorB: { value: Array.from({ length: MAX_RUMORS }, () => new THREE.Vector4()) },
        uRumorCount: { value: 0 },
        uIsolate: { value: -1 },
        uDetailMix: { value: 1 },
      },
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.material);
    quad.frustumCulled = false;
    this.scene.add(quad);
    return true;
  }
}
