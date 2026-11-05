import * as THREE from 'three';

/**
 * Block pawn used until Character Forge publishes an ESM build for three r187.
 * Proportions and palette slots match the controller's fallback rig (`?cf=0`).
 * Crowd capsules stay in the ported crowd pool, which is the same placeholder
 * the controller draws when no forge bundle is pinned.
 */
export interface BlockRigMaterials {
  skin: THREE.Material;
  face: THREE.Material;
  hair: THREE.Material;
  tunic: THREE.Material;
  cloak: THREE.Material;
  pants: THREE.Material;
  boots: THREE.Material;
  trim: THREE.Material;
  pack: THREE.Material;
}

export interface BlockRig {
  root: THREE.Group;
  pv: THREE.Group;
  body: THREE.Group;
  cg: THREE.Group;
  hg: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
  sh: THREE.Mesh;
  ring: THREE.Mesh;
  cur: {
    ll: number;
    lr: number;
    al: number;
    ar: number;
    lean: number;
    cloak: number;
    crouch: number;
  };
}

function add(
  geometry: THREE.BufferGeometry,
  material: THREE.Material | THREE.Material[],
  x: number,
  y: number,
  z: number,
  parent: THREE.Object3D,
): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

/** Controller fallback hero: box head, tunic, cloak. Feet sit on y = 0. */
export function createBlockRig(scene: THREE.Scene, materials: BlockRigMaterials): BlockRig {
  const root = new THREE.Group();
  const pv = new THREE.Group();
  const body = new THREE.Group();
  pv.position.y = 0.6;
  body.position.y = -0.6;
  root.add(pv);
  pv.add(body);
  scene.add(root);

  const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
  const cyl = (a: number, b: number, h: number, n: number) =>
    new THREE.CylinderGeometry(a, b, h, n);
  const cone = (r: number, h: number, n = 4) => new THREE.ConeGeometry(r, h, n);
  const m = materials;

  add(cyl(0.2, 0.26, 0.42, 6), m.tunic, 0, 0.63, 0, body);
  add(cyl(0.28, 0.3, 0.1, 6), m.trim, 0, 0.82, 0, body);
  add(cyl(0.27, 0.27, 0.07, 6), m.trim, 0, 0.5, 0, body);
  add(box(0.3, 0.32, 0.14), m.pack, 0, 0.64, -0.26, body);

  const cloak = new THREE.Group();
  cloak.position.set(0, 0.8, -0.2);
  body.add(cloak);
  add(box(0.46, 0.42, 0.05), m.cloak, 0, -0.21, 0, cloak);

  const limb = (x: number, y: number) => {
    const group = new THREE.Group();
    group.position.set(x, y, 0);
    body.add(group);
    return group;
  };
  const armL = limb(-0.3, 0.8);
  const armR = limb(0.3, 0.8);
  const legL = limb(-0.12, 0.42);
  const legR = limb(0.12, 0.42);
  for (const arm of [armL, armR]) {
    add(box(0.13, 0.3, 0.13), m.tunic, 0, -0.15, 0, arm);
    add(box(0.1, 0.1, 0.1), m.skin, 0, -0.34, 0, arm);
  }
  for (const leg of [legL, legR]) {
    add(box(0.16, 0.28, 0.17), m.pants, 0, -0.14, 0, leg);
    add(box(0.19, 0.16, 0.27), m.boots, 0, -0.34, 0.03, leg);
  }

  const head = new THREE.Group();
  body.add(head);
  add(box(0.62, 0.62, 0.62), [m.skin, m.skin, m.skin, m.skin, m.face, m.skin], 0, 0, 0, head);
  add(box(0.7, 0.26, 0.7), m.hair, 0, 0.25, 0, head);
  add(box(0.7, 0.5, 0.14), m.hair, 0, 0.02, -0.3, head);
  for (const side of [-1, 1]) {
    add(box(0.08, 0.4, 0.3), m.hair, side * 0.35, -0.02, -0.02, head);
  }
  for (const x of [-0.2, 0, 0.2]) {
    const tuft = add(cone(0.12, 0.3), m.hair, x, 0.3, 0.34, head);
    tuft.rotation.x = 2.2;
  }
  const crest = add(cone(0.14, 0.34), m.hair, 0, 0.5, -0.05, head);
  crest.rotation.x = 0;

  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.4, 14),
    new THREE.MeshBasicMaterial({
      color: 0x3d5a48,
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
    }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.userData.surface = 1;
  scene.add(shadow);

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.27, 0.3, 24),
    new THREE.MeshBasicMaterial({ color: 0xe0245e, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.userData.surface = 1;
  ring.visible = false;
  scene.add(ring);

  root.userData.tbKeep = 1;
  shadow.userData.tbKeep = 1;
  ring.userData.tbKeep = 1;

  return {
    root,
    pv,
    body,
    cg: cloak,
    hg: head,
    armL,
    armR,
    legL,
    legR,
    sh: shadow,
    ring,
    cur: { ll: 0, lr: 0, al: 0, ar: 0, lean: 0, cloak: 0, crouch: 0 },
  };
}
