/**
 * A still of the last 3D frame, laid over the area canvas.
 *
 * A convoy re-cut has to tear the old renderer down before the next window
 * can open the same canvas. Instead of dipping to black, the last frame is
 * copied to a 2D canvas on top, held while the new window loads, and then
 * dissolved away over the live scene. The copy happens right after a render,
 * in the same task, so the WebGL buffer is still readable.
 */
export class FrameHold {
  private el: HTMLCanvasElement | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly source: HTMLCanvasElement) {}

  /** True while a still is on screen. */
  get active(): boolean {
    return this.el !== null;
  }

  /** Copy the source canvas's current frame. False when there is nothing to copy. */
  capture(): boolean {
    const { width, height } = this.source;
    if (!(width > 0) || !(height > 0)) return false;
    this.clear();
    const el = this.source.ownerDocument.createElement('canvas');
    el.width = width;
    el.height = height;
    el.className = 'view frame-hold';
    const ctx = el.getContext('2d');
    if (!ctx) return false;
    ctx.drawImage(this.source, 0, 0, width, height);
    el.style.zIndex = '2';
    el.style.pointerEvents = 'none';
    el.style.opacity = '1';
    this.source.after(el);
    this.el = el;
    return true;
  }

  /** Dissolve the still away over `seconds`, then remove it. */
  release(seconds: number): void {
    const el = this.el;
    if (!el) return;
    if (this.timer) clearTimeout(this.timer);
    const sec = Math.max(0, seconds);
    el.style.transition = `opacity ${sec}s ease-out`;
    // A frame has to paint at opacity 1 before the transition has anything to run from.
    void el.offsetWidth;
    el.style.opacity = '0';
    this.timer = setTimeout(() => this.clear(), sec * 1000 + 60);
  }

  /** Drop the still at once. */
  clear(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.el?.remove();
    this.el = null;
  }
}
