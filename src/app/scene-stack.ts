export interface Scene {
  readonly id: string;
  enter(): void | Promise<void>;
  update(dt: number): void;
  render(alpha: number): void;
  exit(): void;
}

/**
 * Scenes stack so a later minigame can pause the area instead of destroying it.
 * `renderWithResident` keeps drawing a lower scene (the map) while another is on top.
 */
export class SceneStack {
  private readonly scenes: Scene[] = [];

  get size(): number {
    return this.scenes.length;
  }

  current(): Scene | undefined {
    return this.scenes[this.scenes.length - 1];
  }

  async push(scene: Scene): Promise<void> {
    this.scenes.push(scene);
    await scene.enter();
  }

  async pop(): Promise<Scene | undefined> {
    const scene = this.scenes.pop();
    if (!scene) return undefined;
    scene.exit();
    return scene;
  }

  async replace(scene: Scene): Promise<void> {
    const previous = this.scenes.pop();
    previous?.exit();
    this.scenes.push(scene);
    await scene.enter();
  }

  /** Insert under the current top without exiting it. The map stays on the stack in 3D. */
  insertUnderTop(scene: Scene): void {
    if (this.scenes.length === 0) {
      this.scenes.push(scene);
      void scene.enter();
      return;
    }
    this.scenes.splice(this.scenes.length - 1, 0, scene);
    void scene.enter();
  }

  remove(scene: Scene): void {
    const index = this.scenes.lastIndexOf(scene);
    if (index < 0) return;
    this.scenes.splice(index, 1);
    scene.exit();
  }

  update(dt: number): void {
    this.current()?.update(dt);
  }

  render(alpha: number): void {
    this.current()?.render(alpha);
  }

  renderWithResident(alpha: number, resident: Scene | null): void {
    const top = this.current();
    if (resident && resident !== top) resident.render(alpha);
    top?.render(alpha);
  }
}
