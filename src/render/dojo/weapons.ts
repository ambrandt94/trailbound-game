import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshLambertMaterial,
  SphereGeometry,
  type Material,
} from 'three';
import type { MotionPose } from './motion';

export interface WeaponKit {
  right: Group;
  left: Group | null;
  apply(pose: MotionPose): void;
  dispose(): void;
}

const geo = {
  box: (w: number, h: number, d: number) => new BoxGeometry(w, h, d),
  cyl: (r: number, h: number) => new CylinderGeometry(r, r, h, 6),
  ball: (r: number) => new SphereGeometry(r, 8, 6),
};

function mat(color: string): MeshLambertMaterial {
  return new MeshLambertMaterial({ color });
}

function mesh(
  geometry: BoxGeometry | CylinderGeometry | SphereGeometry,
  color: string,
  y = 0,
): Mesh {
  const item = new Mesh(geometry, mat(color));
  item.position.y = y;
  item.castShadow = false;
  return item;
}

/** Primitive stand-ins. The repo has no weapon meshes to attach. */
export function createWeaponKit(styleId: string): WeaponKit {
  const right = new Group();
  right.name = `dojo-weapon-${styleId}`;
  let left: Group | null = null;
  if (styleId === 'axe') {
    right.add(mesh(geo.cyl(0.035, 0.72), '#6b4423', 0.28));
    const head = mesh(geo.box(0.28, 0.16, 0.06), '#c5ccd4', 0.62);
    head.rotation.z = 0.2;
    right.add(head);
  } else if (styleId === 'hammer') {
    right.add(mesh(geo.cyl(0.04, 0.95), '#5a3a22', 0.4));
    right.add(mesh(geo.box(0.34, 0.22, 0.22), '#4e555c', 0.9));
  } else if (styleId === 'daggers') {
    right.add(mesh(geo.box(0.04, 0.38, 0.015), '#d5dbe2', 0.22));
    right.add(mesh(geo.box(0.06, 0.06, 0.03), '#6b4423', 0.02));
    left = new Group();
    left.add(mesh(geo.box(0.04, 0.34, 0.015), '#d5dbe2', 0.2));
    left.add(mesh(geo.box(0.05, 0.05, 0.03), '#6b4423', 0.02));
  } else if (styleId === 'sword-shield') {
    right.add(mesh(geo.box(0.045, 0.72, 0.02), '#d5dbe2', 0.42));
    right.add(mesh(geo.box(0.16, 0.035, 0.03), '#8a5a32', 0.08));
    left = new Group();
    left.add(mesh(geo.box(0.42, 0.52, 0.06), '#8d3b2f', 0.1));
    left.add(mesh(geo.cyl(0.07, 0.08), '#d7c07a', 0.12));
  } else if (styleId === 'club') {
    right.add(mesh(geo.cyl(0.045, 0.55), '#6b4423', 0.22));
    right.add(mesh(geo.ball(0.09), '#5a3a22', 0.52));
  } else {
    right.add(mesh(geo.box(0.08, 0.06, 0.1), '#e0b090', 0.04));
    left = new Group();
    left.add(mesh(geo.box(0.08, 0.06, 0.1), '#e0b090', 0.04));
  }
  return {
    right,
    left,
    apply(pose: MotionPose) {
      right.rotation.set(pose.weaponPitch, pose.weaponYaw, pose.weaponRoll);
      if (left) left.rotation.set(pose.offPitch, 0, 0);
    },
    dispose() {
      disposeGroup(right);
      if (left) disposeGroup(left);
    },
  };
}

function disposeGroup(group: Group): void {
  group.removeFromParent();
  group.traverse((node) => {
    const item = node as Mesh;
    item.geometry?.dispose();
    const material = item.material as Material | Material[] | undefined;
    if (Array.isArray(material)) for (const entry of material) entry.dispose();
    else material?.dispose();
  });
}
