import {
  Color,
  Mesh,
  NearestFilter,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  WebGLRenderer,
  type Material,
  type Object3D,
  type Texture,
} from 'three';

/** Physical-light rig for pop3d and instanced games. Intensities are r187-scale. */
export function createStage(
  canvas: HTMLCanvasElement,
  background: string,
  mode: 'pop' | 'inst' = 'pop',
) {
  const renderer = new WebGLRenderer({ canvas, antialias: false, alpha: false });
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.setPixelRatio(1);
  const scene = new Scene();
  scene.background = new Color(background);
  const inst = mode === 'inst';
  const camera = new PerspectiveCamera(inst ? 35 : 40, 1, inst ? 0.5 : 0.1, inst ? 300 : 200);
  camera.position.set(0, 8, 12);
  camera.lookAt(0, 0.8, 0);
  const resize = (width: number, height: number) => {
    const w = Math.max(2, Math.ceil(width / 2));
    const h = Math.max(2, Math.ceil(height / 2));
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
  };
  return { renderer, scene, camera, resize };
}

export type Stage = ReturnType<typeof createStage>;

export function pixelTexture(texture: Texture): Texture {
  texture.colorSpace = SRGBColorSpace;
  texture.magFilter = NearestFilter;
  texture.minFilter = NearestFilter;
  texture.generateMipmaps = false;
  return texture;
}

export function disposeObject(root: Object3D): void {
  const materials: Material[] = [];
  root.traverse((node) => {
    const mesh = node as Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const material = mesh.material;
    if (Array.isArray(material)) materials.push(...material);
    else if (material) materials.push(material);
  });
  for (const material of materials) {
    const mapped = material as Material & { map?: Texture | null };
    mapped.map?.dispose();
    material.dispose();
  }
}

export function disposeStage(stage: Stage): void {
  disposeObject(stage.scene);
  stage.renderer.dispose();
}
