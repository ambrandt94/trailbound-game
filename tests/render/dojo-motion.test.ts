import { expect, test } from 'vitest';
import { weapons } from '../../src/core/combat';
import { PLACEHOLDER_MOTIONS, motionPose } from '../../src/render/dojo/motion';

test('every weapon motion is a listed placeholder, and Idle or Walk is a rest pose', () => {
  const listed = new Set<string>(PLACEHOLDER_MOTIONS);
  for (const style of weapons()) {
    for (const move of style.moves) {
      expect(listed.has(move.motion), `${style.id} ${move.id} ${move.motion}`).toBe(true);
    }
  }
  for (const extra of ['enemy-strike', 'stagger', 'down', 'whiff']) {
    expect(listed.has(extra)).toBe(true);
  }
  expect(motionPose('idle', 0.4)).toEqual(motionPose('', 0.4));
  const jab = motionPose('jab', 0.5);
  const slam = motionPose('slam', 0.5);
  expect(jab.weaponPitch).not.toBe(slam.weaponPitch);
  expect(motionPose('dash-stab', 0.5).lunge).toBeGreaterThan(motionPose('jab', 0.5).lunge);
});
