/**
 * Static planet globe: eye candy for the size of the world. A three.js
 * cube-sphere (6 faces, each textured from the planet layer) with the home
 * world stamped on its chunk, a soft atmosphere rim, and one static
 * "you are here" pin. No entities, no clock, no weather.
 *
 * Everything heavy happens off the main thread: the six face textures bake in
 * a module worker (`planet-worker.ts`). The WebGL renderer and meshes are
 * built only the first time the globe is shown, and a frame is drawn only when
 * the view changes.
 */
import * as THREE from 'three';
import { chunkToSphere, FACES, PATCH_FEATHER, type ChunkAddr, type Vec3 } from '../../core/planet';
import {
  bakeOneFace,
  makeLayer,
  resolveHome,
  type PlanetBakeRequest,
  type PlanetBakeResult,
} from './planet-bake';

/** Segments per face edge of the sphere mesh. */
const FACE_SEGMENTS = 40;
/** Segments across the home patch mesh. */
const PATCH_SEGMENTS = 16;
const PIN_PX = { w: 22, h: 32 };

export interface GlobeView {
  viewW: number;
  viewH: number;
  /** Planet diameter in CSS pixels. */
  diameterPx: number;
  /** Unit vector the camera looks down onto (centre of the screen). */
  look: Vec3;
  /** "You are here" on the unit sphere. */
  pin: Vec3 | null;
}

export class PlanetGlobe {
  private canvas: HTMLCanvasElement | null = null;
  private renderer: THREE.WebGLRenderer | null = null;
  private scene: THREE.Scene | null = null;
  private camera: THREE.OrthographicCamera | null = null;
  private pin: THREE.Sprite | null = null;
  private planet: THREE.Group | null = null;
  private worker: Worker | null = null;
  private pending: PlanetBakeRequest | null = null;
  private result: PlanetBakeResult | null = null;
  /** The request being baked or shown; keeps the home patch pixels for the home mesh. */
  private lastRequest: PlanetBakeRequest | null = null;
  private builtKey = '';
  private requestedKey = '';
  private lastViewKey = '';
  private shown = false;
  /** Worker bake time for the current planet, ms. */
  bakeMs = 0;
  /** Main-thread time to upload textures and build meshes, ms. */
  buildMs = 0;

  constructor(
    private readonly root: HTMLElement,
    private readonly after: HTMLElement,
  ) {}

  /** The baked planet's home chunk (the pin's chunk), once ready. */
  get home(): ChunkAddr | null {
    return this.ready && this.result ? this.result.home : null;
  }

  /** True once the textures for the requested planet are back. */
  get ready(): boolean {
    return !!this.result && this.result.key === this.requestedKey;
  }

  /** Key of the planet last asked for ('' before the first request). */
  requestedFor(): string {
    return this.requestedKey;
  }

  get visible(): boolean {
    return this.shown;
  }

  /**
   * Start baking a planet. Cheap to call every frame: a request with the same
   * key is ignored. Needs a browser; in other environments it does nothing.
   */
  prepare(req: PlanetBakeRequest): void {
    if (req.key === this.requestedKey) return;
    this.requestedKey = req.key;
    if (typeof document === 'undefined') return;
    this.root.dataset.globeReady = 'false';
    this.lastRequest = req;
    const worker = this.ensureWorker();
    if (worker) {
      this.pending = req;
      // The worker gets its own copy; the original stays for the home mesh.
      const patch = req.homePatch;
      if (!patch) {
        worker.postMessage(req);
        return;
      }
      const rgba = patch.rgba.slice();
      worker.postMessage({ ...req, homePatch: { size: patch.size, rgba } }, [
        rgba.buffer as ArrayBuffer,
      ]);
      return;
    }
    this.bakeOnMainThread(req);
  }

  show(view: GlobeView): void {
    if (!this.ready || !this.result) return;
    if (!this.renderer && !this.createRenderer()) return;
    if (this.builtKey !== this.result.key) this.buildPlanet(this.result);
    const canvas = this.canvas!;
    if (!this.shown) {
      canvas.style.visibility = 'visible';
      this.shown = true;
      this.root.dataset.globe = 'on';
      this.lastViewKey = '';
    }
    const key = [
      view.viewW,
      view.viewH,
      view.diameterPx.toFixed(2),
      ...view.look.map((v) => v.toFixed(5)),
      ...(view.pin ?? []).map((v) => v.toFixed(5)),
    ].join(',');
    if (key === this.lastViewKey) return;
    this.lastViewKey = key;
    this.draw(view);
  }

  hide(): void {
    if (!this.shown) return;
    this.shown = false;
    if (this.canvas) this.canvas.style.visibility = 'hidden';
    this.root.dataset.globe = 'off';
  }

  dispose(): void {
    this.hide();
    this.worker?.terminate();
    this.worker = null;
    this.renderer?.dispose();
    this.renderer = null;
    this.canvas?.remove();
    this.canvas = null;
  }

  private ensureWorker(): Worker | null {
    if (this.worker) return this.worker;
    if (typeof Worker === 'undefined') return null;
    try {
      const worker = new Worker(new URL('./planet-worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (event: MessageEvent<PlanetBakeResult>) => this.accept(event.data);
      worker.onerror = () => {
        // Fall back to slices on the main thread.
        this.worker?.terminate();
        this.worker = null;
        const req = this.pending;
        if (req && req.key === this.requestedKey) this.bakeOnMainThread(req);
      };
      this.worker = worker;
      return worker;
    } catch {
      return null;
    }
  }

  /** One face per task, so no single frame stalls for the whole planet. */
  private bakeOnMainThread(req: PlanetBakeRequest): void {
    const layer = makeLayer(req);
    const faces: Uint8ClampedArray[] = [];
    let ms = 0;
    let home: ChunkAddr | null = null;
    const next = () => {
      if (req.key !== this.requestedKey) return;
      const t0 = performance.now();
      home ??= resolveHome(layer, req);
      faces.push(bakeOneFace(layer, req, home, faces.length as 0));
      ms += performance.now() - t0;
      if (faces.length < 6) setTimeout(next, 0);
      else this.accept({ key: req.key, home, faces, ms });
    };
    setTimeout(next, 0);
  }

  private accept(result: PlanetBakeResult): void {
    if (result.key !== this.requestedKey) return;
    this.pending = null;
    this.result = result;
    this.bakeMs = result.ms;
    this.root.dataset.globeReady = 'true';
    this.root.dataset.globeBakeMs = String(Math.round(result.ms));
  }

  private createRenderer(): boolean {
    const canvas = document.createElement('canvas');
    canvas.id = 'globe';
    canvas.className = 'view';
    canvas.style.visibility = 'hidden';
    canvas.style.pointerEvents = 'none';
    canvas.style.imageRendering = 'auto';
    canvas.style.background = starfield();
    this.after.insertAdjacentElement('afterend', canvas);
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    } catch {
      canvas.remove();
      return false;
    }
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 20);
    scene.add(camera);
    scene.add(new THREE.AmbientLight(0xffffff, 1.1));
    const sun = new THREE.DirectionalLight(0xfff4e0, 2.1);
    // Riding on the camera: the lit side always faces the viewer, from the upper left.
    sun.position.set(-2.5, 3, 6);
    camera.add(sun);
    scene.add(sun.target);
    this.canvas = canvas;
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    return true;
  }

  private buildPlanet(result: PlanetBakeResult): void {
    const t0 = performance.now();
    const scene = this.scene!;
    if (this.planet) {
      scene.remove(this.planet);
      this.planet.traverse((obj) => {
        if (obj instanceof THREE.Mesh || obj instanceof THREE.Sprite) {
          obj.geometry.dispose();
          const mat = obj.material as THREE.Material & { map?: THREE.Texture | null };
          mat.map?.dispose();
          mat.dispose();
        }
      });
    }
    const req = this.pendingMeta(result.key);
    const group = new THREE.Group();
    const anisotropy = Math.min(4, this.renderer!.capabilities.getMaxAnisotropy());
    result.faces.forEach((rgba, face) => {
      const size = Math.round(Math.sqrt(rgba.length / 4));
      const tex = new THREE.DataTexture(rgba, size, size, THREE.RGBAFormat);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.magFilter = THREE.LinearFilter;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.generateMipmaps = true;
      tex.anisotropy = anisotropy;
      tex.needsUpdate = true;
      const mesh = new THREE.Mesh(
        faceGeometry(face, FACE_SEGMENTS),
        new THREE.MeshLambertMaterial({ map: tex }),
      );
      group.add(mesh);
    });
    if (req?.homePatch) group.add(homePatchMesh(req.n, result.home, req.homePatch));
    group.add(atmosphere());
    scene.add(group);
    this.planet = group;
    const pin = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: pinTexture(), depthTest: true, transparent: true }),
    );
    pin.center.set(0.5, 0.06);
    pin.renderOrder = 2;
    group.add(pin);
    this.pin = pin;
    this.builtKey = result.key;
    this.buildMs = performance.now() - t0;
    this.root.dataset.globeBuildMs = String(Math.round(this.buildMs));
  }

  private pendingMeta(key: string): PlanetBakeRequest | null {
    return this.lastRequest && this.lastRequest.key === key ? this.lastRequest : null;
  }

  private draw(view: GlobeView): void {
    const renderer = this.renderer!;
    const camera = this.camera!;
    const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(view.viewW));
    const h = Math.max(1, Math.round(view.viewH));
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    const radiusPx = Math.max(1, view.diameterPx / 2);
    camera.left = -w / 2 / radiusPx;
    camera.right = w / 2 / radiusPx;
    camera.top = h / 2 / radiusPx;
    camera.bottom = -h / 2 / radiusPx;
    const [lx, ly, lz] = view.look;
    camera.position.set(lx * 5, ly * 5, lz * 5);
    // North up, unless the camera looks straight down a pole.
    if (Math.abs(ly) > 0.999) camera.up.set(0, 0, ly > 0 ? -1 : 1);
    else camera.up.set(0, 1, 0);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    if (this.pin) {
      this.pin.visible = !!view.pin;
      if (view.pin) {
        this.pin.position.set(view.pin[0] * 1.001, view.pin[1] * 1.001, view.pin[2] * 1.001);
        this.pin.scale.set(PIN_PX.w / radiusPx, PIN_PX.h / radiusPx, 1);
      }
    }
    renderer.render(this.scene!, camera);
  }
}

function faceGeometry(face: number, seg: number): THREE.BufferGeometry {
  const f = FACES[face]!;
  const count = (seg + 1) * (seg + 1);
  const pos = new Float32Array(count * 3);
  const uv = new Float32Array(count * 2);
  let k = 0;
  for (let j = 0; j <= seg; j++) {
    const t = (j / seg) * 2 - 1;
    const b = Math.tan((t * Math.PI) / 4);
    for (let i = 0; i <= seg; i++) {
      const s = (i / seg) * 2 - 1;
      const a = Math.tan((s * Math.PI) / 4);
      const x = f.normal[0] + a * f.u[0] + b * f.v[0];
      const y = f.normal[1] + a * f.u[1] + b * f.v[1];
      const z = f.normal[2] + a * f.u[2] + b * f.v[2];
      const l = Math.hypot(x, y, z);
      pos[k * 3] = x / l;
      pos[k * 3 + 1] = y / l;
      pos[k * 3 + 2] = z / l;
      uv[k * 2] = (s + 1) / 2;
      uv[k * 2 + 1] = (t + 1) / 2;
      k++;
    }
  }
  return gridGeometry(pos, uv, seg);
}

function gridGeometry(pos: Float32Array, uv: Float32Array, seg: number): THREE.BufferGeometry {
  const index: number[] = [];
  const row = seg + 1;
  for (let j = 0; j < seg; j++) {
    for (let i = 0; i < seg; i++) {
      const a = j * row + i;
      // Every face frame has u × v = −normal, so this order winds outward-facing.
      index.push(a, a + row, a + 1, a + 1, a + row, a + row + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(pos.slice(), 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(index);
  return geo;
}

/** The home world at full patch resolution, a hair above its chunk. */
function homePatchMesh(
  n: number,
  home: ChunkAddr,
  patch: { size: number; rgba: Uint8ClampedArray },
): THREE.Mesh {
  const seg = PATCH_SEGMENTS;
  const count = (seg + 1) * (seg + 1);
  const pos = new Float32Array(count * 3);
  const uv = new Float32Array(count * 2);
  let k = 0;
  for (let j = 0; j <= seg; j++) {
    for (let i = 0; i <= seg; i++) {
      const p = chunkToSphere(n, home, i / seg, j / seg);
      pos[k * 3] = p[0] * 1.0004;
      pos[k * 3 + 1] = p[1] * 1.0004;
      pos[k * 3 + 2] = p[2] * 1.0004;
      uv[k * 2] = i / seg;
      uv[k * 2 + 1] = j / seg;
      k++;
    }
  }
  const { size } = patch;
  const rgba = featherEdges(patch.rgba, size);
  const tex = new THREE.DataTexture(rgba, size, size, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  const geo = gridGeometry(pos, uv, seg);
  for (let i = 0; i < count; i++) {
    const n = new THREE.Vector3(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]).normalize();
    geo.attributes.normal!.setXYZ(i, n.x, n.y, n.z);
  }
  return new THREE.Mesh(
    geo,
    new THREE.MeshLambertMaterial({ map: tex, transparent: true, depthWrite: false }),
  );
}

/** Fade the outer band of the home patch so its sea melts into the globe's. */
function featherEdges(src: Uint8ClampedArray, size: number): Uint8ClampedArray {
  const out = src.slice();
  const band = Math.max(1, Math.round(size * PATCH_FEATHER));
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const d = Math.min(r, c, size - 1 - r, size - 1 - c);
      if (d >= band) continue;
      const t = d / band;
      out[(r * size + c) * 4 + 3] = Math.round(255 * t * t * (3 - 2 * t));
    }
  }
  return out;
}

function atmosphere(): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: `varying vec3 vN;
void main() {
  vN = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`,
    fragmentShader: `varying vec3 vN;
void main() {
  float rim = pow(1.0 - clamp(vN.z, 0.0, 1.0), 2.6);
  gl_FragColor = vec4(vec3(0.42, 0.66, 1.0) * rim, rim * 0.85);
}`,
  });
  return new THREE.Mesh(new THREE.SphereGeometry(1.02, 64, 32), mat);
}

function pinTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 96;
  const g = c.getContext('2d');
  if (g) {
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.beginPath();
    g.ellipse(32, 90, 10, 4, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#e8b33c';
    g.strokeStyle = '#3a2410';
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(32, 90);
    g.bezierCurveTo(6, 52, 6, 8, 32, 8);
    g.bezierCurveTo(58, 8, 58, 52, 32, 90);
    g.closePath();
    g.fill();
    g.stroke();
    g.fillStyle = '#fff6d8';
    g.beginPath();
    g.arc(32, 34, 10, 0, Math.PI * 2);
    g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** A still starfield as a CSS background (drawn once). */
let starCss = '';
function starfield(): string {
  if (starCss) return starCss;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const g = c.getContext('2d');
  if (g) {
    let s = 1234567;
    const rnd = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 0x100000000;
    for (let i = 0; i < 90; i++) {
      const a = 0.25 + rnd() * 0.65;
      g.fillStyle = `rgba(220,230,255,${a.toFixed(2)})`;
      const r = rnd() < 0.1 ? 1.2 : 0.6;
      g.beginPath();
      g.arc(rnd() * 256, rnd() * 256, r, 0, Math.PI * 2);
      g.fill();
    }
  }
  starCss = `url(${c.toDataURL()}) repeat, radial-gradient(ellipse at 50% 45%, #13203a 0%, #070b14 70%)`;
  return starCss;
}
