import * as THREE from 'three';

export const AREA_SKY_COLOR = '#b9def2';
export const AREA_GROUND_COLOR = '#74a364';
export const AREA_CUBE_COLOR = '#e07a3d';
export const AREA_PAWN_COLOR = '#2f4d8a';

export interface AreaContent {
  scene: THREE.Scene;
  cube: THREE.Mesh;
  ground: THREE.Mesh;
  pawn: THREE.Mesh;
  camera: THREE.PerspectiveCamera;
  dispose(): void;
}

/** Lit placeholder town: spinning cube, flat ground, capsule pawn. No WebGL required to build. */
export function createAreaContent(): AreaContent {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(AREA_SKY_COLOR);

  const hemi = new THREE.HemisphereLight('#f7fbff', '#6f9a5e', 1.35);
  const sun = new THREE.DirectionalLight('#fff1cf', 2.6);
  sun.position.set(8, 14, 6);

  const groundMaterial = new THREE.MeshLambertMaterial({ color: AREA_GROUND_COLOR });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(16, 16), groundMaterial);
  ground.rotation.x = -Math.PI / 2;

  const cubeMaterial = new THREE.MeshLambertMaterial({ color: AREA_CUBE_COLOR });
  const cube = new THREE.Mesh(new THREE.BoxGeometry(1.35, 1.35, 1.35), cubeMaterial);
  cube.position.set(0, 0.68, -3.4);

  const pawnMaterial = new THREE.MeshLambertMaterial({ color: AREA_PAWN_COLOR });
  const pawn = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 0.7, 4, 12), pawnMaterial);
  pawn.position.set(0, 0.67, 0);

  scene.add(hemi, sun, ground, cube, pawn);

  const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 80);
  camera.position.set(0, 4.4, 6.5);
  camera.lookAt(0, 0.8, 0);

  return {
    scene,
    cube,
    ground,
    pawn,
    camera,
    dispose() {
      ground.geometry.dispose();
      cube.geometry.dispose();
      pawn.geometry.dispose();
      groundMaterial.dispose();
      cubeMaterial.dispose();
      pawnMaterial.dispose();
    },
  };
}
