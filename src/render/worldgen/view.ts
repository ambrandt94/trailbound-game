/**
 * World Gen's planet view: one lat/long mesh that is a globe at `morph = 0`
 * and the flat world map at `morph = 1` (WG4 animates between them). The
 * texture is the equirect bake (`core/planet/world-bake.ts`); chunk grid,
 * cube-face borders, the start chunk, hover and selection are drawn in the
 * fragment shader from each pixel's direction, so they follow any morph.
 *
 * Draws only when something changed. Built lazily; without WebGL it stays blank.
 */
import * as THREE from 'three';
import {
  biomeLegendRgb,
  latLonToSphere,
  sphereToChunk,
  type ChunkAddr,
  type WorldBake,
} from '../../core/planet';
import { unproject, type ViewState } from './projection';

const SEG_LON = 128;
const SEG_LAT = 64;
/** Behind the planet (the canvas is opaque; this is the stage gradient's middle tone). */
const SPACE = 0x0d1628;

export interface ViewLayers {
  biomes: boolean;
  height: boolean;
  mask: boolean;
  grid: boolean;
  ice: boolean;
  start: boolean;
  /** Flat legend colours washed over the planet (see the biome legend). */
  overlay: boolean;
}

const VERT = /* glsl */ `
attribute vec2 aLL;
uniform float uLon0;
uniform float uLat0;
uniform float uR;
uniform float uMorph;
varying vec2 vLL;
varying vec3 vDir;
varying float vShade;
void main() {
  float lat = aLL.x;
  float dl = aLL.y;
  float lon = uLon0 + dl;
  float cl = cos(lat);
  vDir = vec3(cl * sin(lon), sin(lat), cl * cos(lon));
  vec3 q = vec3(cl * sin(dl), sin(lat), cl * cos(dl));
  float c = cos(uLat0);
  float s = sin(uLat0);
  vec3 g = vec3(q.x, q.y * c - q.z * s, q.y * s + q.z * c);
  vec3 pS = g * uR;
  vec3 pF = vec3(dl * uR, (lat - uLat0) * uR, uR);
  vec3 p = mix(pS, pF, uMorph);
  vLL = vec2(lat, lon);
  vShade = mix(0.55 + 0.45 * max(0.0, g.z), 1.0, uMorph);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;

const FRAG = /* glsl */ `
uniform sampler2D uBiome;
uniform sampler2D uHeight;
uniform sampler2D uFlags;
uniform float uHasTex;
uniform vec4 uLayersA; // biomes, height, mask, ice
uniform vec2 uLayersB; // grid, start
uniform float uOverlay;
uniform float uFocus; // biome id to single out, or -1
uniform vec2 uBakeSize;
uniform vec3 uLegend[16];
uniform float uN;
uniform vec3 uStart;
uniform vec3 uSel;
uniform vec3 uHover;
varying vec2 vLL;
varying vec3 vDir;
varying float vShade;
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

// Pixels from the inside edge of chunk (cx, cy) on 'face', or -1 when outside it.
float cellEdge(vec3 fc, vec2 g, vec2 fw, vec3 cell) {
  if (cell.x < 0.0 || abs(fc.x - cell.x) > 0.5) return -1.0;
  vec2 c = floor(g);
  if (abs(c.x - cell.y) > 0.5 || abs(c.y - cell.z) > 0.5) return -1.0;
  vec2 f = g - c;
  vec2 e = min(f, 1.0 - f) / max(fw, vec2(1e-6));
  return min(e.x, e.y);
}

void main() {
  vec2 uv = vec2(fract((vLL.y + PI) / (2.0 * PI)), 0.5 - vLL.x / PI);
  vec3 col = vec3(0.16, 0.22, 0.32);
  if (uHasTex > 0.5) {
    // Sample only what the layers need (software GL pays for every fetch).
    bool needFlags = uLayersA.z > 0.5 || uLayersA.w > 0.5 || (uLayersA.x < 0.5 && uLayersA.y < 0.5)
      || uOverlay > 0.5 || uFocus > -0.5;
    vec4 f = needFlags ? texture2D(uFlags, uv) : vec4(0.0);
    if (uLayersA.x > 0.5 && uLayersA.y > 0.5) col = mix(texture2D(uBiome, uv).rgb, texture2D(uHeight, uv).rgb, 0.5);
    else if (uLayersA.y > 0.5) col = texture2D(uHeight, uv).rgb;
    else if (uLayersA.x > 0.5) col = texture2D(uBiome, uv).rgb;
    else col = f.r > 0.5 ? vec3(0.6, 0.58, 0.52) : vec3(0.1, 0.16, 0.26);
    if (uLayersA.z > 0.5) col = mix(col, f.r > 0.5 ? vec3(0.97) : vec3(0.04, 0.05, 0.08), 0.82);
    if (uLayersA.w > 0.5 && f.g > 0.02) {
      float stripe = step(0.5, fract((gl_FragCoord.x + gl_FragCoord.y) / 9.0));
      col = mix(col, vec3(0.72, 0.94, 1.0), f.g * (0.45 + 0.35 * stripe));
    }
    if (uOverlay > 0.5 || uFocus > -0.5) {
      // Biome id from the flags' blue channel, read at the texel centre (no blending of ids).
      vec2 tuv = (floor(uv * uBakeSize) + 0.5) / uBakeSize;
      int id = int(floor(texture2D(uFlags, tuv).b * 255.0 + 0.5));
      vec3 lc = vec3(0.5);
      for (int i = 0; i < 16; i++) { if (i == id) lc = uLegend[i]; }
      if (uOverlay > 0.5) col = mix(col, lc, 0.62);
      if (uFocus > -0.5) {
        if (abs(float(id) - uFocus) < 0.5) col = mix(col, lc, 0.5) * 1.12;
        else col = mix(col, vec3(dot(col, vec3(0.3, 0.59, 0.11))), 0.7) * 0.4;
      }
    }
  }
  col *= vShade;
  vec3 fc = faceCoord(normalize(vDir));
  vec2 g = (fc.yz + 1.0) * 0.5 * uN;
  vec2 fw = fwidth(g);
  if (uLayersB.x > 0.5) {
    vec2 dist = abs(fract(g - 0.5) - 0.5) / max(fw, vec2(1e-6));
    float line = 1.0 - clamp(min(dist.x, dist.y) - 0.35, 0.0, 1.0);
    col = mix(col, vec3(0.04, 0.05, 0.07), line * 0.38);
    vec2 edge = min(g, uN - g) / max(fw, vec2(1e-6));
    float border = 1.0 - clamp(min(edge.x, edge.y) - 1.2, 0.0, 1.0);
    col = mix(col, vec3(0.96, 0.76, 0.26), border);
  }
  float hov = cellEdge(fc, g, fw, uHover);
  if (hov >= 0.0) col = mix(col, vec3(1.0), 0.18);
  float st = uLayersB.y > 0.5 ? cellEdge(fc, g, fw, uStart) : -1.0;
  if (st >= 0.0) {
    col = mix(col, vec3(0.9, 0.2, 0.16), 0.16);
    if (st < 2.6) col = vec3(0.92, 0.18, 0.14);
  }
  float sel = cellEdge(fc, g, fw, uSel);
  if (sel >= 0.0 && sel < 2.2) col = vec3(1.0);
  gl_FragColor = vec4(col, 1.0);
}`;

function cellVec(a: ChunkAddr | null): THREE.Vector3 {
  return a ? new THREE.Vector3(a.face, a.cx, a.cy) : new THREE.Vector3(-1, -1, -1);
}

/**
 * The chunk map laid over the planet during a fly in or out (WG4): drawn in
 * the same WebGL frame, so the crossfade costs no extra compositing.
 * Position is the chunk centre's offset from the view centre (CSS px, y down).
 */
export interface ChunkOverlay {
  x: number;
  y: number;
  /** Clockwise turn, radians. */
  turn: number;
  /** Side length, CSS px. */
  sidePx: number;
  opacity: number;
}

export class WorldGenView {
  readonly canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer | null = null;
  private scene: THREE.Scene | null = null;
  private camera: THREE.OrthographicCamera | null = null;
  private material: THREE.ShaderMaterial | null = null;
  private textures: THREE.DataTexture[] = [];
  private dirty = true;
  private failed = false;
  private w = 0;
  private h = 0;
  /** Last frame's draw time, ms (for perf readouts). */
  drawMs = 0;
  /**
   * Resolution while a transition runs, as a share of the full one. Software
   * GL pays per pixel; a reduced resolution for 0.6 s of motion is not visible,
   * and the settled frame is drawn sharp again.
   */
  motionScale = 0.4;
  private moving = false;
  private ratio = 0;
  private overlayMesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> | null = null;
  private overlayTex: { image: HTMLCanvasElement; tex: THREE.CanvasTexture } | null = null;
  /** The chunk map over the planet, or null (the usual case). */
  overlay: ChunkOverlay | null = null;
  view: ViewState = { lon0: 0, lat0: 0.35, radiusPx: 260, morph: 0 };
  layers: ViewLayers = {
    biomes: true,
    height: false,
    mask: false,
    grid: true,
    ice: false,
    start: true,
    overlay: false,
  };
  /** Biome the legend singles out (hover or tap), or null. */
  focus: number | null = null;
  n = 20;
  start: ChunkAddr | null = null;
  selected: ChunkAddr | null = null;
  hover: ChunkAddr | null = null;

  constructor(private readonly host: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'wg-planet';
    host.append(this.canvas);
  }

  /** Mark for redraw (call after changing `view`, `layers`, `start`, …). */
  invalidate(): void {
    this.dirty = true;
  }

  setBake(bake: WorldBake): void {
    if (!this.ensure()) return;
    for (const t of this.textures) t.dispose();
    this.textures = [bake.biome, bake.height, bake.flags].map((data) => {
      const tex = new THREE.DataTexture(data, bake.w, bake.h, THREE.RGBAFormat);
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.magFilter = THREE.LinearFilter;
      tex.minFilter = THREE.LinearFilter;
      tex.generateMipmaps = false;
      tex.needsUpdate = true;
      return tex;
    });
    const u = this.material!.uniforms;
    u.uBiome!.value = this.textures[0];
    u.uHeight!.value = this.textures[1];
    u.uFlags!.value = this.textures[2];
    u.uHasTex!.value = 1;
    (u.uBakeSize!.value as THREE.Vector2).set(bake.w, bake.h);
    this.dirty = true;
  }

  /** The chunk under a client point, or null off the planet (or mid-morph). */
  pick(clientX: number, clientY: number): ChunkAddr | null {
    const m = this.view.morph;
    if (m > 0.02 && m < 0.98) return null;
    const rect = this.canvas.getBoundingClientRect();
    const ll = unproject(
      this.view,
      clientX - rect.left - rect.width / 2,
      clientY - rect.top - rect.height / 2,
    );
    if (!ll) return null;
    return sphereToChunk(this.n, latLonToSphere(ll.lat, ll.lon)).chunk;
  }

  /** Draw if anything changed. Returns true when a frame was drawn. */
  render(): boolean {
    if (!this.ensure()) return false;
    const rect = this.host.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    const ratio = baseRatio() * (this.moving ? this.motionScale : 1);
    if (w !== this.w || h !== this.h || ratio !== this.ratio) {
      this.w = w;
      this.h = h;
      this.ratio = ratio;
      this.renderer!.setPixelRatio(ratio);
      this.renderer!.setSize(w, h, false);
      this.canvas.style.width = `${w}px`;
      this.canvas.style.height = `${h}px`;
      const cam = this.camera!;
      cam.left = -w / 2;
      cam.right = w / 2;
      cam.top = h / 2;
      cam.bottom = -h / 2;
      cam.updateProjectionMatrix();
      this.dirty = true;
    }
    if (!this.dirty) return false;
    this.dirty = false;
    const t0 = performance.now();
    const u = this.material!.uniforms;
    u.uLon0!.value = this.view.lon0;
    u.uLat0!.value = this.view.lat0;
    u.uR!.value = this.view.radiusPx;
    u.uMorph!.value = this.view.morph;
    u.uN!.value = this.n;
    const l = this.layers;
    (u.uLayersA!.value as THREE.Vector4).set(+l.biomes, +l.height, +l.mask, +l.ice);
    (u.uLayersB!.value as THREE.Vector2).set(+l.grid, +l.start);
    u.uOverlay!.value = l.overlay ? 1 : 0;
    u.uFocus!.value = this.focus ?? -1;
    u.uStart!.value = cellVec(this.start);
    u.uSel!.value = cellVec(this.selected);
    u.uHover!.value = cellVec(this.hover);
    const mesh = this.overlayMesh!;
    const o = this.overlay;
    mesh.visible = !!o && !!this.overlayTex && o.opacity > 0.002;
    if (o && mesh.visible) {
      mesh.position.set(o.x, -o.y, 0);
      mesh.rotation.z = -o.turn;
      mesh.scale.set(o.sidePx, o.sidePx, 1);
      mesh.material.opacity = o.opacity;
    }
    this.renderer!.render(this.scene!, this.camera!);
    this.drawMs = performance.now() - t0;
    return true;
  }

  /**
   * The chunk map image for overlays. Uploaded now (when the map arrives), so
   * a fly never waits on a texture upload.
   */
  setOverlayImage(image: HTMLCanvasElement | null): void {
    if (this.overlayTex?.image === image) return;
    this.overlayTex?.tex.dispose();
    this.overlayTex = null;
    if (!image || !this.ensure()) return;
    const tex = new THREE.CanvasTexture(image);
    tex.colorSpace = THREE.NoColorSpace;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.NearestFilter;
    tex.generateMipmaps = true;
    this.renderer!.initTexture(tex);
    this.overlayTex = { image, tex };
    this.overlayMesh!.material.map = tex;
    this.overlayMesh!.material.needsUpdate = true;
  }

  /** Draw at `motionScale` while a transition runs; back to full resolution after. */
  setMoving(moving: boolean): void {
    if (this.moving === moving) return;
    this.moving = moving;
    this.dirty = true;
  }

  get size(): { w: number; h: number } {
    const rect = this.host.getBoundingClientRect();
    return { w: rect.width, h: rect.height };
  }

  dispose(): void {
    this.overlayTex?.tex.dispose();
    this.overlayTex = null;
    this.overlayMesh?.geometry.dispose();
    this.overlayMesh?.material.dispose();
    for (const t of this.textures) t.dispose();
    this.textures = [];
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
        // Opaque: software GL composites an alpha canvas at a real per-frame cost.
        alpha: false,
        powerPreference: 'low-power',
      });
      renderer.setPixelRatio(baseRatio());
      renderer.setClearColor(SPACE, 1);
      this.renderer = renderer;
    } catch {
      this.failed = true;
      return false;
    }
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100000);
    this.camera.position.set(0, 0, 50000);
    this.camera.lookAt(0, 0, 0);
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uLon0: { value: 0 },
        uLat0: { value: 0 },
        uR: { value: 1 },
        uMorph: { value: 0 },
        uN: { value: 20 },
        uBiome: { value: null },
        uHeight: { value: null },
        uFlags: { value: null },
        uHasTex: { value: 0 },
        uLayersA: { value: new THREE.Vector4(1, 0, 0, 0) },
        uLayersB: { value: new THREE.Vector2(1, 1) },
        uOverlay: { value: 0 },
        uFocus: { value: -1 },
        uBakeSize: { value: new THREE.Vector2(1, 1) },
        uLegend: {
          value: Array.from({ length: 16 }, (_, i) => {
            const c = biomeLegendRgb()[i] ?? [128, 128, 128];
            return new THREE.Vector3(c[0] / 255, c[1] / 255, c[2] / 255);
          }),
        },
        uStart: { value: new THREE.Vector3(-1, -1, -1) },
        uSel: { value: new THREE.Vector3(-1, -1, -1) },
        uHover: { value: new THREE.Vector3(-1, -1, -1) },
      },
    });
    const mesh = new THREE.Mesh(latLonGrid(), this.material);
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    const overlay = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ transparent: true, depthTest: false, depthWrite: false }),
    );
    overlay.renderOrder = 1;
    overlay.frustumCulled = false;
    overlay.visible = false;
    this.overlayMesh = overlay;
    this.scene.add(overlay);
    return true;
  }
}

/** The morph mesh: (lat, Δlon) per vertex, Δlon −π..π so the seam sits behind the globe. */
function latLonGrid(): THREE.BufferGeometry {
  const cols = SEG_LON + 1;
  const rows = SEG_LAT + 1;
  const ll = new Float32Array(cols * rows * 2);
  const pos = new Float32Array(cols * rows * 3);
  for (let j = 0; j < rows; j++) {
    const lat = Math.PI / 2 - (j / SEG_LAT) * Math.PI;
    for (let i = 0; i < cols; i++) {
      const k = j * cols + i;
      ll[k * 2] = lat;
      ll[k * 2 + 1] = -Math.PI + (i / SEG_LON) * 2 * Math.PI;
    }
  }
  const index: number[] = [];
  for (let j = 0; j < SEG_LAT; j++) {
    for (let i = 0; i < SEG_LON; i++) {
      const a = j * cols + i;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      index.push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aLL', new THREE.BufferAttribute(ll, 2));
  geo.setIndex(index);
  return geo;
}

function baseRatio(): number {
  return Math.min(2, globalThis.devicePixelRatio || 1);
}
