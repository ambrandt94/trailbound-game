import {
  AmbientLight,
  Color,
  DirectionalLight,
  HemisphereLight,
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
export function createStage(canvas: HTMLCanvasElement, background: string) {
  const renderer = new WebGLRenderer({ canvas, antialias: false, alpha: false });
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.setPixelRatio(1);
  const scene = new Scene();
  scene.background = new Color(background);
  const camera = new PerspectiveCamera(42, 1, 0.1, 80);
  camera.position.set(0, 3.4, 6.8);
  camera.lookAt(0, 0.7, 0);
  const hemi = new HemisphereLight(0xfff6e4, 0x8d6a42, 0.62);
  const sun = new DirectionalLight(0xfff1d0, 2.6);
  sun.position.set(4.5, 8, 3);
  const fill = new AmbientLight(0xfff8ee, 0.38);
  scene.add(hemi, sun, fill);
  const resize = (width: number, height: number) => {
    renderer.setSize(width, height, false);
    camera.aspect = width / Math.max(1, height);
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
