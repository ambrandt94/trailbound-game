/* Town session: the controller's player, camera, and town loop without the meadow.
   Default camera is the furthest overhead view (Top-down vista).
   Keyboard and gamepad arrive as an action snapshot; this file does not bind touch.
*/
import { createBlockRig } from '../../characters/pawns.ts';
import { SCREEN_FRAG, SCREEN_VERT } from './screen-shader.js';
import { THREE } from './three-runtime.js';

const DEF = {
  maxSpeed: 5.5,
  sprintMult: 1.6,
  sneakMult: 0.45,
  accel: 45,
  decel: 55,
  turn: 14,
  airCtl: 0.6,
  jumpH: 1.6,
  grav: 30,
  fall: 1.4,
  coyote: 0.1,
  buffer: 0.12,
  dodgeSpeed: 11,
  dodgeTime: 0.42,
  dodgeCd: 0.5,
  head: 1,
  eyes: 2,
  swing: 1,
  lean: 0.5,
  stretch: 0.5,
  scale: 1,
  px: 2,
  slow: 1,
  camYaw: 45,
  camPitch: 50,
  camDist: 60,
  camFov: 24,
  camLag: 0.25,
  splitDist: 9,
  horseMult: 1.9,
};

const VIEWS = [
  { n: 'Top-down vista', camPitch: 50, camDist: 60, camFov: 24, camLag: 0.25 },
  { n: 'Top-down far', camPitch: 56, camDist: 24, camFov: 24, camLag: 0.2 },
  { n: 'Top-down mid', camPitch: 42, camDist: 30, camFov: 52, camLag: 0.12 },
  { n: 'Top-down near', camPitch: 42, camDist: 9, camFov: 36, camLag: 0.1 },
  { n: '3rd-person vista', tp: 1, camPitch: 20, camDist: 26, camFov: 42, camLag: 0.2 },
  { n: '3rd-person far', tp: 1, camPitch: 28, camDist: 9, camFov: 45, camLag: 0.16 },
  { n: '3rd-person mid', tp: 1, camPitch: 20, camDist: 6.5, camFov: 50, camLag: 0.13 },
  { n: '3rd-person near', tp: 1, camPitch: 14, camDist: 4, camFov: 55, camLag: 0.1 },
];

const COLORS = {
  hair: '#d9b25f',
  skin: '#f0c9a8',
  tunic: '#d9602a',
  cloak: '#3f7f8c',
  pants: '#4a5a7a',
  boots: '#3a2d22',
  trim: '#e8e0cc',
};

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const RAD = 0.3;

function playerCount() {
  try {
    const n = Number(new URLSearchParams(location.search).get('players'));
    if (n === 2) return 2;
  } catch {
    /* no location in tests */
  }
  return 1;
}

function hashNoise(x, y, s) {
  const v = Math.sin(x * 12.9898 + y * 78.233 + s * 37.7) * 43758.5453;
  return v - Math.floor(v);
}

function makeTex(col, n, sd) {
  const size = 16;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d');
  const b = new THREE.Color(col);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let k = 1 + (hashNoise(x, y, sd) - 0.5) * n;
      if ((x + y * 2) % 7 === 0) k -= 0.07;
      const rgb = [b.r, b.g, b.b].map((v) => Math.round(clamp(v * k, 0, 1) * 255)).join();
      g.fillStyle = `rgb(${rgb})`;
      g.fillRect(x, y, 1, 1);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function faceTex() {
  const size = 16;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d');
  g.fillStyle = COLORS.skin;
  g.fillRect(0, 0, size, size);
  g.fillStyle = 'rgba(0,0,0,.08)';
  g.fillRect(0, 14, size, 2);
  g.fillStyle = COLORS.hair;
  g.fillRect(3, 6, 4, 1);
  g.fillRect(9, 6, 4, 1);
  g.fillStyle = '#2a1c1c';
  g.fillRect(4, 8, 2, 2);
  g.fillRect(10, 8, 2, 2);
  g.fillStyle = '#fff';
  g.fillRect(5, 8, 1, 1);
  g.fillRect(11, 8, 1, 1);
  g.fillStyle = 'rgba(225,110,110,.55)';
  g.fillRect(2, 11, 2, 1);
  g.fillRect(12, 11, 2, 1);
  g.fillStyle = '#a0524a';
  g.fillRect(7, 12, 2, 1);
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function blankActions() {
  return {
    p1: { x: 0, z: 0, jump: false, sprint: false, sneak: false, roll: false, use: false, emote: false },
    p2: { x: 0, z: 0, jump: false, sprint: false, sneak: false, roll: false, use: false, emote: false },
    camLeft: false,
    camRight: false,
    camUp: false,
    camDown: false,
    view: false,
    mode: false,
  };
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{ getActions: () => object, onExit: (info: object) => void }} hooks
 */
export async function createTownSession(canvas, hooks) {
  const P = { ...DEF };
  let vi = 0;
  let NP = playerCount();
  const isTP = () => vi >= 0 && !!VIEWS[vi]?.tp;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.setPixelRatio(1);
  window.TBRenderer = renderer;

  const scene = new THREE.Scene();
  const horizon = new THREE.Color(0.2, 0.45, 0.85);
  scene.background = horizon;
  scene.fog = new THREE.Fog(horizon, 28, 70);
  const hemi = new THREE.HemisphereLight(0xbfe6ff, 0x9eb8c4, 0.58 * Math.PI);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff0c8, 1.15 * Math.PI);
  sun.position.set(-27, 28, 27);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 0.5;
  sun.shadow.camera.far = 80;
  sun.shadow.camera.left = sun.shadow.camera.bottom = -36;
  sun.shadow.camera.right = sun.shadow.camera.top = 36;
  sun.shadow.bias = -0.0007;
  scene.add(sun);
  scene.add(sun.target);

  const cam = new THREE.PerspectiveCamera(30, 16 / 9, 0.5, 120);
  const camA = cam.clone();
  const camB = cam.clone();
  const rtOpt = { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter };
  const rtA = new THREE.WebGLRenderTarget(2, 2, rtOpt);
  const rtB = new THREE.WebGLRenderTarget(2, 2, rtOpt);
  const rtM = new THREE.WebGLRenderTarget(2, 2, rtOpt);
  const rtMB = new THREE.WebGLRenderTarget(2, 2, rtOpt);
  for (const rt of [rtA, rtB, rtM, rtMB]) rt.texture.colorSpace = THREE.NoColorSpace;
  const U = {
    tA: { value: rtA.texture },
    tB: { value: rtB.texture },
    mA: { value: rtM.texture },
    mB: { value: rtMB.texture },
    res: { value: new THREE.Vector2(2, 2) },
    mres: { value: new THREE.Vector2(2, 2) },
    n: { value: new THREE.Vector2(1, 0) },
    sv: { value: 0 },
    fa: { value: 0 },
    fb: { value: 0 },
    solo: { value: 1 },
    poster: { value: 0 },
    ol: { value: 1 },
    olT: { value: 1 },
    olD: { value: 1 },
    olK: { value: 0 },
    olZ: { value: 0.02 },
    olN: { value: 2 },
    sat: { value: 1 },
    con: { value: 1 },
    bri: { value: 1 },
    gam: { value: 1 },
    hue: { value: 0 },
    dith: { value: 0 },
  };
  const quad = new THREE.Scene();
  const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  quad.add(
    new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({
        uniforms: U,
        depthTest: false,
        vertexShader: SCREEN_VERT,
        fragmentShader: SCREEN_FRAG,
      }),
    ),
  );

  const phong = (tex) =>
    new THREE.MeshPhongMaterial({ map: tex, flatShading: true, shininess: 0, specular: 0x000000 });
  const M = {};
  function buildMats(target, tintHair) {
    const spec = {
      skin: [COLORS.skin, 0.1],
      hair: [COLORS.hair, 0.3],
      tunic: [COLORS.tunic, 0.22],
      cloak: [COLORS.cloak, 0.22],
      pants: [COLORS.pants, 0.18],
      boots: [COLORS.boots, 0.2],
      trim: [COLORS.trim, 0.12],
      pack: ['#8a5a2b', 0.25],
    };
    for (const key of Object.keys(spec)) {
      const tex = makeTex(spec[key][0], spec[key][1], key.length + (tintHair ? 3 : 0));
      target[key] = phong(tex);
    }
    target.face = phong(faceTex());
    if (tintHair) target.hair.color.setRGB(0.7, 0.62, 1.3);
  }
  buildMats(M, false);
  const M2 = {};
  buildMats(M2, true);
  M2.tunic.map = M.cloak.map;
  M2.cloak.map = M.tunic.map;

  await import('./boot.js');

  const BGO = new THREE.Color(0.2, 0.45, 0.85);
  const BGI = new THREE.Color('#140f0b');
  if (window.TBVisuals) {
    TBVisuals.mount({
      P,
      sun,
      hemi,
      R: renderer,
      BGO,
      scene,
      U,
      setCam(k, val) {
        P[k] = val;
        vi = VIEWS.findIndex(
          (v) => v.camPitch === P.camPitch && v.camDist === P.camDist && v.camFov === P.camFov,
        );
      },
    });
  }
  if (window.TBTiles && TBTiles.makeSky) TBTiles.makeSky(scene);

  const BX = [];
  const TH = [];
  const SP = [];
  function inp() {
    return {
      l: 0, r: 0, u: 0, d: 0, j: 0, s: 0, c: 0, gx: 0, gy: 0, gsp: 0, gsn: 0,
      jp: false, dj: false, gj: false, gd: false, ij: false, em: 0, eh: 0, yd: false, pem: 0,
    };
  }
  function mkP(n, x) {
    return {
      n, i: inp(), inv: { herb: 0, coin: 0 }, f: 0, fs: null, zc: 0, emT: 0, yl: false,
      carry: null, mount: null, hop: null, sup: null, lock: false, snap: true,
      x, y: 0, z: 0, vx: 0, vy: 0, vz: 0, yaw: Math.PI, g: true, ct: 0, bt: 0,
      st: 'idle', t: 0, lt: 0, dc: 0, dodge: 0, sm: 1, ddx: 0, ddz: 1, sx: 1, sy: 1,
      vsx: 0, vsy: 0, ph: 0, yt: 0,
    };
  }
  const PLS = [mkP(0, 0), mkP(1, 1.2)];
  const RIGS = [createBlockRig(scene, M), createBlockRig(scene, M2)];
  RIGS[1].root.visible = false;
  RIGS[1].sh.visible = false;

  function goView(i) {
    vi = ((i % VIEWS.length) + VIEWS.length) % VIEWS.length;
    const view = VIEWS[vi];
    P.camPitch = view.camPitch;
    P.camDist = view.camDist;
    P.camFov = view.camFov;
    P.camLag = view.camLag;
  }
  function cycleView() {
    const base = isTP() ? 4 : 0;
    goView(vi < 0 ? 2 : base + ((vi - base + 1) % 4));
  }
  function toggleMode() {
    const level = vi < 0 ? 2 : vi % 4;
    goView(isTP() ? level : 4 + level);
  }

  const ctx = { scene, BX, players: PLS, rigs: RIGS, sun, things: TH, goView };
  if (window.TBArea) TBArea.attach(ctx);
  if (window.TBLive) {
    TBLive.attach(ctx);
    const prevExit = TBLive.requestExit?.bind(TBLive);
    TBLive.requestExit = (info) => {
      if (prevExit) prevExit(info);
      hooks.onExit?.(info || {});
    };
  }
  if (window.TBNpcs) TBNpcs.attach(ctx);

  if (window.TBAvatar && window.TBAssets) {
    void TBAssets.warm(TBAvatar.urls()).then(() => TBAvatar.dressAll());
  }

  function gAt(x, z, y) {
    let h = 0;
    if (window.TBInteriors && TBInteriors.contains(x, z)) h = TBInteriors.groundY(x, z, y);
    else if (window.TBArea && TBArea.active()) h = TBArea.groundY(x, z) || 0;
    for (const b of BX) {
      if (Math.abs(x - b.x) < b.w / 2 + 0.05 && Math.abs(z - b.z) < b.d / 2 + 0.05 && b.h <= y + 0.35) {
        h = Math.max(h, b.h);
      }
    }
    return h;
  }

  const travelFade = document.createElement('div');
  travelFade.style.cssText =
    'position:absolute;inset:0;background:#000;opacity:0;pointer-events:none;z-index:4';
  canvas.parentElement?.appendChild(travelFade);

  function say(obj, text, dur) {
    if (!obj.bub) {
      const c = document.createElement('canvas');
      c.width = 192;
      c.height = 48;
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: new THREE.CanvasTexture(c),
          depthTest: false,
          transparent: true,
        }),
      );
      sprite.material.map.magFilter = sprite.material.map.minFilter = THREE.NearestFilter;
      sprite.material.map.colorSpace = THREE.SRGBColorSpace;
      sprite.scale.set(3.6, 0.9, 1);
      sprite.renderOrder = 9;
      scene.add(sprite);
      obj.bub = sprite;
      obj.bc = c;
      SP.push(obj);
    }
    const g = obj.bc.getContext('2d');
    const short = text.length <= 3;
    g.clearRect(0, 0, 192, 48);
    g.fillStyle = '#fffdf2';
    g.strokeStyle = '#2a1c1c';
    g.lineWidth = 3;
    g.fillRect(3, 3, 186, 36);
    g.strokeRect(3, 3, 186, 36);
    g.fillStyle = '#2a1c1c';
    g.textAlign = 'center';
    g.font = `${short ? 'bold 28px' : 'bold 15px'} monospace`;
    g.fillText(text, 96, short ? 32 : 27);
    obj.bub.material.map.needsUpdate = true;
    obj.bubT = dur || 2;
  }

  function hopTo(p, tx, tz, ty, wg, cb, d, hh) {
    p.hop = { t: 0, d: d || 0.4, fx: p.x, fy: p.y, fz: p.z, tx, tz, ty, wg, cb, hh };
  }
  function travel(p, t) {
    if (p.fs || !t.to) return;
    if (p.mount) {
      p.mount.rider = null;
      p.mount = null;
    }
    p.hop = null;
    p.fs = 'out';
    p.lock = true;
    p.dest = [t.to[0], t.to[1], t.to[2]];
    say(p, '*creak*', 0.8);
  }
  function zoneName(q) {
    const indoors = window.TBInteriors && TBInteriors.nameAt && TBInteriors.nameAt(q.x, q.z);
    if (indoors) return indoors;
    if (window.TBArea && TBArea.active()) return TBArea.name() || 'town';
    return 'town';
  }
  function target(p) {
    if (p.hop || p.emT > 0) return null;
    let best = null;
    let bestD = 1e9;
    for (const t of TH) {
      if (t.gone || t._tbOff) continue;
      const d = Math.hypot(t.x - p.x, t.z - p.z);
      if (d < (t.r || 1.6) && d < bestD && Math.abs((t.y || 0) - p.y) < 1.6) {
        bestD = d;
        best = t;
      }
    }
    if (!best) return null;
    const label =
      best.k === 'portal' ? best.label || (best.tbLeave ? 'Step outside' : 'Enter') :
      best.k === 'door' ? (best.open ? 'Close door' : 'Open door') :
      best.k === 'npc' ? 'Talk' :
      best.k === 'fn' ? (typeof best.label === 'function' ? best.label(best) : best.label || 'Use') :
      'Use';
    return {
      label,
      fn: () => {
        if (best.k === 'portal') {
          if (typeof best.prepare === 'function') best.prepare(best);
          if (best.to) travel(p, best);
        } else if (best.k === 'door') {
          best.open = !best.open;
        } else if (best.k === 'npc') {
          if (best.onTalk) best.onTalk(p);
          const lines = best.lines || ['Hello.'];
          best.li = ((best.li || 0) + 1) % lines.length;
          say(best, lines[best.li], 2.4);
        } else if (best.k === 'fn' && best.use) {
          const s = best.use(p, best);
          if (s) say(best, s, 1.8);
        }
      },
    };
  }
  function pre(p, dt) {
    if (p.zc > 0) p.zc -= dt;
    if (p.emT > 0) p.emT -= dt;
    if (p.fs) {
      p.f += (p.fs === 'out' ? 1 : -1) * dt / 0.25;
      if (p.fs === 'out' && p.f >= 1) {
        p.f = 1;
        const d = p.dest;
        p.x = d[0];
        p.z = d[1];
        if (window.TBInteriors) TBInteriors.onArrive(p);
        p.y = gAt(d[0], d[1], 0);
        p.vx = p.vz = p.vy = 0;
        p.g = true;
        p.yaw = d[2];
        p.snap = true;
        p.fs = 'in';
        p.zc = 1.2;
      } else if (p.fs === 'in' && p.f <= 0) {
        p.f = 0;
        p.fs = null;
        p.lock = false;
      }
    }
    if (p.hop) {
      const h = p.hop;
      p.i.dj = false;
      p.i.jp = false;
      p.i.ij = false;
      h.t += dt / h.d;
      const u = Math.min(1, h.t);
      const tx = h.tx + (h.wg ? h.wg.x : 0);
      const tz = h.tz + (h.wg ? h.wg.z : 0);
      p.x = h.fx + (tx - h.fx) * u;
      p.z = h.fz + (tz - h.fz) * u;
      p.y = h.fy + (h.ty - h.fy) * u + Math.sin(u * Math.PI) * (h.hh || 0.4);
      p.vx = p.vz = p.vy = 0;
      p.g = false;
      if (Math.hypot(tx - h.fx, tz - h.fz) > 0.2) p.yaw = Math.atan2(tx - h.fx, tz - h.fz);
      p.st = 'jump';
      if (u >= 1) {
        p.hop = null;
        p.g = true;
        p.sup = null;
        if (h.cb) h.cb(p);
      }
      return true;
    }
    return false;
  }
  function post(p, dt) {
    const I = p.i;
    if (I.ij) {
      I.ij = false;
      const t = target(p);
      if (t) t.fn();
    }
    const em = I.em || I.pem;
    if (em) {
      I.eh += dt;
      if (I.eh > 0.45 && !I.yd) {
        I.yd = true;
        p.emT = 0.7;
        p.yl = true;
        say(p, 'HEY!!', 1.4);
      }
    } else {
      if (I.eh > 0 && I.eh <= 0.45 && !I.yd) {
        p.emT = 0.9;
        p.yl = false;
        say(p, '♪', 1.2);
      }
      I.eh = 0;
      I.yd = false;
    }
  }
  let clock = 0;
  function step(dt, p) {
    const I = p.i;
    if (!p.n) clock += dt;
    if (pre(p, dt)) return;
    const ix = clamp(I.r - I.l + I.gx, -1, 1);
    const iz = clamp(I.u - I.d - I.gy, -1, 1);
    const th = P.camYaw * Math.PI / 180;
    let mx = Math.cos(th) * ix - Math.sin(th) * iz;
    let mz = -Math.sin(th) * ix - Math.cos(th) * iz;
    let mag = Math.hypot(mx, mz);
    if (mag > 1) {
      mx /= mag;
      mz /= mag;
      mag = 1;
    }
    if (p.emT > 0 || p.lock) {
      mx = mz = mag = 0;
    }
    if (I.jp) {
      p.bt = P.buffer;
      I.jp = false;
    }
    p.bt -= dt;
    p.ct = p.g ? P.coyote : p.ct - dt;
    p.lt -= dt;
    p.dc -= dt;
    p.t += dt;
    if (I.dj && p.dc <= 0 && p.dodge <= 0 && p.emT <= 0 && !p.lock) {
      p.dodge = P.dodgeTime;
      p.dc = P.dodgeTime + P.dodgeCd;
      const dx = mag > 0.1 ? mx / mag : Math.sin(p.yaw);
      const dz = mag > 0.1 ? mz / mag : Math.cos(p.yaw);
      p.ddx = dx;
      p.ddz = dz;
      p.yaw = Math.atan2(dx, dz);
      p.lt = 0;
    }
    I.dj = false;
    if (p.dodge > 0) {
      p.dodge -= dt;
      const k = Math.max(0, p.dodge / P.dodgeTime);
      p.vx = p.ddx * P.dodgeSpeed * (0.3 + 0.7 * k);
      p.vz = p.ddz * P.dodgeSpeed * (0.3 + 0.7 * k);
    } else {
      const sm = p.carry ? 0.8 : I.c || I.gsn ? P.sneakMult : I.s || I.gsp ? P.sprintMult : 1;
      p.sm = sm;
      const ctl = p.g ? 1 : P.airCtl;
      const tx = mx * P.maxSpeed * sm;
      const tz = mz * P.maxSpeed * sm;
      const dx = tx - p.vx;
      const dz = tz - p.vz;
      const len = Math.hypot(dx, dz);
      const a = (mag > 0.05 ? P.accel : P.decel) * ctl * dt;
      if (len <= a) {
        p.vx = tx;
        p.vz = tz;
      } else {
        p.vx += (dx / len) * a;
        p.vz += (dz / len) * a;
      }
      if (mag > 0.15) {
        const ty = Math.atan2(mx, mz);
        let d = ((ty - p.yaw + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
        const m = P.turn * dt;
        p.yaw += clamp(d, -m, m);
      }
    }
    if (p.bt > 0 && p.ct > 0 && p.dodge <= 0 && p.emT <= 0 && !p.lock) {
      p.vy = Math.sqrt(2 * P.grav * P.jumpH);
      p.bt = 0;
      p.ct = 0;
      p.g = false;
      p.lt = 0;
      p.sy = 1 + 0.3 * P.stretch;
      p.sx = 1 - 0.2 * P.stretch;
    }
    p.vy = Math.max(p.vy - P.grav * (p.vy < 0 ? P.fall : 1) * dt, -40);
    const indoors = window.TBInteriors && TBInteriors.contains(p.x, p.z);
    if (indoors) {
      const b = TBInteriors.clamp(p.x + p.vx * dt, p.z + p.vz * dt);
      p.x = b.x;
      p.z = b.z;
    } else if (window.TBArea && TBArea.active()) {
      const b = TBArea.walkClamp(p.x + p.vx * dt, p.z + p.vz * dt);
      p.x = b.x;
      p.z = b.z;
    } else {
      p.x += p.vx * dt;
      p.z += p.vz * dt;
    }
    for (const b of BX) {
      if (b.h > p.y + 0.3 && !(b.y0 != null && p.y < b.y0 - 0.25)) {
        const cx = clamp(p.x, b.x - b.w / 2, b.x + b.w / 2);
        const cz = clamp(p.z, b.z - b.d / 2, b.z + b.d / 2);
        const dx = p.x - cx;
        const dz = p.z - cz;
        const d = Math.hypot(dx, dz);
        if (d < RAD) {
          if (d > 1e-4) {
            p.x = cx + (dx / d) * RAD;
            p.z = cz + (dz / d) * RAD;
          } else p.x += RAD;
        }
      }
    }
    const was = p.g;
    p.y += p.vy * dt;
    const gh = gAt(p.x, p.z, p.y);
    p.g = false;
    if (p.y <= gh && p.vy <= 0) {
      const v0 = p.vy;
      p.y = gh;
      p.vy = 0;
      p.g = true;
      if (!was && v0 < -6) {
        const k = clamp(-v0 / 20, 0.2, 1);
        p.lt = 0.05 + 0.1 * k;
        p.sy = 1 - 0.4 * k * P.stretch;
        p.sx = 1 + 0.3 * k * P.stretch;
      }
    }
    if (p.y < -10 && window.TBArea && TBArea.active()) {
      const s = TBArea.spawn();
      p.x = s.x + (p.n ? 1.2 : 0);
      p.z = s.z;
      p.y = (s.y || 0) + 2;
      p.vy = 0;
    }
    const ty = p.g ? 1 : 1 + clamp(Math.abs(p.vy) / 40, 0, 0.2) * P.stretch;
    const tx2 = p.g ? 1 : 1 - clamp(Math.abs(p.vy) / 80, 0, 0.1) * P.stretch;
    p.vsy += ((ty - p.sy) * 500 - p.vsy * 22) * dt;
    p.sy += p.vsy * dt;
    p.vsx += ((tx2 - p.sx) * 500 - p.vsx * 22) * dt;
    p.sx += p.vsx * dt;
    const spd = Math.hypot(p.vx, p.vz);
    let ns;
    if (p.emT > 0) ns = p.yl ? 'yell' : 'emote';
    else if (p.dodge > 0) ns = 'dodge';
    else if (p.g) ns = p.lt > 0 && mag < 0.1 ? 'land' : spd > 0.4 ? (p.sm < 1 ? 'sneak' : p.sm > 1 ? 'sprint' : 'run') : 'idle';
    else ns = p.vy > 0 ? 'jump' : 'fall';
    if (ns !== p.st) {
      p.st = ns;
      p.t = 0;
    }
    p.ph += spd * dt * 1.9;
    post(p, dt);
  }

  function applyPad(I, pad) {
    I.l = pad.x < -0.2 ? 1 : 0;
    I.r = pad.x > 0.2 ? 1 : 0;
    I.u = pad.z > 0.2 ? 1 : 0;
    I.d = pad.z < -0.2 ? 1 : 0;
    I.s = pad.sprint ? 1 : 0;
    I.c = pad.sneak ? 1 : 0;
    if (pad.jump) I.jp = true;
    if (pad.roll) I.dj = true;
    if (pad.use) I.ij = true;
    I.em = pad.emote ? 1 : 0;
  }

  function animateOne(fdt, rig, p) {
    const { root, pv, body, cg, hg, armL, armR, legL, legR, cur, sh } = rig;
    const s = p.st;
    const sp = Math.min(1.3, Math.hypot(p.vx, p.vz) / P.maxSpeed);
    const sw = P.swing;
    const T = { ll: 0, lr: 0, al: 0, ar: 0, lean: 0, cloak: 0.15, crouch: 0 };
    let bob = 0;
    let roll = 0;
    if (s === 'idle') {
      const b = Math.sin(clock * 2.4 + p.n);
      bob = b * 0.012;
      T.al = 0.06 + b * 0.04;
      T.ar = T.al;
      T.cloak = 0.1 + b * 0.04;
    } else if (s === 'run' || s === 'sprint' || s === 'sneak' || s === 'carry' || s === 'ride') {
      const a = Math.sin(p.ph);
      const m = s === 'sprint' ? 1.3 : s === 'sneak' ? 0.55 : 1;
      T.ll = a * 0.95 * sw * m;
      T.lr = -T.ll;
      T.al = -a * 0.8 * sw * m;
      T.ar = -T.al;
      T.lean = P.lean * (s === 'sprint' ? 0.5 : s === 'sneak' ? 0.45 : 0.3) * sp;
      T.cloak = 0.25 + sp * 0.5;
      T.crouch = s === 'sneak' ? 0.16 : 0;
      bob = Math.abs(Math.cos(p.ph)) * 0.07 * (s === 'sneak' ? 0.3 : 1);
    } else if (s === 'dodge') {
      roll = (1 - p.dodge / P.dodgeTime) * 6.2832;
      T.ll = T.lr = -1.3;
      T.al = T.ar = -1.2;
      T.cloak = 0.8;
    } else if (s === 'jump') {
      T.ll = -0.7;
      T.lr = 0.3;
      T.al = T.ar = -2.6;
      T.lean = 0.12 * P.lean;
      T.cloak = 0.6;
    } else if (s === 'fall') {
      T.ll = -0.3;
      T.lr = 0.2;
      T.al = T.ar = -2.2;
      T.cloak = 0.9;
    } else if (s === 'emote') {
      T.ar = -2.5;
      T.al = 0.1;
      T.cloak = 0.2;
    } else if (s === 'yell') {
      T.al = T.ar = -2.7;
      T.lean = -0.3;
      T.cloak = 0.9;
    } else {
      T.ll = T.lr = -0.6;
      T.al = T.ar = -0.5;
      T.lean = 0.2 * P.lean;
    }
    const k = 1 - Math.exp(-fdt * 20);
    for (const q of Object.keys(T)) cur[q] += (T[q] - cur[q]) * k;
    if (!(window.TBAvatar && TBAvatar.drive(rig, p, fdt))) {
      legL.rotation.x = cur.ll;
      legR.rotation.x = cur.lr;
      armL.rotation.x = cur.al;
      armR.rotation.x = cur.ar;
      armL.rotation.z = s === 'fall' ? -0.7 : -0.06;
      armR.rotation.z = s === 'fall' ? 0.7 : 0.06;
      cg.rotation.x = cur.cloak;
      pv.rotation.x = roll;
      body.rotation.x = cur.lean;
      body.position.y = -0.6 + bob;
      body.scale.set(p.sx * (1 + cur.crouch * 0.4), p.sy * (1 - cur.crouch), p.sx * (1 + cur.crouch * 0.4));
      hg.scale.setScalar(P.head);
      hg.position.y = 0.84 + 0.31 * P.head;
      hg.rotation.x = -cur.lean * 0.6;
    }
    root.position.set(p.x, p.y, p.z);
    root.rotation.y = p.yaw;
    root.scale.setScalar(P.scale);
    const ground = gAt(p.x, p.z, p.y);
    sh.position.set(p.x, ground + 0.05, p.z);
    sh.scale.setScalar(clamp(1 - (p.y - ground) * 0.2, 0.3, 1));
    sh.visible = p.n === 0 || NP > 1;
  }

  const cs = { d: P.camDist, p: P.camPitch, f: P.camFov, h: 0.8 };
  const cq = { d: P.camDist, p: P.camPitch, f: P.camFov, h: 0.8 };
  const ctA = new THREE.Vector3();
  const ctB = new THREE.Vector3();
  let camReady = false;
  let sizeKey = '';
  const maskU = { mFogN: { value: 1e5 }, mFogF: { value: 1e6 } };
  const maskMat = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false });
  maskMat.toneMapped = false;
  maskMat.onBeforeCompile = (sh) => {
    const skin = sh.vertexShader.indexOf('skinning_vertex') >= 0;
    sh.uniforms.mFogN = maskU.mFogN;
    sh.uniforms.mFogF = maskU.mFogF;
    sh.vertexShader =
      'varying vec3 vMaskN;\nvarying float vMaskD;\n' +
      sh.vertexShader.replace(
        '#include <project_vertex>',
        '#include <beginnormal_vertex>\n' +
          (skin ? '#include <skinnormal_vertex>\n' : '') +
          'vMaskN=normalize(normalMatrix*objectNormal);\n#include <project_vertex>\nvMaskD=-mvPosition.z;',
      );
    const out =
      'vec3 nn=normalize(vMaskN)*0.5+0.5;float fg=smoothstep(mFogN,mFogF,vMaskD);gl_FragColor=vec4(gl_FragCoord.z,nn.x,nn.y,1.0-0.49*fg);';
    sh.fragmentShader =
      'varying vec3 vMaskN;\nvarying float vMaskD;\nuniform float mFogN,mFogF;\n' + sh.fragmentShader;
    if (sh.fragmentShader.indexOf('#include <opaque_fragment>') >= 0) {
      sh.fragmentShader = sh.fragmentShader.replace('#include <opaque_fragment>', out);
    } else {
      sh.fragmentShader = sh.fragmentShader.replace(
        'gl_FragColor = vec4( outgoingLight, diffuseColor.a );',
        out,
      );
    }
  };
  const maskCache = new Map();
  function maskFor(src) {
    if (!src || !src.alphaTest || !src.map) return maskMat;
    const key = `${src.map.uuid}|${src.alphaTest}|${src.side || 0}`;
    let m = maskCache.get(key);
    if (m) return m;
    m = new THREE.MeshBasicMaterial({
      map: src.map,
      color: 0xffffff,
      alphaTest: src.alphaTest,
      fog: false,
      side: src.side || THREE.FrontSide,
    });
    m.toneMapped = false;
    m.onBeforeCompile = maskMat.onBeforeCompile;
    maskCache.set(key, m);
    return m;
  }
  const occCache = [];
  function occFor(src) {
    const sd = (src && src.side) || 0;
    return occCache[sd] || (occCache[sd] = new THREE.MeshBasicMaterial({ colorWrite: false, fog: false, side: sd }));
  }
  const overlay = (m) => m && m.transparent && m.depthWrite === false;
  const clearColor = new THREE.Color();
  function paintMask(rt, camera) {
    const saved = [];
    scene.traverse((o) => {
      if (!(o.isMesh || o.isInstancedMesh) || !o.visible || !o.material) return;
      const ms = Array.isArray(o.material) ? o.material : [o.material];
      if (ms.every(overlay)) {
        saved.push(o);
        o.visible = false;
        return;
      }
      let node = o;
      let surf = false;
      while (node) {
        if (node.userData && node.userData.surface) {
          surf = true;
          break;
        }
        node = node.parent;
      }
      saved.push(o);
      o.userData._pm = o.material;
      const pick = surf ? occFor : maskFor;
      o.material = Array.isArray(o.material) ? o.material.map(pick) : pick(o.material);
    });
    const bg = scene.background;
    const fog = scene.fog;
    const ca = renderer.getClearAlpha();
    const sh = renderer.shadowMap.enabled;
    if (fog) {
      maskU.mFogN.value = fog.near;
      maskU.mFogF.value = fog.far;
    } else {
      maskU.mFogN.value = 1e5;
      maskU.mFogF.value = 1e6;
    }
    renderer.getClearColor(clearColor);
    const cc = clearColor.clone();
    scene.background = null;
    scene.fog = null;
    renderer.shadowMap.enabled = false;
    renderer.setClearColor(0x000000, 0);
    renderer.setRenderTarget(rt);
    renderer.clear(true, true, true);
    renderer.render(scene, camera);
    scene.background = bg;
    scene.fog = fog;
    renderer.shadowMap.enabled = sh;
    renderer.setClearColor(cc, ca);
    for (let i = saved.length - 1; i >= 0; i--) {
      const o = saved[i];
      if (o.userData._pm) {
        o.material = o.userData._pm;
        o.userData._pm = null;
      } else o.visible = true;
    }
  }

  function zoneOf(q) {
    return window.TBInteriors && TBInteriors.contains(q.x, q.z) ? 1 : 0;
  }
  function inRoom(o) {
    const x = o.position.x;
    const z = o.position.z;
    if (window.TBInteriors && TBInteriors.contains(x, z)) return true;
    if (window.TBArea && TBArea.active()) return false;
    return false;
  }
  function tagZones() {
    for (const o of scene.children) {
      const z = inRoom(o) ? 1 : 0;
      if (o._zl !== z) {
        o._zl = z;
        o.traverse((c) => (c.isLight ? c.layers.enableAll() : c.layers.set(z)));
      }
    }
  }
  function env(z, c, dist) {
    const d = dist > 0 ? dist : cs.d;
    const fog = window.TBVisuals ? Math.max(0, TBVisuals.v.fog) : 1;
    const bg = z ? BGI : BGO;
    scene.background = bg;
    scene.fog.color.copy(bg);
    if (z) {
      scene.fog.near = d;
      scene.fog.far = d + 18;
    } else if (fog <= 0.001) {
      scene.fog.near = 1e5;
      scene.fog.far = 1e6;
    } else {
      const near = d + 30;
      const far = Math.min(400, d + 180 + Math.max(0, d - 16) * 2.5);
      scene.fog.near = near;
      scene.fog.far = near + (far - near) / Math.max(0.02, fog);
    }
    c.far = z ? d + 40 : 420;
    c.updateProjectionMatrix();
    c.layers.set(z);
  }
  function placeCam(c, target, d, pitch, look) {
    const pth = pitch == null ? (cs.p * Math.PI) / 180 : pitch;
    const th = (P.camYaw * Math.PI) / 180;
    const lx = look ? look.x : target.x;
    const ly = look ? look.y : target.y;
    const lz = look ? look.z : target.z;
    c.fov = cs.f;
    c.position.set(
      lx + Math.sin(th) * Math.cos(pth) * d,
      0.4 + Math.log(1 + Math.exp((ly + cs.h + Math.sin(pth) * d - 0.4) * 6)) / 6,
      lz + Math.cos(th) * Math.cos(pth) * d,
    );
    c.lookAt(lx, ly + cs.h, lz);
    c.updateMatrixWorld();
  }
  function eyeFor(q, d, pitch) {
    if (!(zoneOf(q) && window.TBInteriors && TBInteriors.frame)) return { d, ph: pitch, look: null };
    const fr = TBInteriors.frame(q);
    return { d: fr.d, ph: pitch, look: fr };
  }

  let actions = blankActions();
  let dragX = 0;
  let dragY = 0;
  let dragId = null;
  const onContext = (e) => e.preventDefault();
  const onDown = (e) => {
    if (e.pointerType !== 'mouse' || e.button !== 2 || dragId !== null) return;
    dragId = e.pointerId;
    dragX = 0;
    dragY = 0;
    lastX = e.clientX;
    lastY = e.clientY;
    canvas.setPointerCapture?.(e.pointerId);
  };
  let lastX = 0;
  let lastY = 0;
  const onMove = (e) => {
    if (e.pointerId !== dragId) return;
    if (dragId !== null && lastX) {
      dragX += e.clientX - lastX;
      dragY += e.clientY - lastY;
    }
    lastX = e.clientX;
    lastY = e.clientY;
  };
  const onUp = (e) => {
    if (e.pointerId !== dragId) return;
    dragId = null;
    lastX = 0;
    lastY = 0;
  };
  canvas.addEventListener('contextmenu', onContext);
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);

  let dead = false;
  let fps = 0;
  let fpsAcc = 0;
  let fpsN = 0;
  let calls = 0;
  let triangles = 0;
  let colorCalls = 0;
  let colorTriangles = 0;
  let lastFrame = performance.now();
  let sunOff = { x: -27, y: 28, z: 27 };

  function followSun() {
    const p = PLS[0];
    if (window.TBVisuals && TBVisuals.sunOffset) sunOff = TBVisuals.sunOffset();
    sun.position.set(p.x + sunOff.x, sunOff.y, p.z + sunOff.z);
    sun.target.position.set(p.x, 0.4, p.z);
  }

  function renderFrame(fdt) {
    const vis = window.TBVisuals ? TBVisuals.v : null;
    const crisp = !vis || vis.pixelFilter !== 0;
    const div = Math.max(1, P.px | 0);
    const sW = Math.max(2, Math.ceil(canvas.clientWidth / div));
    const sH = Math.max(2, Math.ceil(canvas.clientHeight / div));
    const cW = crisp ? sW : Math.max(2, canvas.clientWidth | 0);
    const cH = crisp ? sH : Math.max(2, canvas.clientHeight | 0);
    const key = `${cW}x${cH}@${sW}x${sH}@${crisp ? 1 : 0}`;
    if (key !== sizeKey) {
      sizeKey = key;
      renderer.setSize(cW, cH, false);
      rtA.setSize(sW, sH);
      rtB.setSize(sW, sH);
      rtM.setSize(sW, sH);
      rtMB.setSize(sW, sH);
      U.res.value.set(cW, cH);
      U.mres.value.set(sW, sH);
      const filt = crisp ? THREE.NearestFilter : THREE.LinearFilter;
      for (const rt of [rtA, rtB]) {
        if (rt.texture.magFilter === filt && rt.texture.minFilter === filt) continue;
        rt.texture.magFilter = rt.texture.minFilter = filt;
        const w = rt.width;
        const h = rt.height;
        rt.setSize(w, Math.max(1, h - 1));
        rt.setSize(w, h);
      }
      canvas.style.imageRendering = crisp ? 'pixelated' : 'auto';
    }
    const ink = !(vis && vis.outline === 0);
    const ks = 1 - Math.exp(-fdt * 7);
    cq.d += (P.camDist - cq.d) * ks;
    cq.p += (P.camPitch - cq.p) * ks;
    cq.f += (P.camFov - cq.f) * ks;
    cq.h += ((isTP() ? 1.35 : 0.8) - cq.h) * ks;
    cs.d += (cq.d - cs.d) * ks;
    cs.p += (cq.p - cs.p) * ks;
    cs.f += (cq.f - cs.f) * ks;
    cs.h += (cq.h - cs.h) * ks;
    const kk = P.camLag > 0 ? 1 - Math.exp(-fdt / P.camLag) : 1;
    const a = PLS[0];
    const b = PLS[1];
    if (!camReady || a.snap) {
      ctA.set(a.x, a.y, a.z);
      a.snap = false;
    }
    if (!camReady || b.snap) {
      ctB.set(b.x, b.y, b.z);
      b.snap = false;
    }
    camReady = true;
    ctA.x += (a.x - ctA.x) * kk;
    ctA.y += (a.y - ctA.y) * kk;
    ctA.z += (a.z - ctA.z) * kk;
    ctB.x += (b.x - ctB.x) * kk;
    ctB.y += (b.y - ctB.y) * kk;
    ctB.z += (b.z - ctB.z) * kk;
    const ph = (cs.p * Math.PI) / 180;
    cam.aspect = cW / cH;
    const ea = eyeFor(a, cs.d, ph);
    placeCam(cam, ctA, ea.d, ea.ph, ea.look);
    tagZones();
    if (window.TBInteriors) TBInteriors.showFor(a, P.camYaw, cam, fdt);
    env(zoneOf(a), cam, zoneOf(a) ? ea.d : 0);
    if (window.TBTiles && TBTiles.followSky) TBTiles.followSky(cam);
    followSun();
    travelFade.style.opacity = String(a.f || 0);
    U.solo.value = 1;
    U.sv.value = 0;
    U.fa.value = a.f || 0;
    U.fb.value = 0;
    renderer.info.autoReset = false;
    renderer.info.reset();
    renderer.setRenderTarget(rtA);
    renderer.render(scene, cam);
    colorCalls = renderer.info.render.calls;
    colorTriangles = renderer.info.render.triangles;
    if (ink) paintMask(rtM, cam);
    renderer.setRenderTarget(null);
    renderer.render(quad, quadCam);
    calls = renderer.info.render.calls;
    triangles = renderer.info.render.triangles;
  }

  let started = false;
  const session = {
    async start(areaExport, entry) {
      if (!window.TBArea) throw new Error('town world did not boot');
      const err = TBArea.validate ? TBArea.validate(areaExport) : '';
      if (err) throw new Error(err);
      TBArea.receive(areaExport, null);
      if (entry) applyEntry(entry);
      goView(0);
      started = true;
      publishDebug();
    },
    step(dt) {
      if (dead || !started) return;
      const next = hooks.getActions ? hooks.getActions() : blankActions();
      actions = next || blankActions();
      if (actions.view) cycleView();
      if (actions.mode) toggleMode();
      applyPad(PLS[0].i, actions.p1 || blankActions().p1);
      if (NP > 1) applyPad(PLS[1].i, actions.p2 || blankActions().p2);
      for (let i = 0; i < NP; i++) step(dt, PLS[i]);
    },
    frame() {
      if (dead || !started) return;
      const now = performance.now();
      const fdt = Math.min(0.05, Math.max(0, (now - lastFrame) / 1000));
      lastFrame = now;
      const rot = ((actions.camRight ? 1 : 0) - (actions.camLeft ? 1 : 0)) * 90;
      if (rot) P.camYaw = (P.camYaw - rot * fdt + 360) % 360;
      const pit = (actions.camUp ? 1 : 0) - (actions.camDown ? 1 : 0);
      if (isTP() && pit) P.camPitch = clamp(P.camPitch + pit * 70 * fdt, -5, 85);
      if (dragX || dragY) {
        if (dragX) P.camYaw = (P.camYaw - dragX * 0.3 + 360) % 360;
        if (isTP() && dragY) P.camPitch = clamp(P.camPitch + dragY * 0.25, -5, 85);
        dragX = 0;
        dragY = 0;
        vi = -1;
      }
      for (let i = 0; i < NP; i++) animateOne(fdt, RIGS[i], PLS[i]);
      RIGS[1].root.visible = RIGS[1].sh.visible = NP > 1;
      if (window.TBTiles && TBTiles.tick) TBTiles.tick(fdt);
      if (window.TBLive && TBLive.update) TBLive.update(fdt);
      if (window.TBNpcs && TBNpcs.update) TBNpcs.update(fdt);
      if (window.TBVisuals && TBVisuals.frame) TBVisuals.frame(fdt);
      for (const o of SP) {
        if (o.bubT > 0) {
          o.bubT -= fdt;
          o.bub.visible = true;
          o.bub.position.set(o.x, (o.y || 0) + (o.hy || 2.1), o.z);
        } else if (o.bub) o.bub.visible = false;
      }
      renderFrame(fdt);
      fpsAcc += fdt;
      fpsN += 1;
      if (fpsAcc >= 0.5) {
        fps = fpsN / fpsAcc;
        fpsAcc = 0;
        fpsN = 0;
      }
    },
    prompt() {
      const p = PLS[0];
      const t = target(p);
      const place = zoneName(p);
      return t ? `${t.label}  ·  ${place}` : place;
    },
    indoors() {
      return zoneOf(PLS[0]) === 1;
    },
    bounds() {
      if (!window.TBArea || !TBArea.walkClamp) return null;
      const min = TBArea.walkClamp(-1e9, -1e9);
      const max = TBArea.walkClamp(1e9, 1e9);
      return { minX: min.x, maxX: max.x, minZ: min.z, maxZ: max.z };
    },
    stats() {
      return {
        fps: Math.round(fps),
        calls,
        triangles,
        colorCalls,
        colorTriangles,
        view: vi < 0 ? 'custom' : VIEWS[vi].n,
        name: window.TBArea && TBArea.name ? TBArea.name() : '',
        camDist: P.camDist,
        camFov: P.camFov,
        camPitch: P.camPitch,
        camYaw: P.camYaw,
      };
    },
    dispose() {
      dead = true;
      canvas.removeEventListener('contextmenu', onContext);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      travelFade.remove();
      renderer.dispose();
      if (window.TBRenderer === renderer) window.TBRenderer = null;
      if (window.__tb && window.__tb.session === session) window.__tb = null;
    },
  };

  function applyEntry(entry) {
    const p = PLS[0];
    const pos = entry.pos;
    if (pos && typeof pos === 'object') {
      p.x = +pos.x || 0;
      p.z = +pos.z || 0;
    } else if (entry.side && window.TBArea && TBArea.walkClamp) {
      const t = typeof pos === 'number' ? pos : 0.5;
      const min = TBArea.walkClamp(-1e9, -1e9);
      const max = TBArea.walkClamp(1e9, 1e9);
      const side = String(entry.side).toLowerCase();
      const alongX = min.x + (max.x - min.x) * t;
      const alongZ = min.z + (max.z - min.z) * t;
      const inset = 2.5;
      if (side === 'e' || side === 'east') {
        p.x = max.x - inset;
        p.z = alongZ;
      } else if (side === 'w' || side === 'west') {
        p.x = min.x + inset;
        p.z = alongZ;
      } else if (side === 's' || side === 'south') {
        p.z = max.z - inset;
        p.x = alongX;
      } else {
        p.z = min.z + inset;
        p.x = alongX;
      }
    }
    if (typeof entry.yaw === 'number') p.yaw = entry.yaw;
    p.y = gAt(p.x, p.z, 2);
    p.vx = p.vy = p.vz = 0;
    p.g = true;
    p.snap = true;
  }

  function publishDebug() {
    window.__tb = {
      ready: true,
      session,
      setView: goView,
      player: () => ({
        x: PLS[0].x,
        y: PLS[0].y,
        z: PLS[0].z,
        yaw: PLS[0].yaw,
        fs: PLS[0].fs,
        f: PLS[0].f,
        inside: !!(window.TBInteriors && TBInteriors.contains(PLS[0].x, PLS[0].z)),
      }),
      place(x, z, yaw) {
        PLS[0].x = x;
        PLS[0].z = z;
        if (yaw != null) PLS[0].yaw = yaw;
        PLS[0].y = gAt(x, z, 2);
        PLS[0].vx = PLS[0].vy = PLS[0].vz = 0;
        PLS[0].snap = true;
      },
      doors() {
        return TH.filter((t) => t && (t.tbDoor || t.k === 'portal') && !t._tbOff).map((t) => ({
          k: t.k,
          x: t.x,
          z: t.z,
          y: t.y,
          label: t.label,
        }));
      },
      enterNearest() {
        const p = PLS[0];
        let best = null;
        let bd = 1e9;
        for (const t of TH) {
          if (t._tbOff || (t.k !== 'portal' && t.k !== 'door')) continue;
          const d = Math.hypot(t.x - p.x, t.z - p.z);
          if (d < bd) {
            bd = d;
            best = t;
          }
        }
        if (!best) return false;
        p.x = best.x;
        p.z = best.z;
        p.y = gAt(p.x, p.z, 2);
        p.snap = true;
        const hit = target(p);
        if (hit) hit.fn();
        return !!hit;
      },
      edgePreview() {
        const p = PLS[0];
        const far = TBArea.walkClamp(1e9, p.z);
        p.x = far.x - 4;
        p.y = gAt(p.x, p.z, 2);
        p.vx = 2.2;
        p.vz = 0;
        p.snap = true;
      },
      counts() {
        let meshes = 0;
        let instanced = 0;
        let visibleMeshes = 0;
        scene.traverse((o) => {
          if (o.isInstancedMesh) {
            instanced += 1;
            if (o.visible) visibleMeshes += 1;
          } else if (o.isMesh) {
            meshes += 1;
            if (o.visible) visibleMeshes += 1;
          }
        });
        return { meshes, instanced, visibleMeshes };
      },
      stats: () => session.stats(),
    };
  }

  return session;
}
