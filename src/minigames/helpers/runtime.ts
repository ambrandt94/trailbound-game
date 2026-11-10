import {
  BoxGeometry,
  CanvasTexture,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  Fog,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  NearestFilter,
  RepeatWrapping,
  SRGBColorSpace,
  type BufferGeometry,
  type Camera,
  type Material,
  type Scene,
  type Texture,
} from 'three';

/** Same feel numbers the controller walks an instance with. */
export const WALK = {
  maxSpeed: 5.5,
  accel: 45,
  decel: 55,
  turn: 14,
  grav: 30,
  fall: 1.4,
  jumpH: 1.6,
  radius: 0.3,
};

export interface SimAvatar {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  yaw: number;
  st: string;
  ph: number;
  sx: number;
  sy: number;
  g: boolean;
  kb: number;
  inv: number;
  rig: InstanceRig | null;
}

export interface InstanceRig {
  root: Group;
  pv: Group;
  body: Group;
  cloak: Group;
  head: Group;
  armL: Group;
  armR: Group;
  legL: Group;
  legR: Group;
  shadow: Mesh;
  cur: { ll: number; lr: number; al: number; ar: number; lean: number; cloak: number };
}

export function rnd2(a: number, b: number): number {
  return a + Math.random() * (b - a);
}

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/** r187 physical lights, scaled from the controller's 0.8 so the scenes read the same. */
export function lit(scene: Scene, background: string, fogNear = 0, fogFar = 0, scale = 1): void {
  scene.background = new Color(background);
  const k = 0.8 * Math.PI * scale;
  scene.add(new HemisphereLight('#ffffff', '#7a8a5a', k));
  const sun = new DirectionalLight('#fff0d0', k);
  sun.position.set(-6, 12, 8);
  scene.add(sun);
  if (fogFar > 0) scene.fog = new Fog(background, fogNear, fogFar);
}

const rand = (x: number, y: number, seed: number) => {
  const value = Math.sin(x * 12.9898 + y * 78.233 + seed * 37.7) * 43758.5453;
  return value - Math.floor(value);
};

export function pixelTexture<T extends Texture>(texture: T): T {
  texture.colorSpace = SRGBColorSpace;
  texture.magFilter = NearestFilter;
  texture.minFilter = NearestFilter;
  texture.generateMipmaps = false;
  return texture;
}

/** Controller `mk`: a 16² nearest-neighbour tint. */
export function noiseTexture(color: string, amount: number, seed: number): CanvasTexture {
  const size = 16;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const ink = new Color(color);
  if (ctx) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        let k = 1 + (rand(x, y, seed) - 0.5) * amount;
        if ((x + y * 2) % 7 === 0) k -= 0.07;
        const shade = (channel: number) => Math.round(clamp(channel * k, 0, 1) * 255);
        ctx.fillStyle = `rgb(${shade(ink.r)},${shade(ink.g)},${shade(ink.b)})`;
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }
  const texture = new CanvasTexture(canvas);
  pixelTexture(texture);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  return texture;
}

export function lambert(color: string, amount = 0.3, seed = 1): MeshLambertMaterial {
  return new MeshLambertMaterial({ map: noiseTexture(color, amount, seed) });
}

export function jump(avatar: SimAvatar): void {
  if (!avatar.g) return;
  avatar.vy = Math.sqrt(2 * WALK.grav * WALK.jumpH);
  avatar.g = false;
}

export function walk(
  avatar: SimAvatar,
  dt: number,
  ix: number,
  iy: number,
  radius: number,
  columns: Array<{ x: number; z: number; r: number }> | undefined,
  camYawDeg: number,
): void {
  const th = (camYawDeg * Math.PI) / 180;
  let mx = Math.cos(th) * ix - Math.sin(th) * iy;
  let mz = -Math.sin(th) * ix - Math.cos(th) * iy;
  let mag = Math.hypot(mx, mz);
  if (mag > 1) {
    mx /= mag;
    mz /= mag;
    mag = 1;
  }
  if (avatar.kb > 0) {
    avatar.kb -= dt;
    avatar.vx *= 1 - dt * 3;
    avatar.vz *= 1 - dt * 3;
  } else {
    const k = Math.min(1, (dt * (mag > 0.05 ? WALK.accel : WALK.decel)) / WALK.maxSpeed);
    avatar.vx += (mx * WALK.maxSpeed - avatar.vx) * k;
    avatar.vz += (mz * WALK.maxSpeed - avatar.vz) * k;
  }
  if (mag > 0.15 && avatar.kb <= 0) {
    let turn = Math.atan2(mx, mz) - avatar.yaw;
    turn = Math.atan2(Math.sin(turn), Math.cos(turn));
    avatar.yaw += clamp(turn, -WALK.turn * dt, WALK.turn * dt);
  }
  avatar.x += avatar.vx * dt;
  avatar.z += avatar.vz * dt;
  const reach = Math.hypot(avatar.x, avatar.z);
  if (reach > radius) {
    avatar.x *= radius / reach;
    avatar.z *= radius / reach;
  }
  for (const column of columns ?? []) {
    const dx = avatar.x - column.x;
    const dz = avatar.z - column.z;
    const dist = Math.hypot(dx, dz);
    const limit = column.r + WALK.radius;
    if (dist < limit && dist > 1e-4) {
      avatar.x = column.x + (dx / dist) * limit;
      avatar.z = column.z + (dz / dist) * limit;
    }
  }
  avatar.vy = Math.max(avatar.vy - WALK.grav * (avatar.vy < 0 ? WALK.fall : 1) * dt, -40);
  avatar.y += avatar.vy * dt;
  if (avatar.y <= 0) {
    avatar.y = 0;
    avatar.vy = 0;
    avatar.g = true;
  } else avatar.g = false;
  const speed = Math.hypot(avatar.vx, avatar.vz);
  avatar.st = !avatar.g ? (avatar.vy > 0 ? 'jump' : 'fall') : speed > 0.4 ? 'run' : 'idle';
  avatar.ph += speed * dt * 1.9;
  if (avatar.inv > 0) avatar.inv -= dt;
}

export function follow(
  camera: Camera,
  avatar: SimAvatar,
  dist: number,
  pitchDeg: number,
  camYawDeg: number,
): void {
  const th = (camYawDeg * Math.PI) / 180;
  const ph = (pitchDeg * Math.PI) / 180;
  camera.position.set(
    avatar.x + Math.sin(th) * Math.cos(ph) * dist,
    avatar.y * 0.3 + Math.sin(ph) * dist,
    avatar.z + Math.cos(th) * Math.cos(ph) * dist,
  );
  camera.lookAt(avatar.x, avatar.y * 0.3 + 0.8, avatar.z);
  poseRig(avatar);
}

export function makeSim(x = 0, z = 0): SimAvatar {
  return {
    x,
    y: 0,
    z,
    vx: 0,
    vy: 0,
    vz: 0,
    yaw: Math.PI,
    st: 'idle',
    ph: 0,
    sx: 1,
    sy: 1,
    g: true,
    kb: 0,
    inv: 0,
    rig: null,
  };
}

const PALETTE = {
  skin: '#f0c9a8',
  hair: '#d9b25f',
  tunic: '#d9602a',
  cloak: '#3f7f8c',
  pants: '#4a5a7a',
  boots: '#3a2d22',
  trim: '#e8e0cc',
  pack: '#8a5a2b',
};

function mat(color: string, seed: number): Material {
  return lambert(color, 0.22, seed);
}

/** Controller fallback hero, built inside the instance scene. */
export function mountRig(scene: Scene, avatar: SimAvatar): InstanceRig {
  const tunic = mat(PALETTE.tunic, 1);
  const trim = mat(PALETTE.trim, 2);
  const pack = mat(PALETTE.pack, 3);
  const cloakMat = mat(PALETTE.cloak, 4);
  const skin = mat(PALETTE.skin, 5);
  const pants = mat(PALETTE.pants, 6);
  const boots = mat(PALETTE.boots, 7);
  const hair = mat(PALETTE.hair, 8);
  const root = new Group();
  const pv = new Group();
  const body = new Group();
  pv.position.y = 0.6;
  body.position.y = -0.6;
  root.add(pv);
  pv.add(body);
  scene.add(root);
  const add = (
    geometry: BufferGeometry,
    material: Material,
    x: number,
    y: number,
    z: number,
    parent: Group,
  ) => {
    const mesh = new Mesh(geometry, material);
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  };
  add(new CylinderGeometry(0.2, 0.26, 0.42, 6), tunic, 0, 0.63, 0, body);
  add(new CylinderGeometry(0.28, 0.3, 0.1, 6), trim, 0, 0.82, 0, body);
  add(new CylinderGeometry(0.27, 0.27, 0.07, 6), trim, 0, 0.5, 0, body);
  add(new BoxGeometry(0.3, 0.32, 0.14), pack, 0, 0.64, -0.26, body);
  const cloak = new Group();
  cloak.position.set(0, 0.8, -0.2);
  body.add(cloak);
  add(new BoxGeometry(0.46, 0.42, 0.05), cloakMat, 0, -0.21, 0, cloak);
  const limb = (x: number, y: number) => {
    const group = new Group();
    group.position.set(x, y, 0);
    body.add(group);
    return group;
  };
  const armL = limb(-0.3, 0.8);
  const armR = limb(0.3, 0.8);
  const legL = limb(-0.12, 0.42);
  const legR = limb(0.12, 0.42);
  for (const arm of [armL, armR]) {
    add(new BoxGeometry(0.13, 0.3, 0.13), tunic, 0, -0.15, 0, arm);
    add(new BoxGeometry(0.1, 0.1, 0.1), skin, 0, -0.34, 0, arm);
  }
  for (const leg of [legL, legR]) {
    add(new BoxGeometry(0.16, 0.28, 0.17), pants, 0, -0.14, 0, leg);
    add(new BoxGeometry(0.19, 0.16, 0.27), boots, 0, -0.34, 0.03, leg);
  }
  const head = new Group();
  body.add(head);
  add(new BoxGeometry(0.62, 0.62, 0.62), skin, 0, 0, 0, head);
  add(new BoxGeometry(0.7, 0.26, 0.7), hair, 0, 0.25, 0, head);
  add(new BoxGeometry(0.7, 0.5, 0.14), hair, 0, 0.02, -0.3, head);
  const shadow = new Mesh(
    new CylinderGeometry(0.4, 0.4, 0.02, 14),
    new MeshBasicMaterial({ color: 0x3d5a48, transparent: true, opacity: 0.16, depthWrite: false }),
  );
  scene.add(shadow);
  const rig: InstanceRig = {
    root,
    pv,
    body,
    cloak,
    head,
    armL,
    armR,
    legL,
    legR,
    shadow,
    cur: { ll: 0, lr: 0, al: 0, ar: 0, lean: 0, cloak: 0 },
  };
  avatar.rig = rig;
  return rig;
}

function poseRig(avatar: SimAvatar): void {
  const rig = avatar.rig;
  if (!rig) return;
  const speed = Math.min(1.3, Math.hypot(avatar.vx, avatar.vz) / WALK.maxSpeed);
  const target = { ll: 0, lr: 0, al: 0, ar: 0, lean: 0, cloak: 0.15 };
  if (avatar.st === 'run') {
    const swing = Math.sin(avatar.ph);
    target.ll = swing * 0.95;
    target.lr = -target.ll;
    target.al = -swing * 0.8;
    target.ar = -target.al;
    target.lean = 0.3 * speed;
    target.cloak = 0.25 + speed * 0.5;
  } else if (avatar.st === 'jump' || avatar.st === 'fall') {
    target.al = -2.4;
    target.ar = -2.4;
    target.ll = -0.5;
    target.cloak = 0.7;
  }
  const cur = rig.cur;
  (Object.keys(target) as Array<keyof typeof target>).forEach((key) => {
    cur[key] += (target[key] - cur[key]) * 0.35;
  });
  rig.legL.rotation.x = cur.ll;
  rig.legR.rotation.x = cur.lr;
  rig.armL.rotation.x = cur.al;
  rig.armR.rotation.x = cur.ar;
  rig.cloak.rotation.x = cur.cloak;
  rig.body.rotation.x = cur.lean;
  rig.root.position.set(avatar.x, avatar.y, avatar.z);
  rig.root.rotation.y = avatar.yaw;
  rig.root.visible = !(avatar.inv > 0 && Math.sin(avatar.inv * 30) > 0);
  rig.shadow.position.set(avatar.x, 0.05, avatar.z);
  rig.shadow.scale.setScalar(clamp(1 - avatar.y * 0.2, 0.3, 1));
}

export function box(w: number, h: number, d: number): BoxGeometry {
  return new BoxGeometry(w, h, d);
}

export function cone(r: number, h: number, n = 6): ConeGeometry {
  return new ConeGeometry(r, h, n);
}
