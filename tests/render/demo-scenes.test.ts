import { expect, test } from 'vitest';
import { PerspectiveCamera, Scene } from 'three';
import { createParty } from '../../src/core/sim/party';
import { arenaGame } from '../../src/minigames/games/arena';
import { caveGame } from '../../src/minigames/games/cave';
import { chopGame } from '../../src/minigames/games/chop';
import { fishGame } from '../../src/minigames/games/fish';
import { minigameHelpers } from '../../src/minigames/helpers/meter';
import type { MinigameContext, MinigameDef } from '../../src/minigames/types';

test('arena and cave open with their quarry in frame', () => {
  const arena = open(arenaGame);
  const slimes = arena.scene?.children.filter((child) => child.name === 'slime') ?? [];
  expect(slimes).toHaveLength(5);
  for (const slime of slimes)
    expect(Math.hypot(slime.position.x, slime.position.z)).toBeLessThan(12);
  const camera = arena.camera as PerspectiveCamera;
  expect(camera.position.y).toBeGreaterThan(6);
  expect(camera.position.distanceTo(camera.position.clone().set(0, 0, 6))).toBeGreaterThan(10);

  const cave = open(caveGame);
  const crystals = cave.scene?.children.filter((child) => child.name === 'crystal') ?? [];
  expect(crystals).toHaveLength(6);
});

test('fishing and woodchop build visible world props at the player feet', () => {
  const fish = open(fishGame, { x: 4, y: 1.2, z: -3, yaw: 0.4 });
  const pond = fish.worldScene?.getObjectByName('fishing-pond');
  const float = fish.worldScene?.getObjectByName('fishing-float');
  const line = fish.worldScene?.getObjectByName('fishing-line');
  expect(pond?.position.y).toBeCloseTo(1.2);
  expect(float).toBeTruthy();
  expect(line).toBeTruthy();
  expect(pond?.userData.tbKeep).toBe(1);

  const chop = open(chopGame, { x: 2, y: 0.8, z: 1, yaw: 1 });
  const log = chop.worldScene?.getObjectByName('chop-log');
  expect(log).toBeTruthy();
  expect(log && log.position.y).toBeGreaterThan(0.8);
  expect(chop.hud?.querySelector('canvas.px')).toBeTruthy();
});

function open(def: MinigameDef, pose = { x: 0, y: 0, z: 0, yaw: 0 }): MinigameContext {
  const hud = document.createElement('div');
  const side = document.createElement('div');
  const context: MinigameContext = {
    in: { x: 0, y: 0, hold: false },
    pointer: {
      x: 0.5,
      y: 0.5,
      down: false,
      dx: 0,
      dy: 0,
      tap: false,
      press: false,
      dragX: 0,
      dragY: 0,
      moved: false,
    },
    act: false,
    quit: false,
    canvas: null,
    gfx: null,
    scene: new Scene(),
    camera: new PerspectiveCamera(35, 16 / 9, 0.5, 300),
    worldScene: new Scene(),
    pose,
    A: null,
    camYaw: 45,
    hud,
    side,
    width: 960,
    height: 540,
    W: 160,
    H: 120,
    t: 0,
    over: false,
    supplies: createParty(),
    helpers: minigameHelpers,
    done() {
      return;
    },
  };
  def.start(context);
  return context;
}
