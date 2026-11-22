/**
 * Character Forge 2's built-in Idle is a 2° head/chest nod on the bind pose,
 * and its Walk is a 26° shuffle with the arms still in that low T-pose.
 * The vendored KayKit pack (CC0, already in the 2.1.1 bundle) has a real
 * idle weight-shift and a full walk, retargeted to the same bone names.
 *
 * This file lives outside `src/render/characters/`, which Character Forge owns.
 * `buildAvatar` calls `applyKaykitLocomotion` after a v2 build.
 */
import { AnimationClip } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { BuiltCharacter } from './characters/backends/types';
import { characterForgeV2Paths } from './characters/cf-pin';

let pending: Promise<LocomotionClips | null> | null = null;

interface LocomotionClips {
  idle: AnimationClip;
  walk: AnimationClip;
}

export async function applyKaykitLocomotion(built: BuiltCharacter, url?: string): Promise<void> {
  const pack = await loadKaykitLocomotion(url ?? kaykitUrl());
  if (!pack || !built.clips) return;
  const idle = pack.idle.clone();
  const walk = pack.walk.clone();
  idle.name = 'Idle';
  walk.name = 'Walk';
  const previousIdle = built.clips.Idle;
  const previousWalk = built.clips.Walk;
  built.clips.Idle = idle;
  built.clips.Walk = walk;
  built.mixer.stopAllAction();
  if (previousIdle) built.mixer.uncacheClip(previousIdle);
  if (previousWalk) built.mixer.uncacheClip(previousWalk);
  built.play('Idle');
  const metrics = (built.object3D.userData as { cfMetrics?: { walkDuration?: number } }).cfMetrics;
  if (metrics) metrics.walkDuration = walk.duration;
}

export async function loadKaykitLocomotion(url = kaykitUrl()): Promise<LocomotionClips | null> {
  pending ??= loadFrom(url);
  const pack = await pending;
  if (!pack && url === kaykitUrl()) pending = null;
  return pack;
}

function kaykitUrl(): string {
  return `/${characterForgeV2Paths().base}assets/packs/kaykit_anims.glb`.replace(/\/{2,}/g, '/');
}

async function loadFrom(url: string): Promise<LocomotionClips | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const gltf = await new GLTFLoader().parseAsync(await response.arrayBuffer(), '');
    const idle = gltf.animations.find((clip) => clip.name === 'Kay_Idle');
    const walk = gltf.animations.find((clip) => clip.name === 'Kay_Walk');
    if (!idle || !walk) return null;
    return { idle, walk };
  } catch {
    return null;
  }
}
