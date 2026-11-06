import * as THREE from 'three';
import { aimForgeSun } from './forge';

const SKY = 0xc5d8ea;
const LAWN = 0xc5d4b0;
const STONE = 0xc4a574;

/**
 * Lit pedestal for one avatar. Drag or the arrow keys orbit it.
 * The body itself is owned by the caller.
 */
export class AvatarPreview {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly target = new THREE.Vector3(0, 1.05, 0);
  private body: THREE.Object3D | null = null;
  private yaw = 0.6;
  private pitch = 0.34;
  private distance = 3.4;
  private turntable = false;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private disposed = false;
  private framed = false;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.scene.background = new THREE.Color(SKY);
    this.scene.fog = new THREE.Fog(SKY, 9, 24);

    const hemi = new THREE.HemisphereLight(0xfff6ea, 0x6e8f55, 1.45);
    const sun = new THREE.DirectionalLight(0xfff1cf, 2.5);
    sun.position.set(5, 9, 4);
    const fill = new THREE.DirectionalLight(0xd7e4ff, 0.55);
    fill.position.set(-5, 3, -3);
    this.scene.add(hemi, sun, fill);

    const lawn = new THREE.Mesh(
      new THREE.CircleGeometry(16, 48),
      new THREE.MeshLambertMaterial({ color: LAWN }),
    );
    lawn.rotation.x = -Math.PI / 2;

    const stone = new THREE.MeshLambertMaterial({ color: STONE });
    const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.64, 0.2, 28), stone);
    pedestal.position.y = 0.1;
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.5, 0.05, 28), stone);
    cap.position.y = 0.2;
    this.scene.add(lawn, pedestal, cap);

    this.camera = new THREE.PerspectiveCamera(38, 1, 0.08, 50);
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      failIfMajorPerformanceCaveat: false,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setClearColor(SKY);
    this.placeCamera();

    canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('pointermove', this.onMove);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    window.addEventListener('pointerup', this.onUp);
  }

  setBody(next: THREE.Object3D | null): void {
    if (this.body && this.body !== next) this.scene.remove(this.body);
    this.body = next;
    if (!next) return;
    next.position.set(0, 0.22, 0);
    next.rotation.set(0, 0, 0);
    this.scene.add(next);
    if (!this.framed) {
      this.frameBody();
      this.framed = true;
    }
  }

  /** Take the body out of the preview without disposing it. */
  releaseBody(): void {
    if (!this.body) return;
    this.scene.remove(this.body);
    this.body = null;
  }

  setTurntable(on: boolean): void {
    this.turntable = on;
  }

  orbit(deltaYaw: number, deltaPitch: number): void {
    this.yaw += deltaYaw;
    this.pitch = clamp(this.pitch + deltaPitch, 0.05, 1.2);
  }

  frameBody(): void {
    this.distance = 2.45;
    this.pitch = 0.26;
    this.target.set(0, 0.95, 0);
  }

  frameFace(): void {
    const top = this.headHeight();
    this.distance = 1.65;
    this.pitch = 0.08;
    this.target.set(0, top - 0.08, 0);
  }

  update(dt: number): void {
    if (this.turntable) this.yaw += dt * 0.4;
    this.placeCamera();
  }

  render(): void {
    if (this.disposed) return;
    this.fit();
    aimForgeSun(this.camera);
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.canvas.removeEventListener('pointerdown', this.onDown);
    this.canvas.removeEventListener('pointermove', this.onMove);
    this.canvas.removeEventListener('wheel', this.onWheel);
    window.removeEventListener('pointerup', this.onUp);
    this.releaseBody();
    this.scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.geometry.dispose();
      const material = object.material;
      if (Array.isArray(material)) material.forEach((item) => item.dispose());
      else material.dispose();
    });
    this.renderer.dispose();
  }

  private headHeight(): number {
    if (!this.body) return 1.6;
    const box = new THREE.Box3().setFromObject(this.body);
    if (!Number.isFinite(box.max.y) || box.max.y < 0.4) return 1.6;
    return box.max.y;
  }

  private placeCamera(): void {
    const cos = Math.cos(this.pitch);
    this.camera.position.set(
      this.target.x + Math.sin(this.yaw) * cos * this.distance,
      this.target.y + Math.sin(this.pitch) * this.distance,
      this.target.z + Math.cos(this.yaw) * cos * this.distance,
    );
    this.camera.lookAt(this.target);
  }

  private fit(): void {
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    if (width < 2 || height < 2) return;
    const pixelRatio = Math.min(globalThis.devicePixelRatio || 1, 1.5);
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }

  private readonly onDown = (event: PointerEvent): void => {
    this.dragging = true;
    this.lastX = event.clientX;
    this.lastY = event.clientY;
    this.canvas.setPointerCapture(event.pointerId);
  };

  private readonly onMove = (event: PointerEvent): void => {
    if (!this.dragging) return;
    const dx = event.clientX - this.lastX;
    const dy = event.clientY - this.lastY;
    this.lastX = event.clientX;
    this.lastY = event.clientY;
    this.orbit(-dx * 0.008, dy * 0.005);
  };

  private readonly onUp = (): void => {
    this.dragging = false;
  };

  private readonly onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    this.distance = clamp(this.distance * (1 + event.deltaY * 0.001), 1.05, 7);
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
