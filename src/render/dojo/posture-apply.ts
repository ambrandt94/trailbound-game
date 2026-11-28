/**
 * Applies a posture pose onto the spine after the mixer has written the clip.
 * The root and the hip pitch stay nearly still so the feet are not used as a hinge.
 */
import { Euler, Object3D, Quaternion, Vector3 } from 'three';
import { crouchBend, type BoneAngles, type PosturePose } from '../../core/combat/posture';

const PITCH_BONES: [string, keyof BoneAngles][] = [
  ['Hips', 'hips'],
  ['Spine', 'spine'],
  ['Chest', 'chest'],
  ['Neck', 'neck'],
  ['Head', 'head'],
];

const scratch = new Quaternion();
const euler = new Euler(0, 0, 0, 'XYZ');

function indexBones(root: Object3D): Map<string, Object3D> {
  const found = new Map<string, Object3D>();
  root.traverse((node) => {
    if (
      PITCH_BONES.some(([name]) => name === node.name) ||
      node.name.startsWith('Thigh_') ||
      node.name.startsWith('Shin_')
    ) {
      found.set(node.name, node);
    }
  });
  return found;
}

function applyCrouch(hips: Object3D, drop: number): void {
  const data = hips.userData as { tbCrouch?: number; tbY?: number };
  const prev = data.tbCrouch ?? 0;
  const owned = data.tbY === undefined || Math.abs(hips.position.y - data.tbY) < 1e-4;
  const base = owned ? hips.position.y + prev : hips.position.y;
  hips.position.y = base - drop;
  data.tbCrouch = drop;
  data.tbY = hips.position.y;
}

/**
 * One local offset per frame. If the mixer did not write a new quaternion,
 * put back the pre-offset pose before applying again so the lean cannot stack.
 */
function applyOffset(bone: Object3D, pitchDeg: number, rollDeg: number): void {
  const data = bone.userData as { tbBase?: Quaternion; tbApplied?: Quaternion };
  if (data.tbApplied && data.tbBase && bone.quaternion.equals(data.tbApplied)) {
    bone.quaternion.copy(data.tbBase);
  }
  if (!data.tbBase) data.tbBase = new Quaternion();
  data.tbBase.copy(bone.quaternion);
  if (pitchDeg !== 0 || rollDeg !== 0) {
    euler.set((pitchDeg * Math.PI) / 180, 0, (rollDeg * Math.PI) / 180);
    scratch.setFromEuler(euler);
    bone.quaternion.multiply(scratch);
  }
  if (!data.tbApplied) data.tbApplied = new Quaternion();
  data.tbApplied.copy(bone.quaternion);
}

export function applyPosture(root: Object3D, pose: PosturePose, scale = 1): void {
  const bones = indexBones(root);
  for (const [name, key] of PITCH_BONES) {
    const bone = bones.get(name);
    if (!bone) continue;
    applyOffset(bone, pose.pitch[key], pose.roll[key]);
  }
  const hips = bones.get('Hips');
  if (!hips) return;
  const sized = scale > 0 ? scale : 1;
  const drop = Math.max(0, pose.crouch) / sized;
  applyCrouch(hips, drop);
  const bend = crouchBend(drop);
  for (const side of ['L', 'R']) {
    const thigh = bones.get(`Thigh_${side}`);
    const shin = bones.get(`Shin_${side}`);
    if (thigh) applyOffset(thigh, bend.thigh, 0);
    if (shin) applyOffset(shin, bend.shin, 0);
  }
}

/** World Y of a named bone. Tests use this to check the foot stays down. */
export function boneWorldY(root: Object3D, name: string): number | null {
  const found = root.getObjectByName(name);
  if (!found) return null;
  root.updateMatrixWorld(true);
  const point = new Vector3();
  found.getWorldPosition(point);
  return point.y;
}
