import * as THREE from 'three';
import { AREA_SKY_COLOR, createAreaContent, type AreaContent } from './area-content';

export interface AreaPose {
  x: number;
  z: number;
  yaw: number;
  spin: number;
}

export class AreaRenderer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly content: AreaContent;
  private disposed = false;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.content = createAreaContent();
    try {
      this.renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        alpha: false,
        failIfMajorPerformanceCaveat: false,
      });
    } catch (error) {
      this.content.dispose();
      const message = error instanceof Error ? error.message : 'WebGL renderer failed';
      throw new Error(message);
    }
    this.renderer.setClearColor(AREA_SKY_COLOR);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
  }

  draw(pose: AreaPose): void {
    if (this.disposed) return;
    this.fit();
    this.content.cube.rotation.y = pose.spin;
    this.content.pawn.position.set(pose.x, 0.67, pose.z);
    this.content.pawn.rotation.y = pose.yaw;
    const facingX = Math.sin(pose.yaw);
    const facingZ = -Math.cos(pose.yaw);
    this.content.camera.position.set(pose.x - facingX * 6.4, 4.3, pose.z - facingZ * 6.4);
    this.content.camera.lookAt(pose.x + facingX * 0.5, 0.8, pose.z + facingZ * 0.5);
    this.renderer.render(this.content.scene, this.content.camera);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.content.dispose();
    this.renderer.dispose();
  }

  private fit(): void {
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    if (width < 2 || height < 2) return;
    const pixelRatio = Math.min(globalThis.devicePixelRatio || 1, 2);
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(width, height, false);
    this.content.camera.aspect = width / Math.max(1, height);
    this.content.camera.updateProjectionMatrix();
  }
}
