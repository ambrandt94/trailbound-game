import { DEFAULT_MOTOR } from '../../core/combat/motor';
import type { PostureTuning } from '../../core/combat/posture';
import { cameraWish } from '../../core/combat/space';
import { createFight, type Fight } from '../../core/combat/fight';
import { DojoInput, stickToInput } from '../../input/dojo-input';
import { DojoView } from '../../render/dojo/dojo-view';
import {
  dojoAggression,
  dojoAttackRate,
  dojoCounterMs,
  dojoEnemies,
  dojoHitboxes,
  dojoHoldMs,
  dojoLockHoldMs,
  dojoAccel,
  dojoBrake,
  dojoTurn,
  dojoSprint,
  dojoLockedSpeed,
  dojoLockedAccel,
  dojoDodgeDistance,
  dojoDodgeTime,
  dojoDodgeCooldown,
  dojoIFrames,
  dojoSprintLean,
  dojoSkidLean,
  dojoSkidCrouch,
  dojoSkidDuration,
  dojoBankMax,
  dojoHeadStab,
  dojoHud,
  dojoNotice,
  dojoTimeScale,
  dojoWeapon,
} from '../../ui/dojo-state';
import { bootError, settingsOpen } from '../../ui/state';
import { loadRoad } from '../load-road';
import type { GameHost } from '../host';
import type { Scene } from '../scene-stack';
import { TitleScene } from './title';

function motorTuning() {
  return {
    ...DEFAULT_MOTOR,
    accel: dojoAccel.value,
    brake: dojoBrake.value,
    turnRate: dojoTurn.value,
    sprintMul: dojoSprint.value,
    lockedSpeed: dojoLockedSpeed.value,
    lockedAccel: dojoLockedAccel.value,
    evadeDistance: dojoDodgeDistance.value,
    evadeDuration: dojoDodgeTime.value,
    evadeCooldown: dojoDodgeCooldown.value,
    evadeIFrames: dojoIFrames.value,
  };
}

function postureTuning(): PostureTuning {
  return {
    maxSprintLean: dojoSprintLean.value,
    skidLean: dojoSkidLean.value,
    skidCrouch: dojoSkidCrouch.value,
    skidDuration: dojoSkidDuration.value,
    bankMax: dojoBankMax.value,
    headStabilization: dojoHeadStab.value,
  };
}

/**
 * Combat test room. It never writes a save, never travels, and never enters a town.
 * Leaving for the title loads the road only if boot skipped it.
 */
export class DojoScene implements Scene {
  readonly id = 'dojo';
  private view: DojoView | null = null;
  private input: DojoInput | null = null;
  private fight: Fight | null = null;
  private yaw = 0;
  private leaving = false;
  private focus = { x: 0, z: 0 };

  constructor(private readonly host: GameHost) {}

  enter(): void {
    this.host.setMode('dojo');
    this.host.setView('area');
    settingsOpen.value = false;
    this.host.keyboard.clearPresses();
    this.view = new DojoView(this.host.areaCanvas);
    this.view.start();
    this.input = new DojoInput(this.host.keyboard);
    this.input.attach(this.host.areaCanvas);
    this.fight = createFight(
      {
        weaponId: dojoWeapon.value,
        enemyCount: dojoEnemies.value,
        aggression: dojoAggression.value,
        attackRate: dojoAttackRate.value,
        counterWindowMs: dojoCounterMs.value,
        holdThresholdMs: dojoHoldMs.value,
        lockHoldMs: dojoLockHoldMs.value,
        motor: motorTuning(),
      },
      {
        onSpecial: (request) => {
          dojoNotice.value = request.minigameId
            ? `${request.kind}: ${request.moveId} -> ${request.minigameId}`
            : `${request.kind}: ${request.moveId} (minigame hook, none yet)`;
          return 'continue';
        },
      },
    );
  }

  update(dt: number): void {
    if (!this.fight || !this.view || !this.input || this.leaving) return;
    if (this.host.keyboard.consumePress('Escape')) {
      void this.leave();
      return;
    }
    const turn =
      (this.host.keyboard.isDown('KeyE') ? 1 : 0) - (this.host.keyboard.isDown('KeyQ') ? 1 : 0);
    this.yaw = (this.yaw + turn * 75 * dt + 360) % 360;
    const scale = Math.max(0, dojoTimeScale.value);
    this.fight.setTuning({
      weaponId: dojoWeapon.value,
      enemyCount: dojoEnemies.value,
      aggression: dojoAggression.value,
      attackRate: dojoAttackRate.value,
      counterWindowMs: dojoCounterMs.value,
      holdThresholdMs: dojoHoldMs.value,
      lockHoldMs: dojoLockHoldMs.value,
      motor: motorTuning(),
    });
    const stick = this.input.sample();
    // Yaw only changes when Q or E orbit. Locked framing moves the look point
    // to the midpoint and does not rotate, so a held stick keeps one direction.
    const wish = cameraWish(stick.ix, stick.iz, this.yaw);
    const snap = this.fight.step(dt * scale, stickToInput(stick, wish));
    this.view.setPosture(postureTuning());
    this.view.sync(snap, dojoHitboxes.value, dojoWeapon.value, dt * scale);
    dojoHud.value = {
      playerHp: snap.player.hp,
      playerMax: snap.player.maxHp,
      enemies: snap.enemies.map((enemy) => ({
        id: enemy.id,
        hp: enemy.hp,
        max: enemy.maxHp,
        telegraph: enemy.telegraph,
      })),
      move: snap.player.moveId,
      ready: this.view.readyCount,
      lockId: snap.lockId,
      gait: snap.player.gait,
      charge:
        snap.player.attackCharge ||
        (snap.player.windup ? Math.ceil(snap.player.windupPose * 2) : 0),
      evade: snap.player.evade,
    };
    const locked = snap.enemies.find((enemy) => enemy.id === snap.lockId);
    this.focus = locked
      ? { x: (snap.player.x + locked.x) / 2, z: (snap.player.z + locked.z) / 2 }
      : { x: snap.player.x, z: snap.player.z };
  }

  render(_alpha: number): void {
    this.view?.render(this.yaw, this.focus);
  }

  exit(): void {
    this.input?.detach();
    this.input = null;
    this.view?.dispose();
    this.view = null;
    this.fight = null;
    dojoHud.value = null;
    this.host.setView('map');
  }

  async leave(): Promise<void> {
    if (this.leaving) return;
    this.leaving = true;
    try {
      if (!this.host.place) await loadRoad(this.host);
      await this.host.stack.replace(new TitleScene(this.host));
    } catch (error) {
      this.leaving = false;
      bootError.value = error instanceof Error ? error.message : 'Failed to leave the dojo';
      this.host.setMode('dojo');
    }
  }
}
