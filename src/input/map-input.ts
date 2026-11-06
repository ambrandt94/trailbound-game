export interface MapGestures {
  pan(dx: number, dy: number): void;
  zoom(sx: number, sy: number, factor: number): void;
}

/** Pointer pan, wheel zoom, and pinch. Detach with the returned function. */
export function attachMapInput(canvas: HTMLElement, gestures: MapGestures): () => void {
  const pointers = new Map<number, { x: number; y: number }>();
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let pinch = 0;

  const local = (event: PointerEvent | WheelEvent): { x: number; y: number } => {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    let dy = event.deltaY;
    if (event.deltaMode === 1) dy *= 16;
    else if (event.deltaMode === 2) dy *= canvas.clientHeight;
    const at = local(event);
    gestures.zoom(at.x, at.y, Math.exp(-dy * 0.0032));
  };

  const onDown = (event: PointerEvent): void => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const at = local(event);
    pointers.set(event.pointerId, at);
    canvas.setPointerCapture?.(event.pointerId);
    if (pointers.size >= 2) {
      dragging = false;
      pinch = gap();
      return;
    }
    dragging = true;
    lastX = at.x;
    lastY = at.y;
  };

  const onMove = (event: PointerEvent): void => {
    const at = local(event);
    if (pointers.has(event.pointerId)) pointers.set(event.pointerId, at);
    if (pointers.size >= 2) {
      const next = gap();
      if (pinch > 4 && next > 4) {
        const mid = midpoint();
        gestures.zoom(mid.x, mid.y, next / pinch);
      }
      pinch = next;
      return;
    }
    if (!dragging) return;
    gestures.pan(at.x - lastX, at.y - lastY);
    lastX = at.x;
    lastY = at.y;
  };

  const onUp = (event: PointerEvent): void => {
    pointers.delete(event.pointerId);
    if (pointers.size < 2) pinch = 0;
    if (pointers.size === 0) dragging = false;
  };

  function gap(): number {
    const pts = [...pointers.values()];
    const a = pts[0];
    const b = pts[1];
    if (!a || !b) return 0;
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function midpoint(): { x: number; y: number } {
    const pts = [...pointers.values()];
    const a = pts[0];
    const b = pts[1];
    if (!a || !b) return a ?? { x: 0, y: 0 };
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  return () => {
    canvas.removeEventListener('wheel', onWheel);
    canvas.removeEventListener('pointerdown', onDown);
    canvas.removeEventListener('pointermove', onMove);
    canvas.removeEventListener('pointerup', onUp);
    canvas.removeEventListener('pointercancel', onUp);
  };
}
