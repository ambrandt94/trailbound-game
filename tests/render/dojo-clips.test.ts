import { expect, test } from 'vitest';
import { AdditiveAnimationBlendMode, QuaternionKeyframeTrack } from 'three';
import type { Archetype } from '../../src/core/combat/archetype';
import { attackClip, dodgeClip, stanceClip } from '../../src/render/dojo/clips';
import { CLIP_STRIKE } from '../../src/core/combat/charge';

const ARCHETYPES: Archetype[] = ['horizontal', 'vertical', 'thrust', 'bash'];

function quatTrack(clip: { tracks: { name: string }[] }, bone: string) {
  const track = clip.tracks.find((item) => item.name === `${bone}.quaternion`);
  expect(track, bone).toBeInstanceOf(QuaternionKeyframeTrack);
  return track as QuaternionKeyframeTrack;
}

function sample(track: QuaternionKeyframeTrack, time: number): number[] {
  const times = track.times;
  let index = 0;
  for (let i = 0; i < times.length; i += 1) {
    if ((times[i] ?? 0) <= time + 1e-6) index = i;
  }
  const offset = index * 4;
  return [
    track.values[offset] ?? 0,
    track.values[offset + 1] ?? 0,
    track.values[offset + 2] ?? 0,
    track.values[offset + 3] ?? 0,
  ];
}

test('attack clips are full-body additive swings with a strike pose', () => {
  for (const kind of ARCHETYPES) {
    const clip = attackClip(kind);
    expect(clip.name).toBe(`attack-${kind}`);
    expect(clip.blendMode).toBe(AdditiveAnimationBlendMode);
    expect(clip.name.toLowerCase()).not.toContain('kevin');
    expect(clip.name).not.toContain('KI_');
    for (const bone of ['UpperArm_R', 'UpperArm_L', 'Chest', 'Hips', 'Thigh_R', 'Thigh_L']) {
      expect(clip.tracks.some((track) => track.name === `${bone}.quaternion`)).toBe(true);
    }
    expect(clip.tracks.some((track) => track.name === 'Hips.position')).toBe(true);
    let delta = 0;
    for (const bone of ['UpperArm_R', 'UpperArm_L', 'Chest', 'Thigh_R']) {
      const track = quatTrack(clip, bone);
      const rest = sample(track, 0);
      const strike = sample(track, CLIP_STRIKE);
      delta = Math.max(
        delta,
        Math.hypot(
          (strike[0] ?? 0) - (rest[0] ?? 0),
          (strike[1] ?? 0) - (rest[1] ?? 0),
          (strike[2] ?? 0) - (rest[2] ?? 0),
          (strike[3] ?? 0) - (rest[3] ?? 0),
        ),
      );
    }
    expect(delta).toBeGreaterThan(0.2);
  }
});

test('stance, stride, and dodge clips exist for the motor gaits', () => {
  for (const name of [
    'guard',
    'strafe-left',
    'strafe-right',
    'backpedal',
    'start',
    'stop',
    'skid',
    'sprint',
  ] as const) {
    const clip = stanceClip(name);
    expect(clip.blendMode).toBe(AdditiveAnimationBlendMode);
    expect(clip.tracks.length).toBeGreaterThan(8);
  }
  for (const kind of ['forward', 'back', 'left', 'right'] as const) {
    const clip = dodgeClip(kind);
    expect(clip.blendMode).toBe(AdditiveAnimationBlendMode);
    const hips = clip.tracks.find((track) => track.name === 'Hips.position');
    expect(hips).toBeTruthy();
    const values = hips?.values ?? [];
    const peak = Math.max(...Array.from(values).map((value) => Math.abs(value)));
    expect(peak).toBeGreaterThan(0.05);
    expect(peak).toBeLessThan(0.5);
  }
});
