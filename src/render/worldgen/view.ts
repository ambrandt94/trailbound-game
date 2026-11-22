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
import { latLonToSphere, sphereToChunk, type ChunkAddr, type WorldBake } from '../../core/planet';
import { unproject, type ViewState } from './projection';

const SEG_LON = 256;
const SEG_LAT = 128;

export interface ViewLayers {
  biomes: boolean;
  height: boolean;
  mask: boolean;
  grid: boolean;
  ice: boolean;
  start: boolean;
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
    vec3 b = texture2D(uBiome, uv).rgb;
    vec3 h = texture2D(uHeight, uv).rgb;
    vec4 f = texture2D(uFlags, uv);
    if (uLayersA.x > 0.5 && uLayersA.y > 0.5) col = mix(b, h, 0.5);
    else if (uLayersA.y > 0.5) col = h;
    else if (uLayersA.x > 0.5) col = b;
    else col = f.r > 0.5 ? vec3(0.6, 0.58, 0.52) : vec3(0.1, 0.16, 0.26);
    if (uLayersA.z > 0.5) col = mix(col, f.r > 0.5 ? vec3(0.97) : vec3(0.04, 0.05, 0.08), 0.82);
    if (uLayersA.w > 0.5 && f.g > 0.02) {
      float stripe = step(0.5, fract((gl_FragCoord.x + gl_FragCoord.y) / 9.0));
      col = mix(col, vec3(0.72, 0.94, 1.0), f.g * (0.45 + 0.35 * stripe));
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
  view: ViewState = { lon0: 0, lat0: 0.35, radiusPx: 260, morph: 0 };
  layers: ViewLayers = {
    biomes: true,
    height: false,
    mask: false,
    grid: true,
    ice: false,
    start: true,
  };
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
    if (w !== this.w || h !== this.h) {
      this.w = w;
      this.h = h;
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
    u.uStart!.value = cellVec(this.start);
    u.uSel!.value = cellVec(this.selected);
    u.uHover!.value = cellVec(this.hover);
    this.renderer!.render(this.scene!, this.camera!);
    this.drawMs = performance.now() - t0;
    return true;
  }

  get size(): { w: number; h: number } {
    const rect = this.host.getBoundingClientRect();
    return { w: rect.width, h: rect.height };
  }

  dispose(): void {
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
        antialias: true,
        alpha: true,
        powerPreference: 'low-power',
      });
      renderer.setPixelRatio(Math.min(2, globalThis.devicePixelRatio || 1));
      renderer.setClearColor(0x000000, 0);
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
        uStart: { value: new THREE.Vector3(-1, -1, -1) },
        uSel: { value: new THREE.Vector3(-1, -1, -1) },
        uHover: { value: new THREE.Vector3(-1, -1, -1) },
      },
    });
    const mesh = new THREE.Mesh(latLonGrid(), this.material);
    mesh.frustumCulled = false;
    this.scene.add(mesh);
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
