import { BoxGeometry, Group, Mesh, MeshLambertMaterial } from 'three';

/** Block traveller for instance games. Wood, tunic, and skin stay off black. */
export function makePawn(): Group {
  const group = new Group();
  group.name = 'player-avatar';
  const add = (w: number, h: number, d: number, color: number, x: number, y: number, z: number) => {
    const mesh = new Mesh(new BoxGeometry(w, h, d), new MeshLambertMaterial({ color }));
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    group.add(mesh);
  };
  add(0.16, 0.46, 0.16, 0x4a5a7a, -0.12, 0.4, 0);
  add(0.16, 0.46, 0.16, 0x4a5a7a, 0.12, 0.4, 0);
  add(0.48, 0.62, 0.28, 0xc46a32, 0, 0.95, 0);
  add(0.32, 0.3, 0.3, 0xf0c9a0, 0, 1.48, 0);
  add(0.34, 0.12, 0.32, 0x6b4124, 0, 1.66, 0);
  return group;
}
