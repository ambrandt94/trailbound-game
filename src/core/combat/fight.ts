import './weapons/fists';
import './weapons/axe';
import './weapons/hammer';
import './weapons/daggers';
import './weapons/sword-shield';
import { AttackBuffer, type AttackEdge } from './buffer';
import { createComboResolver } from './combo';
import { hitDamage } from './damage';
import { weaponById } from './registry';
import { LockGestureBuffer, applyLockTap, retargetLock, type LockFoe } from './lock';
import type { CombatHooks, FighterInput, MoveSpec, SpecialRequest } from './types';

export type { FighterInput } from './types';

export const PLAYER_MAX_HP = 100;
export const ENEMY_MAX_HP = 48;
export const ENEMY_STRIKE_DAMAGE = 9;
const TELEGRAPH_SEC = 0.7;
const ENEMY_RANGE = 1.6;
const ENEMY_ARC = 1.2;
const ENEMY_KNOCKBACK = 3.2;
const ENEMY_STAGGER = 0.45;
const ENEMY_HITSTOP = 0.06;
const WHIFF_SEC = 0.32;
const ARENA_RADIUS = 7.4;
const BODY_GAP = 0.72;

export const IDLE_INPUT: FighterInput = {
  moveX: 0,
  moveZ: 0,
  xDown: false,
  yDown: false,
  counterPressed: false,
  lockDown: false,
  forward: 0,
  strafe: 0,
};

export interface FightTuning {
  weaponId: string;
  enemyCount: number;
  aggression: number;
  /** Attacks per second once an enemy is in range. 0 never swings on its own. */
  attackRate: number;
  counterWindowMs: number;
  holdThresholdMs: number;
  bufferMs: number;
  /** Gap that drops the combo string, milliseconds. */
  linkMs: number;
  respawnSec: number;
  playerRespawnSec: number;
  /** Hold length that clears a lock. A shorter press is a tap. */
  lockHoldMs: number;
  /** Radians per second the body turns toward a lock. */
  lockTurnRate: number;
  script: readonly { at: number; enemy?: number }[] | null;
}

export type ActorState =
  'idle' | 'move' | 'attack' | 'counter' | 'stagger' | 'whiff' | 'down' | 'recover';

export type TelegraphPhase = 'none' | 'windup' | 'open' | 'strike';

export interface MoveTiming {
  elapsed: number;
  startup: number;
  active: number;
  recovery: number;
}

export interface FighterView {
  id: string;
  hp: number;
  maxHp: number;
  x: number;
  z: number;
  yaw: number;
  state: ActorState;
  moveId: string | null;
  motion: string;
  phase: number;
  staggered: boolean;
  /** This body is the player's lock target. */
  locked: boolean;
  telegraph: TelegraphPhase;
  timing: MoveTiming | null;
}

export interface CombatEvent {
  type: 'hit' | 'counter' | 'whiff' | 'down' | 'special';
  source: string;
  target: string;
  moveId: string;
  damage: number;
  at: number;
}

export interface FightSnapshot {
  time: number;
  paused: boolean;
  hitStop: number;
  weaponId: string;
  /** Living foe the player is locked to, or null. */
  lockId: string | null;
  player: FighterView;
  enemies: FighterView[];
  events: CombatEvent[];
}

export interface Fight {
  step(dt: number, input: FighterInput): FightSnapshot;
  snapshot(): FightSnapshot;
  teleport(id: string, x: number, z: number): void;
  setTuning(partial: Partial<FightTuning>): void;
  resume(): void;
}

interface Actor {
  id: string;
  team: 'player' | 'enemy';
  hp: number;
  maxHp: number;
  x: number;
  z: number;
  yaw: number;
  spawnX: number;
  spawnZ: number;
  kbx: number;
  kbz: number;
  moving: boolean;
  move: MoveSpec | null;
  moveStart: number;
  hitsDone: number;
  lungeApplied: number;
  suppressHits: boolean;
  specialSent: boolean;
  staggerUntil: number;
  whiffUntil: number;
  recoverUntil: number;
  downAt: number;
  telegraphStart: number;
  windowOpenAt: number;
  strikeAt: number;
  strikeFlashUntil: number;
  countered: boolean;
  struck: boolean;
  attackCooldown: number;
}

interface ScriptItem {
  at: number;
  enemy: number;
  done: boolean;
}

const DEFAULT_HOOKS: CombatHooks = { onSpecial: () => 'continue' };

export function createFight(
  partial: Partial<FightTuning> = {},
  hooks: CombatHooks = DEFAULT_HOOKS,
): Fight {
  const tuning = defaults(partial);
  let style = weaponById(tuning.weaponId);
  let resolver = createComboResolver(style);
  const buffer = new AttackBuffer({
    holdThresholdMs: tuning.holdThresholdMs,
    windowMs: tuning.bufferMs,
  });
  let queue: AttackEdge[] = [];
  let lastAccept = -10;
  let now = 0;
  let hitStop = 0;
  let paused = false;
  let events: CombatEvent[] = [];
  const rng = mulberry32(1);
  let script: ScriptItem[] = copyScript(tuning.script);
  const player = makeActor('player', 'player', 0, 0.35, Math.PI, PLAYER_MAX_HP);
  let enemies = spawnEnemies(tuning.enemyCount);
  const lockBuffer = new LockGestureBuffer(tuning.lockHoldMs);
  let lockId: string | null = null;

  function defaults(patch: Partial<FightTuning>): FightTuning {
    const weaponId = patch.weaponId ?? 'fists';
    const weapon = weaponById(weaponId);
    return {
      weaponId,
      enemyCount: clampCount(patch.enemyCount ?? 1),
      aggression: clamp01(patch.aggression ?? 0.65),
      attackRate: Math.max(0, patch.attackRate ?? 0.55),
      counterWindowMs: patch.counterWindowMs ?? weapon.counterWindowMs,
      holdThresholdMs: patch.holdThresholdMs ?? 300,
      bufferMs: patch.bufferMs ?? 450,
      linkMs: patch.linkMs ?? 750,
      respawnSec: patch.respawnSec ?? 2.2,
      playerRespawnSec: patch.playerRespawnSec ?? 1.4,
      lockHoldMs: patch.lockHoldMs ?? 250,
      lockTurnRate: patch.lockTurnRate ?? 6,
      script: patch.script === undefined ? null : patch.script,
    };
  }

  function find(id: string): Actor | undefined {
    if (player.id === id) return player;
    return enemies.find((enemy) => enemy.id === id);
  }

  function counterMove(): MoveSpec {
    const found = style.moves.find((item) => item.id === style.counterMoveId);
    if (!found) throw new Error(`missing counter move ${style.counterMoveId}`);
    return found;
  }

  function log(event: CombatEvent): void {
    events = [...events, event].slice(-32);
  }

  function offer(request: SpecialRequest): void {
    log({
      type: 'special',
      source: player.id,
      target: request.moveId,
      moveId: request.moveId,
      damage: 0,
      at: now,
    });
    if (hooks.onSpecial(request) === 'minigame') paused = true;
  }

  function hurt(
    target: Actor,
    source: Actor,
    damage: number,
    moveId: string,
    knockback: number,
    stagger: number,
    stop: number,
    kind: 'hit' | 'counter',
  ): void {
    if (target.hp <= 0 || damage <= 0) return;
    target.hp = Math.max(0, target.hp - damage);
    const impulse = push(source, target, knockback);
    target.kbx = impulse.x;
    target.kbz = impulse.z;
    if (stagger > 0) target.staggerUntil = now + stagger;
    hitStop = Math.max(hitStop, stop);
    log({ type: kind, source: source.id, target: target.id, moveId, damage, at: now });
    if (target.hp <= 0) {
      target.downAt = now;
      target.move = null;
      target.telegraphStart = -1;
      log({ type: 'down', source: source.id, target: target.id, moveId, damage: 0, at: now });
    }
  }

  function inSwing(actor: Actor, origin: Actor, spec: MoveSpec): boolean {
    const dx = actor.x - origin.x;
    const dz = actor.z - origin.z;
    const dist = Math.hypot(dx, dz);
    if (spec.aoe) return dist <= spec.aoeRadius;
    if (dist > spec.range) return false;
    const facing = Math.atan2(dx, dz);
    return Math.abs(wrap(facing - origin.yaw)) <= spec.arc;
  }

  function applySwing(actor: Actor, spec: MoveSpec): void {
    const targets = actor.team === 'player' ? enemies : [player];
    for (const target of targets) {
      if (target.hp <= 0) continue;
      if (!inSwing(target, actor, spec)) continue;
      const damage = actor.team === 'player' ? hitDamage(style, spec) : spec.damage;
      hurt(target, actor, damage, spec.id, spec.knockback, spec.stagger, spec.hitStop, 'hit');
      if (spec.special && !actor.specialSent && actor.team === 'player') {
        actor.specialSent = true;
        const ctx = {
          weaponId: style.id,
          moveId: spec.id,
          attackerId: actor.id,
          targetId: target.id,
        };
        const request = style.behavior?.onSpecial?.(ctx) ?? {
          kind: 'special' as const,
          weaponId: style.id,
          moveId: spec.id,
          minigameId: null,
        };
        if (request) offer(request);
      }
    }
  }

  function hitMoment(spec: MoveSpec, index: number): number {
    const count = Math.max(1, spec.hits);
    const span = Math.max(spec.active, 0.001);
    return spec.startup + (span * (index + 0.5)) / count;
  }

  function advanceMove(actor: Actor): void {
    const spec = actor.move;
    if (!spec) return;
    const elapsed = now - actor.moveStart;
    if (!actor.suppressHits) {
      while (actor.hitsDone < spec.hits && elapsed >= hitMoment(spec, actor.hitsDone)) {
        applySwing(actor, spec);
        actor.hitsDone += 1;
      }
    }
    const duration = spec.startup + spec.active + spec.recovery;
    if (elapsed >= duration) {
      actor.move = null;
      actor.lungeApplied = 0;
      actor.suppressHits = false;
    }
  }

  function canAccept(): boolean {
    if (player.hp <= 0) return false;
    if (now < player.staggerUntil || now < player.whiffUntil) return false;
    const spec = player.move;
    if (!spec) return true;
    return now - player.moveStart >= spec.startup + spec.active;
  }

  function faceNearest(): void {
    let best: Actor | null = null;
    let bestDist = 4;
    for (const enemy of enemies) {
      if (enemy.hp <= 0) continue;
      const dist = Math.hypot(enemy.x - player.x, enemy.z - player.z);
      if (dist < bestDist) {
        best = enemy;
        bestDist = dist;
      }
    }
    if (!best) return;
    player.yaw = Math.atan2(best.x - player.x, best.z - player.z);
  }

  function startMove(spec: MoveSpec, suppress: boolean): void {
    if (!lockId) faceNearest();
    player.move = spec;
    player.moveStart = now;
    player.hitsDone = 0;
    player.lungeApplied = 0;
    player.suppressHits = suppress;
    player.specialSent = false;
    player.whiffUntil = 0;
    player.moving = false;
  }

  function openTarget(): Actor | null {
    const spec = counterMove();
    if (lockId) {
      const locked = enemies.find((enemy) => enemy.id === lockId && enemy.hp > 0);
      if (!locked || locked.telegraphStart < 0 || locked.countered || locked.struck) return null;
      if (now < locked.windowOpenAt || now >= locked.strikeAt) return null;
      const dist = Math.hypot(locked.x - player.x, locked.z - player.z);
      return dist <= spec.range ? locked : null;
    }
    let best: Actor | null = null;
    let bestDist = spec.range;
    for (const enemy of enemies) {
      if (enemy.hp <= 0 || enemy.telegraphStart < 0 || enemy.countered || enemy.struck) continue;
      if (now < enemy.windowOpenAt || now >= enemy.strikeAt) continue;
      const dist = Math.hypot(enemy.x - player.x, enemy.z - player.z);
      if (dist <= bestDist) {
        best = enemy;
        bestDist = dist;
      }
    }
    return best;
  }

  function performCounter(enemy: Actor): void {
    const spec = counterMove();
    enemy.countered = true;
    enemy.telegraphStart = -1;
    enemy.struck = true;
    if (!lockId) player.yaw = Math.atan2(enemy.x - player.x, enemy.z - player.z);
    startMove(spec, true);
    hurt(
      enemy,
      player,
      hitDamage(style, spec),
      spec.id,
      spec.knockback,
      spec.stagger,
      spec.hitStop,
      'counter',
    );
    queue = [];
    resolver.reset();
    lastAccept = now;
    const ctx = {
      weaponId: style.id,
      moveId: spec.id,
      attackerId: player.id,
      targetId: enemy.id,
    };
    const request = style.behavior?.onCounter?.(ctx) ?? {
      kind: 'counter' as const,
      weaponId: style.id,
      moveId: spec.id,
      minigameId: null,
    };
    if (request) offer(request);
  }

  function beginTelegraph(enemy: Actor, at: number): void {
    const windowSec = Math.min(TELEGRAPH_SEC, Math.max(0.04, tuning.counterWindowMs / 1000));
    enemy.telegraphStart = at;
    enemy.strikeAt = at + TELEGRAPH_SEC;
    enemy.windowOpenAt = enemy.strikeAt - windowSec;
    enemy.countered = false;
    enemy.struck = false;
    enemy.strikeFlashUntil = 0;
  }

  function resolveStrike(enemy: Actor): void {
    enemy.struck = true;
    enemy.recoverUntil = now + 0.4;
    enemy.strikeFlashUntil = now + 0.14;
    const dx = player.x - enemy.x;
    const dz = player.z - enemy.z;
    const dist = Math.hypot(dx, dz);
    enemy.yaw = Math.atan2(dx, dz);
    if (player.hp <= 0 || dist > ENEMY_RANGE) return;
    if (Math.abs(wrap(Math.atan2(dx, dz) - enemy.yaw)) > ENEMY_ARC) return;
    hurt(
      player,
      enemy,
      ENEMY_STRIKE_DAMAGE,
      'enemy-strike',
      ENEMY_KNOCKBACK,
      ENEMY_STAGGER,
      ENEMY_HITSTOP,
      'hit',
    );
  }

  function runScript(): void {
    for (const item of script) {
      if (item.done || now < item.at) continue;
      const enemy = enemies[item.enemy];
      if (enemy && enemy.hp > 0 && enemy.telegraphStart < 0) beginTelegraph(enemy, item.at);
      item.done = true;
    }
  }

  function runAi(dt: number): void {
    if (tuning.script) return;
    for (const enemy of enemies) {
      if (enemy.hp <= 0 || enemy.telegraphStart >= 0) continue;
      if (now < enemy.staggerUntil || now < enemy.recoverUntil) continue;
      if (tuning.attackRate <= 0) continue;
      enemy.attackCooldown -= dt;
      if (enemy.attackCooldown > 0) continue;
      const dist = Math.hypot(player.x - enemy.x, player.z - enemy.z);
      if (dist > ENEMY_RANGE + 0.15) continue;
      if (rng() <= tuning.aggression) {
        beginTelegraph(enemy, now);
        enemy.attackCooldown = 1 / tuning.attackRate;
      } else {
        enemy.attackCooldown = 0.35;
      }
    }
  }

  function approach(dt: number): void {
    for (const enemy of enemies) {
      if (enemy.hp <= 0 || enemy.telegraphStart >= 0) continue;
      if (now < enemy.staggerUntil) continue;
      const dx = player.x - enemy.x;
      const dz = player.z - enemy.z;
      const dist = Math.hypot(dx, dz) || 1;
      enemy.yaw = Math.atan2(dx, dz);
      if (dist > 1.2 && now >= enemy.recoverUntil) {
        const step = Math.min(2.15 * dt, dist - 1.12);
        enemy.x += (dx / dist) * step;
        enemy.z += (dz / dist) * step;
        enemy.moving = true;
      } else {
        enemy.moving = false;
      }
    }
  }

  function livingFoes(): LockFoe[] {
    return enemies
      .filter((enemy) => enemy.hp > 0)
      .map((enemy) => ({ id: enemy.id, x: enemy.x, z: enemy.z }));
  }

  function refreshLock(): void {
    lockId = retargetLock(lockId, player, livingFoes());
  }

  function readLock(input: FighterInput): void {
    const gesture = lockBuffer.update(now * 1000, input.lockDown);
    if (gesture === 'hold') {
      lockId = null;
      return;
    }
    lockId = retargetLock(lockId, player, livingFoes());
    if (gesture === 'tap') lockId = applyLockTap(lockId, player, livingFoes());
  }

  function faceLock(dt: number): void {
    if (!lockId) return;
    const target = enemies.find((enemy) => enemy.id === lockId && enemy.hp > 0);
    if (!target) return;
    const want = Math.atan2(target.x - player.x, target.z - player.z);
    const delta = wrap(want - player.yaw);
    const max = Math.max(0, tuning.lockTurnRate) * dt;
    if (Math.abs(delta) <= max) player.yaw = want;
    else player.yaw += Math.sign(delta) * max;
  }

  function movePlayer(dt: number, input: FighterInput): void {
    const rooted =
      player.hp <= 0 ||
      player.move !== null ||
      now < player.staggerUntil ||
      now < player.whiffUntil;
    if (rooted) {
      player.moving = false;
      return;
    }
    if (lockId) {
      const target = enemies.find((enemy) => enemy.id === lockId && enemy.hp > 0);
      const mag = Math.hypot(input.strafe, input.forward);
      if (!target || mag < 0.08) {
        player.moving = false;
        return;
      }
      const dist = Math.hypot(target.x - player.x, target.z - player.z) || 1;
      const fx = (target.x - player.x) / dist;
      const fz = (target.z - player.z) / dist;
      const rx = fz;
      const rz = -fx;
      const sx = input.strafe / mag;
      const sz = input.forward / mag;
      player.x += (fx * sz + rx * sx) * style.moveSpeed * dt;
      player.z += (fz * sz + rz * sx) * style.moveSpeed * dt;
      player.moving = true;
      return;
    }
    const mag = Math.hypot(input.moveX, input.moveZ);
    if (mag < 0.08) {
      player.moving = false;
      return;
    }
    const nx = input.moveX / mag;
    const nz = input.moveZ / mag;
    player.x += nx * style.moveSpeed * dt;
    player.z += nz * style.moveSpeed * dt;
    player.yaw = Math.atan2(nx, nz);
    player.moving = true;
  }

  function slide(actor: Actor, dt: number): void {
    actor.x += actor.kbx * dt;
    actor.z += actor.kbz * dt;
    const damp = Math.exp(-8 * dt);
    actor.kbx *= damp;
    actor.kbz *= damp;
  }

  function lunge(actor: Actor): void {
    const spec = actor.move;
    if (!spec) return;
    const elapsed = now - actor.moveStart;
    const start = spec.startup;
    const end = spec.startup + spec.active;
    let along = 0;
    if (elapsed >= end) along = 1;
    else if (elapsed > start) along = (elapsed - start) / (spec.active || 1);
    const want = spec.lunge * along;
    const delta = want - actor.lungeApplied;
    actor.x += Math.sin(actor.yaw) * delta;
    actor.z += Math.cos(actor.yaw) * delta;
    actor.lungeApplied = want;
  }

  function separate(): void {
    const bodies = [player, ...enemies];
    for (let i = 0; i < bodies.length; i += 1) {
      for (let j = i + 1; j < bodies.length; j += 1) {
        const a = bodies[i];
        const b = bodies[j];
        if (!a || !b || a.hp <= 0 || b.hp <= 0) continue;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const dist = Math.hypot(dx, dz);
        if (dist >= BODY_GAP || dist < 1e-4) continue;
        const pushOut = (BODY_GAP - dist) / 2;
        const nx = dx / dist;
        const nz = dz / dist;
        a.x -= nx * pushOut;
        a.z -= nz * pushOut;
        b.x += nx * pushOut;
        b.z += nz * pushOut;
      }
    }
  }

  function contain(actor: Actor): void {
    const dist = Math.hypot(actor.x, actor.z);
    if (dist <= ARENA_RADIUS) return;
    actor.x = (actor.x / dist) * ARENA_RADIUS;
    actor.z = (actor.z / dist) * ARENA_RADIUS;
  }

  function revive(actor: Actor, delay: number): void {
    if (actor.hp > 0 || actor.downAt < 0 || now - actor.downAt < delay) return;
    actor.hp = actor.maxHp;
    actor.x = actor.spawnX;
    actor.z = actor.spawnZ;
    actor.kbx = 0;
    actor.kbz = 0;
    actor.move = null;
    actor.staggerUntil = 0;
    actor.whiffUntil = 0;
    actor.recoverUntil = 0;
    actor.telegraphStart = -1;
    actor.downAt = -1;
    actor.struck = false;
    actor.countered = false;
    actor.moving = false;
  }

  function view(actor: Actor): FighterView {
    const staggered = actor.hp > 0 && now < actor.staggerUntil;
    let state: ActorState = 'idle';
    if (actor.hp <= 0) state = 'down';
    else if (staggered) state = 'stagger';
    else if (actor.move && actor.suppressHits) state = 'counter';
    else if (actor.move) state = 'attack';
    else if (now < actor.whiffUntil) state = 'whiff';
    else if (actor.team === 'enemy' && now < actor.recoverUntil && actor.struck) state = 'recover';
    else if (actor.moving) state = 'move';
    let telegraph: TelegraphPhase = 'none';
    if (actor.telegraphStart >= 0) {
      if (now < actor.windowOpenAt) telegraph = 'windup';
      else if (now < actor.strikeAt) telegraph = 'open';
      else telegraph = 'strike';
    } else if (now < actor.strikeFlashUntil) telegraph = 'strike';
    const spec = actor.move;
    const elapsed = spec ? Math.max(0, now - actor.moveStart) : 0;
    const duration = spec ? spec.startup + spec.active + spec.recovery : 1;
    let motion = '';
    let phase = 0;
    if (spec) {
      motion = spec.motion;
      phase = Math.min(1, elapsed / duration);
    } else if (state === 'stagger') {
      motion = 'stagger';
      phase = 1;
    } else if (state === 'down') {
      motion = 'down';
      phase = 1;
    } else if (state === 'whiff') {
      motion = 'whiff';
      phase = 1;
    } else if (telegraph === 'windup' || telegraph === 'open') {
      motion = 'enemy-strike';
      const span = Math.max(0.001, actor.strikeAt - actor.telegraphStart);
      phase = Math.min(1, (now - actor.telegraphStart) / span);
    }
    return {
      id: actor.id,
      hp: actor.hp,
      maxHp: actor.maxHp,
      x: actor.x,
      z: actor.z,
      yaw: actor.yaw,
      state,
      moveId: spec?.id ?? null,
      motion,
      phase,
      staggered,
      locked: actor.id === lockId,
      telegraph,
      timing: spec
        ? { elapsed, startup: spec.startup, active: spec.active, recovery: spec.recovery }
        : null,
    };
  }

  function snapshot(): FightSnapshot {
    return {
      time: now,
      paused,
      hitStop,
      weaponId: style.id,
      lockId,
      player: view(player),
      enemies: enemies.map(view),
      events: events.slice(),
    };
  }

  return {
    step(dt: number, input: FighterInput): FightSnapshot {
      if (paused) return snapshot();
      const stepDt = Math.max(0, dt);
      if (hitStop > 0) {
        hitStop = Math.max(0, hitStop - stepDt);
        buffer.update(now * 1000, { x: input.xDown, y: input.yDown });
        readLock(input);
        return snapshot();
      }
      now += stepDt;
      readLock(input);
      const edges = buffer.update(now * 1000, { x: input.xDown, y: input.yDown });
      queue.push(...edges);
      const nowMs = now * 1000;
      queue = queue.filter((edge) => nowMs - edge.atMs <= tuning.bufferMs);

      if (input.counterPressed && player.hp > 0 && now >= player.staggerUntil) {
        const target = openTarget();
        if (target) performCounter(target);
        else if (!player.move && now >= player.whiffUntil) {
          player.whiffUntil = now + WHIFF_SEC;
          log({
            type: 'whiff',
            source: player.id,
            target: '',
            moveId: 'counter',
            damage: 0,
            at: now,
          });
        }
      }

      advanceMove(player);
      if (hitStop > 0) {
        refreshLock();
        return snapshot();
      }

      if (queue.length > 0 && canAccept()) {
        const edge = queue.shift();
        if (edge) {
          if ((now - lastAccept) * 1000 > tuning.linkMs) resolver.reset();
          const resolved = resolver.push(edge);
          const next = style.moves.find((item) => item.id === resolved.moveId);
          if (next) {
            startMove(next, false);
            lastAccept = now;
          }
        }
      }

      runScript();
      for (const enemy of enemies) {
        if (enemy.telegraphStart < 0 || now < enemy.strikeAt || enemy.countered || enemy.struck)
          continue;
        resolveStrike(enemy);
        enemy.telegraphStart = -1;
      }
      if (hitStop > 0) {
        refreshLock();
        return snapshot();
      }
      runAi(stepDt);
      movePlayer(stepDt, input);
      faceLock(stepDt);
      approach(stepDt);
      lunge(player);
      slide(player, stepDt);
      for (const enemy of enemies) slide(enemy, stepDt);
      separate();
      contain(player);
      for (const enemy of enemies) contain(enemy);
      revive(player, tuning.playerRespawnSec);
      for (const enemy of enemies) revive(enemy, tuning.respawnSec);
      refreshLock();
      return snapshot();
    },
    snapshot,
    teleport(id: string, x: number, z: number): void {
      const actor = find(id);
      if (!actor) return;
      actor.x = x;
      actor.z = z;
      actor.spawnX = x;
      actor.spawnZ = z;
      actor.kbx = 0;
      actor.kbz = 0;
    },
    setTuning(patch: Partial<FightTuning>): void {
      const next = { ...tuning, ...patch };
      if (patch.enemyCount !== undefined) next.enemyCount = clampCount(patch.enemyCount);
      if (patch.aggression !== undefined) next.aggression = clamp01(patch.aggression);
      if (patch.attackRate !== undefined) next.attackRate = Math.max(0, patch.attackRate);
      if (patch.weaponId && patch.weaponId !== tuning.weaponId) {
        style = weaponById(patch.weaponId);
        resolver = createComboResolver(style);
        player.move = null;
        queue = [];
        buffer.clear();
        if (patch.counterWindowMs === undefined) next.counterWindowMs = style.counterWindowMs;
      }
      if (patch.holdThresholdMs !== undefined) buffer.setThreshold(patch.holdThresholdMs);
      if (patch.lockHoldMs !== undefined) lockBuffer.setThreshold(patch.lockHoldMs);
      if (patch.script !== undefined) script = copyScript(patch.script);
      Object.assign(tuning, next);
      const windowSec = Math.min(TELEGRAPH_SEC, Math.max(0.04, tuning.counterWindowMs / 1000));
      for (const enemy of enemies) {
        if (enemy.telegraphStart >= 0) enemy.windowOpenAt = enemy.strikeAt - windowSec;
      }
      while (enemies.length < tuning.enemyCount) {
        enemies.push(makeEnemy(enemies.length, tuning.enemyCount));
      }
      if (enemies.length > tuning.enemyCount) enemies = enemies.slice(0, tuning.enemyCount);
      refreshLock();
    },
    resume(): void {
      paused = false;
    },
  };
}

function clampCount(count: number): number {
  return Math.max(1, Math.min(4, Math.round(count)));
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function wrap(angle: number): number {
  let next = angle;
  while (next > Math.PI) next -= Math.PI * 2;
  while (next < -Math.PI) next += Math.PI * 2;
  return next;
}

function push(from: Actor, to: Actor, amount: number): { x: number; z: number } {
  let dx = to.x - from.x;
  let dz = to.z - from.z;
  const mag = Math.hypot(dx, dz);
  if (mag < 1e-4) {
    dx = Math.sin(from.yaw);
    dz = Math.cos(from.yaw);
  } else {
    dx /= mag;
    dz /= mag;
  }
  return { x: dx * amount, z: dz * amount };
}

function makeActor(
  id: string,
  team: 'player' | 'enemy',
  x: number,
  z: number,
  yaw: number,
  maxHp: number,
): Actor {
  return {
    id,
    team,
    hp: maxHp,
    maxHp,
    x,
    z,
    yaw,
    spawnX: x,
    spawnZ: z,
    kbx: 0,
    kbz: 0,
    moving: false,
    move: null,
    moveStart: 0,
    hitsDone: 0,
    lungeApplied: 0,
    suppressHits: false,
    specialSent: false,
    staggerUntil: 0,
    whiffUntil: 0,
    recoverUntil: 0,
    downAt: -1,
    telegraphStart: -1,
    windowOpenAt: 0,
    strikeAt: 0,
    strikeFlashUntil: 0,
    countered: false,
    struck: false,
    attackCooldown: 0.4,
  };
}

function makeEnemy(index: number, count: number): Actor {
  const spread = count <= 1 ? 0 : (index - (count - 1) / 2) * 1.15;
  const actor = makeActor(`enemy-${index}`, 'enemy', spread, -2.45, 0, ENEMY_MAX_HP);
  actor.yaw = Math.atan2(-actor.x, 0.35 - actor.z);
  return actor;
}

function spawnEnemies(count: number): Actor[] {
  const enemies: Actor[] = [];
  for (let index = 0; index < count; index += 1) enemies.push(makeEnemy(index, count));
  return enemies;
}

function copyScript(script: FightTuning['script']): ScriptItem[] {
  if (!script) return [];
  return script.map((item) => ({ at: item.at, enemy: item.enemy ?? 0, done: false }));
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
