import { expect, test } from 'vitest';
import { Euler, Group, Quaternion, Vector3 } from 'three';
import { dojoPlaybackRate } from '../../src/render/dojo/playback';
import { applyPosture, boneWorldY } from '../../src/render/dojo/posture-apply';
import { crouchBend, type PosturePose } from '../../src/core/combat/posture';

function restPose(): PosturePose {
  const zero = { hips: 0, spine: 0, chest: 0, neck: 0, head: 0 };
  return { pitch: { ...zero }, roll: { ...zero }, crouch: 0, strideScale: 1, replaced: false };
}

function rig() {
  const root = new Group();
  root.name = 'Root';
  const trans = new Group();
  trans.position.y = 0.3;
  const hips = new Group();
  hips.name = 'Hips';
  hips.position.y = 0.03;
  const pelvis = new Group();
  pelvis.name = 'Pelvis';
  pelvis.rotation.x = -Math.PI;
  const spine = new Group();
  spine.name = 'Spine';
  spine.position.y = 0.07;
  const chest = new Group();
  chest.name = 'Chest';
  chest.position.y = 0.1;
  const neck = new Group();
  neck.name = 'Neck';
  neck.position.y = 0.09;
  const head = new Group();
  head.name = 'Head';
  head.position.y = 0.04;
  const thigh = new Group();
  thigh.name = 'Thigh_L';
  thigh.position.y = 0.02;
  const knee = new Group();
  knee.name = 'Knee_L';
  knee.position.y = 0.14;
  const shin = new Group();
  shin.name = 'Shin_L';
  shin.position.y = 0.02;
  const foot = new Group();
  foot.name = 'Foot_L';
  foot.position.y = 0.11;
  root.add(trans);
  trans.add(hips);
  hips.add(pelvis, spine);
  spine.add(chest);
  chest.add(neck);
  neck.add(head);
  pelvis.add(thigh);
  thigh.add(knee);
  knee.add(shin);
  shin.add(foot);
  return { root, foot, knee, hips };
}

function worldPitch(root: Group, name: string): number {
  root.updateMatrixWorld(true);
  const bone = root.getObjectByName(name);
  if (!bone) throw new Error(name);
  const q = new Quaternion();
  bone.getWorldQuaternion(q);
  const euler = new Euler().setFromQuaternion(q, 'XYZ');
  return (euler.x * 180) / Math.PI;
}

test('lean bends the spine and leaves the root and the foot alone', () => {
  const { root, foot } = rig();
  const before = boneWorldY(root, 'Foot_L');
  const pose = restPose();
  pose.pitch = { hips: 0, spine: 4, chest: 8, neck: -5, head: -7 };
  pose.roll = { hips: 0, spine: 2.5, chest: 4, neck: -3, head: -3.5 };
  applyPosture(root, pose, 1);
  expect(root.rotation.x).toBe(0);
  expect(root.rotation.z).toBe(0);
  expect(root.quaternion.x).toBe(0);
  expect(root.quaternion.z).toBe(0);
  expect(worldPitch(root, 'Chest')).toBeCloseTo(4 + 8, 1);
  expect(Math.abs(worldPitch(root, 'Head'))).toBeLessThan(1);
  const once = worldPitch(root, 'Chest');
  applyPosture(root, pose, 1);
  expect(worldPitch(root, 'Chest')).toBeCloseTo(once, 1);
  const after = boneWorldY(root, 'Foot_L');
  expect(after).toBeCloseTo(before ?? 0, 4);
  expect(foot.position.y).toBeCloseTo(0.11, 5);
});

test('a crouch drops the hips and keeps the foot on the ground', () => {
  const { root, knee } = rig();
  const before = boneWorldY(root, 'Foot_L') ?? 0;
  const pose = restPose();
  pose.crouch = 0.04;
  applyPosture(root, pose, 1);
  const after = boneWorldY(root, 'Foot_L') ?? 0;
  expect(Math.abs(after - before)).toBeLessThan(0.015);
  root.updateMatrixWorld(true);
  const kneeAt = new Vector3();
  knee.getWorldPosition(kneeAt);
  expect(kneeAt.z).toBeGreaterThan(0.02);
  expect(root.rotation.x).toBe(0);
  const bend = crouchBend(0.04);
  expect(bend.thigh).toBeLessThan(0);
  expect(bend.shin).toBeGreaterThan(0);
  const dropped = boneWorldY(root, 'Hips') ?? 0;
  root.traverse((node) => {
    if (node.name === 'Thigh_L' || node.name === 'Shin_L') node.quaternion.identity();
  });
  applyPosture(root, restPose(), 1);
  const restored = boneWorldY(root, 'Hips') ?? 0;
  expect(restored).toBeGreaterThan(dropped + 0.03);
  expect(Math.abs((boneWorldY(root, 'Foot_L') ?? 0) - before)).toBeLessThan(0.015);
});

test('playback follows the clip stride and a plant stops the cycle', () => {
  const metrics = {
    heightM: 1.4,
    strideM: 0.66,
    walkDuration: 2 / 3,
    scale: 1,
    runDuration: 0.666,
    runStrideM: 1.2,
  };
  const run = dojoPlaybackRate(3, { idle: 0, walk: 0, run: 1 }, 1, metrics);
  const walk = dojoPlaybackRate(3, { idle: 0, walk: 1, run: 0 }, 1, metrics);
  expect(run).toBeCloseTo((3 * 0.666) / 1.2, 5);
  expect(walk).toBeCloseTo((3 * (2 / 3)) / 0.66, 5);
  expect(run).not.toBeCloseTo(walk, 2);
  expect(dojoPlaybackRate(3, { idle: 0, walk: 0, run: 1 }, 0, metrics)).toBe(0);
  expect(dojoPlaybackRate(0.1, { idle: 1, walk: 0, run: 0 }, 1, null)).toBe(1);
});
