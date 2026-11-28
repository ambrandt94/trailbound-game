import {
  Color,
  Fog,
  Group,
  HemisphereLight,
  DirectionalLight,
  Mesh,
  MeshLambertMaterial,
  CircleGeometry,
  CylinderGeometry,
  OctahedronGeometry,
  RingGeometry,
  SphereGeometry,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  WebGLRenderer,
  type Object3D,
} from 'three';
import { AREA_VIEWS } from '../../core/state/area-camera';
import { followCamera } from '../../core/combat/space';
import type { FightSnapshot, FighterView } from '../../core/combat/fight';
import {
  buildAvatar,
  forgePresentation,
  forgeReady,
  generateRecipe,
  initForge,
  placeholderAvatar,
  aimForgeSun,
  type AvatarBody,
  type ForgeRaceMetrics,
} from '../characters/forge';
import { attackClipTime, chargeWeight, type ChargeLevel } from '../../core/combat/charge';
import type { DodgeKind, Gait } from '../../core/combat/motor';
import { attackClip, dodgeClip, stanceClip } from './clips';
import { motionPose, type MotionPose } from './motion';
import { createWeaponKit, type WeaponKit } from './weapons';

const VIEW = AREA_VIEWS[5] ?? {
  camPitch: 28,
  camDist: 9,
  camFov: 45,
  camLag: 0.16,
  n: '3rd-person far',
};
const LOOK_HEIGHT = 1.35;

interface ActorNodes {
  id: string;
  root: Group;
  pivot: Group;
  body: AvatarBody | null;
  kit: WeaponKit | null;
  kitId: string;
  rightAnchor: Group;
  leftAnchor: Group;
  marker: Mesh;
  hitbox: Mesh;
  lockRing: Mesh;
}

const RACES = ['human', 'orc', 'dwarf', 'goblin', 'tiefling'];

/**
 * The dojo arena on the area canvas. Bodies come from Character Forge.
 * Attack beats that the runtime does not ship are tweens from `motion.ts`.
 */
export class DojoView {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera: PerspectiveCamera;
  private readonly actors = new Map<string, ActorNodes>();
  private readonly arena: Group;
  private disposed = false;
  private bodiesReady = 0;
  private readonly clock = { t: 0 };

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.scene.background = new Color('#d9c7a4');
    this.scene.fog = new Fog('#d9c7a4', 14, 32);
    this.scene.add(new HemisphereLight(0xfff4e5, 0x6d8a55, 1.35));
    const sun = new DirectionalLight(0xfff1d6, 2.15);
    sun.position.set(6, 10, 5);
    const fill = new DirectionalLight(0xd5e2ff, 0.5);
    fill.position.set(-5, 4, -3);
    this.scene.add(sun, fill);
    this.arena = buildArena();
    this.scene.add(this.arena);
    this.camera = new PerspectiveCamera(VIEW.camFov, 1, 0.1, 80);
    this.renderer = new WebGLRenderer({ canvas, antialias: false, alpha: false });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.setPixelRatio(1);
    this.renderer.setClearColor('#d9c7a4');
    for (let index = 0; index < 5; index += 1) {
      const id = index === 0 ? 'player' : `enemy-${index - 1}`;
      const actor = createActor(id);
      this.actors.set(id, actor);
      this.scene.add(actor.root);
      this.setBody(actor, placeholderAvatar(index + 3));
    }
    this.dress('player', 'fists');
    for (const [id, actor] of this.actors) {
      if (id !== 'player') this.dressActor(actor, 'club');
    }
  }

  get readyCount(): number {
    return this.bodiesReady;
  }

  start(): void {
    void this.upgradeBodies();
  }

  sync(snapshot: FightSnapshot, showHitboxes: boolean, weaponId: string, dt: number): void {
    if (this.disposed) return;
    this.clock.t += dt;
    this.dress('player', weaponId);
    const live = new Set<string>([
      snapshot.player.id,
      ...snapshot.enemies.map((enemy) => enemy.id),
    ]);
    this.place(snapshot.player, showHitboxes, snapshot.hitStop > 0 ? 0 : dt);
    for (const enemy of snapshot.enemies)
      this.place(enemy, showHitboxes, snapshot.hitStop > 0 ? 0 : dt);
    for (const [id, actor] of this.actors) {
      if (!live.has(id)) actor.root.visible = false;
    }
  }

  render(yawDeg: number, focus: { x: number; z: number }): void {
    if (this.disposed) return;
    const width = Math.max(2, this.canvas.clientWidth);
    const height = Math.max(2, this.canvas.clientHeight);
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.renderer.setSize(width, height, false);
    }
    this.camera.aspect = width / height;
    this.camera.fov = VIEW.camFov;
    this.camera.updateProjectionMatrix();
    const placed = followCamera(
      { x: focus.x, y: 0, z: focus.z },
      yawDeg,
      VIEW.camPitch,
      VIEW.camDist,
      LOOK_HEIGHT,
    );
    this.camera.position.set(placed.x, placed.y, placed.z);
    this.camera.lookAt(focus.x, placed.lookY, focus.z);
    this.camera.updateMatrixWorld();
    aimForgeSun(this.camera);
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const actor of this.actors.values()) {
      actor.kit?.dispose();
      actor.body?.dispose();
      disposeMesh(actor.marker);
      disposeMesh(actor.hitbox);
      disposeMesh(actor.lockRing);
    }
    this.arena.traverse((node) => {
      const mesh = node as Mesh;
      if (mesh.isMesh) disposeMesh(mesh);
    });
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }

  private dress(id: string, styleId: string): void {
    const actor = this.actors.get(id);
    if (!actor || actor.kitId === styleId) return;
    this.dressActor(actor, styleId);
  }

  private dressActor(actor: ActorNodes, styleId: string): void {
    actor.kit?.dispose();
    actor.kit = createWeaponKit(styleId);
    actor.kitId = styleId;
    this.parentKit(actor);
  }

  private parentKit(actor: ActorNodes): void {
    const kit = actor.kit;
    if (!kit) return;
    const right = actor.body?.socket('hand_r') ?? actor.rightAnchor;
    const left = actor.body?.socket('hand_l') ?? actor.leftAnchor;
    right.add(kit.right);
    if (kit.left) left.add(kit.left);
  }

  private setBody(actor: ActorNodes, body: AvatarBody): void {
    if (actor.body && actor.body !== body) actor.body.dispose();
    actor.body = body;
    body.object3D.position.set(0, 0, 0);
    body.object3D.rotation.set(0, 0, 0);
    actor.pivot.add(body.object3D);
    const metrics = metricsOf(body.object3D);
    const scale = body.source === 'forge' ? forgePresentation(metrics, 0).scale : 1;
    body.object3D.scale.setScalar(scale);
    this.parentKit(actor);
  }

  private place(fighter: FighterView, showHitboxes: boolean, dt: number): void {
    const actor = this.actors.get(fighter.id);
    if (!actor) return;
    actor.root.visible = true;
    actor.root.position.set(fighter.x, 0, fighter.z);
    actor.root.rotation.y = fighter.yaw;
    const skeletal = fighter.id === 'player' && actor.body?.source === 'forge';
    const pose = skeletal ? REST_POSE : motionPose(fighter.motion, fighter.phase);
    actor.pivot.position.set(0, pose.hop, pose.lunge);
    actor.pivot.rotation.x = pose.lean;
    actor.kit?.apply(pose);
    // Ground idle, even for a winged body. Hover is the town and map stand.
    const moving =
      fighter.state === 'move' || fighter.gait === 'strafe' || fighter.gait === 'backpedal';
    const speed = fighter.speed;
    actor.body?.present({
      clip: moving ? 'Walk' : 'Idle',
      timeScale: locomotionRate(speed),
      fade: 0.12,
      blend: skeletal ? locomotionBlend(speed, fighter.gait) : undefined,
    });
    if (skeletal) actor.body?.layers(playerLayers(fighter));
    else actor.body?.layers([]);
    actor.body?.update(dt);
    const cue = fighter.telegraph;
    actor.marker.visible = cue !== 'none';
    const material = actor.marker.material as MeshLambertMaterial;
    if (cue === 'open') {
      material.color.set('#f7fbff');
      material.emissive.set('#d7f4ff');
      const pulse = 0.16 + Math.sin(this.clock.t * 22) * 0.05;
      actor.marker.scale.setScalar(pulse / 0.16);
    } else if (cue === 'strike') {
      material.color.set('#d4533a');
      material.emissive.set('#8a2a1c');
      actor.marker.scale.setScalar(1);
    } else {
      material.color.set('#e2a33a');
      material.emissive.set('#a86a16');
      actor.marker.scale.setScalar(0.85 + Math.sin(this.clock.t * 6) * 0.08);
    }
    const timing = fighter.timing;
    const active =
      !!timing &&
      timing.elapsed >= timing.startup &&
      timing.elapsed <= timing.startup + timing.active;
    actor.lockRing.visible = fighter.locked;
    if (fighter.locked) {
      const pulse = 1 + Math.sin(this.clock.t * 7) * 0.12;
      actor.lockRing.scale.setScalar(pulse);
    }
    actor.hitbox.visible = showHitboxes && (active || cue === 'open');
    if (actor.hitbox.visible) {
      const reach = timing ? 0.7 : 0.9;
      actor.hitbox.position.set(0, 0.9, reach);
      (actor.hitbox.material as MeshLambertMaterial).color.set(
        cue === 'open' ? '#7ee0ff' : '#ff5a4a',
      );
    }
  }

  private async upgradeBodies(): Promise<void> {
    const specs = [
      { id: 'player', seed: 7, race: 'human' },
      { id: 'enemy-0', seed: 21, race: 'orc' },
      { id: 'enemy-1', seed: 22, race: 'dwarf' },
      { id: 'enemy-2', seed: 23, race: 'goblin' },
      { id: 'enemy-3', seed: 24, race: 'tiefling' },
    ];
    for (const spec of specs) {
      if (this.disposed) return;
      const body = await loadBody(spec.seed, spec.race ?? 'human');
      if (this.disposed) {
        body.dispose();
        return;
      }
      const actor = this.actors.get(spec.id);
      if (!actor) {
        body.dispose();
        continue;
      }
      this.setBody(actor, body);
      this.bodiesReady += 1;
    }
  }
}

async function loadBody(seed: number, race: string): Promise<AvatarBody> {
  try {
    if (!forgeReady().ok) {
      const status = await initForge();
      if (!status.ok) return placeholderAvatar(seed);
    }
    const recipe = generateRecipe({
      seed,
      race: RACES.includes(race) ? race : 'human',
      gender: 'm',
      profileEntry: { richness: 0.45, races: { [race]: 1 } },
    });
    return await buildAvatar(recipe);
  } catch {
    return placeholderAvatar(seed);
  }
}

const REST_POSE: MotionPose = {
  lunge: 0,
  lean: 0,
  hop: 0,
  weaponPitch: 0,
  weaponYaw: 0,
  weaponRoll: 0,
  offPitch: 0,
};

function clamp01(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

function locomotionRate(speed: number): number {
  if (speed < 0.25) return 1;
  return clamp01(speed / 1.7, 0.65, 1.65);
}

function locomotionBlend(speed: number, gait: Gait): { idle: number; walk: number; run: number } {
  if (gait === 'idle' || gait === 'guard' || speed < 0.25) return { idle: 1, walk: 0, run: 0 };
  if (gait === 'sprint' || gait === 'run' || speed >= 3.05) {
    const run = clamp01((speed - 2.2) / 2.4, 0, 1);
    return { idle: 0, walk: 1 - run, run };
  }
  const walk = clamp01((speed - 0.25) / 2, 0, 1);
  return { idle: 1 - walk, walk, run: 0 };
}

function playerLayers(fighter: FighterView): {
  name: string;
  clip: ReturnType<typeof attackClip>;
  time: number;
  weight: number;
  paused: boolean;
}[] {
  if (
    fighter.archetype &&
    (fighter.state === 'attack' || fighter.state === 'counter') &&
    !fighter.windup
  ) {
    const charge = (fighter.attackCharge === 0 ? 1 : fighter.attackCharge) as ChargeLevel;
    const clip = attackClip(fighter.archetype);
    return [
      {
        name: `attack-${fighter.archetype}`,
        clip,
        time: attackClipTime(fighter.phase, fighter.strikePhase || 0.42, charge) * clip.duration,
        weight: chargeWeight(charge),
        paused: true,
      },
    ];
  }
  if (fighter.windup && fighter.archetype) {
    const clip = attackClip(fighter.archetype);
    return [
      {
        name: `windup-${fighter.archetype}`,
        clip,
        time: 0.22 * clip.duration,
        weight: 0.35 + fighter.windupPose * 0.6,
        paused: true,
      },
    ];
  }
  if (fighter.evade) {
    const clip = dodgeClip(fighter.evade as DodgeKind);
    return [
      {
        name: `dodge-${fighter.evade}`,
        clip,
        time: fighter.evadePhase * clip.duration,
        weight: 1,
        paused: true,
      },
    ];
  }
  const layers: {
    name: string;
    clip: ReturnType<typeof stanceClip>;
    time: number;
    weight: number;
    paused: boolean;
  }[] = [];
  if (fighter.stance === 'guard') {
    const clip = stanceClip('guard');
    layers.push({
      name: 'guard',
      clip,
      time: 0,
      weight: fighter.gait === 'guard' || fighter.gait === 'idle' ? 1 : 0.7,
      paused: false,
    });
  }
  const lean = leanFor(fighter.gait, fighter.strafeSide);
  if (lean) {
    const clip = stanceClip(lean.name);
    layers.push({
      name: lean.name,
      clip,
      time: lean.time * clip.duration,
      weight: lean.weight,
      paused: true,
    });
  }
  return layers;
}

function leanFor(
  gait: Gait,
  side: -1 | 0 | 1,
): {
  name: 'strafe-left' | 'strafe-right' | 'backpedal' | 'start' | 'stop' | 'skid' | 'sprint';
  time: number;
  weight: number;
} | null {
  if (gait === 'strafe') {
    return { name: side >= 0 ? 'strafe-right' : 'strafe-left', time: 0.5, weight: 0.85 };
  }
  if (gait === 'backpedal') return { name: 'backpedal', time: 0.5, weight: 0.85 };
  if (gait === 'start') return { name: 'start', time: 0.45, weight: 0.75 };
  if (gait === 'stop') return { name: 'stop', time: 0.4, weight: 0.8 };
  if (gait === 'skid') return { name: 'skid', time: 0.35, weight: 1 };
  if (gait === 'sprint') return { name: 'sprint', time: 0.5, weight: 0.85 };
  return null;
}

function metricsOf(object: Object3D): ForgeRaceMetrics | null {
  const raw = object.userData.cfMetrics;
  if (!raw || typeof raw !== 'object') return null;
  const metrics = raw as Partial<ForgeRaceMetrics>;
  if (
    typeof metrics.heightM !== 'number' ||
    typeof metrics.strideM !== 'number' ||
    typeof metrics.walkDuration !== 'number'
  ) {
    return null;
  }
  return metrics as ForgeRaceMetrics;
}

function createActor(id: string): ActorNodes {
  const root = new Group();
  root.name = `dojo-${id}`;
  const pivot = new Group();
  const rightAnchor = new Group();
  rightAnchor.position.set(0.32, 1.05, 0.18);
  const leftAnchor = new Group();
  leftAnchor.position.set(-0.32, 1.05, 0.18);
  pivot.add(rightAnchor, leftAnchor);
  const marker = new Mesh(
    new OctahedronGeometry(0.16, 0),
    new MeshLambertMaterial({ color: '#e2a33a', emissive: '#a86a16' }),
  );
  marker.position.y = 2.15;
  marker.visible = false;
  const hitbox = new Mesh(
    new SphereGeometry(0.28, 10, 8),
    new MeshLambertMaterial({ color: '#ff5a4a', transparent: true, opacity: 0.45 }),
  );
  hitbox.visible = false;
  const lockRing = new Mesh(
    new RingGeometry(0.42, 0.55, 28),
    new MeshLambertMaterial({ color: '#7ee0ff', emissive: '#146080' }),
  );
  lockRing.rotation.x = -Math.PI / 2;
  lockRing.position.y = 0.03;
  lockRing.visible = false;
  root.add(pivot, marker, hitbox, lockRing);
  return {
    id,
    root,
    pivot,
    body: null,
    kit: null,
    kitId: '',
    rightAnchor,
    leftAnchor,
    marker,
    hitbox,
    lockRing,
  };
}

function disposeMesh(mesh: Mesh): void {
  mesh.geometry?.dispose();
  const material = mesh.material as MeshLambertMaterial | MeshLambertMaterial[] | undefined;
  if (Array.isArray(material)) for (const entry of material) entry.dispose();
  else material?.dispose();
}

function buildArena(): Group {
  const arena = new Group();
  arena.name = 'dojo-arena';
  const floor = new Mesh(
    new CircleGeometry(8.2, 48),
    new MeshLambertMaterial({ color: '#c4a574' }),
  );
  floor.rotation.x = -Math.PI / 2;
  const mat = new Mesh(
    new RingGeometry(3.1, 3.28, 40),
    new MeshLambertMaterial({ color: '#8d5a32' }),
  );
  mat.rotation.x = -Math.PI / 2;
  mat.position.y = 0.01;
  const inner = new Mesh(
    new RingGeometry(1.15, 1.28, 32),
    new MeshLambertMaterial({ color: '#a98460' }),
  );
  inner.rotation.x = -Math.PI / 2;
  inner.position.y = 0.012;
  arena.add(floor, mat, inner);
  const wood = new MeshLambertMaterial({ color: '#6b4423' });
  const cloth = new MeshLambertMaterial({ color: '#8d3b2f' });
  for (const [x, z] of [
    [-6.2, -6.2],
    [6.2, -6.2],
    [-6.2, 6.2],
    [6.2, 6.2],
  ] as const) {
    const post = new Mesh(new CylinderGeometry(0.16, 0.18, 2.6, 8), wood);
    post.position.set(x, 1.3, z);
    const cap = new Mesh(new CylinderGeometry(0.28, 0.22, 0.12, 8), cloth);
    cap.position.set(x, 2.62, z);
    arena.add(post, cap);
  }
  return arena;
}
