# Player avatar hook

`forge.ts` is the only file that imports `cf-runtime.mjs` or calls `CF.*`.

The area controller (the port into `src/render/area`) should not import Character Forge. After the player confirms a look, the committed body is available here:

```ts
import { getPlayerBody, tickPlayerBody } from '../characters';

// once, when a body appears
const body = getPlayerBody();
if (body && body.object3D.parent !== scene) {
  scene.add(body.object3D);
  placeholderPawn.visible = false;
}

// every frame, in place of spinning the capsule
const body = getPlayerBody();
if (body) {
  body.object3D.position.set(pose.x, 0, pose.z);
  body.object3D.rotation.y = pose.yaw;
  body.play(moving ? 'Walk' : 'Idle');
  tickPlayerBody(dt);
} else {
  placeholderPawn.visible = true;
}
```

`getPlayerBody()` is null until the creator confirms, and after `?cf=0` or a Forge failure it is still a body: `source === 'placeholder'` (a lit capsule pawn, not a block). Do not dispose the body from the area; the creator replaces it on the next confirm.

Pixies hover. Keep calling `play('Idle')` / `play('Walk')`. Forge maps those to Hover / FlyMove.

Set the area renderer to `outputColorSpace = SRGBColorSpace` (the shell already does). Forge atlases are sRGB and nearest-filtered.
